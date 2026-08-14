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
// 카드별 게이트 결과 — 직렬화 검증(서로 다른 카드의 프리플라이트가 겹치는 경우)에 쓴다.
const gateResults: Record<string, 'pending' | 'granted' | 'denied'> = {};
// 승인받은 카드가 "열었다"고 부모에 보고하는 콜백 — 실제 카드의 openSheet()에 해당한다.
let reportOpen: ((challengeId: string, open: boolean) => void) | null = null;
// 카드가 사라진다고 알리는 콜백 — 실제 카드의 언마운트 정리에 해당한다.
let reportGone: ((challengeId: string) => void) | null = null;
jest.mock('./components/ChallengeCard', () => {
  const { Text: RNText, TouchableOpacity: RNTouchable } = require('react-native');
  return function MockCard({
    challenge: card,
    onRequestSheetSlot,
    onSheetVisibilityChange,
    onAbandonSheetSlot,
  }: {
    challenge: { id: string };
    onRequestSheetSlot?: (challengeId: string) => Promise<boolean>;
    onSheetVisibilityChange?: (challengeId: string, open: boolean) => void;
    onAbandonSheetSlot?: (challengeId: string) => void;
  }) {
    reportOpen = onSheetVisibilityChange ?? null;
    reportGone = onAbandonSheetSlot ?? null;
    return (
      <RNTouchable
        testID={`card.asyncSheet.open.${card.id}`}
        onPress={() => {
          gateResult = 'pending';
          gateResults[card.id] = 'pending';
          onRequestSheetSlot?.(card.id).then((granted) => {
            gateResult = granted ? 'granted' : 'denied';
            gateResults[card.id] = granted ? 'granted' : 'denied';
          });
        }}
      >
        <RNText>비동기 시트 열기</RNText>
      </RNTouchable>
    );
  };
});

const GROUP_ID = '0197e0c3-4d1b-7a2e-9f60-3b7c1f2a8d55';
const OTHER_GROUP_ID = '0197e0c3-4d1b-7a2e-9f60-3b7c1f2a8d66';
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

