// 창 사용분 계산·업로드(그룹 챌린지 확장 A4) 테스트.
// ① 버킷 차 계산 순수 함수 — 경계 정렬(±15분 눈금)·자정 걸침·빈 타임라인·×15 변환 금지 락
// ② syncWindowUsage — 구 바이너리 가드(세션당 1회 계측)·최종 보고 1회 멱등·중간 보고
//    무변화 스킵·업로드 실패 재시도.
// 시각은 jest.setSystemTime으로 고정한다(러너 TZ는 jest.config.js가 KST로 고정).
import AsyncStorage from '@react-native-async-storage/async-storage';
import { computeWindowUsedMinutes, cumulativeMinutesAt, syncWindowUsage } from './screentimeSync';
import ScreenTimeModule, { nativeSupportsUsageBucketEvents } from '@/services/ScreenTimeModule';
import type { UsageBucketEvent } from '@/services/ScreenTimeModule';
import { getChallenges, getMyGroups } from '@/services/groupApi';
import { putWindowUsage } from '@/services/windowUsageApi';
import {
  logScreentimeWindowReported,
  logScreentimeWindowUnsupported,
} from '@/services/analyticsEvents';
import { STORAGE_KEYS } from '@/types/storage';

jest.mock('@/services/api', () => ({
  api: { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() },
}));
jest.mock('@/services/ScreenTimeModule', () => ({
  __esModule: true,
  default: {
    getAuthorizationStatus: jest.fn(),
    getUsageBucketEvents: jest.fn(),
  },
  nativeRegistersBucketStep15: jest.fn(() => true),
  nativeSupportsUsageBucketEvents: jest.fn(() => true),
}));
jest.mock('@/services/groupApi', () => ({
  getMyGroups: jest.fn(),
  getChallenges: jest.fn(),
}));
jest.mock('@/services/windowUsageApi', () => ({
  putWindowUsage: jest.fn(),
}));
jest.mock('@/services/analyticsEvents', () => ({
  logScreentimeWindowReported: jest.fn(),
  logScreentimeWindowUnsupported: jest.fn(),
}));

const mockSupports = nativeSupportsUsageBucketEvents as jest.Mock;
const mockGetEvents = ScreenTimeModule.getUsageBucketEvents as jest.Mock;
const mockGetMyGroups = getMyGroups as jest.Mock;
const mockGetChallenges = getChallenges as jest.Mock;
const mockPut = putWindowUsage as jest.Mock;
const mockLogReported = logScreentimeWindowReported as jest.Mock;
const mockLogUnsupported = logScreentimeWindowUnsupported as jest.Mock;

const USER_ID = 'u1';
const GROUP_ID = 'g1';
const CHALLENGE_ID = 'c1';

// 로컬(KST 고정) 시각의 epoch초 — 창 경계·발화 시각 픽스처용.
function epochSec(dateStr: string, time: string): number {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  return Math.floor(new Date(y, m - 1, d, hh, mm).getTime() / 1000);
}

function ev(dateStr: string, time: string, bucket: number): UsageBucketEvent {
  return { bucket, firedAt: epochSec(dateStr, time) };
}

// SCREEN_TIME×TIME_WINDOW 활성 챌린지 픽스처 — syncWindowUsage가 읽는 필드만 채운다.
function windowChallenge(windowStart: string | null, windowEnd: string | null, overrides?: object) {
  return {
    id: CHALLENGE_ID,
    missionType: 'TIME_WINDOW',
    missionCategory: 'SCREEN_TIME',
    durationMinutes: 120,
    windowStart,
    windowEnd,
    status: 'ACTIVE',
    createdAt: '2026-08-01T00:00:00Z',
    canParticipate: true,
    memberProgress: null,
    ...overrides,
  };
}

// 표준 셋업 — 이 계정 소유 모니터 + 그룹 1개·창 챌린지 1개.
async function setupHappyPath(challenge = windowChallenge('09:00:00', '12:00:00')) {
  await AsyncStorage.setItem(STORAGE_KEYS.screentimeBucketMonitorRegistered, USER_ID);
  mockGetMyGroups.mockResolvedValue([{ groupId: GROUP_ID }]);
  mockGetChallenges.mockResolvedValue([challenge]);
  mockPut.mockResolvedValue(undefined);
}

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  mockSupports.mockReturnValue(true);
  mockGetEvents.mockResolvedValue([]);
});

