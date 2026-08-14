// GroupSettingsScreen(A-1 관리 허브) 테스트 — A안 개편(그룹방 ⋯ 가 이 화면을 바로 연다).
//
// 이 화면의 계약:
//  1) 방장은 관리 행(프로필설정하기·방장넘기기·멤버관리·공지권한) + 나가기, 비방장은 나가기만 본다.
//  2) 관리 행은 각각 올바른 라우트·파라미터로 navigate 한다.
//  3) 나가기: 성공 → popToTop(목록 복귀). 방장(HOST_WITHDRAW) → 위임 화면 유도.
//     이미 빠져 있음(NOT_FOUND·MEMBER_ONLY) → 성공과 같게 popToTop.
//     **유저 부재(USER_NOT_FOUND) → popToTop이 아니라 재로그인 유도**(GROMO-1247) —
//     없어진 건 그룹이 아니라 내 계정이라 목록으로 돌려보내면 '나가기 성공'으로 위장된다.
//  4) 나가기 확인은 네이티브 Alert가 아니라 앱 컨셉 카드 모달이다(GROMO-1251, 정책 D8의
//     「확인이 필요한 2버튼」은 토스트 대상이 아니므로 카드로 옮겼다). 문구는 기존 그대로.
//  (프로필 편집 폼 자체는 GroupProfileEditScreen.test.tsx 에서 검증한다.)
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AxiosError, AxiosHeaders } from 'axios';
import GroupSettingsScreen from './GroupSettingsScreen';
import { getGroupDetail, withdrawGroup } from '@/services/groupApi';
import { getAuthSessionGeneration, triggerLogout } from '@/services/api';
import type { GroupDetailResponse } from '@/types/dto/group';
import { STORAGE_KEYS } from '@/types/storage';
import {
  OVERLAY_PRIORITY,
  OverlaySlotProvider,
  useOverlayMaxPriority,
} from '@/store/OverlaySlotContext';
import {
  __resetGroupCardEmojiQueueForTest,
  preservePendingGroupCardEmoji,
} from './groupCardEmojiStore';

jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context'),
  useSafeAreaInsets: () => ({ top: 47, left: 0, right: 0, bottom: 34 }),
}));

const GROUP_ID = '0197e0c3-4d1b-7a2e-9f60-3b7c1f2a8d55';

const mockNavigate = jest.fn();
const mockPopToTop = jest.fn();
const mockGoBack = jest.fn();
const mockNavigation = { navigate: mockNavigate, popToTop: mockPopToTop, goBack: mockGoBack };
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => mockNavigation,
  useRoute: () => ({ params: { groupId: '0197e0c3-4d1b-7a2e-9f60-3b7c1f2a8d55' } }),
  useFocusEffect: (cb: () => void | (() => void)) => {
    const { useEffect } = require('react');
    useEffect(() => {
      const cleanup = cb();
      return typeof cleanup === 'function' ? cleanup : undefined;
    }, [cb]);
  },
}));

const mockUser = { userId: 'me' as string | null };
jest.mock('@/store/UserContext', () => ({
  useUser: () => mockUser,
}));

// analyticsEvents는 firebase 네이티브 모듈을 물어 온다 — groupApi(requireActual)가 전이 import
// 하므로 목으로 막지 않으면 스위트가 로드 단계에서 죽는다. 허브 화면 자체는 계측을 쓰지 않는다.
jest.mock('@/services/analyticsEvents', () => ({
  logGroupChallengeDeleted: jest.fn(),
  logGroupLeft: jest.fn(),
}));

// groupErrorCode는 실제 구현을 남긴다(§3-2 code 분기까지 검증).
jest.mock('@/services/groupApi', () => ({
  ...jest.requireActual('@/services/groupApi'),
  getGroupDetail: jest.fn(),
  withdrawGroup: jest.fn(),
}));

