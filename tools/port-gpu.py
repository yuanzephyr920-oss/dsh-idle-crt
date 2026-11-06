"""Move the per-frame CRT compositing onto the GPU.

Before: every frame repainted the plate into a 2D canvas (black fill, two
drawImage calls) and uploaded that canvas as a texture, then ran the CRT
shader over it.

After: the two text layers are uploaded once (and when they change), and the
fragment shader composites them itself — warm-up, flicker, wobble, prompt
blink, scanlines, rolling band, noise, vignette and the inversion wipe all run
per pixel on the GPU. The JS frame does nothing but set uniforms and draw.

Run:  python tools/port-gpu.py
"""

from __future__ import annotations

import io
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "src" / "client" / "index.js"

text = io.open(SRC, encoding="utf-8").read()

CREATE_START = "function createCrtPass(canvas, preserveDrawingBuffer) {"
CREATE_END = "\n/* =========================================================================\n * Screen 1: CRT lettering"

NEW_CRT = r'''function createCrtPass(canvas, preserveDrawingBuffer) {
  const attrs = {
    alpha: false,
    antialias: true,
    depth: false,
    stencil: false,
    preserveDrawingBuffer: !!preserveDrawingBuffer,
    powerPreference: 'high-performance',
  }
  const gl = canvas.getContext('webgl2', attrs) || canvas.getContext('webgl', attrs)
  if (!gl) return null

  const VS = `
    attribute vec2 aPos;
    varying vec2 vUv;
    void main() {
      vUv = aPos * 0.5 + 0.5;
      gl_Position = vec4(aPos, 0.0, 1.0);
    }
  `
  // Everything that moves lives here. The two text layers arrive as textures and
  // are composited per pixel: warm-up ramp, tube flicker, the sub-pixel wobble,
  // the prompt's appear + blink, then the CRT pass itself (dispersion, scanlines,
  // rolling band, grain, vignette, inversion wipe). The page-side frame only
  // updates uniforms, so a frame costs no 2D work and no texture upload.
  const FS = `
    precision highp float;
    varying vec2 vUv;
    uniform sampler2D uWords;
    uniform sampler2D uPrompt;
    uniform float uWarp;      // barrel distortion amount
    uniform float uAspect;
    uniform vec2  uRes;
    uniform float uVignette;
    uniform float uScan;
    uniform float uTime;
    uniform float uLevels;    // exit fade
    uniform float uWipe;      // inversion boundary position in iso space
    uniform float uWipeFlip;  // 0 = this pass paints white, 1 = paints black
    uniform float uWipeOn;    // 0 until the first pass starts (hides the boundary)
    uniform float uMs;        // ms since the tube lit
    uniform float uBootMs;    // warm-up length
    uniform vec2  uWobble;    // wobble amplitude in uv units

    vec2 warp(vec2 uv, float k) {
      if (k <= 0.0001) return uv;
      vec2 c = uv * 2.0 - 1.0;
      c.x *= uAspect;
      float r2 = dot(c, c);
      c *= 1.0 + k * r2;
      c.x /= uAspect;
      return c * 0.5 + 0.5;
    }

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
    }

    void main() {
      vec2 uv = warp(vUv, uWarp);
      float inside = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);

      // ---- warm-up / breathing (the same curve the 2D layer used to apply) ----
      float t = clamp(uMs / max(1.0, uBootMs), 0.0, 1.0);
      float warm = hash(vec2(floor(uTime * 60.0), 11.0)) - 0.5;
      float lvl = (t >= 0.999)
        ? 1.0 + sin(uMs * 0.011) * 0.012
        : clamp(pow(t, 0.35) + warm * 0.12 * (1.0 - t), 0.0, 1.4);
      float flick = (t >= 0.999)
        ? 1.0 - warm * 0.10
        : 1.0 - hash(vec2(floor(uTime * 60.0), 5.0)) * (1.0 - t) * 0.22;
      float wordA = clamp(lvl * flick, 0.0, 1.0);
      float appear = smoothstep(uBootMs * 0.55, uBootMs * 0.98, uMs);
      float blink = 0.55 + 0.45 * sin(uMs * 0.0062);
      float promptA = clamp(appear * (0.34 + 0.66 * blink) * clamp(lvl, 0.0, 1.0), 0.0, 1.0);

      // ---- the two text layers, with the CRT's channel separation ----
      vec2 dir = normalize(vec2(uv.x - 0.5, uv.y - 0.5) + 1e-5);
      float ca = 0.0022 * (0.35 + uWarp * 6.0);
      vec2 uvW = clamp(uv + uWobble * vec2(sin(uTime * 3.2), sin(uTime * 2.1)), 0.0, 1.0);
      vec2 uvP = clamp(uv, 0.0, 1.0);
      vec4 wMid = texture2D(uWords, uvW);
      vec4 pMid = texture2D(uPrompt, uvP);
      vec3 wc = vec3(
        texture2D(uWords, clamp(uvW + dir * ca, 0.0, 1.0)).r,
        wMid.g,
        texture2D(uWords, clamp(uvW - dir * ca, 0.0, 1.0)).b);
      vec3 qc = vec3(
        texture2D(uPrompt, clamp(uvP + dir * ca, 0.0, 1.0)).r,
        pMid.g,
        texture2D(uPrompt, clamp(uvP - dir * ca, 0.0, 1.0)).b);
      vec3 col = vec3(0.0);
      col = mix(col, wc, wMid.a * wordA);
      col = mix(col, qc, pMid.a * promptA);

      // ---- the CRT pass ----
      float band = smoothstep(0.0, 0.12, abs(fract(uv.y * 0.5 + uTime * 0.06) - 0.5));
      float lines = 0.5 + 0.5 * sin(uv.y * uRes.y * 3.14159);
      col *= 1.0 - uScan * lines;
      col += (1.0 - band) * 0.04;
      col += (hash(uv * uRes + uTime) - 0.5) * 0.035;
      vec2 vc = vUv * 2.0 - 1.0;
      float r2 = dot(vc * vec2(uAspect, 1.0), vc * vec2(uAspect, 1.0));
      col *= 1.0 - uVignette * pow(clamp(r2 * 0.32, 0.0, 1.0), 1.6);
      col *= uLevels;
      // Outside the warped source used to be an early return of pure black; keep the
      // black but do not return, so the inversion sweep still reaches the corners
      // (otherwise the plate could never become fully white).
      col *= inside;

      // Inversion wipe: everything behind the travelling boundary flips polarity.
      vec2 iso = vUv * 2.0 - 1.0;
      iso.x *= uAspect;
      float behind = step(iso.x + iso.y, uWipe);
      float m = mix(behind, 1.0 - behind, uWipeFlip);
      col = mix(col, 1.0 - col, m);

      // The boundary itself: a soft cyan edge, so the wipe reads as a line on both
      // the black and the white side of the plate. Hidden until the first pass.
      float edge = exp(-pow((iso.x + iso.y - uWipe) / 0.035, 2.0)) * uWipeOn;
      col = mix(col, vec3(0.62, 0.86, 1.0), edge * 0.40);

      gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
    }
  `

  function compile(type, src) {
    const sh = gl.createShader(type)
    gl.shaderSource(sh, src)
    gl.compileShader(sh)
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(sh)
      gl.deleteShader(sh)
      throw new Error(`shader compile failed: ${log}`)
    }
    return sh
  }

  const prog = gl.createProgram()
  gl.attachShader(prog, compile(gl.VERTEX_SHADER, VS))
  gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FS))
  gl.linkProgram(prog)
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    throw new Error(`program link failed: ${gl.getProgramInfoLog(prog)}`)
  }
  gl.useProgram(prog)

  const buf = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, buf)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
  const aPos = gl.getAttribLocation(prog, 'aPos')
  gl.enableVertexAttribArray(aPos)
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0)

  function makeTex() {
    const t = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, t)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    // NEAREST everywhere: the CRT grain wants chunky pixels, and no mipmaps keeps it
    // crisp when the internal resolution is capped below the CSS size.
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    return t
  }
  const texWords = makeTex()
  const texPrompt = makeTex()

  const u = {}
  for (const name of ['uWords', 'uPrompt', 'uWarp', 'uAspect', 'uRes', 'uVignette', 'uScan',
    'uTime', 'uLevels', 'uWipe', 'uWipeFlip', 'uWipeOn', 'uMs', 'uBootMs', 'uWobble']) {
    u[name] = gl.getUniformLocation(prog, name)
  }

  gl.clearColor(0, 0, 0, 1)
  gl.disable(gl.DEPTH_TEST)
  gl.disable(gl.BLEND)

  let disposed = false
  let layersReady = false

  return {
    resize(cw, ch) {
      canvas.width = cw
      canvas.height = ch
      gl.viewport(0, 0, cw, ch)
      // A resize invalidates whatever was uploaded.
      layersReady = false
    },
    /** Upload the two pre-rendered text layers. Called only when they change. */
    uploadLayers(words, prompt) {
      if (disposed || !words || !prompt) return
      gl.bindTexture(gl.TEXTURE_2D, texWords)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, words)
      gl.bindTexture(gl.TEXTURE_2D, texPrompt)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, prompt)
      layersReady = true
    },
    render(p) {
      if (disposed || !layersReady) return
      gl.useProgram(prog)
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, texWords)
      gl.uniform1i(u.uWords, 0)
      gl.activeTexture(gl.TEXTURE1)
      gl.bindTexture(gl.TEXTURE_2D, texPrompt)
      gl.uniform1i(u.uPrompt, 1)
      gl.uniform1f(u.uWarp, p.warp)
      gl.uniform1f(u.uAspect, p.aspect)
      gl.uniform2f(u.uRes, p.res[0], p.res[1])
      gl.uniform1f(u.uVignette, p.vignette)
      gl.uniform1f(u.uScan, p.scan)
      gl.uniform1f(u.uTime, p.time)
      gl.uniform1f(u.uLevels, p.levels)
      gl.uniform1f(u.uWipe, p.wipe)
      gl.uniform1f(u.uWipeFlip, p.wipeFlip)
      gl.uniform1f(u.uWipeOn, p.wipeOn)
      gl.uniform1f(u.uMs, p.ms)
      gl.uniform1f(u.uBootMs, p.bootMs)
      gl.uniform2f(u.uWobble, p.wobble[0], p.wobble[1])
      gl.clear(gl.COLOR_BUFFER_BIT)
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    },
    dispose() {
      if (disposed) return
      disposed = true
      try { gl.deleteTexture(texWords) } catch (e) {}
      try { gl.deleteTexture(texPrompt) } catch (e) {}
      try { gl.deleteBuffer(buf) } catch (e) {}
      try { gl.deleteProgram(prog) } catch (e) {}
      try {
        const lose = gl.getExtension('WEBGL_lose_context')
        if (lose) lose.loseContext()
      } catch (e) {}
    },
  }
}
'''

