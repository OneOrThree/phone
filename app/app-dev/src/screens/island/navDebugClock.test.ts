import {
  CORRECTION_TICK_MS,
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

it('CORRECTION_TICK_MS 는 50ms', () => {
  expect(CORRECTION_TICK_MS).toBe(50);
});

it('correctionFlash: 499ms 는 깜빡이고 501ms·null 은 꺼진다', () => {
  expect(correctionFlash(1000, 1499)).toBe(true);
  expect(correctionFlash(1000, 1501)).toBe(false);
  expect(correctionFlash(null, 1499)).toBe(false);
});

it('correctionBlinkVisible: 창 안에서 100ms 주기로 켜짐·꺼짐, 창 밖이면 무조건 꺼짐(보완7 지적 1)', () => {
  const t0 = 1000;
  // now < correctedAt(식은 flashNow 의 첫 렌더) 도 창 안으로 보고 켜짐 — 음수 나머지로 한 프레임 꺼져
  // 보이던 버그(보완9 항목 3).
  expect(correctionBlinkVisible(t0, t0 - 5)).toBe(true);
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

describe('debugClockPeriod (GROMO-2249 보완9 항목 1 — WorldMap readout 시계 주기, 창 안도 500 으로 통일)', () => {
  it('live 면 보정 창 안팎 모두 500, live 가 아니면(denied·off 등) null', () => {
    // correctedAt 유무(창 안·밖)는 더 이상 결과를 바꾸지 않는다 — live 만 본다.
    expect(debugClockPeriod({ ...noServer, status: 'live', correctedAt: 1000 })).toBe(500);
    expect(debugClockPeriod({ ...noServer, status: 'live', correctedAt: null })).toBe(500);
    expect(debugClockPeriod({ ...noServer, status: 'denied', correctedAt: 1000 })).toBeNull();
    expect(debugClockPeriod({ ...noServer, status: 'off', correctedAt: null })).toBeNull();
    expect(debugClockPeriod(null)).toBeNull();
    expect(debugClockPeriod(undefined)).toBeNull();
  });
});
