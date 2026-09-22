import assert from 'node:assert/strict';
import React, { useState } from 'react';
import { Platform } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { ApiError } from '@/services/api/client';
import { clearSession, saveSession } from '@/services/api/session';
import { initialState } from '@/services/model';
import { InteriorScreen } from '@/screens/interiors/BuildingInteriors';
import {
  closeLetter,
  getLetter,
  getMailboxScreen,
  listIslandMessages,
  listLetters,
  sendIslandMessage,
  sendLetter,
} from '@/services/api/letters';

jest.mock('@/services/api/letters', () => ({
  getMailboxScreen: jest.fn(),
  listLetters: jest.fn(),
  getLetter: jest.fn(),
  sendLetter: jest.fn(),
  closeLetter: jest.fn(),
  listIslandMessages: jest.fn(),
  sendIslandMessage: jest.fn(),
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
const getLetterMock = getLetter as jest.Mock;
const sendLetterMock = sendLetter as jest.Mock;
const closeLetterMock = closeLetter as jest.Mock;
const listMessagesMock = listIslandMessages as jest.Mock;
const sendMessageMock = sendIslandMessage as jest.Mock;

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
});

test('받은 편지 — 화면 묶음의 편지를 그리고 보낸 사람 이름이 보인다', async () => {
  screenMock.mockResolvedValue(screen([letterItem()]));
  const ui = await renderMail(makeE());

  await waitFor(() => assert.ok(ui.getByText('민지')));
  assert.ok(ui.getByTestId('received-letter-0'));
  assert.equal(screenMock.mock.calls.length, 1);
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

test('채팅방 — 서버 낙서를 그리고 보내기는 POST messages 로 간다', async () => {
  screenMock.mockResolvedValue(screen([]));
  sendMessageMock.mockResolvedValue({
    id: 'm9',
    clientMessageId: 'k1',
    userId: 'u1',
    name: '나',
    text: '같이 해요',
    createdAt: '2026-09-20T12:00:00Z',
  });
  const e = makeE({ route: 'chat', text: '같이 해요' });
  const ui = await renderMail(e);
  await waitFor(() => assert.ok(ui.getByText('오늘도 같이 하자')));

  await fireEvent.press(ui.getByTestId('island-message-send'));
  await waitFor(() => assert.equal(sendMessageMock.mock.calls.length, 1));
  assert.equal(sendMessageMock.mock.calls[0][0], ISLAND);
  assert.equal(sendMessageMock.mock.calls[0][1].text, '같이 해요');
  assert.equal(typeof sendMessageMock.mock.calls[0][1].clientMessageId, 'string');
  await waitFor(() => assert.ok(ui.getByText('같이 해요')));
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
