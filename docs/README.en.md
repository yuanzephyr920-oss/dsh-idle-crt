# dsh-idle-crt — English summary

A CRT screensaver for **DeepSeek Harness**: when DSH has no work running and the page
has seen no mouse/keyboard input for ten minutes, a glowing CRT plate covers the
window — scanlines, letters that breathe, and a looping inversion sweep. A click or a
key press inside the window dismisses it (mouse movement alone does not, by default).

```powershell
dsh plugin --profile desktop add dsh-idle-crt
```

Then restart DeepSeek Harness once (client modules are scanned at startup) and open
**Settings → 待机屏保**.

## Why this exists

OS-level screensavers cannot tell whether *this page* is busy. This one makes one narrow
decision: the host reports no running session (`busy=false`) **and** the page has been
untouched for ten minutes — only then the plate appears. It never steals focus, never
registers a global shortcut, and leaves the page exactly as it was once dismissed.

## What it does

- **Idle gate** — host-side busy tracking (`agent/status`, `api-session/status`, plus an
  `agents.list()` fallback on every poll), so a running agent keeps the plate away.
- **Input semantics** — only an in-window click / key / touch / right-click dismisses;
  the wheel only locks scrolling; pointer movement does not dismiss, but the whole frame
  drifts after the cursor by ±1.2 % (`followMouse`, on by default, swappable to the
  classic "any movement dismisses" with `dismissOnMove`).
- **Settings page** in DSH's own settings, persisted to `$DSH_HOME/idle-crt.settings.json`
  and applied live.
- **Coexistence** — climbs above other HUDs (`MutationObserver` + periodic re-check),
  steps aside for fullscreen / `aria-modal` dialogs / playing videos covering ≥20 % of
  the viewport, and exposes `hold()` / `release()` plus
  `<html data-dsh-idle-crt="active">` as cooperation signals.
- **Zero runtime dependencies**, no network access; the only file written is the settings json.

## Performance

Every per-frame effect runs in the fragment shader (the two text layers are uploaded
once): **16.6 ms mean / 16.7 ms p99** on an RTX 4060 — a steady 60 fps; 32.5 ms under
software rendering, which is the SwiftShader ceiling rather than the plugin's.

## Compatibility

DSH ≥ 0.2 (tested on 0.2.2-rc.1 desktop), Electron desktop and browser Web, WebGL2 with a
WebGL1 fallback. Tested alongside dsh-theme-mls-desktop, dsh-pet, billion-context and
dsh-better-display. Not applicable to CLI/TUI (there is no page to cover).

## Development

```powershell
npm install
node tools/build.mjs
node tools/preview-server.mjs 8791     # http://127.0.0.1:8791/tools/preview.html
```

Acceptance suites: `verify-preview`, `verify-gui`, `verify-cycle`, `verify-compat`,
`verify-settings-gui`, plus `diag-perf-gpu` for frame time; all take a base URL.

Full documentation (Chinese): [../README.md](../README.md) · Licence: [MIT](../LICENSE).
