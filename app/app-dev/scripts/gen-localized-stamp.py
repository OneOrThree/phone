"""blueprint-ready-stamp-v3.ko.png("준비 완료" 도장) 의 영문판을 결정적으로 생성한다 (GROMO-2240).

- 입력 ``<이름>.ko.png`` 에서 ① 불투명 픽셀의 채널별 중앙값으로 붉은 잉크색을 뽑고
  ② 중심에서 바깥으로 반지름별 불투명 여부를 모아 가장 바깥의 두 개 띠(이중 원 테두리)를
  찾아 그 안쪽을 투명하게 지워 글자를 없앤다(테두리 자체는 원본 픽셀 그대로 보존)
  ③ 빈 원 안에 굵은 글꼴로 READY 를 중앙 정렬해 찍는다
  ④ 가장자리를 1px 침식하고 고정 시드 잡음을 알파에 곱해 원본의 거친 잉크 질감을 흉내 낸다.
- 결정적: 잡음 시드 고정 + PNG 메타데이터 없이 저장 -> 같은 입력이면 같은 바이트.
- --check: 메모리에서 다시 만들어 커밋된 ``<이름>.en.png`` 와 바이트 비교, 다르면 exit 1.

사용법:
  python3 scripts/gen-localized-stamp.py              # .en.png 생성
  python3 scripts/gen-localized-stamp.py --check       # 바이트 비교만(다르면 exit 1)
  python3 scripts/gen-localized-stamp.py --font <경로>  # READY 글꼴 교체(기본 Impact)

의존성: Pillow(이미 scripts/requirements-tile-atlas.txt 에 고정된 버전 — 새 requirements 없음).
"""

import argparse
import io
import math
import random
import sys
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont

UI_DIR = Path(__file__).resolve().parents[1] / "src/assets/interiors/ui"
KO_PATH = UI_DIR / "blueprint-ready-stamp-v3.ko.png"
EN_PATH = UI_DIR / "blueprint-ready-stamp-v3.en.png"
DEFAULT_FONT = "/System/Library/Fonts/Supplemental/Impact.ttf"
TEXT = "READY"
SEED = 20240  # 잡음 마스크 고정 시드 -> 결정적 출력
ALPHA_THRESH = 10  # 이보다 큰 알파만 "불투명 픽셀"로 취급(안티앨리어싱 잔여 무시)
MIN_BAND = 4  # 이 폭(px) 이상인 반지름 구간만 테두리 띠로 인정(그런지 잡음에 의한 오탐 제거)


def opaque_pixels(im):
    px = im.load()
    w, h = im.size
    return [(x, y) for y in range(h) for x in range(w) if px[x, y][3] > ALPHA_THRESH]


def ink_color(im, opaque):
    """불투명(알파>200) 픽셀의 채널별 중앙값 -> 원본과 같은 붉은색."""
    px = im.load()
    strong = [(x, y) for x, y in opaque if px[x, y][3] > 200]
    channels = [sorted(px[x, y][c] for x, y in strong) for c in range(3)]
    mid = len(strong) // 2
    return tuple(ch[mid] for ch in channels)


def ring_geometry(im, opaque):
    """중심과, 이중 원 테두리 안쪽 경계 반지름을 찾는다.

    중심은 불투명 픽셀 bbox 의 중앙. 중심에서 각 정수 반지름에 불투명 픽셀이
    하나라도 있는지(각도 무관)로 1차원 점유 배열을 만들고, 바깥에서 안으로
    훑으며 MIN_BAND 이상 폭의 "있음" 구간(띠)을 테두리로 센다. 가장 바깥 두
    띠가 이중 원이고, 그보다 안쪽(글자 + 내부 잡음)을 지운다.
    """
    xs = [x for x, _ in opaque]
    ys = [y for _, y in opaque]
    cx, cy = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2

    has_r = set()
    max_r = 0
    for x, y in opaque:
        r = round(math.hypot(x - cx, y - cy))
        has_r.add(r)
        max_r = max(max_r, r)

    bands = []  # 바깥 -> 안쪽 순, (바깥반지름, 안쪽반지름)
    run_hi = None
    for r in range(max_r, -1, -1):
        if r in has_r:
            if run_hi is None:
                run_hi = r
        else:
            if run_hi is not None and run_hi - r >= MIN_BAND:
                bands.append((run_hi, r + 1))
            run_hi = None
    if run_hi is not None and run_hi + 1 >= MIN_BAND:
        bands.append((run_hi, 0))

    if len(bands) < 2:
        raise SystemExit(f"이중 원 테두리를 찾지 못함(띠 {len(bands)}개) — MIN_BAND 조정 필요")
    return cx, cy, bands[1][1]  # 두 번째(안쪽) 띠의 안쪽 경계부터 바깥은 보존


