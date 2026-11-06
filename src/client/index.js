/**
 * dsh-idle-crt - browser half (self-bootstrapping idle plate, plain script)
 * ---------------------------------------------------------------------------
 * This is a SCREENSAVER, not a splash: nothing here covers the page at load.
 * The host injects `lib/bootstrap.js` as an inline row, that bootstrap pulls
 * `/dsh-idle-crt/client.js` (this file, bundled by tools/build.mjs), and from
 * then on two pieces take over:
 *
 *   1. `mountOverlay()` - the CRT plate: a 2D platform layer (lettering, TUI
 *      row, prompt) uploaded as a texture into one WebGL fragment shader
 *      (barrel warp, RGB dispersion, scanlines, rolling band, noise, vignette)
 *      plus the looping inversion wipe. Same artwork as the original splash
 *      plugin; only the trigger changed.
 *
 *   2. `createIdleController()` - the gate. It watches keyboard/mouse activity,
 *      polls the host's busy state (`/dsh-idle-crt/state.json`: is any agent
 *      running?) and mounts the plate only when the page is visible, no agent
 *      is running and nothing happened for `idleMs` (default 10 minutes).
 *      Any keyboard or mouse activity dismisses the plate immediately.
 *
 * NOTE: all comments are ASCII on purpose - this file must survive editors and
 *       tooling that are not UTF-8 clean.
 */

const ROUTE = '/dsh-idle-crt'
const MARK = '__DSH_IDLE_CRT__'
const PLATE_ATTR = 'data-dsh-idle-crt-root'
const win = window
const doc = document
/** Bumped in lib/index.js / package.json together; surfaced on the debug channel. */
const VERSION = '0.2.4'

const DEFAULTS = {
  enabled: true,
  idleMs: 600000,
  pollMs: 1500,
  fadeInMs: 320,
  fadeOutMs: 600,
  bootMs: 1400,
  wipeStartMs: 4000,
  wipeMs: 14000,
  wipeHoldMs: 5000,
  scanlineIntensity: 1,
  promptText: 'PRESS ANY KEY TO CONTINUE',
}

/**
 * Preview mode: a preview page served from disk has no host routes, so it hands
 * its config over as a global and drives the plate itself.
 */
const PREVIEW = (() => {
  try {
    if (win.location.protocol === 'file:') return true
    if (win.__DSH_IDLE_CRT_PREVIEW__) return true
    return new URLSearchParams(win.location.search || '').get('preview') === '1'
  } catch (e) {
    return false
  }
})()

function queryParams() {
  try { return new URLSearchParams(win.location.search || '') } catch (e) { return new URLSearchParams('') }
}

/** The single debug/automation channel, shared by the host page and the preview. */
const channel = (() => {
  try { return win[MARK] || (win[MARK] = {}) } catch (e) { return {} }
})()
channel.version = VERSION
channel.state = PREVIEW ? 'preview' : 'booting'

function nowMs() {
  return (win.performance && typeof win.performance.now === 'function') ? win.performance.now() : Date.now()
}

/* =========================================================================
 * Coexistence with every other overlay plugin
 * ====================================================================== */

/** The floor: above the editor UI, below the 32-bit ceiling. */
const Z_FLOOR = 2147483000

/**
 * Other plugins (pets, widgets, toasts, docked HUDs) mount their own fixed
 * layers on <body>. Walk the body's direct children once and put the plate just
 * above whatever is already there, so two overlays do not end up swapping ends:
 * a HUD painted over the screensaver looks like a bug, a screensaver over the
 * HUD looks like a screensaver.
 */
function pickZIndex() {
  let max = 0
  try {
    const body = doc.body
    if (!body) return Z_FLOOR
    const vw = win.innerWidth || 0
    const vh = win.innerHeight || 0
    const minArea = Math.max(1, vw * vh * 0.2)
    const all = body.children
    for (let i = 0; i < all.length; i += 1) {
      const el = all[i]
      if (!el || el.nodeType !== 1) continue
      if (el.hasAttribute(PLATE_ATTR)) continue
      let cs = null
      try { cs = win.getComputedStyle(el) } catch (e) { continue }
      if (!cs) continue
      if (cs.position !== 'fixed' && cs.position !== 'absolute' && cs.position !== 'sticky') continue
      if (cs.display === 'none' || cs.visibility === 'hidden') continue
      const z = parseInt(cs.zIndex, 10)
      if (!Number.isFinite(z) || z <= 0) continue
      let r = null
      try { r = el.getBoundingClientRect() } catch (e) { continue }
      if (!r) continue
      if (r.width * r.height < minArea) continue
      if (r.bottom <= 0 || r.right <= 0 || r.top >= vh || r.left >= vw) continue
      if (z > max) max = z
    }
  } catch (e) {
    return Z_FLOOR
  }
  // 2147483647 is the ceiling every browser clamps to; leave a little room.
  return Math.min(2147483600, Math.max(Z_FLOOR, max + 10))
}

/**
 * Cooperative signal for other plugins: `<html data-dsh-idle-crt="active">`
 * while the plate covers the page. Animations can pause themselves on it (the
 * plate is opaque, so anything drawn behind it is pure battery burn), and no
 * plugin is obliged to know this plugin's internals.
 */
function setPlateActive(on) {
  try {
    const el = doc.documentElement
    if (!el) return
    if (on) el.setAttribute('data-dsh-idle-crt', 'active')
    else el.removeAttribute('data-dsh-idle-crt')
  } catch (e) {}
}

/**
 * Environments where a screensaver must politely stay away: real fullscreen
 * (video, slides), an open modal dialog (the settings page itself, a confirm
 * box) and a video that is actually playing. The host page can also opt out
 * wholesale with `window.__DSH_IDLE_CRT_SUPPRESS__ = true` (or a function).
 */
function environmentBlocksPlate() {
  try {
    if (doc.fullscreenElement) return 'fullscreen'
  } catch (e) {}
  try {
    const flag = win.__DSH_IDLE_CRT_SUPPRESS__
    if (typeof flag === 'function') { if (flag()) return 'suppressed' }
    else if (flag === true) return 'suppressed'
  } catch (e) {}
  try {
    if (doc.querySelector('[role="dialog"][aria-modal="true"], dialog[open]')) return 'dialog'
  } catch (e) {}
  try {
    // Only *content-sized* video counts. Decorative loops (a pet, a mascot, a
    // background clip) are small and muted; blocking on those would mean the
    // screensaver never appears on a machine that runs one.
    const minArea = win.innerWidth * win.innerHeight * 0.2
    const vids = doc.querySelectorAll('video')
    for (let i = 0; i < vids.length; i += 1) {
      const v = vids[i]
      if (v.paused || v.ended || v.readyState < 2) continue
      const w = v.clientWidth || v.videoWidth || 0
      const h = v.clientHeight || v.videoHeight || 0
      if (w * h >= minArea) return 'video'
    }
  } catch (e) {}
  return null
}

