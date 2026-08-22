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

  // GROMO-1604 로 안드로이드 실드가 붙어 **뒤집힌 단언**이다(코드리뷰 반영). 예전엔 이 화면이
  // Platform.OS 를 직접 비교해 안드로이드에 '집중 목표'를 내걸었는데, 공용 술어가 열린 뒤에도
  // 이 화면만 옛 판정에 머물러 신규 안드로이드 사용자가 방금 추가된 핵심 기능 대신 대체 문구를
  // 보게 됐다. 이제 screenTimeCapabilities 한 곳만 본다.
  test('실드를 지원하는 플랫폼에는 방해 앱 차단을 내건다', async () => {
    Object.defineProperty(Platform, 'OS', { value: 'android' });

    const { container } = await render(<ProblemEmpathyStep {...stepProps} />);

    expect(screen.getByText('방해 앱 차단')).toBeOnTheScreen();
    expect(screen.queryByText('집중 목표')).not.toBeOnTheScreen();
    expect(
      container.queryAll((node) => node.props.scrollEnabled === true, { includeSelf: true }),
    ).toHaveLength(1);
  });

  // 실드가 없는 플랫폼에서는 여전히 대체 문구다 — 없는 기능을 내걸면 그게 거짓 약속이다.
  test('실드를 지원하지 않는 플랫폼에는 집중 목표를 안내한다', async () => {
    Object.defineProperty(Platform, 'OS', { value: 'web' });

    await render(<ProblemEmpathyStep {...stepProps} />);

    expect(screen.getByText('집중 목표')).toBeOnTheScreen();
    expect(screen.queryByText('방해 앱 차단')).not.toBeOnTheScreen();
  });

  test('완료 시간과 시간조각 보상이 같은 분 단위이며 작은 화면에서 스크롤된다', async () => {
    const { container } = await render(<SubjectCompareStep {...stepProps} />);

    expect(screen.getByText('42분 완료')).toBeOnTheScreen();
    expect(screen.getByText('+42')).toBeOnTheScreen();
    expect(screen.queryByText('+20')).not.toBeOnTheScreen();
    expect(
      container.queryAll((node) => node.props.scrollEnabled === true, { includeSelf: true }),
    ).toHaveLength(1);
  });

  test('함께 집중 화면은 작은 기기에서도 본문을 스크롤할 수 있다', async () => {
    const { container } = await render(<TogetherEffectStep {...stepProps} />);
    const scrollableNodes = container.queryAll((node) => node.props.scrollEnabled === true, {
      includeSelf: true,
    });

    expect(scrollableNodes).toHaveLength(1);
  });
});
