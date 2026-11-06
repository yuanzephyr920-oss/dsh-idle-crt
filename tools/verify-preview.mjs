/**
 * Headless check of the browser half, using the static preview page.
 *
 *   node tools/verify-preview.mjs [url]
 *
 * Runs the same lib/client.js the app loads, mounts the plate, probes pixels,
 * freezes a few known moments, then checks that a mouse move dismisses it and
 * that a busy host suppresses it entirely. Screenshots land in _shots/.
 */
import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'

const require = createRequire('C:/Users/yza9022/.dsh/profiles/desktop/package.json')
const { chromium } = require('playwright')

const OUT = path.resolve('_shots')
fs.mkdirSync(OUT, { recursive: true })

const base = process.argv[2] || 'http://127.0.0.1:8791/preview'
let failures = 0
const check = (name, ok, detail) => {
  if (!ok) failures += 1
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? ' · ' + detail : ''))
}

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
})
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
page.on('console', (m) => console.log('[page]', m.type(), m.text()))
page.on('pageerror', (e) => console.log('[pageerror]', e.message))

const plateState = () => page.evaluate(() => {
  const ch = window.__DSH_IDLE_CRT__
  const ctl = ch && ch.controller
  const root = document.querySelector('[data-dsh-idle-crt-root]')
  return {
    hasChannel: !!ch,
    mode: ctl ? ctl.snapshot().mode : null,
    hasOverlay: !!(ctl && ctl.raw.overlay),
    hasRoot: !!root,
    mountCount: ctl ? ctl.snapshot().mountCount : null,
    lastError: ctl ? ctl.snapshot().lastError : null,
  }
})

// ---------------------------------------------------------------- 1. it mounts
await page.goto(base + '?idle=1', { waitUntil: 'load' })
await page.waitForFunction(() => {
  const ctl = window.__DSH_IDLE_CRT__ && window.__DSH_IDLE_CRT__.controller
  return !!(ctl && ctl.raw.overlay)
}, null, { timeout: 20000 })
await page.waitForTimeout(2400) // let the warm-up ramp finish
await page.screenshot({ path: path.join(OUT, '01-warmup.png') })

const probe = await page.evaluate(() => {
  const ctl = window.__DSH_IDLE_CRT__.controller
  const d = ctl.debug()
  return { info: d.info(), probe: d.pixelProbe() }
})
console.log('phase', probe.info.phase, 't', probe.info.phaseT.toFixed(2), 'plateMs', probe.info.plateMs)
check('overlay mounted after idle threshold', (await plateState()).hasOverlay === true)
check('canvas has lit pixels', probe.probe.platformLitShare > 0.5,
  'lit=' + probe.probe.platformLitShare + '%')
check('white core present', (probe.probe.pixels.white || 0) > 0.2,
  'white=' + probe.probe.pixels.white + '% black=' + probe.probe.pixels.black + '%')

// --------------------------------------------------------------- 2. inverted wipe
async function freezeShot(ms, name) {
  await page.evaluate((t) => {
    const d = window.__DSH_IDLE_CRT__.controller.debug()
    d.freezeAt('screen1', t)
  }, ms)
  await page.waitForTimeout(420)
  await page.screenshot({ path: path.join(OUT, name) })
  return page.evaluate(() => window.__DSH_IDLE_CRT__.controller.debug().pixelProbe())
}

const boot = 1400
const span = 14000
const hold = 5000
const fullWhite = await freezeShot((boot + 400 + span + 200) / 1000, '02-full-white.png')
check('full-white inversion', (fullWhite.pixels.white || 0) > 80, 'white=' + fullWhite.pixels.white + '%')
const fullBlack = await freezeShot((boot + 400 + (span + hold) * 2 - 1500) / 1000, '03-full-black.png')
check('full-black inversion', (fullBlack.pixels.black || 0) > 80, 'black=' + fullBlack.pixels.black + '%')
await freezeShot((boot + 400 + span + 100) / 1000, '04-white-hold.png')

// ------------------------------------------- 3. move keeps it, a click dismisses
await page.evaluate(() => {
  const d = window.__DSH_IDLE_CRT__.controller.debug()
  d.resume()
})
await page.waitForTimeout(120)
const box = await page.evaluate(() => {
  const el = document.querySelector('[data-dsh-idle-crt-root]')
  return el ? el.getBoundingClientRect().toJSON() : null
})
check('plate covers the viewport', box && box.width >= 1440 && box.height >= 900, JSON.stringify(box))
await page.mouse.move(700, 450)
await page.waitForTimeout(80)
await page.mouse.move(860, 520)
await page.waitForTimeout(1500) // longer than fadeOutMs: a move must not start the fade
const stillUp = await plateState()
check('mouse move alone keeps the plate up', stillUp.hasRoot === true, JSON.stringify(stillUp))
await page.mouse.click(720, 460)
await page.waitForTimeout(1600) // fadeOutMs 600 + teardown
await page.screenshot({ path: path.join(OUT, '05-after-input.png') })
const after = await plateState()
check('click dismissed the plate', after.hasOverlay === false && after.hasRoot === false,
  JSON.stringify(after))

// ------------------------------------------------------- 4. busy suppresses it
const busyPage = await browser.newPage({ viewport: { width: 1440, height: 900 } })
busyPage.on('pageerror', (e) => console.log('[busy pageerror]', e.message))
await busyPage.goto(base + '?idle=1', { waitUntil: 'load' })
await busyPage.waitForFunction(() => !!(window.__DSH_IDLE_CRT__ && window.__DSH_IDLE_CRT__.controller), null, { timeout: 20000 })
await busyPage.evaluate(() => window.__DSH_IDLE_CRT__.controller.setBusy(true))
await busyPage.waitForTimeout(5000)
const busy = await busyPage.evaluate(() => {
  const ctl = window.__DSH_IDLE_CRT__.controller
  const s = ctl.snapshot()
  return { mode: s.mode, hasOverlay: !!ctl.raw.overlay, idleFor: s.idleFor, busy: s.effectiveBusy }
})
check('busy host keeps the plate away', busy.hasOverlay === false && busy.busy === true && busy.idleFor > 2000,
  JSON.stringify(busy))
await busyPage.screenshot({ path: path.join(OUT, '06-busy-no-plate.png') })
await busyPage.evaluate(() => window.__DSH_IDLE_CRT__.controller.setBusy(false))
await busyPage.waitForTimeout(1200)
const resume = await busyPage.evaluate(() => !!(window.__DSH_IDLE_CRT__.controller.raw.overlay))
check('plate appears once busy clears', resume === true)

await browser.close()
console.log(failures === 0 ? '\nALL CHECKS PASSED' : '\n' + failures + ' CHECK(S) FAILED')
process.exit(failures === 0 ? 0 : 1)
