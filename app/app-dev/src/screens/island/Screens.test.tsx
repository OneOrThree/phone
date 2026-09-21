/**
 * GROMO-2006 화면 통합 회귀 — `e.islands` 서버 명령이 있을 때 Screens가
 * 로컬 성공 action을 부르지 않고 서버 콜백만으로 loading/error/retry/pending/cancel을 그리는지 고정한다.
 * api 목은 App 의 orchestration 과 같이 dispatch 로 스냅샷을 돌려준다.
 */
import assert from 'node:assert/strict';
import React, { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react-native';
import { RedesignScreens } from '@/screens/island/Screens';
import { initialState, reducer } from '@/services/model';
import { ApiError } from '@/services/api/client';
import type { IslandSummary } from '@/services/api/islands';

jest.mock('@/utils/layout', () => ({
  useAppLayout: () => ({
    width: 402,
    height: 874,
    compact: false,
    tablet: false,
    modalWidth: 340,
    insets: { top: 52, bottom: 32, left: 0, right: 0 },
  }),
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 52, bottom: 32, left: 0, right: 0 }),
}));

const islandSummary = (over: Partial<IslandSummary> = {}): IslandSummary => ({
  id: 'isl-1',
  name: '바람 섬',
  intro: '바람이 부는 섬',
  visibility: 'public',
  approvalRequired: false,
  memberCount: 3,
  maxMembers: 15,
  membershipStatus: 'none',
  joinRequestId: null,
  growthStage: null,
  themeId: null,
  ...over,
});
const pendingReq = (over: Record<string, unknown> = {}) => ({
  id: 'req-1',
  islandId: 'isl-9',
  status: 'pending' as const,
  version: 1,
  islandName: '승인 섬',
  memberCount: 2,
  maxMembers: 15,
  createdAt: '2026-09-21T00:00:00Z',
  ...over,
});

// 실제 reducer 로 state 를 돌리고 api 목이 dispatch 까지 하게 만든다(App orchestration 축약본).
function Harness({ route, api, expose, seed, bootError, detail: detailProp }: any) {
  const [state, baseDispatch] = useReducer(reducer, undefined, () => initialState(false));
  const actions = useRef<string[]>([]);
  const dispatch = useMemo(() => {
    const d = (a: any) => {
      actions.current.push(a.type);
      return baseDispatch(a);
    };
    return d;
  }, []);
  const [text, setText] = useState(''),
    [body, setBody] = useState(''),
    [approval, setApproval] = useState(false),
    [detail] = useState(detailProp ?? '');
  const islands = useMemo(() => api?.(dispatch), []);
  const go = useRef(jest.fn()).current;
  useEffect(() => {
    seed?.(dispatch);
    expose?.({ dispatch, actions: actions.current, go });
  }, []);
  return (
    <RedesignScreens
      e={{
        state,
        route,
        dispatch,
        go,
        replace: jest.fn(),
        reset: jest.fn(),
        home: jest.fn(),
        back: jest.fn(),
        notify: jest.fn(),
        confirm: jest.fn(),
        build: jest.fn(),
        text,
        setText,
        body,
        setBody,
        tab: '',
        setTab: jest.fn(),
        detail,
        now: Date.now(),
        terms: {},
        setTerms: jest.fn(),
        approval,
        setApproval,
        visited: '',
        setVisited: jest.fn(),
        guideStep: 0,
        setGuideStep: jest.fn(),
        player: { addListener: () => ({ remove() {} }), replace() {}, play() {}, pause() {} },
        previewAudio: false,
        setPreviewAudio: jest.fn(),
        walkTo: jest.fn(),
        newQuest: jest.fn(),
        walkRequest: null,
        islands,
        islandBootError: !!bootError,
      }}
    />
  );
}

const flush = async () => act(async () => {});

// 서버 폴링·진행 중 Promise가 다음 테스트를 오염시키지 않게 매번 언마운트한다
afterEach(cleanup);

