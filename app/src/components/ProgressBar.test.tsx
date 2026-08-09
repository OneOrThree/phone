// ProgressBar — 잠그는 규칙: 진행률 → 채움 폭(퍼센트) 변환, 0~1 클램프, 접근성 값.
// 채워지는 과정(transition)은 단언하지 않는다 — jest에서 CSS 애니메이션은 실행되지 않는다.
import { StyleSheet } from 'react-native';
import { act, render, screen, waitFor } from '@testing-library/react-native';
import { T } from '@/constants/theme';
import { ProgressBar } from './ProgressBar';

let mockReduce = false;
jest.mock('@/hooks/useReduceMotion', () => ({ useReduceMotion: () => mockReduce }));

beforeEach(() => {
  mockReduce = false;
});

const fillStyle = (testID: string) =>
  StyleSheet.flatten(screen.getByTestId(`${testID}.fill`).props.style);
// reanimated가 CSS 전환 프로퍼티를 호스트 뷰 style에서 걷어내므로, 전환이 붙었는지는
// jest 환경에서 원본 인라인 스타일을 노출해 주는 `jestInlineStyle`로 본다.
const fillInlineStyle = (testID: string) =>
  StyleSheet.flatten(screen.getByTestId(`${testID}.fill`).props.jestInlineStyle);

// 진입 2단계(첫 프레임 0% → 다음 프레임 목표 폭)를 act 안에서 흘려보낸다.
// 목킹된 requestAnimationFrame이 setTimeout(0)이라 매크로태스크 한 틱이면 충분하다.
// 이걸 안 하면 최종 폭을 단언하지 않는 테스트에서 rAF 콜백이 act 밖에서 setState를 때려
// "not wrapped in act" 경고가 난다.
const flushEnter = () => act(async () => new Promise((r) => setTimeout(r, 0)));

describe('ProgressBar', () => {
  test('progress=0.5면 채움 폭이 50%다', async () => {
    await render(<ProgressBar progress={0.5} color={T.accent} testID="bar" />);
    await waitFor(() => expect(fillStyle('bar').width).toBe('50%'));
    expect(screen.getByTestId('bar').props.accessibilityValue).toEqual({
      now: 50,
      min: 0,
      max: 100,
    });
  });

  test('progress=0이면 0%, 1이면 100%', async () => {
    await render(<ProgressBar progress={0} color={T.accent} testID="zero" />);
    await flushEnter();
    expect(fillStyle('zero').width).toBe('0%');
    await render(<ProgressBar progress={1} color={T.accent} testID="full" />);
    await waitFor(() => expect(fillStyle('full').width).toBe('100%'));
  });

  // 목표를 초과한 데이터(집중 목표 130% 달성 등)가 실제로 들어온다.
  test('1을 넘는 값은 100%로 클램프된다', async () => {
    await render(<ProgressBar progress={1.5} color={T.accent} testID="over" />);
    await waitFor(() => expect(fillStyle('over').width).toBe('100%'));
    expect(screen.getByTestId('over').props.accessibilityValue).toMatchObject({ now: 100 });
  });

  test('음수·NaN도 0%로 접힌다 — 막대가 사라지거나 반대로 뻗지 않게', async () => {
    await render(<ProgressBar progress={-0.3} color={T.accent} testID="neg" />);
    await flushEnter();
    expect(fillStyle('neg').width).toBe('0%');
    await render(<ProgressBar progress={0 / 0} color={T.accent} testID="nan" />);
    await flushEnter();
    expect(fillStyle('nan').width).toBe('0%');
    expect(screen.getByTestId('nan').props.accessibilityValue).toMatchObject({ now: 0 });
  });

  test("VoiceOver가 진행바로 읽는다 — accessibilityRole='progressbar'", async () => {
    await render(<ProgressBar progress={0.25} color={T.accent} testID="bar" />);
    await flushEnter();
    expect(screen.getByTestId('bar').props.accessibilityRole).toBe('progressbar');
  });

  // 둥근 캡이 이 컴포넌트가 scaleX 대신 width를 쓰는 이유 자체라, 기본값을 고정해 둔다.
  test('radius 기본값은 height/2 — 완전한 둥근 캡', async () => {
    await render(<ProgressBar progress={0.5} color={T.accent} height={10} testID="bar" />);
    await flushEnter();
    expect(StyleSheet.flatten(screen.getByTestId('bar').props.style).borderRadius).toBe(5);
    expect(fillStyle('bar').borderRadius).toBe(5);
  });

  // scaleX가 아니라 width를 애니메이트한다는 결정(D10)이 실제 배선까지 왔는지 —
  // 전환 대상 프로퍼티만 확인한다(duration·커브는 단언하지 않는다).
  test('채움은 width 전환으로 움직인다', async () => {
    await render(<ProgressBar progress={0.5} color={T.accent} testID="bar" />);
    await flushEnter();
    expect(fillInlineStyle('bar').transitionProperty).toBe('width');
  });

  // ⚠️ 회귀 방어(codex 리뷰) — CSS transition은 **이전 렌더와 값이 달라야** 실행된다.
  //    첫 렌더부터 최종 폭으로 그리면 채우기 연출이 통째로 재생되지 않는데, "화면에 들어올 때
  //    이미 계산된 진행률을 넘긴다"가 오히려 기본 사용 경로다. 첫 프레임 0%가 그 방지 장치다.
  test('첫 프레임은 0%에서 시작해 목표 폭으로 전환된다 — 진입 시 채우기가 재생되게', async () => {
    await render(<ProgressBar progress={0.6} color={T.accent} testID="bar" />);
    expect(fillStyle('bar').width).toBe('0%');
    await waitFor(() => expect(fillStyle('bar').width).toBe('60%'));
    // 접근성 값은 첫 프레임부터 **최종값**이어야 한다 — VoiceOver가 0%를 읽으면 안 된다.
    expect(screen.getByTestId('bar').props.accessibilityValue).toMatchObject({ now: 60 });
  });

  test('reduce=true면 전환 스타일도 2단계 진입도 없이 곧바로 최종 폭이다', async () => {
    mockReduce = true;
    await render(<ProgressBar progress={0.5} color={T.accent} testID="bar" />);
    await flushEnter();
    expect(fillInlineStyle('bar').transitionProperty).toBeUndefined();
    expect(fillStyle('bar').width).toBe('50%');
  });
});
