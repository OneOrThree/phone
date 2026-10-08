"""blueprint-ready-stamp-v3.ko.png("준비 완료" 도장) 의 영문판을 결정적으로 생성한다 (GROMO-2240).

- 입력 ``<이름>.ko.png`` 에서 ① 불투명 픽셀의 채널별 중앙값으로 붉은 잉크색을 뽑고
  (중앙값과 멀리 떨어진 픽셀이 5% 를 넘으면 "두 색 도장"으로 실패) ② 중심에서
  반지름별 각도 채움 비율로 가장 바깥의 두 개 띠(이중 원 테두리)를 찾아 그 안쪽을
  투명하게 지워 글자를 없앤다(테두리 자체는 원본 픽셀 그대로 보존, 띠 개수·폭·간격이
  기대를 벗어나면 실패) ③ 빈 원 안에 굵은 글꼴로 READY 를 중앙 정렬해 찍는다(글꼴이
  없으면 --check 는 바로 실패하고, 생성도 --allow-fallback-font 없이는 실패한다 — 있으면
  커밋 경로 대신 미리보기 파일에만 쓴다) ④ 가장자리를 1px 침식하고 고정 시드 잡음을
  알파에 곱해 원본의 거친 잉크 질감을 흉내 낸다.
- 결정적: 잡음 시드 고정 + PNG 메타데이터 없이 저장 -> 같은 입력이면 같은 픽셀.
- --check: 메모리에서 다시 만들어 커밋된 ``<이름>.en.png`` 와 디코드 픽셀로 비교
  (build-tile-atlas.py 관례 — zlib 압축 구현 차이로 인한 거짓 실패를 피한다), 다르면 exit 1.

사용법:
  python3 scripts/gen-localized-stamp.py                      # .en.png 생성
  python3 scripts/gen-localized-stamp.py --check               # 픽셀 비교만(다르면 exit 1)
  python3 scripts/gen-localized-stamp.py --font <경로>          # READY 글꼴 교체(기본 Impact)
  python3 scripts/gen-localized-stamp.py --allow-fallback-font  # 글꼴 없어도 폴백 글꼴로
                                                                 # <이름>.en.fallback-preview.png 생성

종료 코드: 0 정상 / 1 테두리 기하 이상·색 불균일·--check 불일치 / 2 글꼴 없음
(생성은 --allow-fallback-font 로 우회 가능, --check 는 우회 불가 — 비교 기준이 흔들리면 안 됨).

의존성: Pillow(scripts/requirements-tile-atlas.txt 에 고정된 버전 — 새 requirements 없음, 설치된
버전이 다르면 경고만 찍는다). 설치: ``python3 -m pip install -r scripts/requirements-tile-atlas.txt``
— requirements-night-motion.txt(pillow 11.3.0) 와 한 venv 에 같이 못 깐다, 필요하면 별도 venv 로.
"""

import argparse
import io
import math
import random
import sys
from pathlib import Path

import PIL
from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont

UI_DIR = Path(__file__).resolve().parents[1] / "src/assets/interiors/ui"
KO_PATH = UI_DIR / "blueprint-ready-stamp-v3.ko.png"
EN_PATH = UI_DIR / "blueprint-ready-stamp-v3.en.png"
# 글꼴 없이 폴백 생성한 결과물 — 커밋 대상(EN_PATH)을 덮어쓰지 않고 여기 따로 쓴다(.gitignore 처리됨).
EN_FALLBACK_PREVIEW_PATH = UI_DIR / "blueprint-ready-stamp-v3.en.fallback-preview.png"
REQUIREMENTS_FILE = Path(__file__).resolve().parent / "requirements-tile-atlas.txt"
DEFAULT_FONT = "/System/Library/Fonts/Supplemental/Impact.ttf"
TEXT = "READY"
SEED = 20240  # 잡음 마스크 고정 시드 -> 결정적 출력
ALPHA_THRESH = 10  # 이보다 큰 알파만 "불투명 픽셀"로 취급(안티앨리어싱 잔여 무시)
COLOR_DIST_THRESH = 30  # RGB 유클리드 거리 — 실측 ko 그런지 p95≈14 보다 넉넉히 여유를 둠(20 은 과적합이었음)
FILL_THRESH = 0.8  # 이 비율 이상 각도가 불투명해야 "테두리 띠"로 인정(점 하나짜리 오탐 방지)
ANGLE_SAMPLES = 360
EXPECTED_BAND_WIDTH = (3, 20)  # px — 실측(바깥 8px, 안쪽 4px)에 여유를 둔 범위
EXPECTED_BAND_GAP = (3, 25)  # px — 실측 11px 에 여유를 둔 범위


def opaque_pixels(im):
    px = im.load()
    w, h = im.size
    return [(x, y) for y in range(h) for x in range(w) if px[x, y][3] > ALPHA_THRESH]


