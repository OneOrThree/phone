import { restoredRoute } from './restore';
import { firstStoryStep } from '@/screens/onboarding/story';
import { initialState, reducer } from './model';

test('이름·색 등록을 마친 무소속 계정은 이야기 진행도와 관계없이 바다로 복구한다', () => {
  for (const checkpoint of ['intro', 'scope'] as const) {
    expect(
      restoredRoute({ loggedIn: true, onboardingStory: checkpoint }, { onboardingComplete: true }),
    ).toBe('sea');
    expect(firstStoryStep(checkpoint)).toBe(checkpoint === 'scope' ? 'scope' : 'choose');
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
test('이야기 기록 없는 무소속 계정과 출항 완료한 계정 모두 바다로 돌아온다', () => {
  expect(restoredRoute({ onboarded: true }, { onboardingComplete: true })).toBe('home');
  expect(restoredRoute({}, { onboardingComplete: true })).toBe('sea');
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

test.each(['intro', 'scope'] as const)(
  '다른 기기에서 이미 소속이 생겼으면 오래된 %s 이야기를 재개하지 않는다',
  (onboardingStory) => {
    expect(restoredRoute({ onboarded: true, onboardingStory }, { onboardingComplete: true })).toBe(
      'home',
    );
    expect(
      restoredRoute(
        { onboarded: true, onboardingStory, session: { kind: 'focus', status: 'active' } },
        { onboardingComplete: true },
      ),
    ).toBe('focus');
  },
);
