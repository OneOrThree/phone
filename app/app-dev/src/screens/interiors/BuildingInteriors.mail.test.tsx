import assert from 'node:assert/strict';
import React, { useState } from 'react';
import { Linking, Platform, StyleSheet } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { ApiError } from '@/services/api/client';
import { clearSession, saveSession } from '@/services/api/session';
import { initialState } from '@/services/model';
import {
  markUserBlocked,
  replaceBlockedUsers,
  revalidateBlockedUsers,
} from '@/services/blockedUsers';
import { blockUser, getBlockedUsers } from '@/services/api/safety';
import { InteriorRoute, InteriorScreen } from '@/screens/interiors/BuildingInteriors';
import {
  closeLetter,
  getLetter,
  getMailboxScreen,
  listIslandMessages,
  listLetters,
  listSystemLetters,
  sendIslandMessage,
  sendLetter,
} from '@/services/api/letters';

jest.mock('@/services/api/letters', () => ({
  // 시스템 편지 판별 헬퍼(isSystemLetter·isSystemLetterView)는 실제 구현을 쓴다.
  ...jest.requireActual('@/services/api/letters'),
  getMailboxScreen: jest.fn(),
  listLetters: jest.fn(),
  listSystemLetters: jest.fn(),
  getLetter: jest.fn(),
  sendLetter: jest.fn(),
  closeLetter: jest.fn(),
  listIslandMessages: jest.fn(),
  sendIslandMessage: jest.fn(),
}));

jest.mock('@/services/api/safety', () => ({
  ...jest.requireActual('@/services/api/safety'),
  blockUser: jest.fn(),
  getBlockedUsers: jest.fn(),
}));

const mockCapture = jest.fn();
jest.mock('@/services/posthog', () => ({
  captureProductEvent: (...a: unknown[]) => mockCapture(...a),
  getPostHogClient: () => null,
  initPostHog: () => {},
  trackPostHogScreen: () => {},
  identifyPostHogUser: () => {},
  resetPostHogUser: () => {},
}));

jest.mock('@/utils/layout', () => ({
  useAppLayout: () => ({
    width: 402,
    height: 874,
    fontScale: 1,
    tablet: false,
    landscape: false,
    compact: false,
    contentWidth: 402,
    gutter: 20,
    floatingWidth: 362,
    modalWidth: 362,
    insets: { top: 52, bottom: 32, left: 0, right: 0 },
  }),
}));

// 잡지 꽂이 시트(Overlay)가 안전 영역을 읽는다 — 이 파일은 Provider 없이 그린다
jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context'),
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

const ISLAND = 'island-1';
const LETTER = 'letter-1';

const screen = (letters: Record<string, unknown>[] = [], over: Record<string, unknown> = {}) => ({
  island: { id: ISLAND, name: '소다 섬', memberCount: 3, role: 'member' },
  messages: {
    items: [
      {
        id: 'm1',
        clientMessageId: 'c1',
        userId: 'u2',
        name: '민지',
        text: '오늘도 같이 하자',
        createdAt: '2026-09-20T10:00:00Z',
      },
    ],
    nextCursor: null,
  },
  letters: { content: letters, size: 20, hasNext: false, nextCursor: null },
  friends: [
    {
      userId: 'u2',
      nickname: '민지',
      mainIslandName: '하늘 섬',
      myFavorite: false,
      theirFavorite: false,
    },
  ],
  ...over,
});

const letterItem = (over: Record<string, unknown> = {}) => ({
  id: LETTER,
  counterpartUserId: 'u2',
  counterpartNickname: '민지',
  content: '반가워, 잘 지내?',
  isRead: false,
  createdAt: '2026-09-20T11:00:00Z',
  ...over,
});

// 섬 시스템 편지(강퇴·가입 승인, GROMO-2275) — 발신자가 없어 counterpartUserId 가 null 이다.
const SYSTEM_LETTER = 'sys-1';
const systemItem = (over: Record<string, unknown> = {}) => ({
  id: SYSTEM_LETTER,
  counterpartUserId: null,
  counterpartNickname: null,
  content: '소다 섬에서 나가게 됐어요',
  isRead: false,
  createdAt: '2026-09-20T12:00:00Z',
  kind: 'KICK',
  islandId: 'island-2',
  ...over,
});

const slice = (content: Record<string, unknown>[]) => ({
  content,
  size: 20,
  hasNext: false,
  nextCursor: null,
});

