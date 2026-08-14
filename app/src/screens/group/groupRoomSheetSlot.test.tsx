// 그룹방이 카드에 넘기는 **비동기 시트 승인 게이트**(GROMO-1576).
//
// 카드 시트 중 `openWeekSheet()`·삭제 프리플라이트는 탭과 마운트 사이에 조회가 끼어 있어서
// **여는 시점을 응답이 정한다.** 그 사이 루트의 챌린지 결과 모달이 slot을 얻어 노출까지 갈 수
// 있는데, 조정자는 보유자를 뺏지 않으므로 그대로 마운트하면 RN Modal 두 개가 겹친다. 그러면
// 결과 모달이 **사실상 안 보인 채** seen 마커와 ack이 나간다(둘 다 렌더 커밋 시점에 찍힌다 —
// 사용자가 인지한 시점이 아니다).
//
// 이 파일이 보는 것은 **부모(GroupRoomScreen) 쪽 계약**이다: 승인은 보유자가 놓을 때까지
// 미뤄지고, 화면을 벗어나면 거절로 깨어난다. 카드가 그 답을 실제로 지키는지(= 승인 전에는
// 시트를 마운트하지 않는지)는 components/ChallengeCard.test.tsx가 잠근다 — 양쪽 다 실물이다.
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { View } from 'react-native';
import GroupRoomScreen from './GroupRoomScreen';
import { OVERLAY_PRIORITY, OverlaySlotProvider, useOverlaySlot } from '@/store/OverlaySlotContext';
import { getAnnouncements, getChallenges, getGroupDetail } from '@/services/groupApi';
import { resetChallengeResultGateForTests } from './challengeResultGate';
import type { GroupChallengeResponse, GroupDetailResponse } from '@/types/dto/group';

jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context'),
  useSafeAreaInsets: () => ({ top: 47, left: 0, right: 0, bottom: 34 }),
}));

// 포커스/블러를 테스트가 직접 굴린다(탭 화면이라 블러돼도 언마운트되지 않는다).
const mockFocusEntries: { cb: () => void | (() => void); cleanup?: () => void }[] = [];
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn() }),
  useFocusEffect: (cb: () => void | (() => void)) => {
    const { useEffect } = require('react');
    useEffect(() => {
      const entry: { cb: typeof cb; cleanup?: () => void } = { cb };
      const cleanup = cb();
      if (typeof cleanup === 'function') entry.cleanup = cleanup;
      mockFocusEntries.push(entry);
      return () => {
        entry.cleanup?.();
        const i = mockFocusEntries.indexOf(entry);
        if (i >= 0) mockFocusEntries.splice(i, 1);
      };
    }, [cb]);
  },
}));

jest.mock('@/store/UserContext', () => ({ useUser: () => ({ userId: 'me' }) }));
jest.mock('@/store/ToastContext', () => ({ useToast: () => ({ show: jest.fn() }) }));
const mockRefreshCoins = jest.fn(async () => true);
jest.mock('@/store/CoinContext', () => ({
  useCoins: () => ({
    coins: 5000,
    coinsLoaded: true,
    coinsVersion: 1,
    latestCoinsVersion: () => 1,
    refresh: mockRefreshCoins,
  }),
}));
jest.mock('@/services/analyticsEvents', () => ({
  logGroupInviteShared: jest.fn(),
  logGroupRoomViewed: jest.fn(),
}));
jest.mock('@/services/inviteLinkApi', () => ({ issueInviteLink: jest.fn() }));
jest.mock('./groupRoomNotFound', () => ({ resolveGroupRoomNotFound: jest.fn() }));
jest.mock('@/services/groupApi', () => ({
  ...jest.requireActual('@/services/groupApi'),
  getGroupDetail: jest.fn(),
  getAnnouncements: jest.fn(),
  getChallenges: jest.fn(),
}));

