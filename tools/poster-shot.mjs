import { createRequire } from "node:module"
const require = createRequire("C:/Users/yza9022/.dsh/profiles/desktop/package.json")
const { chromium } = require("playwright")
const b = await chromium.launch({ args: ["--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader"] })

// 1) hero still from the live plate (bare preview page, frozen at 4.2 s)
const ctx1 = await b.newContext({ viewport: { width: 1600, height: 900 } })
const p1 = await ctx1.newPage()
await p1.goto("http://127.0.0.1:8791/tools/preview.html?idle=1&bare=1", { waitUntil: "domcontentloaded" })
await p1.waitForFunction(() => window.__DSH_IDLE_CRT__?.controller, null, { timeout: 20000 })
await p1.evaluate(() => window.__DSH_IDLE_CRT__.controller.show("poster"))
await p1.waitForTimeout(1500)
await p1.waitForFunction(() => typeof window.__DSH_IDLE_CRT_PLATE__?.poseAt === "function", null, { timeout: 8000 })
await p1.evaluate(() => window.__DSH_IDLE_CRT_PLATE__.poseAt(2600))
await p1.waitForTimeout(250)
const root = await p1.$("[data-dsh-idle-crt-root]")
await root.screenshot({ path: "G:/DSH/dsh-idle-crt/docs/poster-hero.png" })
await p1.evaluate(() => window.__DSH_IDLE_CRT_PLATE__.poseAt(11000))
await p1.waitForTimeout(250)
await root.screenshot({ path: "G:/DSH/dsh-idle-crt/docs/poster-sweep-full.png" })
console.log("hero ok")

// 2) poster itself
const ctx2 = await b.newContext({ viewport: { width: 1080, height: 1620 }, deviceScaleFactor: 2 })
const p2 = await ctx2.newPage()
await p2.goto("file:///G:/DSH/dsh-idle-crt/docs/poster.html", { waitUntil: "networkidle" })
await p2.evaluate(() => document.fonts.ready)
await p2.waitForTimeout(400)
await p2.screenshot({ path: "G:/DSH/dsh-idle-crt/docs/poster.png" })
console.log("poster ok")
await b.close()



