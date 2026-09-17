// 챌린지 결과 후보 선정 + 1회 가드 단위 테스트 — 정본 IA §4.3·§8 (GROMO-1279 · N53).
// 화면 테스트(GroupRoomScreen.test)가 배선을 잠그고, 여기서는 순수 계산과 가드 저장 규칙을 잠근다.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AxiosError, AxiosHeaders } from 'axios';
import {
  ackChallengeResult,
  claimChallengeResult,
  filterUnseenChallengeResults,
  markChallengeResultSeen,
  pendingAckChallengeResults,
  pickChallengeResults,
  reconcileChallengeResultAck,
  type ChallengeResultCandidate,
} from './challengeResult';
import { api, getFreshAccessToken, getUserIdFromToken } from '@/services/api';
import type { MyChallengeResultEntry } from '@/types/dto/group';

// claim·ack은 groupApi의 실제 래퍼를 그대로 통과시킨다 — 시임(groupApi)을 통째로 목으로 덮으면
// 경로·바디·409 판정이 한꺼번에 가려진다. axios 인스턴스만 목으로 두고 그 위는 진짜를 돌린다.
jest.mock('@/services/api', () => ({
  api: { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() },
  getFreshAccessToken: jest.fn(),
  getUserIdFromToken: jest.fn(),
  getAuthSessionGeneration: jest.fn(() => 1),
}));
// 파이어베이스 네이티브 모듈이 jest에 없다 — groupApi가 import만 해도 터진다(D5: 계측 자체는 무관).
jest.mock('@/services/analyticsEvents', () => ({
  logGroupChallengeDeleted: jest.fn(),
  logGroupChallengeSettled: jest.fn(),
}));

const mockApi = api as unknown as { post: jest.Mock };
const mockGetFreshAccessToken = getFreshAccessToken as jest.MockedFunction<
  typeof getFreshAccessToken
>;
const mockGetUserIdFromToken = getUserIdFromToken as jest.MockedFunction<typeof getUserIdFromToken>;

// claim·ack은 전송 직전에 계정을 고정한다(PR #672 P1) — 검증한 토큰을 직접 싣고 재발급
// 재시도를 끈다. 요청 config 가 통째로 계약이라 경로·바디와 함께 잠근다.
const PINNED = { headers: { Authorization: 'Bearer token-me' }, _noAuthRetry: true };

// 서버 GlobalExceptionHandler의 { code, retryAfterMs } 바디를 실은 axios 에러.
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

// 60일 프룬 컷오프가 실제 시계를 타면 픽스처 날짜가 미래/과거로 흔들린다 — 고정한다.
// 마커 값(sessionDate)이 KST 축이라 컷오프도 KST 축(kstDateStr)이다.
jest.useFakeTimers().setSystemTime(new Date(2026, 7, 1, 14, 30, 0)); // 2026-08-01 (러너 TZ = KST)

const USER_ID = 'me';

function entry(over: Partial<MyChallengeResultEntry> = {}): MyChallengeResultEntry {
  return {
    sessionId: 's1',
    groupId: 'g1',
    groupName: '아침 6시 집중방',
    challengeId: 'c1',
    challengeDeleted: false,
    challengeEnded: false,
    sessionDate: '2026-07-31',
    stake: 30,
    pot: 90,
    status: 'SETTLED',
    voidReason: null,
    goalMinutes: 60,
    myAchieved: true,
    myPayout: 45,
    results: [
      { userId: 'me', nickname: '나', achieved: true, payout: 45, progressMinutes: 70 },
      { userId: 'u2', nickname: '수빈', achieved: false, payout: 0, progressMinutes: 20 },
    ],
    ...over,
  };
}