afterEach(() => {
  jest.useRealTimers();
});

describe('cumulativeMinutesAt — T 시점 하루 누적 사용분', () => {
  const events = [
    ev('2026-08-02', '09:30', 30),
    ev('2026-08-02', '11:00', 300), // bucket은 이미 분 단위 누적 환산값 — 그대로 쓴다
  ];

  test('발화 없음 = 0', () => {
    expect(cumulativeMinutesAt([], epochSec('2026-08-02', '12:00'))).toBe(0);
  });

  test('T 이전 발화 없음 = 0 기준', () => {
    expect(cumulativeMinutesAt(events, epochSec('2026-08-02', '09:00'))).toBe(0);
  });

  test('T 이하 마지막 발화의 bucket — 경계 시각(==)도 포함', () => {
    expect(cumulativeMinutesAt(events, epochSec('2026-08-02', '09:30'))).toBe(30);
    expect(cumulativeMinutesAt(events, epochSec('2026-08-02', '10:59'))).toBe(30);
  });

  test('bucket 값을 그대로 쓴다 — ×15 같은 변환 금지(N1 계약 락)', () => {
    expect(cumulativeMinutesAt(events, epochSec('2026-08-02', '12:00'))).toBe(300);
  });
});

describe('computeWindowUsedMinutes — 창 사용분(버킷 차)', () => {
  test('빈 타임라인 = 0', () => {
    expect(
      computeWindowUsedMinutes({
        startDayEvents: [],
        startAtSec: epochSec('2026-08-02', '09:00'),
        endAtSec: epochSec('2026-08-02', '12:00'),
      }),
    ).toBe(0);
  });

  test('단일일 창 — f(끝) − f(시작), ±15분 눈금 경계 정렬', () => {
    const events = [
      ev('2026-08-02', '08:45', 120), // 창 시작 직전 마지막 발화 — 기준값
      ev('2026-08-02', '09:15', 135),
      ev('2026-08-02', '11:45', 180),
      ev('2026-08-02', '12:15', 195), // 창 종료 이후 — 제외
    ];
    expect(
      computeWindowUsedMinutes({
        startDayEvents: events,
        startAtSec: epochSec('2026-08-02', '09:00'),
        endAtSec: epochSec('2026-08-02', '12:00'),
      }),
    ).toBe(60); // 180 − 120
  });

  test('창 시작 이전 발화가 없으면 0 기준', () => {
    const events = [ev('2026-08-02', '10:00', 45)];
    expect(
      computeWindowUsedMinutes({
        startDayEvents: events,
        startAtSec: epochSec('2026-08-02', '09:00'),
        endAtSec: epochSec('2026-08-02', '12:00'),
      }),
    ).toBe(45);
  });

  test('자정 걸침 창 — 2일 키 조합([시작~자정] + [자정~끝])', () => {
    expect(
      computeWindowUsedMinutes({
        startDayEvents: [ev('2026-08-01', '22:00', 300), ev('2026-08-01', '23:30', 330)],
        startAtSec: epochSec('2026-08-01', '23:00'),
        endAtSec: epochSec('2026-08-02', '01:00'),
        midnightSec: epochSec('2026-08-02', '00:00'),
        nextDayEvents: [ev('2026-08-02', '00:20', 20)],
      }),
    ).toBe(50); // (330 − 300) + 20 — 다음날 키는 0부터 다시 시작
  });

  test('자정 걸침 창을 자정 전에 중간 측정하면 첫째 날 구간만', () => {
    expect(
      computeWindowUsedMinutes({
        startDayEvents: [ev('2026-08-01', '22:00', 300), ev('2026-08-01', '23:30', 330)],
        startAtSec: epochSec('2026-08-01', '23:00'),
        endAtSec: epochSec('2026-08-01', '23:40'), // now < 자정
        midnightSec: epochSec('2026-08-02', '00:00'),
        nextDayEvents: [],
      }),
    ).toBe(30);
  });

  test('역행 값 방어 — 음수는 0으로 클램프', () => {
    // bucket 단조 증가가 계약이지만, 기록이 어긋나도 음수를 서버로 보내지 않는다.
    expect(
      computeWindowUsedMinutes({
        startDayEvents: [ev('2026-08-02', '08:00', 100)],
        startAtSec: epochSec('2026-08-02', '09:00'),
        endAtSec: epochSec('2026-08-02', '12:00'),
      }),
    ).toBe(0);
  });
});