assert text.count(CREATE_START) == 1
start = text.index(CREATE_START)
end = text.index(CREATE_END, start)
text = text[:start] + NEW_CRT + text[end:]

# --------------------------------------------------------------------- render
RENDER_START = "  function render() {\n"
RENDER_END = "\n  return {\n    rootEl,"
NEW_RENDER = r'''  function render() {
    // A live exit happens long after the warm-up; a scrubbed one may not, so clamp
    // the warm-up to "done" while exiting.
    const ms = state.phase === 'exiting' ? Math.max(state.plateMs, cfg.bootMs) : state.plateMs
    const wipe = wipeAt(ms, cfg.wipeStartMs, cfg.wipeMs, cfg.wipeHoldMs)
    const levels = state.phase === 'exiting'
      ? clamp(1 - state.phaseT / fadeOutSec, 0, 1)
      : 1

    if (cfg.promptText !== layerPromptText) {
      layerPromptText = cfg.promptText
      layersDirty = true
    }
    if (layersDirty && wctx && qctx) {
      paintWords(wctx, plat.width, plat.height)
      paintPrompt(qctx, plat.width, plat.height, cfg)
      layersDirty = false
      crt.uploadLayers(layerWords, layerPrompt)
    }
    const W = plat.width
    const H = plat.height
    const size = Math.min(W * 0.155, H * 0.22)
    const boot = bootLevel(ms, cfg.bootMs)
    crt.render({
      ms,
      bootMs: cfg.bootMs,
      aspect: W / Math.max(1, H),
      res: [W, H],
      time: state.t,
      warp: 0.06 * boot.level,
      scan: 0.26 * scanMul,
      vignette: 0.55,
      levels,
      wipe: wipe.threshold(W / Math.max(1, H)),
      wipeFlip: wipe.flip,
      wipeOn: wipe.edge,
      // Sub-pixel wobble of the lettering, in uv units (the shader applies the sine).
      wobble: [size * 0.012 / Math.max(1, W), size * 0.006 / Math.max(1, H)],
    })
  }
'''
assert text.count(RENDER_START) == 1
rs = text.index(RENDER_START)
re_ = text.index(RENDER_END, rs)
text = text[:rs] + NEW_RENDER + text[re_:]

