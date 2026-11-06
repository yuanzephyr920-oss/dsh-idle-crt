/**
 * Frame-time probe that reports the WebGL renderer it got, so "GPU or not" is
 * never a guess. Tries the real GPU (D3D11 via ANGLE) and falls back to the
 * software rasteriser.
 *
 *   node tools/diag-perf-gpu.mjs [port]
 */
import { createRequire } from 'node:module'

const require = createRequire('C:/Users/yza9022/.dsh/profiles/desktop/package.json')
const { chromium } = require('playwright')

const PORT = process.argv[2] || '8791'
const MODE = process.argv[3] || 'gpu'
const args = MODE === 'gpu'
  ? ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader']
  : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']

const browser = await chromium.launch({ args })
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
await page.goto(`http://127.0.0.1:${PORT}/tools/preview.html?idle=1&bare=1`, { waitUntil: 'load' })
await page.waitForFunction(() => !!document.querySelector('[data-dsh-idle-crt-root]'), null, { timeout: 20000 })
await page.waitForTimeout(2500)

const report = await page.evaluate(async () => {
  const gl = document.querySelector('[data-dsh-idle-crt-root] canvas').getContext('webgl2')
    || document.querySelector('[data-dsh-idle-crt-root] canvas').getContext('webgl')
  const dbg = gl && gl.getExtension('WEBGL_debug_renderer_info')
  const renderer = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : (gl ? gl.getParameter(gl.RENDERER) : 'none')
  const times = []
  let last = performance.now()
  const start = last
  return await new Promise((resolve) => {
    function tick(now) {
      times.push(now - last)
      last = now
      if (now - start < 6000) requestAnimationFrame(tick)
      else {
        times.sort((a, b) => a - b)
        const sum = times.reduce((a, b) => a + b, 0)
        resolve({
          renderer,
          frames: times.length,
          mean: +(sum / times.length).toFixed(1),
          p50: +times[Math.floor(times.length * 0.5)].toFixed(1),
          p99: +times[Math.floor(times.length * 0.99)].toFixed(1),
        })
      }
    }
    requestAnimationFrame(tick)
  })
})
console.log(JSON.stringify(report))
await browser.close()
