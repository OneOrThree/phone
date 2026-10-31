import AsyncStorage from '@react-native-async-storage/async-storage';
import { captureProductEvent } from '@/services/posthog';
import {
  markActivationStage,
  markLoginViewed,
  resetActivationJourneyForTest,
} from '@/services/activationJourney';

jest.mock('@/services/posthog', () => ({ captureProductEvent: jest.fn() }));

const capture = captureProductEvent as jest.Mock;
const steps = (stage: string) =>
  capture.mock.calls.filter(
    ([event, props]) => event === 'activation_step' && props.stage === stage,
  );

beforeEach(async () => {
  await AsyncStorage.clear();
  resetActivationJourneyForTest();
  capture.mockClear();
});

test('login_viewed 는 익명이라 앱 실행당 한 번만 발행한다', () => {
  markLoginViewed();
  markLoginViewed();
  expect(steps('login_viewed')).toHaveLength(1);
  expect(steps('login_viewed')[0][1]).toMatchObject({
    activation_schema_version: 1,
    journey: 'first_island',
    stage: 'login_viewed',
  });
});

test('계정 stage 는 한 번만 발행하고 같은 stage 재호출을 무시한다', async () => {
  await markActivationStage('u1', 'login_completed', { extra: { provider: 'google' } });
  await markActivationStage('u1', 'login_completed', { extra: { provider: 'google' } });
  expect(steps('login_completed')).toHaveLength(1);
  expect(steps('login_completed')[0][1]).toMatchObject({
    stage: 'login_completed',
    journey: 'first_island',
    provider: 'google',
  });
});

test('prerequisite 가 그 계정에 없으면 건너뛴다 — 기존·재설치 계정이 뒤 단계를 만들지 않는다', async () => {
  await markActivationStage('u2', 'island_arrived', { prerequisite: 'login_completed' });
  expect(steps('island_arrived')).toHaveLength(0);

  await markActivationStage('u2', 'login_completed');
  await markActivationStage('u2', 'island_arrived', { prerequisite: 'login_completed' });
  expect(steps('island_arrived')).toHaveLength(1);
});

test('userId 가 없으면 발행하지 않는다', async () => {
  await markActivationStage(undefined, 'login_completed');
  expect(capture.mock.calls).toHaveLength(0);
});

test('timestamp 를 주면 captureProductEvent 에 이벤트 시각으로 전달한다', async () => {
  const when = new Date('2026-09-22T01:00:00Z');
  await markActivationStage('u3', 'login_completed');
  await markActivationStage('u3', 'first_focus_started', { prerequisite: 'login_completed' });
  await markActivationStage('u3', 'first_focus_completed', {
    prerequisite: 'first_focus_started',
    extra: { duration_seconds: 900 },
    timestamp: when,
  });
  const completed = steps('first_focus_completed');
  expect(completed).toHaveLength(1);
  expect(completed[0][2]).toEqual({ timestamp: when });
});
