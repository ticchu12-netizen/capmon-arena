"""Turns the Healspike 3D render into a flat, outlined sprite that sits next to the
Rageblaze and Tsunami sheets. Usage: make_healspike_sprite.py <render.png> <out.webp>"""
import sys
from PIL import Image, ImageFilter, ImageChops, ImageEnhance
src = Image.open(sys.argv[1]).convert('RGBA'); src = src.crop(src.getbbox())
H = 150; W = round(src.width * H / src.height)
small = src.resize((W, H), Image.LANCZOS)
alpha = small.split()[3].point(lambda v: 255 if v > 110 else 0)
rgb = small.convert('RGB').filter(ImageFilter.SMOOTH)
rgb = ImageEnhance.Color(rgb).enhance(1.55); rgb = ImageEnhance.Contrast(rgb).enhance(1.15); rgb = ImageEnhance.Brightness(rgb).enhance(1.22)
flat_rgb = rgb.quantize(colors=10, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE).convert('RGB')
flat = Image.new('RGBA', (W, H), (0, 0, 0, 0)); flat.paste(flat_rgb, (0, 0), alpha)
pad = Image.new('RGBA', (W + 4, H + 4), (0, 0, 0, 0)); pad.paste(flat, (2, 2), flat)
a = pad.split()[3]; ring = ImageChops.subtract(a.filter(ImageFilter.MaxFilter(3)), a)
pad.paste(Image.new('RGBA', pad.size, (22, 48, 30, 255)), (0, 0), ring)
S = max(pad.size) + 10; canvas = Image.new('RGBA', (S, S), (0, 0, 0, 0)); canvas.paste(pad, ((S - pad.width) // 2, S - pad.height - 6), pad)
canvas.resize((384, 384), Image.NEAREST).save(sys.argv[2], 'WEBP', lossless=True, method=6)