// markChallengeResultSeen은 fire-and-forget이라 내부 비동기 완료를 기다릴 고리가 없다 —
// 페이크 타이머 밑에서 마이크로태스크를 굴려 setItem·정리까지 끝낸 뒤 검증한다.
// 가드 쓰기는 setItem → getAllKeys → multiGet → multiRemove의 await 사슬이다 — 사슬 길이보다
// 넉넉히 마이크로태스크를 굴린다(페이크 타이머라 setTimeout 기반 대기는 쓸 수 없다).
async function flushAsync() {
  for (let i = 0; i < 12; i += 1) {
    await Promise.resolve();
  }
}

describe('pickChallengeResults — /me/challenge-results → 후보', () => {
  test('정산 완료 회차를 후보로 만든다(명단 3상 분리 + 손익 동반)', () => {
    const out = pickChallengeResults([
      entry({
        results: [
          { userId: 'me', nickname: '나', achieved: true, payout: 45, progressMinutes: 70 },
          { userId: 'u2', nickname: '수빈', achieved: false, payout: 0, progressMinutes: 20 },
          { userId: 'u3', nickname: '민지', achieved: null, payout: null, progressMinutes: null },
        ],
      }),
    ]);

    expect(out).toHaveLength(1);
    // 명단은 이름만이 아니라 판정 근거(기록 분)·정산 금액을 함께 들고 온다(GROMO-1191·1279).
    // 미집계·미판정은 0으로 뭉개지 않고 null 그대로 — 모달이 '—'로 비울 수 있어야 한다.
    expect(out[0]).toMatchObject({
      sessionId: 's1',
      challengeId: 'c1',
      groupName: '아침 6시 집중방',
      date: '2026-07-31',
      status: 'SETTLED',
      stake: 30,
      pot: 90,
      goalMinutes: 60,
      achievers: [{ userId: 'me', nickname: '나', progressMinutes: 70, payout: 45 }],
      failed: [{ userId: 'u2', nickname: '수빈', progressMinutes: 20, payout: 0 }],
      pending: [{ userId: 'u3', nickname: '민지', progressMinutes: null, payout: null }],
      myAchieved: true,
      myPayout: 45,
      memberCount: 3,
    });
  });

  test('무산·환불·몰수도 결과다 — SETTLED가 아니어도 후보가 된다(IA §4.3)', () => {
    const out = pickChallengeResults([
      entry({ sessionId: 's-f', status: 'FORFEITED' }),
      entry({ sessionId: 's-v', status: 'VOIDED', voidReason: 'SHORT_PARTICIPANTS' }),
      entry({ sessionId: 's-r', status: 'REFUNDED' }),
    ]);
    expect(out.map((c) => c.sessionId)).toEqual(['s-f', 's-v', 's-r']);
  });

  // 삭제 환불은 BET_VOID_REFUND 푸시가 알린다(N48) — 모달까지 띄우면 같은 사건 이중 통지.
  // 서버가 이미 거르지만(FR-44-4) 방어적으로 다시 거른다.
  test('삭제된 챌린지의 회차는 후보가 되지 않는다(N48 — 푸시와 이중 통지 금지)', () => {
    const out = pickChallengeResults([
      entry({ sessionId: 's-del', challengeDeleted: true }),
      entry({ sessionId: 's-void-del', status: 'VOIDED', voidReason: 'CHALLENGE_DELETED' }),
      entry({ sessionId: 's-ok' }),
    ]);
    expect(out.map((c) => c.sessionId)).toEqual(['s-ok']);
  });

  test('결말이 아닌 상태(OPEN·UNUSED·미지의 값)는 방어적으로 버린다', () => {
    const out = pickChallengeResults([
      entry({ sessionId: 's-open', status: 'OPEN' }),
      entry({ sessionId: 's-unused', status: 'UNUSED' }),
      entry({ sessionId: 's-new', status: 'SOMETHING_NEW' as MyChallengeResultEntry['status'] }),
    ]);
    expect(out).toHaveLength(0);
  });

  test('명단이 비어 있으면 후보가 없다(렌더할 것이 없다)', () => {
    expect(pickChallengeResults([entry({ results: [] })])).toHaveLength(0);
  });

  test('ENDED 챌린지의 회차도 실린다(N38→N53 — 종료가 결과를 지우지 않는다)', () => {
    expect(pickChallengeResults([entry({ challengeEnded: true })])).toHaveLength(1);
  });

  // 미션 스냅샷(GROMO-1583) — 모달의 FOCUS 창 관용치 고지가 이 4필드로 조건을 세운다.
  // 여기서 떨어지면 모달은 스냅샷을 영영 못 받고 고지 조건이 서지 않는다(PR #566이 만든 갭).
  test('미션 스냅샷 4필드를 후보로 옮긴다', () => {
    const [out] = pickChallengeResults([
      entry({
        missionCategory: 'FOCUS',
        missionType: 'TIME_WINDOW',
        windowStart: '06:00',
        windowEnd: '08:00',
      }),
    ]);
    expect(out).toMatchObject({
      missionCategory: 'FOCUS',
      missionType: 'TIME_WINDOW',
      windowStart: '06:00',
      windowEnd: '08:00',
    });
  });

  // 나중에 붙은 additive 필드라 구서버 응답엔 통째로 없다(undefined) — 창형이 아닌 회차의
  // null과 같은 '모른다'로 접어, 소비자가 두 가지 없음을 구분하지 않게 한다.
  test('미션 스냅샷이 없는 구서버 응답은 null로 접는다', () => {
    const [out] = pickChallengeResults([entry()]);
    expect(out).toMatchObject({
      missionCategory: null,
      missionType: null,
      windowStart: null,
      windowEnd: null,
    });
  });

  // 서버 확인 표시(N58)는 후보에 **실어만** 두고 여기서 거르지 않는다 — 로컬 마커와 합치는
  // 자리는 filterUnseenChallengeResults 한 곳이다(두 군데서 거르면 D1의 null 계약이 갈린다).
  test('acknowledged를 후보로 옮긴다 — 없는 응답(구서버)은 false로 접는다', () => {
    expect(pickChallengeResults([entry({ acknowledged: true })])[0].acknowledged).toBe(true);
    expect(pickChallengeResults([entry()])[0].acknowledged).toBe(false);
  });

  test('sessionDate 내림차순 정렬 — 최근 것부터, 동률은 서버 순서 유지', () => {
    const out = pickChallengeResults([
      entry({ sessionId: 's-old', sessionDate: '2026-07-29' }),
      entry({ sessionId: 's-new', sessionDate: '2026-07-31' }),
      entry({ sessionId: 's-new2', sessionDate: '2026-07-31' }),
    ]);
    expect(out.map((c) => c.sessionId)).toEqual(['s-new', 's-new2', 's-old']);
  });
});

