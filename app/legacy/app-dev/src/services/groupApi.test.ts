// groupApi 계약 + groupErrorCode 유닛 테스트 — 명세 docs/app/group-plan.md §3·§8·§11.
// HTTP status가 아니라 서버 에러 바디의 code로 분기하는 게 계약이라(ROOM_FULL·ALREADY_MEMBER 둘 다 409)
// groupErrorCode가 조용히 null을 뱉기 시작하면 화면 분기가 전부 공통 문구로 무너진다.
// method/path도 함께 잠근다 — 오타 하나가 런타임 404로만 드러나고 타입 검사에는 걸리지 않는다.
import { AxiosError, AxiosHeaders } from 'axios';
import {
  ackMyChallengeResult,
  cancelBet,
  challengeGroupId,
  claimMyChallengeResult,
  createAnnouncement,
  createBet,
  createChallenge,
  createGroup,
  deleteAnnouncement,
  deleteChallenge,
  getAnnouncements,
  getBetHistory,
  getChallenges,
  getGroupChallengeHistory,
  getGroupDetail,
  getGroupOverview,
  getMyChallengeResults,
  getMyGroups,
  getMyOpenBetSessionsWithToken,
  groupErrorCode,
  groupErrorRetryAfterMs,
  joinBet,
  joinGroup,
  leaveBet,
  searchGroups,
  updateAnnouncement,
  withdrawGroup,
} from './groupApi';
import {
  api,
  getAuthSessionGeneration,
  getFreshAccessToken,
  getUserIdFromToken,
} from '@/services/api';
import { logGroupChallengeDeleted } from '@/services/analyticsEvents';
import { todayStrKst } from '@/utils/localDate';

jest.mock('@/services/api', () => ({
  api: { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() },
  // /me/challenge-results는 토큰을 직접 실어 계정을 박제한다 — 그 세 함수도 목 표면이다.
  getFreshAccessToken: jest.fn(),
  getUserIdFromToken: jest.fn(),
  getAuthSessionGeneration: jest.fn(() => 1),
}));

// 삭제 계측(group_challenge_deleted)은 groupApi가 발행 지점이다 — 파이어베이스 네이티브 모듈이
// jest에 없기도 하고, '언제 발행되는가'를 여기서 직접 검증한다.
jest.mock('@/services/analyticsEvents', () => ({
  logGroupChallengeDeleted: jest.fn(),
  logGroupChallengeSettled: jest.fn(),
}));

const mockApi = api as unknown as {
  get: jest.Mock;
  post: jest.Mock;
  put: jest.Mock;
  delete: jest.Mock;
};
const mockGetFreshAccessToken = getFreshAccessToken as jest.MockedFunction<
  typeof getFreshAccessToken
>;
const mockGetUserIdFromToken = getUserIdFromToken as jest.MockedFunction<typeof getUserIdFromToken>;
const mockGetAuthSessionGeneration = getAuthSessionGeneration as jest.MockedFunction<
  typeof getAuthSessionGeneration
>;

const GROUP_ID = '0197e0c3-4d1b-7a2e-9f60-3b7c1f2a8d55';
const NOTICE_ID = 'a1';
const CHALLENGE_ID = 'c1';
const BET_ID = 'b1';

// 서버 GlobalExceptionHandler가 내려주는 { code, message } 바디를 실은 axios 에러를 만든다.
function axiosErrorWith(status: number, data: unknown): AxiosError {
  const config = { headers: new AxiosHeaders() };
  return new AxiosError('request failed', 'ERR_BAD_REQUEST', config, null, {
    status,
    statusText: '',
    headers: {},
    config,
    data,
  });
}

