/**
 * dsh-idle-crt —— 宿主半区（Node）
 * ---------------------------------------------------------------------------
 * 一个「待机显像管」插件：DSH 没有活干、且超过十分钟没人动鼠标键盘时，页面盖
 * 上一块 CRT 板（辉光字 + 循环反色扫掠），一动就消失。
 *
 * 宿主半区负责三件事：
 *   1. 经 `webserver/index-inject` 注册一条**内联 script 行**，让页面侧自举加载
 *      浏览器半区（加载失败由页面侧自己吞掉，绝不让宿主因为本插件起不来）；
 *   2. 用 `webServer` 提供静态资源路由：客户端脚本、设置 JSON、**忙碌状态 JSON**；
 *   3. 跟踪「有没有活干」：监听 `agent/status` 与 `api-session/status` 两个事件，
 *      维护一个「正在运行的 session」集合，`/dsh-idle-crt/state.json` 只下发一个
 *      `busy` 布尔（外加调试用的明细）。
 *
 * 为什么忙状态要宿主侧算：浏览器半区是自举脚本，拿不到客户端服务（ctx.sessions
 * 之类）也读不到 agent 的 status 字段（`Agent` 接口只有 id）；而宿主侧这两个
 * 事件就是 DSH 自己的「一个 Agent 开工/收工」信号，最可靠。
 *
 * 浏览器半区里有两样东西：
 *   · 待机画面本体（`lib/plate.js`）——需要一块盖住整页、完全接管指针事件的自挂载
 *     浮层，走的是本插件自己的 `<script>` 自举（`webserver/index-inject`），
 *     不经过 `dsh.client` 客户端模块注册表（那条通道是给 React 槽位组件用的）；
 *   · 设置页（`lib/client.js`）——一块普通的 React 槽位组件，挂在
 *     `settings.section` 上，走 `dsh.client` 客户端模块注册表。
 * 两者用页面全局 `window.__DSH_IDLE_CRT__` 通信：设置页保存后把新参数直接推给
 * 正在跑的控制器，不用刷新页面。
 *
 * 设置的持久化落在 `$DSH_HOME/idle-crt.settings.json`（不写 profile：
 * 那不是本插件该动的地方），`/dsh-idle-crt/settings.json` 的 GET 读它、
 * POST 写它，loader 里 `cordis.patch.yml` 的 config 只作为出厂默认值。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'

const VERSION = '0.2.0'

/**
 * schemastery 由宿主（DSH 运行时）提供，但**必须自己找到它**。
 *
 * 本插件在 profile 里是一条 `link:` 依赖，真实路径可能落在 DSH 安装树之外
 * （Windows 盘符 / WSL 的 /mnt/d、或任意工作区目录），此时 Node 从插件目录
 * 逐级向上找 node_modules 根本看不到 `@deepseek-ai/*`。
 *
 * 旧实现在解析失败时把 `Config` 降级成普通默认值对象，而 cordis 的
 * `resolveConfig()` 只认 Standard Schema：
 *   if (!runtime.Config) return config
 *   runtime.Config['~standard'].validate(config)   // ← 普通对象在这里炸
 * 于是激活阶段直接抛
 *   TypeError: Cannot read properties of undefined (reading 'validate')
 * 插件整条 entry 不激活（`1 entry did not activate`）。
 *
 * 现在按「离运行时最近」的顺序尝试多个解析基准，并且**每个候选都做 ~standard
 * 自检**；全都拿不到时宁可不导出 Config（cordis 会跳过校验，apply() 里已有
 * DEFAULTS 兜底），也绝不再导出一个会让宿主崩溃的假 Config。
 */
const SCHEMA_BASES = [
  // ① 宿主 dsh 入口所在的安装树 —— 与运行时同一份 schemastery，首选
  (() => {
    const entry = process.argv?.[1]
    return entry && path.isAbsolute(entry) ? pathToFileURL(entry).href : null
  })(),
  // ② 插件自身的解析链（插件目录里装了依赖，或被装进 DSH 安装树时）
  import.meta.url,
  // ③ profile 目录（profile 的 node_modules 里有依赖时）
  process.env.DSH_PROFILE_DIR
    ? pathToFileURL(path.join(process.env.DSH_PROFILE_DIR, 'package.json')).href
    : null,
]