/* =========================================================================
 * Settings
 * ====================================================================== */

/**
 * Numeric knobs all go through `num`: an older host may serve a settings.json
 * without a newly added key, and `Number(undefined) ?? fallback` is NaN - which
 * would silently freeze the wipe schedule.
 */
function overlaySettings(raw) {
  const cfg = raw || {}
  const prompt = typeof cfg.promptText === 'string' ? cfg.promptText.trim() : ''
  return {
    fadeInMs: Math.max(0, num(cfg.fadeInMs, DEFAULTS.fadeInMs)),
    fadeOutMs: Math.max(100, num(cfg.fadeOutMs, DEFAULTS.fadeOutMs)),
    bootMs: Math.max(400, num(cfg.bootMs, DEFAULTS.bootMs)),
    wipeStartMs: Math.max(0, num(cfg.wipeStartMs, DEFAULTS.wipeStartMs)),
    wipeMs: Math.max(800, num(cfg.wipeMs, DEFAULTS.wipeMs)),
    wipeHoldMs: Math.max(0, num(cfg.wipeHoldMs, DEFAULTS.wipeHoldMs)),
    scanlineIntensity: num(cfg.scanlineIntensity, DEFAULTS.scanlineIntensity),
    promptText: prompt || DEFAULTS.promptText,
    // false（默认）时鼠标移动只是「有人在」的信号，不负责收掉画面。
    dismissOnMove: cfg.dismissOnMove === true,
  }
}

function controllerSettings(raw) {
  const cfg = raw || {}
  return {
    ...overlaySettings(cfg),
    enabled: cfg.enabled !== false,
    idleMs: Math.max(0, num(cfg.idleMs, DEFAULTS.idleMs)),
    pollMs: Math.max(500, num(cfg.pollMs, DEFAULTS.pollMs)),
  }
}

/* =========================================================================
 * The plate (what used to be the splash)
 * ====================================================================== */

/**
 * Mount the CRT plate. Resolves to a handle; the handle owns its own input
 * listeners, rAF loop, WebGL resources and teardown.
 *
 * options:
 *   target        - element to mount inside (absolute box); default = <body> + fixed
 *   preview       - keep the drawing buffer (pixel probes / freezing) and do not
 *                   swallow the page's pointer events
 *   interactive   - false to disable the plate's own "any input dismisses" listeners
 *                   (the controller still decides when it goes away)
 *   startPointer  - {x,y} the pointer sat at when the plate appeared; used to
 *                   ignore zero-distance pointermove events
 *   onExit(reason) - called once after the exit fade finished and DOM is gone
 */
