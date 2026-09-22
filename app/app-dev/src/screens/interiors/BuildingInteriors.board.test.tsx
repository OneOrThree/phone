import assert from 'node:assert/strict';
import React, { useState } from 'react';
import { Platform } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { ApiError } from '@/services/api/client';
import { clearSession, saveSession } from '@/services/api/session';
import {
  createNotice as postNotice,
  createNoticeComment as postComment,
  deleteNotice as delNotice,
  getBoard,
  getNotice,
  listNotices,
  updateNotice as patchNotice,
} from '@/services/api/notices';
import { initialState } from '@/services/model';
import { Board, type Concept } from '@/screens/interiors/BuildingInteriors';
import { HOME_QUEST_LIST_DETAIL } from '@/screens/island/HomeQuestIndicator';

jest.mock('@/services/api/notices', () => ({
  getBoard: jest.fn(),
  listNotices: jest.fn(),
  getNotice: jest.fn(),
  createNotice: jest.fn(),
  updateNotice: jest.fn(),
  deleteNotice: jest.fn(),
  createNoticeComment: jest.fn(),
}));

const ISLAND = 'island-1';
const page = (
  items: { id: string; title: string; commentCount?: number }[],
  nextCursor: string | null = null,
  role: 'host' | 'member' = 'host',
) => ({
  island: { id: ISLAND, name: '소다 섬', role },
  notices: { items: items.map((i) => ({ commentCount: 0, ...i })), nextCursor },
});
const detail = (
  id: string,
  comments: { id: string; name?: string | null; text?: string }[] = [],
  nextCommentsCursor: string | null = null,
) => ({
  id,
  title: '공지 제목',
  body: '공지 본문',
  version: 1,
  comments: comments.map((c) => ({
    userId: 'u',
    text: '댓글',
    createdAt: '2026-09-21T00:00:00Z',
    ...c,
    name: c.name === undefined ? '민지' : c.name,
  })),
  nextCommentsCursor,
});

const getBoardMock = getBoard as jest.Mock;
const listNoticesMock = listNotices as jest.Mock;
const getNoticeMock = getNotice as jest.Mock;
const postNoticeMock = postNotice as jest.Mock;
const patchNoticeMock = patchNotice as jest.Mock;
const delNoticeMock = delNotice as jest.Mock;
const postCommentMock = postComment as jest.Mock;

