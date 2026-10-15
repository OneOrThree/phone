import { initialState, reducer } from '@/services/model';
import { findReachableTutorialSpot, reconcileTutorial } from '@/services/tutorial';

function progress(step: number) {
  let state = reducer(initialState(true), { type: 'START', subject: '첫 집중', now: 1000 });
  state = reducer(state, { type: 'GUIDE_STEP', step });
  return state;
}

test('안내 단계와 세션 식별자를 실제 저장본 LOAD로 함께 복구한다', () => {
  const before = progress(11);
  const saved = JSON.parse(JSON.stringify(before));
  const restored = reducer(initialState(), { type: 'LOAD', state: saved, now: 2000 });
  expect(restored.tutorial).toEqual({ step: 11, sessionId: before.session!.id });
  expect(reconcileTutorial(restored, 'focus', true)).toBe(11);
});

test.each([9, 11, 14, 18])(
  '집중 %s단계에서 세션이 휴식으로 복구되면 이어가기 안내를 연다',
  (step) => {
    const state = progress(step);
    state.session!.status = 'paused';
    expect(reconcileTutorial(state, 'rest', true)).toBe(15);
  },
);

test('휴식 충돌 복구는 실제 목적지에 맞춰 집중·결과·홈 안내로 정렬한다', () => {
  const state = progress(15);
  expect(reconcileTutorial(state, 'focus')).toBe(16);
  const finished = reducer(state, { type: 'FINISH', now: 61000 });
  expect(reconcileTutorial(finished, 'focusResult')).toBe(19);
  expect(reconcileTutorial(finished, 'home', true)).toBe(4);
});

test('종료 확인창은 재실행할 때만 종료 버튼 단계로 되돌린다', () => {
  const state = progress(18);
  expect(reconcileTutorial(state, 'focus', true)).toBe(17);
  expect(reconcileTutorial(state, 'focus')).toBe(18);
});

test('집중 시작 직후 저장된 세션은 시작 안내로, 진행 중 이동은 기존 단계로 둔다', () => {
  const state = progress(8);
  expect(reconcileTutorial(state, 'focus', true)).toBe(9);
  state.tutorial = { step: 5 };
  state.session = null;
  expect(reconcileTutorial(state, 'home')).toBe(5);
  expect(reconcileTutorial(state, 'focusTravel')).toBe(5);
  expect(reconcileTutorial(state, 'home', true)).toBe(4);
});

test('다른 세션·완료·건너뛰기·기존 사용자에게 이전 안내를 강제하지 않는다', () => {
  const state = progress(14);
  state.session!.id = 'other-session';
  expect(reconcileTutorial(state, 'focus', true)).toBe(99);
  state.tutorial = { step: 22 };
  expect(reconcileTutorial(state, 'focus', true)).toBe(22);
  state.tutorial = { step: 99 };
  expect(reconcileTutorial(state, 'rest', true)).toBe(99);
  delete state.tutorial;
  expect(reconcileTutorial(state, 'rest', true)).toBe(0);
});

test('로그아웃·다시보기는 이전 세션과의 연결을 제거한다', () => {
  const state = progress(15);
  expect(reducer(state, { type: 'LOGOUT' }).tutorial).toBeUndefined();
  expect(reducer(state, { type: 'GUIDE_STEP', step: 0 }).tutorial).toEqual({ step: 0 });
});

test.each([
  [8, 9],
  [14, 15],
  [15, 16],
  [18, 19],
  [6, 7],
])('%s단계에서 시작한 비동기 완료는 건너뛰기·새 회차를 덮어쓰지 않는다', (from, to) => {
  const original = progress(from);
  const expected = { step: from, revision: original.tutorialRevision };
  const skipped = reducer(original, { type: 'GUIDE_STEP', step: 99 });
  expect(reducer(skipped, { type: 'GUIDE_STEP', step: to, expected })).toBe(skipped);
  const restarted = reducer(skipped, { type: 'GUIDE_STEP', step: from });
  expect(reducer(restarted, { type: 'GUIDE_STEP', step: to, expected })).toBe(restarted);
  expect(reducer(original, { type: 'GUIDE_STEP', step: to, expected }).tutorial?.step).toBe(to);
});

const syncMembership = (
  state: ReturnType<typeof initialState>,
  id: string | null,
  lossReason: string | null = null,
) =>
  reducer(state, {
    type: 'ISLAND_SYNC',
    memberships: {
      items: id ? [{ id, name: '첫 섬' }] : [],
      currentIslandId: id,
      lossReason,
    },
  });

