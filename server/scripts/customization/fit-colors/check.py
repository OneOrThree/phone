"""색별 리그 수치 검사 → checks.json, checks.md

머리: headDy = 접촉점 y - 그 x 의 알파 윗변(검정 1~2; reel-2 는 검정도 귀 옆이라 26), headAngleDiff = 각도 - 윗변 기울기.
     headMatch = 검정 머리 실루엣을 옮겼을 때 알파 일치도(1=완전 일치), 등록 기록에서.
목: bandInside = 띠 중심선이 고양이 안에 있는 비율, anchorInside = 펜던트 고정점이 고양이 안인지.
source = 옮겨 온 검정 프레임(새 자세 blink·still 은 정면 머리 후보 중 가장 잘 맞은 것).
"""
import json
import math
import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import fitrender as fr  # noqa: E402


def top(a, x):
    col = np.where(a[:, int(round(x)), 3] > 200)[0]
    return int(col[0]) if len(col) else None


def slope_angle(a, x, d=16):
    xs = [xx for xx in range(int(x) - d, int(x) + d + 1) if top(a, xx) is not None]
    ys = [top(a, xx) for xx in xs]
    k = np.polyfit(xs, ys, 1)[0]
    return math.degrees(math.atan(k))


def check(color, rigs, reg=None):
    out = {}
    for fid in fr.FRAMES:
        a = fr.cat_rgba(color, fid)
        A = a[:, :, 3] > 128
        h = rigs['head'][fid]
        r = {'headMatch': round((reg[fid]['head']['score'] + 1) / 2, 2) if reg else 1.0,
             'headDy': h['y'] - top(a, h['x']),
             'headAngleDiff': round(h['angleDegrees'] - slope_angle(a, h['x']), 1)}
        n = rigs['neck']['frames'].get(fid)
        v = h.get('view')
        if v:  # avatar: 보통 크기 좌표 → 그림 좌표
            h = {'x': h['x'] * v['scale'] + v['x'], 'y': h['y'] * v['scale'] + v['y'], 'angleDegrees': h['angleDegrees']}
            r['headDy'] = round(h['y'] - top(a, h['x']), 1)
            r['headAngleDiff'] = round(h['angleDegrees'] - slope_angle(a, h['x']), 1)
        r['source'] = reg[fid]['source'] if reg else fid
        if not n:  # 독서: 목 없음
            r['bandInside'] = r['anchorInside'] = '-'
            out[fid] = r
            continue
        if n.get('view'):
            k, ox, oy = n['view']['scale'], n['view']['x'], n['view']['y']
            n = {**n, 'paths': [[[x * k + ox, t * k + oy, b * k + oy] for x, t, b in path] for path in n['paths']],
                 'anchor': [n['anchor'][0] * k + ox, n['anchor'][1] * k + oy]}
        pts = [p for path in n['paths'] for p in path]
        inside = [A[min(511, int(round((t + b) / 2))), int(round(x))] for x, t, b in pts]
        r['bandInside'] = round(float(np.mean(inside)), 2)
        ax, ay = n['anchor']
        r['anchorInside'] = bool(A[min(511, int(round(ay))), int(round(ax))])
        out[fid] = r
    return out


def load(d):
    return {k: json.load(open(Path(d) / f'{k}.json')) for k in ('head', 'neck')}


if __name__ == '__main__':
    res = {'black': check('black', load(HERE / 'rigs/black'), json.load(open(HERE / 'rigs/black/registration.json')))}
    # 비교용: 검정 좌표를 그대로 다른 색에 쓴 경우
    res['ginger-with-black-rig'] = check('ginger', load(HERE / 'rigs/black'))
    res['calico-with-black-rig'] = check('calico', load(HERE / 'rigs/black'))
    for c in fr.COLORS[1:]:
        res[c] = check(c, load(HERE / 'rigs' / c), json.load(open(HERE / 'rigs' / c / 'registration.json')))
    (HERE / 'checks.json').write_text(json.dumps(res, indent=1, default=lambda o: o.item() if hasattr(o, 'item') else str(o)))
    cols = ['source', 'headMatch', 'headDy', 'headAngleDiff', 'bandInside', 'anchorInside']
    lines = []
    for name, rows in res.items():
        lines += [f'\n### {name}\n', '| frame | ' + ' | '.join(cols) + ' |', '|' + '---|' * (len(cols) + 1)]
        for fid, r in rows.items():
            lines.append(f'| {fid} | ' + ' | '.join(str(r[c]) for c in cols) + ' |')
    (HERE / 'checks.md').write_text('\n'.join(lines) + '\n')
    print('\n'.join(lines))