describe('엔드포인트 계약(§3-1·§8)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockApi.get.mockResolvedValue({ data: [] });
    mockApi.post.mockResolvedValue({ data: { groupId: GROUP_ID } });
    mockApi.put.mockResolvedValue({ data: undefined });
    mockApi.delete.mockResolvedValue({ data: undefined });
    // claim·ack은 전송 직전에 계정을 고정한다(PR #672 P1) — 세션을 못 읽으면 아예 안 나간다.
    mockGetFreshAccessToken.mockResolvedValue('token-u1');
    mockGetUserIdFromToken.mockReturnValue('u1');
  });

  test('POST /api/v1/groups — 생성 바디를 그대로 보낸다(비밀번호 없음)', async () => {
    const body = {
      name: '아침 6시 집중방',
      maxMembers: 5,
      missionType: 'DURATION' as const,
      missionCategory: 'FOCUS' as const,
      durationMinutes: 60,
      isPrivate: true,
    };
    await createGroup(body);
    expect(mockApi.post).toHaveBeenCalledWith('/api/v1/groups', body);
  });

  test('GET /api/v1/groups — 내 그룹 목록', async () => {
    await getMyGroups();
    expect(mockApi.get).toHaveBeenCalledWith('/api/v1/groups');
  });

  test('NOT_FOUND 보조 재확인은 목록·상세 모두 401 auth retry를 끈다', async () => {
    await getMyGroups({ noAuthRetry: true });
    expect(mockApi.get).toHaveBeenCalledWith('/api/v1/groups', { _noAuthRetry: true });

    jest.clearAllMocks();
    mockApi.get.mockResolvedValue({ data: {} });
    await getGroupDetail(GROUP_ID, '2026-08-02', { noAuthRetry: true });
    expect(mockApi.get).toHaveBeenCalledWith(`/api/v1/groups/${GROUP_ID}`, {
      params: { date: '2026-08-02' },
      _noAuthRetry: true,
    });
  });

  test('GET /api/v1/groups/search — query 파라미터', async () => {
    await searchGroups('집중');
    expect(mockApi.get).toHaveBeenCalledWith('/api/v1/groups/search', {
      params: { query: '집중' },
    });
  });

  // 코드·비밀번호를 폐기했으므로 바디는 항상 {} 다 — 생략하면 서버가 415를 준다.
  test('POST /{groupId}/join — 빈 바디를 반드시 싣는다', async () => {
    await joinGroup(GROUP_ID);
    expect(mockApi.post).toHaveBeenCalledWith(`/api/v1/groups/${GROUP_ID}/join`, {});
  });

  test('GET /{groupId}/overview — 무권한 프리뷰', async () => {
    await getGroupOverview(GROUP_ID);
    expect(mockApi.get).toHaveBeenCalledWith(`/api/v1/groups/${GROUP_ID}/overview`);
  });

  // date는 서버 필수 파라미터라 누락 시 400 — 기본값은 KST 오늘이다(GROMO-1219,
  // 서버 판정 축과 동일. §3-1-1의 '로컬' 서술은 1219 이전의 것).
  test('GET /{groupId} — date 기본값은 오늘(KST)', async () => {
    await getGroupDetail(GROUP_ID);
    expect(mockApi.get).toHaveBeenCalledWith(`/api/v1/groups/${GROUP_ID}`, {
      params: { date: todayStrKst() },
    });
  });

  test('GET /{groupId} — date를 주면 그대로 보낸다', async () => {
    await getGroupDetail(GROUP_ID, '2026-08-02');
    expect(mockApi.get).toHaveBeenCalledWith(`/api/v1/groups/${GROUP_ID}`, {
      params: { date: '2026-08-02' },
    });
  });

  test('DELETE /{groupId}/members/me — 그룹 나가기', async () => {
    await withdrawGroup(GROUP_ID);
    expect(mockApi.delete).toHaveBeenCalledWith(`/api/v1/groups/${GROUP_ID}/members/me`);
  });

  test('공지 4종 — 목록·작성·수정·삭제', async () => {
    const body = { title: '제목', content: '본문' };
    await getAnnouncements(GROUP_ID);
    await createAnnouncement(GROUP_ID, body);
    await updateAnnouncement(GROUP_ID, NOTICE_ID, body);
    await deleteAnnouncement(GROUP_ID, NOTICE_ID);

    const base = `/api/v1/groups/${GROUP_ID}/announcements`;
    expect(mockApi.get).toHaveBeenCalledWith(base);
    expect(mockApi.post).toHaveBeenCalledWith(base, body);
    expect(mockApi.put).toHaveBeenCalledWith(`${base}/${NOTICE_ID}`, body);
    expect(mockApi.delete).toHaveBeenCalledWith(`${base}/${NOTICE_ID}`);
  });

  // 챌린지 3종(2차, docs/back/group-plan-2.md §1) — date는 **선택**이라 공지와 달리 기본값을 채우지 않는다.
  // date를 보낼 때만 memberProgress가 실려 오므로, 안 보내는 경우 params 자체가 나가면 안 된다.
  test('GET /{groupId}/challenges — date 없이 부르면 params를 싣지 않는다', async () => {
    await getChallenges(GROUP_ID);
    expect(mockApi.get).toHaveBeenCalledWith(`/api/v1/groups/${GROUP_ID}/challenges`, undefined);
  });

  test('GET /{groupId}/challenges — date를 주면 그대로 보낸다(진행률 기준일)', async () => {
    await getChallenges(GROUP_ID, '2026-08-02');
    expect(mockApi.get).toHaveBeenCalledWith(`/api/v1/groups/${GROUP_ID}/challenges`, {
      params: { date: '2026-08-02' },
    });
  });

  test('POST·DELETE /{groupId}/challenges — 생성 바디를 그대로 보내고 id로 삭제한다', async () => {
    const body = {
      missionCategory: 'FOCUS' as const,
      missionType: 'DURATION' as const,
      durationMinutes: 60,
      // 요일 반복(GROMO-1273) — v2 계약의 필수 필드다(LLD §2).
      repeatDays: ['MON' as const],
    };
    await createChallenge(GROUP_ID, body);
    await deleteChallenge(GROUP_ID, CHALLENGE_ID);

    const base = `/api/v1/groups/${GROUP_ID}/challenges`;
    expect(mockApi.post).toHaveBeenCalledWith(base, body);
    expect(mockApi.delete).toHaveBeenCalledWith(`${base}/${CHALLENGE_ID}`);
  });

  // 내기 2종(3차, docs/back/group-bet-plan.md §2) — 개설은 챌린지 하위 경로,
  // 참가는 **그룹 하위**(betId만으로 찾는다)라 경로 모양이 다르다. 오타는 런타임 404로만 드러난다.
  test('POST /{groupId}/challenges/{challengeId}/bets — 판돈·날짜를 그대로 보낸다', async () => {
    await createBet(GROUP_ID, CHALLENGE_ID, { stake: 30, date: '2026-08-01' });
    expect(mockApi.post).toHaveBeenCalledWith(
      `/api/v1/groups/${GROUP_ID}/challenges/${CHALLENGE_ID}/bets`,
      { stake: 30, date: '2026-08-01' },
    );
  });

  // joinGroup과 같은 이유 — 바디를 생략하면 서버가 415를 준다.
  test('POST /{groupId}/bets/{betId}/join — 빈 바디를 반드시 싣는다', async () => {
    await joinBet(GROUP_ID, BET_ID);
    expect(mockApi.post).toHaveBeenCalledWith(`/api/v1/groups/${GROUP_ID}/bets/${BET_ID}/join`, {});
  });

  // 취소(확장 배치, contract.md §2) — 개설자 단독·OPEN일 때만 서버가 수락하고 판돈을 환불한다.
  test('DELETE /{groupId}/bets/{betId} — 내기 취소', async () => {
    await cancelBet(GROUP_ID, BET_ID);
    expect(mockApi.delete).toHaveBeenCalledWith(`/api/v1/groups/${GROUP_ID}/bets/${BET_ID}`);
  });

  // 참가 철회(챌린지 개선 배치, 계약 §4 — W4 병행 구현) — 본인 참가만 철회·본인 참가비 환불.
  // 취소(/bets/{betId})와 경로가 한 단어 차이라 오타는 런타임 404로만 드러난다 — 여기서 잠근다.
  test('DELETE /{groupId}/bets/{betId}/participation — 참가 철회', async () => {
    await leaveBet(GROUP_ID, BET_ID);
    expect(mockApi.delete).toHaveBeenCalledWith(
      `/api/v1/groups/${GROUP_ID}/bets/${BET_ID}/participation`,
    );
  });

  // 내기 히스토리(GROMO-1221) — GET이 개설 POST와 같은 경로라(#510 계약) 쿼리 직렬화가 계약의
  // 전부다: size는 서버 필수(누락 시 프레임워크 400)라 항상 실리고, cursor는 첫 페이지에선
  // 키 자체가 직렬화되지 않아야 한다(undefined — 빈 문자열 커서는 서버가 UUID 파싱 400).
  test('GET /{groupId}/challenges/{challengeId}/bets — size 필수·cursor는 있을 때만', async () => {
    mockApi.get.mockResolvedValue({
      data: { content: [], size: 20, hasNext: false, nextCursor: null },
    });

    await getBetHistory(GROUP_ID, CHALLENGE_ID, { size: 20 });
    expect(mockApi.get).toHaveBeenCalledWith(
      `/api/v1/groups/${GROUP_ID}/challenges/${CHALLENGE_ID}/bets`,
      { params: { cursor: undefined, size: 20 } },
    );

    await getBetHistory(GROUP_ID, CHALLENGE_ID, { cursor: BET_ID, size: 20 });
    expect(mockApi.get).toHaveBeenLastCalledWith(
      `/api/v1/groups/${GROUP_ID}/challenges/${CHALLENGE_ID}/bets`,
      { params: { cursor: BET_ID, size: 20 } },
    );
  });

  // 그룹 챌린지 내역(GROMO-1277 · N6-1) — **경로가 챌린지에 종속되지 않는 것**이 계약의 핵심이다.
  // 챌린지가 삭제돼도 조회돼야 하므로 챌린지별 보기조차 경로가 아니라 challengeId 쿼리다(IA §5).
  test('GET /{groupId}/challenge-history — 챌린지별 보기도 같은 경로의 쿼리 필터다', async () => {
    mockApi.get.mockResolvedValue({
      data: { content: [], size: 20, hasNext: false, nextCursor: null },
    });

    await getGroupChallengeHistory(GROUP_ID, { size: 20 });
    expect(mockApi.get).toHaveBeenCalledWith(`/api/v1/groups/${GROUP_ID}/challenge-history`, {
      params: { cursor: undefined, size: 20, challengeId: undefined },
    });

    await getGroupChallengeHistory(GROUP_ID, {
      cursor: BET_ID,
      size: 20,
      challengeId: CHALLENGE_ID,
    });
    expect(mockApi.get).toHaveBeenLastCalledWith(`/api/v1/groups/${GROUP_ID}/challenge-history`, {
      params: { cursor: BET_ID, size: 20, challengeId: CHALLENGE_ID },
    });
  });

  // TIME_WINDOW 생성(확장 배치) — 창 시각·목표분이 additive로 실린다.
  // 창 시각은 "HH:mm:ss" KST 벽시계다(GROMO-1225 — 종전 ISO Instant 합성 폐기).
  test('POST /{groupId}/challenges — 창 생성 바디(windowStart/End)를 그대로 보낸다', async () => {
    const body = {
      missionCategory: 'FOCUS' as const,
      missionType: 'TIME_WINDOW' as const,
      durationMinutes: 60,
      repeatDays: ['MON' as const],
      windowStart: '09:00:00',
      windowEnd: '12:00:00',
    };
    await createChallenge(GROUP_ID, body);
    expect(mockApi.post).toHaveBeenCalledWith(`/api/v1/groups/${GROUP_ID}/challenges`, body);
  });

  // 계정 박제 변형(codex 리뷰 P1) — 사일런트 flush가 검증한 토큰을 직접 싣고 401 재발급
  // 재시도를 끈다. 인터셉터가 전송 시점의 저장 토큰을 붙이면, 검증~전송 사이에 계정이 바뀐
  // 경우 **남의 OPEN 회차**를 읽어 와 그 위에 보고하게 된다(돈 경로).
  test('GET /me/bet-sessions(계정 박제) — 넘긴 토큰을 싣고 재발급 재시도를 끈다', async () => {
    mockApi.get.mockResolvedValue({ data: { sessions: [] } });
    await getMyOpenBetSessionsWithToken('token-u1');
    expect(mockApi.get).toHaveBeenCalledWith('/api/v1/me/bet-sessions', {
      params: { status: 'OPEN' },
      headers: { Authorization: 'Bearer token-u1' },
      _noAuthRetry: true,
    });
  });

  // 노출 선점·확인(GROMO-1577 · 계약 §4). 두 경로가 한 단어 차이라 오타는 런타임 404로만
  // 드러난다 — joinGroup과 같은 이유로 claim의 빈 바디도 함께 잠근다(생략 시 서버 415).
  test('POST /me/challenge-results/{sessionId}/claim — 빈 바디를 반드시 싣는다', async () => {
    mockApi.post.mockResolvedValue({ data: { claimToken: 'ct-1' } });
    await expect(claimMyChallengeResult('s1')).resolves.toEqual({ claimToken: 'ct-1' });
    expect(mockApi.post).toHaveBeenCalledWith(
      '/api/v1/me/challenge-results/s1/claim',
      {},
      { headers: { Authorization: 'Bearer token-u1' }, _noAuthRetry: true },
    );
  });

  test('POST /me/challenge-results/{sessionId}/ack — claimToken을 바디로 보낸다', async () => {
    mockApi.post.mockResolvedValue({ data: undefined });
    await ackMyChallengeResult('s1', 'ct-1');
    expect(mockApi.post).toHaveBeenCalledWith(
      '/api/v1/me/challenge-results/s1/ack',
      { claimToken: 'ct-1' },
      { headers: { Authorization: 'Bearer token-u1' }, _noAuthRetry: true },
    );
  });
});