const letterView = (over: Record<string, unknown> = {}) => ({
  id: LETTER,
  senderId: 'u2',
  senderNickname: '민지',
  receiverId: 'u1',
  content: '반가워, 잘 지내?',
  createdAt: '2026-09-20T11:00:00Z',
  readAt: '2026-09-20T12:00:00Z',
  ...over,
});

const screenMock = getMailboxScreen as jest.Mock;
const listLettersMock = listLetters as jest.Mock;
const listSystemMock = listSystemLetters as jest.Mock;
const getLetterMock = getLetter as jest.Mock;
const sendLetterMock = sendLetter as jest.Mock;
const closeLetterMock = closeLetter as jest.Mock;
const listMessagesMock = listIslandMessages as jest.Mock;
const sendMessageMock = sendIslandMessage as jest.Mock;
const blockedUsersMock = getBlockedUsers as jest.Mock;
const blockUserMock = blockUser as jest.Mock;

/** App.tsx 가 넘기는 라우트 문맥의 최소 복제 — go/back 이 e 를 바꾸고 _tick 으로 리렌더한다. */
const makeE = (over: Record<string, unknown> = {}) => {
  const e: any = {
    route: 'mail',
    detail: '',
    tab: '받은 편지',
    text: '',
    now: Date.now(),
    state: initialState(true),
    failNext: false,
    go: jest.fn((r: string, d?: string) => {
      e.route = r;
      if (d !== undefined) e.detail = d;
      e._tick();
    }),
    back: jest.fn(() => {
      e.route = 'mail';
      e.detail = '';
      e._tick();
    }),
    replace: jest.fn((r: string, d?: string) => {
      e.route = r;
      if (d !== undefined) e.detail = d;
      e._tick();
    }),
    setTab: jest.fn((t: string) => {
      e.tab = t;
      e._tick();
    }),
    setText: jest.fn((v: string) => {
      e.text = v;
      e._tick();
    }),
    dispatch: jest.fn(),
    notify: jest.fn(),
    reset: jest.fn(),
    setFailNext: jest.fn((v: boolean) => {
      e.failNext = v;
    }),
    conversion: undefined,
    _tick: () => {},
    ...over,
  };
  return e;
};

const renderMail = async (e: any, conceptIndex = 0) => {
  const box = { e };
  const Harness = () => {
    const [, setN] = useState(0);
    if (box.e) box.e._tick = () => setN((n: number) => n + 1);
    return (
      <InteriorScreen
        buildingIndex={3}
        conceptIndex={conceptIndex}
        width={402}
        height={874}
        reduceMotion
        e={box.e}
      />
    );
  };
  const screen_ = await render(<Harness />);
  return Object.assign(screen_, {
    setE: (next: any) => {
      box.e = next;
      return screen_.rerender(<Harness />);
    },
  });
};

/** 웹 ?review·?demo 쿼리를 흉내 낸다 — Platform.OS·window.location 을 잠깐 바꿨다가 되돌린다. */
const webMockMode = (search: string) => {
  const g = globalThis as any;
  const prevOS = Platform.OS;
  const prevLoc = g.window?.location;
  (Platform as any).OS = 'web';
  Object.defineProperty(g.window, 'location', {
    value: { search },
    configurable: true,
    writable: true,
  });
  return () => {
    (Platform as any).OS = prevOS;
    Object.defineProperty(g.window, 'location', { value: prevLoc, configurable: true });
  };
};

beforeEach(async () => {
  jest.clearAllMocks();
  await clearSession();
  await saveSession({ accessToken: 'AT', refreshToken: 'RT', userId: 'u1' });
  replaceBlockedUsers([]);
  blockedUsersMock.mockResolvedValue([]);
  listSystemMock.mockResolvedValue(slice([]));
});

test('우체통 편지 칸 — 글자는 덮개 그림 아래에서 시작한다(새 편지 줄이 붙어도, GROMO-2409)', async () => {
  const ui = await renderMail(null);
  // 글자 칸은 가운데 정렬이라 줄이 늘면 위로 올라온다 — 시작선(paddingTop)이 그림 바닥보다 아래여야 덮개에 안 가린다
  for (const i of [1, 2]) {
    const card = StyleSheet.flatten(ui.getByTestId(`mail-home-${i}`).props.style);
    const art = StyleSheet.flatten(ui.getByTestId(`mail-home-${i}-art`).props.style);
    assert.ok(card.paddingTop > art.top + art.height, `칸 ${i}: 글자 시작이 그림 바닥 아래`);
  }
  await ui.unmount();
});