function loadSchemastery() {
  for (const base of SCHEMA_BASES) {
    if (!base) continue
    try {
      const loaded = createRequire(base)('@deepseek-ai/schemastery')
      const lib = loaded?.default ?? loaded
      if (typeof lib?.object !== 'function') continue
      // 只接受 cordis resolveConfig 能消费的实例（Standard Schema 接口）
      if (typeof lib.object({})?.['~standard']?.validate !== 'function') continue
      return lib
    } catch (err) {
      // 换下一个候选
    }
  }
  return null
}

const z = loadSchemastery()

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
/**
 * 待机画面本体（自举脚本拉的那个文件）。
 *
 * 注意它不叫 `lib/client.js`：`lib/client.js` 是 `dsh.client` 客户端模块（设置页），
 * 由宿主 Loader 直接扫描 import，两者是两条完全不同的通道。
 */
const PLATE_BUNDLE = path.join(PACKAGE_ROOT, 'lib', 'plate.js')
const ROUTE = '/dsh-idle-crt'

/**
 * 用户改过的参数落在这里。故意放在 DSH_HOME 而不是 profile 目录：
 * profile 是宿主管的东西，插件不该往里写文件；而这份设置跟着用户走，
 * 换 profile、重装插件都还在。
 */
const SETTINGS_FILE = path.join(
  process.env.DSH_HOME || path.join(process.env.USERPROFILE || process.env.HOME || '.', '.dsh'),
  'idle-crt.settings.json',
)

const MIME = {
  '.json': 'application/json; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
}

/**
 * 页面侧自举行（内联 script 行）：自己建 <script> 拉 /dsh-idle-crt/client.js。
 *
 * 和开屏版不同，这里**不藏页面、不自动播放**——待机画面只在浏览器半区判定
 * 「空闲够久且没有活干」之后才挂上来，页面加载时不该有任何遮挡。
 *
 * 从 lib/bootstrap.js 读模板而不是把脚本内联成模板字符串：脚本本身可读可校验，
 * 且装载时就做一次语法自检——推一段坏脚本给页面比不注入更糟。
 */
const BOOTSTRAP_ROW_TEXT = (() => {
  const file = path.join(PACKAGE_ROOT, 'lib', 'bootstrap.js')
  let text = ''
  try {
    text = fs.readFileSync(file, 'utf8')
  } catch (err) {
    console.warn('[dsh-idle-crt] bootstrap.js missing:', err && err.message)
    return null
  }
  const script = text.split('@@ROUTE@@').join(ROUTE).split('@@VERSION@@').join(VERSION)
  // 语法自检：宁可不注入，也不能把一段坏脚本推给页面
  try {
    // eslint-disable-next-line no-new-func
    new Function(script)
  } catch (err) {
    console.warn('[dsh-idle-crt] bootstrap.js failed syntax check:', err && err.message)
    return null
  }
  return script
})()

export const name = 'dsh-idle-crt'

/** 默认配置；schemastery 不可用时由 apply() 直接合并它（见文件开头说明）。 */
const DEFAULTS = {
  enabled: true,
  idleMs: 600000,
  pollMs: 1500,
  fadeInMs: 320,
  fadeOutMs: 600,
  bootMs: 1400,
  wipeStartMs: 4000,
  wipeMs: 14000,
  wipeHoldMs: 5000,
  scanlineIntensity: 1,
  promptText: 'PRESS ANY KEY TO CONTINUE',
  // 默认只有「点击」和「键盘」能收掉屏保；鼠标晃动不算（见 README 的兼容性一节）。
  dismissOnMove: false,
}

