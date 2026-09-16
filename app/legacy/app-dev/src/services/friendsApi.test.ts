// friendsApi date 축 계약 테스트(GROMO-1236) — '오늘 집중분'(focusTimeMinutes)의 기준일은
// 서버 KST 버킷 축이다. 러너 TZ가 KST라 값으론 축이 안 갈리므로 로컬 todayStr를 독극물로
// 목킹해 로컬 축 호출을 즉시 드러낸다(statsApi.test와 동일 패턴).
import { fetchFriends, fetchPinnedFriends } from './friendsApi';
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
  test('GET /api/v1/friends — 오늘 집중분 기준일은 KST', async () => {
    await fetchFriends();
    const kst = todayStrKst();
    expect(kst).not.toBe('2000-01-02');
    expect(mockGet).toHaveBeenCalledWith('/api/v1/friends', { params: { date: kst } });
  });

  test('GET /api/v1/pins — 핀 목록도 같은 축', async () => {
    await fetchPinnedFriends();
    const kst = todayStrKst();
    expect(kst).not.toBe('2000-01-02');
    expect(mockGet).toHaveBeenCalledWith('/api/v1/pins', { params: { date: kst } });
  });
});
