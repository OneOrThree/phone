"""홈 섬 시설 그림을 화면에 보이는 크기만큼만 잘라 디코드 메모리를 줄인다 (GROMO-2378).

디코드 메모리는 파일 크기와 무관하게 가로x세로x4바이트다. 1536x1024 레이어 한 장이 6MB 인데
실제 그림은 수십~수백 px 이라, 시설마다 아래 세 가지 작은 그림을 만들어 쓴다.

- 건물 그림(게시판·축음기·우체통, 낮·밤): ``backgrounds/island/layers/<시간>/<이름>.png``(1536x1024)를
  ``tileFacilities.ts`` 의 TILE_FACILITIES rect 로 무손실 자른다 -> ``village-world/facility/<id>-<시간>.png``.
  rect 가 곧 원화 좌표의 자르기 오프셋이다(placement.json rect 와 같아야 한다). rect 밖에 불투명 픽셀이
  하나라도 있으면 실패한다 — 자르기로 그림이 잘리면 안 된다. 회관·전망대·상점·도서관은 이미 같은 rect 로
  잘린 모션 첫 프레임(``motion/<건물>/frame-0.png``)을 쓴다.
- 외곽선(건물 7 + 펠리컨 우체통, 낮·밤): 기존 네이티브 외곽선은 같은 그림을 8방향으로 outlineWidth(pt)씩
  밀어 크림색 tint 로 8장 겹쳤다. 그 합성 알파(1 - Π(1 - a_i))를 기준 화면(402x874 세로, 홈 기본 배율
  BASE_REF)에서 원화 px 로 환산한 거리 R 로 한 번 계산해 흰색+알파 마스크 한 장으로 저장한다
  -> ``village-world/facility/outline/<id>-<시간>.png``. rect 사방에 OUTLINE_MARGIN px 여백을 둔다
  (TileFacilityDecoration.tsx TILE_FACILITY_OUTLINE_MARGIN 과 같아야 한다). 색은 런타임 tintColor 가 입힌다.
- 지형 시설(모닥불·뗏목, 낮·밤): ``backgrounds/island/ocean/home-<시간>.png`` 를 TILE_FACILITIES rect 로
  자른다 -> ``village-world/facility/terrain/<id>-<시간>.png`` (ImageTerrainFacilities 의 클립 안 그림).
- 결정적: 같은 입력이면 같은 픽셀(PNG 메타데이터 없음).

componentTokens.tileFacility.outlineWidth(OUTLINE_PT)나 홈 기본 배율(BASE_REF)이 바뀌면 다시 생성한다.

사용법:
  python3 scripts/build-facility-crops.py          # village-world/facility/ 에 생성
  python3 scripts/build-facility-crops.py --check  # 메모리에서 다시 만들어 디코드 픽셀로 비교, 다르면 exit 1

의존성: ``python3 -m pip install -r scripts/requirements-tile-atlas.txt``
"""

import argparse
import re
import sys
from pathlib import Path

import numpy as np
from PIL import Image

APP = Path(__file__).resolve().parents[1]
ASSETS = APP / "src/assets"
OUT = ASSETS / "village-world/facility"
TIMES = ("day", "night")
# 건물 id -> 1536x1024 레이어 파일명(정적 그림을 이 스크립트가 자르는 건물)
LAYERS = {"board": "notice-board", "gram": "gramophone", "mail": "mailbox"}
# 건물 id -> 이미 rect 로 잘린 모션 프레임 폴더
MOTION = {"hall": "hall", "tower": "observatory", "shop": "shop", "library": "library"}
TERRAIN = ("fire", "raft")
PELICAN = ASSETS / "characters/pelican/npc/on-mailbox.png"

OUTLINE_PT = 2  # componentTokens.tileFacility.outlineWidth (stroke.strong)
BASE_REF = 402 / 1536 * 2.8  # WorldMap 홈 기본 배율, 기준 화면 402x874 세로
OUTLINE_R = OUTLINE_PT / BASE_REF  # 원화 px 로 환산한 외곽선 밀기 거리(≈2.73)
OUTLINE_MARGIN = 4  # 외곽선 마스크의 rect 바깥 여백(px). R + 보간 1px 보다 커야 한다.
OFFSETS = [(dx, dy) for dy in (-1, 0, 1) for dx in (-1, 0, 1) if dx or dy]


