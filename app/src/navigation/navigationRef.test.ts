// navigateToDeepLink 유닛 테스트 — 명세 docs/app/group-plan.md §6-6·§11.
// 파서(inviteLink.ts) 단독 테스트만으론 부족했다: 파서가 받아주는 슬래시 변형을 라우터가
// 경로 문자열로 다시 잘라 버리면 join 분기에 닿지 못해 "지원한다"던 링크가 조용히 죽는다.
// 여기서는 링크 → (탭 이동 + 초대 버퍼) 까지의 실제 배선을 잠근다.
import {
  clearPendingInvite,
  navigateToDeepLink,
  navigationRef,
  peekPendingInvite,
  setGroupInviteListener,
} from './navigationRef';

const GROUP_ID = '0197e0c3-4d1b-7a2e-9f60-3b7c1f2a8d55';

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
  // 랜딩(§12)이 내보내는 정상형 + OS·인앱 브라우저가 정규화하며 만드는 변형들.
  test.each([
    ['두 슬래시', `gromo://join?g=${GROUP_ID}`],
    ['끝 슬래시', `gromo://join/?g=${GROUP_ID}`],
    ['세 슬래시', `gromo:///join?g=${GROUP_ID}`],
    ['웹 랜딩 링크', `https://oneorthree.github.io/phone/join.html?g=${GROUP_ID}`],
  ])('%s 링크는 그룹 탭으로 보내고 초대 버퍼에 담는다', (_label, link) => {
    navigateToDeepLink(link);

    expect(navigate).toHaveBeenCalledWith('Main', { screen: '그룹' });
    expect(inviteListener).toHaveBeenCalledWith(GROUP_ID);
    // 버퍼는 읽어도 지워지지 않는다 — 게스트가 로그인해 앱 트리가 리마운트돼도 살아남아야 한다(§6-6).
    expect(peekPendingInvite()).toBe(GROUP_ID);
  });

  test('형식이 깨진 초대 링크는 조용히 무시한다(이동·버퍼 모두 없음)', () => {
    navigateToDeepLink('gromo://join?g=abc');
    navigateToDeepLink('gromo://join?g=%');
    navigateToDeepLink('gromo://join');

    expect(navigate).not.toHaveBeenCalled();
    expect(inviteListener).not.toHaveBeenCalled();
    expect(peekPendingInvite()).toBeNull();
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
