// 창 사용분 계산·업로드 테스트 (GROMO-1420 — 보고 대상 탐색축 = 내 OPEN 회차, N43).
// ① 버킷 차 계산 순수 함수 — 경계 정렬(±15분 눈금)·세그먼트 합산·빈 타임라인·×15 변환 금지 락
// ② localDaySegments — 로컬-일 세그먼트 분할(자정 정각 경계 포함, GROMO-1242)
// ③ syncWindowUsage — 구 바이너리 가드(세션당 1회 계측)·회차 축 탐색(GET /me/bet-sessions)·
//    최종 보고 1회 멱등·중간 보고 무변화 스킵·업로드 실패 재시도·시작 전 회차 스킵·
//    비KST 로컬 축 조회·보존 게이트(부분합 금지)·measuredAt 동봉(N34).
// 시각은 jest.setSystemTime으로 고정한다(러너 TZ는 jest.config.js가 KST로 고정). 비KST 기기는
// 프로세스 TZ를 못 바꾸므로 localDateStr(로컬 축의 단일 주입점)을 mock 치환해 시뮬레이션한다.
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  computeWindowUsedMinutes,
  cumulativeMinutesAt,
  localDaySegments,
  syncWindowUsage,
} from './screentimeSync';
import { localDateStr } from '@/utils/localDate';
import ScreenTimeModule, { nativeSupportsUsageBucketEvents } from '@/services/ScreenTimeModule';
import type { UsageBucketEvent } from '@/services/ScreenTimeModule';
import { getMyOpenBetSessionsWithToken } from '@/services/groupApi';
import { getFreshAccessToken, getUserIdFromToken } from '@/services/api';
import { putWindowUsage } from '@/services/windowUsageApi';
import {
  logScreentimeWindowReported,
  logScreentimeWindowUnsupported,
} from '@/services/analyticsEvents';
import { STORAGE_KEYS } from '@/types/storage';
import type { MyOpenBetSession } from '@/types/dto/group';

jest.mock('@/services/api', () => ({
  api: { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() },
  // 계정 박제(codex 리뷰 P1) — sync 시작 시 토큰을 확보해 신원을 대조하고, 그 토큰을 모든
  // 요청에 직접 싣는다. 여기서는 JWT를 만들지 않고 두 함수를 직접 통제한다.
  getFreshAccessToken: jest.fn(),
  getUserIdFromToken: jest.fn(),
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
  getMyOpenBetSessionsWithToken: jest.fn(),
}));
jest.mock('@/services/windowUsageApi', () => ({
  putWindowUsage: jest.fn(),
}));
jest.mock('@/services/analyticsEvents', () => ({
  logScreentimeWindowReported: jest.fn(),
  logScreentimeWindowUnsupported: jest.fn(),
}));
// 축 분리 검증(GROMO-1219) — 창 보고 usageDate는 회차의 sessionDate(KST) 그대로여야 하고 prune은
// yesterdayStrKst(실물)를 탄다. **todayStr/yesterdayStr는 일부러 엉뚱한 날짜(독극물)**라, 코드가
// 그쪽을 부르면 단언이 곧장 어긋나 드러난다(러너 TZ가 KST라 값만으론 축이 안 갈린다).
// localDateStr는 네이티브 조회 dayKey의 **정당한 로컬 축 주입점**(GROMO-1242) — 기본은 실물 위임,
// 비KST 시뮬레이션 테스트만 mockImplementation으로 치환한다.
jest.mock('@/utils/localDate', () => {
  const actual = jest.requireActual('@/utils/localDate');
  return {
    __esModule: true,
    ...actual,
    localDateStr: jest.fn((d: Date) => actual.localDateStr(d)),
    todayStr: jest.fn(() => '2000-01-02'),
    yesterdayStr: jest.fn(() => '2000-01-01'),
  };
});

const actualLocalDate = jest.requireActual('@/utils/localDate');
const mockLocalDateStr = localDateStr as jest.Mock;
const mockSupports = nativeSupportsUsageBucketEvents as jest.Mock;
const mockGetEvents = ScreenTimeModule.getUsageBucketEvents as jest.Mock;
const mockGetSessions = getMyOpenBetSessionsWithToken as jest.Mock;
const mockGetFreshToken = getFreshAccessToken as jest.Mock;
const mockUserIdFromToken = getUserIdFromToken as jest.Mock;
const mockPut = putWindowUsage as jest.Mock;
const mockLogReported = logScreentimeWindowReported as jest.Mock;
const mockLogUnsupported = logScreentimeWindowUnsupported as jest.Mock;

