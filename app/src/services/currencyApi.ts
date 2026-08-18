// currency 도메인 API 래퍼 (InGameCurrencyController, base /api/v1).
// 모든 호출은 axios 인스턴스 api(JWT 자동 주입, 401 refresh) 경유. axios는 non-2xx 시 throw.
// 잔액(GET /currency)은 CoinContext가 직접 조회하므로 여기서는 거래 내역만 다룬다.
import { api } from '@/services/api';
import type { CurrencyTransaction } from '@/types/dto/currency';

// GET /api/v1/currency/transactions — 유저의 거래 내역(서버가 createdAt 내림차순으로 정렬).
export async function getCurrencyTransactions(): Promise<CurrencyTransaction[]> {
  const { data } = await api.get<CurrencyTransaction[]>('/api/v1/currency/transactions');
  return data;
}