test('우체통 첫 칸은 고양이 잡지다 — 채팅방 칸·길이 없다(GROMO-2500)', async () => {
  const ui = await renderMail(null);
  assert.ok(ui.getByTestId('mail-home-0-art'));
  assert.ok(ui.getByText('고양이 잡지'));
  expect(ui.queryByText('우리 섬 채팅방')).toBeNull();
  await ui.unmount();
});

test('받은 편지 — 화면 묶음의 편지를 그리고 보낸 사람 이름이 보인다', async () => {
  screenMock.mockResolvedValue(screen([letterItem()]));
  const ui = await renderMail(makeE());

  await waitFor(() => assert.ok(ui.getByText('민지')));
  assert.ok(ui.getByTestId('received-letter-0'));
  assert.equal(screenMock.mock.calls.length, 1);
  await ui.unmount();
});

test('우체통은 장면을 k배 키워 그려도 뒤로 동그라미는 1/k 로 줄여 다른 건물과 같은 화면 자리·크기다', async () => {
  screenMock.mockResolvedValue(screen([]));
  const ui = await render(<InteriorRoute e={makeE()} />);
  const back = await ui.findByTestId('scene-back');
  // 402×874 창 → 316×686 시안을 k 배(작은 쪽 비율)로 키운다
  const k = Math.min(402 / 316, 874 / 686);
  const style = StyleSheet.flatten(back.props.style);
  expect(style.transform).toEqual([{ scale: 1 / k }]);
  expect(style.transformOrigin).toBe('left top');
  // 장면 좌표 × k = 화면 좌표. 게시판(k = 1)과 같은 왼쪽 9 · 위 31(안전 영역 52 이하)에 상자 모서리가 온다
  expect(style.left * k).toBeCloseTo(9);
  expect(style.top * k).toBeCloseTo(31);
  // 상자는 장면 좌표 44 를 k 배 키운 장면 안에서 1/k 로 줄이므로 화면에서도 44 다
  expect(style.width).toBe(44);
  await ui.unmount();
});

test('빈 받은 편지함 — 서버가 빈 목록을 주면 진짜 빈 상태를 그린다', async () => {
  screenMock.mockResolvedValue(screen([]));
  const ui = await renderMail(makeE());

  await waitFor(() => assert.ok(ui.getByText('기다리는 편지가 없어요.')));
  assert.equal(ui.queryByTestId('received-letter-0'), null);
  await ui.unmount();
});

test('로드 실패 — 오류 문구와 다시 시도, 재시도가 다시 읽는다', async () => {
  screenMock.mockRejectedValueOnce(
    new ApiError('CLIENT_NETWORK_ERROR', '연결을 확인해 주세요.', 0),
  );
  const ui = await renderMail(makeE());
  await waitFor(() => assert.ok(ui.getByTestId('mailbox-retry')));
  assert.ok(ui.getByText('연결을 확인해 주세요.'));

  screenMock.mockResolvedValue(screen([letterItem()]));
  await fireEvent.press(ui.getByTestId('mailbox-retry'));
  await waitFor(() => assert.ok(ui.getByTestId('received-letter-0')));
  assert.equal(screenMock.mock.calls.length, 2);
  await ui.unmount();
});

test('우편함을 읽은 뒤 차단 목록만 실패해도 다시 시도할 수 있다', async () => {
  screenMock.mockResolvedValue(screen([letterItem()]));
  await saveSession({ accessToken: 'AT-2', refreshToken: 'RT-2', userId: 'u1' });
  blockedUsersMock.mockRejectedValueOnce(new Error('blocks unavailable'));
  const ui = await renderMail(makeE());

  await waitFor(() => assert.ok(ui.getByTestId('mailbox-retry')));
  assert.ok(ui.getByText('차단 목록을 불러오지 못했어요.'));

  blockedUsersMock.mockResolvedValueOnce([]);
  await fireEvent.press(ui.getByTestId('mailbox-retry'));
  await waitFor(() => assert.ok(ui.getByTestId('received-letter-0')));
  await ui.unmount();
});

test('편지 열기 — GET 상세로 본문을 그린다(DELETE 는 나가지 않는다)', async () => {
  screenMock.mockResolvedValue(screen([letterItem()]));
  getLetterMock.mockResolvedValue(letterView());
  const e = makeE();
  const ui = await renderMail(e);
  await waitFor(() => assert.ok(ui.getByTestId('received-letter-0')));

  await fireEvent.press(ui.getByTestId('received-letter-0'));
  await waitFor(() => assert.ok(ui.getByText('반가워, 잘 지내?')));
  assert.deepEqual([...getLetterMock.mock.calls[0]], [LETTER]);
  assert.equal(closeLetterMock.mock.calls.length, 0);
  await ui.unmount();
});

