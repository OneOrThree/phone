// 서버 currency 도메인 DTO 미러 (com.oneorthree.phone.currency.dto).
// ⚠️ 백엔드 DTO가 바뀌면 이 파일도 함께 갱신한다.

// 서버 CurrencyTransactionType(enum name 문자열) 미러.
// ⚠️ 서버는 amount를 **항상 양수(절대값)**로 기입하고, 적립/사용 방향은 이 type이 표현한다
//    (CurrencyLedgerService: "amount 는 항상 양수(절대값)로 기입한다"). 따라서 화면의 부호(+/−)는
//    금액이 아니라 type으로 유도한다 — PURCHASE·BET_STAKE = 사용(−), 그 외 = 적립(+).
// `(string & {})` — 서버 enum 확장(미지의 값) 도착 시에도 타입을 깨지 않으면서, 알려진 값의
//    자동완성은 유지하는 관용 표현. leagueApi의 result: string 확장 대비 관행과 같은 취지.
export type CurrencyTransactionType =
  | 'SESSION_COMPLETE' // 집중 세션 완료 적립
  | 'STREAK_BONUS' // 연속 공부 보너스
  | 'PURCHASE' // 상점 구매(사용)
  | 'BET_STAKE' // 그룹 내기 판돈 차감(에스크로, 사용)
  | 'BET_PAYOUT' // 내기 정산 승자 분배(적립)
  | 'BET_REFUND' // 달성자 0명 내기 전원 환불(적립)
  | 'FOCUS_GOAL' // 집중 목표 달성 보너스(서버 지급, GROMO-1039)
  | 'SCREEN_TIME_GOAL' // 스크린타임 목표 달성 보너스(서버 지급)
  | 'LEAGUE_TIER_BONUS' // 리그 승급 보너스(주간 배치 지급)
  | (string & {});

// GET /api/v1/currency/transactions 항목 — 거래 단건(최신순 정렬).
export interface CurrencyTransaction {
  amount: number; // 항상 양수(절대값) — 방향은 type이 표현
  type: CurrencyTransactionType;
  createdAt: string; // Instant, ISO 문자열
}
