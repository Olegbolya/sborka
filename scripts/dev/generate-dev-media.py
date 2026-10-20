#!/usr/bin/env python3
"""Generates the service pictures of the /dev galleries (P1.6–P1.9): a «photo», an animated GIF and a
mask. They are drawn by this script — no images from the internet (CLAUDE.md) — and are not part of the
media library. Run: python3 scripts/dev/generate-dev-media.py"""
import math
import random
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

OUT = Path(__file__).resolve().parents[2] / 'apps' / 'web' / 'public' / 'dev'
OUT.mkdir(parents=True, exist_ok=True)
rnd = random.Random(2026)


def winter_photo(w=800, h=600):
    """A winter evening: gradient sky, moon, hills, fir trees and snow."""
    img = Image.new('RGB', (w, h))
    px = img.load()
    for y in range(h):
        t = y / h
        r, g, b = int(20 + 60 * t), int(30 + 70 * t), int(80 + 110 * t)
        for x in range(w):
            px[x, y] = (r, g, b)
    d = ImageDraw.Draw(img)
    d.ellipse((560, 70, 680, 190), fill=(250, 244, 214))
    for i, (base, color) in enumerate([(420, (70, 96, 140)), (470, (200, 214, 232)), (520, (236, 242, 250))]):
        pts = [(0, h)] + [(x, base + 30 * math.sin(x / (90 + 40 * i) + i)) for x in range(0, w + 1, 10)] + [(w, h)]
        d.polygon(pts, fill=color)
    for _ in range(14):
        x = rnd.randint(20, w - 20)
        y = rnd.randint(430, 520)
        s = rnd.randint(30, 70)
        for k in range(3):
            d.polygon([(x, y - s + k * s * 0.35), (x - s * 0.45 + k * 6, y + k * s * 0.3), (x + s * 0.45 - k * 6, y + k * s * 0.3)], fill=(24, 74 + k * 10, 52))
    for _ in range(400):
        x, y, r = rnd.randint(0, w), rnd.randint(0, h), rnd.choice([1, 1, 2, 3])
        d.ellipse((x - r, y - r, x + r, y + r), fill=(255, 255, 255))
    img = img.filter(ImageFilter.GaussianBlur(0.6))
    img.save(OUT / 'zimnii-vecher.jpg', quality=88)


def snow_gif(w=240, h=240, frames=24):
    """Falling snowflakes over a garland of lights, looping."""
    flakes = [(rnd.uniform(0, w), rnd.uniform(0, h), rnd.uniform(1.5, 4), rnd.uniform(4, 9)) for _ in range(60)]
    out = []
    for f in range(frames):
        img = Image.new('RGB', (w, h), (26, 40, 88))
        d = ImageDraw.Draw(img)
        for i in range(8):
            x = 15 + i * 30
            y = 30 + 10 * math.sin(i)
            on = (i + f // 3) % 3 == 0
            color = [(255, 90, 90), (255, 210, 80), (110, 220, 140)][i % 3]
            d.ellipse((x - 7, y - 7, x + 7, y + 7), fill=color if on else tuple(c // 3 for c in color))
        for (x, y, r, v) in flakes:
            yy = (y + f * v) % h
            d.ellipse((x - r, yy - r, x + r, yy + r), fill=(255, 255, 255))
        out.append(img)
    out[0].save(OUT / 'snegopad.gif', save_all=True, append_images=out[1:], duration=80, loop=0)


def star_mask(w=400, h=400):
    """A soft star with alpha — for the «маска по картинке» example (S-19)."""
    img = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    pts = []
    for i in range(10):
        a = -math.pi / 2 + i * math.pi / 5
        r = 190 if i % 2 == 0 else 80
        pts.append((w / 2 + r * math.cos(a), h / 2 + r * math.sin(a)))
    d.polygon(pts, fill=(0, 0, 0, 255))
    img = img.filter(ImageFilter.GaussianBlur(4))
    img.save(OUT / 'maska-zvezda.png')


winter_photo()
snow_gif()
star_mask()
print('Готово:', ', '.join(p.name for p in sorted(OUT.iterdir())))
