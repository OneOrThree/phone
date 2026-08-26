#!/usr/bin/env python3
"""그룹·챌린지·누끼 기능별 App Store 이미지를 v1 포맷으로 렌더링한다."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import argparse

from PIL import Image, ImageDraw, ImageFilter, ImageFont


ROOT = Path(__file__).resolve().parents[3]
DOCS = ROOT / ".docs" / "app-imgs"
CAPTURES = DOCS / "captures" / "features"
FINAL_V1 = DOCS / "features-v1"
FINAL_COPY_V2 = DOCS / "features-v1-copy-v2"
FONT = "/System/Library/Fonts/AppleSDGothicNeo.ttc"


@dataclass(frozen=True)
class Slide:
    feature: str
    filename: str
    capture: str
    title: str
    subtitle: str
    top: str
    bottom: str
    accent: str


SLIDES = [
    Slide("group", "01-group-list.png", "01-group-list.png", "함께라면,\n더 오래 집중해요", "나와 맞는 그룹을 찾고 함께 시작해요", "#F8F6F0", "#ECEAF9", "#5E6AD2"),
    Slide("group", "02-group-room.png", "02-group-room.png", "우리의 집중을\n한곳에서", "공지 · 챌린지 · 멤버 기록을 한눈에", "#F4F4FC", "#E5E9F8", "#6672D7"),
    Slide("group", "03-group-create.png", "03-group-create.png", "우리만의 그룹을\n바로 만들어요", "이름과 정원만 정하면 준비 끝", "#FAF7F1", "#EEE9DF", "#8B6BC5"),
    Slide("challenge", "01-challenge-progress.png", "01-challenge-progress.png", "오늘의 목표를\n함께 지켜요", "멤버별 진행과 달성 상태를 한눈에", "#F5F7FD", "#E2E8FA", "#5E6AD2"),
    Slide("challenge", "02-challenge-create.png", "02-challenge-create.png", "집중도, 사용시간도\n챌린지로", "목표 시간과 시간대를 자유롭게 설정", "#F8F5FD", "#E9E2F8", "#745DC7"),
    Slide("challenge", "03-challenge-bet.png", "03-challenge-bet.png", "코인을 걸면\n몰입은 더 선명하게", "달성한 멤버가 적립금을 함께 나눠요", "#FBF7EC", "#F0E6C9", "#B98224"),
    Slide("cutout", "01-character-select.png", "01-character-select.png", "내 물건이\n캐릭터가 돼요", "기본 그로몬과 내 캐릭터를 자유롭게", "#F8F5EE", "#EDE8F8", "#735FC7"),
    Slide("cutout", "02-cutout-pick.png", "02-cutout-pick.png", "사진 한 장이면\n준비 끝", "앨범에서 고르거나 바로 촬영하세요", "#F4F8F6", "#E4F0EB", "#4B9270"),
    Slide("cutout", "03-cutout-ready.png", "03-cutout-ready.png", "배경은 지우고,\n개성은 살리고", "표정과 팔다리를 더해 나만의 캐릭터 완성", "#FFF7EF", "#F2E5DA", "#D27A4B"),
]

COPY_V2_SLIDES = [
    Slide("group", "01-group-list.png", "01-group-list.png", "혼자보다,\n함께라서 꾸준해요", "같은 목표의 사람들과 집중 습관을 만들어요", "#F8F6F0", "#ECEAF9", "#5E6AD2"),
    Slide("group", "02-group-room.png", "02-group-room.png", "서로의 오늘이\n동기가 돼요", "공지부터 집중 기록까지 한 화면에서", "#F4F4FC", "#E5E9F8", "#6672D7"),
    Slide("group", "03-group-create.png", "03-group-create.png", "마음 맞는 사람과\n지금 시작해요", "우리에게 꼭 맞는 집중 그룹 만들기", "#FAF7F1", "#EEE9DF", "#8B6BC5"),
    Slide("challenge", "01-challenge-progress.png", "01-challenge-progress.png", "누가 먼저\n목표에 닿을까요?", "오늘의 진행률을 함께 보고 응원해요", "#F5F7FD", "#E2E8FA", "#5E6AD2"),
    Slide("challenge", "02-challenge-create.png", "02-challenge-create.png", "지키고 싶은 시간을\n목표로 만들어요", "집중과 스크린타임, 원하는 방식 그대로", "#F8F5FD", "#E9E2F8", "#745DC7"),
    Slide("challenge", "03-challenge-bet.png", "03-challenge-bet.png", "약속에 코인을 걸고\n끝까지 해내요", "달성한 사람끼리 적립금을 나눠 가져요", "#FBF7EC", "#F0E6C9", "#B98224"),
    Slide("cutout", "01-character-select.png", "01-character-select.png", "세상에 하나뿐인\n내 그로몬", "좋아하는 물건을 나만의 캐릭터로", "#F8F5EE", "#EDE8F8", "#735FC7"),
    Slide("cutout", "02-cutout-pick.png", "02-cutout-pick.png", "찍거나 고르면\n바로 캐릭터로", "사진 한 장으로 시작하는 간단한 만들기", "#F4F8F6", "#E4F0EB", "#4B9270"),
    Slide("cutout", "03-cutout-ready.png", "03-cutout-ready.png", "오리고, 표정을 더해\n완성!", "평범한 물건이 살아 움직이는 순간", "#FFF7EF", "#F2E5DA", "#D27A4B"),
]


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(FONT, size=size, index=6 if bold else 0)


def rgb(value: str) -> tuple[int, int, int]:
    value = value.lstrip("#")
    return tuple(int(value[i : i + 2], 16) for i in (0, 2, 4))


def gradient(size: tuple[int, int], top: str, bottom: str) -> Image.Image:
    w, h = size
    a, b = rgb(top), rgb(bottom)
    image = Image.new("RGB", size)
    draw = ImageDraw.Draw(image)
    for y in range(h):
        t = y / max(h - 1, 1)
        color = tuple(round(a[i] * (1 - t) + b[i] * t) for i in range(3))
        draw.line((0, y, w, y), fill=color)
    return image


def rounded(image: Image.Image, radius: int) -> Image.Image:
    mask = Image.new("L", image.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, image.width, image.height), radius=radius, fill=255)
    out = Image.new("RGBA", image.size)
    out.paste(image.convert("RGBA"), (0, 0), mask)
    return out


def paste_card(canvas: Image.Image, card: Image.Image, x: int, y: int, radius: int) -> None:
    shadow = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle(
        (x - 18, y + 20, x + card.width + 18, y + card.height + 56),
        radius=radius + 12,
        fill=(35, 39, 65, 70),
    )
    shadow = shadow.filter(ImageFilter.GaussianBlur(36))
    canvas.paste(shadow, (0, 0), shadow)
    canvas.paste(card, (x, y), card)


def render(slide: Slide, final: Path) -> Path:
    size = (1290, 2796)
    canvas = gradient(size, slide.top, slide.bottom).convert("RGBA")
    draw = ImageDraw.Draw(canvas)
    ink = "#1D2030"
    header_x = 112
    header_y = 142

    draw.ellipse((header_x, header_y + 10, header_x + 18, header_y + 28), fill=slide.accent)
    draw.text((header_x + 32, header_y), "gromo", font=font(34, True), fill=ink)

    title_y = header_y + 72
    draw.multiline_text((header_x, title_y), slide.title, font=font(103, True), fill=ink, spacing=6)
    title_box = draw.multiline_textbbox((header_x, title_y), slide.title, font=font(103, True), spacing=6)
    draw.text((header_x, title_box[3] + 28), slide.subtitle, font=font(39), fill="#474C65")

    capture = Image.open(CAPTURES / slide.feature / slide.capture).convert("RGB")
    card_w = 1018
    card_h = round(capture.height * card_w / capture.width)
    card = rounded(capture.resize((card_w, card_h), Image.Resampling.LANCZOS), 64)
    card_x = (size[0] - card_w) // 2
    card_y = 760
    paste_card(canvas, card, card_x, card_y, 64)
    draw.rounded_rectangle((card_x, card_y - 34, card_x + 170, card_y - 24), radius=5, fill=slide.accent)

    destination = final / slide.feature / slide.filename
    destination.parent.mkdir(parents=True, exist_ok=True)
    canvas.convert("RGB").save(destination, "PNG", optimize=True)
    return destination


def contact_sheet(paths: list[Path], destination: Path) -> None:
    thumbs = []
    for path in paths:
        image = Image.open(path).convert("RGB")
        thumbs.append(image.resize((320, round(image.height * 320 / image.width)), Image.Resampling.LANCZOS))
    gap = 28
    sheet = Image.new("RGB", (gap + len(thumbs) * (320 + gap), thumbs[0].height + gap * 2), "#E8E9EF")
    for index, thumb in enumerate(thumbs):
        sheet.paste(thumb, (gap + index * (320 + gap), gap))
    destination.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(destination, "JPEG", quality=92, optimize=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--variant", choices=("v1", "copy-v2"), default="v1")
    args = parser.parse_args()
    slides = COPY_V2_SLIDES if args.variant == "copy-v2" else SLIDES
    final = FINAL_COPY_V2 if args.variant == "copy-v2" else FINAL_V1
    results = [render(slide, final) for slide in slides]
    for feature in ("group", "challenge", "cutout"):
        feature_paths = [path for path in results if path.parent.name == feature]
        contact_sheet(feature_paths, final / f"{feature}-contact-sheet.jpg")
    contact_sheet(results, final / "all-contact-sheet.jpg")
    print(f"완료: {len(results)}장")


if __name__ == "__main__":
    main()
