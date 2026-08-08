// 라이브 마커 취소 재시도 대기열 테스트(GROMO-1214 코드리뷰).
//
// 잠그는 것: 취소가 실패해도 id가 **화면 밖에서 살아남아** 다음 실행·포그라운드 복귀에 다시
// 시도된다. 종전엔 실패한 id를 화면 ref에만 담았고, finish()는 업로드를 시작하자마자 화면을
// 떠나므로 언마운트 직후엔 재시도가 영영 안 돌았다 — 일시적 실패 하나로 친구 화면에 12시간
// (서버 고아 스윕)동안 '집중 중'으로 남았다.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { cancelFocusSession } from '@/services/focusApi';
import { cancelMarker, flushPendingMarkerCancels } from './pendingMarkerCancels';
import { STORAGE_KEYS } from '@/types/storage';

jest.mock('@/services/focusApi', () => ({ cancelFocusSession: jest.fn() }));

const mockCancel = cancelFocusSession as jest.MockedFunction<typeof cancelFocusSession>;

function axiosError(status?: number): Error {
  const e = new Error('요청 실패') as Error & {
    isAxiosError: boolean;
    response?: { status: number };
  };
  e.isAxiosError = true;
  if (status != null) e.response = { status };
  return e;
}

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
});

test('취소 성공이면 대기열에 아무것도 남기지 않는다', async () => {
  mockCancel.mockResolvedValue(undefined);

  await cancelMarker('marker-1');

  expect(mockCancel).toHaveBeenCalledWith({ sessionId: 'marker-1' });
  expect(await AsyncStorage.getItem(STORAGE_KEYS.focusPendingCancels)).toBeNull();
});

// 이 테스트가 이 항목의 핵심 — '화면 밖 재시도'.
test('취소 실패는 AsyncStorage에 남아 다음 실행(flush)에서 재시도돼 닫힌다', async () => {
  mockCancel.mockRejectedValue(axiosError()); // 네트워크 실패
  await cancelMarker('marker-1');

  // 화면(세션)은 이미 떠났다 — 남은 근거는 스토리지뿐이어야 한다
  expect(
    JSON.parse((await AsyncStorage.getItem(STORAGE_KEYS.focusPendingCancels)) ?? '[]'),
  ).toEqual(['marker-1']);

  // 다음 실행/포그라운드 복귀 — 연결이 돌아와 취소가 성사된다
  mockCancel.mockReset();
  mockCancel.mockResolvedValue(undefined);
  await flushPendingMarkerCancels();

  expect(mockCancel).toHaveBeenCalledWith({ sessionId: 'marker-1' });
  expect(await AsyncStorage.getItem(STORAGE_KEYS.focusPendingCancels)).toBeNull();

  // 두 번째 flush — 보낼 게 없어야 한다(무한 재시도 방지)
  mockCancel.mockClear();
  await flushPendingMarkerCancels();
  expect(mockCancel).not.toHaveBeenCalled();
});

test('flush가 또 실패하면 큐에 남아 다음 기회를 기다린다', async () => {
  mockCancel.mockRejectedValue(axiosError(503)); // 서버 오류 = 재시도 대상
  await cancelMarker('marker-1');
  await flushPendingMarkerCancels();

  expect(
    JSON.parse((await AsyncStorage.getItem(STORAGE_KEYS.focusPendingCancels)) ?? '[]'),
  ).toEqual(['marker-1']);
});

test('409(이미 종료/취소)는 목적이 이미 달성돼 큐에 쌓지 않는다', async () => {
  mockCancel.mockRejectedValue(axiosError(409));

  await cancelMarker('marker-1');

  expect(await AsyncStorage.getItem(STORAGE_KEYS.focusPendingCancels)).toBeNull();
});

test('같은 마커를 여러 번 실패해도 큐에는 1건만 쌓인다', async () => {
  mockCancel.mockRejectedValue(axiosError());

  await cancelMarker('marker-1');
  await cancelMarker('marker-1');

  expect(
    JSON.parse((await AsyncStorage.getItem(STORAGE_KEYS.focusPendingCancels)) ?? '[]'),
  ).toEqual(['marker-1']);
});
