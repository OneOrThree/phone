"""Build night variants of the village building motion frames and construction atlases.

GROMO-2154: ``motion/<building>/night-frame-0..3.png``
  - night-frame-0 is a lossless crop of ``backgrounds/island/layers/night/<building>.png``
    at the building's ``placement.json`` rect (same size as the day frames).
  - Frames 1-3 keep night-frame-0 everywhere except the moving part (door, telescope,
    dog). That part comes from the day frame, recoloured by a day→night tone curve
    fitted on the pixels around it, so the silhouette and bottom-center anchor never move.

GROMO-2153: ``construction/*-atlas-night.png``
  - Night relights generated from the day atlases (image generation, style transfer).
    Pass their folder with ``--atlas-source``; pixels far from the day atlas silhouette
    are cleared so neighbouring cells never bleed into a viewport.

Dependencies: ``python3 -m pip install -r scripts/requirements-night-motion.txt``
"""

import argparse
import json
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

ASSETS = Path(__file__).resolve().parents[1] / "src/assets"
VILLAGE = ASSETS / "village-world"

PLACEMENT_IDS = {
    "hall": "town-hall",
    "library": "library",
    "observatory": "observatory",
    "shop": "shop",
}

# 낮 프레임 사이에서 실제로 움직이는 부위만 밤 프레임에 합성한다. (x0, y0, x1, y1)
MOTION_BOXES = {
    "hall": [(82, 132, 119, 198)],
    "library": [(70, 204, 117, 278)],
    "observatory": [(66, 0, 112, 48), (19, 108, 66, 161)],
    "shop": [(80, 97, 126, 143)],
}

ATLASES = [
    "hall-board-gram-library-atlas",
    "mail-tower-shop-atlas",
    "effects-atlas",
]


def save_rgba(pixels: np.ndarray, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(pixels.astype(np.uint8)).save(path, optimize=True)


def features(rgb: np.ndarray) -> np.ndarray:
    v = rgb.reshape(-1, 3).astype(float) / 255
    r, g, b = v[:, 0], v[:, 1], v[:, 2]
    return np.stack([np.ones_like(r), r, g, b, r * r, g * g, b * b, r * g, g * b, r * b], 1)


def fit_night_tone(day: np.ndarray, night: np.ndarray, near: np.ndarray) -> np.ndarray:
    """낮→밤 색 변환을 2차 다항 회귀로 학습한다. 불 켜진 창처럼 밤이 더 밝은 픽셀은 제외한다."""
    ok = (day[..., 3] > 230) & (night[..., 3] > 230)
    ok = cv2.erode(ok.astype(np.uint8), np.ones((3, 3), np.uint8)).astype(bool) & near
    luminance = np.array([0.299, 0.587, 0.114])
    ok &= night[..., :3].astype(float) @ luminance <= day[..., :3].astype(float) @ luminance
    coef, *_ = np.linalg.lstsq(
        features(day[..., :3][ok][None]), night[..., :3][ok].astype(float) / 255, rcond=None
    )
    return coef


def apply_tone(coef: np.ndarray, rgb: np.ndarray) -> np.ndarray:
    return np.clip(features(rgb) @ coef, 0, 1).reshape(rgb.shape) * 255


def motion_mask(building: str, shape: tuple[int, int]) -> np.ndarray:
    mask = np.zeros(shape, np.float32)
    for x0, y0, x1, y1 in MOTION_BOXES[building]:
        mask[y0:y1, x0:x1] = 1
    return cv2.GaussianBlur(mask, (9, 9), 0)


def build_night_frames() -> None:
    placement = json.loads((ASSETS / "backgrounds/island/placement.json").read_text())
    rects = {asset["id"]: asset["rect"] for asset in placement["assets"]}

    for building, placement_id in PLACEMENT_IDS.items():
        x, y, w, h = rects[placement_id]
        layer = Image.open(ASSETS / f"backgrounds/island/layers/night/{building}.png")
        night0 = np.array(layer.convert("RGBA").crop((x, y, x + w, y + h)))
        days = [
            np.array(Image.open(VILLAGE / f"motion/{building}/frame-{i}.png").convert("RGBA"))
            for i in range(4)
        ]
        assert days[0].shape == night0.shape, f"{building}: 낮 프레임과 배치 rect 크기가 다르다"

        mask = motion_mask(building, night0.shape[:2])
        near = cv2.dilate((mask > 0).astype(np.uint8), np.ones((31, 31), np.uint8)).astype(bool)
        tone = fit_night_tone(days[0], night0, near)
        output = VILLAGE / f"motion/{building}"
        save_rgba(night0, output / "night-frame-0.png")

        for index in (1, 2, 3):
            day = days[index]
            if np.abs(day.astype(int) - days[0].astype(int)).max() <= 8:
                # 낮 frame-0 으로 돌아오는 프레임은 밤 frame-0 을 그대로 쓴다.
                save_rgba(night0, output / f"night-frame-{index}.png")
                continue
            rgb = day[..., :3].astype(float)
            converted = apply_tone(tone, day[..., :3])

            # 문이 열리며 새로 드러난 픽셀은 실내 불빛이 비치는 것으로 보고 호박빛으로만 낮춘다.
            change = np.abs(day.astype(int) - days[0].astype(int)).max(2).astype(np.float32)
            revealed = cv2.GaussianBlur(np.clip((change - 40) / 60, 0, 1), (5, 5), 0) * mask
            lit = rgb * np.array([0.93, 0.78, 0.58])
            converted = converted * (1 - 0.75 * revealed[..., None]) + lit * 0.75 * revealed[..., None]

            # 렌즈·병 같은 파란 재질은 회귀가 녹색으로 틀어지므로 청색을 유지한 채 어둡게만 낮춘다.
            cool = np.clip((rgb[..., 2] - np.maximum(rgb[..., 0], rgb[..., 1]) - 10) / 30, 0, 1)
            cool_rgb = rgb * np.array([0.32, 0.45, 0.78])
            converted = converted * (1 - cool[..., None]) + cool_rgb * cool[..., None]

            color = night0[..., :3] * (1 - mask[..., None]) + converted * mask[..., None]
            alpha = night0[..., 3] * (1 - mask) + day[..., 3] * mask
            frame = np.dstack([np.clip(color, 0, 255), np.clip(alpha, 0, 255)]).round()
            save_rgba(frame, output / f"night-frame-{index}.png")


def build_night_atlases(source: Path) -> None:
    for name in ATLASES:
        day = np.array(Image.open(VILLAGE / f"construction/{name}.png").convert("RGBA"))
        night = np.array(Image.open(source / f"{name}-night-preview.png").convert("RGBA"))
        assert day.shape == night.shape, f"{name}: 밤 아틀라스 크기가 낮과 다르다"
        keep = cv2.dilate((day[..., 3] > 0).astype(np.uint8), np.ones((17, 17), np.uint8))
        keep = cv2.GaussianBlur(keep.astype(np.float32), (5, 5), 0)
        night[..., 3] = (night[..., 3] * keep).round().astype(np.uint8)
        save_rgba(night, VILLAGE / f"construction/{name}-night.png")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--atlas-source", type=Path, help="생성된 *-night-preview.png 폴더")
    args = parser.parse_args()
    build_night_frames()
    if args.atlas_source:
        build_night_atlases(args.atlas_source)