const USER_ID = 'u1';
const GROUP_ID = 'g1';
const CHALLENGE_ID = 'c1';
// 이 sync가 시작 시점에 검증해 박제하는 토큰 — 모든 요청이 이걸 실어야 한다(계정 오귀속 방지).
const TOKEN = 'token-u1';

// 로컬(KST 고정) 시각의 epoch초 — 창 경계·발화 시각 픽스처용.
function epochSec(dateStr: string, time: string): number {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  return Math.floor(new Date(y, m - 1, d, hh, mm).getTime() / 1000);
}

function ev(dateStr: string, time: string, bucket: number): UsageBucketEvent {
  return { bucket, firedAt: epochSec(dateStr, time) };
}

// 내 OPEN 회차 픽스처 — /me/bet-sessions?status=OPEN 응답 항목(LLD §2.1 미션 스냅샷).
// v2 창은 자정 걸침이 없다(N25 — 같은 날 최대 23:59).
function session(over: Partial<MyOpenBetSession> = {}): MyOpenBetSession {
  return {
    sessionId: 'bs1',
    groupId: GROUP_ID,
    challengeId: CHALLENGE_ID,
    sessionDate: '2026-08-02',
    missionCategory: 'SCREEN_TIME',
    missionType: 'TIME_WINDOW',
    goalMinutes: 30,
    windowStart: '09:00:00',
    windowEnd: '12:00:00',
    closesAt: '2026-08-02T03:00:00Z',
    settleAfter: '2026-08-02T03:30:00Z',
    ...over,
  };
}

// 표준 셋업 — 이 계정 소유 모니터 + OPEN 회차 목록.
async function setup(sessions: MyOpenBetSession[]) {
  await AsyncStorage.setItem(STORAGE_KEYS.screentimeBucketMonitorRegistered, USER_ID);
  mockGetSessions.mockResolvedValue(sessions);
  mockPut.mockResolvedValue(undefined);
}

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  mockSupports.mockReturnValue(true);
  // 권한 검사(codex ⑥)는 syncWindowUsage 내부 공통 방어다 — 기본은 허용 상태로 깔아 둔다.
  (ScreenTimeModule.getAuthorizationStatus as jest.Mock).mockResolvedValue('approved');
  mockGetEvents.mockResolvedValue([]);
  // 기본은 '시작 시점의 계정이 그대로' — 계정 교체 시나리오만 테스트에서 뒤집는다.
  mockGetFreshToken.mockResolvedValue(TOKEN);
  mockUserIdFromToken.mockImplementation((t: string) => (t === TOKEN ? USER_ID : 'other-user'));
  // 비KST 시뮬레이션 테스트가 남긴 치환을 실물 위임으로 복구 — clearAllMocks는 구현을 지우지
  // 않으므로 매 테스트 기본 구현을 다시 심는다.
  mockLocalDateStr.mockImplementation((d: Date) => actualLocalDate.localDateStr(d));
});

afterEach(() => {
  jest.useRealTimers();
});

// 비KST 기기 시뮬레이션 — 로컬 축의 단일 주입점인 localDateStr만 치환한다(스펙 설계).
// 러너 TZ가 KST 고정이라 이 가짜 축은 실존 TZ의 재현이 아니라 '조회 dayKey·경계가 localDateStr
// 산출값을 따라가는지'(축 배선)를 검증하는 합성 축이다.
function fakeLocalAxis(impl: (date: Date) => string): void {
  mockLocalDateStr.mockImplementation(impl);
}

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