// 유저 부재 분기가 부르는 세션 경계 — 실제 모듈은 App이 등록한 핸들러로 트리를 리셋하므로
// 여기선 **어떤 세대로 불렸는지**만 본다(GROMO-1247 P1).
jest.mock('@/services/api', () => ({
  ...jest.requireActual('@/services/api'),
  getAuthSessionGeneration: jest.fn(() => 0),
  triggerLogout: jest.fn(),
}));

const mockGetGroupDetail = getGroupDetail as jest.MockedFunction<typeof getGroupDetail>;
const mockWithdrawGroup = withdrawGroup as jest.MockedFunction<typeof withdrawGroup>;
const mockTriggerLogout = triggerLogout as jest.MockedFunction<typeof triggerLogout>;
const mockGetAuthSessionGeneration = getAuthSessionGeneration as jest.MockedFunction<
  typeof getAuthSessionGeneration
>;

// Alert의 확인 버튼을 눌러 로그아웃까지 진행한다(재로그인 안내는 취소 없는 단일 확인이다).
function pressReloginConfirm(alertSpy: jest.SpyInstance): void {
  const [, , buttons] = alertSpy.mock.calls[0] as unknown as [
    string,
    string,
    { text: string; onPress?: () => void }[],
  ];
  buttons[0].onPress?.();
}

// 서버 에러 바디({ code })를 실은 axios 에러 — 화면은 status가 아니라 code로 분기한다.
function axiosErrorWith(status: number, code: string): AxiosError {
  const config = { headers: new AxiosHeaders() };
  return new AxiosError('request failed', 'ERR_BAD_REQUEST', config, null, {
    status,
    statusText: '',
    headers: {},
    config,
    data: { code },
  });
}

// 기본 상세 — over로 members를 갈아 방장/비방장을 만든다.
function detail(over: Partial<GroupDetailResponse> = {}): GroupDetailResponse {
  return {
    id: GROUP_ID,
    name: '아침 6시 집중방',
    description: '매일 아침 함께 집중해요',
    missionCategory: 'FOCUS',
    missionType: 'DURATION',
    durationMinutes: 60,
    windowStart: null,
    windowEnd: null,
    isPrivate: false,
    maxMembers: 5,
    status: 'WAITING',
    code: null,
    codeExpiresAt: null,
    noticeGrantedUserIds: [],
    members: [
      { userId: 'me', nickname: '나', role: 'OWNER', focusTimeMinutes: 30, totalFocusMinutes: 30 },
      {
        userId: 'u2',
        nickname: '친구',
        role: 'MEMBER',
        focusTimeMinutes: 10,
        totalFocusMinutes: 20,
      },
    ],
    ...over,
  } as GroupDetailResponse;
}

// 비방장(내가 MEMBER)인 상세.
function memberDetail(): GroupDetailResponse {
  return detail({
    members: [
      {
        userId: 'owner',
        nickname: '방장',
        role: 'OWNER',
        focusTimeMinutes: 0,
        totalFocusMinutes: 0,
      },
      { userId: 'me', nickname: '나', role: 'MEMBER', focusTimeMinutes: 0, totalFocusMinutes: 0 },
    ],
  });
}

async function renderScreen() {
  const result = await render(<GroupSettingsScreen />);
  await screen.findByTestId('group.settings.leave');
  return result;
}

// 나가기 확인 카드의 '나가기' 버튼을 눌러 요청을 보낸다(GROMO-1251 — 종전 네이티브 Alert).
async function pressLeaveAndConfirm() {
  await act(async () => {
    fireEvent.press(screen.getByTestId('group.settings.leave'));
  });
  // 확인 카드가 실제로 떠야 한다 — 문구는 기존 Alert에서 그대로 옮겼다.
  expect(screen.getByTestId('group.settings.leave.confirm')).toBeOnTheScreen();
  expect(screen.getByText('아침 6시 집중방에서 나갈까요?')).toBeOnTheScreen();
  await act(async () => {
    fireEvent.press(screen.getByTestId('group.settings.leave.confirm.primary'));
  });
}

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  __resetGroupCardEmojiQueueForTest();
  mockUser.userId = 'me';
  mockGetAuthSessionGeneration.mockReturnValue(0);
  mockGetGroupDetail.mockResolvedValue(detail());
  mockWithdrawGroup.mockResolvedValue(undefined);
});