/** App.tsx 가 넘기는 라우트 문맥의 최소 복제 — go/back 이 e 를 바꾸고 _tick 으로 리렌더한다. */
const makeE = (over: Record<string, unknown> = {}) => {
  const e: any = {
    route: 'board',
    detail: '',
    tab: '공지',
    text: '',
    body: '',
    windowStart: '',
    windowEnd: '',
    now: Date.now(),
    state: initialState(true),
    failNext: false,
    go: jest.fn((r: string, d?: string) => {
      e.route = r;
      if (d !== undefined) e.detail = d;
      e._tick();
    }),
    back: jest.fn(() => {
      if (e.route === 'noticeEdit' && e.detail) e.route = 'notice';
      else {
        e.route = 'board';
        e.detail = '';
      }
      e._tick();
    }),
    replace: jest.fn((r: string) => {
      e.route = r;
      e.detail = '';
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
    setBody: jest.fn((v: string) => {
      e.body = v;
      e._tick();
    }),
    setWindowStart: jest.fn(),
    setWindowEnd: jest.fn(),
    dispatch: jest.fn(),
    setFailNext: jest.fn((v: boolean) => {
      e.failNext = v;
    }),
    build: jest.fn(),
    home: jest.fn(),
    reset: jest.fn(),
    _tick: () => {},
    ...over,
  };
  return e;
};

const concept = (over: Partial<Concept> = {}): Concept => ({
  title: '',
  kind: 'board-notice',
  position: 'scene',
  items: [],
  boardPanel: 'notice',
  boardRole: 'owner',
  ...over,
});

const deferred = <T,>() => {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const renderBoard = async (e: any, c: Partial<Concept> = {}) => {
  // App 은 렌더마다 e 를 새로 조립한다 — box 로 최신 e 를 주고 setE 가 stale 클로저를 재현한다.
  const box = { e };
  const Harness = () => {
    const [, setN] = useState(0);
    if (box.e) box.e._tick = () => setN((n: number) => n + 1);
    return (
      <Board
        building={undefined as never}
        concept={concept(c)}
        index={0}
        width={402}
        height={874}
        reduceMotion
        showToast={() => {}}
        e={box.e}
      />
    );
  };
  const screen = await render(<Harness />);
  return Object.assign(screen, {
    setE: (next: any) => {
      box.e = next;
      return screen.rerender(<Harness />);
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

test('홈 퀘스트 바로가기는 없는 상세로 치지 않고 퀘스트 목록을 연다', async () => {
  getBoardMock.mockResolvedValue(page([]));
  const e = makeE({ route: 'quest', detail: HOME_QUEST_LIST_DETAIL, tab: '퀘스트' });
  const screen = await renderBoard(e);

  await waitFor(() => assert.ok(screen.getByText('매일 새 도전')));
  assert.equal(screen.queryByText('주민별 달성률'), null);
  expect(e.replace).not.toHaveBeenCalled();
});

test('목록 — getBoard 첫 페이지를 그리고 더 보기는 listNotices 로 붙인다', async () => {
  getBoardMock.mockResolvedValue(
    page(
      [
        { id: 'n1', title: '첫 공지', commentCount: 2 },
        { id: 'n2', title: '둘째 공지' },
      ],
      'c1',
    ),
  );
  listNoticesMock.mockResolvedValue({
    items: [{ id: 'n3', title: '셋째 공지', commentCount: 1 }],
    nextCursor: null,
  });
  const screen = await renderBoard(makeE());

  await waitFor(() => assert.ok(screen.getByTestId('board-notice-item-0')));
  assert.ok(screen.getByText('첫 공지'));
  assert.ok(screen.getByText(/댓글 2/));

  await fireEvent.press(screen.getByTestId('board-notices-more'));
  await waitFor(() => assert.ok(screen.getByText('셋째 공지')));
  assert.deepEqual([...listNoticesMock.mock.calls[0]], [ISLAND, 'c1']);
  await screen.unmount();
});

test('방문자 — 보호된 GET·쓰기를 하나도 부르지 않고 로컬 공지를 보여 준다', async () => {
  const state = initialState(true);
  state.visitingIslandId = 'strawberry';
  const screen = await renderBoard(makeE({ state }));
  await act(async () => {});
  assert.equal(getBoardMock.mock.calls.length, 0);
  assert.equal(listNoticesMock.mock.calls.length, 0);
  assert.equal(getNoticeMock.mock.calls.length, 0);
  assert.equal(postNoticeMock.mock.calls.length, 0);
  assert.equal(patchNoticeMock.mock.calls.length, 0);
  assert.equal(delNoticeMock.mock.calls.length, 0);
  assert.equal(postCommentMock.mock.calls.length, 0);
  // 로컬 모델의 공지 목록은 방문자에게도 그대로다(공개 방문 계약 안 데이터).
  assert.ok(screen.getByText('우리 섬에 온 걸 환영해요'));
  await screen.unmount();
});

test('목록 실패 — 오류 문구와 다시 시도, 재시도가 다시 읽는다', async () => {
  getBoardMock.mockRejectedValueOnce(new ApiError('FORBIDDEN', '권한이 없습니다.', 403));
  const screen = await renderBoard(makeE());
  await waitFor(() => assert.ok(screen.getByTestId('board-notices-retry')));
  assert.ok(screen.getByText('권한이 없습니다.'));

  getBoardMock.mockResolvedValue(page([{ id: 'n1', title: '첫 공지' }]));
  await fireEvent.press(screen.getByTestId('board-notices-retry'));
  await waitFor(() => assert.ok(screen.getByText('첫 공지')));
  assert.equal(getBoardMock.mock.calls.length, 2);
  await screen.unmount();
});

test('상세 — getNotice 본문·댓글을 그리고 댓글 삭제 버튼은 없다', async () => {
  getBoardMock.mockResolvedValue(page([{ id: 'n1', title: '첫 공지' }]));
  getNoticeMock.mockResolvedValue(
    detail('n1', [
      { id: 'c1', name: '민지', text: '반가워요' },
      { id: 'c2', name: null, text: '탈퇴한 댓글' },
    ]),
  );
  const e = makeE({ route: 'notice', detail: 'n1' });
  const screen = await renderBoard(e);

  await waitFor(() => assert.ok(screen.getByText('공지 본문')));
  assert.ok(screen.getByText('반가워요'));
  assert.ok(screen.getByText('탈퇴한 댓글'));
  // 공개 API 에 댓글 삭제가 없다 — 서버 경로에서는 버튼이 나오지 않는다.
  assert.equal(screen.queryByTestId('board-comment-delete-0'), null);
  await screen.unmount();
});

test('공지 작성 — 성공(쓰기+정본 재조회) 뒤 목록으로 돌아간다', async () => {
  getBoardMock.mockResolvedValue(page([]));
  postNoticeMock.mockResolvedValue({ id: 'n9', title: 't', body: 'b' });
  const e = makeE({ route: 'noticeEdit' });
  const screen = await renderBoard(e);
  // 쓰기 버튼의 owner 판정은 getBoard 의 island.role 이 올 때까지 기다린다.
  await waitFor(() => assert.equal(getBoardMock.mock.calls.length, 1));
  await waitFor(() => assert.ok(screen.getByTestId('board-notice-title')));

  await fireEvent.changeText(screen.getByTestId('board-notice-title'), '새 공지');
  await fireEvent.changeText(screen.getByTestId('board-notice-body'), '본문');
  await fireEvent.press(screen.getByTestId('board-notice-submit'));

  await waitFor(() => assert.equal(e.back.mock.calls.length, 1));
  const [islandId, body, key] = postNoticeMock.mock.calls[0];
  assert.equal(islandId, ISLAND);
  assert.deepEqual(body, { title: '새 공지', body: '본문' });
  assert.equal(typeof key, 'string');
  assert.equal(getBoardMock.mock.calls.length, 2); // 진입 + 성공 후 정본 재조회
  await screen.unmount();
});

test('공지 저장 실패 — 입력 초안을 그대로 두고 오류를 보여 준다', async () => {
  getBoardMock.mockResolvedValue(page([]));
  postNoticeMock.mockRejectedValue(new ApiError('FORBIDDEN', '권한이 없습니다.', 403));
  const e = makeE({ route: 'noticeEdit' });
  const screen = await renderBoard(e);
  await waitFor(() => assert.equal(getBoardMock.mock.calls.length, 1));
  await waitFor(() => assert.ok(screen.getByTestId('board-notice-title')));

  await fireEvent.changeText(screen.getByTestId('board-notice-title'), '새 공지');
  await fireEvent.changeText(screen.getByTestId('board-notice-body'), '본문');
  await fireEvent.press(screen.getByTestId('board-notice-submit'));

  await waitFor(() => assert.ok(screen.getByText('권한이 없습니다.')));
  assert.equal(e.back.mock.calls.length, 0);
  assert.equal(e.text, '새 공지');
  assert.equal(e.body, '본문');
  await screen.unmount();
});

test('댓글 작성 — 성공하면 입력을 비우고 닫고, 실패하면 초안이 남는다', async () => {
  getBoardMock.mockResolvedValue(page([{ id: 'n1', title: '첫 공지' }]));
  getNoticeMock.mockResolvedValue(detail('n1', [{ id: 'c1', text: '반가워요' }]));
  postCommentMock.mockResolvedValue({ id: 'c2', name: null, text: 'x' });
  const e = makeE({ route: 'notice', detail: 'n1' });
  const screen = await renderBoard(e);
  await waitFor(() => assert.ok(screen.getByText('반가워요')));

  await fireEvent.press(screen.getByTestId('board-comment-new'));
  await fireEvent.changeText(screen.getByTestId('board-comment-input'), '같이 해요');
  await fireEvent.press(screen.getByTestId('board-comment-submit'));

  await waitFor(() => assert.equal(postCommentMock.mock.calls.length, 1));
  assert.deepEqual(
    [...postCommentMock.mock.calls[0].slice(0, 3)],
    [ISLAND, 'n1', { text: '같이 해요' }],
  );
  await waitFor(() => assert.equal(screen.queryByTestId('board-comment-input'), null));
  assert.equal(e.text, '');
  await screen.unmount();
});

test.each(['?review', '?demo'])(
  '목업 %s — e 가 있어도 API 0건, 저장·삭제·댓글은 로컬 dispatch 다',
  async (query) => {
    const restore = webMockMode(query);
    try {
      // 저장 — publish 가 서버가 아니라 NOTICE_SAVE dispatch 로 간다.
      const e = makeE({ route: 'noticeEdit', text: '새 공지', body: '본문' });
      const screen = await renderBoard(e);
      await act(async () => {});
      await fireEvent.press(screen.getByTestId('board-notice-submit'));
      // jest 목업 인자는 realm 이 달라 deepStrictEqual 이 흔들린다 — JSON 으로 비교한다.
      assert.deepEqual(
        JSON.parse(JSON.stringify(e.dispatch.mock.calls.map((c: unknown[]) => c[0]))),
        [{ type: 'NOTICE_SAVE', id: '', title: '새 공지', body: '본문' }],
      );
      assert.equal(e.back.mock.calls.length, 1);
      await screen.unmount();

      // 삭제 — NOTICE_DELETE dispatch.
      const e2 = makeE({ route: 'notice', detail: 'welcome' });
      const screen2 = await renderBoard(e2);
      await act(async () => {});
      assert.ok(screen2.getByText('우리 섬에 온 걸 환영해요'));
      await fireEvent.press(screen2.getByTestId('board-notice-delete'));
      await fireEvent.press(screen2.getByTestId('board-delete-confirm'));
      assert.deepEqual(
        JSON.parse(JSON.stringify(e2.dispatch.mock.calls.map((c: unknown[]) => c[0]))),
        [{ type: 'NOTICE_DELETE', id: 'welcome' }],
      );
      assert.equal(e2.back.mock.calls.length, 1);
      await screen2.unmount();

      // 댓글 — COMMENT dispatch.
      const e3 = makeE({ route: 'notice', detail: 'welcome' });
      const screen3 = await renderBoard(e3);
      await act(async () => {});
      await fireEvent.press(screen3.getByTestId('board-comment-new'));
      await fireEvent.changeText(screen3.getByTestId('board-comment-input'), '같이 해요');
      await fireEvent.press(screen3.getByTestId('board-comment-submit'));
      assert.deepEqual(
        JSON.parse(JSON.stringify(e3.dispatch.mock.calls.map((c: unknown[]) => c[0]))),
        [{ type: 'COMMENT', id: 'welcome', text: '같이 해요' }],
      );
      await screen3.unmount();

      // 목업 경로 전체에서 게시판 API 는 한 번도 나가지 않는다.
      for (const m of [
        getBoardMock,
        listNoticesMock,
        getNoticeMock,
        postNoticeMock,
        patchNoticeMock,
        delNoticeMock,
        postCommentMock,
      ])
        assert.equal(m.mock.calls.length, 0);
    } finally {
      restore();
    }
  },
);

test('갤러리 방문자 — e 없는 시안도 목업 공지를 그대로 보여 주고 API 는 0건이다', async () => {
  const screen = await renderBoard(null, { boardView: 'visitor', boardRole: 'resident' });
  await act(async () => {});
  // 목업 공지 첫 장의 제목·댓글이 그대로 보인다.
  assert.ok(screen.getByText('수아가 소다 섬에 도착했어요'));
  assert.ok(screen.getByText('수아야, 어서 와!'));
  for (const m of [
    getBoardMock,
    listNoticesMock,
    getNoticeMock,
    postNoticeMock,
    patchNoticeMock,
    delNoticeMock,
    postCommentMock,
  ])
    assert.equal(m.mock.calls.length, 0);
  await screen.unmount();
});

test('서버 role — 목업이 방장이어도 island.role=member 이면 쓰기 버튼이 없다', async () => {
  // 로컬 상태는 방장(solo 없음·joined·host 멤버 없음)이지만 서버는 member.
  getBoardMock.mockResolvedValue(page([{ id: 'n1', title: '첫 공지' }], null, 'member'));
  const e = makeE({ route: 'notice', detail: 'n1' });
  getNoticeMock.mockResolvedValue(detail('n1', [{ id: 'c1', text: '반가워요' }]));
  const screen = await renderBoard(e);
  await waitFor(() => assert.ok(screen.getByText('공지 본문')));
  assert.equal(screen.queryByTestId('board-notice-edit'), null);
  assert.equal(screen.queryByTestId('board-notice-delete'), null);
  await screen.unmount();
});

test('서버 role — 로컬이 비방장이어도 island.role=host 이면 쓰기 버튼이 보인다', async () => {
  // strawberry 섬(미가입·host 멤버 있음)은 로컬 owner 가 아니다 — 서버 host 가 정본.
  const state = initialState(true);
  const island = state.islands.find((i) => i.id === 'soda');
  if (island) island.members[0].role = 'host';
  getBoardMock.mockResolvedValue(page([{ id: 'n1', title: '첫 공지' }], null, 'host'));
  const e = makeE({ state, route: 'notice', detail: 'n1' });
  getNoticeMock.mockResolvedValue(detail('n1', [{ id: 'c1', text: '반가워요' }]));
  const screen = await renderBoard(e);
  await waitFor(() => assert.ok(screen.getByText('공지 본문')));
  assert.ok(screen.getByTestId('board-notice-edit'));
  assert.ok(screen.getByTestId('board-notice-delete'));
  await screen.unmount();
});

test('공지 수정 — updateNotice 분기, 성공하면 한 번만 뒤로 간다', async () => {
  getBoardMock.mockResolvedValue(page([{ id: 'n1', title: '첫 공지' }]));
  patchNoticeMock.mockResolvedValue({ id: 'n1', title: 't', body: 'b' });
  const e = makeE({ route: 'noticeEdit', detail: 'n1', text: '수정 제목', body: '수정 본문' });
  const screen = await renderBoard(e);
  await waitFor(() => assert.equal(getBoardMock.mock.calls.length, 1));
  await waitFor(() => assert.ok(screen.getByTestId('board-notice-submit')));

  await fireEvent.press(screen.getByTestId('board-notice-submit'));
  await waitFor(() => assert.equal(e.back.mock.calls.length, 1));
  assert.deepEqual(
    [...patchNoticeMock.mock.calls[0].slice(0, 3)],
    [ISLAND, 'n1', { title: '수정 제목', body: '수정 본문' }],
  );
  assert.equal(postNoticeMock.mock.calls.length, 0);
  await screen.unmount();
});

test('공지 삭제 — deleteNotice 성공 뒤 확인창을 닫고 한 번 뒤로 간다', async () => {
  getBoardMock.mockResolvedValue(page([{ id: 'n1', title: '첫 공지' }]));
  getNoticeMock.mockResolvedValue(detail('n1', []));
  delNoticeMock.mockResolvedValue({ id: 'n1' });
  const e = makeE({ route: 'notice', detail: 'n1' });
  const screen = await renderBoard(e);
  await waitFor(() => assert.ok(screen.getByText('공지 본문')));

  await fireEvent.press(screen.getByTestId('board-notice-delete'));
  await fireEvent.press(screen.getByTestId('board-delete-confirm'));
  await waitFor(() => assert.equal(e.back.mock.calls.length, 1));
  assert.deepEqual([...delNoticeMock.mock.calls[0].slice(0, 2)], [ISLAND, 'n1']);
  await screen.unmount();
});

test('쓰기 진행 중 라우트가 바뀌면 — 옛 작업이 back 도 오류 표시도 하지 않는다', async () => {
  getBoardMock.mockResolvedValue(page([]));
  const slow = deferred<{ id: string; title: string; body: string }>();
  postNoticeMock.mockReturnValue(slow.promise);
  const e1 = makeE({ route: 'noticeEdit', text: '새 공지', body: '본문' });
  const screen = await renderBoard(e1);
  await waitFor(() => assert.equal(getBoardMock.mock.calls.length, 1));
  await waitFor(() => assert.ok(screen.getByTestId('board-notice-submit')));
  await fireEvent.press(screen.getByTestId('board-notice-submit'));
  assert.equal(postNoticeMock.mock.calls.length, 1);

  // App 처럼 e 를 새 객체로 갈아 끼우며 목록으로 나갔다 — e1.back 은 옛 history 클로저다.
  const e2 = makeE({ state: e1.state, route: 'board' });
  await screen.setE(e2);
  await act(async () => {
    slow.resolve({ id: 'n9', title: 't', body: 'b' });
  });
  assert.equal(e1.back.mock.calls.length, 0);
  assert.equal(e2.back.mock.calls.length, 0);
  await screen.unmount();
});

test('나갔다 같은 작성 화면으로 돌아와도 — 옛 쓰기의 성공 효과는 실행되지 않는다', async () => {
  getBoardMock.mockResolvedValue(page([]));
  const slow = deferred<{ id: string; title: string; body: string }>();
  postNoticeMock.mockReturnValue(slow.promise);
  const e1 = makeE({ route: 'noticeEdit', text: '새 공지', body: '본문' });
  const screen = await renderBoard(e1);
  await waitFor(() => assert.equal(getBoardMock.mock.calls.length, 1));
  await waitFor(() => assert.ok(screen.getByTestId('board-notice-submit')));
  await fireEvent.press(screen.getByTestId('board-notice-submit'));

  await screen.setE(makeE({ state: e1.state, route: 'board' }));
  // 같은 noticeEdit(빈 detail)로 돌아와도 route 세대가 달라 옛 작업은 무효다.
  const e3 = makeE({ state: e1.state, route: 'noticeEdit', text: '다른 초안', body: '다른 본문' });
  await screen.setE(e3);
  await act(async () => {
    slow.resolve({ id: 'n9', title: 't', body: 'b' });
  });
  assert.equal(e1.back.mock.calls.length, 0);
  assert.equal(e3.back.mock.calls.length, 0);
  await screen.unmount();
});

test('쓰기 진행 중 라우트가 바뀌면 — 실패 오류도 새 화면에 띄우지 않는다', async () => {
  getBoardMock.mockResolvedValue(page([]));
  const slow = deferred<{ id: string; title: string; body: string }>();
  postNoticeMock.mockReturnValue(slow.promise);
  const e1 = makeE({ route: 'noticeEdit', text: '새 공지', body: '본문' });
  const screen = await renderBoard(e1);
  await waitFor(() => assert.equal(getBoardMock.mock.calls.length, 1));
  await waitFor(() => assert.ok(screen.getByTestId('board-notice-submit')));
  await fireEvent.press(screen.getByTestId('board-notice-submit'));

  const e2 = makeE({ state: e1.state, route: 'board' });
  await screen.setE(e2);
  await act(async () => {
    slow.reject(new ApiError('FORBIDDEN', '권한이 없습니다.', 403));
    await slow.promise.catch(() => {});
  });
  assert.equal(screen.queryByText('권한이 없습니다.'), null);
  await screen.unmount();
});

test('댓글 쓰기 진행 중 화면이 바뀌면 — 성공해도 새 화면의 입력을 지우지 않는다', async () => {
  getBoardMock.mockResolvedValue(page([{ id: 'n1', title: '첫 공지' }]));
  getNoticeMock.mockResolvedValue(detail('n1', [{ id: 'c1', text: '반가워요' }]));
  const slow = deferred<{ id: string; name: string | null; text: string }>();
  postCommentMock.mockReturnValue(slow.promise);
  const e1 = makeE({ route: 'notice', detail: 'n1' });
  const screen = await renderBoard(e1);
  await waitFor(() => assert.ok(screen.getByText('반가워요')));

  await fireEvent.press(screen.getByTestId('board-comment-new'));
  await fireEvent.changeText(screen.getByTestId('board-comment-input'), '같이 해요');
  await fireEvent.press(screen.getByTestId('board-comment-submit'));
  assert.equal(postCommentMock.mock.calls.length, 1);

  // 공지 작성 화면으로 이동 — e.text 는 공지 제목과 댓글이 공유하는 필드다.
  const e2 = makeE({ state: e1.state, route: 'noticeEdit', text: '새 공지 초안' });
  await screen.setE(e2);
  await act(async () => {
    slow.resolve({ id: 'c9', name: 'n', text: 'x' });
  });
  // 옛 댓글 작업이 새 화면의 제목 초안을 지우지 않는다.
  assert.equal(e2.setText.mock.calls.filter((c: unknown[]) => c[0] === '').length, 0);
  assert.equal(e2.text, '새 공지 초안');
  await screen.unmount();
});

test('저장 더블탭 — 요청은 1건, 성공 효과(back)도 한 번이다', async () => {
  getBoardMock.mockResolvedValue(page([]));
  const slow = deferred<{ id: string; title: string; body: string }>();
  postNoticeMock.mockReturnValue(slow.promise);
  const e = makeE({ route: 'noticeEdit', text: '새 공지', body: '본문' });
  const screen = await renderBoard(e);
  await waitFor(() => assert.equal(getBoardMock.mock.calls.length, 1));
  await waitFor(() => assert.ok(screen.getByTestId('board-notice-submit')));

  await fireEvent.press(screen.getByTestId('board-notice-submit'));
  await fireEvent.press(screen.getByTestId('board-notice-submit'));
  assert.equal(postNoticeMock.mock.calls.length, 1);
  await act(async () => {
    slow.resolve({ id: 'n9', title: 't', body: 'b' });
  });
  await waitFor(() => assert.equal(e.back.mock.calls.length, 1));
  await screen.unmount();
});

test('언마운트 뒤 resolve 된 쓰기는 어떤 화면 효과도 내지 않는다', async () => {
  getBoardMock.mockResolvedValue(page([]));
  const slow = deferred<{ id: string; title: string; body: string }>();
  postNoticeMock.mockReturnValue(slow.promise);
  const e = makeE({ route: 'noticeEdit', text: '새 공지', body: '본문' });
  const screen = await renderBoard(e);
  await waitFor(() => assert.equal(getBoardMock.mock.calls.length, 1));
  await waitFor(() => assert.ok(screen.getByTestId('board-notice-submit')));
  await fireEvent.press(screen.getByTestId('board-notice-submit'));
  assert.equal(postNoticeMock.mock.calls.length, 1);

  await screen.unmount();
  await act(async () => {
    slow.resolve({ id: 'n9', title: 't', body: 'b' });
  });
  assert.equal(e.back.mock.calls.length, 0);
});

test('댓글 A 진행 중 닫고 다시 열어 B 입력 — 옛 성공이 B 초안과 입력창을 건드리지 않는다', async () => {
  getBoardMock.mockResolvedValue(page([{ id: 'n1', title: '첫 공지' }]));
  getNoticeMock.mockResolvedValue(detail('n1', [{ id: 'c1', text: '반가워요' }]));
  const slow = deferred<{ id: string; name: string | null; text: string }>();
  postCommentMock.mockReturnValue(slow.promise);
  const e = makeE({ route: 'notice', detail: 'n1' });
  const screen = await renderBoard(e);
  await waitFor(() => assert.ok(screen.getByText('반가워요')));

  await fireEvent.press(screen.getByTestId('board-comment-new'));
  await fireEvent.changeText(screen.getByTestId('board-comment-input'), '같이 해요');
  await fireEvent.press(screen.getByTestId('board-comment-submit'));
  assert.equal(postCommentMock.mock.calls.length, 1);

  // 같은 라우트다 — 입력창을 닫았다 다시 열고 다른 내용을 친다.
  await fireEvent.press(screen.getByTestId('board-comment-cancel'));
  await fireEvent.press(screen.getByTestId('board-comment-new'));
  await fireEvent.changeText(screen.getByTestId('board-comment-input'), '다른 댓글');
  await act(async () => {
    slow.resolve({ id: 'c9', name: 'n', text: 'x' });
  });
  // 옛 댓글 성공이 새 초안을 지우거나 다시 연 입력창을 닫지 않는다.
  assert.ok(screen.getByTestId('board-comment-input'));
  assert.equal(e.text, '다른 댓글');
  await screen.unmount();
});

test('저장 진행 중 초안을 더 고치면 — 옛 저장의 back 이 새 초안을 버리지 않는다', async () => {
  getBoardMock.mockResolvedValue(page([]));
  const slow = deferred<{ id: string; title: string; body: string }>();
  postNoticeMock.mockReturnValue(slow.promise);
  const e = makeE({ route: 'noticeEdit', text: '새 공지', body: '본문' });
  const screen = await renderBoard(e);
  await waitFor(() => assert.equal(getBoardMock.mock.calls.length, 1));
  await waitFor(() => assert.ok(screen.getByTestId('board-notice-submit')));
  await fireEvent.press(screen.getByTestId('board-notice-submit'));
  assert.equal(postNoticeMock.mock.calls.length, 1);

  // 저장이 안 끝났는데 제목을 더 고친다.
  await fireEvent.changeText(screen.getByTestId('board-notice-title'), '고치는 중');
  await act(async () => {
    slow.resolve({ id: 'n9', title: 't', body: 'b' });
  });
  assert.equal(e.back.mock.calls.length, 0);
  assert.equal(e.text, '고치는 중');
  await screen.unmount();
});

test('저장 진행 중 다른 내용으로 다시 저장 — 명시 거절 문구가 뜨고 초안이 남는다', async () => {
  getBoardMock.mockResolvedValue(page([]));
  const slow = deferred<{ id: string; title: string; body: string }>();
  postNoticeMock.mockReturnValue(slow.promise);
  const e = makeE({ route: 'noticeEdit', text: '새 공지', body: '본문' });
  const screen = await renderBoard(e);
  await waitFor(() => assert.equal(getBoardMock.mock.calls.length, 1));
  await waitFor(() => assert.ok(screen.getByTestId('board-notice-submit')));
  await fireEvent.press(screen.getByTestId('board-notice-submit'));

  // 내용을 바꿔 다시 저장 — 같은 의도가 아니므로 조용히 삼키지 않고 진행 중 거절을 보여 준다.
  await fireEvent.changeText(screen.getByTestId('board-notice-title'), '바꾼 제목');
  await fireEvent.press(screen.getByTestId('board-notice-submit'));
  await waitFor(() => assert.ok(screen.getByText('이전 저장이 끝나는 중이에요.')));
  assert.equal(postNoticeMock.mock.calls.length, 1);
  assert.equal(e.text, '바꾼 제목');

  await act(async () => {
    slow.resolve({ id: 'n9', title: 't', body: 'b' });
  });
  // 옛 저장이 끝나도 초안이 바뀌어 있으면 back 하지 않는다.
  assert.equal(e.back.mock.calls.length, 0);
  await screen.unmount();
});

test('저장 진행 중 A→B→A 편집 — 마지막 내용이 같아도 옛 성공은 무효다', async () => {
  getBoardMock.mockResolvedValue(page([]));
  const slow = deferred<{ id: string; title: string; body: string }>();
  postNoticeMock.mockReturnValue(slow.promise);
  const e = makeE({ route: 'noticeEdit', text: '원안', body: '본문' });
  const screen = await renderBoard(e);
  await waitFor(() => assert.equal(getBoardMock.mock.calls.length, 1));
  await waitFor(() => assert.ok(screen.getByTestId('board-notice-submit')));
  await fireEvent.press(screen.getByTestId('board-notice-submit'));

  // A→B→A — 값 비교로는 구분할 수 없으므로 세대로만 걸러야 한다.
  await fireEvent.changeText(screen.getByTestId('board-notice-title'), '임시 수정');
  await fireEvent.changeText(screen.getByTestId('board-notice-title'), '원안');
  await act(async () => {
    slow.resolve({ id: 'n9', title: 't', body: 'b' });
  });
  assert.equal(e.back.mock.calls.length, 0);
  await screen.unmount();
});

test('삭제 진행 중 확인창을 취소하면 — 옛 삭제 성공이 back 을 실행하지 않는다', async () => {
  getBoardMock.mockResolvedValue(page([{ id: 'n1', title: '첫 공지' }]));
  getNoticeMock.mockResolvedValue(detail('n1', []));
  const slow = deferred<{ id: string }>();
  delNoticeMock.mockReturnValue(slow.promise);
  const e = makeE({ route: 'notice', detail: 'n1' });
  const screen = await renderBoard(e);
  await waitFor(() => assert.ok(screen.getByText('공지 본문')));

  await fireEvent.press(screen.getByTestId('board-notice-delete'));
  await fireEvent.press(screen.getByTestId('board-delete-confirm'));
  assert.equal(delNoticeMock.mock.calls.length, 1);
  // 삭제가 안 끝났는데 확인창을 취소한다.
  await fireEvent.press(screen.getByTestId('board-delete-cancel'));
  await act(async () => {
    slow.resolve({ id: 'n1' });
  });
  // 강제 back 없이 남은 화면은 영구 스피너가 아니라 종결 상태다.
  assert.equal(e.back.mock.calls.length, 0);
  await waitFor(() => assert.ok(screen.getByText('삭제됐거나 더 이상 볼 수 없는 공지예요.')));
  assert.equal(screen.queryByText('불러오는 중…'), null);
  await screen.unmount();
});