test('받은 편지를 탭해 열면 feature_used(mail/read) 를 탭당 1회 발행한다', async () => {
  screenMock.mockResolvedValue(screen([letterItem()]));
  getLetterMock.mockResolvedValue(letterView());
  const ui = await renderMail(makeE());
  await waitFor(() => assert.ok(ui.getByTestId('received-letter-0')));
  mockCapture.mockClear();

  await fireEvent.press(ui.getByTestId('received-letter-0'));

  expect(mockCapture.mock.calls).toEqual([['feature_used', { building: 'mail', action: 'read' }]]);
  await ui.unmount();
});

test('열린 편지의 상대가 차단되면 무한 로딩 없이 받은 편지함으로 돌아간다', async () => {
  screenMock.mockResolvedValue(screen([letterItem()]));
  getLetterMock.mockResolvedValue(letterView());
  const e = makeE();
  const ui = await renderMail(e);
  await waitFor(() => assert.ok(ui.getByTestId('received-letter-0')));
  await fireEvent.press(ui.getByTestId('received-letter-0'));
  await waitFor(() => assert.ok(ui.getByText('반가워, 잘 지내?')));

  await act(async () => markUserBlocked('u2'));

  await waitFor(() => assert.equal(e.route, 'mail'));
  assert.equal(e.detail, '');
  assert.ok(ui.getByText('기다리는 편지가 없어요.'));
  assert.equal(ui.queryByText('편지를 여는 중이에요…'), null);
  await ui.unmount();
});

test('받은 편지 상세 더보기는 신고 없이 발신자 차단 시트로 진입한다', async () => {
  screenMock.mockResolvedValue(screen([letterItem()]));
  getLetterMock.mockResolvedValue(letterView());
  const ui = await renderMail(makeE());
  await waitFor(() => assert.ok(ui.getByTestId('received-letter-0')));
  await fireEvent.press(ui.getByTestId('received-letter-0'));
  await waitFor(() => assert.ok(ui.getByLabelText('민지 더보기')));

  await fireEvent.press(ui.getByLabelText('민지 더보기'));

  assert.equal(ui.queryByText('신고하기'), null);
  assert.ok(ui.getByText('차단하기'));
  await ui.unmount();
});

test('시스템 편지 — 발신자가 없으면 받은함에 「섬 알림」으로 보이고 친구 편지와 최신순으로 섞인다', async () => {
  screenMock.mockResolvedValue(screen([letterItem()]));
  listSystemMock.mockResolvedValue(slice([systemItem()]));
  const ui = await renderMail(makeE());

  await waitFor(() => assert.ok(ui.getByLabelText('섬 알림의 편지 열기')));
  assert.equal(listSystemMock.mock.calls.length, 1);
  // 시스템 편지가 더 최근(12시)이라 맨 위, 친구 편지(11시)가 그 아래다.
  assert.equal(ui.getByTestId('received-letter-0').props.accessibilityLabel, '섬 알림의 편지 열기');
  assert.equal(ui.getByTestId('received-letter-1').props.accessibilityLabel, '민지의 편지 열기');
  await ui.unmount();
});

test('시스템 편지 상세 — 발신자는 「섬 알림」이고 답장 버튼·더보기(차단)가 없다', async () => {
  screenMock.mockResolvedValue(screen([]));
  listSystemMock.mockResolvedValue(slice([systemItem()]));
  getLetterMock.mockResolvedValue(
    letterView({
      id: SYSTEM_LETTER,
      senderId: null,
      senderNickname: null,
      content: '소다 섬에서 나가게 됐어요',
      kind: 'KICK',
    }),
  );
  const ui = await renderMail(makeE());
  await waitFor(() => assert.ok(ui.getByTestId('received-letter-0')));

  await fireEvent.press(ui.getByTestId('received-letter-0'));

  await waitFor(() => assert.ok(ui.getByText('소다 섬에서 나가게 됐어요')));
  assert.ok(ui.getByText('섬 알림'));
  // 닫기는 남는다 — 시스템 편지도 읽고 닫으면 사라진다.
  assert.ok(ui.getByTestId('close-letter'));
  expect(ui.queryByTestId('reply-to-letter')).toBeNull();
  expect(ui.queryByLabelText('섬 알림 더보기')).toBeNull();
  await ui.unmount();
});

