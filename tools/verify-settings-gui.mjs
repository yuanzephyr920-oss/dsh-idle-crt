// Real-GUI verification for the dsh-idle-crt settings page.
//
// Usage: node tools/verify-settings-gui.mjs [baseUrl]
//   baseUrl defaults to http://127.0.0.1:8801 (the isolated test instance).
//
// The DSH web app is launch-cookie authenticated, so the script asks the plugin's
// own loopback route for an authenticated URL, loads that once to receive the
// signed cookie, and only then navigates the real app.

import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'

const require = createRequire('C:/Users/yza9022/.dsh/profiles/desktop/package.json')
const { chromium } = require('playwright')

const BASE = (process.argv[2] || 'http://127.0.0.1:8801').replace(/\/$/, '')
const SHOTS = path.resolve(process.cwd(), '_shots')
const SETTINGS_FILE = process.env.DSH_HOME
  ? path.join(process.env.DSH_HOME, 'idle-crt.settings.json')
  : 'C:/Users/yza9022/.dsh/idle-crt.settings.json'

const results = []
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail === undefined ? '' : ' · ' + (typeof detail === 'string' ? detail : JSON.stringify(detail))}`)
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function dismissWelcome(page) {
  const cont = page.getByRole('button', { name: '继续' })
  if (await cont.count()) {
    await cont.first().click({ force: true }).catch(() => {})
    await sleep(400)
  }
  await page.keyboard.press('Escape').catch(() => {})
  await sleep(250)
}

async function openSettings(page) {
  // The settings dialog lives in the account menu ("账号菜单", bottom-left).
  const opened = await page.evaluate(() => {
    const el = document.querySelector('[aria-label="账号菜单"]')
    if (!el) return false
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    return true
  })
  if (!opened) return false
  await sleep(500)
  const item = page.getByText('设置', { exact: true }).last()
  if (!(await item.count())) return false
  await item.click({ force: true }).catch(async () => {
    await page.evaluate(() => {
      const el = [...document.querySelectorAll('*')].find(
        (n) => n.children.length === 0 && (n.textContent || '').trim() === '设置',
      )
      if (el) el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    })
  })
  await sleep(700)
  return true
}

async function main() {
  fs.mkdirSync(SHOTS, { recursive: true })
  const auth = await (await fetch(`${BASE}/dsh-idle-crt/auth-url.json`)).json()
  if (!auth.ok) throw new Error(`auth-url failed: ${JSON.stringify(auth)}`)

  const browser = await chromium.launch()
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  const pageErrors = []
  page.on('pageerror', (e) => pageErrors.push(String(e)))

  // 1. mint the launch cookie, then the app loads for real
  await page.goto(auth.url)
  // Other appearance plugins may show their own boot splash first; wait for the
  // shell to be interactive instead of assuming a fixed boot time.
  await page.waitForSelector('[aria-label="账号菜单"]', { timeout: 30000 })
  await sleep(1200)
  check('launch cookie accepted', (await context.cookies()).some((c) => /^dsh-auth-/.test(c.name)))

  // 2. the client module must be in the boot graph (package.json declared dsh.client at boot)
  const boot = await page.evaluate(() => ({
    hasBoot: !!window.__DSH_BOOT__,
    mine: (window.__DSH_BOOT__?.entries || []).filter((e) => /idle-crt/.test(e.id)).map((e) => e.id),
    style: !!document.querySelector('style[data-plugin-css="dsh-idle-crt/settings.css"]'),
    channel: !!window.__DSH_IDLE_CRT__,
  }))
  check('client module in boot graph', boot.mine.length === 1, boot.mine)
  check('settings page applied (css injected)', boot.style)
  check('plate channel present', boot.channel)

  // 3. open 设置 from the account menu
  await dismissWelcome(page)
  check('settings dialog opened', await openSettings(page))
  await page.screenshot({ path: path.join(SHOTS, 'settings-gui-00-open.png') })

  // 4. our section shows up in the settings navigation
  const navHit = page.getByText('待机屏保', { exact: true })
  const hasNav = await navHit.first().waitFor({ timeout: 10000 }).then(() => true).catch(() => false)
  check('settings nav lists 待机屏保', hasNav)
  if (hasNav) {
    await navHit.first().click({ force: true })
    await sleep(700)
  }
  const bodyText = await page.evaluate(() => document.body.innerText)
  check('section heading rendered', /待机显像管/.test(bodyText))
  check('row 无操作多久之后出现', /无操作多久之后出现/.test(bodyText))
  check('row 鼠标移动也能收掉', /鼠标移动也能收掉/.test(bodyText))
  check('row 扫描线强度', /扫描线强度/.test(bodyText))
  check('row 底部提示语', /底部提示语/.test(bodyText))
  const badge = await page.evaluate(() => {
    const m = document.body.innerText.match(/空闲计时中|画面正开着|有任务在跑|待机脚本未就绪/)
    return m ? m[0] : null
  })
  check('live badge rendered', !!badge, badge)
  await page.screenshot({ path: path.join(SHOTS, 'settings-gui-01-page.png') })

  // 5. edit the idle threshold, save, expect both the live plate and the file to follow
  //    (scope every control to our own section: other plugins mount number inputs too)
  const section = page.locator('.dic-section').first()
  const minutes = section.locator('input[type="number"]').first()
  await minutes.fill('3')
  await minutes.dispatchEvent('change')
  await sleep(200)
  const save = page.getByRole('button', { name: '保存' }).first()
  await save.click({ force: true })
  await sleep(1200)
  const afterSave = await page.evaluate(() => ({
    status: (document.body.innerText.match(/已保存[^\n]*|保存失败[^\n]*/) || [null])[0],
    idleMs: window.__DSH_IDLE_CRT__?.snapshot?.()?.idleMs ?? null,
  }))
  check('save status shown', !!afterSave.status, afterSave.status)
  check('live controller took the new threshold', afterSave.idleMs === 180000, afterSave.idleMs)
  let persisted = null
  try {
    persisted = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'))
  } catch (e) {
    persisted = { readError: String(e) }
  }
  check('settings persisted to disk', persisted.idleMs === 180000, {
    file: SETTINGS_FILE,
    idleMs: persisted.idleMs,
  })
  await page.screenshot({ path: path.join(SHOTS, 'settings-gui-02-saved.png') })

  // 6. 立刻看一眼 paints the plate over the live app; any key takes it away
  const preview = page.getByRole('button', { name: '立刻看一眼' }).first()
  await preview.click({ force: true })
  await page.waitForTimeout(1400)
  const plateUp = await page.evaluate(() => {
    const root = document.querySelector('[data-dsh-idle-crt-root]')
    return { up: !!root, z: root ? getComputedStyle(root).zIndex : null, snap: window.__DSH_IDLE_CRT__?.snapshot?.()?.overlay?.phase ?? null }
  })
  check('立刻看一眼 paints the plate', plateUp.up, plateUp)
  await page.screenshot({ path: path.join(SHOTS, 'settings-gui-03-preview.png') })
  await page.keyboard.press('Escape')
  await page.waitForTimeout(1800)
  const plateGone = await page.evaluate(() => !document.querySelector('[data-dsh-idle-crt-root]'))
  check('key press dismisses the plate', plateGone)

  // 7. restore defaults through the page so the test leaves no residue
  const reset = page.getByRole('button', { name: '恢复默认' }).first()
  if (await reset.count()) {
    await reset.click({ force: true }).catch(() => {})
    await sleep(400)
    const save2 = page.getByRole('button', { name: '保存' }).first()
    await save2.click({ force: true }).catch(() => {})
    await sleep(900)
  }
  let restored = null
  try {
    restored = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'))
  } catch {}
  check('defaults restored on disk', restored && restored.idleMs === 600000, restored?.idleMs)

  check('no page errors', pageErrors.length === 0, pageErrors.slice(0, 3))

  await browser.close()
  const failed = results.filter((r) => !r.ok)
  console.log(`\n${failed.length === 0 ? 'ALL CHECKS PASSED' : `${failed.length} CHECK(S) FAILED`} (${results.length} checks)`)
  if (failed.length) process.exit(1)
}

main().catch((e) => {
  console.error('FAILED', e)
  process.exit(1)
})
