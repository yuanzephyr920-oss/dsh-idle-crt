/**
 * 循环验证：出现 → 按键盘消失 → 再空闲后又出现（mountCount=2）→ 鼠标晃不消失 →
 * 点一下才消失 → 用 hold() 让别的插件压住屏保 → release() 放行。
 *   node tools/verify-cycle.mjs [baseUrl]
 *
 * 淡出是跟着 rAF 走的（0.6s 理论值；刚挂上时首帧偏重，实测可到 ~1.5s），
 * 所以这里等「根节点消失」而不是等固定时长。
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
await page.goto(base + '/?idle-crt-test=1&idle=2500&busy=0', { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => !!(window.__DSH_IDLE_CRT__ && window.__DSH_IDLE_CRT__.controller), null, { timeout: 20000 })

const state = () => page.evaluate(() => window.__DSH_IDLE_CRT__.snapshot())
const hasRoot = () => page.evaluate(() => !!document.querySelector('[data-dsh-idle-crt-root]'))
const waitRoot = (want) => page.waitForFunction(
  (w) => !!document.querySelector('[data-dsh-idle-crt-root]') === w, want, { timeout: 15000 },
)

await waitRoot(true)
check('first plate showed', true)

await page.keyboard.press('a')
await waitRoot(false)
const s1 = await state()
check('keyboard dismissed it', s1.mode === 'idle' && s1.log.some((r) => r.kind === 'closed:fade'),
  JSON.stringify({ mode: s1.mode, mountCount: s1.mountCount, log: s1.log.slice(0, 4).map((r) => r.kind) }))

await waitRoot(true)
const s2 = await state()
check('plate returned after another idle window', s2.mountCount >= 2, JSON.stringify({ mode: s2.mode, mountCount: s2.mountCount }))

// 鼠标移动：只算「有人在」，不负责收掉画面
await page.mouse.move(700, 450)
await page.waitForTimeout(120)
await page.mouse.move(860, 520)
await page.waitForTimeout(1500)
check('mouse move does NOT dismiss', (await hasRoot()) === true, JSON.stringify(await state().then((s) => ({ mode: s.mode }))))

// 滚轮：锁住页面滚动，但也不收画面
await page.mouse.wheel(0, 600)
await page.waitForTimeout(600)
check('wheel does NOT dismiss', (await hasRoot()) === true)

// 点击：收掉
await page.mouse.click(760, 500)
await waitRoot(false)
check('click inside the window dismissed it', (await state()).mode === 'idle')

// hold/release：别的插件压住屏保的正式接口
await waitRoot(true)
await page.evaluate(() => window.__DSH_IDLE_CRT__.hold('verify-cycle'))
await waitRoot(false)
check('hold() from another plugin dismisses and blocks', (await hasRoot()) === false)
await page.waitForTimeout(3200)
check('plate stays away while held', (await hasRoot()) === false)
await page.evaluate(() => window.__DSH_IDLE_CRT__.release('verify-cycle'))
await waitRoot(true)
check('release() lets it come back', (await hasRoot()) === true)

await browser.close()
console.log(failures ? 'FAILURES: ' + failures : 'ALL CHECKS PASSED')
process.exit(failures ? 1 : 0)