// GET /me/challenge-results — 결과 모달 큐의 유일한 소스(N53). 여기서 잠그는 것은 **실패를
// 실패로 말하는가**다: 호출부(GroupRoomScreen)는 성공한 빈 배열을 '결과 없음 정본'으로 읽어
// 대기 중인 큐까지 비운다.
describe('GET /me/challenge-results — 토큰 실패는 "결과 없음"이 아니다(G11)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetAuthSessionGeneration.mockReturnValue(1);
    mockGetUserIdFromToken.mockReturnValue('u1');
    mockGetFreshAccessToken.mockResolvedValue('token-u1');
    mockApi.get.mockResolvedValue({ data: { results: [] } });
  });

  // ⚠️ 이 테스트가 무너지면 사용자는 "결과가 없다"를 보고 지표에는 아무 흔적도 남지 않는다.
  // getFreshAccessToken은 갱신 실패(네트워크·5xx)를 **던진다** — 그 throw를 삼켜 빈 배열로
  // 접으면 대기 중인 결과 큐가 통째로 비워진다. 호출부는 allSettled로 감싸 rejected를
  // resultsUnknown(모르겠다)으로 다루므로, 실패 전파가 올바른 신호다.
  test('토큰 갱신 실패는 reject한다 — 빈 배열로 접지 않는다', async () => {
    mockGetFreshAccessToken.mockRejectedValue(new Error('network'));
    await expect(getMyChallengeResults()).rejects.toThrow();
    expect(mockApi.get).not.toHaveBeenCalled();
  });

  // 저장된 토큰이 없는 것도(null) 마찬가지다 — 세션이 있을 때만 부르는 조회라(게스트는 호출부가
  // 걸러 낸다) 여기서 토큰이 비면 '결과가 없다'가 아니라 '세션을 못 읽었다'다.
  test('저장된 토큰이 없어도 reject한다 — 세션 부재는 결과 부재가 아니다', async () => {
    mockGetFreshAccessToken.mockResolvedValue(null);
    mockGetUserIdFromToken.mockReturnValue(null);
    await expect(getMyChallengeResults()).rejects.toThrow();
    expect(mockApi.get).not.toHaveBeenCalled();
  });

  test('정상 경로 — 검증한 토큰을 직접 싣고 재발급 재시도를 끈다', async () => {
    await expect(getMyChallengeResults()).resolves.toEqual([]);
    expect(mockApi.get).toHaveBeenCalledWith('/api/v1/me/challenge-results', {
      params: { since: undefined, limit: undefined },
      headers: { Authorization: 'Bearer token-u1' },
      _noAuthRetry: true,
    });
  });
});

