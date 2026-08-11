// navigateToDeepLink 유닛 테스트 — 명세 docs/app/group-plan.md §6-6·§11 + 초대 링크 스펙 §7-3.
// 파서(inviteLink.ts) 단독 테스트만으론 부족했다: 파서가 받아주는 슬래시 변형을 라우터가
// 경로 문자열로 다시 잘라 버리면 join 분기에 닿지 못해 "지원한다"던 링크가 조용히 죽는다.
// 여기서는 링크 → (탭 이동 + 초대 버퍼 + 6a 이벤트) 까지의 실제 배선을 잠근다.
import {
  clearPendingInvite,
  flushPendingDeepLink,
  navigateToDeepLink,
  navigationRef,
  notifyGroupInvite,
  peekPendingInvite,
  setGroupInviteListener,
} from './navigationRef';
import { logInviteLinkOpened } from '@/services/analyticsEvents';
import {
  clearPendingDirectGroupEntry,
  clearPendingGroupEntry,
  discardInitialGroupRoomReturn,
  markInitialGroupRoomReturn,
  queueDirectGroupEntry,
} from '@/navigation/groupEntrySource';

jest.mock('@/services/analyticsEvents', () => ({ logInviteLinkOpened: jest.fn() }));
jest.mock('@/navigation/groupEntrySource', () => ({
  clearPendingDirectGroupEntry: jest.fn(),
  clearPendingGroupEntry: jest.fn(),
  discardInitialGroupRoomReturn: jest.fn(),
  markInitialGroupRoomReturn: jest.fn(),
  queueDirectGroupEntry: jest.fn(),
}));

// 환불 푸시(refund=1)가 태우는 잔액 재조회 신호 — 실제 조회는 CoinProvider가 한다.
jest.mock('@/store/coinRefreshSignal', () => ({ requestCoinRefresh: jest.fn() }));
const mockRequestCoinRefresh = jest.requireMock('@/store/coinRefreshSignal')
  .requestCoinRefresh as jest.Mock;

// 그룹 딥링크(창 종료 푸시)의 1개/2개+ 분기가 목록 조회에 매달린다 — 네트워크 없이 목으로 준다.
jest.mock('@/services/groupApi', () => ({ getMyGroups: jest.fn() }));
const mockGetMyGroups = jest.requireMock('@/services/groupApi').getMyGroups as jest.Mock;
const mockQueueDirectGroupEntry = queueDirectGroupEntry as jest.MockedFunction<
  typeof queueDirectGroupEntry
>;
const mockClearPendingDirectGroupEntry = clearPendingDirectGroupEntry as jest.MockedFunction<
  typeof clearPendingDirectGroupEntry
>;
const mockClearPendingGroupEntry = clearPendingGroupEntry as jest.MockedFunction<
  typeof clearPendingGroupEntry
>;
const mockMarkInitialGroupRoomReturn = markInitialGroupRoomReturn as jest.MockedFunction<
  typeof markInitialGroupRoomReturn
>;
const mockDiscardInitialGroupRoomReturn = discardInitialGroupRoomReturn as jest.MockedFunction<
  typeof discardInitialGroupRoomReturn
>;

// navigateToDeepLink의 group 분기는 목록 조회를 비동기로 기다린다 — 마이크로태스크를 비운다.
async function flushAsync() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

const GROUP_ID = '0197e0c3-4d1b-7a2e-9f60-3b7c1f2a8d55';
const SLUG = 'ab23cd45';
const UNKNOWN_ATTRIBUTION = {
  entrySource: 'unknown',
  interactionId: undefined,
  interactionAcceptedAt: undefined,
} as const;

const navigate = jest.spyOn(navigationRef, 'navigate');
const currentRoute = jest.spyOn(navigationRef, 'getCurrentRoute');
const inviteListener = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(navigationRef, 'isReady').mockReturnValue(true);
  // 지연 이동 가드가 읽는 현재 화면 — 기본은 '딥링크가 옮겨 둔 그룹 탭에 그대로 있다'.
  currentRoute.mockReturnValue({ key: '그룹-1', name: '그룹' });
  navigate.mockImplementation(() => {});
  clearPendingInvite();
  setGroupInviteListener(inviteListener);
});