test('joinIsland 진입 시 explore를 호출하고 실패하면 오류+재시도를 보여준다', async () => {
  let calls = 0;
  const api = (dispatch: any) => ({
    explore: jest.fn(async () => {
      calls += 1;
      if (calls === 1) throw new ApiError('CLIENT_NETWORK_ERROR', '네트워크', 0);
      dispatch({
        type: 'ISLAND_CANDIDATES',
        items: [islandSummary()],
        nextCursor: null,
        reset: true,
      });
      return { items: [islandSummary()], nextCursor: null };
    }),
  });
  const s = await render(<Harness route="joinIsland" api={api} />);
  await waitFor(() => s.getByText('다시 불러오기'));
  await fireEvent.press(s.getByText('다시 불러오기'));
  await waitFor(() => s.getByText('바람 섬'));
  assert.equal(calls, 2);
});

test('active 가입은 서버 응답 뒤 성공 확인 카드를 보여주고 arrival로 가지 않는다', async () => {
  const join = jest.fn(async (_id: string) => ({ status: 'active' as const }));
  const api = (dispatch: any) => ({
    explore: jest.fn(async () => {
      dispatch({
        type: 'ISLAND_CANDIDATES',
        items: [islandSummary()],
        nextCursor: null,
        reset: true,
      });
    }),
    join,
  });
  const s = await render(<Harness route="joinIsland" api={api} />);
  await waitFor(() => s.getByText('바람 섬에 참여하기'));
  await fireEvent.press(s.getByText('바람 섬에 참여하기'));
  await waitFor(() => s.getByText('가입이 완료됐어요'));
  assert.equal(join.mock.calls.length, 1);
});

test('pending 가입은 대기 카드와 취소 버튼을 보여주고 취소는 서버 명령을 부른다', async () => {
  const cancel = jest.fn(async (_id: string) => {});
  const api = (dispatch: any) => ({
    explore: jest.fn(async () => {
      dispatch({
        type: 'ISLAND_CANDIDATES',
        items: [islandSummary({ approvalRequired: true })],
        nextCursor: null,
        reset: true,
      });
    }),
    join: jest.fn(async () => {
      dispatch({ type: 'ISLAND_REQUEST', request: pendingReq({ islandId: 'isl-1' }) });
      return { status: 'pending' as const, requestId: 'req-1' };
    }),
    cancel,
  });
  const s = await render(<Harness route="joinIsland" api={api} />);
  await waitFor(() => s.getByText('가입 신청'));
  await fireEvent.press(s.getByText('가입 신청'));
  await waitFor(() => s.getByText('가입 신청 대기 중'));
  await fireEvent.press(s.getByText('가입 신청 취소'));
  await flush();
  assert.equal(cancel.mock.calls[0][0], 'req-1');
});

test('join 실패는 로컬 성공으로 바꾸지 않고 오류 문구를 보여준다', async () => {
  const api = (dispatch: any) => ({
    explore: jest.fn(async () => {
      dispatch({
        type: 'ISLAND_CANDIDATES',
        items: [islandSummary()],
        nextCursor: null,
        reset: true,
      });
    }),
    join: jest.fn(async () => {
      throw new ApiError('FORBIDDEN', '강퇴된 섬에는 다시 가입할 수 없어요.', 403);
    }),
  });
  const s = await render(<Harness route="joinIsland" api={api} />);
  await waitFor(() => s.getByText('바람 섬에 참여하기'));
  await fireEvent.press(s.getByText('바람 섬에 참여하기'));
  await waitFor(() => s.getByText('강퇴된 섬에는 다시 가입할 수 없어요.'));
  assert.ok(s.queryByText('가입이 완료됐어요') === null);
});

test('제출 중 중복 탭은 join을 두 번 부르지 않는다', async () => {
  let release: (v: unknown) => void = () => {};
  const join = jest.fn((_id: string) => new Promise((resolve) => (release = resolve)));
  const api = (dispatch: any) => ({
    explore: jest.fn(async () => {
      dispatch({
        type: 'ISLAND_CANDIDATES',
        items: [islandSummary()],
        nextCursor: null,
        reset: true,
      });
    }),
    join,
  });
  const s = await render(<Harness route="joinIsland" api={api} />);
  await waitFor(() => s.getByText('바람 섬에 참여하기'));
  await fireEvent.press(s.getByText('바람 섬에 참여하기'));
  await fireEvent.press(s.getByText('바람 섬에 참여하기'));
  await act(async () => release({ status: 'active' }));
  assert.equal(join.mock.calls.length, 1);
});

