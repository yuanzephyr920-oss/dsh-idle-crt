/**
 * Frame-time sample of the live plate (real GUI, real host).
 *
 *   node tools/diag-perf-live.mjs [base]
 */
import { createRequire } from 'node:module'

const require = createRequire('C:/Users/yza9022/.dsh/profiles/desktop/package.json')
const { chromium } = require('playwright')

const BASE = process.argv[2] || 'http://127.0.0.1:3644'
const auth = await fetch(BASE + '/dsh-idle-crt/auth-url.json').then((r) => r.json())
const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
})
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await ctx.newPage()
await page.goto(auth.url, { waitUntil: 'domcontentloaded' })
await page.waitForSelector('[aria-label="账号菜单"]', { timeout: 45000 })
await page.goto(`${BASE}/?idle-crt-test=1&idle=800&busy=0`, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => !!document.querySelector('[data-dsh-idle-crt-root]'), null, { timeout: 30000 })
await page.waitForTimeout(2500)

const stats = await page.evaluate(
  () =>
    new Promise((resolve) => {
      const samples = []
      let last = performance.now()
      const t0 = last
      const step = (now) => {
        samples.push(now - last)
        last = now
        if (now - t0 < 6000) requestAnimationFrame(step)
        else {
          const s = samples.slice(3).sort((a, b) => a - b)
          const mean = s.reduce((a, b) => a + b, 0) / s.length
          const pick = (q) => s[Math.min(s.length - 1, Math.floor(s.length * q))]
          resolve({
            frames: samples.length,
            mean: +mean.toFixed(1),
            p50: +pick(0.5).toFixed(1),
            p90: +pick(0.9).toFixed(1),
            p99: +pick(0.99).toFixed(1),
            over32: s.filter((v) => v > 32).length
          })
        }
      }
      requestAnimationFrame(step)
    })
)
console.log('live', JSON.stringify(stats))
const info = await page.evaluate(() => (window.__DSH_IDLE_CRT__ && window.__DSH_IDLE_CRT__.debug ? window.__DSH_IDLE_CRT__.debug.info && window.__DSH_IDLE_CRT__.debug.info() : null))
console.log('info', JSON.stringify(info))
await browser.close()
