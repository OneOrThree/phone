/**
 * @jest-environment @shopify/react-native-skia/jestEnv.js
 */
// Skia 공식 jest 설정: CanvasKit(wasm)을 올리는 jestEnv 를 이 파일에만 건다(mock 은 jest.setup.js).
import React from 'react';
import { render } from '@testing-library/react-native';
import {
  buildArrowPath,
  buildBlockedPath,
  buildTerrainAtlas,
  correctionFlash,
  navDebugText,
  TileTerrainCanvas,
  type NavDebug,
  type NavServerDebug,
} from './TileTerrainCanvas';

const noServer: NavServerDebug = {
  status: 'live',
  path: null,
  snapshot: null,
  predicted: null,
  correctedAt: null,
  snapshotReceivedAt: null,
  waitingSince: null,
};

describe('buildTerrainAtlas', () => {
  const { sprites, transforms } = buildTerrainAtlas({ kind: 'bundle' });

  it('지형 24×16 = 384 조각을 한 배열로 만든다', () => {
    expect(sprites).toHaveLength(384);
    expect(transforms).toHaveLength(384);
  });

  it('아틀라스 소스 rect 는 margin 1 · pitch 130(128+spacing 2) · 31열', () => {
    expect([sprites[0].x, sprites[0].y, sprites[0].width, sprites[0].height]).toEqual([
      1, 1, 128, 128,
    ]);
    // gid 384 → slot 383 = 12행 11열
    const last = sprites[383];
    expect([last.x, last.y, last.width, last.height]).toEqual([
      1 + 11 * 130,
      1 + 12 * 130,
      128,
      128,
    ]);
  });

  it('목적지는 1x 64px 격자, 2x→1x 축소 0.5, 회전 없음', () => {
    const t0 = transforms[0];
    expect([t0.scos, t0.ssin, t0.tx, t0.ty]).toEqual([0.5, 0, 0, 0]);
    const t25 = transforms[25]; // 2행 2열
    expect([t25.tx, t25.ty]).toEqual([64, 64]);
    const last = transforms[383];
    expect([last.tx, last.ty]).toEqual([23 * 64, 15 * 64]);
  });
});

describe('이동 보기 helper', () => {
  it('막힌 셀만 한 경로로 묶는다(셀 크기 = 1536/cols × 1024/rows)', () => {
    const nav = { cols: 4, rows: 2, walkable: Uint8Array.from([1, 0, 1, 1, 1, 1, 1, 1]) } as any;
    const b = buildBlockedPath(nav).getBounds();
    expect([b.x, b.y, b.width, b.height]).toEqual([384, 0, 384, 512]);
  });

  it('읽기 줄: 경로 칸 수 · 탭과 목적지 거리 · nav 출처', () => {
    const path = [
      { x: 0, y: 0 },
      { x: 30, y: 0 },
      { x: 30, y: 40 },
    ];
    expect(navDebugText({ tap: { x: 0, y: 40 }, path }, 'cache')).toBe(
      '경로 2칸 · 보정 30px · nav cache',
    );
    expect(navDebugText(null, 'bundle')).toBe('경로 없음 · nav bundle');
  });
});

