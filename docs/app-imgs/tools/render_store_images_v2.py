#!/usr/bin/env python3
"""회전·중첩·대형 크롭을 활용한 gromo App Store 소개 이미지 v2."""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont


ROOT = Path(__file__).resolve().parents[3]
DOCS = ROOT / "docs" / "app-imgs"
CAPTURES = DOCS / "captures"
OUT = DOCS / "final-v2"
ASSETS = ROOT / "app" / "app-dev" / "src" / "assets"
FONT = "/System/Library/Fonts/AppleSDGothicNeo.ttc"


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(FONT, size=size, index=7 if bold else 4)


def rgb(value: str) -> tuple[int, int, int]:
    value = value.lstrip("#")
    return tuple(int(value[i : i + 2], 16) for i in (0, 2, 4))


def gradient(size: tuple[int, int], top: str, bottom: str) -> Image.Image:
    w, h = size
    a, b = rgb(top), rgb(bottom)
    strip = Image.new("RGB", (1, h))
    px = strip.load()
    for y in range(h):
        t = y / max(h - 1, 1)
        px[0, y] = tuple(round(a[i] * (1 - t) + b[i] * t) for i in range(3))
    return strip.resize((w, h)).convert("RGBA")


def rounded_mask(size: tuple[int, int], radius: int) -> Image.Image:
    mask = Image.new("L", size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, size[0] - 1, size[1] - 1), radius, fill=255)
    return mask


