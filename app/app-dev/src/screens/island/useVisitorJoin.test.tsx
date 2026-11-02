// 방문자 가입 훅(GROMO-2259) — 회관 방문자 카드와 방문 지도 하단 버튼·떠나기 확인창이 같이 쓴다.
// 알림·라벨이 t() 로 나가는지(두 언어) 와 가입·신청·취소 흐름을 본다.
import { act, renderHook } from '@testing-library/react-native';
import { applyLocalePref } from '@/i18n';
import { useVisitorJoin } from '@/screens/island/useVisitorJoin';
import { initialState, reducer, viewIsland, type State } from '@/services/model';

afterEach(() => applyLocalePref('system'));

const visitState = (over: { pending?: boolean } = {}): State => {
  let state = reducer(initialState(true), {
    type: 'ISLAND_SYNC',
    memberships: { items: [], currentIslandId: null, nextCursor: null, lossReason: null },
  });
  state = reducer(state, {
    type: 'ISLAND_VISIT',
    visit: {
      island: {
        id: 'v1',
        name: '구경섬',
        intro: '',
        memberCount: 3,
        maxMembers: 15,
        approvalRequired: !!over.pending,
        membershipStatus: 'none',
      },
      buildings: ['hall'],
      members: { items: [], nextCursor: null, version: 1 },
      joinRequestAvailability: 'available',
      joinRequest: over.pending ? { id: 'r1', islandId: 'v1', status: 'pending' } : null,
    },
  } as any);
  return reducer(state, { type: 'SERVER_VISITING', islandId: 'v1' } as any);
};

async function setup(state: State, joinResult: object | Promise<object> = { status: 'active' }) {
  const e = {
    islands: { join: jest.fn().mockResolvedValue(joinResult), cancel: jest.fn() },
    dispatch: jest.fn(),
    reset: jest.fn(),
    notify: jest.fn(),
  };
  const notify = jest.fn();
  const hook = await renderHook(() => useVisitorJoin(e, state, viewIsland(state, 'v1'), notify));
  return { e, notify, hook };
}

test.each([
  ['ko', '이 섬에 가입', '구경섬 주민이 됐어요'],
  ['en', 'Join This Island', "You're now a resident of 구경섬"],
] as const)('%s — 바로 가입이면 구경을 끝내고 홈으로 간다', async (locale, label, joined) => {
  applyLocalePref(locale);
  const { e, hook } = await setup(visitState());
  expect(hook.result.current.label).toBe(label);
  await act(async () => hook.result.current.serverJoin());
  expect(e.islands.join).toHaveBeenCalledWith('v1', { showApproval: false });
  expect(e.dispatch).toHaveBeenCalledWith({ type: 'END_VISIT' });
  expect(e.reset).toHaveBeenCalledWith('home');
  expect(e.notify).toHaveBeenCalledWith(joined);
});

test.each([
  ['ko', '참여 신청이 완료됐어요. 섬장이 확인하면 알려드릴게요.'],
  ['en', "Request sent. We'll let you know once the host responds."],
] as const)('%s — 승인제 가입은 신청 완료만 알리고 구경을 이어 간다', async (locale, text) => {
  applyLocalePref(locale);
  const { e, notify, hook } = await setup(visitState(), { status: 'pending' });
  await act(async () => hook.result.current.serverJoin());
  expect(notify).toHaveBeenCalledWith(text);
  expect(e.dispatch).not.toHaveBeenCalled();
  expect(e.reset).not.toHaveBeenCalled();
});

test.each([
  ['ko', '신청 취소', '가입 신청을 취소했어요.'],
  ['en', 'Cancel Join Request', 'Your join request was cancelled.'],
] as const)('%s — 신청 중이면 라벨이 취소로 바뀌고 취소를 알린다', async (locale, label, text) => {
  applyLocalePref(locale);
  const { e, notify, hook } = await setup(visitState({ pending: true }));
  expect(hook.result.current.join).toBe('cancel');
  expect(hook.result.current.label).toBe(label);
  await act(async () => hook.result.current.serverJoin());
  expect(e.islands.cancel).toHaveBeenCalledWith('r1');
  expect(e.islands.join).not.toHaveBeenCalled();
  expect(notify).toHaveBeenCalledWith(text);
});

test.each([
  ['ko', '집중이나 휴식을 마친 뒤 가입해 주세요.'],
  ['en', 'Finish your focus session or break before joining.'],
] as const)('%s — 집중·휴식 중에는 가입을 요청하지 않고 안내한다', async (locale, text) => {
  applyLocalePref(locale);
  const state = { ...visitState(), session: { id: 's1' } } as unknown as State;
  const { e, notify, hook } = await setup(state);
  await act(async () => hook.result.current.serverJoin());
  expect(notify).toHaveBeenCalledWith(text);
  expect(e.islands.join).not.toHaveBeenCalled();
});

test.each([
  ['ko', '처리 중이에요'],
  ['en', 'Updating…'],
] as const)('%s — 요청 중에는 처리 중 라벨이고 다시 눌리지 않는다', async (locale, busy) => {
  applyLocalePref(locale);
  let finish!: (v: object) => void;
  const { e, hook } = await setup(visitState(), new Promise<object>((r) => (finish = r)));
  await act(async () => void hook.result.current.serverJoin());
  expect(hook.result.current.label).toBe(busy);
  expect(hook.result.current.disabled).toBe(true);
  await act(async () => void hook.result.current.serverJoin());
  expect(e.islands.join).toHaveBeenCalledTimes(1);
  await act(async () => finish({ status: 'pending' }));
  expect(hook.result.current.disabled).toBe(false);
});
