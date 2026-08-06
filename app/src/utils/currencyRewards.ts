// 재화(시간조각) 목표 보상 공식 — 백엔드 CurrencyRewardPolicy.java의 미러(표시 전용).
// ⚠️ 실제 지급은 서버가 한다(서버 권위). 여기 값은 축하 모달의 "+N ⏳ 획득!" 표기용일 뿐이므로,
// 서버 공식(back/.../currency/service/CurrencyRewardPolicy.java)이 바뀌면 이 파일도 함께 맞춰야 한다.

// 집중 목표 달성 보상 — 목표 1시간당 +10, 8시간(+80)부터 동결. 부분 시간은 내림(floor).
export function focusGoalReward(goalMinutes: number): number {
  if (goalMinutes <= 0) return 0;
  const tier = Math.min(8, Math.max(1, Math.floor(goalMinutes / 60)));
  return tier * 10;
}

// 스크린타임 목표 달성 보상 — 사용 상한이 낮을수록 +10씩(1h 이하 +80 ~ 7h 초과 +10).
// 상한 미설정(≤0)이면 0 — 서버 지급 스킵 규칙(ScreenTimeService.creditScreenTimeGoal)과 일치.
export function screenTimeGoalReward(limitMinutes: number): number {
  if (limitMinutes <= 0) return 0;
  if (limitMinutes <= 60) return 80;
  if (limitMinutes <= 120) return 70;
  if (limitMinutes <= 180) return 60;
  if (limitMinutes <= 240) return 50;
  if (limitMinutes <= 300) return 40;
  if (limitMinutes <= 360) return 30;
  if (limitMinutes <= 420) return 20;
  return 10;
}

// 리그 승급 보너스 공식은 여기 두지 않는다(GROMO-1193) — 리그 결과는 서버가 실제 지급액
// (promotionBonusCoins)을 응답에 실어 보내므로 클라가 다시 계산할 이유가 없고, 계산해 두면
// 서버가 진짜 0을 준 경우(지급 실패)에 금액을 지어내는 폴백으로 다시 쓰이기 쉽다.