describe('localDaySegments — 로컬-일 세그먼트 분할(GROMO-1242)', () => {
  // 러너 TZ가 KST라 실물 localDateStr의 로컬 = KST — 여기서는 분할 산법(자정 경계·정각 처리)만
  // 검증한다. 순수 함수라 epoch 구간이 로컬 자정을 걸치는 경우(비KST 기기의 KST 창)를 그대로 다룬다.
  test('같은 로컬 일 안의 구간 = 세그먼트 1개', () => {
    expect(
      localDaySegments(epochSec('2026-08-02', '09:00'), epochSec('2026-08-02', '12:00')),
    ).toEqual([
      {
        dayKey: '2026-08-02',
        fromSec: epochSec('2026-08-02', '09:00'),
        toSec: epochSec('2026-08-02', '12:00'),
      },
    ]);
  });

  test('로컬 자정을 걸치는 구간 = 자정에서 2개로 갈라진다', () => {
    expect(
      localDaySegments(epochSec('2026-08-01', '23:00'), epochSec('2026-08-02', '01:00')),
    ).toEqual([
      {
        dayKey: '2026-08-01',
        fromSec: epochSec('2026-08-01', '23:00'),
        toSec: epochSec('2026-08-02', '00:00'),
      },
      {
        dayKey: '2026-08-02',
        fromSec: epochSec('2026-08-02', '00:00'),
        toSec: epochSec('2026-08-02', '01:00'),
      },
    ]);
  });

  test('자정 정각 경계 — 정각 시작은 그날 키, 정각 종료는 빈 세그먼트를 만들지 않는다', () => {
    // 시작이 자정 정각이면 그 시각은 이미 새 날 키다(네이티브 gregorianDayString과 동일 귀속).
    expect(
      localDaySegments(epochSec('2026-08-02', '00:00'), epochSec('2026-08-02', '01:00')),
    ).toEqual([
      {
        dayKey: '2026-08-02',
        fromSec: epochSec('2026-08-02', '00:00'),
        toSec: epochSec('2026-08-02', '01:00'),
      },
    ]);
    // 종료가 자정 정각이면 첫날 세그먼트 하나로 끝난다 — [자정, 자정] 길이 0 세그먼트 금지.
    expect(
      localDaySegments(epochSec('2026-08-01', '23:00'), epochSec('2026-08-02', '00:00')),
    ).toEqual([
      {
        dayKey: '2026-08-01',
        fromSec: epochSec('2026-08-01', '23:00'),
        toSec: epochSec('2026-08-02', '00:00'),
      },
    ]);
  });

  test('빈 구간(start == end) = 세그먼트 없음', () => {
    expect(
      localDaySegments(epochSec('2026-08-02', '09:00'), epochSec('2026-08-02', '09:00')),
    ).toEqual([]);
  });
});

describe('computeWindowUsedMinutes — 창 사용분(세그먼트별 버킷 차 합산)', () => {
  test('빈 타임라인 = 0 (세그먼트 없음도 0)', () => {
    expect(
      computeWindowUsedMinutes({
        segments: [
          {
            events: [],
            fromSec: epochSec('2026-08-02', '09:00'),
            toSec: epochSec('2026-08-02', '12:00'),
          },
        ],
      }),
    ).toBe(0);
    expect(computeWindowUsedMinutes({ segments: [] })).toBe(0);
  });

  test('단일 세그먼트 창 — f(끝) − f(시작), ±15분 눈금 경계 정렬', () => {
    const events = [
      ev('2026-08-02', '08:45', 120), // 창 시작 직전 마지막 발화 — 기준값
      ev('2026-08-02', '09:15', 135),
      ev('2026-08-02', '11:45', 180),
      ev('2026-08-02', '12:15', 195), // 창 종료 이후 — 제외
    ];
    expect(
      computeWindowUsedMinutes({
        segments: [
          {
            events,
            fromSec: epochSec('2026-08-02', '09:00'),
            toSec: epochSec('2026-08-02', '12:00'),
          },
        ],
      }),
    ).toBe(60); // 180 − 120
  });

  test('창 시작 이전 발화가 없으면 0 기준', () => {
    const events = [ev('2026-08-02', '10:00', 45)];
    expect(
      computeWindowUsedMinutes({
        segments: [
          {
            events,
            fromSec: epochSec('2026-08-02', '09:00'),
            toSec: epochSec('2026-08-02', '12:00'),
          },
        ],
      }),
    ).toBe(45); // 시작 이전 발화 없음 = 기준 0
  });

  test('로컬 이틀에 걸친 구간 — 2세그먼트 합산(다음날 키는 0부터 다시 시작)', () => {
    expect(
      computeWindowUsedMinutes({
        segments: [
          {
            events: [ev('2026-08-01', '22:00', 300), ev('2026-08-01', '23:30', 330)],
            fromSec: epochSec('2026-08-01', '23:00'),
            toSec: epochSec('2026-08-02', '00:00'),
          },
          {
            events: [ev('2026-08-02', '00:20', 20)],
            fromSec: epochSec('2026-08-02', '00:00'),
            toSec: epochSec('2026-08-02', '01:00'),
          },
        ],
      }),
    ).toBe(50); // (330 − 300) + 20
  });

  test('역행 값 방어 — 세그먼트별 음수는 0으로 클램프', () => {
    // bucket 단조 증가가 계약이지만, 기록이 어긋나도 음수를 서버로 보내지 않는다(세그먼트 단위
    // 클램프 — 증가 없는 세그먼트는 0으로만 잡히고 다른 세그먼트의 합을 깎지 않는다).
    expect(
      computeWindowUsedMinutes({
        segments: [
          {
            events: [ev('2026-08-02', '08:00', 100)],
            fromSec: epochSec('2026-08-02', '09:00'),
            toSec: epochSec('2026-08-02', '12:00'),
          },
        ],
      }),
    ).toBe(0);
    expect(
      computeWindowUsedMinutes({
        segments: [
          {
            events: [ev('2026-08-01', '22:00', 100)], // 구간 내 증가 없음 → 0
            fromSec: epochSec('2026-08-01', '23:00'),
            toSec: epochSec('2026-08-02', '00:00'),
          },
          {
            events: [ev('2026-08-02', '00:20', 20)],
            fromSec: epochSec('2026-08-02', '00:00'),
            toSec: epochSec('2026-08-02', '01:00'),
          },
        ],
      }),
    ).toBe(20);
  });
});