// claim·ack의 **전송 시점** 계정 고정(PR #672 리뷰 P1). 호출 시점을 막는 것은 호스트(W1)
// 몫이고 여기는 전송 시점을 막는다 — 둘 다 필요하다.
describe('claim·ack은 조회 계정에 고정된다(P1 — 계정 전환 창)', () => {
  const SESSION = 'sess-owned-by-u1';

  beforeEach(async () => {
    jest.clearAllMocks();
    mockGetAuthSessionGeneration.mockReturnValue(1);
    mockGetUserIdFromToken.mockReturnValue('u1');
    mockGetFreshAccessToken.mockResolvedValue('token-u1');
    // u1이 이 회차를 조회했다 — 소유 계정이 여기서 기록된다.
    mockApi.get.mockResolvedValue({ data: { results: [{ sessionId: SESSION, status: 'OPEN' }] } });
    await getMyChallengeResults();
    mockApi.post.mockResolvedValue({ data: { claimToken: 'ct-1' } });
  });

  // ⚠️ 이 테스트가 무너지면 두 계정이 같은 회차에 참가했을 때 **새 계정이 못 본 결과가
  // 확인 처리돼 영구히 누락**된다. 인터셉터는 전송 시점의 저장 토큰을 붙이므로, 조회 뒤
  // 전환된 계정의 토큰으로 claim·ack이 나가는 것을 여기서 끊는다.
  test('조회 뒤 계정이 바뀌면 아예 보내지 않는다', async () => {
    mockGetUserIdFromToken.mockReturnValue('u2');
    mockGetFreshAccessToken.mockResolvedValue('token-u2');

    await expect(claimMyChallengeResult(SESSION)).rejects.toThrow();
    await expect(ackMyChallengeResult(SESSION, 'ct-1')).rejects.toThrow();
    expect(mockApi.post).not.toHaveBeenCalled();
  });

  test('같은 계정이면 그 계정 토큰을 직접 싣고 나간다', async () => {
    await claimMyChallengeResult(SESSION);
    expect(mockApi.post).toHaveBeenCalledWith(
      `/api/v1/me/challenge-results/${SESSION}/claim`,
      {},
      { headers: { Authorization: 'Bearer token-u1' }, _noAuthRetry: true },
    );
  });
});

