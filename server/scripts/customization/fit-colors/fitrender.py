"""앱 catFit.ts + CatOutfitLayers.recordFit 을 skia-python 으로 옮긴 검토용 합성기. 보간은 선형."""
import json
import math
from functools import lru_cache
from pathlib import Path

import numpy as np
import skia
from PIL import Image

W = Path(__file__).resolve().parents[4]  # 저장소 루트
STATIC = W / 'server/static'
CAT = W / 'app/app-dev/src/assets/characters/cat'
CATALOG = W / 'server/data-api/src/main/resources/customization/reward-catalog-v1.json'
COLORS = ['black', 'ginger', 'cream', 'gray', 'white', 'calico']
# 프레임 id → 고양이 그림. 애니메이션은 <자세>-<번호>, 정적 그림은 still/<이름>.
# read 는 6칸 아틀라스(3072×512)의 i번째 512 칸, avatar 는 256² 그림을 512² 로 키운 좌표계(128² avatar-*.png 와 같은 그림).
ANIM = {'walk': ('walking/walking-frame-%d', 6), 'focus': ('fishing/fishing-frame-%d', 4),
        'reel': ('fishing/reel-frame-%d', 4), 'blink': ('blink/blink-frame-%d', 3), 'read': ('reading/atlas', 6)}
STILLS = {'idle': 'idle', 'loaf': 'loaf/loaf', 'avatar': 'avatar'}
FRAMES = [f'{m}-{i}' for m, (_, n) in ANIM.items() for i in range(n)] + [f'still/{k}' for k in STILLS]
LINEAR = skia.SamplingOptions(skia.FilterMode.kLinear, skia.MipmapMode.kNone)


@lru_cache(None)
def cat_rgba(color, fid):
    """그 프레임의 고양이 그림을 512² RGBA 로."""
    if fid.startswith('still/'):
        im = Image.open(CAT / color / f'{STILLS[fid[6:]]}.png').convert('RGBA')
        return np.array(im if im.size == (512, 512) else im.resize((512, 512), Image.LANCZOS))
    m, i = fid.rsplit('-', 1)
    t = ANIM[m][0]
    im = Image.open(CAT / color / f'{t % int(i) if "%" in t else t}.png').convert('RGBA')
    if m == 'read':
        im = im.crop((int(i) * 512, 0, int(i) * 512 + 512, 512))
    return np.array(im)


@lru_cache(None)
def catalog():
    items = json.load(open(CATALOG))['items']
    return {i['productId']: i for i in items if i['kind'] in ('head', 'neck')}


@lru_cache(None)
def sk_image(path):
    return skia.Image.MakeFromEncoded(skia.Data.MakeFromFileName(str(path)))


def static(p):
    return STATIC / p.removeprefix('/static/')


def sample(paths, x):
    pts = [p for path in paths for p in path]
    best = pts[0]
    for i in range(len(pts) - 1):
        a, b = pts[i], pts[i + 1]
        if a[0] <= x <= b[0]:
            u = (x - a[0]) / (b[0] - a[0]) if b[0] != a[0] else 0
            return a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u
        if abs(pts[i][0] - x) < abs(best[0] - x):
            best = pts[i]
    return best[1], best[2]


def band_ops(img, box, paths):
    l, t, r, b = box
    ops = []
    for path in paths:
        start, end = path[0][0], path[-1][0]
        x = start
        while x < end:
            top, bottom = sample([path], x)
            sx = l + (x - start) / (end - start) * (r - l - 1)
            ops.append((img, (sx, t, max(1, (r - l) / (end - start) * .65), b - t), (x, top, .65, bottom - top), None))
            x += .5
    return ops


def neck_ops(rd, p):
    v = rd['views']
    l, t, r, b = v['front']['box']
    style = rd['neckStyle']
    allp = [q for path in p['paths'] for q in path]
    front = []
    if style == 'scarf':
        left, right = min(a[0] for a in allp), max(a[0] for a in allp)
        w = min(86, (right - left) * .83)
        cx = max(left + w / 2, min(right - w / 2, p['anchor'][0] - 10))
        h = min(48, w * (b - t) / (r - l))
        cols = v['front']['columns']
        x = 0
        while x < w:
            px = cx - w / 2 + x
            top, bottom = sample(p['paths'], px)
            sx = l + x / w * (r - l)
            sy = cols[min(r - l - 1, math.floor(sx - l))]
            if sy is not None:
                front.append(('item', (sx, sy, max(1, (r - l) / w * .65), b - sy),
                              (px, (top + bottom) / 2 - 1, .65, h * (b - sy) / (b - t)), None))
            x += .5
    else:
        w = 54 if style == 'bow' else 29
        h = w * (b - t) / (r - l)
        front.append(('item', (l, t, r - l, b - t), (-w / 2, -h * (.42 if style == 'bow' else .14), w, h),
                      (p['anchor'][0], p['anchor'][1], p['angle'])))
    band = band_ops('item', v['band']['box'], p['paths']) if 'band' in v else \
        band_ops('band', rd['commonBand']['view']['box'], p['paths'])
    jaw = [(allp[0][0], 0), *[(x, top - 1) for x, top, _ in allp], (allp[-1][0], 0)]
    return (front + band if style == 'scarf' else band + front), [jaw, *p['occluders']]