describe('syncWindowUsage — 가드', () => {
  test('구 바이너리(getUsageBucketEvents 미지원)면 전체 스킵 + 미지원 계측은 세션당 1회', async () => {
    mockSupports.mockReturnValue(false);
    await syncWindowUsage(USER_ID);
    await syncWindowUsage(USER_ID);
    expect(mockGetSessions).not.toHaveBeenCalled();
    expect(mockPut).not.toHaveBeenCalled();
    expect(mockLogUnsupported).toHaveBeenCalledTimes(1);
  });

  // 사일런트 푸시 직행 경로(pushBackground → syncWindowUsage)는 syncScreenTimeUsage의 권한
  // 검사를 지나지 않는다 — 권한 철회 후 잔존 타임라인으로 과소 보고(허위 달성)하지 않게
  // 이 함수가 스스로 확인해야 한다(codex 리뷰 ⑥).
  test('스크린타임 권한이 approved가 아니면 스킵 — 잔존 타임라인 과소 보고 금지', async () => {
    (ScreenTimeModule.getAuthorizationStatus as jest.Mock).mockResolvedValue('denied');
    await AsyncStorage.setItem(STORAGE_KEYS.screentimeBucketMonitorRegistered, USER_ID);
    await syncWindowUsage(USER_ID);
    expect(mockGetSessions).not.toHaveBeenCalled();
    expect(mockPut).not.toHaveBeenCalled();
  });

  test('권한 조회가 실패해도 스킵한다 — 확신 없는 보고를 만들지 않는다', async () => {
    (ScreenTimeModule.getAuthorizationStatus as jest.Mock).mockRejectedValue(new Error('native'));
    await AsyncStorage.setItem(STORAGE_KEYS.screentimeBucketMonitorRegistered, USER_ID);
    await syncWindowUsage(USER_ID); // throw 없이 끝나야 한다
    expect(mockPut).not.toHaveBeenCalled();
  });

  test('버킷 모니터가 이 계정 소유가 아니면 스킵 — 미측정 0분을 오보고하지 않는다', async () => {
    await AsyncStorage.setItem(STORAGE_KEYS.screentimeBucketMonitorRegistered, 'other-user');
    await syncWindowUsage(USER_ID);
    expect(mockGetSessions).not.toHaveBeenCalled();
    expect(mockPut).not.toHaveBeenCalled();
  });

  // ── 계정 박제(codex 리뷰 P1) ──
  // 창 보고는 돈이 걸린 판정의 입력이다. 사일런트 flush가 A로 시작한 뒤 앱이 열려 로그아웃·계정
  // 교체가 일어나면, 인터셉터가 전송 시점의 토큰을 붙이는 한 A의 타임라인이 B의 OPEN 회차로
  // 간다. 잘못된 계정에 쓰느니 안 쓰는 쪽이 항상 옳다.
  describe('계정 교체 방어', () => {
    test('sync 도중 계정이 바뀌어도 시작 시점 계정의 토큰으로만 보낸다', async () => {
      jest.useFakeTimers().setSystemTime(new Date(2026, 7, 2, 13, 0));
      await setup([session()]);
      mockGetEvents.mockResolvedValue([ev('2026-08-02', '10:00', 45)]);
      // 회차 목록을 받아 오는 사이 사용자가 앱을 열어 B로 갈아탔다 — 이제 저장소 토큰은 B 것이다.
      mockGetSessions.mockImplementation(async () => {
        mockGetFreshToken.mockResolvedValue('token-u2');
        return [session()];
      });

      await syncWindowUsage(USER_ID);

      // 보고는 여전히 A의 토큰으로 나간다 — 전송 시점 저장소를 다시 읽지 않는다.
      expect(mockGetSessions).toHaveBeenCalledWith(TOKEN);
      expect(mockPut).toHaveBeenCalledTimes(1);
      expect(mockPut).toHaveBeenCalledWith(
        GROUP_ID,
        CHALLENGE_ID,
        expect.objectContaining({ progressMinutes: 45 }),
        TOKEN,
      );
      expect(mockPut).not.toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.anything(),
        'token-u2',
      );
    });

    test('시작 시점에 이미 계정이 다르면 아무것도 보내지 않는다(fail-closed)', async () => {
      jest.useFakeTimers().setSystemTime(new Date(2026, 7, 2, 13, 0));
      await setup([session()]);
      mockGetEvents.mockResolvedValue([ev('2026-08-02', '10:00', 45)]);
      // 사일런트 flush가 A를 확인한 직후 B로 교체됐다 — 이 sync는 통째로 접는다.
      mockGetFreshToken.mockResolvedValue('token-u2');

      await syncWindowUsage(USER_ID);

      expect(mockGetSessions).not.toHaveBeenCalled();
      expect(mockPut).not.toHaveBeenCalled();
    });

    test('로그아웃(토큰 없음)이면 보내지 않는다', async () => {
      jest.useFakeTimers().setSystemTime(new Date(2026, 7, 2, 13, 0));
      await setup([session()]);
      mockGetFreshToken.mockResolvedValue(null);

      await syncWindowUsage(USER_ID);

      expect(mockGetSessions).not.toHaveBeenCalled();
      expect(mockPut).not.toHaveBeenCalled();
    });

    test('토큰 갱신 실패(throw)도 스킵 — 확신 없는 계정으로 보고하지 않는다', async () => {
      jest.useFakeTimers().setSystemTime(new Date(2026, 7, 2, 13, 0));
      await setup([session()]);
      mockGetFreshToken.mockRejectedValue(new Error('refresh failed'));

      await syncWindowUsage(USER_ID); // throw 없이 끝나야 한다

      expect(mockGetSessions).not.toHaveBeenCalled();
      expect(mockPut).not.toHaveBeenCalled();
    });
  });

  test('회차 목록 조회 실패는 삼키고 이번 sync를 접는다 — 다음 sync가 재시도', async () => {
    jest.useFakeTimers().setSystemTime(new Date(2026, 7, 2, 13, 0));
    await AsyncStorage.setItem(STORAGE_KEYS.screentimeBucketMonitorRegistered, USER_ID);
    mockGetSessions.mockRejectedValue(new Error('network'));
    await syncWindowUsage(USER_ID); // throw 없이 끝나야 한다
    expect(mockPut).not.toHaveBeenCalled();
  });

  test('SCREEN_TIME×TIME_WINDOW 회차가 아니면 업로드하지 않는다', async () => {
    jest.useFakeTimers().setSystemTime(new Date(2026, 7, 2, 13, 0));
    await setup([
      session({ missionCategory: 'FOCUS' }),
      session({ missionType: 'DURATION' }),
      session({ windowStart: null, windowEnd: null }), // 창 시각 없음(방어)
      // 자정 걸침 창은 v2 계약에서 금지(N25) — 어긋난 값은 오보고하지 않고 스킵한다.
      session({ windowStart: '23:00:00', windowEnd: '01:00:00' }),
    ]);
    await syncWindowUsage(USER_ID);
    expect(mockPut).not.toHaveBeenCalled();
  });

  test('시작 전 회차(미래 예약 — join-next·join-week)는 보고하지 않는다', async () => {
    jest.useFakeTimers().setSystemTime(new Date(2026, 7, 2, 8, 0)); // 오늘 창(09~12) 시작 전
    await setup([
      session(), // 오늘 09:00 시작 — 아직
      session({ sessionId: 'bs-next', sessionDate: '2026-08-04' }), // 미래 예약 회차(OPEN)
    ]);
    mockGetEvents.mockResolvedValue([ev('2026-08-02', '07:30', 30)]);
    await syncWindowUsage(USER_ID);
    expect(mockPut).not.toHaveBeenCalled();
  });
});

