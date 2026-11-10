# YouTube channel banner (2560x1440). Everything that matters sits in the 1546x423 centre strip that every device shows;
# desktop shows the full-width band (y 508-931), TVs the whole image. Frames come from the channel's own videos.
#   python make-banner.py <frames-dir> <out.jpg>
import sys
from PIL import Image, ImageDraw, ImageFont, ImageFilter

FR, OUT = sys.argv[1], sys.argv[2]
W, H = 2560, 1440
BAND_Y, BAND_H = 508, 423
TEXT_X0, TEXT_X1 = 830, 1730          # title panel, inside the 1546-wide safe strip (507-2053)
GAP = 6

# (file, crop box in the source frame) left to right; the two beside the title are the most striking
LEFT = [("full-watch.png", (150, 700, 674, 1500)), ("full-jet.png", (200, 820, 855, 1820)), ("full-raptor.png", (108, 480, 959, 1780))]
RIGHT = [("full-roadster.png", (60, 162, 960, 1536)), ("full-quantum.png", (128, 590, 848, 1690)), ("iss-192.png", (606, 0, 1313, 1080))]

def fit(path, box, w, h):
    im = Image.open(f"{FR}/{path}").convert("RGB").crop(box)
    s = max(w / im.width, h / im.height)
    im = im.resize((round(im.width * s), round(im.height * s)), Image.LANCZOS)
    x, y = (im.width - w) // 2, (im.height - h) // 2
    return im.crop((x, y, x + w, y + h))

canvas = Image.new("RGB", (W, H), (7, 9, 13))
band = Image.new("RGB", (W, BAND_H), (7, 9, 13))
def row(items, x0, x1):
    n = len(items); w = (x1 - x0 - GAP * (n - 1)) // n
    for k, (p, b) in enumerate(items):
        band.paste(fit(p, b, w, BAND_H), (x0 + k * (w + GAP), 0))
row(LEFT, 0, TEXT_X0 - GAP)
row(RIGHT, TEXT_X1 + GAP, W)

# TV area above and below the band: a dark, blurred echo of the band
echo = band.resize((W // 8, BAND_H // 8)).filter(ImageFilter.GaussianBlur(3)).resize((W, H))
echo = Image.blend(echo, Image.new("RGB", (W, H), (7, 9, 13)), 0.78)
canvas.paste(echo, (0, 0))
canvas.paste(band, (0, BAND_Y))

# Soft fade from the tiles into the title panel
fade = Image.new("L", (W, H), 0); d = ImageDraw.Draw(fade)
for i in range(160):
    a = int(255 * (i / 160) ** 1.6)
    d.line([(TEXT_X0 - 160 + i, 0), (TEXT_X0 - 160 + i, H)], fill=a)
    d.line([(TEXT_X1 + 160 - i, 0), (TEXT_X1 + 160 - i, H)], fill=a)
d.rectangle([TEXT_X0, 0, TEXT_X1, H], fill=255)
canvas = Image.composite(Image.new("RGB", (W, H), (7, 9, 13)), canvas, fade)

def font(size, var="Bold"):
    f = ImageFont.truetype("C:/Windows/Fonts/bahnschrift.ttf", size); f.set_variation_by_name(var); return f
def mono(size):
    return ImageFont.truetype("C:/Windows/Fonts/consolab.ttf", size)

dr = ImageDraw.Draw(canvas)
cx = (TEXT_X0 + TEXT_X1) // 2
def center(y, txt, f, fill, track=0):
    widths = [dr.textlength(c, font=f) for c in txt]
    x = cx - (sum(widths) + track * (len(txt) - 1)) / 2
    for c, w in zip(txt, widths):
        dr.text((x, y), c, font=f, fill=fill); x += w + track

top = BAND_Y + 42
center(top, "MACHINES,", font(132), (245, 247, 250), 3)
center(top + 138, "OPENED UP", font(132), (255, 196, 0), 3)
center(top + 300, "ROCKETS · ENGINES · SPACE · FUTURE CARS", mono(30), (190, 198, 210), 2)
dr.line([(cx - 60, top + 285), (cx + 60, top + 285)], fill=(255, 196, 0), width=4)

canvas.save(OUT, quality=93)
print("ok", canvas.size)