/**
 * 只在拿到真正的 Standard Schema 时才导出 Config。
 * cordis 的 resolveConfig 只认 Standard Schema：导出普通对象会崩在
 * `['~standard'].validate` 上，整条 entry 起不来；而少一层校验、apply() 里
 * 仍有 DEFAULTS 兜底。两害相权，宁可不导出 Config。
 */
const ConfigSchema = z
  ? z.object({
      enabled: z.boolean().default(true).description('是否启用待机画面'),
      idleMs: z.number().min(0).default(600000)
        .description('无操作多久之后出现待机画面（毫秒）；默认 10 分钟'),
      pollMs: z.number().min(500).default(1500)
        .description('浏览器半区轮询「有没有活干」的间隔（毫秒）'),
      fadeInMs: z.number().min(0).default(320).description('画面淡入时长（毫秒）'),
      fadeOutMs: z.number().min(100).default(600).description('一动就消失：淡出时长（毫秒）'),
      bootMs: z.number().min(400).default(1400).description('显像管点亮（灯丝预热）时长（毫秒）'),
      wipeStartMs: z.number().min(0).default(4000)
        .description('画面出现后多久开始反色扫掠（毫秒）'),
      wipeMs: z.number().min(800).default(14000)
        .description('反色分界线扫过整屏一程的时长（毫秒）；白/黑交替，如此循环'),
      wipeHoldMs: z.number().min(0).default(5000)
        .description('每一程扫完之后停留多久，分界线才再次出现（毫秒）；全白与复原成黑各停一次'),
      scanlineIntensity: z.number().min(0).max(2).default(1).description('扫描线强度倍率'),
      promptText: z.string().default('PRESS ANY KEY TO CONTINUE')
        .description('画面底部提示语；留空则用默认文案'),
      dismissOnMove: z.boolean().default(false)
        .description('鼠标移动也收掉画面（默认关：只有窗口内点击和键盘输入才收）'),
    })
  : null

export const Config =
  ConfigSchema && typeof ConfigSchema['~standard']?.validate === 'function'
    ? ConfigSchema
    : undefined

/**
 * 设置页允许改的键，以及各自的夹紧规则。
 * 页面传来什么都要先过这一关：写盘的东西必须永远是一份合法配置，
 * 否则下次启动读取时就是一个坏掉的插件。
 */
const SETTING_KEYS = [
  'enabled', 'idleMs', 'pollMs', 'fadeInMs', 'fadeOutMs', 'bootMs',
  'wipeStartMs', 'wipeMs', 'wipeHoldMs', 'scanlineIntensity', 'promptText',
  'dismissOnMove',
]

