#!/usr/bin/env python3
"""성공한 생산성 앱의 App Store 화면 구성 패턴을 비교하는 보드를 만든다."""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
INPUT = Path("/private/tmp/gromo-appstore-refs-v2")
OUTPUT = ROOT / "references" / "composition-reference-board.jpg"
FONT = "/System/Library/Fonts/AppleSDGothicNeo.ttc"

APPS = [
    ("투두메이트", "1505220130", "한국어 카피와 장식 요소를 최소화하고 UI 자체의 색과 리듬을 전면에 둠"),
    ("Structured", "1499198946", "한 장에 하나의 기능, 큰 화면 크롭과 강한 배경색으로 세트 전체를 연결"),
    ("Finch", "1528595748", "캐릭터를 제품 UI와 같은 비중으로 배치해 기능보다 감정적 보상을 먼저 전달"),
    ("ScreenZen", "1541027222", "짧은 결과형 헤드라인 아래 핵심 조작 화면을 크게 두어 즉시 이해시킴"),
    ("터닝", "6449270376", "문제 상황과 변화 수치를 먼저 말하고 실제 차단·기록 화면으로 증명"),
    ("Opal", "1497465230", "넓은 여백, 프리미엄 3D 오브젝트, 과감한 디바이스 크롭으로 광고처럼 연출"),
]


def fit(image: Image.Image, size: tuple[int, int]) -> Image.Image:
    tw, th = size
    scale = max(tw / image.width, th / image.height)
    image = image.resize((round(image.width * scale), round(image.height * scale)), Image.Resampling.LANCZOS)
    x = (image.width - tw) // 2
    y = (image.height - th) // 2
    return image.crop((x, y, x + tw, y + th))


def rounded_mask(size: tuple[int, int], radius: int) -> Image.Image:
    mask = Image.new("L", size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, size[0], size[1]), radius=radius, fill=255)
    return mask


def wrap(draw: ImageDraw.ImageDraw, text: str, font: ImageFont.FreeTypeFont, width: int) -> str:
    lines, current = [], ""
    for word in text.split():
        candidate = f"{current} {word}".strip()
        if draw.textlength(candidate, font=font) <= width:
            current = candidate
        else:
            lines.append(current)
            current = word
    if current:
        lines.append(current)
    return "\n".join(lines)


def main() -> None:
    width, margin, gap = 2700, 90, 28
    shot_w, shot_h = 330, 715
    note_w = width - margin * 2 - shot_w * 5 - gap * 5
    row_h = 820
    height = 250 + row_h * len(APPS) + 90
    board = Image.new("RGB", (width, height), "#ECEEF3")
    draw = ImageDraw.Draw(board)

    title = ImageFont.truetype(FONT, 72, index=8)
    subtitle = ImageFont.truetype(FONT, 32, index=4)
    app_font = ImageFont.truetype(FONT, 44, index=7)
    body = ImageFont.truetype(FONT, 27, index=4)
    label = ImageFont.truetype(FONT, 21, index=6)

    draw.text((margin, 58), "앱스토어 소개 이미지 구성 레퍼런스", font=title, fill="#1C1E24")
    draw.text(
        (margin, 150),
        "성과가 검증된 생산성·웰빙 앱 6종 · 첫 5장의 화면 연출과 카피 구조 비교",
        font=subtitle,
        fill="#687084",
    )

    for row, (name, app_id, takeaway) in enumerate(APPS):
        y = 235 + row * row_h
        draw.rounded_rectangle((margin, y, width - margin, y + row_h - 30), 34, fill="white")
        draw.text((margin + 36, y + 42), name, font=app_font, fill="#1C1E24")
        draw.rounded_rectangle((margin + 36, y + 110, margin + 180, y + 156), 23, fill="#EEF0FB")
        draw.text((margin + 60, y + 120), "COMPOSITION", font=label, fill="#5E6AD2")
        draw.multiline_text(
            (margin + 36, y + 188),
            wrap(draw, takeaway, body, note_w - 66),
            font=body,
            fill="#667085",
            spacing=12,
        )

        start_x = margin + note_w + gap
        for index in range(1, 6):
            source = INPUT / f"{app_id}-{index}.jpg"
            image = fit(Image.open(source).convert("RGB"), (shot_w, shot_h))
            x = start_x + (index - 1) * (shot_w + gap)
            board.paste(image, (x, y + 36), rounded_mask((shot_w, shot_h), 24))
            draw.rounded_rectangle((x, y + 36, x + shot_w, y + 36 + shot_h), 24, outline="#D6D9E2", width=2)

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    board.save(OUTPUT, "JPEG", quality=92, optimize=True)
    print(OUTPUT)


if __name__ == "__main__":
    main()