function challenge(id = 'c1'): GroupChallengeResponse {
  return {
    id,
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

async function openAsyncSheet(challengeId = 'c1') {
  await act(async () => {
    fireEvent.press(screen.getByTestId(`card.asyncSheet.open.${challengeId}`));
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
  Object.keys(gateResults).forEach((key) => delete gateResults[key]);
  reportOpen = null;
  reportGone = null;
  resetChallengeResultGateForTests();
  mockGetGroupDetail.mockResolvedValue(detail());
  mockGetAnnouncements.mockResolvedValue([]);
  mockGetChallenges.mockResolvedValue([challenge()]);
});

test('보유자가 놓을 때까지 승인하지 않는다 — 놓으면 그때 승인한다', async () => {
  const view = await render(tree(true));
  await act(async () => {});
  expect(screen.getByTestId('card.asyncSheet.open.c1')).toBeOnTheScreen();

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

// ⚠️ 공유 slot이 granted라는 사실만으로 **모든** 요청을 승인하면, 서로 다른 카드의 비동기
//    프리플라이트가 겹쳤을 때 RN Modal이 여럿 함께 마운트된다. 승인은 한 요청씩이어야 한다.
test('여러 카드가 동시에 요청해도 한 번에 하나만 승인한다', async () => {
  mockGetChallenges.mockResolvedValue([challenge('c1'), challenge('c2')]);
  await render(tree(false));
  await act(async () => {});

  // 두 카드의 프리플라이트가 거의 동시에 끝났다.
  await openAsyncSheet('c1');
  await openAsyncSheet('c2');

  // 한 쪽만 승인됐다 — 나머지는 계속 기다린다.
  const granted = Object.values(gateResults).filter((v) => v === 'granted');
  expect(granted).toHaveLength(1);
  expect(Object.values(gateResults).filter((v) => v === 'pending')).toHaveLength(1);

  // 승인받은 쪽이 실제로 열었다고 보고해도 — 그 시트가 떠 있는 동안은 다음 차례가 오지 않는다.
  const openedId = Object.keys(gateResults).find((id) => gateResults[id] === 'granted');
  await act(async () => {
    reportOpen?.(openedId as string, true);
  });
  await act(async () => {});
  expect(Object.values(gateResults).filter((v) => v === 'granted')).toHaveLength(1);

  // 그 시트가 닫히면 그때 다음 요청이 승인된다.
  await act(async () => {
    reportOpen?.(openedId as string, false);
  });
  await act(async () => {});
  await waitFor(() =>
    expect(Object.values(gateResults).filter((v) => v === 'granted')).toHaveLength(2),
  );
});

// 동기로 열린 시트(내기·만들기·지난 결과)가 이미 떠 있으면, 비동기 요청은 그것이 닫힐 때까지
// 기다린다 — slot은 그 시트 때문에 이미 granted지만 "하나 더 열어도 된다"는 뜻이 아니다.
test('이미 떠 있는 시트가 있으면 승인하지 않는다', async () => {
  await render(tree(false));
  await act(async () => {});

  // 카드가 동기 시트를 열었다고 보고한다(실제 카드의 지난 결과 시트에 해당).
  await act(async () => {
    reportOpen?.('c1', true);
  });
  await act(async () => {});

  await openAsyncSheet('c1');
  expect(gateResults.c1).toBe('pending');

  await act(async () => {
    reportOpen?.('c1', false);
  });
  await waitFor(() => expect(gateResults.c1).toBe('granted'));
});

// ⚠️ 그룹 전환은 **언마운트가 아니다** — 같은 GroupRoom 인스턴스가 살아서 groupId만 갈린다.
//    그래서 blur·언마운트 정리가 걸리지 않는다. 대기하던 A 카드의 요청을 그대로 두면, 나중에
//    slot이 풀렸을 때 **이미 언마운트된 A 카드**가 true를 받아 openSheet()로 A의 id를 B 화면의
//    열림 집합에 다시 넣고, 그것을 false로 되돌릴 카드가 없어 결과 오버레이가 영구히 막힌다.
test('그룹이 바뀌면 대기 중인 시트 요청을 거절한다', async () => {
  const view = await render(tree(true));
  await act(async () => {});

  await openAsyncSheet('c1');
  expect(gateResults.c1).toBe('pending');

  // 딥링크가 같은 라우트의 groupId를 B로 갈아 끼웠다(같은 인스턴스가 살아 있다).
  await act(async () => {
    view.rerender(
      <OverlaySlotProvider>
        <Holder active={false} />
        <View>
          <GroupRoomScreen groupId={OTHER_GROUP_ID} onLeft={onLeft} />
        </View>
      </OverlaySlotProvider>,
    );
  });
  await act(async () => {});

  // A의 요청은 승인되지 않는다 — 승인됐다면 B 화면에 A의 열림이 영구히 남는다.
  await waitFor(() => expect(gateResults.c1).toBe('denied'));
});

// ⚠️ 그룹 전환과 달리 **같은 그룹 안에서 카드만 사라지는** 경우가 있다(재조회에서 그 챌린지가
//    삭제·종료로 빠짐). 그때 요청을 취소하지 않으면, 나중에 slot이 풀렸을 때 **언마운트된 카드**의
//    비동기 함수가 true를 받아 openSheet()로 사라진 challengeId를 열림 집합에 넣는다.
//    그걸 false로 되돌릴 카드가 없으니 `sheetOpen`과 overlay slot이 **영구히 잠긴다.**
test('대기 중 카드가 사라지면 그 요청은 거절되고 slot이 풀린다', async () => {
  const view = await render(tree(true));
  await act(async () => {});

  await openAsyncSheet('c1');
  expect(gateResults.c1).toBe('pending');

  // 재조회에서 그 챌린지가 목록에서 빠졌다 — 카드가 요청을 문 채 언마운트된다.
  await act(async () => {
    reportGone?.('c1');
  });
  await act(async () => {});

  // 요청은 거절된다 — 사라진 카드가 나중에 열림 집합을 오염시키지 못한다.
  expect(gateResults.c1).toBe('denied');

  // 그리고 **승인 자리가 잠기지 않는다.** 보유자를 놓고 다시 요청하면 곧바로 승인된다 —
  // 사라진 카드가 자리를 문 채로 남아 있었다면 여기서 영영 막힌다.
  await act(async () => {
    view.rerender(tree(false));
  });
  await act(async () => {});

  await openAsyncSheet('c1');
  await waitFor(() => expect(gateResults.c1).toBe('granted'));
});

test('가릴 것이 없으면 곧바로 승인한다 — 평소 경로에 지연을 넣지 않는다', async () => {
  await render(tree(false));
  await act(async () => {});

  await openAsyncSheet();

  await waitFor(() => expect(gateResult).toBe('granted'));
});
