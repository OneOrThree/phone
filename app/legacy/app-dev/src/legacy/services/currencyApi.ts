// currency 도메인 API 래퍼 (InGameCurrencyController, base /api/v1).
// 모든 호출은 axios 인스턴스 api(JWT 자동 주입, 401 refresh) 경유. axios는 non-2xx 시 throw.
import { api } from '@/services/api';
import type { CurrencyRequest, TransactionsResponse } from '@/legacy/types/currency';

// GET /api/v1/currency — 유저의 현재 인게임 잔액 조회.
export async function getBalance(): Promise<number> {
  const { data } = await api.get<number>('/api/v1/currency');
  return data;
}

// GET /api/v1/currency/transactions — 유저의 거래 내역 조회.
export async function getTransactions(): Promise<TransactionsResponse[]> {
  const { data } = await api.get<TransactionsResponse[]>('/api/v1/currency/transactions');
  return data;
}

// POST /api/v1/currency/earn — 인게임 재화 적립(증가).
export async function earnCurrency(body: CurrencyRequest): Promise<void> {
  await api.post('/api/v1/currency/earn', body);
}

// POST /api/v1/currency/spend — 인게임 재화 사용(감소).
export async function spendCurrency(body: CurrencyRequest): Promise<void> {
  await api.post('/api/v1/currency/spend', body);
}
