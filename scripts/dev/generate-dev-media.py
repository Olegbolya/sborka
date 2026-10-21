#!/usr/bin/env python3
"""Generates the service media of the /dev galleries (P1.6–P1.9): a «photo», an animated GIF, a mask, a short
video with its poster, a sound and a Lottie animation. They are drawn by this script — no images from the internet (CLAUDE.md) — and are not part of the
media library. Run: python3 scripts/dev/generate-dev-media.py"""
import json
import math
import random
import struct
import subprocess
import tempfile
import wave
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


def snow_video(w=320, h=240, frames=48):
    """Two seconds of falling snow over a night sky (B-04 video, B-03 «GIF stored as video») and its poster."""
    flakes = [(rnd.uniform(0, w), rnd.uniform(0, h), rnd.uniform(1, 3), rnd.uniform(40, 90)) for _ in range(90)]
    with tempfile.TemporaryDirectory() as tmp:
        for f in range(frames):
            img = Image.new('RGB', (w, h), (18, 28, 64))
            d = ImageDraw.Draw(img)
            d.ellipse((230, 30, 280, 80), fill=(250, 244, 214))
            d.polygon([(0, h), (0, 190), (110, 170), (220, 195), (w, 175), (w, h)], fill=(226, 234, 246))
            for x, y, r, v in flakes:
                yy = (y + v * f / 24) % h
                xx = (x + 6 * math.sin((yy + x) / 30)) % w
                d.ellipse((xx - r, yy - r, xx + r, yy + r), fill=(255, 255, 255))
            img.save(f'{tmp}/{f:03d}.png')
            if f == 0:
                img.save(OUT / 'snegopad-video.jpg', quality=85)
        subprocess.run(
            ['ffmpeg', '-y', '-loglevel', 'error', '-framerate', '24', '-i', f'{tmp}/%03d.png', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', str(OUT / 'snegopad.mp4')],
            check=True,
        )


def bells_sound(seconds=1.6, rate=22050):
    """A short jingle of bells (B-05): a few decaying chords, mono WAV."""
    notes = [(0.0, [1318.5, 1567.98]), (0.4, [1174.66, 1479.98]), (0.8, [1318.5, 1975.53])]
    with wave.open(str(OUT / 'bubency.wav'), 'wb') as out:
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(rate)
        frames = bytearray()
        for i in range(int(seconds * rate)):
            t = i / rate
            v = 0.0
            for start, freqs in notes:
                if t >= start:
                    k = t - start
                    v += sum(math.sin(2 * math.pi * fr * k) for fr in freqs) * math.exp(-5 * k) * 0.22
            frames += struct.pack('<h', int(max(-1, min(1, v)) * 32000))
        out.writeframes(bytes(frames))


def snowball_lottie():
    """A bouncing snowball as Lottie JSON (B-07): one shape layer, position and scale keyframes."""
    ease = {'o': {'x': [0.33], 'y': [0]}, 'i': {'x': [0.67], 'y': [1]}}
    anim = {
        'v': '5.7.4', 'fr': 30, 'ip': 0, 'op': 60, 'w': 200, 'h': 200, 'nm': 'Снежок', 'ddd': 0, 'assets': [],
        'layers': [{
            'ddd': 0, 'ind': 1, 'ty': 4, 'nm': 'Снежок', 'sr': 1, 'ip': 0, 'op': 60, 'st': 0, 'bm': 0,
            'ks': {
                'o': {'a': 0, 'k': 100}, 'r': {'a': 0, 'k': 0}, 'a': {'a': 0, 'k': [0, 0, 0]},
                'p': {'a': 1, 'k': [{'t': 0, 's': [100, 40, 0], **ease}, {'t': 30, 's': [100, 150, 0], **ease}, {'t': 60, 's': [100, 40, 0]}]},
                's': {'a': 1, 'k': [{'t': 0, 's': [100, 100, 100], **ease}, {'t': 30, 's': [120, 80, 100], **ease}, {'t': 60, 's': [100, 100, 100]}]},
            },
            'shapes': [{'ty': 'gr', 'nm': 'Шар', 'it': [
                {'ty': 'el', 'nm': 'Круг', 'p': {'a': 0, 'k': [0, 0]}, 's': {'a': 0, 'k': [60, 60]}},
                {'ty': 'fl', 'nm': 'Заливка', 'c': {'a': 0, 'k': [0.92, 0.96, 1, 1]}, 'o': {'a': 0, 'k': 100}, 'r': 1},
                {'ty': 'st', 'nm': 'Обводка', 'c': {'a': 0, 'k': [0.35, 0.55, 0.85, 1]}, 'o': {'a': 0, 'k': 100}, 'w': {'a': 0, 'k': 4}, 'lc': 2, 'lj': 2},
                {'ty': 'tr', 'p': {'a': 0, 'k': [0, 0]}, 'a': {'a': 0, 'k': [0, 0]}, 's': {'a': 0, 'k': [100, 100]}, 'r': {'a': 0, 'k': 0}, 'o': {'a': 0, 'k': 100}},
            ]}],
        }],
    }
    (OUT / 'snezhok.json').write_text(json.dumps(anim, ensure_ascii=False))


winter_photo()
snow_gif()
star_mask()
snow_video()
bells_sound()
snowball_lottie()
print('Готово:', ', '.join(p.name for p in sorted(OUT.iterdir())))
