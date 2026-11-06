/**
 * dsh-idle-crt —— 客户端半边（设置页）
 * ---------------------------------------------------------------------------
 * 一块挂在 `settings.section` 上的普通 React 面板：左栏「设置」里多一条
 * 「待机屏保」，右边是可调的参数。保存走本插件自己的主机路由
 * `POST /dsh-idle-crt/settings.json`（宿主夹紧后落盘到 `$DSH_HOME/idle-crt.settings.json`），
 * 成功后顺手把新值推给页面全局 `window.__DSH_IDLE_CRT__`，正在跑的待机
 * 控制器立刻用新参数，不用刷新页面。
 *
 * 这个文件由宿主 Loader 直接扫描并 eval（`dsh.client` 客户端模块），所以是
 * 加载器包装的 CJS，不是 ESM：入口是 `window.__ModuleLoader__.load(...)`，
 * 依赖靠 `require('react')` 拿。
 */
window.__ModuleLoader__.load({
  id: 'dsh-idle-crt',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports

    const React = require('react')

    const ROUTE = '/dsh-idle-crt'
    const STYLE_ID = 'dsh-idle-crt/settings.css'
    const VERSION = '0.2.4'

    /** 出厂默认值；只用于「恢复默认」按钮与首次渲染，真值永远以宿主为准。 */
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
      dismissOnMove: false,
    }

    const CSS = `
.dic-section{display:flex;flex-direction:column;gap:28px;width:100%;max-width:720px}
.dic-intro{display:flex;flex-direction:column;gap:6px}
.dic-introTitle{font-size:15px;line-height:24px;color:var(--dsw-alias-label-primary)}
.dic-introText{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}
.dic-row{border-bottom:.5px solid var(--dsw-alias-border-l2);display:flex;align-items:center;gap:12px;padding:16px 0}
.dic-rowText{flex:1;min-width:160px;padding-right:24px;display:flex;flex-direction:column;gap:4px}
.dic-title{font-size:14px;line-height:22px;color:var(--dsw-alias-label-primary)}
.dic-desc{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}
.dic-rowStacked{flex-direction:column;align-items:stretch;gap:10px}
.dic-rowStacked .dic-rowText{padding-right:0}
.dic-controls{display:flex;flex-wrap:wrap;align-items:center;gap:8px;justify-content:flex-end;margin-left:auto}
.dic-rowStacked .dic-controls{justify-content:flex-start;margin-left:0;width:100%}
.dic-switch{background:var(--dsw-alias-bg-module-platform);cursor:pointer;border:none;border-radius:12px;flex:none;width:40px;height:24px;padding:0;position:relative}
.dic-switch:after{content:"";background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.28);border-radius:50%;width:18px;height:18px;transition:transform .16s;position:absolute;top:3px;left:3px}
.dic-switch[data-on]:after{transform:translate(16px)}
.dic-switch[data-on]{background:var(--dsw-alias-state-business-primary)}
.dic-input{width:120px;height:32px;box-sizing:border-box;border-radius:8px;border:.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;padding:0 10px;text-align:right}
.dic-input:focus{outline:none;border-color:var(--dsw-alias-state-business-primary)}
.dic-inputWide{width:100%;max-width:420px;text-align:left}
.dic-unit{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);flex:none}
.dic-chips{display:flex;gap:4px;flex-wrap:nowrap}
.dic-chip{height:26px;border-radius:13px;padding:0 10px;border:.5px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;cursor:pointer;white-space:nowrap}
.dic-chip:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dic-chip[data-on]{background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-primary)}
.dic-slider{width:100%;accent-color:var(--dsw-alias-state-business-primary);margin:8px 0 0}
.dic-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.dic-button{height:32px;border-radius:8px;border:.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-primary);font:inherit;cursor:pointer;padding:0 12px;font-size:13px}
.dic-button:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dic-button:disabled{opacity:.6;cursor:default}
.dic-button[data-primary]{background:var(--dsw-alias-state-business-primary);border-color:transparent;color:#fff}
.dic-status{margin-left:auto;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}
.dic-status[data-tone="ok"]{color:var(--dsw-alias-state-success-primary,#059669)}
.dic-status[data-tone="warn"]{color:var(--dsw-alias-state-warn-primary,#b45309)}
.dic-status[data-tone="bad"]{color:var(--dsw-alias-state-error-primary,#dc2626)}
.dic-note{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}
.dic-badge{background:var(--dsw-alias-bg-module-platform);height:22px;color:var(--dsw-alias-label-secondary);border-radius:11px;align-items:center;padding:0 8px;font-size:12px;display:inline-flex}
.dic-badge[data-live]{background:rgba(16,185,129,.14);color:#059669}
`

    function ensureStyles() {
      if (typeof document === 'undefined') return
      if (document.querySelector('style[data-plugin-css="' + STYLE_ID + '"]')) return
      const tag = document.createElement('style')
      tag.dataset.plugin = 'dsh-idle-crt'
      tag.dataset.pluginCss = STYLE_ID
      tag.textContent = CSS
      document.head.appendChild(tag)
    }

    // ------------------------------------------------------------------ misc
    function clampNumber(value, min, max, fallback) {
      const n = Number(value)
      if (!Number.isFinite(n)) return fallback
      return Math.min(max, Math.max(min, n))
    }

    function channel() {
      try { return window.__DSH_IDLE_CRT__ || null } catch (err) { return null }
    }

    async function fetchSettings() {
      const res = await fetch(ROUTE + '/settings.json', { cache: 'no-store' })
      if (!res.ok) throw new Error('HTTP ' + res.status)
      const data = await res.json()
      return { ...DEFAULTS, ...(data || {}) }
    }

    async function saveSettings(patch) {
      const res = await fetch(ROUTE + '/settings.json', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(patch || {}),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data || data.ok !== true) {
        const why = (data && data.error) || ('HTTP ' + res.status)
        throw new Error(why)
      }
      return data
    }

    /** 文案里的毫秒/秒换算，保留一位小数就够读。 */
    function fmtSeconds(ms) { return Math.round(Number(ms) / 100) / 10 }
    function msFromSeconds(s) { return Math.round(clampNumber(s, 0, 3600, 0) * 1000) }

    // ------------------------------------------------------------- component
    function Row(props) {
      return React.createElement('div', { className: 'dic-row' + (props.stacked ? ' dic-rowStacked' : '') },
        React.createElement('div', { className: 'dic-rowText' },
          React.createElement('div', { className: 'dic-title' }, props.title),
          props.desc ? React.createElement('div', { className: 'dic-desc' }, props.desc) : null,
        ),
        React.createElement('div', { className: 'dic-controls' }, props.children),
      )
    }

    function Switch(props) {
      return React.createElement('button', {
        type: 'button',
        className: 'dic-switch',
        'data-on': props.on ? '' : undefined,
        role: 'switch',
        'aria-checked': props.on ? 'true' : 'false',
        onClick: () => props.onChange(!props.on),
      })
    }

    function NumberField(props) {
      return React.createElement('input', {
        type: 'number',
        className: 'dic-input',
        value: props.value,
        min: props.min,
        max: props.max,
        step: props.step || 1,
        onChange: (event) => props.onChange(event.target.value),
        'aria-label': props.title,
      })
    }

    function SettingsSection() {
      const [draft, setDraft] = React.useState(null)
      const [saved, setSaved] = React.useState(null)
      const [status, setStatus] = React.useState({ tone: '', text: '正在读取设置…' })
      const [busy, setBusy] = React.useState(false)
      const [live, setLive] = React.useState(null)

      React.useEffect(() => {
        let cancelled = false
        fetchSettings()
          .then((data) => {
            if (cancelled) return
            setDraft(data)
            setSaved(data)
            setStatus({ tone: '', text: '设置文件：$DSH_HOME/idle-crt.settings.json' })
          })
          .catch((err) => {
            if (cancelled) return
            setDraft({ ...DEFAULTS })
            setStatus({ tone: 'bad', text: '读取失败：' + (err && err.message) })
          })
        return () => { cancelled = true }
      }, [])

      // 面板开着的时候顺带把运行状态显示出来（宿主的 busy / 控制器的空闲计时）
      React.useEffect(() => {
        const read = () => {
          const ch = channel()
          try { setLive(ch && typeof ch.snapshot === 'function' ? ch.snapshot() : null) } catch (err) { setLive(null) }
        }
        read()
        const id = window.setInterval(read, 1000)
        return () => window.clearInterval(id)
      }, [])

      const update = (key, value) => setDraft((prev) => ({ ...(prev || DEFAULTS), [key]: value }))
      const dirty = Boolean(draft && saved) && Object.keys(DEFAULTS).some((key) => draft[key] !== saved[key])

      const save = async () => {
        if (!draft || busy) return
        setBusy(true)
        setStatus({ tone: '', text: '保存中…' })
        try {
          const data = await saveSettings(draft)
          const next = { ...DEFAULTS, ...(data.settings || {}) }
          setSaved(next)
          setDraft(next)
          const ch = channel()
          const applied = Boolean(ch && typeof ch.applySettings === 'function')
          if (applied) ch.applySettings(next)
          setStatus({
            tone: applied ? 'ok' : 'warn',
            text: applied
              ? (data.persisted ? '已保存，画面参数立刻生效' : '已生效，但写盘失败：' + (data.error || '未知原因'))
              : '已保存到文件；本页刷新后生效',
          })
        } catch (err) {
          setStatus({ tone: 'bad', text: '保存失败：' + (err && err.message) })
        } finally {
          setBusy(false)
        }
      }

      const reset = async () => {
        setDraft({ ...DEFAULTS })
        setStatus({ tone: '', text: '已填回出厂值，点「保存」才写盘' })
      }

      const preview = () => {
        const ch = channel()
        if (!ch || typeof ch.preview !== 'function') {
          setStatus({ tone: 'warn', text: '待机脚本还没就绪，刷新页面后再试' })
          return
        }
        const ok = ch.preview()
        setStatus(ok
          ? { tone: 'ok', text: '正在显示；动一下鼠标或按任意键就消失' }
          : { tone: 'warn', text: '此刻画面正开着，先关闭再预览' })
      }

      if (!draft) {
        return React.createElement('div', { className: 'dic-section' },
          React.createElement('div', { className: 'dic-note' }, status.text))
      }

      const idleMinutes = fmtSeconds(draft.idleMs) / 60
      const liveMode = live ? String(live.mode || '') : ''
      const liveBadge = !live
        ? '待机脚本未就绪'
        : liveMode === 'showing'
          ? '画面正开着'
          : live.effectiveBusy
            ? '有任务在跑，不会出现'
            : '空闲计时中（' + Math.round((live.idleFor || 0) / 1000) + ' 秒没动）'

      return React.createElement('div', { className: 'dic-section' },
        React.createElement('div', { className: 'dic-intro' },
          React.createElement('div', { className: 'dic-introTitle' }, '待机显像管'),
          React.createElement('div', { className: 'dic-introText' },
            'DSH 闲着、并且超过设定时间没有人碰鼠标键盘时，页面盖上一块 CRT 板；点一下或按个键就消失。'),
          React.createElement('div', null,
            React.createElement('span', { className: 'dic-badge', 'data-live': liveMode === 'showing' ? '' : undefined }, liveBadge)),
        ),

        React.createElement(Row, { title: '启用待机画面', desc: '关掉之后不会再自动出现，但仍可从本页预览' },
          React.createElement(Switch, {
            on: draft.enabled,
            onChange: (value) => update('enabled', value),
          })),

        React.createElement(Row, {
          title: '鼠标移动也能收掉',
          desc: '默认关：只有窗口内的点击与键盘输入才收。打开后鼠标一晃就消失（老式屏保行为）。',
        },
          React.createElement(Switch, {
            on: draft.dismissOnMove === true,
            onChange: (value) => update('dismissOnMove', value),
          })),

        React.createElement(Row, {
          stacked: true,
          title: '无操作多久之后出现',
          desc: '以分钟计；默认 10 分钟。只算页面里的鼠标键盘，系统别处动不算。',
        },
          React.createElement('div', { className: 'dic-chips' },
            [1, 5, 10, 30].map((minutes) => React.createElement('button', {
              key: minutes,
              type: 'button',
              className: 'dic-chip',
              'data-on': Math.abs(idleMinutes - minutes) < 0.05 ? '' : undefined,
              onClick: () => update('idleMs', Math.round(minutes * 60000)),
            }, minutes + ' 分钟')),
          ),
          React.createElement(NumberField, {
            title: '无操作多久之后出现（分钟）',
            value: idleMinutes,
            min: 0,
            max: 1440,
            step: 1,
            onChange: (value) => update('idleMs', Math.round(clampNumber(value, 0, 1440, 10) * 60000)),
          }),
          React.createElement('span', { className: 'dic-unit' }, '分钟'),
        ),

        React.createElement(Row, { title: '点亮预热', desc: '显像管从暗到亮的爬升时长' },
          React.createElement(NumberField, {
            title: '预热（毫秒）',
            value: draft.bootMs,
            min: 400,
            max: 10000,
            step: 100,
            onChange: (value) => update('bootMs', clampNumber(value, 400, 10000, DEFAULTS.bootMs)),
          }),
          React.createElement('span', { className: 'dic-unit' }, '毫秒')),

        React.createElement(Row, { stacked: true, title: '淡入 / 淡出', desc: '出现时的淡入、以及一动之后消失的淡出' },
          React.createElement(NumberField, {
            title: '淡入（毫秒）',
            value: draft.fadeInMs,
            min: 0,
            max: 5000,
            step: 20,
            onChange: (value) => update('fadeInMs', clampNumber(value, 0, 5000, DEFAULTS.fadeInMs)),
          }),
          React.createElement('span', { className: 'dic-unit' }, '毫秒 淡入'),
          React.createElement(NumberField, {
            title: '淡出（毫秒）',
            value: draft.fadeOutMs,
            min: 100,
            max: 5000,
            step: 20,
            onChange: (value) => update('fadeOutMs', clampNumber(value, 100, 5000, DEFAULTS.fadeOutMs)),
          }),
          React.createElement('span', { className: 'dic-unit' }, '毫秒 淡出')),

        React.createElement(Row, { stacked: true, title: '反色扫掠', desc: '画面出现后多久开始扫、一程多久、每程停多久（白/黑交替）' },
          React.createElement(NumberField, {
            title: '开始反扫（秒）',
            value: fmtSeconds(draft.wipeStartMs),
            min: 0,
            max: 600,
            step: 0.5,
            onChange: (value) => update('wipeStartMs', msFromSeconds(value)),
          }),
          React.createElement('span', { className: 'dic-unit' }, '秒后开始'),
          React.createElement(NumberField, {
            title: '一程（秒）',
            value: fmtSeconds(draft.wipeMs),
            min: 0.8,
            max: 300,
            step: 0.5,
            onChange: (value) => update('wipeMs', Math.max(800, msFromSeconds(value))),
          }),
          React.createElement('span', { className: 'dic-unit' }, '秒一程'),
          React.createElement(NumberField, {
            title: '停留（秒）',
            value: fmtSeconds(draft.wipeHoldMs),
            min: 0,
            max: 300,
            step: 0.5,
            onChange: (value) => update('wipeHoldMs', msFromSeconds(value)),
          }),
          React.createElement('span', { className: 'dic-unit' }, '秒停留')),

        React.createElement(Row, { stacked: true, title: '扫描线强度', desc: '0 = 没有扫描线，2 = 最重（默认 1）' },
          React.createElement('div', { style: { width: '100%' } },
            React.createElement('input', {
              type: 'range',
              className: 'dic-slider',
              min: 0,
              max: 2,
              step: 0.05,
              value: draft.scanlineIntensity,
              onChange: (event) => update('scanlineIntensity', Number(event.target.value)),
              'aria-label': '扫描线强度',
            }),
            React.createElement('div', { className: 'dic-desc' }, Number(draft.scanlineIntensity).toFixed(2)),
          )),

        React.createElement(Row, { stacked: true, title: '底部提示语', desc: '留空则用默认文案；太长会被截断到 80 个字符' },
          React.createElement('input', {
            type: 'text',
            className: 'dic-input dic-inputWide',
            value: draft.promptText,
            placeholder: DEFAULTS.promptText,
            maxLength: 80,
            onChange: (event) => update('promptText', event.target.value),
            'aria-label': '底部提示语',
          })),

        React.createElement('div', { className: 'dic-actions' },
          React.createElement('button', {
            type: 'button',
            className: 'dic-button',
            'data-primary': '',
            disabled: busy || !dirty,
            onClick: save,
          }, busy ? '保存中…' : '保存'),
          React.createElement('button', {
            type: 'button',
            className: 'dic-button',
            disabled: busy,
            onClick: reset,
          }, '恢复默认'),
          React.createElement('button', {
            type: 'button',
            className: 'dic-button',
            disabled: busy,
            onClick: preview,
          }, '立刻看一眼'),
          React.createElement('span', {
            className: 'dic-status',
            'data-tone': status.tone || undefined,
          }, status.text),
        ),

        React.createElement('div', { className: 'dic-desc' },
          'dsh-idle-crt ' + VERSION + ' · 保存写进 $DSH_HOME/idle-crt.settings.json；' +
          '想改回插件自带的出厂值，删掉这个文件即可。'),
      )
    }

    // ------------------------------------------------------- layout diagnosis
    // 设置对话框出现时量一次：对话框自己的几何/背景、哪些可见元素压在它上面、
    // 它自己的内容有没有溢出。POST 回宿主 /dsh-idle-crt/diag（只在回环上开放），
    // 用来抓那种「无头浏览器复现不了、只有真实窗口才会出现」的叠压。
    let layoutWatch = null
    const rect4 = (r) => [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)]
    const cls60 = (el) => String((el && el.className) || (el && el.tagName) || '').slice(0, 60)
    const snippet = (el) => String((el && el.textContent) || '').trim().replace(/\s+/g, ' ').slice(0, 28)

    function collectLayout() {
      const dialogs = Array.prototype.slice.call(document.querySelectorAll('[role="dialog"]'))
      if (!dialogs.length) return null
      const rects = dialogs.map((d) => d.getBoundingClientRect())
      const foreign = []
      const overflow = []
      for (const el of document.querySelectorAll('body *')) {
        const r = el.getBoundingClientRect()
        if (r.width < 8 || r.height < 8) continue
        const cs = getComputedStyle(el)
        if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) continue
        const inside = dialogs.some((d) => d.contains(el))
        const hit = rects.some((q) => !(r.right <= q.left || r.left >= q.right || r.bottom <= q.top || r.top >= q.bottom))
        if (!hit) continue
        const text = snippet(el)
        if (!text || el.children.length > 3) continue
        if (inside) {
          const q = rects.find((x) => !(r.right <= x.left || r.left >= x.right || r.bottom <= x.top || r.top >= x.bottom))
          if (r.left < q.left - 6 || r.top < q.top - 6 || r.right > q.right + 6 || r.bottom > q.bottom + 6) {
            if (overflow.length < 15) overflow.push({ cls: cls60(el), r: rect4(r), text, bg: cs.backgroundColor })
          }
        } else if (foreign.length < 20) {
          foreign.push({ cls: cls60(el), r: rect4(r), text, z: cs.zIndex, pos: cs.position, bg: cs.backgroundColor, op: cs.opacity })
        }
      }
      return {
        at: Date.now(),
        href: location.href,
        viewport: [innerWidth, innerHeight],
        theme: document.documentElement.getAttribute('data-ds-theme-source'),
        htmlClass: String(document.documentElement.className || '').slice(0, 120),
        dialogs: dialogs.map((d, i) => {
          const cs = getComputedStyle(d)
          return {
            cls: cls60(d),
            r: rect4(rects[i]),
            bg: cs.backgroundColor,
            bf: cs.backdropFilter,
            op: cs.opacity,
            chain: (() => {
              const out = []
              for (let n = d, k = 0; n && n !== document.body && k < 5; n = n.parentElement, k++) {
                const s = getComputedStyle(n)
                out.push({ cls: cls60(n), z: s.zIndex, pos: s.position, bg: s.backgroundColor })
              }
              return out
            })(),
          }
        }),
        foreign,
        overflow,
      }
    }

    function reportLayout() {
      if (layoutWatch && layoutWatch.busy) return
      const report = collectLayout()
      if (!report) return
      if (layoutWatch) layoutWatch.busy = true
      try {
        fetch(ROUTE + '/diag', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(report),
        }).catch(() => {}).then(() => { if (layoutWatch) layoutWatch.busy = false })
      } catch (err) {
        if (layoutWatch) layoutWatch.busy = false
      }
    }

    function watchLayout() {
      if (layoutWatch) return
      layoutWatch = { busy: false, last: 0, timer: null }
      layoutWatch.timer = setInterval(() => {
        if (!document.querySelector('[role="dialog"]')) {
          layoutWatch.last = 0
          return
        }
        const now = Date.now()
        if (now - layoutWatch.last < 8000) return
        layoutWatch.last = now
        setTimeout(reportLayout, 900)
      }, 1500)
    }

    // ------------------------------------------------------------------ apply
    const name = 'dsh-idle-crt-client'
    const inject = ['slots']

    function apply(ctx) {
      ensureStyles()
      try { watchLayout() } catch (err) {}
      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: 'dsh-idle-crt',
        order: 42,
        label: () => {
          const lang = (typeof navigator !== 'undefined' && navigator.language) || 'zh'
          return String(lang).toLowerCase().startsWith('en') ? 'Idle Screen' : '待机屏保'
        },
      }, SettingsSection))
    }

    exports.name = name
    exports.inject = inject
    exports.apply = apply
    exports.SettingsSection = SettingsSection
    return module.exports
  },
})