// 챌린지 메타 캐시 — 삭제 계측(파라미터 포함 발행)과 카드 취소의 groupId 역참조가 이 캐시에 기댄다.
describe('챌린지 메타 캐시', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockApi.delete.mockResolvedValue({ data: undefined });
  });

  function challengeRow(id: string) {
    return {
      id,
      missionType: 'TIME_WINDOW',
      missionCategory: 'SCREEN_TIME',
      durationMinutes: 60,
      windowStart: '09:00:00',
      windowEnd: '11:00:00',
      status: 'ACTIVE',
      createdAt: '2026-08-01T06:00:00',
      canParticipate: true,
      memberProgress: null,
      bet: null,
      lastSettledBet: null,
    };
  }

  test('목록 조회가 채운 메타로 삭제 성공 시에만 계측을 발행한다', async () => {
    mockApi.get.mockResolvedValue({ data: [challengeRow(CHALLENGE_ID)] });
    await getChallenges(GROUP_ID);

    // 실패한 삭제는 발행하지 않는다 — 실제 삭제 수만 센다.
    mockApi.delete.mockRejectedValueOnce(new Error('network'));
    await expect(deleteChallenge(GROUP_ID, CHALLENGE_ID)).rejects.toThrow();
    expect(logGroupChallengeDeleted).not.toHaveBeenCalled();

    await deleteChallenge(GROUP_ID, CHALLENGE_ID);
    expect(logGroupChallengeDeleted).toHaveBeenCalledWith({
      mission_type: 'TIME_WINDOW',
      mission_category: 'SCREEN_TIME',
    });
  });

  test('캐시에 없는 챌린지 삭제는 계측을 생략한다(반쪽 이벤트 방지)', async () => {
    await deleteChallenge(GROUP_ID, 'unknown-challenge');
    expect(mockApi.delete).toHaveBeenCalled();
    expect(logGroupChallengeDeleted).not.toHaveBeenCalled();
  });

  test('challengeGroupId — 마지막으로 목록을 내려준 그룹을 돌려주고, 모르면 null', async () => {
    mockApi.get.mockResolvedValue({ data: [challengeRow(CHALLENGE_ID)] });
    await getChallenges(GROUP_ID);
    expect(challengeGroupId(CHALLENGE_ID)).toBe(GROUP_ID);
    expect(challengeGroupId('unknown-challenge')).toBeNull();
  });
});