# ---------------------------------------------------------------- pixelProbe
PROBE_START = "  function pixelProbe() {\n"
PROBE_END = "\n  const debug = {"
NEW_PROBE = r'''  function pixelProbe() {
    const out = { size: canvas.width + 'x' + canvas.height }
    // The plate is composited on the GPU now, so the "platform layer" has to be
    // rebuilt on demand for a pixel read (it is a diagnostic, not a frame cost).
    try {
      const W = plat.width
      const H = plat.height
      const ms = state.plateMs
      const boot = bootLevel(ms, cfg.bootMs)
      const size = Math.min(W * 0.155, H * 0.22)
      pctx.setTransform(1, 0, 0, 1, 0, 0)
      pctx.globalCompositeOperation = 'source-over'
      pctx.globalAlpha = 1
      pctx.fillStyle = '#000'
      pctx.fillRect(0, 0, W, H)
      pctx.save()
      pctx.translate(Math.sin(ms * 0.0032) * size * 0.012, Math.sin(ms * 0.0021) * size * 0.006)
      pctx.globalAlpha = clamp(boot.level, 0, 1)
      if (wctx) pctx.drawImage(layerWords, 0, 0, W, H)
      pctx.restore()
      const appear = smoothstep(cfg.bootMs * 0.55, cfg.bootMs * 0.98, ms)
      if (appear > 0.001) {
        const blink = 0.55 + 0.45 * Math.sin(ms * 0.0062)
        pctx.globalAlpha = clamp(appear * (0.34 + 0.66 * blink) * clamp(boot.level, 0, 1), 0, 1)
        if (qctx) pctx.drawImage(layerPrompt, 0, 0, W, H)
        pctx.globalAlpha = 1
      }
      out.platform = plat.toDataURL('image/png')
      const pp = doc.createElement('canvas')
      pp.width = 240; pp.height = 135
      const pg = pp.getContext('2d')
      pg.drawImage(plat, 0, 0, 240, 135)
      const pd = pg.getImageData(0, 0, 240, 135).data
      let lit = 0
      for (let i = 0; i < pd.length; i += 4) {
        if (pd[i + 3] > 20 && (pd[i] + pd[i + 1] + pd[i + 2]) / 3 > 40) lit += 1
      }
      out.platformLitShare = +((lit / (240 * 135)) * 100).toFixed(1)
    } catch (err) {
      out.platformError = err && err.message
    }
    try {
      const p = doc.createElement('canvas')
      p.width = 240; p.height = 135
      const g = p.getContext('2d')
      g.drawImage(canvas, 0, 0, 240, 135)
      const d = g.getImageData(0, 0, 240, 135).data
      let white = 0, black = 0, mid = 0
      for (let i = 0; i < d.length; i += 4) {
        const l = (d[i] + d[i + 1] + d[i + 2]) / 3
        if (l > 200) white += 1
        else if (l < 40) black += 1
        else mid += 1
      }
      const total = d.length / 4
      out.pixels = {
        white: +((white / total) * 100).toFixed(1),
        black: +((black / total) * 100).toFixed(1),
        mid: +((mid / total) * 100).toFixed(1),
      }
      out.phase = { phase: state.phase, phaseT: +state.phaseT.toFixed(2) }
      out.dataUrl = canvas.toDataURL('image/png')
    } catch (err) {
      out.error = err && err.message
    }
    return out
  }
'''
assert text.count(PROBE_START) == 1
ps = text.index(PROBE_START)
pe = text.index(PROBE_END, ps)
text = text[:ps] + NEW_PROBE + text[pe:]

# The per-frame upload tick is gone; drop the declaration.
text = text.replace("  let uploadTick = 0\n", "")

io.open(SRC, "w", encoding="utf-8", newline="\n").write(text)
print("patched", SRC, len(text), "chars")
