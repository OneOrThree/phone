// uploadFocusBlock 유닛 테스트(GROMO-1214) — 세션 종료를 'cancel + POST'에서
// 'PATCH /focus-session(마커 종료)'로 옮기면서 생긴 돈 경로의 분기를 잠근다.
//
// 여기서 잠그는 것:
//  1) 마커 id가 있으면 PATCH로 종료한다 — 마커를 취소로 버리지 않는다(취소 위임 미호출).
//     버리면 '서버 발급 마커를 거쳐야만 지급'이라는 이 티켓의 목적 자체가 사라진다.
//  2) 마커가 없으면(오프라인 시작 등) 종전 POST 경로 그대로 — 시간이 통째로 유실되면 안 된다.
//  3) PATCH가 409(이미 종료/자동마감)면 **POST로 폴백하지 않는다**. 409에는 '이중 PATCH(이미
//     지급됨)'와 '12h 자동마감'이 구분 불가로 섞여 있어, 폴백하면 전자에서 코인·통계가 두 번
//     들어간다. 후자의 시간 손실은 서버가 이미 정책으로 확정한 것이라 이중 지급보다 낫다.
//  4) 오프라인이면 대기열에 **POST 바디만** 들어가고, 재전송이 이중 계상을 만들지 않는다.
//     (대기열에 PATCH를 넣으면 재전송 시점의 endedAt이 서버 클램프 창 밖이라 now로 올라가
//      구간이 부풀려진다 — 그래서 큐는 POST 전용이다.)
import AsyncStorage from '@react-native-async-storage/async-storage';
import { saveFocusSession, endFocusSession } from '@/services/focusApi';
import { uploadFocusBlock } from './uploadFocusBlock';
import { flushPendingFocusUploads } from './pendingFocusUploads';
import { STORAGE_KEYS } from '@/types/storage';
import type { FocusSessionRequest } from '@/types/dto/focus';

jest.mock('@/services/focusApi', () => ({
  saveFocusSession: jest.fn(),
  endFocusSession: jest.fn(),
}));

const mockSave = saveFocusSession as jest.MockedFunction<typeof saveFocusSession>;
const mockEnd = endFocusSession as jest.MockedFunction<typeof endFocusSession>;

const USER = 'u1';
const NOW = new Date('2026-07-15T22:00:00+09:00');

// axios 에러 모양만 흉내 — axios.isAxiosError는 isAxiosError===true 만 본다.
function axiosError(status?: number): Error {
  const e = new Error('요청 실패') as Error & {
    isAxiosError: boolean;
    response?: { status: number };
  };
  e.isAxiosError = true;
  if (status != null) e.response = { status };
  return e;
}

// 방금 끝난 블록(= PATCH 대상). endedAt이 '지금'이면 서버 클램프 창 안이다.
function body(endedAt: string = NOW.toISOString()): FocusSessionRequest {
  return {
    focusTagId: 'tag-1',
    subject: '수학',
    startedAt: new Date(NOW.getTime() - 25 * 60 * 1000).toISOString(),
    endedAt,
    distractionCount: 0,
    totalDistractionSeconds: 0,
    focusType: 'POMODORO',
  };
}

const saveRes = { dayTotalFocusSeconds: 1500, streakQualifiedToday: true, awardedCoins: 25 };
// PATCH 200 확정 계약 — 전 필드 non-null, 뒤 3개는 POST 응답과 필드명·타입·의미가 동일.
const endRes = {
  sessionId: 'marker-1',
  startedAt: body().startedAt,
  endedAt: body().endedAt,
  durationSeconds: 1500,
  totalDistractionSeconds: 0,
  ...saveRes,
  goalRewardCoins: 0,
  balanceAfter: 125,
};