def device_mock(source: Path, width: int, tablet: bool = False) -> Image.Image:
    shot = Image.open(source).convert("RGB")
    bezel = max(15, round(width * (0.018 if tablet else 0.026)))
    screen_w = width - bezel * 2
    screen_h = round(shot.height * screen_w / shot.width)
    radius = round(width * (0.055 if tablet else 0.105))
    outer_h = screen_h + bezel * 2

    body = Image.new("RGBA", (width, outer_h), (0, 0, 0, 0))
    draw = ImageDraw.Draw(body)
    draw.rounded_rectangle((0, 0, width - 1, outer_h - 1), radius, fill="#111319")

    screen = shot.resize((screen_w, screen_h), Image.Resampling.LANCZOS)
    screen_radius = max(12, radius - bezel)
    mask = rounded_mask((screen_w, screen_h), screen_radius)
    body.paste(screen, (bezel, bezel), mask)
    draw.rounded_rectangle((0, 0, width - 1, outer_h - 1), radius, outline=(255, 255, 255, 45), width=max(2, bezel // 5))
    return body


def paste_rotated(
    canvas: Image.Image,
    image: Image.Image,
    center: tuple[int, int],
    angle: float,
    shadow_alpha: int = 82,
    blur: int = 32,
) -> None:
    rotated = image.rotate(angle, resample=Image.Resampling.BICUBIC, expand=True)
    x = round(center[0] - rotated.width / 2)
    y = round(center[1] - rotated.height / 2)

    alpha = rotated.getchannel("A")
    shadow = Image.new("RGBA", rotated.size, (15, 18, 30, shadow_alpha))
    shadow.putalpha(alpha.filter(ImageFilter.GaussianBlur(blur)))
    canvas.alpha_composite(shadow, (x + 18, y + 30))
    canvas.alpha_composite(rotated, (x, y))


def paste_asset(canvas: Image.Image, name: str, box: tuple[int, int, int, int], angle: float = 0) -> None:
    image = Image.open(ASSETS / name).convert("RGBA")
    x, y, w, h = box
    scale = min(w / image.width, h / image.height)
    image = image.resize((round(image.width * scale), round(image.height * scale)), Image.Resampling.LANCZOS)
    if angle:
        image = image.rotate(angle, resample=Image.Resampling.BICUBIC, expand=True)
    shadow = Image.new("RGBA", image.size, (25, 28, 42, 70))
    shadow.putalpha(image.getchannel("A").filter(ImageFilter.GaussianBlur(max(8, w // 24))))
    canvas.alpha_composite(shadow, (x + 10, y + 18))
    canvas.alpha_composite(image, (x, y))


def brand(draw: ImageDraw.ImageDraw, w: int, dark: bool = False) -> None:
    scale = w / 1290
    x, y = round(88 * scale), round(72 * scale)
    ink = "#FFFFFF" if dark else "#202235"
    draw.ellipse((x, y + round(8 * scale), x + round(17 * scale), y + round(25 * scale)), fill="#6B76E5")
    draw.text((x + round(30 * scale), y), "gromo", font=font(round(31 * scale), True), fill=ink)


def headline(
    draw: ImageDraw.ImageDraw,
    w: int,
    title: str,
    subtitle: str,
    dark: bool = False,
    accent: str | None = None,
) -> None:
    scale = w / 1290
    x = round(88 * scale)
    y = round(148 * scale)
    ink = "#FFFFFF" if dark else "#171922"
    muted = "#D5D9EF" if dark else "#4C5161"
    title_font = font(round(91 * scale), True)
    draw.multiline_text((x, y), title, font=title_font, fill=ink, spacing=round(3 * scale))
    box = draw.multiline_textbbox((x, y), title, font=title_font, spacing=round(3 * scale))
    draw.text((x, box[3] + round(35 * scale)), subtitle, font=font(round(37 * scale), True), fill=accent or muted)


def rings(canvas: Image.Image, center: tuple[int, int], radii: list[int], color: tuple[int, int, int]) -> None:
    layer = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    for i, radius in enumerate(radii):
        alpha = max(16, 54 - i * 10)
        draw.ellipse(
            (center[0] - radius, center[1] - radius, center[0] + radius, center[1] + radius),
            outline=(*color, alpha),
            width=max(2, radius // 40),
        )
    canvas.alpha_composite(layer)


def source(device: str, key: str) -> Path:
    return CAPTURES / f"{device}-{key}.png"


def render_slide(device: str, index: int, size: tuple[int, int]) -> Image.Image:
    w, h = size
    tablet = device == "ipad"
    s = w / 1290

    if index == 1:
        canvas = gradient(size, "#FFFDFC", "#F3F0FA")
        draw = ImageDraw.Draw(canvas)
        brand(draw, w)
        headline(draw, w, "집중을 기록하고,\n함께 성장하세요", "집중하면 캐릭터와 티어가 함께 자라요")

        widths = [round(w * v) for v in ((0.38, 0.40, 0.36, 0.35) if not tablet else (0.43, 0.45, 0.40, 0.42))]
        centers = (
            [(0.10, 0.63), (0.60, 0.55), (0.33, 0.91), (0.88, 0.84)]
            if not tablet
            else [(0.08, 0.63), (0.53, 0.59), (0.32, 0.91), (0.87, 0.84)]
        )
        keys = ["home", "focus", "stats", "tier"]
        angles = [-17, 12, -11, 16]
        for key, width, center, angle in zip(keys, widths, centers, angles):
            paste_rotated(
                canvas,
                device_mock(source(device, key), width, tablet),
                (round(w * center[0]), round(h * center[1])),
                angle,
            )
        paste_asset(canvas, "character_happy.png", (round(w * 0.39), round(h * 0.60), round(w * 0.26), round(h * 0.18)), -5)

    elif index == 2:
        canvas = gradient(size, "#15192D", "#232A48")
        draw = ImageDraw.Draw(canvas)
        brand(draw, w, True)
        headline(draw, w, "폰은 내려놓고,\n집중만 남겨요", "카운트업 · 카운트다운 · 뽀모도로", True, "#9BA4FF")
        rings(canvas, (round(w * 0.73), round(h * 0.64)), [round(180 * s), round(300 * s), round(430 * s)], (105, 116, 226))

        main_w = round(w * (0.74 if not tablet else 0.64))
        paste_rotated(
            canvas,
            device_mock(source(device, "focus"), main_w, tablet),
            (round(w * 0.64), round(h * 0.70)),
            -7,
            110,
            42,
        )
        small_w = round(w * (0.34 if not tablet else 0.37))
        paste_rotated(
            canvas,
            device_mock(source(device, "home"), small_w, tablet),
            (round(w * 0.03), round(h * 0.82)),
            13,
            95,
            34,
        )
        paste_asset(canvas, "character_study.png", (round(w * 0.03), round(h * 0.33), round(w * 0.30), round(h * 0.22)), 5)

    elif index == 3:
        canvas = gradient(size, "#F0EEFF", "#DDE5FB")
        draw = ImageDraw.Draw(canvas)
        brand(draw, w)
        headline(draw, w, "쌓인 집중을,\n한눈에 분석하세요", "시간 · 과목 · 흐름을 보기 쉬운 기록으로", accent="#5E6AD2")

        back_w = round(w * (0.38 if not tablet else 0.42))
        paste_rotated(canvas, device_mock(source(device, "home"), back_w, tablet), (round(w * 0.06), round(h * 0.75)), -17)
        paste_rotated(canvas, device_mock(source(device, "result"), back_w, tablet), (round(w * 0.96), round(h * 0.76)), 16)
        main_w = round(w * (0.62 if not tablet else 0.56))
        paste_rotated(
            canvas,
            device_mock(source(device, "stats"), main_w, tablet),
            (round(w * 0.53), round(h * 0.72)),
            -2,
            105,
            38,
        )

        badge_y = round(h * 0.43)
        draw.rounded_rectangle(
            (round(w * 0.72), badge_y, round(w * 0.94), badge_y + round(68 * s)),
            radius=round(34 * s),
            fill="#FFFFFF",
        )
        draw.text((round(w * 0.755), badge_y + round(13 * s)), "오늘 3시간 14분", font=font(round(29 * s), True), fill="#5E6AD2")

    elif index == 4:
        canvas = gradient(size, "#F5FBF5", "#DDEEE3")
        draw = ImageDraw.Draw(canvas)
        brand(draw, w)
        headline(draw, w, "끝낸 집중은,\n눈에 보이는 성취로", "기록 · 스트릭 · 비교가 다음 집중을 이어줘요", accent="#478E5D")

        main_w = round(w * (0.68 if not tablet else 0.62))
        paste_rotated(
            canvas,
            device_mock(source(device, "result"), main_w, tablet),
            (round(w * 0.56), round(h * 0.72)),
            -5,
            105,
            40,
        )
        side_w = round(w * (0.39 if not tablet else 0.42))
        paste_rotated(
            canvas,
            device_mock(source(device, "stats"), side_w, tablet),
            (round(w * 0.98), round(h * 0.57)),
            14,
            80,
            30,
        )
        paste_asset(canvas, "character_happy.png", (round(w * 0.02), round(h * 0.45), round(w * 0.32), round(h * 0.22)), -9)

        for i, x in enumerate((0.10, 0.20, 0.30)):
            cy = round(h * (0.75 + i * 0.035))
            cx = round(w * x)
            draw.ellipse((cx - round(30 * s), cy - round(30 * s), cx + round(30 * s), cy + round(30 * s)), fill="#5BA86D")
            draw.text((cx - round(13 * s), cy - round(24 * s)), "✓", font=font(round(42 * s), True), fill="white")

    else:
        canvas = gradient(size, "#181A2A", "#2C2639")
        draw = ImageDraw.Draw(canvas)
        brand(draw, w, True)
        headline(draw, w, "집중할수록,\n더 높은 단계로", "리그와 티어 보상으로 꾸준하게", True, "#EBC56C")
        rings(canvas, (round(w * 0.67), round(h * 0.66)), [round(180 * s), round(330 * s), round(490 * s)], (218, 171, 83))

        back_w = round(w * (0.39 if not tablet else 0.43))
        paste_rotated(canvas, device_mock(source(device, "focus"), back_w, tablet), (round(w * 0.06), round(h * 0.78)), -16, 120, 44)
        main_w = round(w * (0.64 if not tablet else 0.58))
        paste_rotated(canvas, device_mock(source(device, "tier"), main_w, tablet), (round(w * 0.64), round(h * 0.72)), -4, 120, 44)

        tier_assets = ["tier_image/tier2.png", "tier_image/tier3.png", "tier_image/tier4.png", "tier_image/tier5.png"]
        placements = [(0.04, 0.43, -12), (0.80, 0.40, 9), (0.08, 0.56, 8), (0.86, 0.56, -8)]
        for asset, (x, y, angle) in zip(tier_assets, placements):
            paste_asset(canvas, asset, (round(w * x), round(h * y), round(w * 0.15), round(w * 0.15)), angle)

    return canvas.convert("RGB")


def contact_sheet(paths: list[Path], out: Path) -> None:
    thumbs = []
    for path in paths:
        image = Image.open(path).convert("RGB")
        width = 350
        thumbs.append(image.resize((width, round(image.height * width / image.width)), Image.Resampling.LANCZOS))
    gap = 30
    sheet = Image.new("RGB", (gap + len(thumbs) * (thumbs[0].width + gap), thumbs[0].height + gap * 2), "#E3E5EB")
    for i, image in enumerate(thumbs):
        sheet.paste(image, (gap + i * (image.width + gap), gap))
    sheet.save(out, "JPEG", quality=93, optimize=True)


def main() -> None:
    configs = {"iphone": (1290, 2796), "ipad": (2048, 2732)}
    for device, size in configs.items():
        directory = OUT / device
        directory.mkdir(parents=True, exist_ok=True)
        paths = []
        for index in range(1, 6):
            image = render_slide(device, index, size)
            path = directory / f"{index:02d}.png"
            image.save(path, "PNG", optimize=True)
            paths.append(path)
        contact_sheet(paths, OUT / f"{device}-contact-sheet.jpg")
        print(f"{device}: {len(paths)}장")


if __name__ == "__main__":
    main()
