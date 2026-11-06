"""Assemble src/client/index.js from the new prologue + the original splash core.

Run from the package root:  python tools/assemble-client.py
The splash core (wipeAt / createCrtPass / drawScreen1 / helpers) is copied
byte-for-byte from the upstream repo so the artwork stays identical; only three
lines are patched (wipeAt signature, the TUI row text, the prompt text).
"""
import io
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ORIG = os.path.join(ROOT, '_upstream', 'src', 'client', 'index.js')
NEW = os.path.join(ROOT, 'src', 'client', 'index.new.js')
OUT = os.path.join(ROOT, 'src', 'client', 'index.js')

def read_lines(path):
    with io.open(path, 'r', encoding='utf-8') as fh:
        return fh.read().split('\n')

def slice_lines(lines, start, end):
    """1-based inclusive line range."""
    return '\n'.join(lines[start - 1:end])

orig = read_lines(ORIG)
has_new = os.path.exists(NEW)

wipe = slice_lines(orig, 447, 493)
crt = slice_lines(orig, 496, 691)
anim = slice_lines(orig, 683, 806)
helpers = slice_lines(orig, 804, 816)

# ---------------------------------------------------------------- patches
wipe = wipe.replace(
    'function wipeAt(ms) {',
    'function wipeAt(ms, wipeStartMs, wipeMs, wipeHoldMs) {',
    1)
assert 'function wipeAt(ms, wipeStartMs, wipeMs, wipeHoldMs) {' in wipe, 'wipeAt signature patch failed'

old_prompt = "drawSpaced(ctx, 'PRESS ANY KEY TO CONTINUE', W / 2, y, px * 0.30)"
if old_prompt not in anim:
    # the prompt may be built from a template literal in some revisions
    raise SystemExit('prompt line not found; check the upstream file')
anim = anim.replace(
    old_prompt,
    "drawSpaced(ctx, opts.promptText || 'PRESS ANY KEY TO CONTINUE', W / 2, y, px * 0.30)",
    1)

old_tui = "ctx.fillText('> dsh web --crt-splash --profile desktop', -size * 2.52, -size * 0.86)"
assert old_tui in anim, 'TUI row line not found'
anim = anim.replace(
    old_tui,
    "ctx.fillText('> dsh web --idle-crt --profile desktop', -size * 2.52, -size * 0.86)",
    1)

if has_new:
    prologue = io.open(NEW, 'r', encoding='utf-8').read()
    prologue = prologue.replace('/*@@GRAFT@@*/\n', '')
    prologue = prologue.replace('/*@@GRAFT@@*/', '')
else:
    prologue = io.open(OUT, 'r', encoding='utf-8').read()
    marker = '/*@@GRAFT@@*/'
    if marker not in prologue:
        raise SystemExit('no prologue source (index.new.js) and no graft marker in index.js')
    prologue = prologue.split(marker)[0]

graft = '\n\n'.join([wipe, crt, anim, helpers]).rstrip() + '\n'
text = prologue.rstrip() + '\n\n' + graft

io.open(OUT, 'w', encoding='utf-8', newline='\n').write(text)
print('wrote', OUT, len(text.split('\n')), 'lines')