beforeEach(async () => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
  await AsyncStorage.clear();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('마커가 있으면 PATCH', () => {
  test('마커 id가 있으면 PATCH로 종료하고 POST·마커 취소는 하지 않는다', async () => {
    mockEnd.mockResolvedValue(endRes);
    const onMarkerStillOpen = jest.fn();

    const result = await uploadFocusBlock({
      sessionId: 'marker-1',
      body: body(),
      userId: USER,
      onMarkerStillOpen,
    });

    expect(mockEnd).toHaveBeenCalledTimes(1);
    expect(mockEnd).toHaveBeenCalledWith(
      {
        sessionId: 'marker-1',
        endedAt: body().endedAt,
        totalDistractionSeconds: 0,
        focusTagId: 'tag-1',
      },
      USER,
    );
    expect(mockSave).not.toHaveBeenCalled();
    expect(onMarkerStillOpen).not.toHaveBeenCalled();
    expect(result).toEqual({ status: 'saved', response: endRes });
  });

  test('PATCH 응답은 POST 응답과 같은 판정 필드를 실어 그대로 소비된다', async () => {
    mockEnd.mockResolvedValue(endRes);
    const result = await uploadFocusBlock({ sessionId: 'marker-1', body: body(), userId: USER });
    expect(result.status).toBe('saved');
    if (result.status !== 'saved') return;
    expect(result.response.dayTotalFocusSeconds).toBe(1500);
    expect(result.response.streakQualifiedToday).toBe(true);
    expect(result.response.awardedCoins).toBe(25);
  });
});

describe('마커가 없으면 종전 POST', () => {
  test('마커 id가 null이면 PATCH 없이 POST로 저장한다', async () => {
    mockSave.mockResolvedValue(saveRes);

    const result = await uploadFocusBlock({ sessionId: null, body: body(), userId: USER });

    expect(mockEnd).not.toHaveBeenCalled();
    expect(mockSave).toHaveBeenCalledTimes(1);
    expect(mockSave).toHaveBeenCalledWith(body(), USER);
    expect(result).toEqual({ status: 'saved', response: saveRes });
  });

  test('endedAt이 서버 클램프 창 밖(리플레이·고아 정산)이면 PATCH를 태우지 않고 마커를 취소한다', async () => {
    mockSave.mockResolvedValue(saveRes);
    const onMarkerStillOpen = jest.fn();
    const stale = new Date(NOW.getTime() - 30 * 60 * 1000).toISOString(); // 30분 전 경계

    const result = await uploadFocusBlock({
      sessionId: 'marker-1',
      body: body(stale),
      userId: USER,
      onMarkerStillOpen,
    });

    expect(mockEnd).not.toHaveBeenCalled();
    expect(mockSave).toHaveBeenCalledTimes(1);
    expect(onMarkerStillOpen).toHaveBeenCalledWith('marker-1');
    expect(result.status).toBe('saved');
  });
});

describe('PATCH 실패 폴백', () => {
  // 이 테스트가 잠그는 게 이 티켓에서 제일 중요하다 — 409에 POST 폴백을 (도로) 붙이면
  // 이중 PATCH 케이스에서 세션 행이 새로 생겨 코인·통계가 두 번 들어간다.
  test('409(이미 종료·자동마감)면 POST를 부르지 않고 성공으로 끝낸다', async () => {
    mockEnd.mockRejectedValue(axiosError(409));
    mockSave.mockResolvedValue(saveRes);
    const onMarkerStillOpen = jest.fn();

    const result = await uploadFocusBlock({
      sessionId: 'marker-1',
      body: body(),
      userId: USER,
      onMarkerStillOpen,
    });

    expect(mockEnd).toHaveBeenCalledTimes(1);
    expect(mockSave).not.toHaveBeenCalled(); // ← 폴백 금지
    expect(onMarkerStillOpen).not.toHaveBeenCalled(); // 이미 닫힌 마커
    expect(result).toEqual({ status: 'alreadyEnded' });
  });

  test('409는 대기열에도 남기지 않는다 — 재시도할 게 없다', async () => {
    mockEnd.mockRejectedValue(axiosError(409));

    await uploadFocusBlock({ sessionId: 'marker-1', body: body(), userId: USER });

    expect(await AsyncStorage.getItem(STORAGE_KEYS.focusPendingUploads)).toBeNull();
  });

  test('404(마커 소실)는 POST로 폴백한다', async () => {
    mockEnd.mockRejectedValue(axiosError(404));
    mockSave.mockResolvedValue(saveRes);

    const result = await uploadFocusBlock({ sessionId: 'marker-1', body: body(), userId: USER });

    expect(mockSave).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ status: 'saved', response: saveRes });
  });

  test('네트워크 실패면 마커가 열린 채일 수 있어 취소를 위임하고 POST로 폴백한다', async () => {
    mockEnd.mockRejectedValue(axiosError()); // response 없음 = 네트워크 실패
    mockSave.mockResolvedValue(saveRes);
    const onMarkerStillOpen = jest.fn();

    await uploadFocusBlock({
      sessionId: 'marker-1',
      body: body(),
      userId: USER,
      onMarkerStillOpen,
    });

    expect(onMarkerStillOpen).toHaveBeenCalledWith('marker-1');
    expect(mockSave).toHaveBeenCalledTimes(1);
  });
});

describe('오프라인 — 대기열 인계와 재전송', () => {
  test('PATCH·POST가 다 실패하면 대기열에 POST 바디 1건만 쌓인다(PATCH 항목 없음)', async () => {
    mockEnd.mockRejectedValue(axiosError());
    mockSave.mockRejectedValue(axiosError());

    const result = await uploadFocusBlock({
      sessionId: 'marker-1',
      body: body(),
      userId: USER,
      onMarkerStillOpen: jest.fn(),
    });

    expect(result).toEqual({ status: 'queued' });
    const raw = await AsyncStorage.getItem(STORAGE_KEYS.focusPendingUploads);
    expect(JSON.parse(raw ?? '[]')).toEqual([{ userId: USER, body: body() }]);
  });

  test('재전송은 POST 1회만 나가고 큐가 비워져 다음 flush가 이중 계상하지 않는다', async () => {
    mockEnd.mockRejectedValue(axiosError());
    mockSave.mockRejectedValue(axiosError());
    await uploadFocusBlock({ sessionId: 'marker-1', body: body(), userId: USER });

    // 네트워크 복구 — 대기열 재전송
    mockSave.mockReset();
    mockSave.mockResolvedValue(saveRes);
    await expect(flushPendingFocusUploads(USER)).resolves.toBe(true);

    expect(mockEnd).not.toHaveBeenCalledTimes(2); // 큐는 PATCH를 재시도하지 않는다
    expect(mockSave).toHaveBeenCalledTimes(1);
    expect(mockSave).toHaveBeenCalledWith(body(), USER);
    expect(await AsyncStorage.getItem(STORAGE_KEYS.focusPendingUploads)).toBeNull();

    // 두 번째 flush — 보낼 게 없어야 한다(재전송 이중 계상 방지)
    mockSave.mockClear();
    await expect(flushPendingFocusUploads(USER)).resolves.toBe(false);
    expect(mockSave).not.toHaveBeenCalled();
  });

  test('대기열 저장까지 실패하면 failed — 호출부가 레코드를 보존해 다음 실행에 재시도한다', async () => {
    mockEnd.mockRejectedValue(axiosError());
    mockSave.mockRejectedValue(axiosError());
    const setItem = jest
      .spyOn(AsyncStorage, 'setItem')
      .mockRejectedValueOnce(new Error('스토리지 실패'));

    const result = await uploadFocusBlock({ sessionId: null, body: body(), userId: USER });

    expect(result).toEqual({ status: 'failed' });
    setItem.mockRestore();
  });
});