function clampNum(value, min, max, fallback) {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

/** 把任意输入压成「只含已知键、值都合法」的一份设置。 */
function normalizeSettings(input) {
  const out = {}
  if (!input || typeof input !== 'object') return out
  if ('enabled' in input) out.enabled = input.enabled === true || input.enabled === 'true'
  if ('idleMs' in input) {
    out.idleMs = Math.round(clampNum(input.idleMs, 0, 24 * 60 * 60 * 1000, DEFAULTS.idleMs))
  }
  if ('pollMs' in input) out.pollMs = Math.round(clampNum(input.pollMs, 250, 60000, DEFAULTS.pollMs))
  if ('fadeInMs' in input) out.fadeInMs = Math.round(clampNum(input.fadeInMs, 0, 5000, DEFAULTS.fadeInMs))
  if ('fadeOutMs' in input) out.fadeOutMs = Math.round(clampNum(input.fadeOutMs, 100, 5000, DEFAULTS.fadeOutMs))
  if ('bootMs' in input) out.bootMs = Math.round(clampNum(input.bootMs, 400, 10000, DEFAULTS.bootMs))
  if ('wipeStartMs' in input) {
    out.wipeStartMs = Math.round(clampNum(input.wipeStartMs, 0, 10 * 60 * 1000, DEFAULTS.wipeStartMs))
  }
  if ('wipeMs' in input) out.wipeMs = Math.round(clampNum(input.wipeMs, 800, 5 * 60 * 1000, DEFAULTS.wipeMs))
  if ('wipeHoldMs' in input) {
    out.wipeHoldMs = Math.round(clampNum(input.wipeHoldMs, 0, 5 * 60 * 1000, DEFAULTS.wipeHoldMs))
  }
  if ('scanlineIntensity' in input) {
    out.scanlineIntensity = clampNum(input.scanlineIntensity, 0, 2, DEFAULTS.scanlineIntensity)
  }
  if ('promptText' in input)
    out.promptText = String(input.promptText == null ? '' : input.promptText).slice(0, 80)
  if ('dismissOnMove' in input) {
    out.dismissOnMove = input.dismissOnMove === true || input.dismissOnMove === 'true'
  }
  return out
}

/** 读用户改过的参数；文件不存在 / 坏掉都退回空对象（= 用默认值），绝不抛。 */
function readPersistedSettings() {
  try {
    return normalizeSettings(JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')))
  } catch (err) {
    if (err && err.code !== 'ENOENT') {
      console.warn('[dsh-idle-crt] settings file unreadable, falling back:', err && err.message)
    }
    return {}
  }
}

/** 写盘：只写已知键，格式稳定，供用户自己看/改也认得。 */
function writePersistedSettings(settings) {
  const data = {}
  for (const key of SETTING_KEYS) data[key] = settings[key]
  fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true })
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(data, null, 2) + '\n', 'utf8')
}

/** 状态事件的历史只留这么多条（调试用，别撑爆内存）。 */
const HISTORY_MAX = 40
const HISTORY_SERVE = 20