test('시스템 편지 — kind 가 있으면 발신자 id·닉네임이 채워져 와도 「섬 알림」이고 답장·더보기가 없다', async () => {
  const filled = { counterpartUserId: 'u9', counterpartNickname: '방장' };
  screenMock.mockResolvedValue(screen([]));
  listSystemMock.mockResolvedValue(slice([systemItem(filled)]));
  getLetterMock.mockResolvedValue(
    letterView({
      id: SYSTEM_LETTER,
      senderId: 'u9',
      senderNickname: '방장',
      content: '소다 섬에서 나가게 됐어요',
      kind: 'KICK',
    }),
  );
  const ui = await renderMail(makeE());
  await waitFor(() => assert.ok(ui.getByLabelText('섬 알림의 편지 열기')));
  expect(ui.queryByLabelText('방장의 편지 열기')).toBeNull();

  await fireEvent.press(ui.getByTestId('received-letter-0'));

  await waitFor(() => assert.ok(ui.getByText('소다 섬에서 나가게 됐어요')));
  assert.ok(ui.getByText('섬 알림'));
  expect(ui.queryByText('방장')).toBeNull();
  expect(ui.queryByTestId('reply-to-letter')).toBeNull();
  expect(ui.queryByLabelText('방장 더보기')).toBeNull();
  expect(ui.queryByLabelText('섬 알림 더보기')).toBeNull();
  await ui.unmount();
});

test('회귀 — 친구 편지 상세는 답장 버튼과 「민지 더보기」가 그대로 있다', async () => {
  screenMock.mockResolvedValue(screen([letterItem()]));
  listSystemMock.mockResolvedValue(slice([systemItem()]));
  getLetterMock.mockResolvedValue(letterView());
  const ui = await renderMail(makeE());
  await waitFor(() => assert.ok(ui.getByLabelText('민지의 편지 열기')));

  await fireEvent.press(ui.getByLabelText('민지의 편지 열기'));

  await waitFor(() => assert.ok(ui.getByTestId('reply-to-letter')));
  assert.ok(ui.getByLabelText('민지 더보기'));
  await ui.unmount();
});

test('안 읽음 수는 친구 편지 + 시스템 편지를 함께 센다(GROMO-2489)', async () => {
  // 안 읽은 시스템 편지 1 + 안 읽은 친구 편지 1 + 읽은 친구 편지 1 → 2통, 행은 3개
  screenMock.mockResolvedValue(
    screen([letterItem(), letterItem({ id: 'letter-2', isRead: true, content: '읽은 편지' })]),
  );
  listSystemMock.mockResolvedValue(slice([systemItem()]));
  const inbox = await renderMail(makeE());

  await waitFor(() => assert.ok(inbox.getByText('아직 열지 않은 편지 2통')));
  assert.equal(inbox.getAllByTestId(/^received-letter-/).length, 3);
  await inbox.unmount();

  // 첫 화면 「새 편지 N통」도 같은 기준이고, 받은 편지 칸 모서리에 느낌표 배지가 붙는다
  const home = await renderMail(makeE({ tab: '' }));
  await waitFor(() => assert.ok(home.getByText('새 편지 2통')));
  assert.ok(home.getByTestId('mail-home-inbox-new-indicator', { includeHiddenElements: true }));
  assert.equal(
    home.getByTestId('mail-home-1').props.accessibilityLabel,
    '받은 편지 열기, 새 편지 2통',
  );
  await home.unmount();
});

test('시스템 편지 1통만 안 읽어도 받은 편지 칸 배지·「새 편지 1통」이 뜨고, 읽으면 사라진다(GROMO-2489)', async () => {
  screenMock.mockResolvedValue(screen([]));
  listSystemMock.mockResolvedValue(slice([systemItem()]));
  const e = makeE({ tab: '' });
  const unread = await renderMail(e);
  await waitFor(() => assert.ok(unread.getByText('새 편지 1통')));
  assert.ok(unread.getByTestId('mail-home-inbox-new-indicator', { includeHiddenElements: true }));
  assert.equal(
    unread.getByTestId('mail-home-1').props.accessibilityLabel,
    '받은 편지 열기, 새 편지 1통',
  );
  // 같은 화면에서 받은함으로 가 그 시스템 편지를 열어 읽은(readAt 있음 → 목록의 isRead 갱신) 뒤
  // 뒤로가기로 받은함 → 우체통 안으로 — 배지·새 편지 줄이 없고 라벨은 평소대로
  getLetterMock.mockResolvedValue(
    letterView({
      id: SYSTEM_LETTER,
      senderId: null,
      senderNickname: null,
      content: '소다 섬에서 나가게 됐어요',
      kind: 'KICK',
    }),
  );
  await act(async () => e.setTab('받은 편지'));
  await waitFor(() => assert.ok(unread.getByTestId('received-letter-0')));
  await fireEvent.press(unread.getByTestId('received-letter-0'));
  await waitFor(() => assert.ok(unread.getByText('소다 섬에서 나가게 됐어요')));
  await act(async () => e.back());
  await act(async () => e.setTab(''));
  await waitFor(() => assert.ok(unread.getByTestId('mail-home-1')));
  expect(unread.queryByText(/새 편지 \d+통/)).toBeNull();
  expect(
    unread.queryByTestId('mail-home-inbox-new-indicator', { includeHiddenElements: true }),
  ).toBeNull();
  assert.equal(unread.getByTestId('mail-home-1').props.accessibilityLabel, '받은 편지 열기');
  await unread.unmount();
});

