// 라이브 마커 취소 재시도 대기열 테스트(GROMO-1214 코드리뷰).
//
// 잠그는 것: 취소가 실패해도 id가 **화면 밖에서 살아남아** 다음 실행·포그라운드 복귀에 다시
// 시도된다. 종전엔 실패한 id를 화면 ref에만 담았고, finish()는 업로드를 시작하자마자 화면을
// 떠나므로 언마운트 직후엔 재시도가 영영 안 돌았다 — 일시적 실패 하나로 친구 화면에 12시간
// (서버 고아 스윕)동안 '집중 중'으로 남았다.
//
// 2차 리뷰 ④: 큐가 **계정 스코프**를 갖는다. 계정 A로 쌓인 취소가 B 로그인 중 403을 받고
// 영구 제거되던 걸 막는다 — A의 마커는 A가 돌아올 때까지 큐에 보존돼야 한다.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { cancelFocusSession } from '@/services/focusApi';
import { cancelMarker, flushPendingMarkerCancels } from './pendingMarkerCancels';
import { STORAGE_KEYS } from '@/types/storage';

jest.mock('@/services/focusApi', () => ({ cancelFocusSession: jest.fn() }));

const mockCancel = cancelFocusSession as jest.MockedFunction<typeof cancelFocusSession>;

const USER_A = 'user-a';
const USER_B = 'user-b';

function axiosError(status?: number): Error {
  const e = new Error('요청 실패') as Error & {
    isAxiosError: boolean;
    response?: { status: number };
  };
  e.isAxiosError = true;
  if (status != null) e.response = { status };
  return e;
}

async function queue(): Promise<unknown> {
  return JSON.parse((await AsyncStorage.getItem(STORAGE_KEYS.focusPendingCancels)) ?? '[]');
}

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
});

test('취소 성공이면 대기열에 아무것도 남기지 않는다', async () => {
  mockCancel.mockResolvedValue(undefined);

  await cancelMarker('marker-1', USER_A);

  expect(mockCancel).toHaveBeenCalledWith({ sessionId: 'marker-1' });
  expect(await AsyncStorage.getItem(STORAGE_KEYS.focusPendingCancels)).toBeNull();
});

// 이 테스트가 이 항목의 핵심 — '화면 밖 재시도'.
test('취소 실패는 AsyncStorage에 남아 다음 실행(flush)에서 재시도돼 닫힌다', async () => {
  mockCancel.mockRejectedValue(axiosError()); // 네트워크 실패
  await cancelMarker('marker-1', USER_A);

  // 화면(세션)은 이미 떠났다 — 남은 근거는 스토리지뿐이어야 한다(소유 계정 포함)
  expect(await queue()).toEqual([{ userId: USER_A, sessionId: 'marker-1' }]);

  // 다음 실행/포그라운드 복귀 — 연결이 돌아와 취소가 성사된다
  mockCancel.mockReset();
  mockCancel.mockResolvedValue(undefined);
  await flushPendingMarkerCancels(USER_A);

  expect(mockCancel).toHaveBeenCalledWith({ sessionId: 'marker-1' });
  expect(await AsyncStorage.getItem(STORAGE_KEYS.focusPendingCancels)).toBeNull();

  // 두 번째 flush — 보낼 게 없어야 한다(무한 재시도 방지)
  mockCancel.mockClear();
  await flushPendingMarkerCancels(USER_A);
  expect(mockCancel).not.toHaveBeenCalled();
});

test('flush가 또 실패하면 큐에 남아 다음 기회를 기다린다', async () => {
  mockCancel.mockRejectedValue(axiosError(503)); // 서버 오류 = 재시도 대상
  await cancelMarker('marker-1', USER_A);
  await flushPendingMarkerCancels(USER_A);

  expect(await queue()).toEqual([{ userId: USER_A, sessionId: 'marker-1' }]);
});

test('409(이미 종료/취소)는 목적이 이미 달성돼 큐에 쌓지 않는다', async () => {
  mockCancel.mockRejectedValue(axiosError(409));

  await cancelMarker('marker-1', USER_A);

  expect(await AsyncStorage.getItem(STORAGE_KEYS.focusPendingCancels)).toBeNull();
});

test('같은 마커를 여러 번 실패해도 큐에는 1건만 쌓인다', async () => {
  mockCancel.mockRejectedValue(axiosError());

  await cancelMarker('marker-1', USER_A);
  await cancelMarker('marker-1', USER_A);

  expect(await queue()).toEqual([{ userId: USER_A, sessionId: 'marker-1' }]);
});

// ── 계정 스코프(코드리뷰 2차 ④) ───────────────────────────────────────────

// 종전엔 계정 무관하게 보내고 403을 종결로 봐서 큐에서 지웠다 — A의 마커가 A가 다시
// 로그인해도 되살아나지 못하고 12h 서버 스윕까지 '집중 중'으로 남았다.
test('다른 계정으로 전환되면 재시도하지 않고 큐에 보존한다', async () => {
  mockCancel.mockRejectedValue(axiosError());
  await cancelMarker('marker-a', USER_A);

  // 계정 B로 전환된 뒤의 flush — 요청 자체가 나가면 안 된다
  mockCancel.mockClear();
  await flushPendingMarkerCancels(USER_B);
  expect(mockCancel).not.toHaveBeenCalled();
  expect(await queue()).toEqual([{ userId: USER_A, sessionId: 'marker-a' }]);

  // A로 다시 로그인하면 그제서야 닫힌다
  mockCancel.mockResolvedValue(undefined);
  await flushPendingMarkerCancels(USER_A);
  expect(mockCancel).toHaveBeenCalledWith({ sessionId: 'marker-a' });
  expect(await AsyncStorage.getItem(STORAGE_KEYS.focusPendingCancels)).toBeNull();
});

test('flush는 내 항목만 보내고 남의 항목은 큐에 그대로 둔다', async () => {
  mockCancel.mockRejectedValue(axiosError());
  await cancelMarker('marker-a', USER_A);
  await cancelMarker('marker-b', USER_B);

  mockCancel.mockReset();
  mockCancel.mockResolvedValue(undefined);
  await flushPendingMarkerCancels(USER_B);

  expect(mockCancel).toHaveBeenCalledTimes(1);
  expect(mockCancel).toHaveBeenCalledWith({ sessionId: 'marker-b' });
  expect(await queue()).toEqual([{ userId: USER_A, sessionId: 'marker-a' }]);
});

test('403은 종결이 아니다 — 큐에 남겨 다음 기회를 기다린다', async () => {
  mockCancel.mockRejectedValue(axiosError(403));

  await cancelMarker('marker-1', USER_A);

  expect(await queue()).toEqual([{ userId: USER_A, sessionId: 'marker-1' }]);
});

test('게스트(userId=null)가 쌓은 취소는 로그인 계정에서 재시도하지 않는다', async () => {
  mockCancel.mockRejectedValue(axiosError());
  await cancelMarker('marker-guest', null);

  mockCancel.mockClear();
  await flushPendingMarkerCancels(USER_A);

  expect(mockCancel).not.toHaveBeenCalled();
  expect(await queue()).toEqual([{ userId: null, sessionId: 'marker-guest' }]);
});
