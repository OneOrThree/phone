#!/usr/bin/env python3
"""gromo App Store 소개 이미지를 실제 시뮬레이터 캡처로 합성한다."""

from __future__ import annotations

from pathlib import Path
from typing import NamedTuple

from PIL import Image, ImageDraw, ImageFilter, ImageFont


ROOT = Path(__file__).resolve().parents[3]
DOCS = ROOT / ".docs" / "app-imgs"
CAPTURES = DOCS / "captures"
FINAL = DOCS / "final"
ASSETS = ROOT / "app" / "src" / "assets"
FONT = "/System/Library/Fonts/AppleSDGothicNeo.ttc"


class Slide(NamedTuple):
    key: str
    title: str
    subtitle: str
    bg_top: str
    bg_bottom: str
    ink: str
    accent: str
    character: str | None = None


SLIDES = [
    Slide(
        "home",
        "집중할수록,\n더 자라요",
        "폰 사용은 줄이고 집중 습관은 키우는 gromo",
        "#F7F5EE",
        "#EEEAFB",
        "#202235",
        "#5E6AD2",
        "character_happy.png",
    ),
    Slide(
        "focus",
        "폰은 내려놓고,\n몰입은 깊게",
        "카운트업 · 카운트다운 · 뽀모도로 집중",
        "#171B31",
        "#252B49",
        "#FFFFFF",
        "#8993F2",
        "character_study.png",
    ),
    Slide(
        "stats",
        "오늘의 변화를\n한눈에",
        "집중시간과 과목별 기록을 보기 쉽게",
        "#F5F4FC",
        "#E9EDF9",
        "#202235",
        "#5E6AD2",
    ),
    Slide(
        "result",
        "작은 집중도\n성취로 남아요",
        "집중을 마칠 때마다 기록과 스트릭 확인",
        "#F1F8F2",
        "#E7F1ED",
        "#202235",
        "#4F9A63",
        "character_happy.png",
    ),
    Slide(
        "tier",
        "집중이 쌓이면,\n레벨이 올라요",
        "리그와 티어 보상으로 꾸준한 동기부여",
        "#FAF5E8",
        "#F0E9DB",
        "#202235",
        "#B47B28",
    ),
]


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    # AppleSDGothicNeo.ttc: 0=Regular, 6=Bold 계열. 환경에 따라 실패하면 기본 face 사용.
    try:
        return ImageFont.truetype(FONT, size=size, index=6 if bold else 0)
    except OSError:
        return ImageFont.truetype(FONT, size=size)


def hex_rgb(value: str) -> tuple[int, int, int]:
    value = value.lstrip("#")
    return tuple(int(value[i : i + 2], 16) for i in (0, 2, 4))


def gradient(size: tuple[int, int], top: str, bottom: str) -> Image.Image:
    w, h = size
    a, b = hex_rgb(top), hex_rgb(bottom)
    out = Image.new("RGB", size)
    px = out.load()
    for y in range(h):
        t = y / max(h - 1, 1)
        color = tuple(round(a[i] * (1 - t) + b[i] * t) for i in range(3))
        for x in range(w):
            px[x, y] = color
    return out


def rounded_image(image: Image.Image, radius: int) -> Image.Image:
    mask = Image.new("L", image.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, image.width, image.height), radius=radius, fill=255)
    out = Image.new("RGBA", image.size)
    out.paste(image.convert("RGBA"), (0, 0), mask)
    return out


def paste_shadowed(canvas: Image.Image, card: Image.Image, xy: tuple[int, int], radius: int) -> None:
    x, y = xy
    shadow = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    sd = ImageDraw.Draw(shadow)
    sd.rounded_rectangle(
        (x - 14, y + 20, x + card.width + 14, y + card.height + 48),
        radius=radius + 12,
        fill=(35, 39, 65, 72),
    )
    shadow = shadow.filter(ImageFilter.GaussianBlur(34))
    canvas.paste(shadow, (0, 0), shadow)
    canvas.paste(card, xy, card)


def draw_brand(draw: ImageDraw.ImageDraw, x: int, y: int, scale: float, ink: str, accent: str) -> None:
    dot = round(18 * scale)
    draw.ellipse((x, y + round(10 * scale), x + dot, y + round(10 * scale) + dot), fill=accent)
    draw.text((x + round(32 * scale), y), "gromo", font=font(round(34 * scale), True), fill=ink)


