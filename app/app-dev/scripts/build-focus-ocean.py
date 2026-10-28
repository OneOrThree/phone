"""Bake focus island original RGB with the approved outside-ocean alpha. Preserve lake/waterfall.

Uses the home asset pipeline's same deterministic alpha normalization.
Run with requirements-tile-atlas.txt; --check verifies generated pixels and landmarks.
"""
import argparse
import importlib.util
from pathlib import Path
from PIL import Image

SCRIPT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('island_ocean', SCRIPT / 'build-island-ocean.py')
ocean = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ocean)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    original = ocean.ASSETS / 'fishing-island/day.jpg'
    image = ocean.terrain(original, ocean.SOURCE / 'focus-cutout.png')
    out = ocean.OUTPUT / 'focus-day.png'
    # Pond, stream, waterfall, land and detached offshore rock must stay opaque.
    for point in [(600, 400), (930, 510), (1190, 730), (800, 200), (285, 880)]:
        if image.getpixel(point)[3] != 255:
            raise SystemExit(f'Focus island lost an opaque landmark at {point}')
    for point in [(0, 0), (800, 1000), (1500, 20)]:
        if image.getpixel(point)[3] != 0:
            raise SystemExit(f'Outside water is not transparent at {point}')
    if image.convert('RGB').tobytes() != Image.open(original).convert('RGB').tobytes():
        raise SystemExit('Original RGB changed')
    if args.check:
        actual = Image.open(out)
        if actual.size != image.size or actual.tobytes() != image.tobytes():
            raise SystemExit('focus-day.png is stale; run build-focus-ocean.py')
    else:
        image.save(out, compress_level=9)
    print('Focus island: original RGB, pond, waterfall and outside alpha verified.')


if __name__ == '__main__':
    main()