test('편지 더보기의 차단은 유지하고 개별 신고 메일은 열지 않는다', async () => {
  screenMock.mockResolvedValue(screen([letterItem()]));
  getLetterMock.mockResolvedValue(letterView());
  blockUserMock.mockResolvedValue(undefined);
  const openUrl = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
  const ui = await renderMail(makeE());
  await waitFor(() => assert.ok(ui.getByTestId('received-letter-0')));
  await fireEvent.press(ui.getByTestId('received-letter-0'));
  await waitFor(() => assert.ok(ui.getByLabelText('민지 더보기')));
  await fireEvent.press(ui.getByLabelText('민지 더보기'));
  assert.equal(ui.queryByText('신고하기'), null);
  await fireEvent.press(ui.getByText('차단하기'));
  await fireEvent.press(ui.getByText('차단'));
  await waitFor(() => assert.equal(blockUserMock.mock.calls.length, 1));
  assert.equal(openUrl.mock.calls.length, 0);
  openUrl.mockRestore();
  await ui.unmount();
});

test('상세 실패 — 오류와 다시 시도를 보여 주고 캐시된 편지를 대신 그리지 않는다', async () => {
  screenMock.mockResolvedValue(screen([letterItem()]));
  getLetterMock.mockRejectedValue(new ApiError('CLIENT_TIMEOUT', '시간이 지났어요.', 0));
  const e = makeE();
  const ui = await renderMail(e);
  await waitFor(() => assert.ok(ui.getByTestId('received-letter-0')));

  await fireEvent.press(ui.getByTestId('received-letter-0'));
  await waitFor(() => assert.ok(ui.getByTestId('letter-retry')));
  assert.ok(ui.getByText('시간이 지났어요.'));
  assert.equal(ui.queryByText('반가워, 잘 지내?'), null);
  await ui.unmount();
});

test('열린 편지의 차단 목록 재검증 실패는 오류를 보이고 다시 시도해 복구한다', async () => {
  screenMock.mockResolvedValue(screen([letterItem()]));
  getLetterMock.mockResolvedValue(letterView());
  const ui = await renderMail(makeE());
  await waitFor(() => assert.ok(ui.getByTestId('received-letter-0')));
  await fireEvent.press(ui.getByTestId('received-letter-0'));
  await waitFor(() => assert.ok(ui.getByTestId('close-letter')));
  blockedUsersMock.mockRejectedValueOnce(new Error('blocks unavailable'));

  await act(async () => revalidateBlockedUsers().catch(() => {}));

  await waitFor(() => assert.ok(ui.getByTestId('letter-retry')));
  assert.ok(ui.getByText('차단 목록을 불러오지 못했어요.'));

  blockedUsersMock.mockResolvedValueOnce([]);
  await fireEvent.press(ui.getByTestId('letter-retry'));

  await waitFor(() => assert.ok(ui.getByTestId('close-letter')));
  assert.equal(getLetterMock.mock.calls.length >= 2, true);
  await ui.unmount();
});

test('닫기 — DELETE 성공 뒤 양쪽 목록을 재조회하고 받은 편지함으로 돌아간다', async () => {
  screenMock.mockResolvedValue(screen([letterItem()]));
  getLetterMock.mockResolvedValue(letterView());
  closeLetterMock.mockResolvedValue(undefined);
  listLettersMock.mockResolvedValue({ content: [], size: 20, hasNext: false, nextCursor: null });
  const e = makeE();
  const ui = await renderMail(e);
  await waitFor(() => assert.ok(ui.getByTestId('received-letter-0')));

  await fireEvent.press(ui.getByTestId('received-letter-0'));
  await waitFor(() => assert.ok(ui.getByTestId('close-letter')));
  await fireEvent.press(ui.getByTestId('close-letter'));

  await waitFor(() => assert.equal(e.back.mock.calls.length, 1));
  // jest 목업 인자는 realm 이 달라 deepStrictEqual 이 흔들린다 — 문자열로 비교한다.
  assert.equal(closeLetterMock.mock.calls.map((c) => c[0]).join(','), LETTER);
  assert.equal(listLettersMock.mock.calls.map((c) => c[0]).join(','), 'received,sent');
  await waitFor(() => assert.ok(ui.getByText('기다리는 편지가 없어요.')));
  await ui.unmount();
});

