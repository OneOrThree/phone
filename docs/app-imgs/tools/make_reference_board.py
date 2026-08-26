from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
INPUT = Path("/private/tmp/gromo-appstore-refs")
OUTPUT = ROOT / "references" / "reference-board.jpg"

APPS = [
    ("Focus Friend", "6742278016", "캐릭터를 첫 장의 주인공으로 두고 보상을 즉시 이해시킴"),
    ("Focus Hero", "6465700009", "집중을 RPG 성장 서사로 번역해 기능보다 변화와 보상을 먼저 보여줌"),
    ("Study Bunny", "1478345385", "타이머·할 일·상점 기능을 한 캐릭터 세계관 안에서 일관되게 묶음"),
    ("Flora", "1225155794", "함께 심고 실패를 막는 사회적 약속으로 집중 행동을 강화"),
    ("Forest", "866450515", "짧은 결과형 카피 + 실제 UI를 크게 노출"),
    ("Opal", "1497465230", "문제 해결 약속을 먼저 말하고 수치·기록으로 신뢰를 보강"),
    ("Pogether", "6738842916", "함께 집중하는 장면과 꾸미기 보상을 한 흐름으로 연결"),
    ("열품타", "1441909643", "한국 사용자에게 익숙한 기능형 카피와 실제 데이터 화면"),
]

FONT = "/System/Library/Fonts/AppleSDGothicNeo.ttc"


def fit_cover(image: Image.Image, size: tuple[int, int]) -> Image.Image:
    target_w, target_h = size
    scale = max(target_w / image.width, target_h / image.height)
    resized = image.resize((round(image.width * scale), round(image.height * scale)), Image.Resampling.LANCZOS)
    left = (resized.width - target_w) // 2
    top = (resized.height - target_h) // 2
    return resized.crop((left, top, left + target_w, top + target_h))


def rounded_mask(size: tuple[int, int], radius: int) -> Image.Image:
    mask = Image.new("L", size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, size[0] - 1, size[1] - 1), radius, fill=255)
    return mask


def main() -> None:
    width = 2048
    margin = 92
    gap = 30
    shot_w, shot_h = 404, 876
    text_w = width - margin * 2 - shot_w * 3 - gap * 3
    row_h = 1000
    height = 250 + row_h * len(APPS) + 110

    board = Image.new("RGB", (width, height), "#F4F5F8")
    draw = ImageDraw.Draw(board)
    title_font = ImageFont.truetype(FONT, 68, index=8)
    subtitle_font = ImageFont.truetype(FONT, 31, index=4)
    app_font = ImageFont.truetype(FONT, 43, index=7)
    body_font = ImageFont.truetype(FONT, 28, index=4)
    label_font = ImageFont.truetype(FONT, 21, index=6)

    draw.text((margin, 72), "집중·스크린타임 앱 스토어 레퍼런스", font=title_font, fill="#1C1E22")
    draw.text(
        (margin, 158),
        "2026-08-09 한국 App Store 공개 이미지 · 각 앱의 첫 3장 비교",
        font=subtitle_font,
        fill="#667085",
    )

    for row, (name, app_id, takeaway) in enumerate(APPS):
        y = 250 + row * row_h
        draw.rounded_rectangle(
            (margin, y, width - margin, y + row_h - 34),
            radius=34,
            fill="#FFFFFF",
            outline="#EAEBEE",
            width=2,
        )
        draw.text((margin + 42, y + 48), name, font=app_font, fill="#1C1E22")

        words = takeaway.split()
        lines: list[str] = []
        current = ""
        for word in words:
            candidate = f"{current} {word}".strip()
            if draw.textlength(candidate, font=body_font) <= text_w - 84:
                current = candidate
            else:
                lines.append(current)
                current = word
        if current:
            lines.append(current)
        draw.multiline_text(
            (margin + 42, y + 120),
            "\n".join(lines),
            font=body_font,
            fill="#667085",
            spacing=12,
        )
        draw.rounded_rectangle(
            (margin + 42, y + 300, margin + 42 + 122, y + 348),
            radius=24,
            fill="#EEF0FB",
        )
        draw.text((margin + 67, y + 310), "TAKEAWAY", font=label_font, fill="#5E6AD2")

        first_x = margin + text_w + gap
        for index in range(1, 4):
            source = INPUT / f"{app_id}-{index}.jpg"
            image = Image.open(source).convert("RGB")
            image = fit_cover(image, (shot_w, shot_h))
            x = first_x + (index - 1) * (shot_w + gap)
            board.paste(image, (x, y + 48), rounded_mask((shot_w, shot_h), 26))
            draw.rounded_rectangle(
                (x, y + 48, x + shot_w, y + 48 + shot_h),
                radius=26,
                outline="#D8DAE2",
                width=2,
            )

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    board.save(OUTPUT, quality=92, optimize=True)
    print(OUTPUT)


if __name__ == "__main__":
    main()
