/**
 * 反向验证：宿主说「有活干」时，即使空闲阈值已过，画面也不能出现。
 *   node tools/verify-busy.mjs [baseUrl]
 * 假定此刻确实有 agent 在跑（交互中运行本脚本即成立）。
 */
import { createRequire } from 'node:module'
const require = createRequire('C:/Users/yza9022/.dsh/profiles/desktop/package.json')
const { chromium } = require('playwright')
const base = process.argv[2] || 'http://127.0.0.1:4195'

const state = await (await fetch(base + '/dsh-idle-crt/state.json')).json()
if (!state.busy) {
  console.log('[skip] host reports idle; run this while a turn is in flight')
  process.exit(0)
}

const auth = await (await fetch(base + '/dsh-idle-crt/auth-url.json')).json()
if (!auth.ok) { console.log('[auth] failed', JSON.stringify(auth)); process.exit(2) }

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
await page.goto(auth.url, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(500)
await page.goto(base + '/?idle-crt-test=1&idle=800', { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => !!(window.__DSH_IDLE_CRT__ && window.__DSH_IDLE_CRT__.controller), null, { timeout: 20000 })
await page.waitForTimeout(6000)
const snap = await page.evaluate(() => window.__DSH_IDLE_CRT__.snapshot())
const host = await page.evaluate(() => !!document.querySelector('[data-dsh-idle-crt-root]'))
const ok = snap.mode === 'idle' && snap.effectiveBusy === true && !host && snap.idleFor > 3000
console.log((ok ? 'PASS' : 'FAIL') + ' busy host keeps the plate away · ' + JSON.stringify({
  mode: snap.mode, effectiveBusy: snap.effectiveBusy, idleFor: snap.idleFor, hosted: host, mountCount: snap.mountCount,
}))
await page.screenshot({ path: '_shots/gui-03-busy.png' })
await browser.close()
process.exit(ok ? 0 : 1)
