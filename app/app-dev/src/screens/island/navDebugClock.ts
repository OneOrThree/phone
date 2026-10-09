// 이동 보기 오버레이(GROMO-2249)의 시계 규칙 한 곳 — correctionFlash·correctionBlinkVisible 는
// TileTerrainCanvas.tsx(보정 원 깜빡임)에서 이동해 왔고, debugClockPeriod 는 WorldMap.tsx(틱 지연
// readout 시계)의 500ms 리터럴·중복 판정을 대체한다(GROMO-2249 보완8 항목 1). 이 모듈은 아무것도
// import 하지 않는 순수 함수 모음이라 WorldMap.tileIslandOff.test.tsx 가 './TileTerrainCanvas' 를
// `{ TileTerrainCanvas: () => null }` 로 얕게 mock 해도 영향이 없다 — 그 테스트가 mock 하는 건 이
// 모듈이 아니라 TileTerrainCanvas 뿐이다(그래서 매 렌더 무조건 불러야 하는 WorldMap 쪽 판정을 예전엔
// './TileTerrainCanvas' 에서 못 가져오고 복제해야 했다 — 이제 여기서 가져온다).
import type { NavServerDebug } from './TileTerrainCanvas';

/** 보정 깜빡임 창 길이(ms) — 이 창 안에서만 캔버스 원이 CORRECTION_TICK_MS 로 돈다. */
export const CORRECTION_WINDOW_MS = 500;

/**
 * 보정 창 안에서 캔버스 원이 깜빡이는 타이머 주기(ms, TileTerrainCanvas 의 setInterval 이 쓴다).
 * readout 시계(debugClockPeriod)는 더 이상 이 값을 쓰지 않는다 — 틱 지연 숫자는 500ms 로도 충분해
 * 50ms 로 따라갈 필요가 없다(GROMO-2249 보완9 항목 1).
 */
export const CORRECTION_TICK_MS = 50;

/** 보정 직후 CORRECTION_WINDOW_MS 만 깜빡인다 — now 를 외부에서 받는 순수 함수라 테스트 가능하다(GROMO-2249). */
export function correctionFlash(correctedAt: number | null, now: number): boolean {
  return correctedAt !== null && now - correctedAt < CORRECTION_WINDOW_MS;
}

/**
 * 보정 창(correctionFlash) 안에서 100ms 주기로 켜짐/꺼짐을 바꾼다 — 창 안이라고 쭉 켠 채로 두면
 * 500ms 동안 안 꺼지는 "표시"일 뿐 깜빡임이 아니다(GROMO-2249 보완7 지적 1). 50ms 타이머가 이미
 * 재렌더하므로 타이머는 그대로 두고 이 가시성 판정만 얹는다. 창 밖이면 무조건 꺼짐. now 가
 * correctedAt 보다 과거면(새 correctedAt 이 들어온 첫 렌더가 식은 flashNow 를 아직 못 바꾼 순간) 음수
 * 나머지 연산 탓에 한 프레임 꺼져 보이던 버그가 있었다 — 그때도 창 안·켜짐으로 본다(GROMO-2249 보완9
 * 항목 3).
 */
export function correctionBlinkVisible(correctedAt: number | null, now: number): boolean {
  if (!correctionFlash(correctedAt, now)) return false;
  if (now < (correctedAt as number)) return true;
  return Math.floor((now - (correctedAt as number)) / 100) % 2 === 0;
}

/**
 * 틱 지연·대기 readout 시계 주기(WorldMap.tsx) — live 면 500ms, 아니면 안 돈다(null). 보정 창
 * 50ms(CORRECTION_TICK_MS)는 캔버스 원 자신의 타이머 몫이다 — readout 은 틱 지연 숫자만 그리므로
 * 50ms 로 더 자주 갈 필요가 없고, 보정 한 번당 10회 더 돌던 재렌더가 사라진다(GROMO-2249 보완9 항목 1).
 */
export function debugClockPeriod(server: NavServerDebug | null | undefined): number | null {
  return server?.status === 'live' ? 500 : null;
}
