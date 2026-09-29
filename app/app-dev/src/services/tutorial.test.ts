import { initialState, reducer } from '@/services/model';
import { reconcileTutorial } from '@/services/tutorial';

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