describe('1회 노출 가드 — 계정 스코프 세션 마커(IA §8)', () => {
  const candidate = (sessionId: string, date = '2026-07-31'): ChallengeResultCandidate =>
    pickChallengeResults([entry({ sessionId, sessionDate: date })])[0];

  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  test('기록한 세션만 걸러진다', async () => {
    markChallengeResultSeen(USER_ID, 's1', '2026-07-31');
    await flushAsync();

    const out = await filterUnseenChallengeResults(USER_ID, [
      candidate('s1'), // 본 것
      candidate('s2'), // 다른 회차 — 새 결과
    ]);
    expect(out?.map((c) => c.sessionId)).toEqual(['s2']);
  });

  test('가드 키는 계정 스코프다 — 다른 계정이 본 기록으로 내 결과를 거르지 않는다', async () => {
    markChallengeResultSeen('other-user', 's1', '2026-07-31');
    await flushAsync();

    const out = await filterUnseenChallengeResults(USER_ID, [candidate('s1')]);
    expect(out).toHaveLength(1);
  });

  test('60일 지난 마커는 기록 시점에 정리된다 — 경계 안쪽은 남는다', async () => {
    // 2026-08-01 기준 컷오프는 2026-06-02 — 그보다 오래된 마커만 지워진다.
    await AsyncStorage.setItem(`gromo:sessionResult:${USER_ID}:s-old`, '2026-05-30');
    await AsyncStorage.setItem(`gromo:sessionResult:${USER_ID}:s-keep`, '2026-07-01');
    markChallengeResultSeen(USER_ID, 's1', '2026-07-31');
    await flushAsync();

    expect(await AsyncStorage.getItem(`gromo:sessionResult:${USER_ID}:s-old`)).toBeNull();
    expect(await AsyncStorage.getItem(`gromo:sessionResult:${USER_ID}:s-keep`)).toBe('2026-07-01');
    expect(await AsyncStorage.getItem(`gromo:sessionResult:${USER_ID}:s1`)).toBe('2026-07-31');
  });

  test('구 형식 마커(gromo:challengeResult:*)는 날짜와 무관하게 정리된다', async () => {
    await AsyncStorage.setItem('gromo:challengeResult:c9:2026-07-31', '1');
    markChallengeResultSeen(USER_ID, 's1', '2026-07-31');
    await flushAsync();

    expect(await AsyncStorage.getItem('gromo:challengeResult:c9:2026-07-31')).toBeNull();
  });

  // 읽기 실패는 '아무것도 노출하지 않는다'로 끝나야 하지만, **'볼 것이 없다'와 같은 값이면
  // 안 된다**(codex 후속 리뷰 P2). 같은 값으로 뭉개면 탈퇴자 화면이 "결과 0건"으로 읽고 즉시
  // 방을 내려(onLeft) 다른 소속 그룹이 없는 사용자는 그 정산 결과를 영영 못 본다.
  test('가드를 못 읽으면 null — 노출은 하지 않되 "없다"로 확정하지 않는다', async () => {
    // spyOn + mockRestore 금지 — 공식 mock의 메서드는 이미 jest.fn 이라 복원하면 구현이 사라져
    // 이후 테스트의 multiGet이 undefined를 돌려준다. 1회 오버라이드만 얹는다.
    (AsyncStorage.multiGet as jest.Mock).mockRejectedValueOnce(new Error('storage'));
    const out = await filterUnseenChallengeResults(USER_ID, [candidate('s1')]);
    expect(out).toBeNull();
  });

  test('후보가 실제로 없으면 빈 배열 — null(판정 불가)과 구분된다', async () => {
    expect(await filterUnseenChallengeResults(USER_ID, [])).toEqual([]);

    await AsyncStorage.setItem(`gromo:sessionResult:${USER_ID}:s1`, '2026-07-31');
    expect(await filterUnseenChallengeResults(USER_ID, [candidate('s1')])).toEqual([]);
  });
});