describe('서버 이동 보기 helper (GROMO-2249)', () => {
  it('buildArrowPath: 자루+쉐브론 bounds 는 scale 로 나뉜다', () => {
    const b1 = buildArrowPath({ x: 0, y: 0 }, { x: 20, y: 0 }, 1).getBounds();
    expect([b1.x, b1.y, b1.width, b1.height]).toEqual([0, -4, 20, 8]);
    const b2 = buildArrowPath({ x: 0, y: 0 }, { x: 20, y: 0 }, 2).getBounds();
    expect([b2.x, b2.y, b2.width, b2.height]).toEqual([0, -2, 20, 4]);
  });

  it('correctionFlash: 499ms 는 깜빡이고 501ms·null 은 꺼진다', () => {
    expect(correctionFlash(1000, 1499)).toBe(true);
    expect(correctionFlash(1000, 1501)).toBe(false);
    expect(correctionFlash(null, 1499)).toBe(false);
  });

  it('navDebugText 둘째 줄: Δ·지연 / 대기 / 없음 세 가지', () => {
    const predicted = { x: 10, y: 0 },
      snapshot = { x: 13, y: 4 };
    // Δ = hypot(3,4) = 5. snapshotReceivedAt 은 절대 시각 — 틱 지연은 now - snapshotReceivedAt(보완 3).
    expect(
      navDebugText(
        null,
        'bundle',
        { ...noServer, predicted, snapshot, snapshotReceivedAt: 1000 },
        1083.4,
      ),
    ).toBe('경로 없음 · nav bundle\n서버 Δ 5px · 틱 지연 83ms');
    expect(navDebugText(null, 'bundle', { ...noServer, waitingSince: 1000 }, 1300)).toBe(
      '경로 없음 · nav bundle\n서버 대기 300ms',
    );
    expect(navDebugText(null, 'bundle', noServer)).toBe('경로 없음 · nav bundle\n서버 없음');
    // server 를 안 주면(기존 호출) 둘째 줄이 없다 — 기존 동작 불변.
    expect(navDebugText(null, 'bundle')).toBe('경로 없음 · nav bundle');
  });

  it('navDebugText 둘째 줄: server 가 null(동기화 off) 이면 「서버 없음」, denied 면 「동기화 거절됨」(보완 2·5)', () => {
    // undefined(생략)와 달리 null 은 "동기화 off 를 명시한 호출" — 둘째 줄에 서버 없음을 보여준다.
    expect(navDebugText(null, 'bundle', null)).toBe('경로 없음 · nav bundle\n서버 없음');
    expect(navDebugText(null, 'bundle', { ...noServer, status: 'denied' })).toBe(
      '경로 없음 · nav bundle\n동기화 거절됨',
    );
  });

  it('navDebugText 둘째 줄: 대기 + 스냅샷·예측이 둘 다 있으면 대기가 우선한다(지적 1)', () => {
    const predicted = { x: 10, y: 0 },
      snapshot = { x: 13, y: 4 };
    // 첫 Snapshot 뒤 새 이동 명령을 보내 waitingSince 가 다시 생겨도 지난 snapshot·predicted 는
    // 아직 남아 있다 — Δ·지연 조건은 계속 참이지만 대기 중이라는 사실을 먼저 보여준다.
    expect(
      navDebugText(
        null,
        'bundle',
        { ...noServer, predicted, snapshot, snapshotReceivedAt: 1000, waitingSince: 1000 },
        1300,
      ),
    ).toBe('경로 없음 · nav bundle\n서버 대기 300ms');
  });
});

describe('보정 깜빡임 50ms 타이머 (GROMO-2249 보완 — 항목 1)', () => {
  const nav = { cols: 1, rows: 1, walkable: Uint8Array.from([1]) } as any;
  const baseProps = {
    width: 100,
    height: 100,
    camera: { x: 0, y: 0, z: 1 },
    base: 1,
    night: false,
    // kind:'cache' 면 tilesetUri 가 URI 를 돌려줘 require('.../tileset.png') 를 안 탄다 — Metro 전용
    // @2x 배율 리졸브라 jest 에서는 못 찾는다(실제 로드는 안 해도 되는 테스트라 가짜 경로로 충분하다).
    assets: { kind: 'cache' as const, mapVersion: 1, dir: 'file:///fake', path: 'home/1' },
  };

  afterEach(() => {
    jest.useRealTimers();
  });

  const debugWith = (correctedAt: number | null): NavDebug => ({
    nav,
    walk: null,
    server: { ...noServer, correctedAt },
  });

  // 마운트 때 내 타이머와 무관하게 한 번 뜨는 타이머(useImage 비동기 로드 등)가 있다 — 짧게 흘려보내고
  // 기준을 잡는다(실측: 100ms 안에 가라앉고 다시는 안 생긴다). act() 로 감싸면 Skia mock 쪽이 재귀적으로
  // 다시 스케줄링해 수가 흔들린다 — 순수 틱 전진만 쓴다(React 의 act 경고는 무해해 여기선 무시한다).
  const settle = () => jest.advanceTimersByTime(200);

  it('correctedAt 이 500ms 보다 오래됐으면 50ms 간격 타이머를 만들지 않는다', async () => {
    jest.useFakeTimers();
    const now = Date.now();
    await render(<TileTerrainCanvas {...baseProps} navDebug={debugWith(now - 600)} />);
    settle();
    expect(jest.getTimerCount()).toBe(0);
  });

  it('correctedAt 이 500ms 안이면 50ms 간격 타이머가 돌고, 창이 끝나면 스스로 clear 한다(server 가 있다고 상시 돌리지 않는다)', async () => {
    jest.useFakeTimers();
    await render(<TileTerrainCanvas {...baseProps} navDebug={debugWith(Date.now())} />);
    settle();
    expect(jest.getTimerCount()).toBeGreaterThan(0);
    jest.advanceTimersByTime(500); // 깜빡임 창(500ms) 을 넘긴다.
    expect(jest.getTimerCount()).toBe(0);
  });
});