describe('syncWindowUsage — 보고(회차 축)', () => {
  test('창 종료 후 최종 보고 — 어제·오늘 회차를 각 1회, 재실행은 멱등 스킵', async () => {
    jest.useFakeTimers().setSystemTime(new Date(2026, 7, 2, 13, 0)); // 오늘 창(09~12) 종료 후
    // 어제 회차가 아직 OPEN(정산 전 그레이스) — 목록에 있는 한 최종 보고 대상이다(N43).
    await setup([
      session({ sessionId: 'bs-y', sessionDate: '2026-08-01' }),
      session({ sessionId: 'bs-t', sessionDate: '2026-08-02' }),
    ]);
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
    // usageDate = 회차의 sessionDate(KST) · measuredAt 동봉(N34 — 역전 보고 서버 판정 축).
    expect(mockPut).toHaveBeenNthCalledWith(
      1,
      GROUP_ID,
      CHALLENGE_ID,
      { usageDate: '2026-08-01', progressMinutes: 60, measuredAt: new Date().toISOString() },
      TOKEN,
    );
    expect(mockPut).toHaveBeenNthCalledWith(
      2,
      GROUP_ID,
      CHALLENGE_ID,
      { usageDate: '2026-08-02', progressMinutes: 45, measuredAt: new Date().toISOString() },
      TOKEN,
    );
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
    await setup([session()]);
    mockGetEvents.mockResolvedValue([ev('2026-08-02', '09:20', 15)]);

    await syncWindowUsage(USER_ID);
    expect(mockPut).toHaveBeenCalledTimes(1);
    expect(mockPut).toHaveBeenCalledWith(
      GROUP_ID,
      CHALLENGE_ID,
      { usageDate: '2026-08-02', progressMinutes: 15, measuredAt: new Date().toISOString() },
      TOKEN,
    );
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
      expect.objectContaining({ progressMinutes: 30 }),
      TOKEN,
    );
  });

  test('업로드 실패는 무시하고 마커를 남기지 않는다 — 다음 sync가 재시도', async () => {
    jest.useFakeTimers().setSystemTime(new Date(2026, 7, 2, 13, 0));
    await setup([session()]);
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

  test('타임라인 조회 실패는 0분으로 보고하지 않고 건너뛴다', async () => {
    jest.useFakeTimers().setSystemTime(new Date(2026, 7, 2, 13, 0));
    await setup([session()]);
    mockGetEvents.mockRejectedValue(new Error('native')); // 조회 실패 ≠ 발화 없음
    await syncWindowUsage(USER_ID);
    expect(mockPut).not.toHaveBeenCalled();

    // 다음 sync — 읽히면 그때 최종 보고된다(재시도 보존).
    mockGetEvents.mockResolvedValue([ev('2026-08-02', '10:00', 45)]);
    await syncWindowUsage(USER_ID);
    expect(mockPut).toHaveBeenCalledTimes(1);
    expect(mockLogReported).toHaveBeenCalledWith({ minutes: 45, is_final: true });
  });
});

describe('syncWindowUsage — 비KST 로컬 축·보존 게이트(GROMO-1242)', () => {
  test('비KST 기기 — 조회 dayKey는 localDateStr 산출을 따르고 usageDate는 KST 회차 날짜 그대로다', async () => {
    jest.useFakeTimers().setSystemTime(new Date(2026, 7, 2, 13, 0)); // 오늘 창(09~12) 종료 후
    await setup([session()]);
    // 가짜 로컬 축: 이 기기의 로컬 날짜는 KST와 다른 '2026-08-03' — 조회 키가 KST 날짜가 아니라
    // localDateStr 산출을 따라가는지 검증한다(적재 키 = 익스텐션 로컬 축, 계약 §1).
    fakeLocalAxis(() => '2026-08-03');
    mockGetEvents.mockImplementation((dayKey: string) =>
      dayKey === '2026-08-03'
        ? Promise.resolve([ev('2026-08-02', '10:00', 45)])
        : Promise.resolve([]),
    );

    await syncWindowUsage(USER_ID);

    expect(mockGetEvents).toHaveBeenCalledWith('2026-08-03');
    expect(mockGetEvents).not.toHaveBeenCalledWith('2026-08-02'); // KST 날짜 키 조회 금지
    expect(mockPut).toHaveBeenCalledTimes(1);
    expect(mockPut).toHaveBeenCalledWith(
      GROUP_ID,
      CHALLENGE_ID,
      {
        usageDate: '2026-08-02', // 보고 축은 KST 회차 날짜 불변
        progressMinutes: 45,
        measuredAt: new Date().toISOString(),
      },
      TOKEN,
    );
  });

  test('보존 게이트 — 필요 dayKey가 로컬 어제 미만이면 그 회차 전체를 skip(putWindowUsage 미호출)', async () => {
    jest.useFakeTimers().setSystemTime(new Date(2026, 7, 2, 13, 0)); // 두 창 모두 종료 후
    await setup([
      session({ sessionId: 'bs-y', sessionDate: '2026-08-01' }),
      session({ sessionId: 'bs-t', sessionDate: '2026-08-02' }),
    ]);
    // 가짜 로컬 축(합성): 어제(KST) 창 시각은 '2026-07-30', 로컬 어제(now−1일)는 '2026-07-31',
    // 오늘(KST) 창 시각은 '2026-08-01' — 어제 회차의 필요 키('2026-07-30')가 보존 하한
    // ('2026-07-31') 미만이 되도록 구성한다(네이티브가 이미 지운 키 = 빈 배열 = 0분 함정).
    const aug1NoonMs = epochSec('2026-08-01', '12:00') * 1000;
    const kstMidnightMs = epochSec('2026-08-02', '00:00') * 1000;
    fakeLocalAxis((d) => {
      if (d.getTime() < aug1NoonMs) return '2026-07-30';
      if (d.getTime() < kstMidnightMs) return '2026-07-31';
      return '2026-08-01';
    });
    mockGetEvents.mockImplementation((dayKey: string) => {
      if (dayKey === '2026-08-01') {
        return Promise.resolve([ev('2026-08-02', '10:00', 45)]);
      }
      // 보존 창 밖 키는 네이티브가 빈 배열을 준다 — 이것이 0분으로 새면 과소 보고.
      return Promise.resolve([]);
    });

    await syncWindowUsage(USER_ID);

    // 어제 회차는 통째로 skip — 부분합(0분) 보고 금지. 오늘 회차만 보고된다.
    expect(mockPut).toHaveBeenCalledTimes(1);
    expect(mockPut).toHaveBeenCalledWith(
      GROUP_ID,
      CHALLENGE_ID,
      { usageDate: '2026-08-02', progressMinutes: 45, measuredAt: new Date().toISOString() },
      TOKEN,
    );
    expect(mockGetEvents).not.toHaveBeenCalledWith('2026-07-30'); // 게이트가 조회 전에 자른다
  });

  // (참고) '여러 로컬 세그먼트 중 하나만 조회 실패 → 전체 skip' 경로는 sync 수준에서 재현할 수
  // 없다 — localDaySegments의 경계는 dayKey를 파싱한 러너(KST) 자정이라, 자정 걸침이 금지된
  // v2 창(N25) 안에는 어떤 경계도 떨어지지 않아 세그먼트가 항상 1개다. 다세그 합산·부분합
  // 금지의 산법은 위 순수 함수 테스트(localDaySegments·computeWindowUsedMinutes)가 잠근다.
});
