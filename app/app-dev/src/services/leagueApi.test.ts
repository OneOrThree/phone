// leagueApi date 축 계약 테스트(GROMO-1236) — 리그 주 경계는 이미 KST(useLeagueRanking)인데
// 라이브 '당일 집중분' 기준일만 로컬이던 내부 모순을 KST로 통일했다. 러너 TZ가 KST라 값으론
// 축이 안 갈리므로 로컬 todayStr를 독극물로 목킹한다(statsApi.test와 동일 패턴).
import { getMyRanking } from './leagueApi';
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
  mockGet.mockResolvedValue({ data: [] });
});

describe('date = KST 오늘 (GROMO-1236)', () => {
  test('GET /api/v1/league/me/ranking — 당일 집중분 기준일은 KST', async () => {
    await getMyRanking();
    const kst = todayStrKst();
    expect(kst).not.toBe('2000-01-02');
    expect(mockGet).toHaveBeenCalledWith('/api/v1/league/me/ranking', {
      params: { date: kst },
    });
  });

  test('category를 줘도 date 축은 동일', async () => {
    await getMyRanking('LABOR_ATTORNEY');
    expect(mockGet).toHaveBeenCalledWith('/api/v1/league/me/ranking', {
      params: { category: 'LABOR_ATTORNEY', date: todayStrKst() },
    });
  });

  test('공유 그룹 adapter가 고정한 KST date를 그대로 쓰고 category는 생략한다', async () => {
    await getMyRanking(undefined, '2026-08-10');
    expect(mockGet).toHaveBeenCalledWith('/api/v1/league/me/ranking', {
      params: { date: '2026-08-10' },
    });
  });
});
