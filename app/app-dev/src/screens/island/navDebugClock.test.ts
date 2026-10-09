import {
  CORRECTION_WINDOW_MS,
  correctionBlinkVisible,
  correctionFlash,
  debugClockPeriod,
} from './navDebugClock';
import type { NavServerDebug } from './TileTerrainCanvas';

// TileTerrainCanvas.test.tsx 의 「서버 이동 보기 helper」 테스트 중 correctionFlash·correctionBlinkVisible
// 부분을 이 모듈로 그대로 옮긴다(GROMO-2249 보완8 항목 1) — 함수가 이동했으니 테스트도 같이 옮긴다.
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

it('CORRECTION_WINDOW_MS 는 500ms', () => {
  expect(CORRECTION_WINDOW_MS).toBe(500);
});

it('correctionFlash: 499ms 는 깜빡이고 501ms·null 은 꺼진다', () => {
  expect(correctionFlash(1000, 1499)).toBe(true);
  expect(correctionFlash(1000, 1501)).toBe(false);
  expect(correctionFlash(null, 1499)).toBe(false);
});

it('correctionBlinkVisible: 창 안에서 100ms 주기로 켜짐·꺼짐, 창 밖이면 무조건 꺼짐(보완7 지적 1)', () => {
  const t0 = 1000;
  // 0·50ms 켜짐.
  expect(correctionBlinkVisible(t0, t0 + 0)).toBe(true);
  expect(correctionBlinkVisible(t0, t0 + 50)).toBe(true);
  // 100·150ms 꺼짐.
  expect(correctionBlinkVisible(t0, t0 + 100)).toBe(false);
  expect(correctionBlinkVisible(t0, t0 + 150)).toBe(false);
  // 200ms 다시 켜짐.
  expect(correctionBlinkVisible(t0, t0 + 200)).toBe(true);
  // 500ms 부터는 깜빡임 창(correctionFlash) 자체가 꺼져 있어, 주기상 켜질 차례여도 꺼짐이다.
  expect(correctionBlinkVisible(t0, t0 + 400)).toBe(true);
  expect(correctionBlinkVisible(t0, t0 + 500)).toBe(false);
  expect(correctionBlinkVisible(null, t0)).toBe(false);
});

describe('debugClockPeriod (GROMO-2249 보완8 항목 1 — WorldMap readout 시계 주기)', () => {
  it('보정 창 안이면 50, 창 밖에서 live 면 500, 둘 다 아니면 null', () => {
    expect(debugClockPeriod({ ...noServer, status: 'live', correctedAt: 1000 }, 1100)).toBe(50);
    expect(debugClockPeriod({ ...noServer, status: 'live', correctedAt: 1000 }, 1600)).toBe(500);
    expect(debugClockPeriod({ ...noServer, status: 'off', correctedAt: null }, 1600)).toBeNull();
    expect(debugClockPeriod(null, 1600)).toBeNull();
    expect(debugClockPeriod(undefined, 1600)).toBeNull();
  });

  it('창 안이라도 live 가 아니면(denied 등 비-live) 50 — status 가 아니라 창이 우선', () => {
    expect(debugClockPeriod({ ...noServer, status: 'denied', correctedAt: 1000 }, 1100)).toBe(50);
  });

  it('reduceMotion 이면 창 안이어도 50 분기를 타지 않는다 — live 의 500 은 숫자 갱신이라 유지한다(보완8 항목 6)', () => {
    expect(debugClockPeriod({ ...noServer, status: 'live', correctedAt: 1000 }, 1100, true)).toBe(
      500,
    );
    expect(
      debugClockPeriod({ ...noServer, status: 'off', correctedAt: 1000 }, 1100, true),
    ).toBeNull();
  });
});