test('createIsland 서버 실패는 로컬 CREATE 없이 오류를 보여준다', async () => {
  const create = jest.fn(async () => {
    throw new ApiError('SERVICE_UNAVAILABLE', '잠시 뒤 다시 시도해 주세요.', 503);
  });
  let exposed: any;
  const api = () => ({ create });
  const s = await render(
    <Harness route="createIsland" api={api} expose={(x: any) => (exposed = x)} />,
  );
  // 이름이 비어 있으면 제출 버튼이 비활성 — create를 부르지 않는다
  const submit = s.getByLabelText('섬 만들기');
  assert.equal(submit.props.accessibilityState?.disabled, true);
  await fireEvent.changeText(s.getByLabelText('섬 이름'), '새 섬');
  await fireEvent.press(s.getByLabelText('섬 만들기'));
  await waitFor(() => s.getByText('잠시 뒤 다시 시도해 주세요.'));
  assert.equal(create.mock.calls.length, 1);
  // 실패를 로컬 성공 action 으로 치환하지 않았다 — CREATE_ISLAND 디스패치 없음
  assert.ok(!exposed.actions.includes('CREATE_ISLAND'));
  assert.ok(s.queryByText('섬을 만들었어요') === null);
});

test('createIsland 서버 성공은 memberships 재조회 뒤 확인 카드를 보여준다', async () => {
  const create = jest.fn(async (_input: any) => {});
  const api = () => ({ create });
  const s = await render(<Harness route="createIsland" api={api} />);
  await fireEvent.changeText(s.getByLabelText('섬 이름'), '새 섬');
  await fireEvent.press(s.getByLabelText('섬 만들기'));
  await waitFor(() => s.getByText('섬을 만들었어요'));
  // 보낸 input 은 공개 계약 필드만 — name/intro/approvalRequired/maxMembers
  assert.deepEqual(create.mock.calls[0][0], {
    name: '새 섬',
    intro: undefined,
    approvalRequired: false,
    maxMembers: 15,
  });
});

test('approval 경로는 서버 pending 신청을 복구해 대기 카드를 보여준다', async () => {
  const api = (dispatch: any) => ({
    explore: jest.fn(async () => {
      dispatch({
        type: 'ISLAND_SYNC_REQUESTS',
        requests: [pendingReq()],
      });
    }),
    status: jest.fn(async (id: string) => ({
      id,
      islandId: 'isl-9',
      status: 'pending',
      version: 1,
    })),
  });
  const s = await render(
    <Harness
      route="approval"
      api={api}
      seed={(d: any) => d({ type: 'ISLAND_SYNC_REQUESTS', requests: [pendingReq()] })}
    />,
  );
  await waitFor(() => s.getByText('가입 신청 대기 중'));
  s.getByText('가입 신청 취소');
});

test('외부 승인으로 current가 바뀌면 approval 화면이 성공 확인을 보여준다', async () => {
  let exposed: any;
  const api = () => ({
    explore: jest.fn(async () => {}),
    status: jest.fn(),
  });
  const s = await render(
    <Harness
      route="approval"
      api={api}
      expose={(x: any) => (exposed = x)}
      seed={(d: any) =>
        d({
          type: 'ISLAND_SYNC_REQUESTS',
          requests: [pendingReq({ status: 'pending' })],
        })
      }
    />,
  );
  await waitFor(() => s.getByText('가입 신청 대기 중'));
  // 다른 기기에서 승인 → 폴링이 ISLAND_REQUEST(approved)+memberships 재조회를 디스패치한 상황을 재현
  await act(async () => {
    exposed.dispatch({
      type: 'ISLAND_REQUEST',
      request: { ...pendingReq({ status: 'approved' }) },
    });
  });
  await waitFor(() => s.getByText('가입이 완료됐어요'));
});

test('다른 섬의 승인 이력이 requestStatus에 남아도 joinIsland의 참여 CTA는 숨지 않는다', async () => {
  const join = jest.fn(async (_id: string) => ({ status: 'active' as const }));
  const api = () => ({ explore: jest.fn(async () => {}), join });
  const s = await render(
    <Harness
      route="joinIsland"
      api={api}
      seed={(d: any) => {
        // 섬 A의 승인 결과 — 세션 동안 requestStatus에 남는다(재현 경로의 핵심)
        d({
          type: 'ISLAND_REQUEST',
          request: { id: 'rA', islandId: 'isl-A', status: 'approved', version: 2 },
        });
        d({
          type: 'ISLAND_CANDIDATES',
          items: [islandSummary({ id: 'isl-B', name: '숲 섬' })],
          nextCursor: null,
          reset: true,
        });
      }}
    />,
  );
  await waitFor(() => s.getByText('숲 섬에 참여하기'));
  await fireEvent.press(s.getByText('숲 섬에 참여하기'));
  await waitFor(() => assert.equal(join.mock.calls[0]?.[0], 'isl-B'));
});

