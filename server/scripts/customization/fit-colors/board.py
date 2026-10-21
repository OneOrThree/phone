"""색별 검증 보드: 행 = 머리+목 조합 3세트.
board-<색>.png 열 = 승인 18프레임(walk 0~5·focus 0~3·reel 0~3·blink 0~2·still/idle),
board-extra-<색>.png 열 = 추가 자세(read 0~5·still/loaf·still/avatar).
사용: board.py <color> <rig-dir> <out.png> [extra]   (rig-dir 에 head.json·neck.json)"""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parent))
import fitrender as fr  # noqa: E402

SETS = [
    {'head': 'cust.head.mandarin', 'neck': 'cust.neck.bell'},
    {'head': 'cust.head.bunny', 'neck': 'cust.neck.bow'},
    {'head': 'cust.head.seal', 'neck': 'cust.neck.picnic'},
]
CROP = (24, 24, 488, 488)  # 512² 안에서 고양이가 들어가는 영역
SCALE = .62


def load_rigs(d):
    d = Path(d)
    return {k: json.load(open(d / f'{k}.json')) for k in ('head', 'neck')}


def board(color, rigs, out, frames, sets=SETS, label=''):
    cw, ch = round((CROP[2] - CROP[0]) * SCALE), round((CROP[3] - CROP[1]) * SCALE)
    head_h = 26
    img = Image.new('RGB', (cw * len(frames), head_h + ch * len(sets)), (246, 240, 230))
    d = ImageDraw.Draw(img)
    for k, fid in enumerate(frames):
        d.text((k * cw + 6, 6), f'{color} {fid} {label}', fill=(70, 50, 40))
        if k:
            d.line([(k * cw, 0), (k * cw, img.height)], fill=(215, 205, 190))
    for r, outfit in enumerate(sets):
        for k, fid in enumerate(frames):
            a = fr.compose(color, fid, outfit, rigs)
            im = Image.fromarray(a, 'RGBA').crop(CROP).resize((cw, ch), Image.BILINEAR)
            img.paste(im, (k * cw, head_h + r * ch), im)
    img.save(out)


EXTRA = [f for f in fr.FRAMES if f.startswith('read-') or f in ('still/loaf', 'still/avatar')]
APPROVED = [f for f in fr.FRAMES if f not in EXTRA]

if __name__ == '__main__':
    board(sys.argv[1], load_rigs(sys.argv[2]), sys.argv[3], EXTRA if sys.argv[4:] == ['extra'] else APPROVED)
