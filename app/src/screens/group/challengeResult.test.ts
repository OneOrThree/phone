// 챌린지 결과 후보 선정 + 1회 가드 단위 테스트 — 정본 IA §4.3·§8 (GROMO-1279 · N53).
// 화면 테스트(GroupRoomScreen.test)가 배선을 잠그고, 여기서는 순수 계산과 가드 저장 규칙을 잠근다.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AxiosError, AxiosHeaders } from 'axios';
import {
  ackChallengeResult,
  claimChallengeResult,
  filterUnseenChallengeResults,
  markChallengeResultSeen,
  pickChallengeResults,
  type ChallengeResultCandidate,
} from './challengeResult';
import { api } from '@/services/api';
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
  });

  test('선점 성공 — 서버 claimToken을 그대로 돌려준다', async () => {
    mockApi.post.mockResolvedValue({ data: { claimToken: 'ct-1' } });
    await expect(claimChallengeResult('s1')).resolves.toEqual({ ok: true, claimToken: 'ct-1' });
    expect(mockApi.post).toHaveBeenCalledWith('/api/v1/me/challenge-results/s1/claim', {});
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
    mockApi.post.mockRejectedValueOnce(axiosErrorWith(409, { code: 'RESULT_ALREADY_ACKED' }));
    await expect(claimChallengeResult('s1')).resolves.toEqual({ ok: false, retryAfterMs: null });

    mockApi.post.mockRejectedValueOnce(new Error('network'));
    await expect(claimChallengeResult('s1')).resolves.toEqual({ ok: false, retryAfterMs: null });
  });

  test('토큰 없는 200은 선점 실패로 접는다 — 빈 토큰의 ack는 반드시 STALE로 튕긴다', async () => {
    mockApi.post.mockResolvedValue({ data: { claimToken: '' } });
    await expect(claimChallengeResult('s1')).resolves.toEqual({ ok: false, retryAfterMs: null });
  });

  test('ack는 claimToken을 바디로 보낸다', async () => {
    mockApi.post.mockResolvedValue({ data: undefined });
    await ackChallengeResult('s1', 'ct-1');
    expect(mockApi.post).toHaveBeenCalledWith('/api/v1/me/challenge-results/s1/ack', {
      claimToken: 'ct-1',
    });
  });

  // ⚠️ ack 실패를 던지면 호출부가 '노출 실패'로 읽어 같은 결과를 다시 띄운다 — 사용자는 방금
  // 본 결과를 또 본다. ack 실패는 재노출이 아니라 ack 재시도로만 메우는 창이다(IA §4.3).
  test('ack는 실패해도 throw하지 않는다 — 재노출로 번지지 않는다', async () => {
    mockApi.post.mockRejectedValue(axiosErrorWith(409, { code: 'RESULT_CLAIM_STALE' }));
    await expect(ackChallengeResult('s1', 'ct-1')).resolves.toBeUndefined();

    mockApi.post.mockRejectedValue(new Error('network'));
    await expect(ackChallengeResult('s1', 'ct-1')).resolves.toBeUndefined();
  });
});