test('같은 섬의 옛 approved 이력보다 새 pending 신청이 우선한다 — 취소 CTA가 새 requestId를 부른다', async () => {
  const cancel = jest.fn(async (_id: string) => ({}));
  const api = () => ({ explore: jest.fn(async () => {}), cancel, status: jest.fn() });
  const s = await render(
    <Harness
      route="approval"
      detail="isl-A"
      api={api}
      seed={(d: any) => {
        // 승인 → 탈퇴 → 같은 섬에 재신청한 사이클: 옛 종결 + 새 pending이 공존한다
        d({
          type: 'ISLAND_REQUEST',
          request: { id: 'rA-old', islandId: 'isl-A', status: 'approved', version: 2 },
        });
        d({
          type: 'ISLAND_SYNC_REQUESTS',
          requests: [pendingReq({ id: 'rA-new', islandId: 'isl-A', islandName: '바람 섬' })],
        });
      }}
    />,
  );
  await waitFor(() => s.getByText('가입 신청 취소'));
  await fireEvent.press(s.getByText('가입 신청 취소'));
  await waitFor(() => assert.equal(cancel.mock.calls[0]?.[0], 'rA-new'));
});

test('같은 섬의 종결 이력이 여러 개면 최신 것을 보여준다 — 옛 approved가 새 rejected를 덮지 않는다', async () => {
  const api = () => ({ explore: jest.fn(async () => {}) });
  const s = await render(
    <Harness
      route="approval"
      detail="isl-A"
      api={api}
      seed={(d: any) => {
        d({
          type: 'ISLAND_REQUEST',
          request: { id: 'rA-old', islandId: 'isl-A', status: 'approved', version: 2 },
        });
        // 탈퇴·재신청 뒤 거절 — requestStatus 끝에 append된 최신 이력
        d({
          type: 'ISLAND_REQUEST',
          request: { id: 'rA-new', islandId: 'isl-A', status: 'rejected', version: 1 },
        });
      }}
    />,
  );
  await waitFor(() => s.getByText('신청이 거절됐어요'));
  assert.equal(s.queryByText('가입이 완료됐어요'), null);
});

test('approval A 화면은 다른 섬 B의 pending을 가로채지 않는다', async () => {
  const api = () => ({ explore: jest.fn(async () => {}) });
  const s = await render(
    <Harness
      route="approval"
      detail="isl-A"
      api={api}
      seed={(d: any) =>
        d({
          type: 'ISLAND_SYNC_REQUESTS',
          requests: [pendingReq({ id: 'rB', islandId: 'isl-B', islandName: '숲 섬' })],
        })
      }
    />,
  );
  await flush();
  assert.equal(s.queryByText('가입 신청 대기 중'), null);
  assert.equal(s.queryByText('가입 신청 취소'), null);
});

test('approval 경로는 detail과 매칭된 approved 이력의 완료 카드를 보여준다', async () => {
  const api = () => ({ explore: jest.fn(async () => {}) });
  const s = await render(
    <Harness
      route="approval"
      detail="isl-A"
      api={api}
      seed={(d: any) =>
        d({
          type: 'ISLAND_REQUEST',
          request: {
            id: 'rA',
            islandId: 'isl-A',
            status: 'approved',
            version: 2,
            islandName: '바람 섬',
          },
        })
      }
    />,
  );
  await waitFor(() => s.getByText('가입이 완료됐어요'));
});

test('CLIENT_STALE_SESSION 실패는 오류 문구 없이 버린다', async () => {
  const api = (dispatch: any) => ({
    explore: jest.fn(async () => {
      dispatch({
        type: 'ISLAND_CANDIDATES',
        items: [islandSummary()],
        nextCursor: null,
        reset: true,
      });
    }),
    join: jest.fn(async () => {
      throw new ApiError('CLIENT_STALE_SESSION', 'stale', 0);
    }),
  });
  const s = await render(<Harness route="joinIsland" api={api} />);
  await waitFor(() => s.getByText('바람 섬에 참여하기'));
  await fireEvent.press(s.getByText('바람 섬에 참여하기'));
  await flush();
  assert.ok(s.queryByText('가입이 완료됐어요') === null);
});

