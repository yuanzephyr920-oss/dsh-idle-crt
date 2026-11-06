import { createRequire } from "node:module"
const require = createRequire("C:/Users/yza9022/.dsh/profiles/desktop/package.json")
const { chromium } = require("playwright")
const b = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] })
const p = await (await b.newContext({ viewport: { width: 960, height: 540 } })).newPage()
await p.goto("http://127.0.0.1:8791/tools/preview.html?idle=1&bare=1", { waitUntil: "domcontentloaded" })
await p.waitForFunction(() => window.__DSH_IDLE_CRT__ && window.__DSH_IDLE_CRT__.controller, null, { timeout: 20000 })
await p.evaluate(() => { const bar = document.getElementById("bar"); if (bar) bar.style.display = "none"; window.__DSH_IDLE_CRT__.controller.show("probe") })
await p.waitForFunction(() => window.__DSH_IDLE_CRT_PLATE__ && typeof window.__DSH_IDLE_CRT_PLATE__.poseAt === "function", null, { timeout: 10000 })
await p.waitForTimeout(1500)
const root = await p.$("[data-dsh-idle-crt-root]")
for (const [ms, name] of [[4000, "comment-idle"], [11040, "comment-sweep"]]) {
  await p.evaluate((t) => window.__DSH_IDLE_CRT_PLATE__.poseAt(t), ms)
  await p.waitForTimeout(200)
  await root.screenshot({ path: `G:/DSH/dsh-idle-crt/_shots/${name}.png` })
  console.log(name, "ok")
}
await b.close()

