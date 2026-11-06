// Frame-time benchmark for the idle-crt plate, via the preview harness.
// usage: node tools/diag-perf.mjs [port] [seconds]
import { createRequire } from 'node:module';
const require = createRequire('C:/Users/yza9022/.dsh/profiles/desktop/package.json');
const { chromium } = require('playwright');

const PORT = process.argv[2] || '8794';
const SECONDS = Number(process.argv[3] || 6);
const base = `http://127.0.0.1:${PORT}/tools/preview.html`;

const browser = await chromium.launch({
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(`${base}?idle=1&bare=1`, { waitUntil: 'load' });
await page.waitForSelector('[data-dsh-idle-crt-root]', { timeout: 30000 });
// let boot phase finish, then start sampling steady state
await page.waitForTimeout(2500);

const result = await page.evaluate(async (seconds) => {
  const deltas = [];
  let last = performance.now();
  await new Promise((resolve) => {
    const t0 = performance.now();
    function tick(now) {
      deltas.push(now - last);
      last = now;
      if (now - t0 < seconds * 1000) requestAnimationFrame(tick);
      else resolve();
    }
    requestAnimationFrame(tick);
  });
  const usable = deltas.slice(1).sort((a, b) => a - b);
  const q = (p) => usable[Math.min(usable.length - 1, Math.floor(p * usable.length))];
  const mean = usable.reduce((a, b) => a + b, 0) / usable.length;
  const over = (ms) => usable.filter((d) => d > ms).length;
  const info = window.__DSH_IDLE_CRT__ && window.__DSH_IDLE_CRT__.debug
    ? window.__DSH_IDLE_CRT__.debug.info()
    : null;
  const root = document.querySelector('[data-dsh-idle-crt-root]');
  return {
    frames: usable.length,
    mean: +mean.toFixed(2),
    p50: +q(0.5).toFixed(2),
    p90: +q(0.9).toFixed(2),
    p99: +q(0.99).toFixed(2),
    max: +usable[usable.length - 1].toFixed(2),
    over32: over(32),
    over50: over(50),
    resolution: root ? `${root.querySelector('canvas').width}x${root.querySelector('canvas').height}` : null,
    phase: info && info.phase,
    plateMs: info && info.plateMs,
  };
}, SECONDS);

console.log(JSON.stringify({ ...result, seconds: SECONDS, errors }, null, 1));
await browser.close();