// 서버 확인 표시(1차) + 로컬 마커(보완재)를 filterUnseenChallengeResults 한 자리에서 합친다.
// 로컬 마커만으로는 **기기 축**을 못 막는다(폰에서 본 결과가 태블릿에서 또 뜬다).
describe('서버 확인 표시 × 로컬 마커 — 중복 노출 필터 합류(GROMO-1577 · N58)', () => {
  const candidate = (
    sessionId: string,
    over: Partial<ChallengeResultCandidate> = {},
  ): ChallengeResultCandidate => ({
    ...pickChallengeResults([entry({ sessionId })])[0],
    ...over,
  });

  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  // ── ack 실패 뒤 재시작 — 로컬 마커에 가려 영영 미확인으로 남는 것을 막는다 ──
  // ⚠️ ackChallengeResult가 false를 돌려줘도 그 재시도는 **세션 안에서만** 산다. 노출 직후 ack가
  // 네트워크로 실패하고 앱이 재시작되면, 로컬 마커가 그 회차를 후보에서 걸러 **재시도 기회 자체가
  // 사라진다.** 서버는 영영 acknowledged=false로 남아 다른 기기·재설치에서 같은 결과가 다시 뜨고
  // 대기 중인 결과 푸시도 안 닫힌다(IA §4.3 — 재노출 없이 ack만 재시도).
  test('로컬로는 봤는데 서버가 미확인이면 ack 재시도 대상이다', async () => {
    await AsyncStorage.setItem(`gromo:sessionResult:${USER_ID}:s1`, '2026-07-31');
    const targets = await pendingAckChallengeResults(USER_ID, [
      candidate('s1', { acknowledged: false }),
      candidate('s2', { acknowledged: false }),
    ]);
    expect(targets.map((c) => c.sessionId)).toEqual(['s1']);
  });

  test('서버가 이미 확인했으면 재시도 대상이 아니다', async () => {
    await AsyncStorage.setItem(`gromo:sessionResult:${USER_ID}:s1`, '2026-07-31');
    const targets = await pendingAckChallengeResults(USER_ID, [
      candidate('s1', { acknowledged: true }),
    ]);
    expect(targets).toEqual([]);
  });

  test('아직 안 본 회차는 재시도 대상이 아니다 — 그건 노출 경로가 처리한다', async () => {
    const targets = await pendingAckChallengeResults(USER_ID, [
      candidate('s1', { acknowledged: false }),
    ]);
    expect(targets).toEqual([]);
  });

  test('acknowledged=true 인 결과는 후보에서 걸러진다 — 다른 기기에서 이미 봤다', async () => {
    const out = await filterUnseenChallengeResults(USER_ID, [
      candidate('s-acked', { acknowledged: true }),
      candidate('s-new'),
    ]);
    expect(out?.map((c) => c.sessionId)).toEqual(['s-new']);
  });

  // 서버가 "이미 봤다"고 말한 것은 저장소를 못 읽어도 **확정된 사실**이다. 가드 읽기 뒤에
  // 걸렀다면 이 사실이 실패에 함께 묻혀 null(모르겠다)로 강등된다 — 탈퇴자 화면이 이탈을
  // 미루고 오류를 띄우는 값이라, 실제로 볼 것이 없을 땐 null이 아니라 []여야 한다.
  test('서버가 확인한 회차는 가드를 못 읽어도 걸러진다 — 저장소를 아예 읽지 않는다', async () => {
    (AsyncStorage.multiGet as jest.Mock).mockRejectedValueOnce(new Error('storage'));
    const out = await filterUnseenChallengeResults(USER_ID, [
      candidate('s-acked', { acknowledged: true }),
    ]);
    expect(out).toEqual([]);
  });

  // 로컬 마커는 삭제가 아니라 **강등**이다 — ack가 못 나간 창(네트워크 실패)에서 같은 기기의
  // 재노출을 막는 것은 여전히 이 마커뿐이다.
  test('서버 표시가 없어도 로컬 마커가 받는다 — 둘 다 걸러지고 새 결과만 남는다', async () => {
    markChallengeResultSeen(USER_ID, 's-seen', '2026-07-31');
    await flushAsync();

    const out = await filterUnseenChallengeResults(USER_ID, [
      candidate('s-acked', { acknowledged: true }), // 서버 축(다른 기기)
      candidate('s-seen'), // 로컬 축(이 기기 · ack 실패 창)
      candidate('s-new'),
    ]);
    expect(out?.map((c) => c.sessionId)).toEqual(['s-new']);
  });
});

