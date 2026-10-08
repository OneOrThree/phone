"""terrain.png 원화를 2배로 올려 128px 타일 384조각 아틀라스와 레이어 데이터를 만든다 (GROMO-2229).

- terrain.png(1536x1024) -> Lanczos 2배 + UnsharpMask -> 3072x2048 -> 128px 타일 24x16 = 384조각.
- 아틀라스 ``tileset@2x.png``: 4096x2048, 130px 피치 31열 x 13행. 슬롯 = 1px extrusion + 128px 타일
  + 1px extrusion (Tiled 의미로 margin 1, spacing 2). 남는 슬롯은 투명.
- ``tilemap.json``: gid 1..384 를 위치 순(행 우선)으로 둔다. 같은 조각이 있어도 중복 제거하지 않는다
  (원화 자르기 단계). terrain-detail · roads 는 빈 data.
- 검증: 아틀라스에서 384조각을 다시 조립해 2배 원화와 픽셀 차이 0 을 단언하고, 저장한 PNG 를 다시 열어
  슬롯 내부 == 원화 crop, extrusion 1px 링(4변+모서리) == 타일 가장자리 복제를 384조각 전부 단언한다.
- 결정적: 같은 입력이면 같은 바이트 (PNG 메타데이터 없음).

사용법:
  python3 scripts/build-tile-atlas.py          # v1/ 에 생성
  python3 scripts/build-tile-atlas.py --check  # 임시 경로에 만들어 v1/ 과 비교(JSON 은 바이트, PNG 는 디코드 픽셀), 다르면 exit 1

의존성: ``python3 -m pip install -r scripts/requirements-tile-atlas.txt``
"""

import argparse
import json
import sys
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

VILLAGE = Path(__file__).resolve().parents[1] / "src/assets/village-world"
V1 = VILLAGE / "v1"

TILE = 128  # 2x 타일 한 변 (1x 환산 64)
COLS, ROWS = 24, 16  # 원화 격자
PITCH = TILE + 2  # 1px extrusion 양쪽
ATLAS_COLUMNS = 31  # 31 * 130 = 4030 <= 4096
ATLAS_SIZE = (4096, 2048)
FILES = ["tileset@2x.png", "tileset.json", "tilemap.json", "checks/dock-raft@1x.png"]


def save_png(im, path):
    path.parent.mkdir(parents=True, exist_ok=True)
    im.save(path, format="PNG", compress_level=9)  # 메타데이터 없음 -> 결정적


def write_json(path, data):
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def upscale_2x(im):
    big = im.resize((im.width * 2, im.height * 2), Image.Resampling.LANCZOS)
    # 색만 가볍게 선명화하고 알파는 Lanczos 결과 그대로 둔다.
    rgb = big.convert("RGB").filter(ImageFilter.UnsharpMask(radius=0.65, percent=35, threshold=2))
    rgb.putalpha(big.getchannel("A"))
    return rgb


def first_mismatch(a, b):
    """두 배열의 불일치 개수와 첫 불일치 좌표(y, x)를 돌려준다."""
    bad = np.any(a != b, axis=-1)
    return int(bad.sum()), tuple(int(v) for v in np.argwhere(bad)[0])