test('초대 코드는 해석 뒤 미리보기를 보여주고 명시 확인 전에 join하지 않는다', async () => {
  const join = jest.fn(async (_id: string) => ({ status: 'active' as const }));
  const api = () => ({
    resolveInvite: jest.fn(async (_code: string) =>
      islandSummary({ id: 'inv-1', name: '초대 섬' }),
    ),
    join,
  });
  const s = await render(<Harness route="chooseIsland" api={api} />);
  await fireEvent.press(s.getByTestId('invite-open'));
  await fireEvent.changeText(s.getByLabelText('초대 코드'), 'ABC123');
  await fireEvent.press(s.getByLabelText('확인'));
  await waitFor(() => s.getByText('초대 섬'));
  assert.equal(join.mock.calls.length, 0);
  await fireEvent.press(s.getByText('이 섬에 참여'));
  await waitFor(() => s.getByText('가입이 완료됐어요'));
  assert.equal(join.mock.calls.length, 1);
});

test('부팅 동기화 실패는 chooseIsland에 명시 오류+재시도를 띄우고 재시도가 sync를 부른다', async () => {
  const sync = jest.fn(async () => {});
  const api = () => ({ sync });
  const s = await render(<Harness route="chooseIsland" api={api} bootError />);
  await waitFor(() => s.getByText('섬 정보를 불러오지 못했어요'));
  await fireEvent.press(s.getByLabelText('다시 시도'));
  await flush();
  assert.equal(sync.mock.calls.length, 1);
});

test('재시작 복구 — 서버 current가 있으면 chooseIsland에 소속 확인 카드를 보여준다', async () => {
  const api = () => ({ sync: jest.fn(async () => {}) });
  const s = await render(
    <Harness
      route="chooseIsland"
      api={api}
      seed={(d: any) =>
        d({
          type: 'ISLAND_SYNC',
          memberships: {
            items: [islandSummary({ id: 'srv-1', name: '복구 섬' })],
            nextCursor: null,
            currentIslandId: 'srv-1',
            lossReason: null,
          },
        })
      }
    />,
  );
  await waitFor(() => s.getByText('가입이 확인됐어요'));
  s.getByText('서버에서 「복구 섬」 소속이 확인됐어요.');
});

test('재시작 후 pending 신청은 발견 후보와 무관하게 chooseIsland에서 approval로 닿는다', async () => {
  let exposed: any;
  const api = () => ({ sync: jest.fn(async () => {}) });
  const s = await render(
    <Harness
      route="chooseIsland"
      api={api}
      expose={(x: any) => (exposed = x)}
      seed={(d: any) => d({ type: 'ISLAND_SYNC_REQUESTS', requests: [pendingReq()] })}
    />,
  );
  await waitFor(() => s.getByTestId('pending-resume'));
  await fireEvent.press(s.getByTestId('pending-resume'));
  assert.equal(exposed.go.mock.calls[0][0], 'approval');
  assert.equal(exposed.go.mock.calls[0][1], 'isl-9');
});

test('joinIsland를 나갔다 같은 route로 재진입하면 explore를 다시 부른다', async () => {
  const explore = jest.fn(async () => {});
  const api = () => ({ explore });
  const s = await render(<Harness route="joinIsland" api={api} />);
  await waitFor(() => assert.equal(explore.mock.calls.length, 1));
  await s.rerender(<Harness route="chooseIsland" api={api} />);
  await s.rerender(<Harness route="joinIsland" api={api} />);
  await waitFor(() => assert.equal(explore.mock.calls.length, 2));
});

test('초대 코드가 없으면 resolve 오류를 코드별 문구로 보여준다', async () => {
  const api = () => ({
    resolveInvite: jest.fn(async () => {
      throw new ApiError('SLUG_NOT_FOUND', 'not found', 404);
    }),
  });
  const s = await render(<Harness route="chooseIsland" api={api} />);
  await fireEvent.press(s.getByTestId('invite-open'));
  await fireEvent.changeText(s.getByLabelText('초대 코드'), 'WRONG');
  await fireEvent.press(s.getByLabelText('확인'));
  await waitFor(() => s.getByText('초대 코드를 다시 확인해 주세요.'));
});
