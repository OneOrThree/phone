// 축하 모달의 **노출 단위 준비 상태**를 잠근다(GROMO-1381 / codex 리뷰).
//
// 잠그는 규칙 하나: 팝 연출은 언제나 "그림이 실제로 올라온 뒤"(CharacterImage onLoad) 시작한다.
// 두 번째 노출에서도 그렇다.
//
// 왜 이게 회귀하는가 — 이 모달은 닫혀도 언마운트되지 않고 visible prop만 false가 된다. RN Modal은
// children만 걷어내므로 다음 노출에서 CharacterImage는 새로 마운트돼 onLoad를 다시 주는데,
// charReady/uiIdle 같은 준비 플래그는 바깥 컴포넌트에 그대로 살아남는다. 닫을 때 되돌리지 않으면
// 두 번째 노출은 새 onLoad를 기다리지 않고 팝을 즉시 시작하고, 누끼 디코딩이 팝(600ms)보다 늦으면
// 사용자가 보기 시작할 땐 이미 끝나 있다 — 캐릭터가 최종 크기로 툭 나타난다.
//
// ⚠️ 중간 프레임·타이밍·이징은 단언하지 않는다(정책 D14) — jest에서 워클릿은 목이다.
//    여기서 보는 것은 "애니메이션이 붙었는가 / 아직 안 붙었는가" 두 상태뿐이다.
import { StyleSheet } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { GoalCelebrationModal } from './GoalCelebrationModal';

// 화면 모듈을 그대로 import 하면 CharacterContext → UserContext → Firebase analytics 까지 딸려와
// 네이티브 모듈이 없는 jest 환경에서 터진다(CharacterSelectScreen.test.ts와 같은 이유).
jest.mock('@/store/CharacterContext', () => ({
  useCharacter: () => ({ activeSource: null }),
}));
// reduce=false 고정 — 이 테스트의 관심사는 '동작 줄이기'가 아니라 준비 상태 초기화다.
jest.mock('@/hooks/useReduceMotion', () => ({
  useReduceMotion: () => false,
  useReduceMotionReady: () => true,
  whenReduceMotionReady: () => Promise.resolve(),
}));

// 팝 래퍼는 시작 프레임이 opacity 0이라 RNTL 기본 질의에서 숨김 처리된다 — 숨김 포함으로 집는다.
const HIDDEN = { includeHiddenElements: true } as const;
const WRAP = 'goalCelebration.character';
const IMAGE = 'goalCelebration.character.image';

// reanimated는 CSS 애니메이션 프로퍼티를 호스트 뷰의 style에서 걷어내 자체 관리로 넘긴다 —
// 원본 인라인 스타일을 그대로 노출해 주는 jestInlineStyle로 확인한다(Skeleton.test.tsx와 동일).
const inlineStyle = () =>
  StyleSheet.flatten(screen.getByTestId(WRAP, HIDDEN).props.jestInlineStyle) ?? {};
const style = () => StyleSheet.flatten(screen.getByTestId(WRAP, HIDDEN).props.style) ?? {};

const hasPop = () => inlineStyle().animationName !== undefined;
const isHidden = () => style().opacity === 0;

function view(visible: boolean) {
  return <GoalCelebrationModal visible={visible} goalStreakDays={3} onClose={() => {}} />;
}

describe('GoalCelebrationModal 캐릭터 팝 진입', () => {
  test('그림이 올라오기 전에는 팝이 시작되지 않고 캐릭터도 보이지 않는다', async () => {
    await render(view(true));
    expect(hasPop()).toBe(false);
    expect(isHidden()).toBe(true);
  });

  test('onLoad가 오면 그때 팝이 붙는다', async () => {
    await render(view(true));
    await fireEvent(screen.getByTestId(IMAGE, HIDDEN), 'load');
    expect(hasPop()).toBe(true);
    expect(isHidden()).toBe(false);
  });

  // ── 회귀 잠금 ──────────────────────────────────────────────────────────────────
  // 닫았다가 다시 열면 준비 상태가 초기화돼, 첫 노출과 **똑같이** 새 onLoad를 기다려야 한다.
  test('두 번째 노출에서도 팝은 새 onLoad를 기다린다', async () => {
    const { rerender } = await render(view(true));
    await fireEvent(screen.getByTestId(IMAGE, HIDDEN), 'load');
    expect(hasPop()).toBe(true);

    await rerender(view(false)); // 닫기 — CTA·딤·시스템 백 어느 경로든 visible=false로 수렴한다
    await rerender(view(true)); // 같은 인스턴스를 다시 노출

    // 초기화되지 않으면 이전 노출의 charReady=true가 남아 여기서 이미 팝이 붙어 있다.
    expect(hasPop()).toBe(false);
    expect(isHidden()).toBe(true);

    // 그리고 새 onLoad가 오면 정상적으로 다시 붙는다(초기화가 팝을 영영 막아버리지 않는다).
    await fireEvent(screen.getByTestId(IMAGE, HIDDEN), 'load');
    expect(hasPop()).toBe(true);
  });
});