def rect(r):
    return skia.Rect.MakeXYWH(*r)


def record(pid, fid, rigs):
    """한 아이템·한 프레임을 512² 레이어로 — rigs = {'head': {fid: {x,y,angleDegrees}}, 'neck': {...}}."""
    item = catalog()[pid]
    rd = item['renderData']
    kind = item['kind']
    surf = skia.Surface(512, 512)
    c = surf.getCanvas()
    c.clear(skia.ColorTRANSPARENT)
    paint = skia.Paint(AntiAlias=True)
    img = sk_image(static(rd['source']['path']))
    band = sk_image(static(rd['commonBand']['path'])) if kind == 'neck' else None

    def draw(op):
        which, src, dst, at = op
        im = band if which == 'band' else img
        if at:
            c.save()
            c.translate(at[0], at[1])
            c.rotate(at[2])
        c.drawImageRect(im, rect(src), rect(dst), LINEAR, paint, skia.Canvas.kStrict_SrcRectConstraint)
        if at:
            c.restore()

    def view(v):
        # 정적 그림 중 고양이가 확대돼 있는 그림(avatar): 리그는 보통 고양이 크기 좌표, 그림에 맞게 한 번 옮기고 키운다
        if v:
            c.translate(v['x'], v['y'])
            c.scale(v['scale'], v['scale'])

    if kind == 'head':
        ct = rigs['head'].get(fid)
        if not ct:
            return None
        view(ct.get('view'))
        l, t, r, b = rd['source']['crop']
        w = rd['drawWidth']
        h = w * (b - t) / (r - l)
        x, y, deg = ct['x'], ct['y'] + rd['itemDepthY'], ct['angleDegrees']
        sh = skia.Paint(AntiAlias=True, Color=skia.Color4f(51 / 255, 27 / 255, 14 / 255, .18))
        c.save(); c.translate(x, y); c.rotate(deg)
        rx, ry = w * rd['contactShadow']['widthFactor'], rd['contactShadow']['height']
        c.drawOval(skia.Rect.MakeXYWH(-rx, -ry, rx * 2, ry * 2), sh)
        c.restore()
        draw(('item', (l, t, r - l, b - t), (-w / 2, -h, w, h), (x, y, deg)))
    elif kind == 'neck':
        p = rigs['neck']['frames'].get(fid)
        if not p or not p['paths']:
            return None
        ops, erase = neck_ops(rd, p)
        view(p.get('view'))
        c.saveLayer()
        for op in ops:
            draw(op)
        er = skia.Paint(AntiAlias=True, BlendMode=skia.BlendMode.kDstOut)
        for poly in erase:
            path = skia.Path()
            path.moveTo(*poly[0])
            for q in poly[1:]:
                path.lineTo(*q)
            path.close()
            c.drawPath(path, er)
        c.restore()
    else:
        return None
    return surf.makeImageSnapshot()


def compose(color, fid, outfit, rigs, debug=None):
    """고양이 원본 위에 neck → head 순으로 (앱 FIT_ORDER) 얹은 512² RGBA numpy."""
    surf = skia.Surface(512, 512)
    c = surf.getCanvas()
    c.clear(skia.ColorTRANSPARENT)
    c.drawImage(skia.Image.fromarray(cat_rgba(color, fid), colorType=skia.kRGBA_8888_ColorType), 0, 0)
    for slot in ('neck', 'head'):
        pid = outfit.get(slot)
        if pid:
            layer = record(pid, fid, rigs)
            if layer is not None:
                c.drawImage(layer, 0, 0, LINEAR)
    if debug:
        debug(c)
    return surf.makeImageSnapshot().toarray(colorType=skia.kRGBA_8888_ColorType)
