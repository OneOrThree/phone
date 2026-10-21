"""검정 고양이 프레임의 한 부위(머리·앞발·발)를 다른 털색 프레임의 같은 부위에 맞추는 닮음 변환 탐색.

특징: 알파(+1 고양이 / -1 배경 / 0 무시)와 외곽선(진갈색 선, 흐림). FFT 상관으로 이동량을, 격자로 회전·배율을 찾는다.
"""
import math

import numpy as np
from PIL import Image, ImageFilter

PAD = 64
WIDE_PAD = 256  # avatar 처럼 크게 옮겨 찾을 때만


def alpha(rgba):
    return (rgba[:, :, 3] > 128).astype(np.float32)


def outline(rgba):
    a = rgba.astype(np.int16)
    # 외곽선·줄무늬 끝선은 진갈색(G 낮고 R>B). 검정 털(87,75,71)은 G 가 높아 빠진다
    m = (a[:, :, 3] > 128) & (a[:, :, 1] < 45) & (a[:, :, 0] - a[:, :, 2] > 10)
    im = Image.fromarray((m * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(2))
    return np.asarray(im, np.float32) / 255


def warp(img, theta, s, c, shift=(0, 0)):
    """img 를 c 기준 theta(도)·배율 s 로 돌린 뒤 shift 만큼 옮긴 그림(같은 크기)."""
    t = math.radians(theta)
    ca, sa = math.cos(t) / s, math.sin(t) / s
    cx, cy = c[0] + shift[0], c[1] + shift[1]
    # 역사상: src = R^-1 (dst - c') / s + c
    m = (ca, sa, c[0] - ca * cx - sa * cy, -sa, ca, c[1] + sa * cx - ca * cy)
    return np.asarray(Image.fromarray(img.astype(np.float32), 'F').transform(
        (img.shape[1], img.shape[0]), Image.AFFINE, m, Image.BILINEAR), np.float32)


def apply(pt, T):
    """점 하나에 변환 T=(theta, s, c, dx, dy)."""
    theta, s, c, dx, dy = T
    t = math.radians(theta)
    x, y = pt[0] - c[0], pt[1] - c[1]
    return (c[0] + s * (x * math.cos(t) - y * math.sin(t)) + dx,
            c[1] + s * (x * math.sin(t) + y * math.cos(t)) + dy)


def _pad(a, fill, pad=PAD):
    out = np.full((a.shape[0] + 2 * pad, a.shape[1] + 2 * pad), fill, np.float32)
    out[pad:-pad, pad:-pad] = a
    return out


class Target:
    """대상(색) 프레임의 특징(패딩 포함). wide=True 면 크게 옮겨 찾을 수 있게 넓게 패딩한다."""

    def __init__(self, rgba, wide=False):
        self.pad = WIDE_PAD if wide else PAD
        self.A = _pad(alpha(rgba) * 2 - 1, -1, self.pad)
        self.O = _pad(outline(rgba), 0, self.pad)


def _corr(F, S):
    return np.fft.irfft2(F * np.conj(np.fft.rfft2(S)), s=S.shape)


def register(src_rgba, region, target, c, max_shift=45, angles=(-12, 12, 3), scales=(.86, 1.14, .04),
             w_outline=0.0, d0=(0, 0)):
    """region(0/1, src 좌표) 안의 검정 부위를 target 에서 찾는다. 반환 (T, score). score 는 영역 픽셀당 일치도(-1~1)."""
    A = alpha(src_rgba)
    P = target.pad
    S_a = _pad(np.where(region > 0, A * 2 - 1, 0).astype(np.float32), 0, P)
    O = outline(src_rgba)
    S_o = _pad(np.where(region > 0, O - O[region > 0].mean(), 0).astype(np.float32), 0, P) if w_outline else None
    norm = float((region > 0).sum())
    # 영역 주변 창만 계산한다 — 회전·배율 여유 + 최대 이동량만큼 넓힌다(순환 상관이 감기지 않게)
    ys, xs = np.nonzero(region > 0)
    x0, x1, y0, y1 = xs.min() + P, xs.max() + P + 1, ys.min() + P, ys.max() + P + 1
    # d0: 예상 이동량(전신 변환에서) — 그 주변 ±max_shift 만 찾는다
    m = int(.2 * max(x1 - x0, y1 - y0)) + max_shift + 4 + int(max(abs(d0[0]), abs(d0[1])))
    wx0, wy0 = max(0, x0 - m), max(0, y0 - m)
    wx1, wy1 = min(S_a.shape[1], x1 + m), min(S_a.shape[0], y1 + m)
    if P == WIDE_PAD:  # 넓은 대상(avatar) — 템플릿이 창 밖으로 잘리지 않게 캔버스 전체
        wx0, wy0, wx1, wy1 = 0, 0, S_a.shape[1], S_a.shape[0]
    win = (slice(wy0, wy1), slice(wx0, wx1))
    cc = (c[0] + P - wx0, c[1] + P - wy0)
    FA = np.fft.rfft2(target.A[win])
    FO = np.fft.rfft2(target.O[win]) if w_outline else None
    sa0 = S_a[win]
    so0 = S_o[win] if w_outline else None

    def scan(ths, ss, best):
        for th in ths:
            for s in ss:
                wa = warp(sa0, th, s, cc, d0)
                # 배율이 클수록 겹치는 면적이 커지므로 변환된 틀의 면적으로 나눈다
                sc = _corr(FA, wa) / np.abs(wa).sum()
                if w_outline:
                    wo = warp(so0, th, s, cc, d0)
                    sc = sc + w_outline * _corr(FO, wo) / np.abs(wo).sum()
                # 순환 상관에서 |d|<=max_shift 만
                sub = np.concatenate([sc[-max_shift:], sc[:max_shift + 1]], 0)
                sub = np.concatenate([sub[:, -max_shift:], sub[:, :max_shift + 1]], 1)
                iy, ix = np.unravel_index(np.argmax(sub), sub.shape)
                v = float(sub[iy, ix])
                if v > best[0]:
                    # 포물선 보간으로 소수 이동
                    def para(a, b, cc):
                        d = a - 2 * b + cc
                        return 0 if d == 0 else .5 * (a - cc) / d
                    fy = para(sub[iy - 1, ix], v, sub[iy + 1, ix]) if 0 < iy < sub.shape[0] - 1 else 0
                    fx = para(sub[iy, ix - 1], v, sub[iy, ix + 1]) if 0 < ix < sub.shape[1] - 1 else 0
                    best = (v, th, s, ix - max_shift + fx, iy - max_shift + fy)
        return best

    a0, a1, da = angles
    s0, s1, ds = scales
    best = scan(np.arange(a0, a1 + 1e-6, da), np.arange(s0, s1 + 1e-6, ds), (-1e18,))
    _, th, s, _, _ = best
    best = scan(np.arange(th - da / 2, th + da / 2 + 1e-6, da / 4), np.arange(s - ds / 2, s + ds / 2 + 1e-6, ds / 4), best)
    v, th, s, dx, dy = best
    return (float(th), float(s), (float(c[0]), float(c[1])), float(dx + d0[0]), float(dy + d0[1])), float(v)
