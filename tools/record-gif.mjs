/**
 * Record one full colour-inversion cycle of the idle plate, frame by frame.
 *
 * Runs on the preview harness, where the WebGL context is created with
 * preserveDrawingBuffer, so each element screenshot really contains the rendered
 * frame. The plate is parked on an exact millisecond of its timeline for every
 * capture (window.__DSH_IDLE_CRT_PLATE__.poseAt), which is deterministic and free
 * of tearing.
 *
 *   node tools/preview-server.mjs 8791      # in another shell
 *   node tools/record-gif.mjs [previewBase] [outDir]
 *
 * Frames land in _frames/ as 0000.png …; tools/gif-encode.py turns them into a GIF.
 */
import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'

const require = createRequire('C:/Users/yza9022/.dsh/profiles/desktop/package.json')
const { chromium } = require('playwright')

const BASE = process.argv[2] || 'http://127.0.0.1:8791'
const OUT = process.argv[3] || 'G:/DSH/dsh-idle-crt/_frames'

const FPS = 12.5
const STEP = Math.round(1000 / FPS)
const START_MS = 4000 // wipeStartMs: the first white sweep begins here
const CYCLE_MS = 2 * (14000 + 5000) // white sweep + hold, then black sweep + hold
const FRAMES = Math.round(CYCLE_MS / STEP)

fs.rmSync(OUT, { recursive: true, force: true })
fs.mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
})
const ctx = await browser.newContext({ viewport: { width: 960, height: 540 }, deviceScaleFactor: 1 })
const page = await ctx.newPage()
await page.goto(`${BASE}/tools/preview.html?preview=1`, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => !!window.__DSH_IDLE_CRT_PLATE__, null, { timeout: 45000 })
await page.evaluate(() => {
  const bar = document.getElementById('bar')
  if (bar) bar.style.display = 'none'
})
await page.waitForTimeout(400)

const canvas = page.locator('[data-dsh-idle-crt-root] canvas').first()
const t0 = Date.now()
for (let i = 0; i < FRAMES; i += 1) {
  const ms = START_MS + i * STEP
  await page.evaluate((m) => window.__DSH_IDLE_CRT_PLATE__.poseAt(m), ms)
  await canvas.screenshot({ path: path.join(OUT, String(i).padStart(4, '0') + '.png') })
  if (i % 60 === 0) console.log(`frame ${i}/${FRAMES} (${Date.now() - t0} ms)`)
}
console.log(`done: ${FRAMES} frames @ ${FPS} fps in ${Date.now() - t0} ms -> ${OUT}`)
await browser.close()