describe('syncWindowUsage — 가드', () => {
  test('구 바이너리(getUsageBucketEvents 미지원)면 전체 스킵 + 미지원 계측은 세션당 1회', async () => {
    mockSupports.mockReturnValue(false);
    await syncWindowUsage(USER_ID);
    await syncWindowUsage(USER_ID);
    expect(mockGetMyGroups).not.toHaveBeenCalled();
    expect(mockPut).not.toHaveBeenCalled();
    expect(mockLogUnsupported).toHaveBeenCalledTimes(1);
  });

  test('버킷 모니터가 이 계정 소유가 아니면 스킵 — 미측정 0분을 오보고하지 않는다', async () => {
    await AsyncStorage.setItem(STORAGE_KEYS.screentimeBucketMonitorRegistered, 'other-user');
    await syncWindowUsage(USER_ID);
    expect(mockGetMyGroups).not.toHaveBeenCalled();
    expect(mockPut).not.toHaveBeenCalled();
  });

  test('SCREEN_TIME×TIME_WINDOW 활성 챌린지가 아니면 업로드하지 않는다', async () => {
    jest.useFakeTimers().setSystemTime(new Date(2026, 7, 2, 13, 0));
    await setupHappyPath();
    mockGetChallenges.mockResolvedValue([
      windowChallenge('09:00:00', '12:00:00', { missionCategory: 'FOCUS' }),
      windowChallenge('09:00:00', '12:00:00', { missionType: 'DURATION' }),
      windowChallenge('09:00:00', '12:00:00', { status: 'INACTIVE' }),
      windowChallenge(null, null), // 창 시각 없음(방어)
    ]);
    await syncWindowUsage(USER_ID);
    expect(mockPut).not.toHaveBeenCalled();
  });
});