// 노출 선점(claim) · 확인(ack) — 계약 §3의 두 함수. 순서는 D8(선점 → 노출 → ack).
describe('claimChallengeResult · ackChallengeResult (GROMO-1577)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetFreshAccessToken.mockResolvedValue('token-me');
    mockGetUserIdFromToken.mockReturnValue(USER_ID);
  });

  test('선점 성공 — 서버 claimToken을 그대로 돌려준다', async () => {
    mockApi.post.mockResolvedValue({ data: { claimToken: 'ct-1' } });
    await expect(claimChallengeResult('s1')).resolves.toEqual({ ok: true, claimToken: 'ct-1' });
    expect(mockApi.post).toHaveBeenCalledWith('/api/v1/me/challenge-results/s1/claim', {}, PINNED);
  });

  // ⚠️ 인터셉터가 붙이는 것은 **전송 시점**의 저장 토큰이다 — 조회 뒤 계정이 바뀌면 새 계정
  // 토큰으로 나간다. 두 계정이 같은 회차에 참가했다면(가능하다 — 로컬 마커를 계정 스코프로
  // 둔 이유가 그것이다) 새 계정의 결과를 선점하거나, 이전 계정 모달을 띄운 것만으로 새 계정이
  // 못 본 결과를 확인 처리해 **영구히 누락**시킨다.
  test('claim·ack은 검증한 토큰을 직접 싣고 재발급 재시도를 끈다', async () => {
    mockApi.post.mockResolvedValue({ data: { claimToken: 'ct-1' } });
    await claimChallengeResult('s1');
    await ackChallengeResult('s1', 'ct-1');
    expect(mockApi.post).toHaveBeenNthCalledWith(
      1,
      '/api/v1/me/challenge-results/s1/claim',
      {},
      PINNED,
    );
    expect(mockApi.post).toHaveBeenNthCalledWith(
      2,
      '/api/v1/me/challenge-results/s1/ack',
      { claimToken: 'ct-1' },
      PINNED,
    );
  });

  test('세션을 못 읽으면 아예 보내지 않는다 — 토큰 없이 나가지 않는다', async () => {
    mockGetFreshAccessToken.mockResolvedValue(null);
    mockGetUserIdFromToken.mockReturnValue(null);
    await expect(claimChallengeResult('s1')).resolves.toEqual({ ok: false, retryAfterMs: null });
    expect(await ackChallengeResult('s1', 'ct-1')).toBe(false);
    expect(mockApi.post).not.toHaveBeenCalled();
  });

  // ⚠️ 선점 실패는 사고가 아니라 정상 흐름이다 — 예외로 던지면 호출부(오버레이 호스트)가
  // 노출 경로에서 통째로 튕겨 다른 기기가 쥐고 있는 동안 큐가 멈춘다.
  test('409는 예외가 아니라 판정이다 — { ok:false, retryAfterMs }로 돌아온다', async () => {
    mockApi.post.mockRejectedValue(
      axiosErrorWith(409, { code: 'RESULT_CLAIM_HELD', retryAfterMs: 45_000 }),
    );
    await expect(claimChallengeResult('s1')).resolves.toEqual({ ok: false, retryAfterMs: 45_000 });
  });

  test('이미 확인된 결과·네트워크 실패도 같은 실패 값 — 지연을 지어내지 않는다(null)', async () => {
    // 이 둘은 사유 없이 접어도 된다: ALREADY_ACKED 는 다음 재조회에서 후보가 사라져 저절로
    // 해소되고, 네트워크 실패는 그냥 다시 시도하면 되는 것이다.
    mockApi.post.mockRejectedValueOnce(axiosErrorWith(409, { code: 'RESULT_ALREADY_ACKED' }));
    await expect(claimChallengeResult('s1')).resolves.toEqual({ ok: false, retryAfterMs: null });

    mockApi.post.mockRejectedValueOnce(new Error('network'));
    await expect(claimChallengeResult('s1')).resolves.toEqual({ ok: false, retryAfterMs: null });
  });

  // ⚠️ 정산 전 회차는 **애초에 후보가 되면 안 되는 것**이라(결과 4종만 큐에 실린다) 나오면 그
  // 자체가 앱 버그 신호다. 재조회해도 같은 후보가 같은 답을 받아 헛돈다 — 사유 없이
  // { ok:false, retryAfterMs:null }로만 접으면 **가장 흔한 실패(네트워크)와 같은 값**이 되어
  // 그 신호가 사라진다. 호출부가 후보에서 제외할 수 있도록 사유를 실어 올린다.
  test('RESULT_NOT_SETTLED 는 재시도 값으로 접히지 않는다 — 사유를 실어 올린다', async () => {
    mockApi.post.mockRejectedValueOnce(axiosErrorWith(409, { code: 'RESULT_NOT_SETTLED' }));
    await expect(claimChallengeResult('s1')).resolves.toEqual({
      ok: false,
      retryAfterMs: null,
      reason: 'NOT_SETTLED',
    });

    // 사유가 붙는 것은 이 코드뿐이다 — 네트워크 실패까지 '후보 제외'로 읽히면 안 된다.
    mockApi.post.mockRejectedValueOnce(new Error('network'));
    const other = await claimChallengeResult('s1');
    expect(other.ok).toBe(false);
    expect(other).not.toHaveProperty('reason');
  });

  test('보정은 노출 없이 claim → ack 만 한다', async () => {
    mockApi.post.mockResolvedValue({ data: { claimToken: 'ct-1' } });
    expect(await reconcileChallengeResultAck('s1')).toBe(true);
    expect(mockApi.post).toHaveBeenNthCalledWith(
      1,
      '/api/v1/me/challenge-results/s1/claim',
      {},
      PINNED,
    );
    expect(mockApi.post).toHaveBeenNthCalledWith(
      2,
      '/api/v1/me/challenge-results/s1/ack',
      { claimToken: 'ct-1' },
      PINNED,
    );
  });

  test('보정 중 선점에 실패하면 조용히 넘어간다 — ack를 부르지 않는다', async () => {
    mockApi.post.mockRejectedValue(axiosErrorWith(409, { code: 'RESULT_CLAIM_HELD' }));
    expect(await reconcileChallengeResultAck('s1')).toBe(false);
    expect(mockApi.post).toHaveBeenCalledTimes(1);
  });

  // ── 렌더 직전 재검증 (D8 세 번째 단계 · 계약 §4 개정 N53) ──
  // ⚠️ 이 인자가 없으면 구멍이 열린다: A가 선점 → 백그라운드 → lease 만료 → B가 재선점 → A 복귀.
  // A가 최초 성공 응답만 믿고 띄우면 **두 기기가 모두 모달을 본다.**
  test('토큰 없이 부르면 최초 획득 — 빈 바디를 보낸다', async () => {
    mockApi.post.mockResolvedValue({ data: { claimToken: 'ct-1' } });
    await claimChallengeResult('s1');
    expect(mockApi.post).toHaveBeenCalledWith('/api/v1/me/challenge-results/s1/claim', {}, PINNED);
  });

  test('토큰을 실으면 재검증 — 바디에 claimToken이 실린다', async () => {
    mockApi.post.mockResolvedValue({ data: { claimToken: 'ct-1' } });
    await claimChallengeResult('s1', 'ct-1');
    expect(mockApi.post).toHaveBeenCalledWith(
      '/api/v1/me/challenge-results/s1/claim',
      { claimToken: 'ct-1' },
      PINNED,
    );
  });

  test('재검증이 막히면 노출로 가지 않는다 — lease를 잃은 기기가 낡은 토큰으로 띄우지 못한다', async () => {
    mockApi.post.mockRejectedValue(
      axiosErrorWith(409, { code: 'RESULT_CLAIM_HELD', retryAfterMs: 30_000 }),
    );
    await expect(claimChallengeResult('s1', 'ct-stale')).resolves.toEqual({
      ok: false,
      retryAfterMs: 30_000,
    });
  });

  test('토큰 없는 200은 선점 실패로 접는다 — 빈 토큰의 ack는 반드시 STALE로 튕긴다', async () => {
    mockApi.post.mockResolvedValue({ data: { claimToken: '' } });
    await expect(claimChallengeResult('s1')).resolves.toEqual({ ok: false, retryAfterMs: null });
  });

  test('ack는 claimToken을 바디로 보낸다', async () => {
    mockApi.post.mockResolvedValue({ data: undefined });
    await ackChallengeResult('s1', 'ct-1');
    expect(mockApi.post).toHaveBeenCalledWith(
      '/api/v1/me/challenge-results/s1/ack',
      { claimToken: 'ct-1' },
      PINNED,
    );
  });

  // ⚠️ ack 실패를 던지면 호출부가 '노출 실패'로 읽어 같은 결과를 다시 띄운다 — 사용자는 방금
  // 본 결과를 또 본다. ack 실패는 재노출이 아니라 ack 재시도로만 메우는 창이다(IA §4.3).
  test('ack는 실패해도 throw하지 않는다 — 재노출로 번지지 않는다', async () => {
    mockApi.post.mockRejectedValue(new Error('network'));
    await expect(ackChallengeResult('s1', 'ct-1')).resolves.toBe(false);
  });

  // ⚠️ 그렇다고 실패를 삼켜 void로 두면 **재시도할 방법이 사라진다.** 로컬 마커는 이미 기록됐고
  // 그 회차는 큐에서 빠지므로 서버는 영영 미확인으로 남는다 — 다른 기기·재설치에서 그대로 다시
  // 뜨고 대기 중인 결과 푸시도 안 닫힌다. 재노출은 막되 ack만 재시도할 수 있어야 한다(IA §4.3).
  test('ack 실패는 false로 알린다 — 호출부가 ack만 재시도할 수 있다', async () => {
    mockApi.post.mockRejectedValue(new Error('network'));
    expect(await ackChallengeResult('s1', 'ct-1')).toBe(false);

    mockApi.post.mockRejectedValue(axiosErrorWith(500, {}));
    expect(await ackChallengeResult('s1', 'ct-1')).toBe(false);
  });

  // ⚠️ 종전 판단을 뒤집은 자리다(PR #672 리뷰 P2). STALE은 "내 토큰이 현재 claim과 다르다"일
  // 뿐 **상대가 ack 했다는 뜻이 아니다** — 앱이 잠깐 멈추거나 lease(2분)가 만료돼 다른 기기가
  // 재선점만 해도 온다. 성공으로 접으면 호출부가 재시도를 끝내는데 acknowledged_at은 여전히
  // 비어 있어, 같은 결과가 다른 기기에서 다시 뜨고 이미 본 결과의 푸시도 뒤늦게 도착한다.
  // 무한 재시도는 서버 계약이 끝낸다 — 상대가 실제로 ack 하면 그 회차가 다음 조회 응답에서
  // 빠져(서버는 미확인만 준다) 재시도 대상 자체가 사라진다. 아래 보정 테스트가 그 경로다.
  test('RESULT_CLAIM_STALE은 성공으로 접지 않는다 — 재시도가 계속 가능해야 한다', async () => {
    mockApi.post.mockRejectedValue(axiosErrorWith(409, { code: 'RESULT_CLAIM_STALE' }));
    expect(await ackChallengeResult('s1', 'ct-1')).toBe(false);
  });

  // 낡은 토큰으로는 영영 ack가 안 되지만, 보정은 **새 claim을 받아** ack 한다 — 낡은 토큰
  // 문제 자체가 사라진다. STALE을 실패로 알리는 것이 헛돌지 않는 이유가 이 경로다.
  test('STALE 뒤 보정은 새 claim을 받아 ack 한다 — 낡은 토큰을 다시 쓰지 않는다', async () => {
    mockApi.post.mockRejectedValueOnce(axiosErrorWith(409, { code: 'RESULT_CLAIM_STALE' }));
    expect(await ackChallengeResult('s1', 'ct-old')).toBe(false);

    mockApi.post.mockReset();
    mockApi.post.mockResolvedValue({ data: { claimToken: 'ct-new' } });
    expect(await reconcileChallengeResultAck('s1')).toBe(true);
    expect(mockApi.post).toHaveBeenNthCalledWith(
      2,
      '/api/v1/me/challenge-results/s1/ack',
      { claimToken: 'ct-new' },
      PINNED,
    );
  });

  test('ack 성공은 true다', async () => {
    mockApi.post.mockResolvedValue({ data: undefined });
    expect(await ackChallengeResult('s1', 'ct-1')).toBe(true);
  });
});
