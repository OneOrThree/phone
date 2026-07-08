// 서버 currency 도메인 DTO 미러 (com.oneorthree.phone.currency.dto).
// 값 단위·의미는 백엔드 기준. 시각(Instant)은 ISO 문자열.
// ⚠️ 백엔드 DTO가 바뀌면 이 파일도 함께 갱신한다.

// 재화 적립/사용 사유 (Java enum CurrencyReason).
export type CurrencyReason = 'SESSION_COMPLETE' | 'STREAK_BONUS' | 'PURCHASE';

// 거래 방향 (Java enum TransactionType).
export type TransactionType = 'EARN' | 'SPEND';

// POST /currency/earn, /currency/spend 요청 바디.
export interface CurrencyRequest {
  amount: number;
  reason: CurrencyReason;
}

// GET /currency/transactions — 단일 거래 내역 항목.
export interface TransactionsResponse {
  amount: number;
  type: TransactionType;
  reason: CurrencyReason;
  transactedAt: string; // Instant, ISO 문자열
}