def geometry_fail(msg):
    """도장 기하·색 가정이 깨졌을 때 어느 상수를 점검할지 덧붙여 즉시 종료한다(exit 1)."""
    raise SystemExit(
        f"{msg} — 원본 도장 기하가 바뀌었다면 FILL_THRESH/EXPECTED_BAND_WIDTH/"
        "EXPECTED_BAND_GAP/COLOR_DIST_THRESH 를 점검(스크립트 docstring 참조)"
    )


def ink_color(im, opaque):
    """불투명(알파>200) 픽셀의 채널별 중앙값 -> 원본과 같은 붉은색.

    중앙값과 거리가 COLOR_DIST_THRESH 를 넘는 불투명 픽셀이 5% 를 넘으면
    빨강 하나가 아니라 두 색을 쓰는 도장으로 보고 실패한다(이 스크립트는
    단색 잉크 도장만 다룬다).
    """
    px = im.load()
    strong = [(x, y) for x, y in opaque if px[x, y][3] > 200]
    if not strong:
        geometry_fail("불투명(알파>200) 픽셀이 없어 잉크색을 추출할 수 없음")

    channels = [sorted(px[x, y][c] for x, y in strong) for c in range(3)]
    mid = len(strong) // 2
    color = tuple(ch[mid] for ch in channels)

    far = sum(1 for x, y in strong if math.dist(px[x, y][:3], color) > COLOR_DIST_THRESH)
    if far / len(strong) > 0.05:
        geometry_fail(
            f"잉크색이 고르지 않음(중앙값과 거리>{COLOR_DIST_THRESH} 인 픽셀 "
            f"{far / len(strong):.1%}) — 두 색 도장으로 의심됨"
        )
    return color


def angular_fill(im, cx, cy, r, samples=ANGLE_SAMPLES):
    """반지름 r 인 원 위 samples 개 각도 중 불투명 픽셀의 비율."""
    px = im.load()
    w, h = im.size
    hit = 0
    for k in range(samples):
        theta = 2 * math.pi * k / samples
        x = round(cx + r * math.cos(theta))
        y = round(cy + r * math.sin(theta))
        if 0 <= x < w and 0 <= y < h and px[x, y][3] > ALPHA_THRESH:
            hit += 1
    return hit / samples


def ring_geometry(im, opaque):
    """중심과, 이중 원 테두리 안쪽 경계 반지름을 찾는다.

    중심은 불투명 픽셀 bbox 의 중앙. 각 정수 반지름에서 각도별 불투명 비율
    (angular_fill)이 FILL_THRESH 이상이어야 "테두리 띠"로 본다 — 픽셀 하나만
    있어도 그 반지름 전체가 잡히던 이전 방식과 달리, 글자 획처럼 일부 각도에만
    있는 모양은 이 기준을 넘지 않는다. 바깥에서 안으로 훑어 모은 띠가 정확히
    2개이고 폭·간격이 기대 범위 안일 때만 이중 원으로 인정해 그 안쪽(글자 +
    내부 잡음)을 지운다. 기대를 벗어나면 조용히 넘어가지 않고 즉시 실패한다.
    """
    xs = [x for x, _ in opaque]
    ys = [y for _, y in opaque]
    cx, cy = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2
    max_r = round(max(math.hypot(x - cx, y - cy) for x, y in opaque))

    has_r = [angular_fill(im, cx, cy, r) >= FILL_THRESH for r in range(max_r + 1)]

    bands = []  # 바깥 -> 안쪽 순, (바깥반지름, 안쪽반지름)
    run_hi = None
    for r in range(max_r, -1, -1):
        if has_r[r]:
            if run_hi is None:
                run_hi = r
        elif run_hi is not None:
            bands.append((run_hi, r + 1))
            run_hi = None
    if run_hi is not None:
        bands.append((run_hi, 0))

    if len(bands) != 2:
        geometry_fail(f"이중 원 테두리를 못 찾음(띠 {len(bands)}개, 기대 2개): {bands}")

    (hi0, lo0), (hi1, lo1) = bands
    w0, w1 = hi0 - lo0 + 1, hi1 - lo1 + 1
    gap = lo0 - hi1 - 1
    lo, hi = EXPECTED_BAND_WIDTH
    if not (lo <= w0 <= hi and lo <= w1 <= hi):
        geometry_fail(f"테두리 띠 폭이 기대 범위({lo}~{hi}px) 밖: 바깥 {w0}px, 안쪽 {w1}px")
    lo, hi = EXPECTED_BAND_GAP
    if not (lo <= gap <= hi):
        geometry_fail(f"테두리 띠 간격이 기대 범위({lo}~{hi}px) 밖: {gap}px")

    return cx, cy, lo1  # 안쪽(두 번째) 띠의 안쪽 경계부터 바깥은 보존


