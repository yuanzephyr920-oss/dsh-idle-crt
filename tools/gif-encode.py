"""Encode _frames/*.png into one looping GIF for the README.

Usage: python tools/gif-encode.py [width] [colors] [dither] [every] [drop] [fps]
  every  keep every Nth frame (1 = keep all)
  drop   additionally drop one frame out of every N (0 = off), for odd fps divisors
  fps    playback rate written into the GIF delay (default 12.5)
"""
import glob
import io
import os
import sys

from PIL import Image

WIDTH = int(sys.argv[1]) if len(sys.argv) > 1 else 720
COLORS = int(sys.argv[2]) if len(sys.argv) > 2 else 128
DITHER = (sys.argv[3] if len(sys.argv) > 3 else "none").lower() == "floyd"
EVERY = int(sys.argv[4]) if len(sys.argv) > 4 else 1
DROP = int(sys.argv[5]) if len(sys.argv) > 5 else 0
FPS = float(sys.argv[6]) if len(sys.argv) > 6 else 12.5

frames = sorted(glob.glob(r"G:/DSH/dsh-idle-crt/_frames/*.png"))
frames = frames[::EVERY]
if DROP > 1:
    frames = [f for i, f in enumerate(frames) if i % DROP != DROP - 1]
print("frames:", len(frames))

sample = Image.open(frames[0]).convert("RGB")
height = round(sample.height * WIDTH / sample.width)
sample = sample.resize((WIDTH, height), Image.LANCZOS)

# One global palette keeps the colours of the whole cycle stable between frames.
swatches = Image.new("RGB", (WIDTH, height * 12))
for i in range(12):
    src = Image.open(frames[i * max(1, len(frames) // 12)]).convert("RGB").resize((WIDTH, height), Image.LANCZOS)
    swatches.paste(src, (0, i * height))
palette = swatches.quantize(colors=COLORS, method=Image.MEDIANCUT)

out_frames = []
for path in frames:
    img = Image.open(path).convert("RGB").resize((WIDTH, height), Image.LANCZOS)
    q = img.quantize(palette=palette, dither=Image.FLOYDSTEINBERG if DITHER else Image.NONE)
    out_frames.append(q)

out = r"G:/DSH/dsh-idle-crt/docs/plate-cycle.gif"
duration = round(1000 / FPS)
out_frames[0].save(
    out,
    save_all=True,
    append_images=out_frames[1:],
    duration=duration,
    loop=0,
    optimize=True,
    disposal=2,
)
print("wrote", out, os.path.getsize(out) // 1024, "KiB", f"{WIDTH}x{height}", COLORS, "colors", "dither" if DITHER else "no-dither")

