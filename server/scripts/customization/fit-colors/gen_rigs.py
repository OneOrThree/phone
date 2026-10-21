"""검정 cat-fit-v1 리그(머리 접촉점·목 곡선·앞발 가림)를 6색 × 26프레임으로 만든다.

프레임: 승인된 walk 6·focus 4·reel 4 + 새 자세 blink 3·read 6 + 정적 그림 still/idle·still/loaf·still/avatar.
방법: 프레임마다 검정 부위(머리 / 앞발 가림 다각형)를 같은 색 프레임에서 닮음 변환으로 찾고(register.py),
검정 리그 좌표를 그 변환으로 옮긴다. 머리 y 는 색 프레임의 실제 알파 윗변으로 다시 붙인다.
검정 리그가 없는 새 자세는 정면 머리인 검정 reel·focus 프레임 중 그 자세 첫 프레임에 가장 잘 맞는 것을 원본으로
고정해 쓴다(검정 포함). 독서는 책이 목을 다 가려 목 프레임을 두지 않는다(머리만).
avatar 는 고양이가 크게·아래로 그려진 그림(가슴 아래가 잘림)이라 리그를 보통 고양이 크기 좌표로 두고 view{x,y,scale} 로 그림에 맞춘다.
사람 손 보정은 overrides.json 으로만 한다.

사용: gen_rigs.py [color ...]   → rigs/<color>/{head,neck}.json, rigs/<color>/registration.json
"""
import json
import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import fitrender as fr  # noqa: E402
import register as rg  # noqa: E402

# 승인 합본의 검정 리그 — build_reward_catalog.py 가 내용 해시 이름으로 그대로 옮겨 둔 원본(14프레임)이다
RIGS = fr.STATIC / 'customization/rigs'
BLACK_HEAD, BLACK_NECK, BLACK_SHOES = (RIGS / 'head.0093c1a9.json', RIGS / 'neck.22a4cc24.json',
                                       RIGS / 'shoes.fbacc42b.json')
OUT = HERE / 'rigs'
TOP_ALPHA = 200
# 오스카 승인(10/21)된 18프레임 = walk·focus·reel 14 + blink 3 + still/idle. blink·still/idle 은 검정 reel-0 고정으로 만든 값이며
# 승인 뒤에는 바꾸지 않는다(아래 APPROVED_NEW 경로를 건드리지 말 것).
APPROVED_NEW = ('blink', 'still/idle')
APPROVED_NEW_SOURCE = 'reel-0'
# 추가 자세(read·still/loaf·still/avatar)의 원본 후보 — 정면 머리. 자세마다 첫 프레임에 가장 잘 맞는 것 하나로 고정한다
# (프레임마다 바꾸면 독서 프레임 사이에서 장식이 튄다)
NEW_SOURCES = ['reel-0', 'reel-3', 'focus-0', 'focus-1', 'focus-2', 'focus-3']


def group(fid):
    return fid if fid.startswith('still/') else fid.rsplit('-', 1)[0]


def black_rigs():
    h = json.load(open(BLACK_HEAD))
    head = {f'{m}-{i}': {'x': v[0], 'y': v[1], 'angleDegrees': v[2]}
            for m, rows in h['baseContacts'].items() for i, v in enumerate(rows)}
    return head, json.load(open(BLACK_NECK)), json.load(open(BLACK_SHOES))


def top(rgba, x):
    col = np.where(rgba[:, int(round(x)), 3] > TOP_ALPHA)[0]
    return int(col[0]) if len(col) else None


def jaw_fn(paths):
    pts = sorted((p[0], p[1]) for path in paths for p in path)
    xs, ys = [p[0] for p in pts], [p[1] for p in pts]
    return lambda x: np.interp(x, xs, ys), xs[0], xs[-1]


def poly_mask(polys, dilate=0):
    im = Image.new('L', (512, 512), 0)
    d = ImageDraw.Draw(im)
    for p in polys:
        d.polygon([tuple(q) for q in p], fill=255)
    m = np.asarray(im) > 0
    return _dilate(m, dilate) if dilate else m


def box_mask(box, dilate=0):
    m = np.zeros((512, 512), bool)
    l, t, r, b = box
    m[max(0, int(t) - dilate):min(512, int(b) + dilate), max(0, int(l) - dilate):min(512, int(r) + dilate)] = True
    return m


