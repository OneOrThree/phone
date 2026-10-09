// 이동 보기 오버레이(GROMO-2249)의 시계 규칙 한 곳 — correctionFlash·correctionBlinkVisible 는
// TileTerrainCanvas.tsx(보정 원 깜빡임)에서 이동해 왔고, debugClockPeriod 는 WorldMap.tsx(틱 지연
// readout 시계)의 500ms 리터럴·중복 판정을 대체한다(GROMO-2249 보완8 항목 1). 이 모듈은 아무것도
// import 하지 않는 순수 함수 모음이라 WorldMap.tileIslandOff.test.tsx 가 './TileTerrainCanvas' 를
// `{ TileTerrainCanvas: () => null }` 로 얕게 mock 해도 영향이 없다 — 그 테스트가 mock 하는 건 이
// 모듈이 아니라 TileTerrainCanvas 뿐이다(그래서 매 렌더 무조건 불러야 하는 WorldMap 쪽 판정을 예전엔
// './TileTerrainCanvas' 에서 못 가져오고 복제해야 했다 — 이제 여기서 가져온다).
import type { NavServerDebug } from './TileTerrainCanvas';

/** 보정 깜빡임 창 길이(ms) — 이 창 안에서만 캔버스 원·readout 시계가 50ms 로 돈다. */
export const CORRECTION_WINDOW_MS = 500;

/** 보정 직후 CORRECTION_WINDOW_MS 만 깜빡인다 — now 를 외부에서 받는 순수 함수라 테스트 가능하다(GROMO-2249). */
export function correctionFlash(correctedAt: number | null, now: number): boolean {
  return correctedAt !== null && now - correctedAt < CORRECTION_WINDOW_MS;
}

/**
 * 보정 창(correctionFlash) 안에서 100ms 주기로 켜짐/꺼짐을 바꾼다 — 창 안이라고 쭉 켠 채로 두면
 * 500ms 동안 안 꺼지는 "표시"일 뿐 깜빡임이 아니다(GROMO-2249 보완7 지적 1). 50ms 타이머가 이미
 * 재렌더하므로 타이머는 그대로 두고 이 가시성 판정만 얹는다. 창 밖이면 무조건 꺼짐.
 */
export function correctionBlinkVisible(correctedAt: number | null, now: number): boolean {
  return (
    correctionFlash(correctedAt, now) && Math.floor((now - (correctedAt as number)) / 100) % 2 === 0
  );
}

/**
 * 틱 지연·대기 readout 시계 주기(WorldMap.tsx) — 보정 깜빡임 창 안이면 50ms, 창 밖에서 live 면
 * 500ms, 둘 다 아니면 안 돈다(null). reduceMotion 이면 50ms 분기(장식 모션)를 타지 않는다 — live 의
 * 500ms 는 숫자(틱 지연)가 실제로 갱신되는 것이라 장식 모션이 아니므로 그대로 둔다(GROMO-2249 보완8
 * 항목 6).
 */
export function debugClockPeriod(
  server: NavServerDebug | null | undefined,
  now: number,
  reduceMotion = false,
): number | null {
  if (!reduceMotion && correctionFlash(server?.correctedAt ?? null, now)) return 50;
  if (server?.status === 'live') return 500;
  return null;
}