describe('groupErrorCode', () => {
  test.each([
    ['GUEST_FORBIDDEN', 403],
    ['ALREADY_MEMBER', 409],
    ['ROOM_FULL', 409],
    ['NOT_FOUND', 404],
    ['MEMBER_ONLY', 403],
    ['HOST_WITHDRAW', 400],
  ])('서버 enum 이름 %s 를 그대로 돌려준다', (code, status) => {
    expect(groupErrorCode(axiosErrorWith(status, { code, message: '...' }))).toBe(code);
  });

  test('같은 409라도 code로 구분된다 — status만으론 불가능한 분기', () => {
    const already = groupErrorCode(axiosErrorWith(409, { code: 'ALREADY_MEMBER', message: '' }));
    const full = groupErrorCode(axiosErrorWith(409, { code: 'ROOM_FULL', message: '' }));
    expect(already).not.toBe(full);
  });

  test('바디에 code가 없으면 null', () => {
    expect(groupErrorCode(axiosErrorWith(500, { message: 'oops' }))).toBeNull();
  });

  test('응답 자체가 없으면(네트워크 오류) null', () => {
    expect(groupErrorCode(new AxiosError('Network Error'))).toBeNull();
  });

  test('axios 에러가 아니면 null', () => {
    expect(groupErrorCode(new Error('boom'))).toBeNull();
    expect(groupErrorCode(null)).toBeNull();
  });
});

// 409 RESULT_CLAIM_HELD의 상대 지연(계약 §4) — 절대 시각은 계약이 금지한다.
describe('groupErrorRetryAfterMs', () => {
  test('409 바디의 retryAfterMs를 그대로 돌려준다', () => {
    const e = axiosErrorWith(409, { code: 'RESULT_CLAIM_HELD', retryAfterMs: 45_000 });
    expect(groupErrorRetryAfterMs(e)).toBe(45_000);
  });

  test('값이 없거나 수가 아니거나 음수면 null — "말하지 않았다"와 "0ms 뒤"를 뭉개지 않는다', () => {
    expect(
      groupErrorRetryAfterMs(axiosErrorWith(409, { code: 'RESULT_ALREADY_ACKED' })),
    ).toBeNull();
    expect(groupErrorRetryAfterMs(axiosErrorWith(409, { retryAfterMs: '3000' }))).toBeNull();
    expect(groupErrorRetryAfterMs(axiosErrorWith(409, { retryAfterMs: -1 }))).toBeNull();
    expect(groupErrorRetryAfterMs(new Error('boom'))).toBeNull();
    expect(groupErrorRetryAfterMs(axiosErrorWith(409, { retryAfterMs: 0 }))).toBe(0);
  });
});
