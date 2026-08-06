// 진행 표기 3상의 **공통 조각** — 챌린지 카드(진행 리스트)와 결과 모달이 같은 문장을 쓰게 한다.
//
// 두 화면이 같은 데이터(memberProgress)를 그리는데 규칙을 따로 구현하고 있었고, 실제로
// 갈라진 지점이 있었다(PR #493 리뷰): 미집계 음성 안내가 카드는 '아직 집계되지 않음',
// 모달은 '집계 중'이었고, 분모 판정도 truthy 대 `=== null`로 달랐다.
//
// ⚠️ **전체 문장을 공유하지는 않는다.** 달성자 표기가 두 화면에서 의도적으로 다르다:
//   · 카드   — '달성 ✓'  (진행 중인 목록이라 달성 여부가 관심사다)
//   · 모달   — '72/60분' (결과 화면이라 판정 근거가 관심사다 — GROMO-1191의 본체)
// 그래서 공유하는 것은 "미집계"와 "기록 분 / 목표 분" 두 조각뿐이고, 달성 분기는 각자 갖는다.
// 여기서 통째로 합치면 결과 모달이 다시 근거를 잃는다.

/** 미집계 — SCREEN_TIME 통계가 없다. '0분 썼다'와 완전히 다른 뜻이라 0으로 뭉개지 않는다. */
export const UNMEASURED = '—';

/**
 * 기록 분 / 목표 분. 목표를 모르면 분모를 지어내지 않고 기록 분만 적는다.
 *
 * <p>목표가 없는 경우는 구 창(TIME_WINDOW) 챌린지처럼 서버가 durationMinutes 를 안 주는
 * 경우다. 0 도 목표로 치지 않는다 — 서버에 목표 상한·하한 검증이 없어(티켓 1205) 0 이
 * 들어오면 '72/0분'이라는 읽을 수 없는 표기가 된다.
 */
export function progressFraction(progressMinutes: number, goalMinutes: number | null): string {
  return goalMinutes ? `${progressMinutes}/${goalMinutes}분` : `${progressMinutes}분`;
}

/**
 * 미집계 행의 음성 안내 — VoiceOver 는 '—'를 "대시"로 읽어 뜻이 전달되지 않는다.
 * 행 전체를 한 덩어리로 읽히게 하는 것이 전제다(안 묶으면 닉네임과 진행이 따로 읽힌다).
 */
export function unmeasuredA11y(nickname: string): string {
  return `${nickname} 아직 집계되지 않음`;
}

/** 기록 분 행의 음성 안내. 방향(집중=채움, 스크린타임=사용)은 문장이 아니라 화면 맥락이 준다. */
export function progressFractionA11y(
  nickname: string,
  progressMinutes: number,
  goalMinutes: number | null,
): string {
  return goalMinutes
    ? `${nickname} ${goalMinutes}분 중 ${progressMinutes}분`
    : `${nickname} ${progressMinutes}분`;
}
