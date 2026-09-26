import assert from 'node:assert/strict';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { ApiError } from '@/services/api/client';
import { clearSession, saveSession } from '@/services/api/session';
import {
  closeLetter,
  getLetter,
  getMailboxScreen,
  listIslandMessages,
  listLetters,
  sendIslandMessage,
  sendLetter,
} from '@/services/api/letters';
import { useMailbox } from '@/screens/interiors/useMailbox';

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

const letterItem = (over: Record<string, unknown> = {}) => ({
  id: LETTER,
  counterpartUserId: 'u2',
  counterpartNickname: '민지',
  content: '반가워',
  isRead: false,
  createdAt: '2026-09-20T11:00:00Z',
  ...over,
});

const screen = (over: Record<string, unknown> = {}) => ({
  island: { id: ISLAND, name: '소다 섬', memberCount: 3, role: 'member' },
  messages: {
    items: [
      {
        id: 'm1',
        clientMessageId: 'c1',
        userId: 'u2',
        name: '민지',
        text: '안녕',
        createdAt: '2026-09-20T10:00:00Z',
      },
    ],
    nextCursor: null,
  },
  letters: { content: [letterItem()], size: 20, hasNext: false, nextCursor: null },
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

const letterView = (over: Record<string, unknown> = {}) => ({
  id: LETTER,
  senderId: 'u2',
  senderNickname: '민지',
  receiverId: 'u1',
  content: '반가워',
  createdAt: '2026-09-20T11:00:00Z',
  readAt: '2026-09-20T12:00:00Z',
  ...over,
});

const slice = (content: Record<string, unknown>[], nextCursor: string | null = null) => ({
  content,
  size: 20,
  hasNext: nextCursor !== null,
  nextCursor,
});

const screenMock = getMailboxScreen as jest.Mock;
const listLettersMock = listLetters as jest.Mock;
const getLetterMock = getLetter as jest.Mock;
const sendLetterMock = sendLetter as jest.Mock;
const closeLetterMock = closeLetter as jest.Mock;
const listMessagesMock = listIslandMessages as jest.Mock;
const sendMessageMock = sendIslandMessage as jest.Mock;

const mount = async (
  over: { active?: boolean; scopeKey?: string; onLetterRead?: (letterId: string) => void } = {},
) => {
  const hook = await renderHook(
    (p: { active: boolean; scopeKey: string; onLetterRead?: (letterId: string) => void }) =>
      useMailbox(p),
    {
      initialProps: {
        active: over.active ?? true,
        scopeKey: over.scopeKey ?? 's1',
        onLetterRead: over.onLetterRead,
      },
    },
  );
  if (over.active !== false) await waitFor(() => assert.equal(hook.result.current.loading, false));
  return hook;
};

beforeEach(async () => {
  jest.clearAllMocks();
  await clearSession();
  await saveSession({ accessToken: 'AT', refreshToken: 'RT', userId: 'u1' });
  screenMock.mockResolvedValue(screen());
});

test('로드 — 화면 묶음의 섬·낙서·받은 편지·친구를 그대로 채운다', async () => {
  const hook = await mount();
  const s = hook.result.current;
  assert.equal(s.islandId, ISLAND);
  assert.equal(s.islandName, '소다 섬');
  assert.equal(s.memberCount, 3);
  assert.equal(s.myId, 'u1');
  assert.equal(s.letters.length, 1);
  assert.equal(s.letters[0].id, LETTER);
  assert.equal(s.messages.length, 1);
  assert.equal(s.friends[0].userId, 'u2');
  await hook.unmount();
});

test('비활성 — API 를 하나도 부르지 않는다', async () => {
  const hook = await mount({ active: false });
  await act(async () => {});
  assert.equal(screenMock.mock.calls.length, 0);
  assert.equal(listLettersMock.mock.calls.length, 0);
  await hook.unmount();
});

test('편지 열기 — GET 상세를 싣고 목록 항목의 isRead 를 서버 readAt 으로 맞춘다', async () => {
  getLetterMock.mockResolvedValue(letterView());
  const onLetterRead = jest.fn();
  const hook = await mount({ onLetterRead });

  await act(async () => {
    await hook.result.current.openLetter(LETTER);
  });

  assert.equal(getLetterMock.mock.calls.length, 1);
  assert.equal(hook.result.current.detail?.id, LETTER);
  assert.equal(hook.result.current.letters[0].isRead, true);
  expect(onLetterRead).toHaveBeenCalledWith(LETTER);
  // 열기는 닫기가 아니다 — DELETE 는 나가지 않는다.
  assert.equal(closeLetterMock.mock.calls.length, 0);
  await hook.unmount();
});

test('상세 403/404 — 그 편지의 목록 캐시를 지우고 오류를 보인다', async () => {
  getLetterMock.mockRejectedValue(new ApiError('FORBIDDEN', '권한이 없습니다.', 403));
  const hook = await mount();

  await act(async () => {
    await hook.result.current.openLetter(LETTER);
  });

  assert.equal(hook.result.current.detail, null);
  assert.equal(hook.result.current.detailError?.status, 403);
  // 캐시된 편지가 다시 보이지 않는다.
  assert.equal(hook.result.current.letters.length, 0);
  await hook.unmount();
});

test('로드 403 — 화면 캐시를 비우고 오류·재시도만 남긴다', async () => {
  screenMock.mockRejectedValue(new ApiError('FORBIDDEN', '권한이 없습니다.', 403));
  const hook = await renderHook(() => useMailbox({ active: true, scopeKey: 's1' }));
  await waitFor(() => assert.equal(hook.result.current.loading, false));

  assert.equal(hook.result.current.error?.status, 403);
  assert.deepEqual(hook.result.current.letters, []);
  assert.deepEqual(hook.result.current.messages, []);
  assert.deepEqual(hook.result.current.friends, []);
  await hook.unmount();
});

test('닫기 — DELETE 성공 뒤 받은·보낸 목록을 함께 재조회한다', async () => {
  closeLetterMock.mockResolvedValue(undefined);
  const hook = await mount();
  listLettersMock.mockImplementation((type: string) =>
    Promise.resolve(slice(type === 'received' ? [] : [{ ...letterItem(), id: 'out-1' }])),
  );

  await act(async () => {
    await hook.result.current.close(LETTER);
  });

  assert.equal(closeLetterMock.mock.calls.length, 1);
  // jest 목업 인자는 realm 이 달라 deepStrictEqual 이 흔들린다 — 문자열로 비교한다.
  assert.equal(listLettersMock.mock.calls.map((c) => c[0]).join(','), 'received,sent');
  assert.equal(hook.result.current.letters.length, 0);
  assert.equal(hook.result.current.sent.length, 1);
  await hook.unmount();
});

test('닫기 재시도 — 이미 닫힌 404 도 성공으로 접고 목록을 재조회한다', async () => {
  // 첫 응답 유실 뒤 같은 의도의 재시도 — 서버는 이미 지웠으므로 404.
  closeLetterMock.mockRejectedValue(new ApiError('NOT_FOUND', '편지를 찾을 수 없습니다.', 404));
  const hook = await mount();
  listLettersMock.mockResolvedValue(slice([]));

  await act(async () => {
    await hook.result.current.close(LETTER);
  });

  assert.equal(hook.result.current.letters.length, 0);
  assert.equal(listLettersMock.mock.calls.length, 2);
  await hook.unmount();
});

test('닫기 실패 — 오류를 던지고 편지를 숨기지 않는다(가짜 성공 금지)', async () => {
  closeLetterMock.mockRejectedValue(new ApiError('CLIENT_NETWORK_ERROR', '네트워크 오류', 0));
  const hook = await mount();

  let error: ApiError | null = null;
  await act(async () => {
    error = await hook.result.current.close(LETTER).then(
      () => null,
      (e) => e as ApiError,
    );
  });

  assert.equal((error as ApiError | null)?.code, 'CLIENT_NETWORK_ERROR');
  assert.equal(hook.result.current.letters.length, 1);
  assert.equal(listLettersMock.mock.calls.length, 0);
  assert.equal(hook.result.current.closing, false);
  await hook.unmount();
});

test('발송 — POST 성공 시 생성된 편지를 돌려주고 목록을 다시 읽는다', async () => {
  sendLetterMock.mockResolvedValue(letterView({ receiverId: 'u2' }));
  const hook = await mount();
  listLettersMock.mockResolvedValue(slice([]));

  let created: unknown;
  await act(async () => {
    created = await hook.result.current.send('u2', '잘 지내?');
  });

  assert.deepEqual(sendLetterMock.mock.calls[0][0], { receiverId: 'u2', content: '잘 지내?' });
  assert.equal((created as { id: string }).id, LETTER);
  assert.equal(listLettersMock.mock.calls.length, 2);
  await hook.unmount();
});

test('발송 실패 — 오류를 그대로 던진다(로컬 성공 합성 없음)', async () => {
  sendLetterMock.mockRejectedValue(
    new ApiError('SOCIAL_LOGIN_REQUIRED', '회원 연동이 필요합니다.', 403),
  );
  const hook = await mount();

  let error: ApiError | null = null;
  await act(async () => {
    error = await hook.result.current.send('u2', 'x').then(
      () => null,
      (e) => e as ApiError,
    );
  });

  assert.equal((error as ApiError | null)?.code, 'SOCIAL_LOGIN_REQUIRED');
  assert.equal(hook.result.current.sending, false);
  await hook.unmount();
});

test('발송 중복 탭 — 진행 중에는 두 번째 호출을 거절한다', async () => {
  let resolveSend!: (v: unknown) => void;
  sendLetterMock.mockReturnValue(new Promise((res) => (resolveSend = res)));
  const hook = await mount();

  let error: ApiError | null = null;
  let first: Promise<unknown> | undefined;
  await act(async () => {
    first = hook.result.current.send('u2', 'x');
    error = await hook.result.current.send('u2', 'x').then(
      () => null,
      (e) => e as ApiError,
    );
  });
  assert.equal((error as ApiError | null)?.code, 'CLIENT_WRITE_IN_PROGRESS');
  assert.equal(sendLetterMock.mock.calls.length, 1);

  listLettersMock.mockResolvedValue(slice([]));
  await act(async () => {
    resolveSend(letterView());
    await first;
  });
  await hook.unmount();
});

test('낙서 보내기 — 실패 뒤 같은 본문 재시도는 같은 clientMessageId 로 간다', async () => {
  const hook = await mount();
  sendMessageMock
    .mockRejectedValueOnce(new ApiError('CLIENT_NETWORK_ERROR', '네트워크 오류', 0))
    .mockResolvedValueOnce({
      id: 'm9',
      clientMessageId: 'key',
      userId: 'u1',
      name: '나',
      text: '같이 해요',
      createdAt: '2026-09-20T12:00:00Z',
    });

  await act(async () => {
    await hook.result.current.sendMessage('같이 해요').catch(() => {});
  });
  assert.equal(hook.result.current.messages.length, 1); // 실패 글을 목록에 합성하지 않는다

  await act(async () => {
    await hook.result.current.sendMessage('같이 해요');
  });
  const firstKey = sendMessageMock.mock.calls[0][1].clientMessageId;
  const retryKey = sendMessageMock.mock.calls[1][1].clientMessageId;
  assert.equal(firstKey, retryKey);
  assert.equal(hook.result.current.messages.length, 2);
  assert.equal(hook.result.current.messages[1].id, 'm9');
  await hook.unmount();
});

test('낙서 더 보기 — 다음 커서의 더 오래된 글을 앞에 붙인다', async () => {
  screenMock.mockResolvedValue(
    screen({ messages: { items: [screen().messages.items[0]], nextCursor: 'old-1' } }),
  );
  const hook = await mount();
  listMessagesMock.mockResolvedValue({
    items: [
      {
        id: 'm0',
        clientMessageId: 'c0',
        userId: 'u3',
        name: '보리',
        text: '예전 글',
        createdAt: '2026-09-19T10:00:00Z',
      },
    ],
    nextCursor: null,
  });

  await act(async () => {
    await hook.result.current.loadMoreMessages();
  });

  assert.equal(listMessagesMock.mock.calls.map((c) => c.join(',')).join('|'), `${ISLAND},old-1`);
  assert.deepEqual(
    hook.result.current.messages.map((m) => m.id),
    ['m0', 'm1'],
  );
  await hook.unmount();
});

test('편지 더 보기 — 커서로 다음 페이지를 붙이고 id 중복을 막는다', async () => {
  screenMock.mockResolvedValue(
    screen({ letters: { ...slice([letterItem()]), nextCursor: 'cur-1' } }),
  );
  const hook = await mount();
  listLettersMock.mockResolvedValue(
    slice([letterItem(), letterItem({ id: 'letter-2', isRead: true })]),
  );

  await act(async () => {
    await hook.result.current.loadMoreLetters();
  });

  assert.equal(listLettersMock.mock.calls.map((c) => c.join(',')).join('|'), 'received,cur-1');
  assert.deepEqual(
    hook.result.current.letters.map((l) => l.id),
    [LETTER, 'letter-2'],
  );
  await hook.unmount();
});
