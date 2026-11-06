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

- **Derived from** [justawebsite/dsh-splash-crt](https://github.com/justawebsite/dsh-splash-crt) (MIT):
  the CRT shader, the inversion-sweep maths and the glowing lettering come from there.
  Upstream shows the plate as a boot splash; this plugin turns it into an idle
  screensaver, and adds idle detection, input semantics, a coexistence layer with other
  overlay plugins, a settings page and GPU compositing.
- **Zero runtime dependencies**, no network access. The only file written is
  `$DSH_HOME/idle-crt.settings.json`.
- **Performance**: every per-frame effect runs in the fragment shader (the two text
  layers are uploaded once); 16.6 ms mean / 16.7 ms p99 on an RTX 4060 — a steady 60 fps.
- **Coexistence**: climbs above other HUDs, steps aside for fullscreen / modal dialogs /
  playing videos that cover ≥20 % of the viewport, exposes `hold()` / `release()` and
  `<html data-dsh-idle-crt="active">` as cooperation signals.

Full documentation (Chinese): [../README.md](../README.md) · Licence: [MIT](../LICENSE).
