/**
 * End-to-end check against the real DSH GUI (http://127.0.0.1:4195).
 *
 *   node tools/verify-gui.mjs [baseUrl]
 *
 * The idle threshold is shortened with ?idle-crt-test=1&idle=2500 (a stray
 * bookmark cannot do this by accident: the flag is required).
 */
import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'

const require = createRequire('C:/Users/yza9022/.dsh/profiles/desktop/package.json')
const { chromium } = require('playwright')

const OUT = path.resolve('_shots')
fs.mkdirSync(OUT, { recursive: true })

const base = process.argv[2] || 'http://127.0.0.1:4195'
// 桌面版 GUI 有启动 Cookie 认证：先向插件要一条带 token 的 URL，
// 用它把 Cookie 种进这个浏览器环境，再访问带测试参数的页面。
const authRes = await fetch(base + '/dsh-idle-crt/auth-url.json').catch((err) => {
  console.log('[auth] fetch failed:', err.message)
  return null
})
const auth = authRes ? await authRes.json() : null
if (!auth || !auth.ok || !auth.url) {
  console.log('[auth] cannot obtain an authenticated URL:', JSON.stringify(auth))
  process.exit(2)
}
const url = base + '/?idle-crt-test=1&idle=2500&busy=0'
let failures = 0
const check = (name, ok, detail) => {
  if (!ok) failures += 1
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? ' · ' + detail : ''))
}

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
})
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []
page.on('pageerror', (e) => { errors.push(e.message); console.log('[pageerror]', e.message) })
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') console.log('[page]', m.type(), m.text())
})

// 先用带 token 的 URL 建立会话；桌面端会种下启动 Cookie。
await page.goto(auth.url, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(600)
const cookies = await page.context().cookies()
console.log('[auth] cookies:', cookies.map((c) => c.name + '=' + c.value.slice(0, 12) + '…').join(' '))

await page.goto(url, { waitUntil: 'domcontentloaded' })
console.log('[nav] landed on', page.url())
await page.waitForFunction(() => !!(window.__DSH_IDLE_CRT__ && window.__DSH_IDLE_CRT__.controller), null, { timeout: 25000 })
// 真机上此刻正好有 agent 在跑，busy 会正确地压住待机画面；测试参数
// `busy=0` 走 forcedBusy，把「没活干」这一半单独拿出来验。
const ready = await page.evaluate(() => {
  const ch = window.__DSH_IDLE_CRT__
  const s = ch.snapshot()
  return { state: ch.state, idleMs: s.idleMs, forcedBusy: s.forcedBusy, mode: s.mode }
})
console.log('channel', JSON.stringify(ready))
check('browser half booted in the app', ready.state === 'idle' && ready.idleMs === 2500 && ready.forcedBusy === false,
  JSON.stringify(ready))
check('no page errors during boot', errors.length === 0, errors.join(' | '))

// ------------------------------------------------------------- appears by itself
await page.waitForFunction(() => {
  const ctl = window.__DSH_IDLE_CRT__ && window.__DSH_IDLE_CRT__.controller
  return !!(ctl && ctl.raw.overlay)
}, null, { timeout: 15000 })
await page.waitForTimeout(2600)
await page.screenshot({ path: path.join(OUT, 'gui-01-plate.png') })
const mounted = await page.evaluate(() => {
  const ctl = window.__DSH_IDLE_CRT__.controller
  const s = ctl.snapshot()
  const host = document.querySelector('[data-dsh-idle-crt-root]')
  return {
    mode: s.mode, idleMs: s.idleMs, idleFor: s.idleFor, hosted: !!host,
    zIndex: host ? getComputedStyle(host).zIndex : null,
    rect: host ? host.getBoundingClientRect().toJSON() : null,
    canvas: s.overlay ? s.overlay.canvas : null,
    lastError: s.lastError, log: s.log.slice(-8),
  }
})
check('plate appeared after the idle threshold', mounted.mode === 'showing' && mounted.hosted,
  JSON.stringify({ mode: mounted.mode, idleFor: mounted.idleFor, lastError: mounted.lastError, log: mounted.log }))
check('plate sits above the app', Number(mounted.zIndex) >= 2147483000, 'zIndex=' + mounted.zIndex)
check('plate fills the viewport', mounted.rect && mounted.rect.width >= 1400 && mounted.rect.height >= 880,
  JSON.stringify(mounted.rect))
const marked = await page.evaluate(() => document.documentElement.getAttribute('data-dsh-idle-crt'))
check('cooperative marker on <html> while covered', marked === 'active', 'attr=' + marked)

// ------------------------------------------------- moving the mouse must NOT dismiss
await page.mouse.move(720, 460)
await page.waitForTimeout(200)
await page.mouse.move(860, 520)
await page.waitForTimeout(1600)
const afterMove = await page.evaluate(() => {
  const ctl = window.__DSH_IDLE_CRT__.controller
  return { mode: ctl.snapshot().mode, hosted: !!document.querySelector('[data-dsh-idle-crt-root]') }
})
check('mouse move alone keeps the plate up', afterMove.mode === 'showing' && afterMove.hosted,
  JSON.stringify(afterMove))

// ------------------------------------------------------------- a click dismisses
await page.mouse.click(720, 460)
await page.waitForTimeout(1600)
await page.screenshot({ path: path.join(OUT, 'gui-02-after-input.png') })
const after = await page.evaluate(() => {
  const ctl = window.__DSH_IDLE_CRT__.controller
  return {
    mode: ctl.snapshot().mode,
    hosted: !!document.querySelector('[data-dsh-idle-crt-root]'),
    marked: document.documentElement.getAttribute('data-dsh-idle-crt'),
  }
})
check('click inside the window dismissed the plate', after.mode === 'idle' && after.hosted === false,
  JSON.stringify(after))
check('cooperative marker removed with the plate', after.marked === null, 'attr=' + after.marked)

// --------------------------------------------------- app still usable underneath
await page.evaluate(() => window.scrollTo(0, 0))
const appVisible = await page.evaluate(() => {
  const el = document.elementFromPoint(700, 450)
  return !!(el && !el.closest('[data-dsh-idle-crt-root]'))
})
check('app is usable again after dismissal', appVisible === true)
check('no page errors after a full cycle', errors.length === 0, errors.join(' | '))

await browser.close()
console.log(failures === 0 ? '\nALL CHECKS PASSED' : '\n' + failures + ' CHECK(S) FAILED')
process.exit(failures === 0 ? 0 : 1)