def _dilate(m, r):
    im = Image.fromarray((m * 255).astype(np.uint8))
    from PIL import ImageFilter
    return np.asarray(im.filter(ImageFilter.MaxFilter(2 * r + 1))) > 0


def head_region(black, neck_frame, shoes_frame):
    jaw, x0, x1 = jaw_fn(neck_frame['paths'])
    yy, xx = np.mgrid[0:512, 0:512]
    m = (yy < jaw(xx) - 1) & (xx >= x0 - 50) & (xx <= x1 + 40)
    # 머리 근처로 올라온 앞발·가림 다각형은 머리 모양이 아니므로 뺀다
    for ft in shoes_frame:
        if ft['view'] != 'side':
            m &= ~box_mask(ft['box'], 8)
    if neck_frame['occluders']:
        m &= ~poly_mask(neck_frame['occluders'], 6)
    return m


def slope_angle(rgba, x, d=16):
    xs = [xx for xx in range(int(x) - d, int(x) + d + 1) if top(rgba, xx) is not None]
    return math.degrees(math.atan(np.polyfit(xs, [top(rgba, xx) for xx in xs], 1)[0]))


def interior(rgba):
    """외곽선(진갈색)을 뺀 고양이 안쪽 — 외곽선으로 닫힌 앞발이 따로 떨어진 덩어리가 된다."""
    a = rgba.astype(np.int16)
    line = (a[:, :, 1] < 60) & (a[:, :, 0] - a[:, :, 2] > 8) & (a[:, :, :3].mean(2) < 95)
    return (a[:, :, 3] > 128) & ~line


def flood(m, seed, window):
    """seed 에서 4방향으로 채운 덩어리와, 창(window=[l,t,r,b]) 밖으로 새지 않고 닫혔는지."""
    from collections import deque
    x, y = seed
    l, t, r, b = window
    seen = np.zeros_like(m)
    if not m[y, x]:
        return seen, False
    seen[y, x] = True
    q, closed = deque([(y, x)]), True
    while q:
        a, c = q.popleft()
        for v, w in ((a + 1, c), (a - 1, c), (a, c + 1), (a, c - 1)):
            if not (t <= v < b and l <= w < r):
                closed = False
                continue
            if m[v, w] and not seen[v, w]:
                seen[v, w] = True
                q.append((v, w))
    return seen, closed


def radial_polygon(m, rays=48):
    """덩어리를 중심에서 뻗은 광선의 가장 먼 점으로 다각형화(앞발처럼 둥근 덩어리용)."""
    ys, xs = np.nonzero(m)
    cx, cy = xs.mean(), ys.mean()
    ang = np.arctan2(ys - cy, xs - cx)
    dist = np.hypot(ys - cy, xs - cx)
    pts = []
    for k in range(rays):
        a0 = -math.pi + 2 * math.pi * k / rays
        sel = np.abs((ang - a0 + math.pi) % (2 * math.pi) - math.pi) < math.pi / rays
        if sel.any():
            i = np.argmax(np.where(sel, dist, -1))
            pts.append([int(xs[i]), int(ys[i])])
    return pts


def paw_blobs(rgba, poly, grow=5):
    """옮긴 가림 다각형 안에 대부분 들어오는 닫힌 앞발 덩어리 → 외곽선 두께만큼 키운 다각형. 없으면 None.
    앞발이 팔·몸통과 외곽선 없이 이어지면(닫히지 않으면) 덩어리로 보지 않는다."""
    inner = interior(rgba)
    pm = poly_mask([poly])
    inside = poly_mask([poly], 6)
    ys, xs = np.nonzero(pm)
    win = [max(0, xs.min() - 20), max(0, ys.min() - 20), min(512, xs.max() + 21), min(512, ys.max() + 21)]
    seen = np.zeros((512, 512), bool)
    keep = np.zeros((512, 512), bool)
    for y, x in zip(ys[::5], xs[::5]):
        if seen[y, x] or not inner[y, x]:
            continue
        blob, closed = flood(inner, (x, y), win)
        seen |= blob
        if closed and blob.sum() >= 60 and (blob & inside).sum() / blob.sum() >= .6:
            keep |= blob
    if keep.sum() < .5 * pm.sum():
        return None
    return radial_polygon(_dilate(keep, grow))


def centroid(m):
    ys, xs = np.nonzero(m)
    return float(xs.mean()), float(ys.mean())


