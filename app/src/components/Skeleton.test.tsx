// Skeleton — 잠그는 규칙은 둘이다.
//   ① '동작 줄이기'가 켜지면 펄스 애니메이션 스타일이 **사라진다**(정지한 회색 블록).
//   ② 스크린리더가 빈 블록을 읽지 않는다.
// 펄스의 중간 프레임·타이밍은 단언하지 않는다 — jest에서 워클릿은 목이라 거짓 안정감이다.
//
// ⚠️ 이 컴포넌트는 접근성 트리에서 숨겨져 있어 RTL 기본 쿼리로는 **찾히지 않는다**.
//    그래서 스타일을 볼 때만 `includeHiddenElements`를 켠다 — 숨김 자체는 아래에서 따로 단언한다.
import { StyleSheet } from 'react-native';
import { render, screen } from '@testing-library/react-native';
import { Skeleton, SkeletonCard, SkeletonText } from './Skeleton';

let mockReduce = false;
jest.mock('@/hooks/useReduceMotion', () => ({ useReduceMotion: () => mockReduce }));

beforeEach(() => {
  mockReduce = false;
});

const HIDDEN = { includeHiddenElements: true } as const;
const styleOf = (testID: string) =>
  StyleSheet.flatten(screen.getByTestId(testID, HIDDEN).props.style);
// reanimated는 CSS 애니메이션 프로퍼티를 호스트 뷰의 style에서 걷어내 자체 관리로 넘긴다.
// 그래서 `props.style`에는 animationName이 남지 않는다 — jest 환경에서 원본 인라인 스타일을
// 그대로 노출해 주는 `jestInlineStyle`로 확인한다.
const inlineStyleOf = (testID: string) =>
  StyleSheet.flatten(screen.getByTestId(testID, HIDDEN).props.jestInlineStyle);

describe('Skeleton', () => {
  test("기본(reduce=false)에는 펄스 애니메이션이 붙는다 — '사라진다'는 단언의 대조군", async () => {
    await render(<Skeleton w={100} h={12} testID="sk" />);
    expect(inlineStyleOf('sk').animationName).toBeDefined();
  });

  test('reduce=true면 스타일에 animationName이 없다', async () => {
    mockReduce = true;
    await render(<Skeleton w={100} h={12} testID="sk" />);
    expect(inlineStyleOf('sk').animationName).toBeUndefined();
    const style = styleOf('sk');
    // 애니메이션만 빠지고 블록 자체는 그대로 남는다(자리표시자 역할은 유지)
    expect(style.width).toBe(100);
    expect(style.height).toBe(12);
  });

  test('스크린리더 포커스에서 제외된다 — iOS·Android 양쪽 prop', async () => {
    await render(<Skeleton w="100%" h={20} testID="sk" />);
    const node = screen.getByTestId('sk', HIDDEN);
    expect(node.props.accessibilityElementsHidden).toBe(true);
    expect(node.props.importantForAccessibility).toBe('no-hide-descendants');
    // 접근성 트리에서 실제로 빠져 있다는 확인 — 기본 쿼리(숨김 제외)로는 찾히지 않는다
    expect(screen.queryByTestId('sk')).toBeNull();
  });

  test('radius 기본값은 8이고 호출부가 덮어쓸 수 있다', async () => {
    await render(<Skeleton w={40} h={40} testID="a" />);
    expect(styleOf('a').borderRadius).toBe(8);
    await render(<Skeleton w={40} h={40} radius={20} testID="b" />);
    expect(styleOf('b').borderRadius).toBe(20);
  });
});

describe('SkeletonText', () => {
  test('lines만큼 줄을 그린다', async () => {
    await render(<SkeletonText lines={3} testID="txt" />);
    expect(screen.getByTestId('txt', HIDDEN).props.children).toHaveLength(3);
  });

  test('래퍼도 스크린리더에서 숨긴다', async () => {
    await render(<SkeletonText lines={2} testID="txt" />);
    const node = screen.getByTestId('txt', HIDDEN);
    expect(node.props.accessibilityElementsHidden).toBe(true);
    expect(node.props.importantForAccessibility).toBe('no-hide-descendants');
  });
});

describe('SkeletonCard', () => {
  // height가 필수 prop인 이유(레이아웃 점프 방지)가 실제로 스타일까지 전달되는지 고정한다.
  test('호출부가 넘긴 실제 카드 높이가 그대로 적용된다', async () => {
    await render(<SkeletonCard height={220} testID="card" />);
    const style = styleOf('card');
    expect(style.height).toBe(220);
    expect(style.width).toBe('100%');
  });
});