describe('허브 — 행 노출', () => {
  test('방장은 역할 공통 아이콘 + 관리 행 + 나가기를 본다', async () => {
    await AsyncStorage.setItem(
      STORAGE_KEYS.groupCardEmoji,
      JSON.stringify({ me: { [GROUP_ID]: '🌅' } }),
    );
    await renderScreen();

    const emojiRow = screen.getByTestId('group.settings.cardEmoji');
    expect(emojiRow).toBeOnTheScreen();
    expect(screen.getByText('🌅 일출 · 이 기기에서 나에게만 보여요')).toBeOnTheScreen();
    expect(emojiRow).toHaveProp(
      'accessibilityLabel',
      '내 카드 아이콘, 현재 일출, 이 기기에서 나에게만 보여요',
    );
    expect(screen.getByTestId('group.settings.profile')).toBeOnTheScreen();
    expect(screen.getByTestId('group.settings.transfer')).toBeOnTheScreen();
    expect(screen.getByTestId('group.settings.members')).toBeOnTheScreen();
    expect(screen.getByTestId('group.settings.noticePermission')).toBeOnTheScreen();
    expect(screen.getByTestId('group.settings.leave')).toBeOnTheScreen();

    await act(async () => {
      fireEvent.press(screen.getByTestId('group.settings.profile'));
    });
    expect(mockNavigate).toHaveBeenCalledWith('GroupProfileEdit', { groupId: GROUP_ID });
  });

  test('MEMBER도 아이콘과 나가기는 보지만 OWNER 관리 행은 보지 않는다', async () => {
    mockGetGroupDetail.mockResolvedValue(memberDetail());
    await renderScreen();

    expect(screen.getByTestId('group.settings.leave')).toBeOnTheScreen();
    expect(screen.getByTestId('group.settings.cardEmoji')).toBeOnTheScreen();
    expect(screen.queryByTestId('group.settings.profile')).toBeNull();
    expect(screen.queryByTestId('group.settings.transfer')).toBeNull();
    expect(screen.queryByTestId('group.settings.members')).toBeNull();
  });

  test('저장 실패 pending 아이콘을 설정 행의 현재값으로 표시한다', async () => {
    await AsyncStorage.setItem(
      STORAGE_KEYS.groupCardEmoji,
      JSON.stringify({ me: { [GROUP_ID]: '📚' } }),
    );
    preservePendingGroupCardEmoji('me', GROUP_ID, '🔥');

    await renderScreen();

    expect(await screen.findByText('🔥 불꽃 · 이 기기에서 나에게만 보여요')).toBeOnTheScreen();
  });

  test('OWNER와 MEMBER 모두 같은 로컬 아이콘 편집 route로 이동한다', async () => {
    await renderScreen();
    await act(async () => {
      fireEvent.press(screen.getByTestId('group.settings.cardEmoji'));
    });
    expect(mockNavigate).toHaveBeenCalledWith('GroupCardEmojiEdit', { groupId: GROUP_ID });

    mockGetGroupDetail.mockResolvedValue(memberDetail());
    await renderScreen();
    await act(async () => {
      fireEvent.press(screen.getByTestId('group.settings.cardEmoji'));
    });
    expect(mockNavigate).toHaveBeenLastCalledWith('GroupCardEmojiEdit', { groupId: GROUP_ID });
  });
});

