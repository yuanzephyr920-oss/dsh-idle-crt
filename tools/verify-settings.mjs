import { createRequire } from 'node:module'
const require = createRequire('C:/Users/yza9022/.dsh/profiles/desktop/package.json')
const { chromium } = require('playwright')

const BASE = process.argv[2] || 'http://127.0.0.1:8793'
const SHOTS = 'G:/DSH/dsh-idle-crt/_shots'

const launchArgs = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
let failed = false
const check = (name, detail, ok) => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail === undefined ? '' : ' · ' + detail}`)
  if (!ok) failed = true
}

const browser = await chromium.launch({ args: launchArgs })
const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage()
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()) })

await page.goto(BASE + '/', { waitUntil: 'load' })
await page.waitForFunction(() => window.__harnessReady === true || window.__harnessError, null, { timeout: 8000 })
const boot = await page.evaluate(() => ({ ready: window.__harnessReady === true, error: window.__harnessError || null, harness: window.__harness || null }))
check('settings module mounts', JSON.stringify(boot.harness), boot.ready && !boot.error)
if (!boot.ready) {
  check('render', String(boot.error).slice(0, 400), false)
  await page.screenshot({ path: SHOTS + '/settings-error.png' })
  await browser.close()
  process.exit(1)
}

const text = await page.evaluate(() => document.getElementById('host').innerText)
for (const label of ['启用', '无操作', '淡入', '淡出', '预热', '反色扫掠', '扫描线', '提示', '保存']) {
  check('row ' + label, undefined, text.includes(label))
}
const rows = await page.evaluate(() => document.querySelectorAll('[class*="dic-row"]').length)
check('row count', rows, rows >= 8)

await page.screenshot({ path: SHOTS + '/settings-01-loaded.png', fullPage: true })

// Edit the idle threshold (minutes) and save.
const minuteInputs = page.locator('input[type="number"]')
const count = await minuteInputs.count()
check('number inputs', count, count >= 6)
await minuteInputs.first().fill('7')
await page.getByRole('button', { name: /保存/ }).click()
await page.waitForTimeout(600)
const saved = await page.evaluate(() => ({ applied: window.__harnessApplied || null, text: document.getElementById('host').innerText }))
check('save applied to plate bridge', JSON.stringify(saved.applied && saved.applied.idleMs), saved.applied && saved.applied.idleMs === 7 * 60 * 1000)
check('status line reports success', undefined, /已保存|已生效/.test(saved.text))

const persisted = await (await fetch(BASE + '/dsh-idle-crt/settings.json')).json()
check('POST persisted', JSON.stringify({ idleMs: persisted.idleMs, promptText: persisted.promptText }).slice(0, 120), persisted.idleMs === 7 * 60 * 1000)

// Rapid preset chip should set the field.
await page.getByRole('button', { name: '30 分' }).click().catch(() => {})
await page.waitForTimeout(200)
const afterPreset = await page.evaluate(() => document.querySelectorAll('input[type="number"]')[0].value)
check('preset chip', afterPreset, String(afterPreset) === '30')

await page.screenshot({ path: SHOTS + '/settings-02-saved.png', fullPage: true })
check('no page errors', errors.slice(0, 2).join(' | '), errors.length === 0)

await browser.close()
console.log(failed ? 'RESULT: FAILED' : 'RESULT: ALL CHECKS PASSED')
process.exit(failed ? 1 : 0)