def transfer(color, overrides):
    head_b, neck_b, shoes_b = black_rigs()
    head, neck, log = {}, {'canvas': [512, 512], 'frames': {}}, {}
    ov_color = overrides.get(color, {})
    chosen = {}
    for fid in fr.FRAMES:
        ov = ov_color.get(fid, {})
        C = fr.cat_rgba(color, fid)
        tgt = rg.Target(C)
        # 1) 머리 — 승인 프레임은 같은 프레임의, 새 자세는 그 자세 원본 후보의 검정 머리를 옮긴다
        approved = fid in neck_b['frames']
        frozen = group(fid) in APPROVED_NEW
        avatar = fid == 'still/avatar'
        if avatar:
            tgt = rg.Target(C, wide=True)
        if approved:
            cands = [fid]
        elif frozen:
            cands = [APPROVED_NEW_SOURCE]
        else:
            cands = [chosen[group(fid)]] if group(fid) in chosen else NEW_SOURCES
        best = None
        for cand in cands:
            B = fr.cat_rgba('black', cand)
            region = head_region(B, neck_b['frames'][cand], shoes_b[cand])
            c = centroid(region & (B[:, :, 3] > 128))
            if approved:
                T, score = rg.register(B, region, tgt, c)
            elif frozen:
                T, score = rg.register(B, region, tgt, c, angles=(-15, 15, 3), scales=(.8, 1.25, .05))
            elif avatar:  # 고양이가 약 1.1배로, 아래로 150px 쯤 내려 그려진 그림(256² 를 512² 로 키운 좌표)
                T, score = rg.register(B, region, tgt, c, max_shift=200, angles=(-15, 15, 3),
                                       scales=(.9, 1.6, .05))
            else:
                T, score = rg.register(B, region, tgt, c, max_shift=100, angles=(-20, 20, 4),
                                       scales=(.8, 1.25, .05))
            if best is None or score > best[1]:
                best = (T, score, cand)
        Th, sh, src = best
        chosen.setdefault(group(fid), src)
        B = fr.cat_rgba('black', src)
        nf = neck_b['frames'][src]
        hb = head_b[src]
        hov = ov.get('head', {})
        tx, ty = rg.apply((hb['x'], hb['y']), Th)
        x = round(tx + hov.get('dx', 0))
        offset = hb['y'] - top(B, hb['x'])
        resid = hb['angleDegrees'] - slope_angle(B, hb['x'])
        # 정수리 위 점은 색 알파 윗변에 다시 붙인다. reel-2 처럼 귀 옆으로 옮긴 점은 변환 위치 그대로
        # (추가 자세는 avatar 처럼 배율이 달라 접촉 여유도 배율만큼; 승인 18프레임은 승인 당시 식 그대로)
        dy0 = offset if approved or frozen else round(offset * Th[1])
        y = (top(C, x) + dy0) if abs(offset) <= 4 else round(ty)
        # 각도: 검정이 윗변 기울기를 따랐으면 색도 윗변 기울기 + 검정 잔차, 아니면 머리 회전만 더한다
        angle = slope_angle(C, x) + resid if abs(resid) <= 5 else hb['angleDegrees'] + Th[0]
        head[fid] = {'x': x, 'y': y + hov.get('dy', 0), 'angleDegrees': round(angle + hov.get('dAngle', 0), 1)}
        # 2) 목 곡선 — 턱선은 머리에 붙어 있으므로 머리 변환을 쓴다
        paths = []
        for path in nf['paths']:
            mids = [rg.apply((x0, (t + b) / 2), Th) for x0, t, b in path]
            half = [(b - t) / 2 * Th[1] for _, t, b in path]
            order = np.argsort([m[0] for m in mids])
            mx = np.array([mids[i][0] for i in order])
            my = np.array([mids[i][1] for i in order])
            hh = np.array([half[i] for i in order])
            grid = np.arange(math.ceil(mx[0]), math.floor(mx[-1]) + 1e-6, 3)
            if grid[-1] < mx[-1] - .5:
                grid = np.append(grid, mx[-1])
            gy, gh = np.interp(grid, mx, my), np.interp(grid, mx, hh)
            dy = ov.get('neck', {}).get('dy', 0)
            paths.append([[round(float(gx), 2), round(float(c - h + dy), 2), round(float(c + h + dy), 2)]
                          for gx, c, h in zip(grid, gy, gh)])
        ax, ay = rg.apply(nf['anchor'], Th)
        # 3) 앞발 가림 — 승인 프레임만(새 자세는 앞발이 내려가 목 앞을 가리지 않는다).
        #    전신 변환이 예측한 자리 주변(±25px·±15°)에서만 찾는다(넓게 찾으면 옆 부위에 붙는다)
        occ, occ_log = [], []
        if approved and nf['occluders']:
            body = _dilate(B[:, :, 3] > 128, 8)
            Tg, _ = rg.register(B, body, tgt, centroid(B[:, :, 3] > 128), angles=(-10, 10, 2.5),
                                scales=(.88, 1.12, .03))
            for poly in nf['occluders']:
                cp = centroid(poly_mask([poly]))
                pc = rg.apply(cp, Tg)
                To, so = rg.register(B, poly_mask([poly], 10), tgt, cp, max_shift=25,
                                     angles=(Tg[0] - 15, Tg[0] + 15, 5), scales=(Tg[1] * .9, Tg[1] * 1.1, .05),
                                     w_outline=1.0, d0=(pc[0] - cp[0], pc[1] - cp[1]))
                moved = [[round(px), round(py)] for px, py in (rg.apply(q, To) for q in poly)]
                # 외곽선으로 닫힌 앞발이면 실제 앞발 모양으로 다시 맞춘다. 못 찾으면 옮긴 그대로
                snapped = paw_blobs(C, moved)
                occ.append(snapped or moved)
                occ_log.append({'T': To, 'score': round(so, 3), 'snapped': bool(snapped)})
        # 사람 보정: 검정에 없는 가림(예: ginger reel-2 의 입을 가린 앞발)
        occ += ov.get('addOccluders', [])
        frame = {'paths': paths, 'anchor': [round(ax, 2), round(ay + ov.get('neck', {}).get('dy', 0), 2)],
                 'angle': round(nf['angle'] + Th[0]), 'width': nf['width'], 'occluders': occ}
        if avatar:
            # 그림 좌표 a = scale·q + (x, y) 인 보통 크기 좌표 q 로 바꿔 둔다 — 장식 크기 상수(drawWidth·펜던트 폭)를 그대로 쓰게
            k = Th[1]
            cx, cy = Th[2]
            ox, oy = rg.apply((cx, cy), Th)[0] - k * cx, rg.apply((cx, cy), Th)[1] - k * cy
            q = lambda px, py: (round((px - ox) / k, 2), round((py - oy) / k, 2))
            v = {'x': round(ox, 2), 'y': round(oy, 2), 'scale': round(k, 4)}
            hx, hy = q(head[fid]['x'], head[fid]['y'])
            head[fid] = {'x': hx, 'y': hy, 'angleDegrees': head[fid]['angleDegrees'], 'view': v}
            frame['paths'] = [[[*q(px, t)[:1], q(px, t)[1], q(px, b)[1]] for px, t, b in path] for path in frame['paths']]
            frame['anchor'] = list(q(*frame['anchor']))
            frame['view'] = v
        # 독서: 책이 목 전체를 가린다(6색 × 6프레임 확인) — 목 프레임을 두지 않아 앱이 목 장식을 그리지 않게 한다
        if group(fid) != 'read':
            neck['frames'][fid] = frame
        log[fid] = {'source': src, 'head': {'T': Th, 'score': round(sh, 3)}, 'occluders': occ_log}
    return head, neck, log


def main(colors):
    ov_path = HERE / 'overrides.json'
    overrides = json.load(open(ov_path)) if ov_path.exists() else {}
    for color in colors:
        d = OUT / color
        d.mkdir(parents=True, exist_ok=True)
        head, neck, log = transfer(color, overrides)
        if color == 'black':  # 검정 승인 프레임은 승인본 그대로, 새 자세만 생성값
            head_b, neck_b, _ = black_rigs()
            head.update(head_b)
            neck['frames'].update(neck_b['frames'])
        for name, v in (('head', head), ('neck', neck)):
            (d / f'{name}.json').write_text(json.dumps(v, separators=(',', ':')))
        (d / 'registration.json').write_text(json.dumps(log, indent=1))
        print(color, 'ok')


if __name__ == '__main__':
    main(sys.argv[1:] or fr.COLORS)
