// machine.ts 순수 전이 단위 테스트 (GROMO-1600 1단계).
// 화면 경유 특성화 스위트가 같은 의미론을 이중으로 고정하지만, 여기는 전이 함수 자체를
// 렌더 없이 직접 못박는다 — 이후 단계에서 엔진이 이 함수를 호출할 때의 안전망.

import {
  initialSessionState,
  nextTick,
  type SessionMachineConfig,
  type SessionState,
} from './machine';

const countup: SessionMachineConfig = {
  mode: 'countup',
  goalSeconds: 25 * 60,
  pomodoro: { focusMin: 25, breakMin: 5, sets: 4 },
};
const countdown: SessionMachineConfig = { ...countup, mode: 'countdown', goalSeconds: 3 };
const pomodoro: SessionMachineConfig = {
  ...countup,
  mode: 'pomodoro',
  pomodoro: { focusMin: 1, breakMin: 1, sets: 2 },
};

const run = (config: SessionMachineConfig, ticks: number): SessionState => {
  let s = initialSessionState(config);
  for (let i = 0; i < ticks; i++) s = nextTick(config, s);
  return s;
};

describe('initialSessionState', () => {
  test('모드별 초기 display — countup 0 / countdown 목표 / pomodoro 집중 분', () => {
    expect(initialSessionState(countup)).toEqual({
      elapsed: 0,
      display: 0,
      phase: 'focus',
      setIndex: 1,
      done: false,
    });
    expect(initialSessionState(countdown).display).toBe(3);
    expect(initialSessionState(pomodoro).display).toBe(60);
  });
});

describe('nextTick', () => {
  test('countup: elapsed·display가 함께 오르고 done은 없다', () => {
    expect(run(countup, 3)).toEqual({
      elapsed: 3,
      display: 3,
      phase: 'focus',
      setIndex: 1,
      done: false,
    });
  });

  test('countdown: display가 줄다 0에서 done — elapsed는 계속 오른다', () => {
    expect(run(countdown, 2)).toMatchObject({ elapsed: 2, display: 1, done: false });
    expect(run(countdown, 3)).toMatchObject({ elapsed: 3, display: 0, done: true });
  });

  test('countdown: 0 이하로 내려가지 않는다(done 후 추가 tick도 display 0)', () => {
    const doneState = run(countdown, 3);
    expect(nextTick(countdown, doneState)).toMatchObject({ display: 0, done: true });
  });

  test('pomodoro: 집중 소진 → 휴식 전환, display는 휴식 분으로 리셋', () => {
    expect(run(pomodoro, 60)).toMatchObject({
      elapsed: 60,
      display: 60,
      phase: 'break',
      setIndex: 1,
      done: false,
    });
  });

  test('pomodoro: 휴식 중엔 elapsed가 멈춘다', () => {
    expect(run(pomodoro, 90)).toMatchObject({ elapsed: 60, display: 30, phase: 'break' });
  });

  test('pomodoro: 휴식 소진 → 다음 세트 집중(setIndex 증가)', () => {
    expect(run(pomodoro, 120)).toMatchObject({
      elapsed: 60,
      display: 60,
      phase: 'focus',
      setIndex: 2,
    });
  });

  test('pomodoro: 마지막 세트 집중 소진 → done, 트레일링 휴식 없음', () => {
    expect(run(pomodoro, 180)).toMatchObject({
      elapsed: 120,
      display: 0,
      phase: 'focus',
      setIndex: 2,
      done: true,
    });
  });
});
