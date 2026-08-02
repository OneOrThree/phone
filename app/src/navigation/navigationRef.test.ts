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

jest.mock('@/services/analyticsEvents', () => ({ logInviteLinkOpened: jest.fn() }));

// 그룹 딥링크(창 종료 푸시)의 1개/2개+ 분기가 목록 조회에 매달린다 — 네트워크 없이 목으로 준다.
jest.mock('@/services/groupApi', () => ({ getMyGroups: jest.fn() }));
const mockGetMyGroups = jest.requireMock('@/services/groupApi').getMyGroups as jest.Mock;

// navigateToDeepLink의 group 분기는 목록 조회를 비동기로 기다린다 — 마이크로태스크를 비운다.
async function flushAsync() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

const GROUP_ID = '0197e0c3-4d1b-7a2e-9f60-3b7c1f2a8d55';
const SLUG = 'ab23cd45';

const navigate = jest.spyOn(navigationRef, 'navigate');
const inviteListener = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(navigationRef, 'isReady').mockReturnValue(true);
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

// 창 종료 푸시 딥링크(gromo://group?g={groupId}, 계약 §2 B4→A3) — GroupScreen의 진입 분기와
// 같은 규칙: 그룹 1개면 탭 이동으로 끝(내장 그룹방이 곧 그 그룹), 2개 이상이면 그룹방을 push.
describe('그룹 딥링크(창 종료 푸시)', () => {
  const summary = (groupId: string) => ({ groupId }) as never;

  test('그룹이 1개면 그룹 탭 이동으로 끝난다(내장 그룹방이 곧 그 그룹)', async () => {
    mockGetMyGroups.mockResolvedValue([summary(GROUP_ID)]);
    navigateToDeepLink(`gromo://group?g=${GROUP_ID}`);
    await flushAsync();

    expect(navigate).toHaveBeenCalledWith('Main', { screen: '그룹' });
    expect(navigate).not.toHaveBeenCalledWith('GroupRoom', expect.anything());
  });

  test('그룹이 2개 이상이면 그룹방을 push 한다', async () => {
    mockGetMyGroups.mockResolvedValue([summary('other-1'), summary(GROUP_ID)]);
    navigateToDeepLink(`gromo://group?g=${GROUP_ID}`);
    await flushAsync();

    expect(navigate).toHaveBeenCalledWith('Main', { screen: '그룹' });
    expect(navigate).toHaveBeenLastCalledWith('GroupRoom', { groupId: GROUP_ID });
  });

  test('내 그룹이 아니면(푸시 후 탈퇴) 그룹 탭까지만 간다', async () => {
    mockGetMyGroups.mockResolvedValue([summary('other-1'), summary('other-2')]);
    navigateToDeepLink(`gromo://group?g=${GROUP_ID}`);
    await flushAsync();

    expect(navigate).toHaveBeenCalledWith('Main', { screen: '그룹' });
    expect(navigate).not.toHaveBeenCalledWith('GroupRoom', expect.anything());
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

  test('gromo://focus → 과목 선택 화면', () => {
    navigateToDeepLink('gromo://focus');
    expect(navigate).toHaveBeenCalledWith('FocusCategory');
  });

  test('모르는 경로는 무시한다', () => {
    navigateToDeepLink('gromo://unknown');
    expect(navigate).not.toHaveBeenCalled();
  });
});