test('닫기 실패 — 오류를 보이고 편지를 닫지 않는다(가짜 성공 금지)', async () => {
  screenMock.mockResolvedValue(screen([letterItem()]));
  getLetterMock.mockResolvedValue(letterView());
  closeLetterMock.mockRejectedValue(new ApiError('CLIENT_NETWORK_ERROR', '네트워크 오류', 0));
  const e = makeE();
  const ui = await renderMail(e);
  await waitFor(() => assert.ok(ui.getByTestId('received-letter-0')));
  await fireEvent.press(ui.getByTestId('received-letter-0'));
  await waitFor(() => assert.ok(ui.getByTestId('close-letter')));

  await fireEvent.press(ui.getByTestId('close-letter'));
  await waitFor(() => assert.ok(e.notify.mock.calls.length > 0));
  assert.equal(e.back.mock.calls.length, 0);
  assert.equal(listLettersMock.mock.calls.length, 0);
  await ui.unmount();
});

test('편지 보내기 — POST 성공 뒤 초안을 비우고 목록으로 돌아간다', async () => {
  screenMock.mockResolvedValue(screen([]));
  sendLetterMock.mockResolvedValue(letterView({ receiverId: 'u2' }));
  listLettersMock.mockResolvedValue({ content: [], size: 20, hasNext: false, nextCursor: null });
  const e = makeE({ route: 'friendMail', detail: 'u2', text: '잘 지내?' });
  const ui = await renderMail(e);
  await waitFor(() => assert.ok(ui.getByTestId('friend-letter-input')));

  await fireEvent.press(ui.getByTestId('stamp-action'));
  await waitFor(() => assert.equal(e.reset.mock.calls.length, 1));
  assert.deepEqual(sendLetterMock.mock.calls[0][0], { receiverId: 'u2', content: '잘 지내?' });
  assert.equal(e.text, '');
  await ui.unmount();
});

test('편지 보내기 실패 — 초안을 그대로 두고 오류를 알린다', async () => {
  screenMock.mockResolvedValue(screen([]));
  sendLetterMock.mockRejectedValue(new ApiError('CLIENT_NETWORK_ERROR', '네트워크 오류', 0));
  const e = makeE({ route: 'friendMail', detail: 'u2', text: '잘 지내?' });
  const ui = await renderMail(e);
  await waitFor(() => assert.ok(ui.getByTestId('friend-letter-input')));

  await fireEvent.press(ui.getByTestId('stamp-action'));
  await waitFor(() => assert.ok(e.notify.mock.calls.length > 0));
  assert.equal(e.reset.mock.calls.length, 0);
  assert.equal(e.text, '잘 지내?');
  await ui.unmount();
});

test('게스트 발송 거절 — SOCIAL_LOGIN_REQUIRED 는 회원 전환 시트로 보낸다', async () => {
  screenMock.mockResolvedValue(screen([]));
  sendLetterMock.mockRejectedValue(
    new ApiError('SOCIAL_LOGIN_REQUIRED', '회원 연동이 필요합니다.', 403),
  );
  const offer = jest.fn(() => true);
  const e = makeE({ route: 'friendMail', detail: 'u2', text: 'x', conversion: { offer } });
  const ui = await renderMail(e);
  await waitFor(() => assert.ok(ui.getByTestId('friend-letter-input')));

  await fireEvent.press(ui.getByTestId('stamp-action'));
  await waitFor(() => assert.equal(offer.mock.calls.length, 1));
  assert.equal(e.notify.mock.calls.length, 0);
  assert.equal(e.reset.mock.calls.length, 0);
  await ui.unmount();
});

test('목업 ?review — e 가 있어도 우체통 API 는 0건이다', async () => {
  const restore = webMockMode('?review');
  try {
    const ui = await renderMail(makeE());
    await act(async () => {});
    for (const m of [
      screenMock,
      listLettersMock,
      listSystemMock,
      getLetterMock,
      sendLetterMock,
      closeLetterMock,
      listMessagesMock,
      sendMessageMock,
    ])
      assert.equal(m.mock.calls.length, 0);
    // 목업 받은 편지함(로컬 상태의 빈 목록)은 그대로 보인다.
    assert.ok(ui.getByText('기다리는 편지가 없어요.'));
    await ui.unmount();
  } finally {
    restore();
  }
});