def clear_inside(im, cx, cy, radius):
    px = im.load()
    w, h = im.size
    for y in range(h):
        for x in range(w):
            if math.hypot(x - cx, y - cy) < radius:
                px[x, y] = (0, 0, 0, 0)


def font_available(path):
    try:
        ImageFont.truetype(path, 10)
        return True
    except OSError:
        return False


def load_font(path, size):
    try:
        return ImageFont.truetype(path, size)
    except OSError:
        return ImageFont.load_default(size=size)


def fit_text(draw, font_path, max_corner):
    """빈 원(반지름 max_corner) 안에 READY 가 들어가는 가장 큰 폰트 크기를 찾는다.

    텍스트 bbox 의 중심에서 모서리까지 거리가 max_corner 를 넘지 않는 가장 큰
    크기를 2px 단위로 내려가며 찾는다(원형 영역 제약이라 모서리 거리 기준).
    최소 크기에서도 안 맞으면 경고만 찍고 그 크기를 그대로 쓴다.
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

    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    if math.hypot(tw / 2, th / 2) > max_corner:
        print(
            f"경고: 최소 크기({size}pt)에서도 READY 가 반지름 {max_corner:.0f} 안에 안 들어감 — 그대로 사용",
            file=sys.stderr,
        )
    return font, bbox


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


def warn_pillow_version():
    """requirements-tile-atlas.txt 에 고정된 Pillow 버전과 다르면 경고만 찍는다(실패 아님) —
    아틀라스 스크립트와 같은 버전이어야 픽셀 결과가 재현된다는 전제를 공유한다."""
    try:
        text = REQUIREMENTS_FILE.read_text(encoding="utf-8")
    except OSError:
        return
    for line in text.splitlines():
        if line.startswith("pillow=="):
            expected = line.split("==", 1)[1].strip()
            if PIL.__version__ != expected:
                print(
                    f"경고: 설치된 Pillow {PIL.__version__} 이 {REQUIREMENTS_FILE.name} 고정 버전 "
                    f"{expected} 과 다름 — 생성 픽셀이 달라질 수 있음",
                    file=sys.stderr,
                )
            return


def same_pixels(png_bytes, path):
    """PNG 를 RGBA 디코드 픽셀(크기 포함)로 비교한다 — build-tile-atlas.py 관례와 동일하게,
    zlib 압축 구현 차이로 바이트는 달라도 그림은 같은 경우의 거짓 실패를 피한다."""
    if not path.exists():
        return False
    a = Image.open(io.BytesIO(png_bytes)).convert("RGBA")
    b = Image.open(path).convert("RGBA")
    return a.size == b.size and a.tobytes() == b.tobytes()


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
    ap.add_argument("--check", action="store_true", help="커밋된 .en.png 와 디코드 픽셀 비교만 한다")
    ap.add_argument("--font", default=DEFAULT_FONT, help="READY 를 찍을 글꼴 경로")
    ap.add_argument(
        "--allow-fallback-font",
        action="store_true",
        help="글꼴을 못 찾아도 Pillow 기본 글꼴로 생성을 계속한다(결과 품질 저하 감수)",
    )
    args = ap.parse_args()

    warn_pillow_version()

    if not KO_PATH.exists():
        raise SystemExit(f"{KO_PATH} 없음")

    fallback = not font_available(args.font)
    if fallback:
        if args.check:
            # --check 는 비교 기준(글꼴)이 없으면 성립하지 않는다 — 폴백으로 "최신" 판정을 내지 않는다.
            print(f"글꼴 없음 — 비교 불가({args.font})", file=sys.stderr)
            sys.exit(2)
        if not args.allow_fallback_font:
            print(
                f"글꼴 없음({args.font}) — 폴백 글꼴로 생성하려면 --allow-fallback-font 를 명시해라",
                file=sys.stderr,
            )
            sys.exit(2)
        print(f"경고: 글꼴 {args.font} 를 찾을 수 없어 Pillow 기본 글꼴로 폴백합니다", file=sys.stderr)

    out = render(args.font)

    if args.check:
        if not same_pixels(out, EN_PATH):
            print(f"{EN_PATH} 이 최신이 아님 (npm run gen:localized-stamp)", file=sys.stderr)
            sys.exit(1)
        print("localized-stamp 산출물이 최신이다")
        return

    if fallback:
        # 폴백 글꼴 결과는 커밋 대상 EN_PATH 를 덮어쓰지 않는다 — 품질이 떨어질 수 있어 미리보기로만 남긴다.
        EN_FALLBACK_PREVIEW_PATH.write_bytes(out)
        print(f"{EN_FALLBACK_PREVIEW_PATH} 생성 — 미리보기용, 커밋 대상 아님")
        return

    EN_PATH.write_bytes(out)
    print(f"{EN_PATH} 생성")


if __name__ == "__main__":
    main()
