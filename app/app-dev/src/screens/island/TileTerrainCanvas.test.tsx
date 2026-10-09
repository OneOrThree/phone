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
  navDebugText,
  TileTerrainCanvas,
  type NavDebug,
  type NavServerDebug,
} from './TileTerrainCanvas';

const noServer: NavServerDebug = {
  status: 'live',
  path: null,
  pathId: null,
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

  // correctionFlash·correctionBlinkVisible 자체 테스트는 navDebugClock.test.ts 로 옮겼다(GROMO-2249
  // 보완8 항목 1) — 함수가 거기로 이동했으니 테스트도 같이 이동한다.

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
    // now(debugNow) 가 snapshotReceivedAt 보다 과거면(새 스냅샷 수신 직후 아직 안 돈 시계) 음수
    // 대신 0 으로 클램프한다(보완5 지적 2).
    expect(
      navDebugText(
        null,
        'bundle',
        { ...noServer, predicted, snapshot, snapshotReceivedAt: 1000 },
        900,
      ),
    ).toBe('경로 없음 · nav bundle\n서버 Δ 5px · 틱 지연 0ms');
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

describe('서버 디버그 시계 — 보정 깜빡임 50ms, 창 밖이면 멈춘다 (GROMO-2249 라운드1 지적 1 · 보완6 지적 1 — 보완4 지적 2 번복)', () => {
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

  const debugWith = (correctedAt: number | null, status: NavServerDebug['status']): NavDebug => ({
    nav,
    walk: null,
    server: { ...noServer, status, correctedAt },
  });

  // 마운트 때 내 타이머와 무관하게 한 번 뜨는 타이머(useImage 비동기 로드 등)가 있다 — 짧게 흘려보내고
  // 기준을 잡는다(실측: 100ms 안에 가라앉고 다시는 안 생긴다). act() 로 감싸면 Skia mock 쪽이 재귀적으로
  // 다시 스케줄링해 수가 흔들린다 — 순수 틱 전진만 쓴다(React 의 act 경고는 무해해 여기선 무시한다).
  const settle = () => jest.advanceTimersByTime(200);

  it('correctedAt 이 500ms 보다 오래됐고 status 도 live 가 아니면 타이머를 만들지 않는다(라운드1 지적 1 유지)', async () => {
    jest.useFakeTimers();
    const now = Date.now();
    await render(<TileTerrainCanvas {...baseProps} navDebug={debugWith(now - 600, 'off')} />);
    settle();
    expect(jest.getTimerCount()).toBe(0);
  });

  it('server 가 null(동기화 꺼짐) 이면 타이머를 만들지 않는다', async () => {
    jest.useFakeTimers();
    await render(<TileTerrainCanvas {...baseProps} navDebug={{ nav, walk: null, server: null }} />);
    settle();
    expect(jest.getTimerCount()).toBe(0);
  });

  it('correctedAt 이 500ms 안이면 50ms 간격 타이머가 돌고, status 가 live 가 아니면 창이 끝나는 순간 멈춘다', async () => {
    jest.useFakeTimers();
    await render(<TileTerrainCanvas {...baseProps} navDebug={debugWith(Date.now(), 'off')} />);
    settle();
    expect(jest.getTimerCount()).toBeGreaterThan(0);
    jest.advanceTimersByTime(500); // 깜빡임 창(500ms) 을 넘긴다.
    expect(jest.getTimerCount()).toBe(0);
  });

  it('status 가 live 여도 깜빡임 창 밖이면 타이머가 없다 — 틱 지연 readout 은 WorldMap 의 debugNow 가 돌리므로 캔버스가 500ms 로 더 돌 필요가 없다(보완6 지적 1, 보완4 지적 2 번복)', async () => {
    jest.useFakeTimers();
    await render(<TileTerrainCanvas {...baseProps} navDebug={debugWith(Date.now(), 'live')} />);
    settle();
    expect(jest.getTimerCount()).toBeGreaterThan(0);
    jest.advanceTimersByTime(500); // 깜빡임 창(500ms) 을 넘긴다 — live 여도 멈춘다.
    expect(jest.getTimerCount()).toBe(0);
  });

  it('reduceMotion 이면 50ms 인터벌 대신 창 끝에만 도는 타이머 1개고, 창 안에서는 지워지지 않는다(보완8 항목 6)', async () => {
    jest.useFakeTimers();
    await render(
      <TileTerrainCanvas {...baseProps} reduceMotion navDebug={debugWith(Date.now(), 'off')} />,
    );
    settle();
    // 인터벌이라면 이미 여러 틱이 지났을 시간에도 — 창 끝에만 도는 타이머 1개뿐이다.
    expect(jest.getTimerCount()).toBe(1);
    jest.advanceTimersByTime(100);
    // 블링크 인터벌이면 벌써 꺼졌다 켜졌다 했을 시간이 지나도 단일 타이머가 그대로다 — 창이 안 끝났다.
    expect(jest.getTimerCount()).toBe(1);
    jest.advanceTimersByTime(500); // 창(500ms) 을 넘긴다.
    expect(jest.getTimerCount()).toBe(0);
  });

  it('식은 flashNow 상태에서 correctedAt 이 새로 들어오면 effect 가 틱 전에도 flashNow 를 즉시 리셋한다 — 커밋이 하나 더 는다(보완8 항목 7)', async () => {
    jest.useFakeTimers();
    let commits = 0;
    const onRender = () => {
      commits++;
    };
    const now0 = Date.now();
    const screen = await render(
      <React.Profiler id="flash-phase" onRender={onRender}>
        <TileTerrainCanvas {...baseProps} navDebug={debugWith(now0, 'off')} />
      </React.Profiler>,
    );
    settle();
    jest.advanceTimersByTime(500); // 깜빡임 창을 완전히 넘겨 인터벌이 스스로 멈춘다 — flashNow 는 그 마지막 틱에 식어 있다.
    commits = 0; // 여기부터 새로 센다.
    const now1 = Date.now(); // 창이 끝난 지 한참 지난 뒤 — now1 은 식은 flashNow 와 거리가 멀다.
    await screen.rerender(
      <React.Profiler id="flash-phase" onRender={onRender}>
        <TileTerrainCanvas {...baseProps} navDebug={debugWith(now1, 'off')} />
      </React.Profiler>,
    );
    // 리셋이 없으면 prop 변경 커밋 1개뿐 — flashNow 는 다음 50ms 틱이 와야 갱신된다. 즉시 리셋하면
    // effect 가 틱 전에도 setFlashNow 를 한 번 더 불러 커밋이 2개다.
    expect(commits).toBe(2);
  });
});
