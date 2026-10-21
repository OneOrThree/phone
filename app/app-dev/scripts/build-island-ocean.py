"""Bake approved ocean artwork and alpha-only island cutouts. No generated RGB enters terrain.

Run with the requirements-tile-atlas.txt environment, then build-tile-atlas.py.
--check compares decoded pixels, independent of PNG compression.
"""
import argparse
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'scripts/source-art/island-ocean'
ASSETS = ROOT / 'src/assets/backgrounds'
OUTPUT = ASSETS / 'island/ocean'


def terrain(base, cutout):
    original = Image.open(base).convert('RGBA')
    alpha = Image.open(cutout).convert('RGBA').getchannel('A')
    if original.size != alpha.size:
        raise ValueError(f'Cutout must align with original: {original.size} != {alpha.size}')
    # The approved cutout has alpha 253/254 on solid interiors. Make these opaque;
    # retain the soft shoreline fringe. The original RGB is never resampled.
    alpha = alpha.point(lambda a: 255 if a >= 248 else a)
    original.putalpha(alpha)
    return original


def periodic_water(source, overlap=64):
    """Overlap opposite edge strips without reflection; output is a periodic texture.

    The wrap transition is distributed over 64 source pixels (about 28 world px).
    Central artwork is untouched. Horizontal then vertical blending also handles corners.
    """
    a = np.asarray(Image.open(source).convert('RGB'), dtype=np.float64)
    for axis in (1, 0):
        a = np.swapaxes(a, 0, axis)
        n = a.shape[0] - overlap
        t = (np.arange(overlap) + 0.5) / overlap
        t = (0.5 - 0.5 * np.cos(np.pi * t))[:, None, None]
        seam = a[n:] * (1 - t) + a[:overlap] * t
        a = np.concatenate((seam, a[overlap:n]), axis=0)
        a = np.swapaxes(a, 0, axis)
    return Image.fromarray(np.clip(np.rint(a), 0, 255).astype('uint8'))


def build(out):
    out.mkdir(parents=True, exist_ok=True)
    images = {}
    for time in ('day', 'night'):
        images[f'{time}.png'] = periodic_water(SOURCE / f'{time}.png')
        images[f'home-{time}.png'] = terrain(ASSETS / f'island/base/{time}.png', SOURCE / 'home-cutout.png')
    mask = Image.new('RGBA', images['home-day.png'].size, 'white')
    mask.putalpha(images['home-day.png'].getchannel('A'))
    images['home-mask.png'] = mask
    for name, im in images.items():
        im.save(out / name, compress_level=9)
    return images


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    if not args.check:
        build(OUTPUT)
        return
    with tempfile.TemporaryDirectory() as tmp:
        images = build(Path(tmp))
        for name, expected in images.items():
            actual = Image.open(OUTPUT / name)
            if actual.size != expected.size or actual.tobytes() != expected.tobytes():
                raise SystemExit(f'{name} is stale; run build-island-ocean.py')
    print('Ocean assets match their sources; original terrain RGB is preserved.')


if __name__ == '__main__':
    main()
