import { render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { semanticTokens } from '@/design-system/tokens';
import { applyLocalePref } from '@/i18n';
import { VerificationToggle } from './VerificationSpike';

afterEach(() => applyLocalePref('system'));

// 라벨은 컨트롤 가운데 아래에 붙으므로, 두 라벨 폭의 절반 합이 두 컨트롤 중심 간격 이하면 겹치지 않는다.
test.each([
  ['ko', 'AI집중측정', '미리보기'],
  ['en', 'AI Focus Tracking', 'Preview'],
])('%s 스위치·미리보기 라벨은 한 줄로 줄어들고 서로의 자리를 넘지 않는다', async (locale, a, b) => {
  applyLocalePref(locale);
  const screen = await render(<VerificationToggle on={false} onChange={jest.fn()} />);
  const width = (node: { props: Record<string, any> }) =>
    StyleSheet.flatten(node.props.style).width as number;
  const centers =
    width(screen.getByRole('switch')) / 2 +
    semanticTokens.spacing.control +
    width(screen.getByRole('button')) / 2;
  const labels = [screen.getByText(a), screen.getByText(b)];
  for (const label of labels) {
    expect(label.props.numberOfLines).toBe(1);
    expect(label.props.adjustsFontSizeToFit).toBe(true);
    expect(label.props.maxFontSizeMultiplier).toBe(semanticTokens.typography.largeTextThreshold);
    expect(width(label)).toBeLessThanOrEqual(centers);
  }
  expect(width(labels[0]) / 2 + width(labels[1]) / 2).toBeLessThanOrEqual(centers);
});