def verify_saved(path, high):
    """저장된 PNG 를 다시 열어 슬롯 내부와 extrusion 링을 384조각 전부 검증한다(-O 에서도 유지)."""
    saved = np.asarray(Image.open(path).convert("RGBA"))
    big = np.asarray(high)
    for i in range(COLS * ROWS):
        sx, sy = i % COLS * TILE, i // COLS * TILE
        ax, ay = i % ATLAS_COLUMNS * PITCH, i // ATLAS_COLUMNS * PITCH
        tile = big[sy:sy + TILE, sx:sx + TILE]
        slot = saved[ay:ay + PITCH, ax:ax + PITCH]
        # 내부 = 원화 crop, 링 = 타일을 edge 패딩한 결과(4변 + 모서리 4점).
        for what, got, want in (
            ("내부 != 원화 crop", slot[1:-1, 1:-1], tile),
            ("extrusion 링 불일치", slot, np.pad(tile, ((1, 1), (1, 1), (0, 0)), mode="edge")),
        ):
            if not np.array_equal(got, want):
                n, (y, x) = first_mismatch(got, want)
                where = ""
                if what.startswith("extrusion"):  # 내부는 위 검사에서 통과했으니 링의 어느 변인지만 가린다.
                    parts = {"위": (0, slice(1, -1)), "아래": (-1, slice(1, -1)), "왼": (slice(1, -1), 0), "오른": (slice(1, -1), -1),
                             "모서리": (np.ix_([0, -1], [0, -1]))}
                    bad = [k for k, idx in parts.items() if not np.array_equal(got[idx], want[idx])]
                    where = f", 어긋난 링 부분={'/'.join(bad)}"
                raise SystemExit(
                    f"gid {i + 1} {what}: 아틀라스 슬롯 (ax={ax}, ay={ay}), 원화 (sx={sx}, sy={sy}), "
                    f"첫 불일치 슬롯 내 (y={y}, x={x}), 불일치 픽셀 {n}개{where}"
                )
    print(f"저장 PNG 재검증: 슬롯 {COLS * ROWS}개 내부·extrusion 링 일치")


def same_file(a, b):
    """PNG 는 RGBA 로 맞춘 디코드 픽셀(크기 포함)로, 나머지는 바이트로 비교한다(zlib 차이·팔레트 인덱스 차이로 인한 오판 방지)."""
    if not (a.exists() and b.exists()):
        return False
    if a.suffix == ".png":
        ia, ib = Image.open(a).convert("RGBA"), Image.open(b).convert("RGBA")
        return ia.size == ib.size and ia.tobytes() == ib.tobytes()
    return a.read_bytes() == b.read_bytes()