afterEach(() => {
  setGroupInviteListener(null);
});

describe('초대 링크', () => {
  // 랜딩이 내보내는 정상형 + OS·인앱 브라우저가 정규화하며 만드는 변형들.
  test.each([
    ['구형 스킴', `gromo://join?g=${GROUP_ID}`, null],
    ['끝 슬래시', `gromo://join/?g=${GROUP_ID}`, null],
    ['세 슬래시 + slug', `gromo:///join?g=${GROUP_ID}&s=${SLUG}`, SLUG],
    ['Universal Link', `https://link.oneorthree.world/l/${SLUG}?g=${GROUP_ID}`, SLUG],
  ])('%s 링크는 그룹 탭으로 보내고 초대 버퍼에 담는다', (_label, link, slug) => {
    navigateToDeepLink(link);

    expect(navigate).toHaveBeenCalledWith('Main', { screen: '그룹' });
    expect(inviteListener).toHaveBeenCalledWith({ groupId: GROUP_ID, slug, entry: 'link' });
    // 버퍼는 읽어도 지워지지 않는다 — 게스트가 로그인해 앱 트리가 리마운트돼도 살아남아야 한다(§6-6).
    expect(peekPendingInvite()).toEqual({ groupId: GROUP_ID, slug, entry: 'link' });
  });

  // 6a invite_link_opened — via는 링크 형식으로 가른다(스펙 §4-3).
  test('UL은 via=universal_link, 스킴은 via=scheme로 6a 이벤트를 발행한다', () => {
    navigateToDeepLink(`https://link.oneorthree.world/l/${SLUG}?g=${GROUP_ID}`);
    expect(logInviteLinkOpened).toHaveBeenCalledWith({
      group_id: GROUP_ID,
      slug: SLUG,
      via: 'universal_link',
    });

    jest.clearAllMocks();
    navigateToDeepLink(`gromo://join?g=${GROUP_ID}`);
    expect(logInviteLinkOpened).toHaveBeenCalledWith({
      group_id: GROUP_ID,
      slug: undefined,
      via: 'scheme',
    });
  });

  test('형식이 깨진 초대 링크는 조용히 무시한다(이동·버퍼·이벤트 모두 없음)', () => {
    navigateToDeepLink('gromo://join?g=abc');
    navigateToDeepLink('gromo://join?g=%');
    navigateToDeepLink('gromo://join');

    expect(navigate).not.toHaveBeenCalled();
    expect(inviteListener).not.toHaveBeenCalled();
    expect(logInviteLinkOpened).not.toHaveBeenCalled();
    expect(peekPendingInvite()).toBeNull();
  });

  // deferred 매치(services/deferredInvite.ts)가 쓰는 진입 — 링크를 거치지 않고 버퍼에 직접 넣는다.
  // 6a는 '링크로 앱을 열었다'는 뜻이라 여기서는 발행하지 않는다(6b는 시트가 발행).
  test('notifyGroupInvite(deferred)는 버퍼·리스너만 태우고 6a는 발행하지 않는다', () => {
    notifyGroupInvite({ groupId: GROUP_ID, slug: SLUG, entry: 'deferred' });

    expect(inviteListener).toHaveBeenCalledWith({
      groupId: GROUP_ID,
      slug: SLUG,
      entry: 'deferred',
    });
    expect(peekPendingInvite()).toEqual({ groupId: GROUP_ID, slug: SLUG, entry: 'deferred' });
    expect(logInviteLinkOpened).not.toHaveBeenCalled();
  });

  test('다른 화면에서 온 invite만 다음 view episode source로 예약한다', () => {
    currentRoute.mockReturnValue({ key: '홈-1', name: '홈' });

    navigateToDeepLink(`gromo://join?g=${GROUP_ID}`);

    expect(mockQueueDirectGroupEntry).toHaveBeenCalledWith('invite');
  });

  test('이미 focus된 그룹 화면의 warm invite는 현재·다음 source를 건드리지 않는다', () => {
    currentRoute.mockReturnValue({ key: '그룹-1', name: '그룹' });

    navigateToDeepLink(`gromo://join?g=${GROUP_ID}`);

    expect(mockQueueDirectGroupEntry).not.toHaveBeenCalled();
  });
});

