"""집중섬 격자(fishing-island.json)의 나무·바위 칸('2')을 섬 그림에서 다시 뽑는다 (티켓 2516).

물('0')은 지금 JSON 그대로 두고, 물이 아닌 칸만 걸을 수 있는 땅('1')과 못 가는 땅('2')으로 나눈다.
1. focus-day.png 를 768×512 로 줄이고 바닥색(잔디·모래·흰 꽃·황갈 경계, 밝기 0.6 이상) 픽셀을
   4방향으로 이어 가장 큰 덩어리를 바닥으로 본다. 진한 윤곽선에 둘러싸인 나무·바위·덤불은 떨어져 나간다.
   (색만으로는 안 된다 — 활엽수 잎이 잔디와 같은 색이다.)
2. 칸 안 바닥 픽셀이 절반 미만이면 '2'.
3. focus-mask-overrides.json 의 손 검수 결과(walk = '1' 로, block = '2' 로)를 덮어쓴다.
4. 걸을 수 있는 칸 가운데 가장 큰 4방향 덩어리와 이어지지 않은 칸은 '2'.

Run with requirements-tile-atlas.txt; --check only verifies the JSON is up to date.
"""
import argparse
import colorsys
import json
from collections import deque
from pathlib import Path
from PIL import Image

APP = Path(__file__).resolve().parent.parent
IMAGE = APP / 'src/assets/backgrounds/island/ocean/focus-day.png'
GRID = APP / 'src/constants/fishing-island.json'
OVERRIDES = APP / 'scripts/source-art/island-ocean/focus-mask-overrides.json'
W, H = 768, 512


def ground(r, g, b, a):
    if a < 128:
        return False
    h, s, v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
    h *= 360
    if 165 <= h <= 220 and s > 0.3:  # 물
        return False
    if v < 0.6:  # 윤곽선·짙은 그늘
        return False
    if s < 0.15 and v > 0.88:  # 흰 꽃·거품
        return True
    if 20 <= h <= 50 and v > 0.62:  # 모래·황갈 경계
        return True
    if 46 <= h <= 70 and s > 0.28:  # 잔디
        return True
    return s < 0.22 and 50 <= h <= 110  # 잔디 위 옅은 그림자


def largest(points, neighbours):
    """4방향으로 이은 가장 큰 덩어리."""
    rest, best = set(points), set()
    while rest:
        start = rest.pop()
        part, queue = {start}, deque([start])
        while queue:
            for n in neighbours(*queue.popleft()):
                if n in rest:
                    rest.remove(n)
                    part.add(n)
                    queue.append(n)
        if len(part) > len(best):
            best = part
    return best


def build(grid):
    cols, rows = grid['cols'], grid['rows']
    image = Image.open(IMAGE).convert('RGBA').resize((W, H), Image.BOX)
    px = image.load()
    floor = largest(
        [(x, y) for y in range(H) for x in range(W) if ground(*px[x, y])],
        lambda x, y: ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)),
    )
    cw, ch = W / cols, H / rows
    cells = list(grid['cells'])
    for r in range(rows):
        for c in range(cols):
            if cells[r * cols + c] == '0':
                continue
            box = [
                (x, y)
                for y in range(int(r * ch), int((r + 1) * ch))
                for x in range(int(c * cw), int((c + 1) * cw))
            ]
            cells[r * cols + c] = '1' if sum(p in floor for p in box) * 2 >= len(box) else '2'
    overrides = json.loads(OVERRIDES.read_text())
    for value, key in (('1', 'walk'), ('2', 'block')):
        for c, r in overrides[key]:
            if cells[r * cols + c] == '0':
                raise SystemExit(f'override {key} ({c}, {r}) is water')
            cells[r * cols + c] = value
    walk = largest(
        [(c, r) for r in range(rows) for c in range(cols) if cells[r * cols + c] == '1'],
        lambda c, r: ((c + 1, r), (c - 1, r), (c, r + 1), (c, r - 1)),
    )
    for i, value in enumerate(cells):
        if value == '1' and (i % cols, i // cols) not in walk:
            cells[i] = '2'
    return {**grid, 'cells': ''.join(cells)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    grid = json.loads(GRID.read_text())
    built = build(grid)
    if args.check:
        if built['cells'] != grid['cells']:
            diff = sum(a != b for a, b in zip(built['cells'], grid['cells']))
            raise SystemExit(f'fishing-island.json is stale ({diff} cells); run build-focus-mask.py')
    else:
        GRID.write_text(json.dumps(built, indent=2) + '\n')
    counts = {v: built['cells'].count(v) for v in '012'}
    print(f"Focus island mask: water {counts['0']}, walkable {counts['1']}, blocked {counts['2']}.")


if __name__ == '__main__':
    main()