describe('관리 진입 — 올바른 라우트·파라미터로 navigate', () => {
  test('방장 넘기기 → GroupOwnerTransfer(source: settings)', async () => {
    await renderScreen();
    await act(async () => {
      fireEvent.press(screen.getByTestId('group.settings.transfer'));
    });
    expect(mockNavigate).toHaveBeenCalledWith('GroupOwnerTransfer', {
      groupId: GROUP_ID,
      source: 'settings',
    });
  });

  test('멤버 관리 → GroupMemberManage', async () => {
    await renderScreen();
    await act(async () => {
      fireEvent.press(screen.getByTestId('group.settings.members'));
    });
    expect(mockNavigate).toHaveBeenCalledWith('GroupMemberManage', { groupId: GROUP_ID });
  });

  test('공지 권한 → GroupNoticePermission', async () => {
    await renderScreen();
    await act(async () => {
      fireEvent.press(screen.getByTestId('group.settings.noticePermission'));
    });
    expect(mockNavigate).toHaveBeenCalledWith('GroupNoticePermission', { groupId: GROUP_ID });
  });
});

// ⚠️ 이 확인 카드는 **우리 트리 안의 RN Modal**이다 — 조정자가 원래 덮어야 할 대상인데
//    등록이 빠져 있었다. 등록하지 않으면 카드가 열린 채로 루트의 결과 모달이 함께 마운트되고,
//    사용자는 못 본 결과에 seen/ack이 남는다.
describe('나가기 확인 카드의 조정자 등록', () => {
  function PriorityProbe({ onValue }: { onValue: (value: number) => void }) {
    onValue(useOverlayMaxPriority());
    return null;
  }

  test('확인 카드가 떠 있는 동안 자리를 점유하고, 닫으면 반납한다', async () => {
    const values: number[] = [];
    await render(
      <OverlaySlotProvider>
        <GroupSettingsScreen />
        <PriorityProbe onValue={(v) => values.push(v)} />
      </OverlaySlotProvider>,
    );
    await screen.findByTestId('group.settings.leave');
    expect(values[values.length - 1]).toBe(-1);

    await act(async () => {
      fireEvent.press(screen.getByTestId('group.settings.leave'));
    });
    expect(values[values.length - 1]).toBe(OVERLAY_PRIORITY.sheet);

    await act(async () => {
      fireEvent.press(screen.getByTestId('group.settings.leave.confirm.secondary'));
    });
    expect(values[values.length - 1]).toBe(-1);
  });
});

