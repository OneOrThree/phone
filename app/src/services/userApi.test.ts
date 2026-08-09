// userApi.getUserStats date 축 계약 테스트(GROMO-1236) — 타 유저 통계의 '오늘'·최근 7일 기준일도
// 서버 KST 버킷 축이다. 러너 TZ가 KST라 값으론 축이 안 갈리므로 로컬 todayStr를 독극물로
// 목킹한다(statsApi.test와 동일 패턴).
import { getUserStats, updateProfile } from './userApi';
import { api } from '@/services/api';
import { todayStrKst } from '@/utils/localDate';
import { getServerZone, resetServerZone } from '@/utils/serverZone';

jest.mock('@/services/api', () => ({
  api: { get: jest.fn(), patch: jest.fn() },
}));

jest.mock('@/utils/localDate', () => ({
  ...jest.requireActual('@/utils/localDate'),
  todayStr: jest.fn(() => '2000-01-02'), // 독극물 — 이 값이 요청에 실리면 축 위반
}));

const mockGet = (api as unknown as { get: jest.Mock }).get;
const mockPatch = (api as unknown as { patch: jest.Mock }).patch;

beforeEach(() => {
  jest.clearAllMocks();
  mockGet.mockResolvedValue({ data: {} });
  mockPatch.mockResolvedValue({ data: undefined });
  resetServerZone();
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

// GROMO-1252 6차 ② — countryCode 백필(App.tsx)·프로필 저장(ProfileEditScreen)이 서버 존을 바꾸는데
// 캐시가 그대로면 재시작 전까지 옛 존(Asia/Seoul) 날짜 키로 업로드된다.
describe('countryCode 변경 시 서버 존 재협상', () => {
  test('PATCH 성공 후 프로필을 다시 읽어 서버가 준 존으로 교체한다', async () => {
    mockGet.mockResolvedValue({ data: { countryCode: 'GB', timeZone: 'Europe/London' } });

    await updateProfile({ countryCode: 'GB' });

    expect(mockPatch).toHaveBeenCalledWith('/api/v1/users/me', { countryCode: 'GB' });
    expect(mockGet).toHaveBeenCalledWith('/api/v1/users/me');
    expect(getServerZone()).toBe('Europe/London'); // 클라 매핑이 아니라 서버가 내려준 문자열
  });

  test('countryCode가 없는 수정(닉네임만)은 재조회하지 않는다', async () => {
    await updateProfile({ nickname: '오스카' });

    expect(mockGet).not.toHaveBeenCalled();
    expect(getServerZone()).toBe('Asia/Seoul');
  });

  test('재조회 실패는 삼키고 직전 존을 유지한다(저장 자체는 성공)', async () => {
    mockGet.mockRejectedValue(new Error('offline'));

    await expect(updateProfile({ countryCode: 'GB' })).resolves.toBeUndefined();
    expect(getServerZone()).toBe('Asia/Seoul');
  });
});
