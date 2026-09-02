// occupationSync 유닛 테스트(GROMO-1624) — 준비 시험의 정본이 서버 하나임을 잠근다.
// 잠그는 규칙:
//   ① 변경은 PATCH 성공이 곧 반영이다(실패는 false — 호출부가 화면을 안 바꾼다)
//   ② 구 한글 키는 복구에서 '읽기만' 한다 — 앱이 다시 쓰지 않는다
//   ③ 복구는 서버가 NULL일 때만 — 서버에 값이 있으면 폰의 옛 값으로 덮지 않는다
//   ④ 복구는 GROMO-1620 이전 서버 표시명도 알아본다(온보딩이 저장했던 문자열)
import AsyncStorage from '@react-native-async-storage/async-storage';
import { STORAGE_KEYS } from '@/types/storage';
import { updateOccupation } from '@/services/userApi';
import { logOccupationSyncFailed } from '@/services/analyticsEvents';
import { recoverOccupation, syncOccupation } from './occupationSync';

jest.mock('@/services/userApi', () => ({ updateOccupation: jest.fn() }));
jest.mock('@/services/analyticsEvents', () => ({ logOccupationSyncFailed: jest.fn() }));

const mockPatch = updateOccupation as jest.Mock;
const mockLogFailed = logOccupationSyncFailed as jest.Mock;

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
  mockPatch.mockResolvedValue(undefined);
});

describe('syncOccupation', () => {
  test('PATCH 성공 → true', async () => {
    expect(await syncOccupation('CSAT', 'settings')).toBe(true);
    expect(mockPatch).toHaveBeenCalledWith({ occupation: 'CSAT' });
  });

  test('성공 시 캐시된 프로필 스냅샷(gromo:user)의 occupation도 갱신한다', async () => {
    // 오프라인 콜드스타트가 이 스냅샷으로 세션을 복원한다 — 안 갱신하면 그 세션 내내
    // 리그·비교 통계가 이전 시험으로 돈다(PR 713 코덱스 리뷰).
    await AsyncStorage.setItem(
      STORAGE_KEYS.user,
      JSON.stringify({ nickname: '수빈', occupation: 'CODING' }),
    );

    await syncOccupation('CSAT', 'settings');

    const cached = JSON.parse((await AsyncStorage.getItem(STORAGE_KEYS.user)) ?? '{}');
    expect(cached).toEqual({ nickname: '수빈', occupation: 'CSAT' });
  });

  test('실패 시엔 스냅샷을 건드리지 않는다', async () => {
    await AsyncStorage.setItem(STORAGE_KEYS.user, JSON.stringify({ occupation: 'CODING' }));
    mockPatch.mockRejectedValue(new Error('offline'));

    await syncOccupation('CSAT', 'settings');

    const cached = JSON.parse((await AsyncStorage.getItem(STORAGE_KEYS.user)) ?? '{}');
    expect(cached.occupation).toBe('CODING');
  });

  test('PATCH 실패 → false (호출부가 화면을 안 바꾼다) + 실패를 계측에 남긴다', async () => {
    mockPatch.mockRejectedValue(new Error('offline'));

    expect(await syncOccupation('CSAT', 'settings')).toBe(false);
    // 조용히 삼키면 1620처럼 아무도 모른다 — 실패는 반드시 발행된다
    expect(mockLogFailed).toHaveBeenCalledWith({ request_source: 'settings' });
  });

  test('구 한글 키를 다시 쓰지 않는다 — 복구에서 읽기만 하는 과거 기록이다', async () => {
    await AsyncStorage.setItem(STORAGE_KEYS.focusCategory, '코딩');

    await syncOccupation('CSAT', 'settings');

    expect(await AsyncStorage.getItem(STORAGE_KEYS.focusCategory)).toBe('코딩');
  });
});

describe('recoverOccupation — 서버 NULL 피해 유저 복구', () => {
  test('서버에 값이 있으면 아무것도 하지 않는다(서버가 정본)', async () => {
    await AsyncStorage.setItem(STORAGE_KEYS.focusCategory, '코딩');

    expect(await recoverOccupation({ occupation: 'CSAT' })).toBeNull();
    expect(mockPatch).not.toHaveBeenCalled();
  });

  test('서버 NULL + 폰에 옛 값 → PATCH하고 복구한 code를 돌려준다', async () => {
    await AsyncStorage.setItem(STORAGE_KEYS.focusCategory, '수능·N수');

    expect(await recoverOccupation({ occupation: null })).toBe('CSAT');
    expect(mockPatch).toHaveBeenCalledWith({ occupation: 'CSAT' });
  });

  test('GROMO-1620 이전 서버 표시명(온보딩 저장분)도 알아본다', async () => {
    await AsyncStorage.setItem(STORAGE_KEYS.focusCategory, '토익/토플');

    expect(await recoverOccupation({ occupation: null })).toBe('ENGLISH_TEST');
  });

  test('구 키에 code가 직접 들어 있어도 복구한다 — 표기 변형 안전망', async () => {
    await AsyncStorage.setItem(STORAGE_KEYS.focusCategory, 'CSAT');

    expect(await recoverOccupation({ occupation: null })).toBe('CSAT');
    expect(mockPatch).toHaveBeenCalledWith({ occupation: 'CSAT' });
  });

  test('알 수 없는 한글이면 아무것도 보내지 않는다', async () => {
    await AsyncStorage.setItem(STORAGE_KEYS.focusCategory, '알수없는시험');

    expect(await recoverOccupation({ occupation: null })).toBeNull();
    expect(mockPatch).not.toHaveBeenCalled();
  });

  test('PATCH가 실패하면 null — 서버가 NULL로 남아 다음 실행이 재시도한다', async () => {
    await AsyncStorage.setItem(STORAGE_KEYS.focusCategory, '수능·N수');
    mockPatch.mockRejectedValue(new Error('offline'));

    expect(await recoverOccupation({ occupation: null })).toBeNull();
    expect(mockLogFailed).toHaveBeenCalledWith({ request_source: 'recovery' });
  });
});
