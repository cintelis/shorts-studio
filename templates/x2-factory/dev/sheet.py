# python dev/sheet.py prefix out.png cols  -> contact sheet of prefix-*.png (sorted by time)
import sys, glob, re
from PIL import Image, ImageDraw
pre, out, cols = sys.argv[1], sys.argv[2], int(sys.argv[3]) if len(sys.argv) > 3 else 6
fs = sorted(glob.glob(pre + '-*.png'), key=lambda f: float(re.search(r'-([\d_]+)\.png$', f).group(1).replace('_', '.')))
w, h = 270, 480
rows = (len(fs) + cols - 1) // cols
S = Image.new('RGB', (cols * w, rows * h), 'black'); d = ImageDraw.Draw(S)
for i, f in enumerate(fs):
    im = Image.open(f).convert('RGB').resize((w, h)); x, y = (i % cols) * w, (i // cols) * h; S.paste(im, (x, y))
    d.text((x + 6, y + 6), re.search(r'-([\d_]+)\.png$', f).group(1).replace('_', '.'), fill='yellow')
S.save(out); print(out, len(fs))
