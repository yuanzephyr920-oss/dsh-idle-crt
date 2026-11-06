/**
 * 兼容性验证：和别的「外观/动画」插件共存时该怎样。
 *   node tools/verify-compat.mjs [baseUrl]
 *
 * 覆盖：
 *   1. 别的插件在 body 上挂了一层更高的 fixed HUD → 板子自己爬到它上面
 *   2. 弹出一个 aria-modal 对话框 → 板子让位；关掉对话框 → 板子回来
 *   3. 有视频在播 → 板子让位
 *   4. 宿主页把 window.__DSH_IDLE_CRT_SUPPRESS__ 置真 → 板子不出来
 *   5. 板子盖着时 <html data-dsh-idle-crt="active">，收掉后清掉
 */
import { createRequire } from 'node:module'
const require = createRequire('C:/Users/yza9022/.dsh/profiles/desktop/package.json')
const { chromium } = require('playwright')

const base = process.argv[2] || 'http://127.0.0.1:4195'
let failures = 0
const check = (name, ok, detail) => {
  if (!ok) failures += 1
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? ' · ' + detail : ''))
}

const auth = await (await fetch(base + '/dsh-idle-crt/auth-url.json')).json()
if (!auth.ok) { console.log('[auth] failed', JSON.stringify(auth)); process.exit(2) }

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
await page.goto(auth.url, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(400)
await page.goto(base + '/?idle-crt-test=1&idle=1800&busy=0', { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => !!(window.__DSH_IDLE_CRT__ && window.__DSH_IDLE_CRT__.controller), null, { timeout: 20000 })

const hasRoot = () => page.evaluate(() => !!document.querySelector('[data-dsh-idle-crt-root]'))
const waitRoot = (want, timeout = 20000) => page.waitForFunction(
  (w) => !!document.querySelector('[data-dsh-idle-crt-root]') === w, want, { timeout },
)

await waitRoot(true)
check('plate showed', true)
check('marker set while covered', (await page.evaluate(() => document.documentElement.getAttribute('data-dsh-idle-crt'))) === 'active')

// 1. a rival HUD mounts above the old floor
await page.evaluate(() => {
  const hud = document.createElement('div')
  hud.id = 'rival-hud'
  Object.assign(hud.style, {
    position: 'fixed', inset: '0', zIndex: '2147483400', pointerEvents: 'none',
    background: 'linear-gradient(transparent, rgba(255,0,0,.08))',
  })
  hud.textContent = ''
  document.body.appendChild(hud)
})
await page.waitForTimeout(2200)
const z = await page.evaluate(() => {
  const plate = document.querySelector('[data-dsh-idle-crt-root]')
  const hud = document.getElementById('rival-hud')
  return { plate: plate ? Number(getComputedStyle(plate).zIndex) : null, hud: hud ? Number(getComputedStyle(hud).zIndex) : null }
})
check('plate climbs above a rival fixed HUD', z.plate !== null && z.hud !== null && z.plate > z.hud, JSON.stringify(z))

// 2. a modal dialog wins
await page.evaluate(() => {
  const dlg = document.createElement('div')
  dlg.id = 'rival-modal'
  dlg.setAttribute('role', 'dialog')
  dlg.setAttribute('aria-modal', 'true')
  Object.assign(dlg.style, { position: 'fixed', left: '500px', top: '300px', width: '300px', height: '200px', zIndex: '2147483500', background: '#222' })
  document.body.appendChild(dlg)
})
await waitRoot(false)
check('open modal dialog makes the plate step aside', true)
await page.evaluate(() => document.getElementById('rival-modal').remove())
await waitRoot(true)
check('closing the dialog lets it come back', true)

// 3. a small decorative loop (a pet / mascot) must NOT count as content
await page.evaluate(() => {
  const v = document.createElement('video')
  v.id = 'rival-pet'
  v.muted = true
  Object.defineProperty(v, 'paused', { value: false, configurable: true })
  Object.defineProperty(v, 'ended', { value: false, configurable: true })
  Object.defineProperty(v, 'readyState', { value: 4, configurable: true })
  Object.assign(v.style, { position: 'fixed', left: '900px', top: '520px', width: '440px', height: '248px', zIndex: '5' })
  document.body.appendChild(v)
})
await page.waitForTimeout(3000)
check('a small muted pet video does NOT block the plate', (await hasRoot()) === true)
await page.evaluate(() => document.getElementById('rival-pet').remove())

// 3b. a content-sized video wins
await page.evaluate(() => {
  const v = document.createElement('video')
  v.id = 'rival-video'
  v.width = 1000
  v.height = 700
  Object.defineProperty(v, 'paused', { value: false, configurable: true })
  Object.defineProperty(v, 'ended', { value: false, configurable: true })
  Object.defineProperty(v, 'readyState', { value: 4, configurable: true })
  Object.assign(v.style, { position: 'fixed', left: '40px', top: '40px', width: '1000px', height: '700px', zIndex: '10' })
  document.body.appendChild(v)
})
await waitRoot(false)
check('a playing video makes the plate step aside', true)
await page.evaluate(() => document.getElementById('rival-video').remove())
await waitRoot(true)
check('stopping the video lets it come back', true)

// 4. host-level opt-out
await page.evaluate(() => { window.__DSH_IDLE_CRT_SUPPRESS__ = true })
const blocked = await page.waitForFunction(() => {
  const c = window.__DSH_IDLE_CRT__ && window.__DSH_IDLE_CRT__.controller
  return !!(c && !document.querySelector('[data-dsh-idle-crt-root]'))
}, null, { timeout: 8000 }).then(() => true).catch(() => false)
check('__DSH_IDLE_CRT_SUPPRESS__ keeps the plate away', blocked)
await page.evaluate(() => { window.__DSH_IDLE_CRT_SUPPRESS__ = false })
await waitRoot(true)
check('clearing the opt-out lets it come back', true)

// 5. marker bookkeeping
await page.mouse.click(720, 460)
await waitRoot(false)
const marker = await page.evaluate(() => document.documentElement.getAttribute('data-dsh-idle-crt'))
check('marker cleared with the plate', marker === null, 'attr=' + marker)

await page.evaluate(() => document.getElementById('rival-hud').remove())
await browser.close()
console.log(failures ? 'FAILURES: ' + failures : 'ALL CHECKS PASSED')
process.exit(failures ? 1 : 0)