def add_character(canvas: Image.Image, slide: Slide, width: int, top: int) -> None:
    if not slide.character:
        return
    image = Image.open(ASSETS / slide.character).convert("RGBA")
    target_w = round(width * 0.17)
    target_h = round(image.height * target_w / image.width)
    image = image.resize((target_w, target_h), Image.Resampling.LANCZOS)
    # 오른쪽에서 살짝 튀어나오는 스티커처럼 배치한다.
    x = width - target_w - round(width * 0.045)
    canvas.paste(image, (x, top), image)


def render_device(device: str, size: tuple[int, int]) -> list[Path]:
    w, h = size
    out_dir = FINAL / device
    out_dir.mkdir(parents=True, exist_ok=True)
    results: list[Path] = []

    if device == "iphone":
        margin = 118
        card_w = 1018
        card_y = 760
        title_size = 103
        subtitle_size = 39
        header_x = 112
        header_y = 142
        card_radius = 64
    else:
        margin = 164
        card_w = 1700
        card_y = 700
        title_size = 120
        subtitle_size = 48
        header_x = 164
        header_y = 120
        card_radius = 54

    for index, slide in enumerate(SLIDES, 1):
        canvas = gradient(size, slide.bg_top, slide.bg_bottom).convert("RGBA")
        draw = ImageDraw.Draw(canvas)
        scale = w / 1290
        draw_brand(draw, header_x, header_y, scale, slide.ink, slide.accent)

        title_y = header_y + round(72 * scale)
        draw.multiline_text(
            (header_x, title_y),
            slide.title,
            font=font(title_size, True),
            fill=slide.ink,
            spacing=round(6 * scale),
        )
        title_box = draw.multiline_textbbox(
            (header_x, title_y), slide.title, font=font(title_size, True), spacing=round(6 * scale)
        )
        subtitle_y = title_box[3] + round(28 * scale)
        draw.text((header_x, subtitle_y), slide.subtitle, font=font(subtitle_size), fill=slide.ink)

        add_character(canvas, slide, w, header_y + round(82 * scale))

        capture = Image.open(CAPTURES / f"{device}-{slide.key}.png").convert("RGB")
        card_h = round(capture.height * card_w / capture.width)
        card = capture.resize((card_w, card_h), Image.Resampling.LANCZOS)
        card = rounded_image(card, card_radius)
        card_x = (w - card_w) // 2
        paste_shadowed(canvas, card, (card_x, card_y), card_radius)

        # 상단 정보와 실제 UI의 경계를 잡아주는 짧은 컬러 포인트.
        line_y = card_y - round(34 * scale)
        draw.rounded_rectangle(
            (card_x, line_y, card_x + round(170 * scale), line_y + round(10 * scale)),
            radius=round(5 * scale),
            fill=slide.accent,
        )

        path = out_dir / f"{index:02d}-{slide.key}.png"
        canvas.convert("RGB").save(path, "PNG", optimize=True)
        results.append(path)

    return results


def make_contact_sheet(paths: list[Path], destination: Path) -> None:
    thumbs: list[Image.Image] = []
    for path in paths:
        image = Image.open(path).convert("RGB")
        thumb_w = 320
        thumb_h = round(image.height * thumb_w / image.width)
        thumbs.append(image.resize((thumb_w, thumb_h), Image.Resampling.LANCZOS))
    gap = 28
    sheet = Image.new(
        "RGB",
        (gap + len(thumbs) * (thumbs[0].width + gap), thumbs[0].height + gap * 2),
        "#E8E9EF",
    )
    for i, thumb in enumerate(thumbs):
        sheet.paste(thumb, (gap + i * (thumb.width + gap), gap))
    destination.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(destination, "JPEG", quality=92, optimize=True)


def main() -> None:
    iphone = render_device("iphone", (1290, 2796))
    ipad = render_device("ipad", (2048, 2732))
    make_contact_sheet(iphone, FINAL / "iphone-contact-sheet.jpg")
    make_contact_sheet(ipad, FINAL / "ipad-contact-sheet.jpg")
    print(f"완료: iPhone {len(iphone)}장, iPad {len(ipad)}장")


if __name__ == "__main__":
    main()
