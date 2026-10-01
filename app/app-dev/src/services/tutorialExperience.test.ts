import { initialState, reducer, type State } from '@/services/model';
import { reconcileTutorial } from '@/services/tutorial';
import {
  isTutorialExperience,
  tutorialExperienceScene,
  tutorialExperienceAction,
} from '@/services/tutorialExperience';

const start = () => {
  const state = reducer(initialState(true), { type: 'GUIDE_STEP', step: 8 });
  return reducer(state, { type: 'TUTORIAL_EXPERIENCE_START', subject: '첫 집중', now: 1000 });
};
const step = (s: State, value: number) => reducer(s, { type: 'GUIDE_STEP', step: value });

test('체험 시작·휴식·재개·종료는 실제 집중·통계·지갑을 바꾸지 않는다', () => {
  const original = start();
  let state = step(original, 11);
  const sessionId = state.tutorialExperience!.session!.id;
  state = reducer(state, { type: 'TUTORIAL_EXPERIENCE_REWARD', sessionId });
  state = reducer(state, { type: 'TUTORIAL_EXPERIENCE_REWARD', sessionId });
  state = reducer(state, { type: 'TUTORIAL_EXPERIENCE_PAUSE', now: 7000 });
  expect(reconcileTutorial(state, 'rest')).toBe(15);
  state = reducer(state, { type: 'TUTORIAL_EXPERIENCE_RESUME', now: 9000 });
  state = reducer(state, { type: 'TUTORIAL_EXPERIENCE_FINISH', now: 129000 });
  expect(state.tutorialExperience!.result).toMatchObject({ seconds: 126, fish: 1 });
  expect(reconcileTutorial(state, 'focusResult')).toBe(19);
  expect(state.session).toBeNull();
  expect(state.records).toEqual(original.records);
  expect(state.lastResult).toEqual(original.lastResult);
  expect(state.islands).toEqual(original.islands);
  expect(state.rewards).toEqual(original.rewards);
});

test('건너뛰기·재시작·로그아웃 이후 이전 보상 응답을 적용하지 않는다', () => {
  const state = step(start(), 11);
  const sessionId = state.tutorialExperience!.session!.id;
  for (const action of [
    { type: 'GUIDE_STEP', step: 99 },
    { type: 'GUIDE_STEP', step: 0 },
    { type: 'LOGOUT' },
  ]) {
    const cleared = reducer(state, action);
    expect(cleared.tutorialExperience).toBeUndefined();
    expect(reducer(cleared, { type: 'TUTORIAL_EXPERIENCE_REWARD', sessionId })).toBe(cleared);
  }
  const next = start();
  expect(reducer(next, { type: 'TUTORIAL_EXPERIENCE_REWARD', sessionId })).toBe(next);
});

test('재실행은 체험 타이머를 버리고 홈의 시작 버튼부터 다시 안내한다', () => {
  const saved = step(start(), 11);
  const loaded = reducer(initialState(), { type: 'LOAD', state: saved, now: 500000 });
  expect(loaded.session).toBeNull();
  expect(loaded.tutorialExperience).toBeUndefined();
  expect(reconcileTutorial(loaded, 'home', true)).toBe(4);
});

test('실제 세션은 체험으로 바꾸지 않고 장면 투영은 원본 상태를 바꾸지 않는다', () => {
  const state = start();
  expect(isTutorialExperience(state)).toBe(true);
  const projected = tutorialExperienceScene(state);
  expect(projected.session).toEqual(state.tutorialExperience!.session);
  expect(projected.islands.every((i) => i.members.length === 0 && i.quests.length === 0)).toBe(
    true,
  );
  expect(state.islands.some((i) => i.members.length > 0)).toBe(true);
  state.session = state.tutorialExperience!.session;
  expect(isTutorialExperience(state)).toBe(false);
  const synced = reducer(state, {
    type: 'SESSION_SYNC',
    session: { ...state.session, version: 1 },
  });
  expect(synced.tutorialExperience).toBeUndefined();
  expect(synced.session?.version).toBe(1);
  expect(reducer(state, { type: 'TUTORIAL_EXPERIENCE_START', subject: '중복' })).toBe(state);
  expect(tutorialExperienceAction('START')).toBe('TUTORIAL_EXPERIENCE_START');
  expect(tutorialExperienceAction('FOCUS_SPOT')).toBe('TUTORIAL_EXPERIENCE_SPOT');
});

test('서버 소속만 있고 로컬 목업 섬에는 가입하지 않아도 자리 선택·체험을 시작한다', () => {
  let state = initialState();
  state = reducer(state, {
    type: 'ISLAND_SYNC',
    memberships: { items: [{ id: 'server-island' }], currentIslandId: 'server-island' },
  });
  state = step(state, 8);
  expect(state.islands.find((i) => i.id === state.islandId)?.joined).toBe(false);
  state = reducer(state, { type: 'TUTORIAL_EXPERIENCE_SPOT', spot: { x: 40, y: 50 } });
  expect(state.focusSpot).toEqual({ x: 40, y: 50 });
  state = reducer(state, { type: 'TUTORIAL_EXPERIENCE_START', subject: '서버 체험' });
  expect(state.tutorialExperience?.session?.islandId).toBe('server-island');
  expect(tutorialExperienceScene(state).islands.find((i) => i.id === state.islandId)?.joined).toBe(
    true,
  );
  expect(state.session).toBeNull();
});

test.each([11, 19, 20, 21])(
  '구버전의 실제 세션 완료 결과(%s단계)는 체험으로 덮지 않는다',
  (value) => {
    let state = reducer(initialState(true), { type: 'START', subject: '기존 집중', now: 1000 });
    state = step(state, value);
    state = reducer(state, { type: 'FINISH', now: 121000 });
    expect(state.session).toBeNull();
    expect(state.lastResult?.fish).toBe(2);
    expect(isTutorialExperience(state)).toBe(false);
    expect(isTutorialExperience(step(state, 8))).toBe(true);
  },
);