describe('그룹 나가기', () => {
  test('나가기에 성공하면 목록으로 돌아간다(popToTop)', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockGetGroupDetail.mockResolvedValue(memberDetail());
    mockWithdrawGroup.mockResolvedValueOnce(undefined);
    await renderScreen();

    await pressLeaveAndConfirm();

    expect(mockWithdrawGroup).toHaveBeenCalledWith(GROUP_ID);
    expect(mockPopToTop).toHaveBeenCalled();
    // 확인이 카드로 옮겨져(GROMO-1251) 이 흐름엔 네이티브 Alert가 한 번도 뜨지 않는다.
    expect(alertSpy).not.toHaveBeenCalled();
    alertSpy.mockRestore();
  });

  test('방장이 나가려다 실패하면 위임 카드 모달로 유도한다(HOST_WITHDRAW)', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockWithdrawGroup.mockRejectedValueOnce(axiosErrorWith(409, 'HOST_WITHDRAW'));
    await renderScreen();

    await pressLeaveAndConfirm();

    // 확인 카드가 닫혔다 다시 뜨는 게 아니라 **같은 인스턴스의 내용이 바뀐다**(iOS 연속
    // present/dismiss 경합 회피, GROMO-1210) — 문구는 기존 그대로.
    expect(screen.getByTestId('group.settings.hostBlocked')).toBeOnTheScreen();
    expect(screen.getByText('방장은 바로 나갈 수 없어요')).toBeOnTheScreen();
    expect(
      screen.getByText('그룹을 이어갈 멤버에게 방장을 넘기면 나갈 수 있어요.'),
    ).toBeOnTheScreen();
    // 확인·블록 안내 어느 쪽도 네이티브 Alert로 새지 않는다.
    expect(alertSpy).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.press(screen.getByTestId('group.settings.hostBlocked.primary'));
    });
    expect(mockNavigate).toHaveBeenCalledWith('GroupOwnerTransfer', {
      groupId: GROUP_ID,
      source: 'withdraw',
    });
    expect(mockPopToTop).not.toHaveBeenCalled();
    alertSpy.mockRestore();
  });

  test('이미 빠져 있으면 성공과 같게 목록으로 돌아간다(MEMBER_ONLY)', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockGetGroupDetail.mockResolvedValue(memberDetail());
    mockWithdrawGroup.mockRejectedValueOnce(axiosErrorWith(403, 'MEMBER_ONLY'));
    await renderScreen();

    await pressLeaveAndConfirm();

    expect(mockPopToTop).toHaveBeenCalled();
    // 실패 Alert도 뜨지 않는다(결과가 성공과 같다).
    expect(alertSpy).not.toHaveBeenCalled();
    alertSpy.mockRestore();
  });

  // GROMO-1247 — 서버가 유저 부재와 그룹 부재에 같은 NOT_FOUND를 쓰던 오귀속의 최악 사례.
  // 탈퇴·비활성 세션을 '나가기 성공'으로 위장해 목록으로 돌려보내면, 그룹은 멀쩡히 남아 있는데
  // 사용자는 나갔다고 믿는다. 유저 부재 전용 코드는 재로그인으로 보낸다.
  test('유저 부재(USER_NOT_FOUND)는 나가기 성공으로 위장하지 않고 재로그인을 유도한다', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockGetGroupDetail.mockResolvedValue(memberDetail());
    mockWithdrawGroup.mockRejectedValueOnce(axiosErrorWith(404, 'USER_NOT_FOUND'));
    await renderScreen();

    await pressLeaveAndConfirm();

    // ⚠️ 카드를 닫으면서 Alert를 띄우면 iOS에서 dismiss·present가 경합해 안내가 유실되고,
    //    그러면 확인 버튼에만 있는 로그아웃 경로까지 사라진다 — 카드는 열어 둔 채 띄운다.
    expect(screen.getByTestId('group.settings.leave.confirm')).toBeOnTheScreen();
    expect(mockPopToTop).not.toHaveBeenCalled();
    expect(alertSpy).toHaveBeenCalledWith(
      '로그인이 필요해요',
      '로그인 정보가 만료됐어요. 다시 로그인해 주세요.',
      [expect.objectContaining({ text: '확인' })],
      { cancelable: false },
    );
    alertSpy.mockRestore();
  });

  // GROMO-1247 P1 — 로그아웃은 **요청을 띄운 그 세션**에만 적용돼야 한다. 안내를 읽는 사이
  // 게스트→소셜 승격이 끝나면(세대 증가) 죽은 세션의 404가 새로 성립한 세션을 끊어선 안 된다.
  // 여기선 헬퍼가 확인 시점이 아니라 **요청 시작 시점**의 세대를 넘기는지까지 잠근다 —
  // 그 대조는 App.tsx 로그아웃 핸들러가 한다(api.ts triggerLogout 계약).
  test('유저 부재 로그아웃은 요청 시작 시점의 인증 세대를 넘긴다', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockGetGroupDetail.mockResolvedValue(memberDetail());
    mockWithdrawGroup.mockRejectedValueOnce(axiosErrorWith(404, 'USER_NOT_FOUND'));
    await renderScreen();
    // 나가기 요청은 세대 7에서 나가고, 그 뒤 세션이 교체돼 세대가 8이 된다.
    mockGetAuthSessionGeneration.mockReturnValue(7);

    await pressLeaveAndConfirm();
    mockGetAuthSessionGeneration.mockReturnValue(8);
    pressReloginConfirm(alertSpy);

    expect(mockTriggerLogout).toHaveBeenCalledWith(7);
    // 인자 없는 호출이면 새 세션까지 끊긴다 — 절대 그렇게 부르지 않는다.
    expect(mockTriggerLogout).not.toHaveBeenCalledWith(undefined);
    alertSpy.mockRestore();
  });

  // 4라운드 P1-2 — **파괴적 동작에 "취소한 척"이 있으면 안 된다.** 요청이 나가 있는 동안
  // 보조 버튼·스크림 탭으로 카드가 닫히면 사용자는 취소됐다고 믿지만 요청은 그대로 성공해
  // 실제로 그룹에서 나간다. 요청을 끊을 수단이 없으므로 닫힘 쪽을 막아 '닫힘 = 취소'를 참으로 만든다.
  test('나가기 요청 중에는 취소·스크림 탭으로 카드가 닫히지 않는다', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockGetGroupDetail.mockResolvedValue(memberDetail());
    // 응답이 오지 않는 요청 — 진행 중 상태를 그대로 관찰한다.
    mockWithdrawGroup.mockReturnValueOnce(new Promise<void>(() => {}));
    await renderScreen();

    await act(async () => {
      fireEvent.press(screen.getByTestId('group.settings.leave'));
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId('group.settings.leave.confirm.primary'));
    });

    // '취소'는 아예 렌더되지 않는다 — 눌리는데 아무 일도 없으면 그 또한 거짓 신호다.
    expect(screen.queryByTestId('group.settings.leave.confirm.secondary')).toBeNull();
    // 스크림 탭도 닫지 않는다.
    await act(async () => {
      fireEvent.press(screen.getByTestId('group.settings.leave.confirm.backdrop'));
    });
    expect(screen.getByTestId('group.settings.leave.confirm')).toBeOnTheScreen();
    // 주 버튼도 잠겨 재요청이 나가지 않는다.
    await act(async () => {
      fireEvent.press(screen.getByTestId('group.settings.leave.confirm.primary'));
    });
    expect(mockWithdrawGroup).toHaveBeenCalledTimes(1);
    alertSpy.mockRestore();
  });

  // 4라운드 P1-3 — 실패 안내도 카드를 닫고 Alert를 띄우면 같은 present/dismiss 경합에 걸린다.
  // 같은 인스턴스의 내용 교체로 보여준다(문구는 종전 Alert 그대로).
  test('그 밖의 실패는 Alert가 아니라 같은 카드의 내용 교체로 알린다', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockGetGroupDetail.mockResolvedValue(memberDetail());
    mockWithdrawGroup.mockRejectedValueOnce(axiosErrorWith(500, 'SOMETHING_ELSE'));
    await renderScreen();

    await pressLeaveAndConfirm();

    expect(screen.getByTestId('group.settings.leaveFailed')).toBeOnTheScreen();
    expect(screen.getByText('그룹 나가기 실패')).toBeOnTheScreen();
    expect(screen.getByText('잠시 후 다시 시도해 주세요.')).toBeOnTheScreen();
    expect(alertSpy).not.toHaveBeenCalled();
    expect(mockPopToTop).not.toHaveBeenCalled();

    // 확인하면 닫힌다(요청이 끝났으므로 닫기 가드가 풀려 있다).
    await act(async () => {
      fireEvent.press(screen.getByTestId('group.settings.leaveFailed.primary'));
    });
    expect(screen.queryByTestId('group.settings.leaveFailed')).toBeNull();
    alertSpy.mockRestore();
  });

  // GROMO-1247 2라운드 — 응답→표시 구간에 세션이 교체되면(게스트→소셜 승격) 이 404는
  // **지난 세션의 것**이다. 로그아웃이 막히는 것만으로는 부족하다 — 방금 로그인에 성공한
  // 사용자에게 만료 안내가 뜨면 그 안내 자체가 거짓말이고, 취소 불가라 닫지도 못한다.
  test('세대가 바뀐 뒤 도착한 유저 부재는 안내도 로그아웃도 없이 조용히 버린다', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockGetGroupDetail.mockResolvedValue(memberDetail());
    mockWithdrawGroup.mockRejectedValueOnce(axiosErrorWith(404, 'USER_NOT_FOUND'));
    await renderScreen();
    // 요청은 세대 7에서 나가고(첫 호출), 응답 처리 시점엔 이미 8이다(그 뒤 호출).
    mockGetAuthSessionGeneration.mockReturnValueOnce(7).mockReturnValue(8);

    await pressLeaveAndConfirm();

    expect(alertSpy).not.toHaveBeenCalled();
    expect(mockTriggerLogout).not.toHaveBeenCalled();
    // 새 세션에서는 이 나가기 요청이 애초에 무의미하다 — 목록으로 튕기지도 않는다.
    expect(mockPopToTop).not.toHaveBeenCalled();
    alertSpy.mockRestore();
  });

  // GROMO-1247 P2 — **화면 진입 시점의 404**는 액션 실패와 다른 자리다. 활성 users 행이 이미
  // 없는 세션으로 들어오면 첫 상세 조회가 404로 떨어지는데, 코드를 안 보면 '다시 시도'만
  // 무한히 누르게 된다(재시도로 절대 안 풀린다).
  test('진입 조회가 USER_NOT_FOUND면 재시도 안내에 가두지 않고 재로그인을 유도한다', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockGetAuthSessionGeneration.mockReturnValue(4);
    mockGetGroupDetail.mockRejectedValue(axiosErrorWith(404, 'USER_NOT_FOUND'));

    await render(<GroupSettingsScreen />);
    await act(async () => {});

    expect(alertSpy).toHaveBeenCalledWith(
      '로그인이 필요해요',
      '로그인 정보가 만료됐어요. 다시 로그인해 주세요.',
      [expect.objectContaining({ text: '확인' })],
      { cancelable: false },
    );
    // 안내와 별개로 화면은 실패 상태로 남는다 — 로그아웃 언마운트 전까지 성공처럼 보이면 안 된다.
    expect(screen.getByText('그룹을 불러오지 못했어요')).toBeOnTheScreen();
    pressReloginConfirm(alertSpy);
    expect(mockTriggerLogout).toHaveBeenCalledWith(4);
    alertSpy.mockRestore();
  });

  // 진입 조회의 **일반 실패**는 종전 그대로 재시도 안내다 — 위 분기가 전부를 삼키면 안 된다.
  test('진입 조회의 다른 실패는 종전대로 에러+다시 시도로 남는다', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockGetGroupDetail.mockRejectedValue(axiosErrorWith(500, 'SOMETHING_ELSE'));

    await render(<GroupSettingsScreen />);
    await act(async () => {});

    expect(screen.getByText('그룹을 불러오지 못했어요')).toBeOnTheScreen();
    expect(alertSpy).not.toHaveBeenCalled();
    expect(mockTriggerLogout).not.toHaveBeenCalled();
    alertSpy.mockRestore();
  });

  // 브리지 대비 — 서버가 코드를 나누기 전(구서버)엔 그룹 부재가 계속 NOT_FOUND로 온다.
  // 그 경로의 동작(성공과 같게 popToTop)은 그대로 남아 있어야 한다.
  test('기존 NOT_FOUND(그룹 부재) 경로는 종전대로 목록으로 돌아간다', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockGetGroupDetail.mockResolvedValue(memberDetail());
    mockWithdrawGroup.mockRejectedValueOnce(axiosErrorWith(404, 'NOT_FOUND'));
    await renderScreen();

    await pressLeaveAndConfirm();

    expect(mockPopToTop).toHaveBeenCalled();
    expect(alertSpy).not.toHaveBeenCalled();
    alertSpy.mockRestore();
  });
});
