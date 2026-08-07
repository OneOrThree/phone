// userApi.getUserStats date 축 계약 테스트(GROMO-1236) — 타 유저 통계의 '오늘'·최근 7일 기준일도
// 서버 KST 버킷 축이다. 러너 TZ가 KST라 값으론 축이 안 갈리므로 로컬 todayStr를 독극물로
// 목킹한다(statsApi.test와 동일 패턴).
import { getUserStats } from './userApi';
import { api } from '@/services/api';
import { todayStrKst } from '@/utils/localDate';

jest.mock('@/services/api', () => ({
  api: { get: jest.fn() },
}));

jest.mock('@/utils/localDate', () => ({
  ...jest.requireActual('@/utils/localDate'),
  todayStr: jest.fn(() => '2000-01-02'), // 독극물 — 이 값이 요청에 실리면 축 위반
}));

const mockGet = (api as unknown as { get: jest.Mock }).get;

beforeEach(() => {
  jest.clearAllMocks();
  mockGet.mockResolvedValue({ data: {} });
});

describe('date 기본값 = KST 오늘 (GROMO-1236)', () => {
  test('GET /api/v1/users/{userId}/stats', async () => {
    await getUserStats('u1');
    const kst = todayStrKst();
    expect(kst).not.toBe('2000-01-02');
    expect(mockGet).toHaveBeenCalledWith('/api/v1/users/u1/stats', { params: { date: kst } });
  });

  test('date를 명시하면 그대로 나간다', async () => {
    await getUserStats('u1', '2026-08-01');
    expect(mockGet).toHaveBeenCalledWith('/api/v1/users/u1/stats', {
      params: { date: '2026-08-01' },
    });
  });
});