def build(out):
    base = Image.open(VILLAGE / "terrain.png").convert("RGBA")
    if base.size != (COLS * TILE // 2, ROWS * TILE // 2):
        raise SystemExit(f"terrain.png 크기 {base.size} != {(COLS * TILE // 2, ROWS * TILE // 2)}")
    high = upscale_2x(base)

    atlas = Image.new("RGBA", ATLAS_SIZE)
    slots = []
    for i in range(COLS * ROWS):
        sx, sy = i % COLS * TILE, i // COLS * TILE
        tile = np.asarray(high.crop((sx, sy, sx + TILE, sy + TILE)))
        padded = Image.fromarray(np.pad(tile, ((1, 1), (1, 1), (0, 0)), mode="edge"))
        ax, ay = i % ATLAS_COLUMNS * PITCH, i // ATLAS_COLUMNS * PITCH
        atlas.paste(padded, (ax, ay))
        slots.append((sx, sy, ax + 1, ay + 1))

    # 검증: 아틀라스 -> 재조립 == 2배 원화 (차이 0)
    rebuilt = Image.new("RGBA", high.size)
    for sx, sy, ax, ay in slots:
        rebuilt.paste(atlas.crop((ax, ay, ax + TILE, ay + TILE)), (sx, sy))
    diff = int(np.abs(np.asarray(high).astype(int) - np.asarray(rebuilt).astype(int)).sum())
    if diff:
        n, (y, x) = first_mismatch(np.asarray(high), np.asarray(rebuilt))
        gid = y // TILE * COLS + x // TILE + 1
        raise SystemExit(f"재조립 차이 {diff} != 0: 첫 불일치 원화 (x={x}, y={y}) gid {gid}, 불일치 픽셀 {n}개")
    shrunk = rebuilt.resize(base.size, Image.Resampling.LANCZOS)
    mae = float(np.abs(np.asarray(base.convert("RGB")).astype(float) - np.asarray(shrunk.convert("RGB")).astype(float)).mean())
    print(f"재조립 차이: {diff} (0 이어야 함)")
    print(f"2x -> 1x 축소 vs 원본 terrain.png MAE: {mae:.4f}/255 (참고값)")

    save_png(atlas, out / "tileset@2x.png")
    verify_saved(out / "tileset@2x.png", high)

    write_json(out / "tileset.json", {
        "//": "terrain.png 를 Lanczos 2배로 올려 128px 로 자른 @2x 아틀라스(1x 환산 64px). 최상위 scale 은 Tiled 비표준 확장이며 2230 TileTerrainCanvas 가 읽는 계약이다(Tiled 보존용은 properties 의 scale). 생성: scripts/build-tile-atlas.py",
        "name": "home-terrain",
        "image": "tileset@2x.png",
        "imagewidth": ATLAS_SIZE[0],
        "imageheight": ATLAS_SIZE[1],
        "tilewidth": TILE,
        "tileheight": TILE,
        "margin": 1,
        "spacing": 2,
        "columns": ATLAS_COLUMNS,
        "tilecount": COLS * ROWS,
        "scale": 2,
        "properties": [{"name": "scale", "type": "int", "value": 2}],
    })

    def layer(name, data):
        return {"type": "tilelayer", "name": name, "width": COLS, "height": ROWS, "data": data}

    write_json(out / "tilemap.json", {
        "//": "gid 는 위치 순(행 우선) 1..384. 같은 그림 조각도 중복 제거하지 않는다(원화 자르기 단계). terrain-detail·roads 는 비어 있다.",
        "$schema-note": "terrain-detail·roads 의 data: [] 는 Tiled 규격상 비표준(원래 길이 384 의 0 배열)이다. 로더(TileTerrainCanvas)가 [] 를 빈 레이어로 다룬다는 전제로 쓴다.",
        "type": "map",
        "orientation": "orthogonal",
        "renderorder": "right-down",
        "width": COLS,
        "height": ROWS,
        "tilewidth": 64,
        "tileheight": 64,
        "layers": [
            layer("terrain", list(range(1, COLS * ROWS + 1))),
            layer("terrain-detail", []),
            layer("roads", []),
        ],
        "tilesets": [{"firstgid": 1, "source": "tileset.json"}],
    })

    # 확인 컷: 재조립 지형(1x) 위에 부두를 올리고 뗏목 hitbox 를 빨간 테두리로 표시한다.
    world = json.loads((VILLAGE / "map.json").read_text(encoding="utf-8"))
    d = world["crossings"]["dock"]
    canvas = shrunk.copy()
    # dock.png 는 정사각 원본이라 crossings.dock 의 w x h 로 맞춰 그린다.
    dock = Image.open(VILLAGE / "dock.png").convert("RGBA").resize((d["w"], d["h"]), Image.Resampling.LANCZOS)
    canvas.alpha_composite(dock, (d["x"], d["y"]))
    ImageDraw.Draw(canvas).rectangle((200, 815, 200 + 180, 815 + 110), outline=(255, 0, 0, 255), width=2)
    # 확인 컷은 200KB 이하여야 해서 256색으로 줄인다(확인용 그림이라 충분).
    cut = canvas.crop((60, 540, 480, 960)).convert("RGB").quantize(256, Image.Quantize.MEDIANCUT)
    save_png(cut, out / "checks/dock-raft@1x.png")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args()
    if not args.check:
        build(V1)
        return
    with tempfile.TemporaryDirectory() as tmp:
        build(Path(tmp))
        bad = [f for f in FILES if not same_file(V1 / f, Path(tmp) / f)]
    if bad:
        print("v1/ 이 최신이 아님: " + ", ".join(bad) + " (npm run gen:tile-atlas)", file=sys.stderr)
        sys.exit(1)
    print("tile-atlas 산출물이 최신이다")


if __name__ == "__main__":
    main()
