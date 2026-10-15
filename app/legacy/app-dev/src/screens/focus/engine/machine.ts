// 집중 세션 상태 전이 — 순수 함수 계층 (GROMO-1600 헤드리스화 1단계).
//
// FocusSessionScreen에 갇혀 있던 tick 전이를 화면 밖으로 꺼낸다. blockPause/blockToday와
// 같은 부류의 순수 리듀서로, React·타이머·저장소를 모른다. 전이 의미론은 특성화 스위트
// (FocusSessionScreen.characterization.test.tsx, 117개)가 화면 경유로 고정하고 있으므로
// 여기 로직을 바꾸려면 그 스위트가 먼저 말해야 한다.

import type { FocusTimerMode, PomodoroConfig } from '../types';

export interface SessionState {
  elapsed: number; // 실제 집중 초(적립 기준) — 뽀모도로는 집중 블록만 누적
  display: number; // 큰 숫자: countup=경과 / countdown=남음 / pomodoro=현 페이즈 남음
  phase: 'focus' | 'break';
  setIndex: number; // 1-based
  done: boolean;
}

export interface SessionMachineConfig {
  mode: FocusTimerMode;
  goalSeconds: number;
  pomodoro: PomodoroConfig;
}

export function initialSessionState(config: SessionMachineConfig): SessionState {
  return {
    elapsed: 0,
    display:
      config.mode === 'countdown'
        ? config.goalSeconds
        : config.mode === 'pomodoro'
          ? config.pomodoro.focusMin * 60
          : 0,
    phase: 'focus',
    setIndex: 1,
    done: false,
  };
}

// 한 tick 진행 — 모드별 다음 상태 계산.
export function nextTick(config: SessionMachineConfig, prev: SessionState): SessionState {
  if (config.mode === 'countup') {
    return { ...prev, elapsed: prev.elapsed + 1, display: prev.display + 1 };
  }
  if (config.mode === 'countdown') {
    const remaining = prev.display - 1;
    return {
      ...prev,
      elapsed: prev.elapsed + 1,
      display: Math.max(0, remaining),
      done: remaining <= 0,
    };
  }
  // pomodoro
  const pomo = config.pomodoro;
  const elapsed = prev.phase === 'focus' ? prev.elapsed + 1 : prev.elapsed;
  const rem = prev.display - 1;
  if (rem > 0) return { ...prev, elapsed, display: rem };
  if (prev.phase === 'focus') {
    // 마지막 세트의 집중이 끝나면 종료(트레일링 휴식 없음)
    if (prev.setIndex >= pomo.sets) {
      return { ...prev, elapsed, display: 0, done: true };
    }
    return { ...prev, elapsed, display: pomo.breakMin * 60, phase: 'break' };
  }
  // 휴식 종료 → 다음 세트 집중
  return {
    ...prev,
    elapsed,
    display: pomo.focusMin * 60,
    phase: 'focus',
    setIndex: prev.setIndex + 1,
  };
}
