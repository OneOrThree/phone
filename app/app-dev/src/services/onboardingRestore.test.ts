import { restoredRoute } from './restore';
import { firstStoryStep } from '@/screens/onboarding/story';
import { initialState, reducer } from './model';

test('이름·색 저장 뒤에도 첫 대화 구간은 처음부터, 망원경 구간은 안내부터 복구한다', () => {
  for (const checkpoint of ['intro', 'scope'] as const) {
    expect(
      restoredRoute({ loggedIn: true, onboardingStory: checkpoint }, { onboardingComplete: true }),
    ).toBe('character');
    expect(firstStoryStep(checkpoint)).toBe(checkpoint === 'scope' ? 'scopeIntro' : 'choose');
  }
});
test('진행 중인 실제 바다 집중은 스토리 체크포인트보다 우선한다', () => {
  expect(
    restoredRoute(
      { onboardingStory: 'scope', session: { kind: 'sea', status: 'active' } },
      { onboardingComplete: true },
    ),
  ).toBe('sea');
});
test('기존 계정은 온보딩을 재생하지 않고 완료한 무소속 사용자는 바다로 돌아온다', () => {
  expect(restoredRoute({ onboarded: true }, { onboardingComplete: true })).toBe('home');
  expect(restoredRoute({}, { onboardingComplete: true })).toBe('chooseIsland');
  expect(restoredRoute({ onboardingStory: 'done' }, { onboardingComplete: true })).toBe('sea');
});
test('프로필 미완료·인증 만료는 로컬 완료 표시를 신뢰하지 않는다', () => {
  expect(restoredRoute({ onboardingStory: 'done' }, { onboardingComplete: false })).toBe(
    'character',
  );
  expect(restoredRoute({ onboardingStory: 'scope' }, null, true)).toBe('login');
});
test('계정 초기화는 이야기 체크포인트도 지운다', () => {
  const state = reducer(initialState(), { type: 'ONBOARDING_STORY', checkpoint: 'scope' });
  expect(state.onboardingStory).toBe('scope');
  expect(reducer(state, { type: 'RESET' }).onboardingStory).toBeUndefined();
});

test('응답 직후 앱이 종료돼도 실제 항해 복구로 온보딩을 완료하고 이후 무세션 재시작도 바다로 간다', () => {
  const state = { ...initialState(), loggedIn: true, onboardingStory: 'scope' as const };
  const recovered = reducer(state, {
    type: 'SESSION_SYNC',
    session: { id: 'sea-1', kind: 'sea', status: 'active' },
  });
  expect(recovered.onboardingStory).toBe('done');
  const ended = reducer(recovered, { type: 'SESSION_SYNC', session: null });
  expect(restoredRoute(ended, { onboardingComplete: true })).toBe('sea');
});