test('서버에서 소속 없음 확인 → 최초 소속 확정 때만 첫 안내를 준비한다', () => {
  const empty = syncMembership(initialState(), null);
  expect(empty.tutorialEnrollment).toBe('awaiting-first-island');
  expect(empty.tutorial).toBeUndefined();
  const joined = syncMembership(empty, 'first');
  expect(joined.tutorial).toEqual({ step: 0 });
  const finished = reducer(joined, { type: 'GUIDE_STEP', step: 99 });
  expect(syncMembership(finished, 'second').tutorial?.step).toBe(99);
});

test('기존 소속·탈퇴 이력·기존 기록은 신규 안내 대상이 아니다', () => {
  const existing = syncMembership(initialState(), 'existing');
  expect(existing.tutorial).toBeUndefined();
  expect(syncMembership(syncMembership(existing, null), 'next').tutorial).toBeUndefined();
  expect(
    syncMembership(syncMembership(initialState(), null, 'LEFT'), 'next').tutorial,
  ).toBeUndefined();
});

test('로그아웃 뒤 같은 기기의 새 계정은 이전 계정의 로컬 기록과 무관하게 서버 응답으로 판정한다', () => {
  // 이전 계정의 onboarded·records 는 LOGOUT 뒤에도 남는다 — 새 계정의 첫 안내를 막으면 안 된다
  const finished = reducer(progress(15), { type: 'FINISH', now: 61000 });
  const previous = syncMembership(finished, 'old-island');
  expect(previous.onboarded).toBe(true);
  expect(previous.records.length).toBeGreaterThan(0);
  const loggedOut = reducer(previous, { type: 'LOGOUT' });
  const empty = syncMembership(loggedOut, null);
  expect(empty.tutorialEnrollment).toBe('awaiting-first-island');
  expect(syncMembership(empty, 'new-island').tutorial).toEqual({ step: 0 });
});

test('승인 대기 중 재시작해도 최초 소속 확인 상태를 보존한다', () => {
  const empty = syncMembership(initialState(), null);
  const loaded = reducer(initialState(), {
    type: 'LOAD',
    state: JSON.parse(JSON.stringify(empty)),
  });
  const approved = reducer(loaded, {
    type: 'ISLAND_SYNC',
    memberships: { items: [{ id: 'first' }], currentIslandId: null, lossReason: null },
  });
  expect(approved.tutorial).toBeUndefined();
  expect(syncMembership(approved, 'first').tutorial?.step).toBe(0);
});

test('재설치·새 기기의 첫 응답이 소속만 있고 current 가 비어도 최초 확정 전 상태로 본다', () => {
  // 첫 pending 승인은 소속만 만들고 current 는 옮기지 않는다(islandCommands 의 유효 상태)
  const approved = reducer(initialState(), {
    type: 'ISLAND_SYNC',
    memberships: { items: [{ id: 'first' }], currentIslandId: null, lossReason: null },
  });
  expect(approved.tutorialEnrollment).toBe('awaiting-first-island');
  expect(approved.tutorial).toBeUndefined();
  expect(syncMembership(approved, 'first').tutorial).toEqual({ step: 0 });
});

test('휴식 이동 취소는 14단계를 유지하고 실제 모닥불 도착만 15단계로 진행한다', () => {
  const state = progress(14);
  state.session!.status = 'paused';
  expect(reconcileTutorial(state, 'focus')).toBe(14);
  expect(reconcileTutorial(state, 'rest')).toBe(15);
  state.session!.status = 'active';
  expect(reconcileTutorial(state, 'focus')).toBe(14);
});

test('접근성 자리 선택은 막힌 기본 자리와 연결되지 않은 땅을 제외한다', () => {
  const grid = { w: 5, h: 1, cols: 5, rows: 1, cells: '11011' };
  expect(
    findReachableTutorialSpot(grid, { x: 0.5, y: 0.5 }, { x: 4.5, y: 0.5 }, (p) => p.x !== 0.5),
  ).toEqual({ x: 1.5, y: 0.5 });
  expect(
    findReachableTutorialSpot(grid, { x: 0.5, y: 0.5 }, { x: 0.5, y: 0.5 }, () => false),
  ).toBeNull();
});