export function apply(root, config = {}) {
  const settings = { ...DEFAULTS, ...config, ...readPersistedSettings() }

  // 正在运行的 session。「有活干」= 这个集合非空。
  const running = new Set()
  /** 开工时刻，用来在 state.json 里给出 running for 多久。 */
  const since = new Map()
  /** 最近的状态翻转，排查「明明在跑却不认为在忙」时看这里。 */
  const history = []
  /** 原始事件样本：事件签名和宿主版本对不上时，靠它看真长什么样。 */
  const raw = []
const diagReports = []
  /** 热挂载时 agents.list() 到底给了什么，也留一份。 */
  let probeInfo = null
  /** 观测到的最后一次事件时刻（用于判断事件通道本身是否还活着）。 */
  let lastEventAt = 0

  /** 把任意事件参数压成可读的一行，不记录内容、只记录形状。 */
  function describe(value) {
    try {
      if (value === null || value === undefined) return String(value)
      if (typeof value !== 'object') return typeof value + ':' + String(value).slice(0, 40)
      const keys = Object.keys(value).slice(0, 12)
      const id = typeof value.id === 'string' ? value.id : undefined
      return { type: 'object', keys, id }
    } catch (err) {
      return '<undescribable>'
    }
  }

  function pushRaw(name, args) {
    try {
      raw.push({ at: Date.now(), name, args: args.map(describe) })
      if (raw.length > 30) raw.splice(0, raw.length - 30)
    } catch (err) {}
  }

  function record(sessionId, isRunning, source) {
    if (typeof sessionId !== 'string' || !sessionId) return
    const wasRunning = running.has(sessionId)
    const now = Date.now()
    if (isRunning) {
      if (!since.has(sessionId)) since.set(sessionId, now)
      running.add(sessionId)
    } else {
      running.delete(sessionId)
      since.delete(sessionId)
    }
    if (wasRunning !== running.has(sessionId)) {
      lastEventAt = now
      history.push({ at: now, id: sessionId, running: running.has(sessionId), source })
      if (history.length > HISTORY_MAX) history.splice(0, history.length - HISTORY_MAX)
    }
  }

  const busySnapshot = () => {
    const now = Date.now()
    const sessions = [...running]
    return {
      busy: sessions.length > 0,
      runningSessions: sessions,
      runningSince: sessions.map((id) => ({ id, since: since.get(id) || null, ms: since.has(id) ? now - since.get(id) : null })),
      lastEventAt: lastEventAt || null,
      idleMs: settings.idleMs,
      enabled: settings.enabled !== false,
      version: VERSION,
      serverTime: now,
    }
  }

  // ① 忙碌状态：宿主自己的「开工/收工」信号。
  //    agent/status    (payload {agent, status}) —— agent 循环的 idle <-> running
  //    api-session/status (sessionId, running)   —— API session 的运行状态
  //    两者都听、都写同一个集合：幂等，漏一个也不至于误判。
  root.effect(() => root.on('agent/status', (...args) => {
    try {
      pushRaw('agent/status', args)
      // 签名写的是 (payload: { agent, status })：先按这个读。
      // 但事件分发常把 agent 单独传进来，所以第二个参数也当 status 读。
      const first = args[0]
      const id = first && first.agent && first.agent.id
        ? first.agent.id
        : (first && first.id)
      const status = first && first.status ? first.status : args[1]
      if (!id) return
      record(id, status === 'running', 'agent/status')
    } catch (err) {
      try { root.logger?.warn?.('[dsh-idle-crt] agent/status handler failed:', err?.message || err) } catch (e) {}
    }
  }))

  root.effect(() => root.on('api-session/status', (...args) => {
    try {
      pushRaw('api-session/status', args)
      const sessionId = args[0] && typeof args[0] === 'object' ? (args[0].sessionId || args[0].id) : args[0]
      const flag = args[1] === true || (args[0] && args[0].running === true)
      record(sessionId, flag, 'api-session/status')
    } catch (err) {}
  }))

  // session 都没了，就绝不可能还在跑：顺手收拾，避免集合里的人永远不退出。
  const forget = (summary) => {
    try {
      const id = summary && (summary.id || summary.sessionId)
      if (id) record(id, false, 'session-removed')
    } catch (err) {}
  }
  root.effect(() => root.on('api-session/removed', forget))
  root.effect(() => root.on('session/removed', forget))

  // ② 注入行注册：apply 一进来就做，不依赖任何服务（桌面端注入表可能只收集一次）。
  root.effect(() => root.on('webserver/index-inject', (table) => {
    try {
      if (!BOOTSTRAP_ROW_TEXT) return
      if (!Array.isArray(table)) return
      for (const row of table) {
        if (!row) continue
        if (row.kind === 'script-src' && typeof row.src === 'string' && row.src.indexOf(ROUTE) === 0) return
        if (row.kind === 'script' && typeof row.text === 'string'
          && row.text.indexOf('__DSH_IDLE_CRT__') >= 0) return
      }
      table.push({ kind: 'script', placement: 'body', text: BOOTSTRAP_ROW_TEXT })
    } catch (err) {
      try { root.logger?.warn?.('[dsh-idle-crt] index-inject row failed:', err?.message || err) } catch (e) {}
    }
  }))

  // ③ 其余逻辑等 webServer 就绪（等价于对象级 inject，但不会推迟 ②）。
  // 还要 agents：热挂载时正在跑的任务不会再补发状态事件，只能先摸一遍底。
  root.inject(['webServer', 'agents'], (ctx) => {
    const disposers = []

    const sendJson = (res, value, status = 200) => {
      const body = Buffer.from(JSON.stringify(value), 'utf8')
      res.writeHead(status, {
        'Content-Type': MIME['.json'],
        'Cache-Control': 'no-store',
        'Content-Length': String(body.length),
      })
      res.end(body)
    }

    /** 有上限地读请求体：设置页只会传一个小 JSON，超出就是有人乱来。 */
    const readBody = (req, limit) => new Promise((resolve, reject) => {
      let size = 0
      const chunks = []
      req.on('data', (chunk) => {
        size += chunk.length
        if (size > limit) {
          reject(new Error('request body too large'))
          try { req.destroy() } catch (e) {}
          return
        }
        chunks.push(chunk)
      })
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
      req.on('error', reject)
    })

    // register() 对重复 (kind,path) 会直接抛；路由冲突是组合层的问题，
    // 但不能让它把整条 entry 拖垮——记一条日志继续挂其余路由。
    const register = (route) => {
      try {
        disposers.push(ctx.webServer.register(route))
      } catch (err) {
        try { ctx.logger?.warn?.(`[dsh-idle-crt] route ${route.path} not registered:`, err?.message || err) } catch (e) {}
      }
    }

    // 事件的签名是宿主的内部约定，会随版本漂；agents.list() 的 status 才是
    // 当下的真话。所以每次有人来问状态，都先用真实列表覆盖一遍集合：
    // 这样即便事件一个都没收到（热挂载、事件改名），busy 也不会卡在旧值上。
    const readAgents = () => {
      const list = typeof ctx.agents?.list === 'function' ? ctx.agents.list() : null
      if (!list) return null
      const out = []
      for (const agent of list) {
        const id = agent && agent.id
        if (!id) continue
        const status = agent.status || agent.state || (agent.running === true ? 'running' : '')
        out.push({ id, status: status || null })
      }
      return out
    }

    const resync = (source) => {
      try {
        const agents = readAgents()
        if (!agents) return
        const next = new Set()
        for (const a of agents) if (a.status === 'running') next.add(a.id)
        const now = Date.now()
        for (const id of [...running]) {
          if (next.has(id)) continue
          running.delete(id)
          since.delete(id)
          lastEventAt = now
          history.push({ at: now, id, running: false, source })
        }
        for (const id of next) {
          if (running.has(id)) continue
          running.add(id)
          since.set(id, now)
          lastEventAt = now
          history.push({ at: now, id, running: true, source })
        }
        if (history.length > HISTORY_MAX) history.splice(0, history.length - HISTORY_MAX)
        probeInfo = { count: agents.length, agents: agents.slice(0, 12), at: now }
      } catch (err) {
        probeInfo = { error: String((err && err.message) || err) }
      }
    }
    resync('agents.list')

    register({
      kind: 'exact',
      path: `${ROUTE}/client.js`,
      handler: (req, res) => {
        try {
          const bytes = fs.readFileSync(PLATE_BUNDLE)
          const rev = createHash('sha1').update(bytes).digest('hex').slice(0, 12)
          res.writeHead(200, {
            'Content-Type': MIME['.js'],
            'Cache-Control': 'no-store',
            'X-Idle-Crt-Rev': rev,
            'Content-Length': String(bytes.length),
          })
          res.end(bytes)
        } catch (err) {
          res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
          res.end(`idle-crt client bundle missing: run "npm run build" in ${PACKAGE_ROOT}`)
        }
      },
    })

    register({
      kind: 'exact',
      path: `${ROUTE}/settings.json`,
      /**
       * 设置读写都挂在这一条路上：webServer 的路由表按 (kind, path) 去重，
       * 注册两条同路径会直接抛，所以按 method 分流。
       *
       * POST 的语义是「合并」而不是「整份替换」：设置页只传自己动过的字段，
       * 少传的键保持原值；值一律先过 normalizeSettings 夹紧，再写盘。
       */
      handler: async (req, res) => {
        const method = String((req && req.method) || 'GET').toUpperCase()
        if (method === 'POST' || method === 'PUT') {
          let raw = ''
          try {
            raw = await readBody(req, 16 * 1024)
          } catch (err) {
            sendJson(res, { ok: false, error: String((err && err.message) || err) }, 400)
            return
          }
          let patch
          try {
            patch = normalizeSettings(JSON.parse(raw || '{}'))
          } catch (err) {
            sendJson(res, { ok: false, error: 'invalid json' }, 400)
            return
          }
          Object.assign(settings, patch)
          let persisted = true
          let error = null
          try {
            writePersistedSettings(settings)
          } catch (err) {
            persisted = false
            error = String((err && err.message) || err)
            try { ctx.logger?.warn?.('[dsh-idle-crt] settings write failed:', error) } catch (e) {}
          }
          sendJson(res, {
            ok: true,
            persisted,
            error,
            file: SETTINGS_FILE,
            settings: { ...settings, version: VERSION },
          })
          return
        }
        sendJson(res, { ...settings, version: VERSION })
      },
    })

    // 诊断路由只对本机回环开口：auth-url 会签发一个可用的登录 URL，
    // debug.json 会暴露 session id，都不该让局域网里的人顺手拿走。
    const isLoopback = (req) => {
      const addr = String((req && req.socket && req.socket.remoteAddress) || '')
      return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1'
    }

    register({
      kind: 'exact',
      path: `${ROUTE}/state.json`,
      handler: (req, res) => {
        resync('poll')
        sendJson(res, { ...busySnapshot(), history: history.slice(-HISTORY_SERVE) })
      },
    })

    // 布局诊断：设置页在打开时把「对话框几何 / 谁盖在它上面」POST 回来，
    // 用来抓只在真实窗口里出现的叠压。只留最近 20 份，不落盘。
    register({
      kind: 'exact',
      path: `${ROUTE}/diag`,
      handler: (req, res) => {
        if (!isLoopback(req)) {
          res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' })
          res.end('loopback only')
          return
        }
        if (req.method === 'POST' || req.method === 'PUT') {
          readBody(req, 128 * 1024).then((body) => {
            try {
              const report = JSON.parse(body || '{}')
              diagReports.push({ at: Date.now(), report })
              while (diagReports.length > 20) diagReports.shift()
              sendJson(res, { ok: true, n: diagReports.length })
            } catch (err) {
              sendJson(res, { ok: false, error: String((err && err.message) || err) }, 400)
            }
          }).catch((err) => {
            sendJson(res, { ok: false, error: String((err && err.message) || err) }, 400)
          })
          return
        }
        sendJson(res, { n: diagReports.length, reports: diagReports.slice(-5) })
      },
    })

    // 只在本机回环上可见：给出带认证的 GUI URL，方便用无头浏览器验证。
    // connection 是可选服务：取不到就算了，别让整条 entry 挂掉。
    register({
      kind: 'exact',
      path: `${ROUTE}/auth-url.json`,
      handler: (req, res) => {
        if (!isLoopback(req)) {
          res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' })
          res.end('loopback only')
          return
        }
        const out = { ok: false, origin: null, url: null, error: null }
        try {
          const conn = typeof ctx.get === 'function' ? ctx.get('connection') : null
          const origin = typeof ctx.webServer.getOrigin === 'function' ? ctx.webServer.getOrigin() : null
          out.origin = origin || null
          if (!conn) out.error = 'connection service unavailable'
          else if (typeof conn.authenticatedUrl !== 'function') out.error = 'connection.authenticatedUrl missing'
          else out.url = conn.authenticatedUrl(origin || '')
          out.ok = typeof out.url === 'string' && out.url.length > 0
        } catch (err) {
          out.error = String((err && err.message) || err)
        }
        sendJson(res, out)
      },
    })

    // 诊断用：事件签名、热挂载探测结果、原始样本。只在本机回环上可见。
    register({
      kind: 'exact',
      path: `${ROUTE}/debug.json`,
      handler: (req, res) => {
        if (!isLoopback(req)) {
          res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' })
          res.end('loopback only')
          return
        }
        resync('debug')
        sendJson(res, {
          ...busySnapshot(),
          probe: probeInfo,
          events: raw.slice(-30),
          history: history.slice(-HISTORY_SERVE),
        })
      },
    })

    ctx.effect(() => () => {
      for (const dispose of disposers) {
        try { dispose() } catch (err) {}
      }
    })

    try {
      console.log(`[dsh-idle-crt] ready (enabled=${settings.enabled !== false}, idle=${settings.idleMs}ms) — routes under ${ROUTE}/`)
    } catch (err) {}
  })
}

export default { name, Config, apply }
