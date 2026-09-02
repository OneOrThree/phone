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