// 컨테이너 onReady에서 도는 flush — 준비 전 링크를 흘려보내는 일 외에,
// **네비게이터가 새로 만들어진 경우**(게스트→소셜 로그인으로 userId가 바뀌어 UserProvider가
// 리마운트) 살아남은 초대 버퍼를 그룹 탭으로 데려가는 일까지 한다. 새 탭 네비게이터는 홈부터
// 시작하고 그룹 탭은 포커스 전까지 마운트되지 않아, 그러지 않으면 초대장이 다시 열리지 않는다.
describe('컨테이너 준비(onReady)', () => {
  test('준비 전에 도착한 링크는 그대로 흘려보낸다', () => {
    jest.spyOn(navigationRef, 'isReady').mockReturnValue(false);
    navigateToDeepLink(`gromo://join?g=${GROUP_ID}&s=${SLUG}`);
    expect(navigate).not.toHaveBeenCalled();

    jest.spyOn(navigationRef, 'isReady').mockReturnValue(true);
    flushPendingDeepLink();

    expect(navigate).toHaveBeenCalledWith('Main', { screen: '그룹' });
    expect(peekPendingInvite()).toEqual({ groupId: GROUP_ID, slug: SLUG, entry: 'link' });
  });

  test('링크는 이미 소비됐고 초대 버퍼만 남았으면 그룹 탭으로 데려간다(네비게이터 재마운트)', () => {
    navigateToDeepLink(`gromo://join?g=${GROUP_ID}`); // 로그인 전 세션에서 수신·소비됨
    navigate.mockClear();

    flushPendingDeepLink(); // 로그인 후 새 컨테이너의 onReady

    expect(navigate).toHaveBeenCalledWith('Main', { screen: '그룹' });
    // 버퍼는 GroupScreen이 이어받을 때까지 남는다
    expect(peekPendingInvite()).toEqual({ groupId: GROUP_ID, slug: null, entry: 'link' });
  });

  test('보류된 링크·초대가 없으면 아무 데도 가지 않는다(일반 실행)', () => {
    flushPendingDeepLink();
    expect(navigate).not.toHaveBeenCalled();
  });
});