def facility_rects():
    """tileFacilities.ts 의 TILE_FACILITIES·TILE_MAILBOX_PELICAN_RECT 를 그대로 읽는다(좌표 원본은 한 곳)."""
    src = (APP / "src/screens/island/tileFacilities.ts").read_text(encoding="utf-8")
    rect = r"\{ x: (\d+), y: (\d+), w: (\d+), h: (\d+) \}"
    block = re.search(r"TILE_FACILITIES[^=]*= \{(.*?)\n\};", src, re.S).group(1)
    rects = {m[0]: tuple(map(int, m[1:])) for m in re.findall(r"(\w+): " + rect, block)}
    rects["mail-pelican"] = tuple(map(int, re.search(r"TILE_MAILBOX_PELICAN_RECT[^=]*= " + rect, src).groups()))
    return rects


def rgba(path):
    return Image.open(path).convert("RGBA")


def crop_layer(path, rect):
    """1536x1024 레이어를 rect 로 자른다. rect 밖에 그림이 남으면 실패한다."""
    x, y, w, h = rect
    im = rgba(path)
    alpha = np.asarray(im)[..., 3].copy()
    alpha[y:y + h, x:x + w] = 0
    if alpha.any():
        sys.exit(f"{path.name}: rect {rect} 밖에 불투명 픽셀이 있다 — tileFacilities.ts rect 를 확인")
    return im.crop((x, y, x + w, y + h))


def shift(a, s, axis):
    """a 를 axis 방향으로 s px(소수 가능) 민다. 소수부는 선형 보간."""
    i = int(np.floor(s))
    f = s - i
    return (1 - f) * np.roll(a, i, axis) + f * np.roll(a, i + 1, axis)


def outline_mask(im):
    """rect 크기 그림 -> 8방향으로 OUTLINE_R 만큼 민 알파의 합성(흰색+알파, 사방 OUTLINE_MARGIN 여백)."""
    m = OUTLINE_MARGIN
    a = np.pad(np.asarray(im)[..., 3] / 255.0, m)
    keep = np.ones_like(a)
    for dx, dy in OFFSETS:
        keep *= 1 - shift(shift(a, dx * OUTLINE_R, 1), dy * OUTLINE_R, 0)
    alpha = np.round((1 - keep) * 255).astype(np.uint8)
    edge = np.concatenate([alpha[0], alpha[-1], alpha[:, 0], alpha[:, -1]])
    assert not edge.any(), "외곽선이 여백 밖으로 나간다 — OUTLINE_MARGIN 을 키운다"
    return Image.merge("LA", (Image.new("L", alpha.shape[::-1], 255), Image.fromarray(alpha)))


def build():
    """출력 상대 경로 -> 그림."""
    rects = facility_rects()
    out = {}
    for t in TIMES:
        ocean = rgba(ASSETS / f"backgrounds/island/ocean/home-{t}.png")
        for fid in TERRAIN:
            x, y, w, h = rects[fid]
            out[f"terrain/{fid}-{t}.png"] = ocean.crop((x, y, x + w, y + h))
        for fid, name in LAYERS.items():
            im = crop_layer(ASSETS / f"backgrounds/island/layers/{t}/{name}.png", rects[fid])
            out[f"{fid}-{t}.png"] = im
            out[f"outline/{fid}-{t}.png"] = outline_mask(im)
        for fid, folder in MOTION.items():
            frame = rgba(ASSETS / f"village-world/motion/{folder}/{'night-' if t == 'night' else ''}frame-0.png")
            assert frame.size == rects[fid][2:], f"{fid}: 모션 프레임 크기가 rect 와 다르다"
            out[f"outline/{fid}-{t}.png"] = outline_mask(frame)
    # 펠리컨은 512px 그림을 rect(140x140)에 늘려 그린다 — 같은 크기로 줄인 뒤 외곽선을 만든다.
    w, h = rects["mail-pelican"][2:]
    out["outline/mail-pelican.png"] = outline_mask(rgba(PELICAN).resize((w, h), Image.Resampling.LANCZOS))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args()
    files = build()
    if not args.check:
        for rel, im in files.items():
            path = OUT / rel
            path.parent.mkdir(parents=True, exist_ok=True)
            im.save(path, format="PNG", optimize=True)  # 메타데이터 없음 -> 결정적
        print(f"{len(files)}개 생성: {OUT.relative_to(APP)}")
        return
    bad = []
    for rel, im in files.items():
        path = OUT / rel
        if not path.exists() or Image.open(path).mode != im.mode or not np.array_equal(
            np.asarray(Image.open(path)), np.asarray(im)
        ):
            bad.append(rel)
    if bad:
        print("facility/ 이 최신이 아님: " + ", ".join(bad) + " (npm run gen:facility-crops)", file=sys.stderr)
        sys.exit(1)
    print("facility 산출물이 최신이다")


if __name__ == "__main__":
    main()
