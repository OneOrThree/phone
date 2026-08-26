import { render, screen, fireEvent, act } from '@testing-library/react-native';
import { Text } from 'react-native';
import StepScaffold from '@/screens/onboarding/components/StepScaffold';
import { OnboardingStepContext } from '@/screens/onboarding/components/OnboardingStepContext';
import { logOnboardingStepCta } from '@/services/analyticsEvents';
import type { OnboardingStepName } from '@/services/analyticsEvents';

// StepScaffold가 useSafeAreaInsets를 쓴다 — 테스트 트리엔 SafeAreaProvider가 없어 고정값으로 대체한다.
jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context'),
  useSafeAreaInsets: () => ({ top: 47, left: 0, right: 0, bottom: 34 }),
}));

jest.mock('@/services/analyticsEvents', () => ({
  logOnboardingStepCta: jest.fn(),
}));

const mockLog = logOnboardingStepCta as jest.Mock;

// 이 테스트가 지키는 계약: 온보딩 CTA 계측은 **StepScaffold 한 곳**에서 나간다(GROMO-1605).
// 스텝 12개가 이 버튼을 공유하므로, 여기가 조용해지면 화면별 이탈률이 통째로 사라진다.
describe('StepScaffold CTA 계측', () => {
  beforeEach(() => mockLog.mockClear());

  // RTL v14의 render는 async다 — 반드시 await한다.
  async function renderScaffold(
    step: OnboardingStepName | null,
    opts: { onCta?: () => void; withSecondary?: boolean } = {},
  ) {
    const { onCta = () => {}, withSecondary = true } = opts;
    await render(
      <OnboardingStepContext.Provider value={step}>
        <StepScaffold
          title="제목"
          ctaLabel="다음"
          onCta={onCta}
          secondaryLabel={withSecondary ? '건너뛰기' : undefined}
          onSecondary={() => {}}
        >
          <Text>본문</Text>
        </StepScaffold>
      </OnboardingStepContext.Provider>,
    );
    await act(async () => {});
  }

  const press = async (testID: string) => {
    await act(async () => {
      fireEvent.press(screen.getByTestId(testID));
    });
  };

  it('메인 CTA를 누르면 action=cta로 현재 스텝을 발행한다', async () => {
    await renderScaffold('goal_setting');
    await press('onboarding.cta');
    expect(mockLog).toHaveBeenCalledWith({ step: 'goal_setting', action: 'cta' });
  });

  it('보조 액션을 누르면 action=secondary로 발행한다', async () => {
    await renderScaffold('screentime_permission');
    await press('onboarding.secondary');
    expect(mockLog).toHaveBeenCalledWith({ step: 'screentime_permission', action: 'secondary' });
  });

  it('원래 onCta 동작을 막지 않는다', async () => {
    const onCta = jest.fn();
    await renderScaffold('nickname', { onCta, withSecondary: false });
    await press('onboarding.cta');
    expect(onCta).toHaveBeenCalledTimes(1);
  });

  it('온보딩 플로우 밖(스텝 이름 없음)에서는 발행하지 않는다', async () => {
    await renderScaffold(null);
    await press('onboarding.cta');
    expect(mockLog).not.toHaveBeenCalled();
  });
});