// 그룹 푸시 딥링크(gromo://group?g={groupId}[&challenge={challengeId}], 계약 §2) —
// GroupScreen의 목록 카드 탭과 같은 규칙: A-9 이후 소속 수와 무관하게 그룹방을 push 한다
// (그룹 탭의 기본 화면은 항상 목록이라, 1그룹이라고 탭 이동에서 멈추면 방에 못 들어간다).
describe('그룹 딥링크(챌린지 종료 푸시)', () => {
  const summary = (groupId: string) => ({ groupId }) as never;
  const CHALLENGE_ID = '0198aa11-2b3c-7d4e-8f50-6a7b8c9d0e1f';

  test('다른 화면에서 온 push만 다음 view episode source로 예약한다', async () => {
    currentRoute
      .mockReturnValueOnce({ key: '홈-1', name: '홈' })
      .mockReturnValue({ key: '그룹-1', name: '그룹' });
    mockGetMyGroups.mockResolvedValue([summary(GROUP_ID)]);

    navigateToDeepLink(`gromo://group?g=${GROUP_ID}`);
    await flushAsync();

    expect(mockQueueDirectGroupEntry).toHaveBeenCalledWith('push');
    expect(mockClearPendingDirectGroupEntry).toHaveBeenCalledTimes(1);
    expect(mockClearPendingGroupEntry).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenLastCalledWith('GroupRoom', {
      groupId: GROUP_ID,
      challengeId: undefined,
      ...UNKNOWN_ATTRIBUTION,
    });
  });

  test('이미 focus된 그룹 화면의 warm push는 다음 source를 만들지 않는다', async () => {
    mockGetMyGroups.mockResolvedValue([summary(GROUP_ID)]);

    navigateToDeepLink(`gromo://group?g=${GROUP_ID}`);
    await flushAsync();

    expect(mockQueueDirectGroupEntry).not.toHaveBeenCalled();
  });

  test('그룹이 1개여도 그룹방을 push 한다(A-9 이후 목록이 기본 화면)', async () => {
    mockGetMyGroups.mockResolvedValue([summary(GROUP_ID)]);
    navigateToDeepLink(`gromo://group?g=${GROUP_ID}`);
    await flushAsync();

    expect(navigate).toHaveBeenCalledWith('Main', { screen: '그룹' });
    expect(navigate).toHaveBeenLastCalledWith('GroupRoom', {
      groupId: GROUP_ID,
      challengeId: undefined,
      ...UNKNOWN_ATTRIBUTION,
    });
  });

  test('그룹이 2개 이상이면 그룹방을 push 한다', async () => {
    mockGetMyGroups.mockResolvedValue([summary('other-1'), summary(GROUP_ID)]);
    navigateToDeepLink(`gromo://group?g=${GROUP_ID}`);
    await flushAsync();

    expect(navigate).toHaveBeenCalledWith('Main', { screen: '그룹' });
    expect(navigate).toHaveBeenLastCalledWith('GroupRoom', {
      groupId: GROUP_ID,
      challengeId: undefined,
      ...UNKNOWN_ATTRIBUTION,
    });
  });

  // GROMO-1088 — challenge가 실려 있으면 그룹방이 그 챌린지의 결과 모달을 연다.
  test.each([
    ['1그룹', [GROUP_ID]],
    ['다중 그룹', ['other-1', GROUP_ID]],
  ])('%s 사용자에게도 challenge 파라미터를 그룹방까지 흘린다', async (_label, ids) => {
    mockGetMyGroups.mockResolvedValue(ids.map(summary));
    navigateToDeepLink(`gromo://group?g=${GROUP_ID}&challenge=${CHALLENGE_ID}`);
    await flushAsync();

    expect(navigate).toHaveBeenLastCalledWith('GroupRoom', {
      groupId: GROUP_ID,
      challengeId: CHALLENGE_ID,
      ...UNKNOWN_ATTRIBUTION,
    });
  });

  test('challenge가 UUID가 아니면 무시하고 그룹방까지만 간다(모달 없음)', async () => {
    mockGetMyGroups.mockResolvedValue([summary(GROUP_ID)]);
    navigateToDeepLink(`gromo://group?g=${GROUP_ID}&challenge=abc`);
    await flushAsync();

    expect(navigate).toHaveBeenLastCalledWith('GroupRoom', {
      groupId: GROUP_ID,
      challengeId: undefined,
      ...UNKNOWN_ATTRIBUTION,
    });
  });

  // g 뒤에 파라미터가 붙어도 기존 파싱이 깨지지 않는다(계약 §2의 룩어헤드 근거).
  test('challenge가 뒤따라도 g는 그대로 잘라낸다', async () => {
    mockGetMyGroups.mockResolvedValue([summary(GROUP_ID)]);
    navigateToDeepLink(`gromo://group?g=${GROUP_ID}&challenge=${CHALLENGE_ID}#frag`);
    await flushAsync();

    expect(navigate).toHaveBeenLastCalledWith('GroupRoom', {
      groupId: GROUP_ID,
      challengeId: CHALLENGE_ID,
      ...UNKNOWN_ATTRIBUTION,
    });
  });

  // 알림을 연달아 탭하면 각 링크가 독립적인 목록 조회를 띄운다 — 먼저 시작한 조회가 늦게
  // 끝나면 나중에 탭한 방이 열린 뒤 이전 방으로 되돌아간다(코덱스 리뷰).
  test('먼저 탭한 링크의 늦은 조회가 나중에 탭한 이동을 덮지 않는다', async () => {
    const OTHER_ID = '0197e0c3-4d1b-7a2e-9f60-3b7c1f2a8d66';
    const rows = [summary(GROUP_ID), summary(OTHER_ID)];
    let resolveFirst: ((v: unknown) => void) | undefined;
    mockGetMyGroups
      .mockImplementationOnce(() => new Promise((resolve) => (resolveFirst = resolve)))
      .mockResolvedValueOnce(rows);

    navigateToDeepLink(`gromo://group?g=${GROUP_ID}&challenge=${CHALLENGE_ID}`); // 첫 번째 탭
    navigateToDeepLink(`gromo://group?g=${OTHER_ID}`); // 두 번째 탭 — 이쪽이 최신
    await flushAsync();

    expect(navigate).toHaveBeenLastCalledWith('GroupRoom', {
      groupId: OTHER_ID,
      challengeId: undefined,
      ...UNKNOWN_ATTRIBUTION,
    });

    // 이제 첫 번째 조회가 뒤늦게 끝난다 — 최신이 아니므로 이동하지 않는다.
    resolveFirst?.(rows);
    await flushAsync();

    expect(navigate).toHaveBeenLastCalledWith('GroupRoom', {
      groupId: OTHER_ID,
      challengeId: undefined,
      ...UNKNOWN_ATTRIBUTION,
    });
    expect(navigate).not.toHaveBeenCalledWith('GroupRoom', {
      groupId: GROUP_ID,
      challengeId: CHALLENGE_ID,
    });
  });

  // 세대는 그룹 링크뿐 아니라 **모든** 딥링크에서 올라간다 — 그러지 않으면 진행 중인 그룹 조회가
  // 뒤늦게 끝나며 나중에 탭한 홈·친구 화면 위에 그룹방을 다시 연다(코덱스 리뷰).
  test.each([
    ['홈 링크', 'gromo://home', 'Main'],
    ['친구 링크', 'gromo://friends', 'FriendAdd'],
    ['g가 깨진 그룹 링크', 'gromo://group?g=abc', 'Main'],
  ])('진행 중인 그룹 조회를 %s가 무효화한다', async (_label, nextLink, expectedRoute) => {
    let resolveFirst: ((v: unknown) => void) | undefined;
    mockGetMyGroups.mockImplementationOnce(
      () => new Promise((resolve) => (resolveFirst = resolve)),
    );

    navigateToDeepLink(`gromo://group?g=${GROUP_ID}&challenge=${CHALLENGE_ID}`);
    navigateToDeepLink(nextLink); // 보관함에서 다른 알림을 탭했다
    resolveFirst?.([summary(GROUP_ID)]); // 먼저 시작한 조회가 뒤늦게 끝난다
    await flushAsync();

    expect(navigate).not.toHaveBeenCalledWith('GroupRoom', expect.anything());
    // FriendAdd는 파라미터 없이 부르므로 라우트 이름만 본다.
    expect(navigate.mock.lastCall?.[0]).toBe(expectedRoute);
  });

  // 후속 딥링크는 세대 가드가 잡지만, 사용자가 **스스로** 탭을 옮긴 경우는 잡지 못한다 —
  // 조회 완료가 사용자가 고른 화면 위에 그룹방을 덮어쓴다(코덱스 리뷰).
  test('조회를 기다리는 사이 사용자가 다른 탭으로 가면 이동을 포기한다', async () => {
    let resolveGroups: ((v: unknown) => void) | undefined;
    mockGetMyGroups.mockImplementationOnce(
      () => new Promise((resolve) => (resolveGroups = resolve)),
    );

    currentRoute.mockReturnValueOnce({ key: '홈-1', name: '홈' }).mockReturnValue({
      key: '그룹-1',
      name: '그룹',
    });
    navigateToDeepLink(`gromo://group?g=${GROUP_ID}&challenge=${CHALLENGE_ID}`);
    // 사용자가 홈 탭을 직접 눌렀다 — 딥링크가 아니라 일반 이동이라 세대는 그대로다.
    currentRoute.mockReturnValue({ key: '홈-1', name: '홈' });
    resolveGroups?.([summary(GROUP_ID)]);
    await flushAsync();

    expect(navigate).not.toHaveBeenCalledWith('GroupRoom', expect.anything());
    expect(mockQueueDirectGroupEntry).toHaveBeenCalledWith('push');
    expect(mockClearPendingGroupEntry).toHaveBeenCalledTimes(1);
  });

  test('이미 그룹방이 열려 있는 상태는 같은 흐름으로 보고 이동을 마친다', async () => {
    mockGetMyGroups.mockResolvedValue([summary(GROUP_ID)]);
    currentRoute.mockReturnValue({ key: 'GroupRoom-1', name: 'GroupRoom' });

    navigateToDeepLink(`gromo://group?g=${GROUP_ID}&challenge=${CHALLENGE_ID}`);
    await flushAsync();

    expect(navigate).toHaveBeenLastCalledWith('GroupRoom', {
      groupId: GROUP_ID,
      challengeId: CHALLENGE_ID,
      ...UNKNOWN_ATTRIBUTION,
    });
  });

  // 현재 화면을 못 읽는 경우(구버전 ref·초기화 중)엔 기존대로 이동한다 — 가드는 확신할 때만 막는다.
  test('현재 화면을 읽지 못하면 기존대로 이동한다', async () => {
    mockGetMyGroups.mockResolvedValue([summary(GROUP_ID)]);
    currentRoute.mockReturnValue(undefined);

    navigateToDeepLink(`gromo://group?g=${GROUP_ID}`);
    await flushAsync();

    expect(navigate).toHaveBeenLastCalledWith('GroupRoom', {
      groupId: GROUP_ID,
      challengeId: undefined,
      ...UNKNOWN_ATTRIBUTION,
    });
  });

  test('내 그룹이 아니면(푸시 후 탈퇴) 그룹 탭까지만 간다', async () => {
    mockGetMyGroups.mockResolvedValue([summary('other-1'), summary('other-2')]);
    navigateToDeepLink(`gromo://group?g=${GROUP_ID}`);
    await flushAsync();

    expect(navigate).toHaveBeenCalledWith('Main', { screen: '그룹' });
    expect(navigate).not.toHaveBeenCalledWith('GroupRoom', expect.anything());
  });

  // 결과성 푸시(result=1 — push.ts가 BET_RESULT 등에 합성)는 멤버십 게이트를 우회한다
  // (PR #566 리뷰 P1). 탈퇴자는 목록에 그 그룹이 없어 여기서 잘리면, 참가자 스코프 결과를
  // 부르는 GroupRoomScreen(MEMBER_ONLY → 결과 모달 소비 후 onLeft)에 도달조차 못 한다 —
  // 다른 소속 그룹이 없으면 정산 통지를 볼 통로가 0이 된다(N53·C8).
  describe('결과성 푸시(result=1)의 멤버십 게이트 우회', () => {
    test('다른 화면에서 즉시 GroupRoom으로 우회하면 다음 그룹 episode source를 남기지 않는다', async () => {
      currentRoute.mockReturnValue({ key: '홈-1', name: '홈' });

      navigateToDeepLink(`gromo://group?g=${GROUP_ID}&result=1`);
      await flushAsync();

      expect(mockQueueDirectGroupEntry).not.toHaveBeenCalled();
      expect(mockClearPendingDirectGroupEntry).toHaveBeenCalledTimes(1);
      expect(mockClearPendingGroupEntry).not.toHaveBeenCalled();
      expect(navigate).toHaveBeenLastCalledWith('GroupRoom', {
        groupId: GROUP_ID,
        challengeId: undefined,
        ...UNKNOWN_ATTRIBUTION,
      });
    });

    test('탈퇴자(내 그룹 목록에 없음)여도 그룹방을 push 한다 — 목록 조회 자체를 생략', async () => {
      mockGetMyGroups.mockResolvedValue([summary('other-1')]);
      currentRoute.mockReturnValue({ key: '홈-1', name: '홈' });
      navigateToDeepLink(`gromo://group?g=${GROUP_ID}&result=1`);
      await flushAsync();

      expect(navigate).toHaveBeenCalledWith('Main', { screen: '그룹' });
      expect(navigate).toHaveBeenLastCalledWith('GroupRoom', {
        groupId: GROUP_ID,
        challengeId: undefined,
        ...UNKNOWN_ATTRIBUTION,
      });
      // 게이트 우회는 조회 생략이다 — 소속 여부와 무관하게 화면(MEMBER_ONLY 처리)이 받는다.
      expect(mockGetMyGroups).not.toHaveBeenCalled();
      expect(mockMarkInitialGroupRoomReturn).toHaveBeenCalledTimes(1);
    });

    test('이미 그룹 흐름 안에서 연 결과 방은 초기 복귀 표식을 만들지 않는다', async () => {
      currentRoute.mockReturnValue({ key: 'GroupRoom-1', name: 'GroupRoom' });

      navigateToDeepLink(`gromo://group?g=${GROUP_ID}&result=1`);
      await flushAsync();

      expect(mockMarkInitialGroupRoomReturn).not.toHaveBeenCalled();
    });

    test('목록에 남는 잘못된 g의 결과 push는 push source를 예약한다', async () => {
      currentRoute.mockReturnValue({ key: '홈-1', name: '홈' });

      navigateToDeepLink('gromo://group?g=abc&result=1');
      await flushAsync();

      expect(mockQueueDirectGroupEntry).toHaveBeenCalledWith('push');
      expect(mockMarkInitialGroupRoomReturn).not.toHaveBeenCalled();
      expect(navigate).not.toHaveBeenCalledWith('GroupRoom', expect.anything());
    });

    test('challenge와 함께 실려도 두 파라미터 모두 그룹방까지 흘린다', async () => {
      navigateToDeepLink(`gromo://group?g=${GROUP_ID}&challenge=${CHALLENGE_ID}&result=1`);
      await flushAsync();

      expect(navigate).toHaveBeenLastCalledWith('GroupRoom', {
        groupId: GROUP_ID,
        challengeId: CHALLENGE_ID,
        ...UNKNOWN_ATTRIBUTION,
      });
      expect(mockGetMyGroups).not.toHaveBeenCalled();
    });

    test('result=1이 아니면(비결과성·변조값) 기존 게이트 그대로다', async () => {
      mockGetMyGroups.mockResolvedValue([summary('other-1')]);
      navigateToDeepLink(`gromo://group?g=${GROUP_ID}&result=2`);
      await flushAsync();

      expect(mockGetMyGroups).toHaveBeenCalled();
      expect(navigate).not.toHaveBeenCalledWith('GroupRoom', expect.anything());
    });
  });

  // 환불 푸시(refund=1 — push.ts가 BET_VOID_REFUND에 합성)는 잔액 재조회를 태운다(codex 리뷰 P2).
  // 삭제된 챌린지는 결과 모달 대상에서 빠지고(challengeResult.ts의 voidReason 필터) 그룹의
  // 챌린지 목록에도 남지 않아, 이 표식이 없으면 GroupRoomScreen의 어떤 경로도 잔액을 다시
  // 받지 않는다 — 환불 전 잔액이 앱이 살아 있는 내내 화면에 남는다.
  describe('환불 푸시(refund=1)의 잔액 재조회', () => {
    test('환불 딥링크로 진입하면 잔액 재조회를 요청한다', async () => {
      navigateToDeepLink(`gromo://group?g=${GROUP_ID}&result=1&refund=1`);
      await flushAsync();

      expect(mockRequestCoinRefresh).toHaveBeenCalledTimes(1);
      // 이동 자체는 결과성 푸시와 동일하다 — 잔액 갱신이 라우팅을 바꾸지 않는다.
      expect(navigate).toHaveBeenLastCalledWith('GroupRoom', {
        groupId: GROUP_ID,
        challengeId: undefined,
        ...UNKNOWN_ATTRIBUTION,
      });
    });

    // 그룹방 push가 성사되지 않아도(그룹 탭 폴백) 잔액은 갱신돼야 한다 — 환불된 코인은
    // 그룹 소속과 무관한 내 재산이고, 이 푸시 말고는 알려 줄 사건이 없다.
    test('g가 깨져 그룹방까지 못 가도 잔액은 다시 받는다', async () => {
      navigateToDeepLink('gromo://group?g=abc&refund=1');
      await flushAsync();

      expect(mockRequestCoinRefresh).toHaveBeenCalledTimes(1);
      expect(navigate).toHaveBeenCalledWith('Main', { screen: '그룹' });
      expect(navigate).not.toHaveBeenCalledWith('GroupRoom', expect.anything());
    });

    test('표식 없는 일반 그룹 푸시는 종전대로 — 잔액을 건드리지 않는다', async () => {
      mockGetMyGroups.mockResolvedValue([summary(GROUP_ID)]);
      navigateToDeepLink(`gromo://group?g=${GROUP_ID}&result=1`);
      navigateToDeepLink(`gromo://group?g=${GROUP_ID}`);
      await flushAsync();

      expect(mockRequestCoinRefresh).not.toHaveBeenCalled();
    });

    test('변조된 값(refund=2)은 무시한다', async () => {
      mockGetMyGroups.mockResolvedValue([summary(GROUP_ID)]);
      navigateToDeepLink(`gromo://group?g=${GROUP_ID}&refund=2`);
      await flushAsync();

      expect(mockRequestCoinRefresh).not.toHaveBeenCalled();
    });
  });

  test('목록 조회가 실패해도 그룹 탭 이동은 유지된다(폴백)', async () => {
    mockGetMyGroups.mockRejectedValue(new Error('network'));
    navigateToDeepLink(`gromo://group?g=${GROUP_ID}`);
    await flushAsync();

    expect(navigate).toHaveBeenCalledWith('Main', { screen: '그룹' });
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  test('g가 없거나 UUID가 아니면 조회 없이 그룹 탭 이동만 한다', async () => {
    navigateToDeepLink('gromo://group');
    navigateToDeepLink('gromo://group?g=abc');
    await flushAsync();

    expect(navigate).toHaveBeenCalledTimes(2);
    expect(navigate).toHaveBeenCalledWith('Main', { screen: '그룹' });
    expect(mockGetMyGroups).not.toHaveBeenCalled();
  });
});

describe('기존 매핑(푸시가 쓰는 중)', () => {
  test.each([
    ['gromo://league', 'Main', { screen: '리그' }],
    ['gromo://home', 'Main', { screen: '홈' }],
    ['gromo:///league', 'Main', { screen: '리그' }],
  ])('%s → 탭 이동', (link, route, params) => {
    navigateToDeepLink(link);
    expect(navigate).toHaveBeenCalledWith(route, params);
  });

  test.each(['gromo://home', 'gromo://league'])('%s는 초기 방 복귀 표식을 폐기한다', (link) => {
    navigateToDeepLink(link);

    expect(mockDiscardInitialGroupRoomReturn).toHaveBeenCalledTimes(1);
  });

  test('gromo://focus → 과목 선택 화면', () => {
    navigateToDeepLink('gromo://focus');
    expect(navigate).toHaveBeenCalledWith('FocusCategory', {
      initialGroupId: undefined,
      ...UNKNOWN_ATTRIBUTION,
    });
  });

  // 친구 푸시(티켓 1090)가 발행하는 링크를 받는 배선 — 계약 §2.
  test.each(['gromo://friends', 'gromo:///friends'])('%s → 친구 추가 화면', (link) => {
    navigateToDeepLink(link);
    expect(navigate).toHaveBeenCalledWith('FriendAdd');
  });

  test('모르는 경로는 무시한다', () => {
    navigateToDeepLink('gromo://unknown');
    expect(navigate).not.toHaveBeenCalled();
  });
});