function mountOverlay(cfgIn, options) {
  const opts = options || {}
  const cfg = overlaySettings(cfgIn)
  const onExit = typeof opts.onExit === 'function' ? opts.onExit : null
  const target = opts.target || doc.body || doc.documentElement
  const box = Boolean(opts.target)
  const interactive = opts.interactive !== false && !opts.preview
  const preview = Boolean(opts.preview)

  const state = {
    phase: 'screen1',
    t: 0,
    phaseT: 0,
    // ms since the tube lit: drives the warm-up and the inversion wipe.
    plateMs: 0,
    width: 0, height: 0, dpr: 1,
  }

  const fadeOutSec = cfg.fadeOutMs / 1000
  const fadeInSec = cfg.fadeInMs / 1000
  const scanMul = clamp(cfg.scanlineIntensity, 0, 2)

  let closed = false
  let frozen = false
  let raf = 0
  let last = nowMs()
  let fadeInFrame = 0
  let stackObserver = null
  const disposers = []

  // ------------------------------------------------------------------ DOM shell
  let plateZ = pickZIndex()
  const rootEl = doc.createElement('div')
  rootEl.setAttribute(PLATE_ATTR, '1')
  rootEl.setAttribute('role', 'presentation')
  rootEl.setAttribute('aria-hidden', 'true')
  Object.assign(rootEl.style, {
    position: box ? 'absolute' : 'fixed',
    ...(box ? { left: '0', top: '0', width: '100%', height: '100%' } : { inset: '0' }),
    zIndex: String(plateZ),
    background: '#000',
    overflow: 'hidden',
    // The preview page needs its own controls to stay clickable.
    pointerEvents: preview ? 'none' : 'auto',
    touchAction: 'none',
    cursor: 'none',
    contain: 'strict',
    opacity: fadeInSec > 0 ? '0' : '1',
    transition: 'opacity ' + fadeInSec + 's ease-out',
  })
  const canvas = doc.createElement('canvas')
  Object.assign(canvas.style, {
    position: 'absolute', inset: '0', width: '100%', height: '100%', display: 'block',
  })
  rootEl.appendChild(canvas)

  // ------------------------------------------------------------------ pipeline
  // Platform layer (2D, the drawing everyone sees) -> texture -> one fragment
  // shader (warp / dispersion / scanlines / band / noise / vignette / wipe).
  const plat = doc.createElement('canvas')
  // The plate is almost static: words, glow rings and the scanline voids never
  // move (only a ~1px wobble and an alpha blink do). Painting them into layers
  // once and compositing per frame keeps the 2D cost off the frame budget.
  const layerWords = doc.createElement('canvas')
  const wctx = layerWords.getContext('2d', { alpha: true })
  const layerPrompt = doc.createElement('canvas')
  const qctx = layerPrompt.getContext('2d', { alpha: true })
  let layersDirty = true
  let layerPromptText = null
  const pctx = plat.getContext('2d', { alpha: true })
  let crt = null
  try {
    crt = createCrtPass(canvas, preview)
  } catch (err) {
    try { rootEl.remove() } catch (e) {}
    try { console.warn('[dsh-idle-crt] WebGL unavailable:', err && err.message) } catch (e) {}
    throw err
  }
  if (!crt) {
    try { rootEl.remove() } catch (e) {}
    throw new Error('WebGL unavailable')
  }
  target.appendChild(rootEl)
  setPlateActive(true)

  // Another overlay may mount after us (a pet, a HUD, a toast layer). Watch the
  // body's child list so we can step back above it right away instead of waiting
  // for the periodic re-check; the re-check stays as a fallback for z-index
  // changes on an element that was already there.
  function restack() {
    const next = Math.max(plateZ, pickZIndex())
    if (next !== plateZ) {
      plateZ = next
      try { rootEl.style.zIndex = String(next) } catch (e) {}
    }
  }
  try {
    if (typeof win.MutationObserver === 'function' && doc.body) {
      stackObserver = new win.MutationObserver(() => restack())
      stackObserver.observe(doc.body, { childList: true })
    }
  } catch (e) { stackObserver = null }

  function resize() {
    const w = rootEl.clientWidth || win.innerWidth
    const h = rootEl.clientHeight || win.innerHeight
    state.width = w
    state.height = h
    state.dpr = Math.min(1.5, win.devicePixelRatio || 1)
    // Internal render resolution is capped around 1600px wide on purpose: the CRT
    // grain wants chunky pixels, and it keeps the frame budget comfortable.
    const scale = Math.min(1, 1600 / Math.max(1, w))
    const cw = Math.max(640, Math.round(w * scale))
    const ch = Math.max(360, Math.round(h * scale))
    plat.width = cw
    plat.height = ch
    if (layerWords.width !== cw || layerWords.height !== ch) {
      layerWords.width = cw
      layerWords.height = ch
      layerPrompt.width = cw
      layerPrompt.height = ch
      layersDirty = true
    }
    crt.resize(cw, ch)
  }
  const onResize = () => resize()
  win.addEventListener('resize', onResize)

  // --------------------------------------------------------------------- input
  // Default behaviour (dismissOnMove:false): only a real click inside the window
  // or a key ends the plate. Moving the mouse is *not* an intention - a jittered
  // table, a passing cat or a remote-desktop cursor used to wipe the screen.
  // The wheel is swallowed so the page underneath cannot scroll while covered,
  // but scrolling is not a click either.
  const MOVE_THRESHOLD = 4
  let anchor = opts.startPointer && Number.isFinite(opts.startPointer.x)
    ? { x: opts.startPointer.x, y: opts.startPointer.y }
    : null

  function onMove(e) {
    if (!cfg.dismissOnMove) return
    if (state.phase !== 'screen1') return
    const x = Number(e.clientX) || 0
    const y = Number(e.clientY) || 0
    if (!anchor) { anchor = { x, y }; return }
    if (Math.abs(x - anchor.x) + Math.abs(y - anchor.y) < MOVE_THRESHOLD) return
    dismiss('pointermove')
  }
  function onKey(e) {
    if (e.key === 'F5' || e.key === 'F12' || (e.ctrlKey && e.shiftKey)) return
    swallow(e)
    dismiss('key')
  }
  function onPointer(e) {
    swallow(e)
    dismiss('pointerdown')
  }
  function onWheel(e) {
    // Scroll lock only: no dismissal, no reach-through to the page below.
    swallow(e)
  }
  function onContext(e) {
    swallow(e)
    dismiss('contextmenu')
  }
  function swallow(e) {
    try { e.preventDefault(); e.stopPropagation() } catch (err) {}
  }
  function listen(type, fn, options) {
    win.addEventListener(type, fn, options)
    disposers.push([type, fn, options])
  }
  if (interactive) {
    listen('keydown', onKey, true)
    listen('pointerdown', onPointer, true)
    listen('mousedown', onPointer, true)
    listen('touchstart', onPointer, { capture: true, passive: false })
    listen('wheel', onWheel, { capture: true, passive: false })
    listen('contextmenu', onContext, true)
    listen('pointermove', onMove, true)
    listen('mousemove', onMove, true)
  }

  // -------------------------------------------------------------------- exit
  function dismiss(reason) {
    if (closed || state.phase !== 'screen1') return false
    state.phase = 'exiting'
    state.phaseT = 0
    // Hand the page back at once: the fade is 0.6s and the next click should
    // reach the app, not a translucent overlay.
    try { rootEl.style.pointerEvents = 'none' } catch (e) {}
    try {
      rootEl.style.transition = 'opacity ' + fadeOutSec + 's ease-out'
      rootEl.style.opacity = '0'
    } catch (e) {}
    void reason
    return true
  }

  function teardown(reason) {
    if (closed) return
    closed = true
    state.phase = 'done'
    setPlateActive(false)
    if (stackObserver) { try { stackObserver.disconnect() } catch (e) {} stackObserver = null }
    if (raf) { try { win.cancelAnimationFrame(raf) } catch (e) {} raf = 0 }
    if (fadeInFrame) { try { win.cancelAnimationFrame(fadeInFrame) } catch (e) {} fadeInFrame = 0 }
    win.removeEventListener('resize', onResize)
    for (const [type, fn, options] of disposers) {
      try { win.removeEventListener(type, fn, options) } catch (e) {}
    }
    try { crt.dispose() } catch (e) {}
    try { rootEl.remove() } catch (e) {}
    try { console.log('[dsh-idle-crt] plate closed (' + (reason || 'exit') + ')') } catch (e) {}
    if (onExit) { try { onExit(reason || 'exit') } catch (e) {} }
  }

  // ------------------------------------------------------- pixel self-check
  /**
   * Read the real canvas: coverage by luminance, plus data URLs for both the
   * composite and the platform layer. Headless screen capture is unreliable for
   * WebGL, so this is the authoritative check.
   */
  function pixelProbe() {
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

  const debug = {
    pixelProbe,
    info() {
      const w = wipeAt(state.plateMs, cfg.wipeStartMs, cfg.wipeMs, cfg.wipeHoldMs)
      return {
        phase: state.phase,
        t: +state.t.toFixed(3),
        phaseT: +state.phaseT.toFixed(3),
        plateMs: Math.round(state.plateMs),
        canvas: canvas.width + 'x' + canvas.height,
        wipe: { pass: w.pass, u: +w.u.toFixed(3), flip: w.flip, active: w.active, holding: w.holding },
        bootMs: cfg.bootMs,
        wipeStartMs: cfg.wipeStartMs,
        wipeMs: cfg.wipeMs,
        wipeHoldMs: cfg.wipeHoldMs,
      }
    },
    pauseRaf() {
      if (frozen) return this.info()
      frozen = true
      if (raf) { try { win.cancelAnimationFrame(raf) } catch (e) {} raf = 0 }
      render()
      return this.info()
    },
    freezeAt(phase, seconds) {
      frozen = true
      if (raf) { try { win.cancelAnimationFrame(raf) } catch (e) {} raf = 0 }
      state.phase = phase === 'exiting' ? 'exiting' : 'screen1'
      state.phaseT = Math.max(0, Number(seconds) || 0)
      state.plateMs = state.phaseT * 1000
      if (state.phase === 'exiting') {
        try { rootEl.style.transition = 'none' } catch (e) {}
      }
      rootEl.style.opacity = '1'
      // The compiled pipeline needs one more render (shader/texture upload)
      // before the canvas holds a real image; a frozen client has no loop to do it.
      render()
      render()
      return this.info()
    },
    resume() {
      if (!frozen) return this.info()
      frozen = false
      last = nowMs()
      raf = win.requestAnimationFrame(frame)
      return this.info()
    },
    set(patch) {
      if (!patch || typeof patch !== 'object') return this.info()
      if (typeof patch.bootMs === 'number') cfg.bootMs = Math.max(400, patch.bootMs)
      if (typeof patch.wipeStartMs === 'number') cfg.wipeStartMs = Math.max(0, patch.wipeStartMs)
      if (typeof patch.wipeMs === 'number') cfg.wipeMs = Math.max(800, patch.wipeMs)
      if (typeof patch.wipeHoldMs === 'number') cfg.wipeHoldMs = Math.max(0, patch.wipeHoldMs)
      render()
      return this.info()
    },
    dismiss: (reason) => dismiss(reason || 'debug'),
    /** Park the plate on an exact moment of its timeline (used by the GIF recorder). */
    poseAt(ms) {
      const at = Math.max(0, Number(ms) || 0)
      frozen = true
      if (raf) { try { win.cancelAnimationFrame(raf) } catch (e) {} raf = 0 }
      state.phase = 'screen1'
      state.t = at / 1000
      state.phaseT = at / 1000
      state.plateMs = at
      rootEl.style.opacity = '1'
      render()
      return this.info()
    },
  }

  // Dev hook: the GIF recorder drives the plate frame by frame through this.
  try { win.__DSH_IDLE_CRT_PLATE__ = debug } catch (e) {}

  // ------------------------------------------------------------------ startup
  resize()
  if (fadeInSec > 0) {
    // Two nested frames: the first style pass must be painted for the opacity
    // transition to actually run instead of snapping to 1.
    fadeInFrame = win.requestAnimationFrame(() => {
      fadeInFrame = win.requestAnimationFrame(() => {
        fadeInFrame = 0
        rootEl.style.opacity = '1'
      })
    })
  }
  raf = win.requestAnimationFrame(frame)

  function frame() {
    if (frozen) return
    raf = win.requestAnimationFrame(frame)
    const t = nowMs()
    const dt = Math.min(0.05, Math.max(0, (t - last) / 1000))
    last = t
    state.t += dt
    state.phaseT += dt
    state.plateMs += dt * 1000
    // A HUD may mount after us; re-check the stack now and then (body children
    // only, so this stays cheap) and step back above it if needed.
    if (state.phase === 'screen1' && Math.round(state.t * 1000) % 500 < 20) restack()
    if (state.phase === 'exiting' && state.phaseT >= fadeOutSec) {
      teardown('fade')
      return
    }
    render()
  }

  // ---------------------------------------------------------------------- draw
  function render() {
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

  return {
    rootEl,
    state,
    settings: cfg,
    debug,
    dismiss,
    dispose: () => teardown('dispose'),
    isClosed: () => closed,
  }
}

/* =========================================================================
 * The idle controller (the gate)
 * ====================================================================== */

/** 设置页可以改的键（宿主那份 normalizeSettings 是最终权威，这里只做合并）。 */
const SETTING_KEYS = [
  'enabled', 'idleMs', 'pollMs', 'fadeInMs', 'fadeOutMs', 'bootMs',
  'wipeStartMs', 'wipeMs', 'wipeHoldMs', 'scanlineIntensity', 'promptText',
  'dismissOnMove',
]

/**
 * Watch activity + agent busy state and mount the plate when the machine has
 * been idle long enough. The controller is deliberately ignorant of *where*
 * busy comes from: `feedBusy()` is called by the app-mode poller (host
 * `/state.json`) or by a preview page's toggle.
 */
function createIdleController(options) {
  const opts = options || {}
  const settings = controllerSettings(opts.settings)
  const target = opts.target || null
  const preview = Boolean(opts.preview)
  const test = opts.test || {}

  const ctl = {
    settings,
    mode: 'idle',              // idle | mounting | showing
    started: false,
    busy: false,
    forcedBusy: typeof test.busy === 'boolean' ? test.busy : null,
    idleOverride: typeof test.idleMs === 'number' ? test.idleMs : null,
    // External holds (other plugins: "I am showing a modal / playing a video").
    holds: new Set(),
    overlay: null,
    previewing: false,        // an explicit "show me" from the settings page
    mountCount: 0,
    lastInput: nowMs(),
    lastPointer: null,
    fetchErrors: 0,
    lastState: null,
    lastError: null,
    cooldownUntil: 0,
    timers: [],
    listeners: [],
    log: [],
  }

  function note(kind) {
    try {
      ctl.log.push({ at: Date.now(), kind })
      if (ctl.log.length > 40) ctl.log.splice(0, ctl.log.length - 40)
    } catch (e) {}
  }

  function idleMs() {
    if (ctl.idleOverride !== null) return ctl.idleOverride
    return ctl.settings.idleMs
  }

  function busyNow() {
    const hostBusy = ctl.forcedBusy !== null ? ctl.forcedBusy : ctl.busy
    return hostBusy || ctl.holds.size > 0
  }

  /** Another plugin says "do not cover me right now" (modal, video, tour). */
  function hold(reason) {
    const key = String(reason || 'external')
    if (ctl.holds.has(key)) return false
    ctl.holds.add(key)
    note('hold:' + key)
    if (ctl.mode === 'showing') hide('hold:' + key)
    return true
  }

  function release(reason) {
    const key = String(reason || 'external')
    if (!ctl.holds.delete(key)) return false
    note('release:' + key)
    return true
  }

  // ------------------------------------------------------------------- input
  // Activity only feeds the *entry* timer here. Whether a gesture also ends a
  // plate is the plate's own decision (clicks/keys yes, pointer movement no
  // unless dismissOnMove is on) - doing it twice made a plain mouse jiggle look
  // like a dismissal.
  function activity(source) {
    ctl.lastInput = nowMs()
    void source
  }

  function onMove(e) {
    const x = Number(e.clientX) || 0
    const y = Number(e.clientY) || 0
    const prev = ctl.lastPointer
    ctl.lastPointer = { x, y }
    if (!prev) { activity('pointermove'); return }
    if (Math.abs(x - prev.x) + Math.abs(y - prev.y) >= 3) activity('pointermove')
  }
  function onDown(e) {
    activity(e && e.type)
    // Preview page only: the plate there is non-interactive so the control bar
    // stays clickable, which means the plate never sees the click itself —
    // dismiss it from here, except for clicks on the bar.
    if (preview && ctl.mode === 'showing') {
      const t = e && e.target
      const inBar = t && typeof t.closest === 'function' && t.closest('#bar')
      if (!inBar) hide('preview-click')
    }
  }
  function onKeyInput(e) { activity('keydown') }
  function onWheel() { activity('wheel') }
  function onVisibility() {
    if (doc.visibilityState === 'visible') {
      activity('visible')
    } else if (ctl.mode === 'showing') {
      hide('hidden')
    }
  }

  function listen(type, fn, options) {
    win.addEventListener(type, fn, options)
    ctl.listeners.push([type, fn, options])
  }

  function attachInput() {
    listen('pointermove', onMove, { capture: true, passive: true })
    listen('mousemove', onMove, { capture: true, passive: true })
    listen('pointerdown', onDown, true)
    listen('mousedown', onDown, true)
    listen('keydown', onKeyInput, true)
    listen('wheel', onWheel, { capture: true, passive: true })
    listen('touchstart', onDown, { capture: true, passive: true })
    doc.addEventListener('visibilitychange', onVisibility)
    ctl.listeners.push(['visibilitychange', onVisibility, undefined, doc])
  }

  // --------------------------------------------------------------- show/hide
  function show(why) {
    if (ctl.mode !== 'idle' || !ctl.settings.enabled) return false
    const previewing = why === 'preview'
    if (!preview && !previewing && environmentBlocksPlate()) return false
    ctl.mode = 'mounting'
    let handle = null
    try {
      handle = mountOverlay(ctl.settings, {
        target: target || undefined,
        preview,
        startPointer: ctl.lastPointer,
        onExit(reason) {
          ctl.overlay = null
          ctl.mode = 'idle'
          ctl.previewing = false
          // The dismissed plate must not reappear on the very next tick.
          ctl.lastInput = nowMs()
          note('closed:' + reason)
        },
      })
    } catch (err) {
      ctl.mode = 'idle'
      ctl.lastError = err && err.message
      // WebGL can be lost transiently (GPU reset, driver update). Back off, do
      // not spin: a failed mount every 250ms would pin a core.
      ctl.cooldownUntil = nowMs() + 60000
      note('mount-failed')
      return false
    }
    ctl.overlay = handle
    ctl.mountCount += 1
    ctl.mode = 'showing'
    ctl.previewing = previewing
    note('shown:' + (why || 'idle'))
    if (preview) {
      const p = queryParams()
      const freeze = p.get('freeze')
      if (freeze) {
        const parts = String(freeze).split(':')
        handle.debug.freezeAt(parts[0], Number(parts[1]) || 0)
      } else if (p.get('pause') === '1') {
        handle.debug.pauseRaf()
      }
    }
    return true
  }

  function hide(why) {
    if (ctl.overlay) {
      ctl.overlay.dismiss(why || 'api')
      return true
    }
    return false
  }

  // -------------------------------------------------------------------- busy
  function setBusy(value) {
    const next = value === true
    if (ctl.busy !== next) note('busy:' + next)
    ctl.busy = next
    // 只在「有效忙碌」时收画面：测试里 forcedBusy=false 要能压过宿主的 busy=true。
    // 设置页的「立刻看一眼」是用户当着你的面点的，别被后台任务顺手收掉。
    if (ctl.mode === 'showing' && !ctl.previewing && busyNow()) hide('busy')
  }

  /** Called by the app-mode poller with the raw `/state.json` payload. */
  function feedState(data) {
    if (!data || typeof data !== 'object') return
    ctl.lastState = data
    if (data.enabled === false && ctl.settings.enabled) {
      ctl.settings.enabled = false
      note('disabled-by-host')
      if (ctl.mode === 'showing') hide('disabled')
    }
    setBusy(data.busy === true)
  }

  // -------------------------------------------------------------------- tick
  function tick() {
    const blocked = environmentBlocksPlate()
    if (ctl.mode === 'showing') {
      // Fullscreen, an open modal or a playing video wins over a screensaver —
      // except for an explicit "show me" from the settings page: the user is
      // looking at the plate on purpose, and the settings panel is a modal.
      if (ctl.previewing) return
      if (blocked) hide('env:' + blocked)
      return
    }
    if (ctl.mode !== 'idle') return
    if (!ctl.settings.enabled) return
    if (blocked) return
    if (doc.visibilityState !== 'visible') return
    const t = nowMs()
    if (t < ctl.cooldownUntil) return
    if (t - ctl.lastInput < idleMs()) return
    if (busyNow()) return
    show('idle')
  }

  // ------------------------------------------------------------------- start
  function start() {
    if (ctl.started) return ctl
    ctl.started = true
    ctl.lastInput = nowMs()
    attachInput()
    ctl.timers.push(win.setInterval(tick, 250))
    note('started')
    return ctl
  }

  function stop() {
    if (!ctl.started) return
    ctl.started = false
    hide('stop')
    for (const id of ctl.timers) { try { win.clearInterval(id) } catch (e) {} }
    ctl.timers = []
    for (const [type, fn, options, host] of ctl.listeners) {
      try { (host || win).removeEventListener(type, fn, options) } catch (e) {}
    }
    ctl.listeners = []
    note('stopped')
  }

  // ---------------------------------------------------------------- settings
  /**
   * 设置页保存后推过来的新参数。
   *
   * 这里不做夹紧（宿主已经夹过一遍、并且那份值是写盘的权威），只保证类型别把
   * 渲染循环带崩：数字拿不到就保留旧值，文案缺省成空串（空串=用默认提示语）。
   */
  function coerceSetting(key, value, fallback) {
    if (key === 'enabled') return value === true || value === 'true'
    if (key === 'dismissOnMove') return value === true || value === 'true'
    if (key === 'promptText') return String(value == null ? '' : value).slice(0, 80)
    const n = Number(value)
    return Number.isFinite(n) ? n : fallback
  }

  function applySettings(patch) {
    if (!patch || typeof patch !== 'object') return settings
    for (const key of SETTING_KEYS) {
      if (!(key in patch)) continue
      settings[key] = coerceSetting(key, patch[key], settings[key])
    }
    if (!settings.enabled && ctl.mode === 'showing') hide('disabled')
    note('settings:updated')
    return settings
  }

  /** 设置页的「立刻看一眼」：绕过 idle/busy 门禁，但仍是一块真实的板子。 */
  function previewPlate() {
    if (ctl.mode !== 'idle') return false
    const wasEnabled = settings.enabled
    settings.enabled = true
    const ok = show('preview')
    settings.enabled = wasEnabled
    return ok
  }

  function snapshot() {
    return {
      version: VERSION,
      mode: ctl.mode,
      enabled: ctl.settings.enabled,
      busy: ctl.busy,
      effectiveBusy: busyNow(),
      holds: [...ctl.holds],
      blocked: environmentBlocksPlate(),
      zIndex: ctl.overlay ? ctl.overlay.rootEl.style.zIndex : null,
      dismissOnMove: ctl.settings.dismissOnMove === true,
      forcedBusy: ctl.forcedBusy,
      idleMs: idleMs(),
      idleFor: Math.round(nowMs() - ctl.lastInput),
      pollMs: ctl.settings.pollMs,
      mountCount: ctl.mountCount,
      fetchErrors: ctl.fetchErrors,
      cooldownMs: Math.max(0, Math.round(ctl.cooldownUntil - nowMs())),
      overlay: ctl.overlay ? ctl.overlay.debug.info() : null,
      lastState: ctl.lastState,
      lastError: ctl.lastError,
      log: ctl.log.slice(-12),
      at: Date.now(),
    }
  }

  const controller = {
    settings,
    start,
    stop,
    show: (why) => show(why),
    hide: (why) => hide(why),
    dismiss: (why) => hide(why),
    setBusy,
    feedState,
    applySettings,
    preview: previewPlate,
    hold,
    release,
    isShowing: () => ctl.mode === 'showing',
    setIdleMs(ms) {
      ctl.idleOverride = Number.isFinite(Number(ms)) && Number(ms) >= 0 ? Number(ms) : null
      note('idle-ms:' + String(ctl.idleOverride))
      return idleMs()
    },
    setIdle(idle) { ctl.lastInput = nowMs(); void idle; return ctl.lastInput },
    snapshot,
    debug() { return ctl.overlay ? ctl.overlay.debug : null },
    raw: ctl,
  }
  return controller
}

/* =========================================================================
 * Boot
 * ====================================================================== */

async function loadSettings() {
  try {
    const res = await fetch(ROUTE + '/settings.json', { cache: 'no-store' })
    if (!res.ok) return { ...DEFAULTS }
    const parsed = await res.json()
    return { ...DEFAULTS, ...(parsed || {}) }
  } catch (err) {
    return { ...DEFAULTS }
  }
}

/**
 * URL overrides for verification. Kept behind `?idle-crt-test=1` so a stray
 * bookmark can never shorten the real 10 minute timeout by accident.
 */
function testOverrides() {
  const test = {}
  const p = queryParams()
  if (p.get('idle-crt-test') !== '1') return test
  const idle = Number(p.get('idle'))
  if (Number.isFinite(idle) && idle >= 0) test.idleMs = idle
  const busy = p.get('busy')
  if (busy === '0' || busy === '1') test.busy = busy === '1'
  return test
}

async function bootApp() {
  if (channel.controller) return
  const settings = await loadSettings()
  if (settings.enabled === false) {
    channel.state = 'disabled'
    try { console.log('[dsh-idle-crt] disabled by settings') } catch (e) {}
    return
  }
  const controller = createIdleController({ settings, test: testOverrides() })
  controller.start()

  // Busy feed: the host tracks running agents and publishes one boolean.
  async function refresh() {
    try {
      const res = await fetch(ROUTE + '/state.json?_=' + Date.now(), { cache: 'no-store' })
      if (!res.ok) throw new Error('HTTP ' + res.status)
      const data = await res.json()
      controller.raw.fetchErrors = 0
      controller.feedState(data)
      if (!controller.raw.feedTimer) {
        controller.raw.feedTimer = win.setInterval(refresh, controller.settings.pollMs)
      }
    } catch (err) {
      controller.raw.fetchErrors += 1
      if (controller.raw.fetchErrors === 1) {
        try { console.warn('[dsh-idle-crt] busy feed unavailable:', err && err.message) } catch (e) {}
      }
      if (!controller.raw.feedTimer) {
        controller.raw.feedTimer = win.setInterval(refresh, Math.max(5000, controller.settings.pollMs))
      }
    }
  }
  refresh()

  channel.controller = controller
  channel.state = 'idle'
  channel.snapshot = () => controller.snapshot()
  channel.show = (why) => controller.show(why || 'api')
  channel.hide = (why) => controller.hide(why || 'api')
  channel.setBusy = (value) => { controller.raw.forcedBusy = value === null || value === undefined ? null : value === true }
  channel.setIdleMs = (ms) => controller.setIdleMs(ms)
  channel.activity = () => controller.setIdle(true)
  // 设置页（走 dsh.client 的 React 模块）与本脚本是两条通道，靠这个全局对象见面。
  channel.applySettings = (patch) => controller.applySettings(patch)
  channel.preview = () => controller.preview()
  // 给别的插件的对接点：hold('video') 期间绝不盖板，release('video') 解除。
  channel.hold = (reason) => controller.hold(reason)
  channel.release = (reason) => controller.release(reason)
  channel.isShowing = () => controller.isShowing()
  channel.debug = {
    overlay: () => (controller.raw.overlay ? controller.raw.overlay.debug : null),
    info: () => controller.snapshot(),
    settings: () => controller.settings,
  }
  try { console.log('[dsh-idle-crt] controller ready (idle ' + controller.settings.idleMs + 'ms)') } catch (e) {}
}

function bootPreview() {
  channel.state = 'preview'
  channel.settings = DEFAULTS
  channel.mountPlate = (cfg, options) => mountOverlay(
    { ...DEFAULTS, ...(win.__DSH_IDLE_CRT_PREVIEW__ || {}), ...(cfg || {}) },
    { preview: true, ...(options || {}) },
  )
  channel.createIdleController = createIdleController
}

if (!PREVIEW && channel.state !== 'preview') {
  bootApp().catch((err) => {
    channel.state = 'failed'
    try { console.warn('[dsh-idle-crt] failed:', err && err.message) } catch (e) {}
  })
} else if (PREVIEW) {
  bootPreview()
}

/* =========================================================================
 * Grafted animation core (kept byte-identical from the splash plugin)
 * ====================================================================== */

  function wipeAt(ms, wipeStartMs, wipeMs, wipeHoldMs) {
    const local = ms - wipeStartMs
    if (local < 0) {
      return { active: false, holding: false, pass: 0, u: 0, flip: 0, edge: 0, threshold: () => -Infinity }
    }
    const span = wipeMs + wipeHoldMs
    const period = span * 2
    const cycle = Math.floor(local / period)
    const r = local - cycle * period
    let pass, flip, u, holding = false
    if (r < wipeMs) {
      pass = cycle * 2
      flip = 0
      u = r / wipeMs
    } else if (r < span) {
      pass = cycle * 2
      flip = 0
      u = 1
      holding = true
    } else if (r < span + wipeMs) {
      pass = cycle * 2 + 1
      flip = 1
      u = (r - span) / wipeMs
    } else {
      pass = cycle * 2 + 1
      flip = 1
      u = 1
      holding = true
    }
    return {
      active: true,
      holding,
      pass,
      u,
      flip,
      // Fade the boundary glow out at both extremes: otherwise the 2% overshoot
      // parks a static cyan smear in a corner (most visible during the hold).
      edge: smoothstep(0, 0.045, Math.min(u, 1 - u)),
      // iso space: x is aspect-corrected, so the boundary runs at 45 degrees on
      // screen and x + y spans [-aspect - 1, aspect + 1]. A 2% overshoot on both
      // ends guarantees "nothing swept" / "everything swept".
      threshold(aspect) {
        const rad = aspect + 1
        return -rad * 1.02 + u * rad * 2.04
      },
    }
  }

/* =========================================================================
 * CRT composite pass (raw WebGL)
 * ====================================================================== */

/**
 * The whole browser half used to pull in Three.js (~480 KiB) to draw ONE
 * full-screen quad, because the second screen needed a real scene graph. That
 * screen is gone, so this is the same fragment shader on plain WebGL: same
 * pipeline, ~30x smaller bundle.
 */
function createCrtPass(canvas, preserveDrawingBuffer) {
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

/* =========================================================================
 * Screen 1: CRT lettering
 * ====================================================================== */

/**
 * Tube warm-up: a fast rise with flicker, then a permanent steady glow with a
 * faint breathing flicker. There is no self-fade any more - the plate stays lit
 * until the user dismisses it (only the exit fade dims it).
 */

/* =========================================================================
 * Screen 1: CRT lettering
 * ====================================================================== */

/**
 * Tube warm-up: a fast rise with flicker, then a permanent steady glow with a
 * faint breathing flicker. There is no self-fade any more - the plate stays lit
 * until the user dismisses it (only the exit fade dims it).
 */
function bootLevel(ms, total) {
  const t = clamp(ms / Math.max(1, total), 0, 1)
  if (t >= 1) return { level: 1 + Math.sin(ms * 0.011) * 0.012, flicker: 0.05 }
  return {
    level: clamp(Math.pow(t, 0.35) + (Math.random() - 0.5) * 0.12 * (1 - t), 0, 1.4),
    flicker: 1 - t,
  }
}

/** Letter-spaced text: canvas letterSpacing is not portable, so space it by hand. */
function drawSpaced(ctx, text, cx, y, spacing) {
  let width = 0
  for (const ch of text) width += ctx.measureText(ch).width + spacing
  width -= spacing
  let x = cx - width / 2
  ctx.textAlign = 'left'
  for (const ch of text) {
    ctx.fillText(ch, x, y)
    x += ctx.measureText(ch).width + spacing
  }
}

// Paint the static part of the plate (TUI row, both words, glow rings, voids)
// once. Wobble / flicker / level are applied when this layer is composited.
function paintWords(ctx, W, H) {
  const size = Math.min(W * 0.155, H * 0.22)
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, W, H)
  ctx.globalCompositeOperation = 'source-over'
  ctx.globalAlpha = 1
  ctx.save()
  ctx.translate(W / 2, H / 2)

  const word = (text, y, fill, glow, px) => {
    ctx.font = `900 ${px}px "Impact","Haettenschweiler","Arial Black",system-ui,sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    for (const [spread, alpha] of [[0.30, 0.10], [0.18, 0.16], [0.09, 0.26], [0.04, 0.42]]) {
      ctx.shadowColor = glow
      ctx.shadowBlur = px * spread
      ctx.globalAlpha = alpha
      ctx.fillStyle = fill
      ctx.fillText(text, 0, y)
    }
    ctx.shadowBlur = 0
    ctx.globalAlpha = 1
    ctx.fillStyle = '#ffffff'
    ctx.fillText(text, 0, y)
    ctx.save()
    ctx.globalCompositeOperation = 'destination-out'
    ctx.globalAlpha = 0.22
    const step = Math.max(2, Math.round(px * 0.055))
    for (let yy = -px * 0.8; yy < px * 0.8; yy += step) {
      ctx.fillRect(-W * 0.5, y + yy, W, Math.max(1, Math.round(step * 0.34)))
    }
    ctx.restore()
  }

  // small top command line, imitating a TUI start row
  ctx.font = `${Math.round(size * 0.17)}px "Cascadia Mono","JetBrains Mono",Consolas,monospace`
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = 'rgba(150,190,255,0.62)'
  ctx.shadowColor = 'rgba(90,150,255,0.9)'
  ctx.shadowBlur = size * 0.10
  ctx.globalAlpha = 0.75
  ctx.fillText('> dsh web --idle-crt --profile desktop', -size * 2.52, -size * 0.86)
  ctx.globalAlpha = 1
  ctx.shadowBlur = 0

  word('DEEPSEEK', -size * 0.30, '#ffffff', 'rgba(255,255,255,0.95)', size * 0.86)
  word('HARNESS', size * 0.36, '#2f6bff', 'rgba(70,145,255,0.98)', size * 0.86)
  ctx.restore()
}

// Bottom prompt + rule, painted at full strength; the blink and fade-in are
// applied as a whole-layer alpha when compositing.
function paintPrompt(ctx, W, H, cfg) {
  const size = Math.min(W * 0.155, H * 0.22)
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, W, H)
  ctx.globalCompositeOperation = 'source-over'
  const px = Math.max(12, Math.round(size * 0.185))
  const y = H - Math.max(30, H * 0.085)
  ctx.save()
  ctx.font = `600 ${px}px "Cascadia Mono","JetBrains Mono",Consolas,monospace`
  ctx.textBaseline = 'middle'
  ctx.globalAlpha = 1
  ctx.fillStyle = '#e8f1ff'
  ctx.shadowColor = 'rgba(90,150,255,0.95)'
  ctx.shadowBlur = px * 0.85
  drawSpaced(ctx, cfg.promptText || 'PRESS ANY KEY TO CONTINUE', W / 2, y, px * 0.30)
  ctx.shadowBlur = 0
  const ruleW = Math.min(W * 0.5, px * 19)
  ctx.globalAlpha = 0.42
  ctx.fillStyle = '#5f86c8'
  ctx.fillRect(W / 2 - ruleW / 2, y + px * 0.95, ruleW, Math.max(1, Math.round(px * 0.06)))
  ctx.restore()
}

function drawScreen1(ctx, W, H, state, opts) {
  const ms = opts.ms
  const { level, flicker } = opts.boot
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.globalCompositeOperation = 'source-over'
  ctx.globalAlpha = 1
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, W, H)
  if (level <= 0.001) return

  const cx = W / 2
  const cy = H / 2
  const size = Math.min(W * 0.155, H * 0.22)
  ctx.save()
  ctx.translate(cx, cy)
  ctx.globalAlpha = clamp(level, 0, 1)

  const wobble = Math.sin(ms * 0.0032) * size * 0.012
  ctx.translate(wobble, Math.sin(ms * 0.0021) * size * 0.006)

  // small top command line, imitating a TUI start row
  ctx.font = `${Math.round(size * 0.17)}px "Cascadia Mono","JetBrains Mono",Consolas,monospace`
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = 'rgba(150,190,255,0.62)'
  ctx.shadowColor = 'rgba(90,150,255,0.9)'
  ctx.shadowBlur = size * 0.10
  ctx.globalAlpha = clamp(level * 0.75, 0, 1)
  ctx.fillText('> dsh web --idle-crt --profile desktop', -size * 2.52, -size * 0.86)
  ctx.globalAlpha = clamp(level, 0, 1)
  ctx.shadowBlur = 0

  const flick = flicker > 0 ? 1 - Math.random() * flicker * 0.22 : 1
  const word = (text, y, fill, glow, px) => {
    ctx.font = `900 ${px}px "Impact","Haettenschweiler","Arial Black",system-ui,sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    // phosphor bleed: stacked rings from outside in
    for (const [spread, alpha] of [[0.30, 0.10], [0.18, 0.16], [0.09, 0.26], [0.04, 0.42]]) {
      ctx.shadowColor = glow
      ctx.shadowBlur = px * spread
      ctx.globalAlpha = clamp(level * alpha * flick, 0, 1)
      ctx.fillStyle = fill
      ctx.fillText(text, 0, y)
    }
    ctx.shadowBlur = 0
    // bright core
    ctx.globalAlpha = clamp(level * flick, 0, 1)
    ctx.fillStyle = '#ffffff'
    ctx.fillText(text, 0, y)
    // scanline voids punched through the glyph faces
    ctx.save()
    ctx.globalCompositeOperation = 'destination-out'
    ctx.globalAlpha = 0.22
    const step = Math.max(2, Math.round(px * 0.055))
    for (let yy = -px * 0.8; yy < px * 0.8; yy += step) {
      ctx.fillRect(-W * 0.5, y + yy, W, Math.max(1, Math.round(step * 0.34)))
    }
    ctx.restore()
  }
  word('DEEPSEEK', -size * 0.30, '#ffffff', 'rgba(255,255,255,0.95)', size * 0.86)
  word('HARNESS', size * 0.36, '#2f6bff', 'rgba(70,145,255,0.98)', size * 0.86)
  ctx.restore()

  // ---------------------------------------------------------------- bottom prompt
  // Drawn straight on the plate (not as DOM), so it picks up the scanlines, the
  // barrel warp and the inversion wipe along with everything else.
  const appear = smoothstep(opts.bootMs * 0.55, opts.bootMs * 0.98, ms)
  if (appear > 0.001) {
    const blink = 0.55 + 0.45 * Math.sin(ms * 0.0062)
    const px = Math.max(12, Math.round(size * 0.185))
    const y = H - Math.max(30, H * 0.085)
    ctx.save()
    ctx.font = `600 ${px}px "Cascadia Mono","JetBrains Mono",Consolas,monospace`
    ctx.textBaseline = 'middle'
    ctx.globalAlpha = clamp(appear * (0.34 + 0.66 * blink) * clamp(level, 0, 1), 0, 1)
    ctx.fillStyle = '#e8f1ff'
    ctx.shadowColor = 'rgba(90,150,255,0.95)'
    ctx.shadowBlur = px * 0.85
    drawSpaced(ctx, opts.promptText || 'PRESS ANY KEY TO CONTINUE', W / 2, y, px * 0.30)
    ctx.shadowBlur = 0
    // a thin rule under it, the way a TUI frames a prompt
    const ruleW = Math.min(W * 0.5, px * 19)
    ctx.globalAlpha = clamp(appear * (0.18 + 0.30 * blink) * clamp(level, 0, 1), 0, 1)
    ctx.fillStyle = '#5f86c8'
    ctx.fillRect(W / 2 - ruleW / 2, y + px * 0.95, ruleW, Math.max(1, Math.round(px * 0.06)))
    ctx.restore()
  }
}

/* =========================================================================
 * Helpers
 * ====================================================================== */

/* =========================================================================
 * Helpers
 * ====================================================================== */
function clamp(v, a, b) { return v < a ? a : v > b ? b : v }
/** Finite number or `fallback` - never NaN (see the config parsing in run()). */
function num(v, fallback) {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}
function smoothstep(a, b, x) {
  const t = clamp((x - a) / (b - a || 1), 0, 1)
  return t * t * (3 - 2 * t)
}