// 「없다」는 expect(...).toBeNull() 로 본다 — assert.equal(인스턴스, null) 은 실패하면 테스트 인스턴스 트리를 통째로
// 찍다가 jest 가 메모리 부족으로 죽는다(출력 없이 exit 137)
test('우체통 첫 화면에는 「우리 섬 홍보 쓰기」 입구가 없다 — 섬장이어도(홍보는 마을회관에서, 10/14)', async () => {
  const restore = webMockMode('?review');
  try {
    const host = makeE({ tab: '' });
    const ui = await renderMail(host);
    assert.ok(ui.getByTestId('mail-home-0'));
    expect(ui.queryByTestId('mail-home-promotion')).toBeNull();
    expect(ui.queryByText('우리 섬 홍보 쓰기')).toBeNull();
    await ui.unmount();
  } finally {
    restore();
  }
});

test('우체통 첫 칸 고양이 잡지 — 누르면 최근 호(안 읽음 점), 칸 안 [지난 호] 는 잡지 꽂이(GROMO-2500 C안)', async () => {
  const restore = webMockMode('?review');
  try {
    const issue = {
      issueId: 'mock-issue-19',
      issueNo: 19,
      issueDate: '2026-10-14',
      publishedAt: '2026-10-13T22:00:00Z',
      current: true,
    };
    const e = makeE({ tab: '', magazineToday: { issue, receipt: null } });
    const ui = await renderMail(e);
    assert.ok(ui.getByText('고양이 잡지'));
    assert.ok(ui.getByText('19호'));
    assert.equal(
      ui.getByTestId('mail-home-magazine').props.accessibilityLabel,
      '고양이 잡지 보기 19호, 아직 안 읽음',
    );
    // 빨간 점은 칸 테두리 안쪽 오른쪽 위에 있다
    const dot = StyleSheet.flatten(ui.getByTestId('mail-home-magazine-dot').props.style);
    assert.ok(dot.top > 0 && dot.right > 0);
    await fireEvent.press(ui.getByTestId('mail-home-magazine'));
    expect(e.go).toHaveBeenCalledWith('magazine', 'mock-issue-19');
    // [지난 호] 는 누르는 자리가 44 이상이다
    const rack = StyleSheet.flatten(ui.getByTestId('mail-home-rack').props.style);
    assert.ok(rack.minHeight >= 44);
    assert.equal(ui.getByTestId('mail-home-rack').props.accessibilityLabel, '지난 호');
    await fireEvent.press(ui.getByTestId('mail-home-rack'));
    await waitFor(() => assert.ok(ui.getByTestId('magazine-rack-13')));
    await fireEvent.press(ui.getByTestId('magazine-rack-17'));
    expect(e.go).toHaveBeenCalledWith('magazine', 'mock-issue-17');
    // 위쪽 알약 줄(잡지 보기·꽂이)은 없다
    expect(ui.queryByText('고양이 잡지 보기 · 19호')).toBeNull();
    expect(ui.queryByText('잡지 꽂이')).toBeNull();
    await ui.unmount();

    // 읽은 오늘 호는 점이 없다 · 발행이 늦어 지난 호만 있어도 칸은 그 호를 연다 · 잡지가 아예 없으면 칸만 남고 꽂이는 없다
    const read = await renderMail(
      makeE({
        tab: '',
        magazineToday: {
          issue,
          receipt: { place: 'ISLAND', receivedAt: 'a', deferredAt: null, openedAt: 'b' },
        },
      }),
    );
    expect(read.queryByTestId('mail-home-magazine-dot')).toBeNull();
    await read.unmount();
    const staleE = makeE({
      tab: '',
      magazineToday: { issue: { ...issue, current: false }, receipt: null },
    });
    const stale = await renderMail(staleE);
    await fireEvent.press(stale.getByTestId('mail-home-magazine'));
    expect(staleE.go).toHaveBeenCalledWith('magazine', 'mock-issue-19');
    assert.ok(stale.getByTestId('mail-home-rack'));
    await stale.unmount();
    const noneE = makeE({ tab: '' });
    const none = await renderMail(noneE);
    expect(none.queryByTestId('mail-home-rack')).toBeNull();
    expect(none.queryByText('19호')).toBeNull();
    assert.equal(none.getByTestId('mail-home-magazine').props.accessibilityState?.disabled, true);
    await none.unmount();
  } finally {
    restore();
  }
});