// 카드는 **스텁**이다 — 여기서 검증하는 것은 부모가 넘긴 게이트의 의미뿐이고, 카드가 그 답을
// 지키는지는 카드 자신의 테스트가 본다. 스텁이 하는 일은 카드의 `await 뒤` 시점을 재현하는 것:
// 버튼을 누르면 게이트를 부르고, 돌아온 답을 화면에 적는다.
let gateResult: 'pending' | 'granted' | 'denied' | 'idle' = 'idle';
jest.mock('./components/ChallengeCard', () => {
  const { Text: RNText, TouchableOpacity: RNTouchable } = require('react-native');
  return function MockCard({
    onRequestSheetSlot,
  }: {
    onRequestSheetSlot?: () => Promise<boolean>;
  }) {
    return (
      <RNTouchable
        testID="card.asyncSheet.open"
        onPress={() => {
          gateResult = 'pending';
          onRequestSheetSlot?.().then((granted) => {
            gateResult = granted ? 'granted' : 'denied';
          });
        }}
      >
        <RNText>비동기 시트 열기</RNText>
      </RNTouchable>
    );
  };
});

const GROUP_ID = '0197e0c3-4d1b-7a2e-9f60-3b7c1f2a8d55';
const onLeft = jest.fn();

const mockGetGroupDetail = getGroupDetail as jest.MockedFunction<typeof getGroupDetail>;
const mockGetAnnouncements = getAnnouncements as jest.MockedFunction<typeof getAnnouncements>;
const mockGetChallenges = getChallenges as jest.MockedFunction<typeof getChallenges>;

function detail(): GroupDetailResponse {
  return {
    id: GROUP_ID,
    name: '아침 6시 집중방',
    description: null,
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
    ],
  };
}

function challenge(): GroupChallengeResponse {
  return {
    id: 'c1',
    missionType: 'DURATION',
    missionCategory: 'FOCUS',
    durationMinutes: 60,
    windowStart: null,
    windowEnd: null,
    status: 'ACTIVE',
    createdAt: '2026-08-01T06:00:00',
    canParticipate: true,
    memberProgress: [],
    bet: null,
    lastSettledBet: null,
  };
}

// 결과 모달과 같은 자리를 **먼저** 차지한 보유자.
function Holder({ active }: { active: boolean }) {
  useOverlaySlot('test:result', { priority: OVERLAY_PRIORITY.challengeResult, active });
  return null;
}

function tree(holderActive: boolean) {
  return (
    <OverlaySlotProvider>
      <Holder active={holderActive} />
      <View>
        <GroupRoomScreen groupId={GROUP_ID} onLeft={onLeft} />
      </View>
    </OverlaySlotProvider>
  );
}

async function openAsyncSheet() {
  await act(async () => {
    fireEvent.press(screen.getByTestId('card.asyncSheet.open'));
  });
  await act(async () => {});
}

async function blur() {
  await act(async () => {
    mockFocusEntries.forEach((e) => {
      e.cleanup?.();
      e.cleanup = undefined;
    });
  });
  await act(async () => {});
}

beforeEach(async () => {
  jest.clearAllMocks();
  mockFocusEntries.length = 0;
  gateResult = 'idle';
  resetChallengeResultGateForTests();
  mockGetGroupDetail.mockResolvedValue(detail());
  mockGetAnnouncements.mockResolvedValue([]);
  mockGetChallenges.mockResolvedValue([challenge()]);
});

test('보유자가 놓을 때까지 승인하지 않는다 — 놓으면 그때 승인한다', async () => {
  const view = await render(tree(true));
  await act(async () => {});
  expect(screen.getByTestId('card.asyncSheet.open')).toBeOnTheScreen();

  await openAsyncSheet();
  // 결과가 slot을 쥐고 있다 — 카드는 시트를 마운트할 수 없다.
  expect(gateResult).toBe('pending');

  await act(async () => {
    view.rerender(tree(false));
  });
  await waitFor(() => expect(gateResult).toBe('granted'));
});

test('화면을 벗어나면 대기를 거절로 깨운다 — 떠난 화면의 시트가 새 화면 위로 뜨지 않는다', async () => {
  await render(tree(true));
  await act(async () => {});

  await openAsyncSheet();
  expect(gateResult).toBe('pending');

  // 사용자가 다른 화면으로 갔다. 여기서 깨우지 않으면, 나중에 결과 모달이 닫히는 순간
  // **이미 떠난 화면의** 시트가 RN Modal로 새 화면 위에 뜬다.
  await blur();

  await waitFor(() => expect(gateResult).toBe('denied'));
});

test('가릴 것이 없으면 곧바로 승인한다 — 평소 경로에 지연을 넣지 않는다', async () => {
  await render(tree(false));
  await act(async () => {});

  await openAsyncSheet();

  await waitFor(() => expect(gateResult).toBe('granted'));
});
