import type { State } from '@/services/model';

/** 실제 세션을 복구한 구버전 이용자는 기존 수명주기를 유지한다. */
export function isTutorialExperience(state: State): boolean {
  return (
    !state.session &&
    !!state.tutorial &&
    (state.tutorial.step < 22 || (state.tutorial.step === 22 && !!state.tutorialExperience))
  );
}

/** 기존 장면만 재사용한다. 이 투영을 저장하거나 실제 세션 명령에 전달하지 않는다. */
export function tutorialExperienceScene(state: State): State {
  return {
    ...state,
    session: state.tutorialExperience?.session ?? null,
    lastResult: state.tutorialExperience?.result ?? null,
    resultFromRest: state.tutorialExperience?.fromRest,
    rewards: [],
    islands: state.islands.map((island) => ({
      ...island,
      joined: state.serverIslands ? !!state.serverIslands.currentIslandId : island.joined,
      members: [],
      quests: [],
    })),
  };
}

export function tutorialExperienceAction(type: string): string {
  if (type === 'FOCUS_SPOT') return 'TUTORIAL_EXPERIENCE_SPOT';
  return ['START', 'PAUSE', 'RESUME', 'FINISH'].includes(type)
    ? `TUTORIAL_EXPERIENCE_${type}`
    : type;
}
