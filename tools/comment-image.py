"""Build the comment image: two panels (idle look, inversion sweep) + one caption line.

Usage: python tools/comment-image.py [idle.png] [sweep.png]
"""
import glob
import sys

from PIL import Image, ImageDraw, ImageFont

FS = sorted(glob.glob(r"G:/DSH/dsh-idle-crt/_frames/*.png"))
FIRST = sys.argv[1] if len(sys.argv) > 1 else FS[0]
SECOND = sys.argv[2] if len(sys.argv) > 2 else FS[88]

W, H = 1440, 566
BG = (11, 13, 11)
FG = (232, 236, 228)
DIM = (150, 158, 150)

canvas = Image.new("RGB", (W, H), BG)
draw = ImageDraw.Draw(canvas)

font_path = r"C:/Windows/Fonts/msyh.ttc"
title = ImageFont.truetype(font_path, 30)
cap = ImageFont.truetype(font_path, 26)
small = ImageFont.truetype(font_path, 22)

pw = (W - 3 * 40) // 2
ph = round(pw * 9 / 16)
top = 46

panels = [
    (FIRST, "① 一直没人动鼠标键盘 → 盖上一块 CRT 板"),
    (SECOND, "② 每隔一阵，整屏来一次反色扫掠"),
]
for i, (path, text) in enumerate(panels):
    img = Image.open(path).convert("RGB").resize((pw, ph), Image.LANCZOS)
    x = 40 + i * (pw + 40)
    canvas.paste(img, (x, top))
    draw.text((x, top + ph + 18), text, font=cap, fill=FG)

draw.text(
    (40, top + ph + 74),
    "dsh-idle-crt · DeepSeek Harness 待机屏保 · 画面派生自 dsh-splash-crt（MIT）",
    font=small,
    fill=DIM,
)

canvas.save(r"G:/DSH/dsh-idle-crt/docs/comment-demo.png", optimize=True)
print("wrote docs/comment-demo.png", canvas.size)