describe('syncWindowUsage — 보고', () => {
  test('창 종료 후 최종 보고 — 어제·오늘 창을 각 1회, 재실행은 멱등 스킵', async () => {
    jest.useFakeTimers().setSystemTime(new Date(2026, 7, 2, 13, 0)); // 오늘 창(09~12) 종료 후
    await setupHappyPath();
    mockGetEvents.mockImplementation((dayKey: string) => {
      if (dayKey === '2026-08-01') {
        // 어제: 창 시작 전 0 → 창 안 60 → 창 밖 저녁 200
        return Promise.resolve([
          ev('2026-08-01', '09:30', 30),
          ev('2026-08-01', '11:00', 60),
          ev('2026-08-01', '20:00', 200),
        ]);
      }
      if (dayKey === '2026-08-02') {
        return Promise.resolve([
          ev('2026-08-02', '10:00', 15),
          ev('2026-08-02', '11:30', 45),
          ev('2026-08-02', '12:30', 60), // 창 종료 후 발화 — 제외돼야 한다
        ]);
      }
      return Promise.resolve([]);
    });

    await syncWindowUsage(USER_ID);

    expect(mockPut).toHaveBeenCalledTimes(2);
    expect(mockPut).toHaveBeenNthCalledWith(1, GROUP_ID, CHALLENGE_ID, {
      date: '2026-08-01',
      usedMinutes: 60,
      measuredAt: new Date().toISOString(),
    });
    expect(mockPut).toHaveBeenNthCalledWith(2, GROUP_ID, CHALLENGE_ID, {
      date: '2026-08-02',
      usedMinutes: 45,
      measuredAt: new Date().toISOString(),
    });
    expect(mockLogReported).toHaveBeenCalledTimes(2);
    expect(mockLogReported).toHaveBeenCalledWith({ minutes: 60, is_final: true });
    expect(mockLogReported).toHaveBeenCalledWith({ minutes: 45, is_final: true });

    // 재실행 — 최종 보고 마커로 업로드도 계측도 다시 나가지 않는다.
    mockPut.mockClear();
    mockLogReported.mockClear();
    await syncWindowUsage(USER_ID);
    expect(mockPut).not.toHaveBeenCalled();
    expect(mockLogReported).not.toHaveBeenCalled();
  });

  test('창 진행 중 중간 보고 — 값이 그대로면 스킵, 늘면 다시 보고', async () => {
    jest.useFakeTimers().setSystemTime(new Date(2026, 7, 2, 10, 30)); // 창(09~12) 진행 중
    await setupHappyPath();
    // 어제 창 최종 보고는 이미 완료로 마킹 — 오늘 중간 보고만 보이게 한다.
    await AsyncStorage.setItem(
      STORAGE_KEYS.screentimeWindowReports,
      JSON.stringify({
        userId: USER_ID,
        finals: [`${CHALLENGE_ID}:2026-08-01`],
        last: {},
      }),
    );
    mockGetEvents.mockResolvedValue([ev('2026-08-02', '09:20', 15)]);

    await syncWindowUsage(USER_ID);
    expect(mockPut).toHaveBeenCalledTimes(1);
    expect(mockPut).toHaveBeenCalledWith(GROUP_ID, CHALLENGE_ID, {
      date: '2026-08-02',
      usedMinutes: 15,
      measuredAt: new Date().toISOString(),
    });
    expect(mockLogReported).toHaveBeenCalledWith({ minutes: 15, is_final: false });

    // 같은 값 — 스킵.
    mockPut.mockClear();
    await syncWindowUsage(USER_ID);
    expect(mockPut).not.toHaveBeenCalled();

    // 사용분 증가 — 다시 보고.
    mockGetEvents.mockResolvedValue([ev('2026-08-02', '09:20', 15), ev('2026-08-02', '10:20', 30)]);
    await syncWindowUsage(USER_ID);
    expect(mockPut).toHaveBeenCalledTimes(1);
    expect(mockPut).toHaveBeenCalledWith(
      GROUP_ID,
      CHALLENGE_ID,
      expect.objectContaining({ usedMinutes: 30 }),
    );
  });

  test('업로드 실패는 무시하고 마커를 남기지 않는다 — 다음 sync가 재시도', async () => {
    jest.useFakeTimers().setSystemTime(new Date(2026, 7, 2, 13, 0));
    await setupHappyPath();
    await AsyncStorage.setItem(
      STORAGE_KEYS.screentimeWindowReports,
      JSON.stringify({ userId: USER_ID, finals: [`${CHALLENGE_ID}:2026-08-01`], last: {} }),
    );
    mockGetEvents.mockResolvedValue([ev('2026-08-02', '10:00', 45)]);
    mockPut.mockRejectedValue(new Error('network'));

    await syncWindowUsage(USER_ID); // throw 없이 삼켜야 한다
    expect(mockLogReported).not.toHaveBeenCalled();

    // 다음 sync — 성공하면 그때 최종 마커가 남는다.
    mockPut.mockResolvedValue(undefined);
    await syncWindowUsage(USER_ID);
    expect(mockPut).toHaveBeenCalledTimes(2);
    expect(mockLogReported).toHaveBeenCalledWith({ minutes: 45, is_final: true });

    mockPut.mockClear();
    await syncWindowUsage(USER_ID);
    expect(mockPut).not.toHaveBeenCalled();
  });

  test('자정 걸침 창 진행 중(자정 이후) — 어제 날짜로 2일 키 조합 보고', async () => {
    jest.useFakeTimers().setSystemTime(new Date(2026, 7, 2, 0, 30)); // 어제 23시 창 진행 중
    await setupHappyPath(windowChallenge('23:00:00', '01:00:00'));
    mockGetEvents.mockImplementation((dayKey: string) => {
      if (dayKey === '2026-08-01') {
        return Promise.resolve([ev('2026-08-01', '22:00', 300), ev('2026-08-01', '23:30', 330)]);
      }
      if (dayKey === '2026-08-02') {
        return Promise.resolve([ev('2026-08-02', '00:20', 20)]);
      }
      return Promise.resolve([]);
    });

    await syncWindowUsage(USER_ID);
    expect(mockPut).toHaveBeenCalledTimes(1);
    expect(mockPut).toHaveBeenCalledWith(GROUP_ID, CHALLENGE_ID, {
      date: '2026-08-01', // 창의 기준 날짜 = 시작 날짜
      usedMinutes: 50, // (330−300) + 20
      measuredAt: new Date().toISOString(),
    });
    expect(mockLogReported).toHaveBeenCalledWith({ minutes: 50, is_final: false });
  });

  test('타임라인 조회 실패는 0분으로 보고하지 않고 건너뛴다', async () => {
    jest.useFakeTimers().setSystemTime(new Date(2026, 7, 2, 13, 0));
    await setupHappyPath();
    mockGetEvents.mockRejectedValue(new Error('native')); // 조회 실패 ≠ 발화 없음
    await syncWindowUsage(USER_ID);
    expect(mockPut).not.toHaveBeenCalled();
  });
});
