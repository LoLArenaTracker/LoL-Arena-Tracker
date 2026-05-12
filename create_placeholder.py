"""Run once to create placeholder assets."""
import os

try:
    from PIL import Image, ImageDraw, ImageFont
    HAS_PILLOW = True
except ImportError:
    HAS_PILLOW = False

ROOT = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.join(ROOT, "assets")
os.makedirs(ASSETS, exist_ok=True)


def create_placeholder_png(path, size=32, text="?", bg=(26, 34, 53), fg=(90, 97, 120)):
    img = Image.new("RGBA", (size, size), bg)
    draw = ImageDraw.Draw(img)
    try:
        font = ImageFont.truetype("arial.ttf", size // 2)
    except Exception:
        font = ImageFont.load_default()
    bbox = draw.textbbox((0, 0), text, font=font)
    w, h = bbox[2] - bbox[0], bbox[3] - bbox[1]
    draw.text(((size - w) / 2, (size - h) / 2), text, fill=fg, font=font)
    img.save(path)
    print(f"Created: {path}")


def create_app_icon(path, size=256):
    img = Image.new("RGBA", (size, size), (10, 14, 26))
    draw = ImageDraw.Draw(img)
    # Hexagon
    cx, cy = size // 2, size // 2
    r = size * 0.42
    import math
    pts = [(cx + r * math.cos(math.radians(60 * i - 30)),
            cy + r * math.sin(math.radians(60 * i - 30))) for i in range(6)]
    draw.polygon(pts, outline=(200, 155, 60), width=max(2, size // 64))
    r2 = r * 0.65
    pts2 = [(cx + r2 * math.cos(math.radians(60 * i - 30)),
             cy + r2 * math.sin(math.radians(60 * i - 30))) for i in range(6)]
    draw.polygon(pts2, fill=(200, 155, 60, 40))
    # "A" text
    try:
        font = ImageFont.truetype("arial.ttf", size // 3)
    except Exception:
        font = ImageFont.load_default()
    bbox = draw.textbbox((0, 0), "A", font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    draw.text(((size - tw) / 2, (size - th) / 2), "A", fill=(200, 155, 60), font=font)
    img.save(path)
    print(f"Created: {path}")


if HAS_PILLOW:
    create_placeholder_png(os.path.join(ASSETS, "placeholder.png"), 32, "?")
    create_app_icon(os.path.join(ASSETS, "app-icon.png"), 256)
    print("Done! Assets created.")
else:
    print("Pillow not installed. Run: pip install Pillow")
    print("Creating minimal fallback PNG...")
    # Minimal 1x1 transparent PNG bytes
    import struct, zlib
    def minimal_png(path):
        def chunk(name, data):
            c = struct.pack('>I', len(data)) + name + data
            return c + struct.pack('>I', zlib.crc32(c[4:]) & 0xffffffff)
        png = b'\x89PNG\r\n\x1a\n'
        png += chunk(b'IHDR', struct.pack('>IIBBBBB', 1, 1, 8, 2, 0, 0, 0))
        png += chunk(b'IDAT', zlib.compress(b'\x00\x1a\x22\x35'))
        png += chunk(b'IEND', b'')
        with open(path, 'wb') as f:
            f.write(png)
        print(f"Minimal PNG: {path}")
    minimal_png(os.path.join(ASSETS, "placeholder.png"))
    minimal_png(os.path.join(ASSETS, "app-icon.png"))
