import { render, screen } from '@testing-library/react-native';
import { Platform } from 'react-native';
import ProblemEmpathyStep from './ProblemEmpathyStep';
import SubjectCompareStep from './SubjectCompareStep';
import TogetherEffectStep from './TogetherEffectStep';
import { INITIAL_ONBOARDING_DATA } from '@/screens/onboarding/types';

jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context'),
  useSafeAreaInsets: () => ({ top: 47, left: 0, right: 0, bottom: 34 }),
}));

describe('온보딩 가치 제안 화면', () => {
  const originalPlatform = Platform.OS;
  const stepProps = {
    data: INITIAL_ONBOARDING_DATA,
    update: jest.fn(),
    onNext: jest.fn(),
  };

  afterEach(() => {
    Object.defineProperty(Platform, 'OS', { value: originalPlatform });
  });

  test('방해 앱 차단을 지원하지 않는 플랫폼에는 집중 목표를 안내한다', async () => {
    Object.defineProperty(Platform, 'OS', { value: 'android' });

    await render(<ProblemEmpathyStep {...stepProps} />);

    expect(screen.getByText('집중 목표')).toBeOnTheScreen();
    expect(screen.queryByText('방해 앱 차단')).not.toBeOnTheScreen();
  });

  test('완료 시간과 시간조각 보상이 같은 분 단위로 표시된다', async () => {
    await render(<SubjectCompareStep {...stepProps} />);

    expect(screen.getByText('42분 완료')).toBeOnTheScreen();
    expect(screen.getByText('+42')).toBeOnTheScreen();
    expect(screen.queryByText('+20')).not.toBeOnTheScreen();
  });

  test('함께 집중 화면은 작은 기기에서도 본문을 스크롤할 수 있다', async () => {
    const { container } = await render(<TogetherEffectStep {...stepProps} />);
    const scrollableNodes = container.queryAll((node) => node.props.scrollEnabled === true, {
      includeSelf: true,
    });

    expect(scrollableNodes).toHaveLength(1);
  });
});