def clear_inside(im, cx, cy, radius):
    px = im.load()
    w, h = im.size
    for y in range(h):
        for x in range(w):
            if math.hypot(x - cx, y - cy) < radius:
                px[x, y] = (0, 0, 0, 0)


def load_font(path, size):
    try:
        return ImageFont.truetype(path, size)
    except OSError:
        print(f"경고: 글꼴 {path} 를 찾을 수 없어 Pillow 기본 글꼴로 폴백합니다", file=sys.stderr)
        return ImageFont.load_default(size=size)


def fit_text(draw, font_path, max_corner):
    """빈 원(반지름 max_corner) 안에 READY 가 들어가는 가장 큰 폰트 크기를 찾는다.

    텍스트 bbox 의 중심에서 모서리까지 거리가 max_corner 를 넘지 않는 가장 큰
    크기를 2px 단위로 내려가며 찾는다(원형 영역 제약이라 모서리 거리 기준).
    """
    size = 140
    font = load_font(font_path, size)
    bbox = draw.textbbox((0, 0), TEXT, font=font)
    while size > 20:
        tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
        if math.hypot(tw / 2, th / 2) <= max_corner:
            return font, bbox
        size -= 2
        font = load_font(font_path, size)
        bbox = draw.textbbox((0, 0), TEXT, font=font)
    return font, bbox  # 최소 크기도 못 맞으면 그냥 최소 크기로


def grunge(alpha_img):
    """가장자리를 1px 침식하고 고정 시드 잡음을 곱해 거친 잉크 질감을 흉내 낸다.

    원본은 획 속이 대부분 꽉 찬 채(알파>=200 이 72%) 군데군데 작은 반점으로
    잉크가 긁혀 비친다(알파<=50 이 7%) — 전체를 고르게 흐리면 이 모래 질감
    대신 뿌연 얼룩이 된다. 그래서 ① 옅은 전체 잡음(거의 불투명 유지)과
    ② 2px 블록 단위로 듬성듬성 뚫는 반점을 따로 곱한다.
    """
    eroded = alpha_img.filter(ImageFilter.MinFilter(3))
    w, h = alpha_img.size
    rng = random.Random(SEED)

    fine = bytes(rng.randint(225, 255) for _ in range(w * h))
    out = ImageChops.multiply(eroded, Image.frombytes("L", (w, h), fine))

    cell = 2  # 반점이 한 픽셀보다 조금 크게 뭉치도록 블록 단위로 뚫는다
    cw, ch = (w + cell - 1) // cell, (h + cell - 1) // cell
    blocky = bytes(255 if rng.random() > 0.1 else rng.randint(0, 60) for _ in range(cw * ch))
    holes = Image.frombytes("L", (cw, ch), blocky).resize((w, h), Image.Resampling.NEAREST)
    return ImageChops.multiply(out, holes)


def render(font_path):
    im = Image.open(KO_PATH).convert("RGBA")
    opaque = opaque_pixels(im)
    color = ink_color(im, opaque)
    cx, cy, keep_from = ring_geometry(im, opaque)
    clear_inside(im, cx, cy, keep_from)

    layer = Image.new("RGBA", im.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    font, bbox = fit_text(draw, font_path, keep_from * 0.92)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    pos = (cx - tw / 2 - bbox[0], cy - th / 2 - bbox[1])
    draw.text(pos, TEXT, font=font, fill=(*color, 255))
    layer.putalpha(grunge(layer.getchannel("A")))

    im = Image.alpha_composite(im, layer)
    buf = io.BytesIO()
    im.save(buf, format="PNG", compress_level=9)  # 메타데이터 없음 -> 결정적
    return buf.getvalue()


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--check", action="store_true", help="커밋된 .en.png 와 바이트 비교만 한다")
    ap.add_argument("--font", default=DEFAULT_FONT, help="READY 를 찍을 글꼴 경로")
    args = ap.parse_args()

    if not KO_PATH.exists():
        raise SystemExit(f"{KO_PATH} 없음")
    out = render(args.font)

    if args.check:
        if not EN_PATH.exists() or EN_PATH.read_bytes() != out:
            print(f"{EN_PATH} 이 최신이 아님 (npm run gen:localized-stamp)", file=sys.stderr)
            sys.exit(1)
        print("localized-stamp 산출물이 최신이다")
        return

    EN_PATH.write_bytes(out)
    print(f"{EN_PATH} 생성")


if __name__ == "__main__":
    main()
