import {
  BUILDING_TRANSITION_DURATION_MS,
  BUILDING_TRANSITION_EASING,
  BUILDING_TRANSITION_RETURN_TARGET,
  BUILDING_TRANSITION_ROUTE,
  cancelBuildingTransition,
  createBuildingTransitionController,
  isBuildingTransitionRouteCovered,
} from './buildingTransition';

describe('공통 건물 전환 계약', () => {
  it('고정 duration/easing과 6개 진입 route를 제공한다', () => {
    expect(BUILDING_TRANSITION_DURATION_MS).toBe(620);
    expect(BUILDING_TRANSITION_EASING).toBe('cubic-in-out');
    expect(BUILDING_TRANSITION_ROUTE).toEqual({
      hall: 'hall',
      board: 'board',
      tower: 'tower',
      shop: 'shop',
      fire: 'rest',
      library: 'library',
    });
    expect(BUILDING_TRANSITION_RETURN_TARGET).toEqual({
      hall: 'hall',
      manage: 'hall',
      board: 'board',
      tower: 'tower',
      shop: 'shop',
      rest: 'fire',
      library: 'library',
    });
  });

  it('전환 중 중복 진입을 거부하고 완료 시 목적지로 한 번만 이동한다', () => {
    jest.useFakeTimers();
    const controller = createBuildingTransitionController();
    const navigate = jest.fn();
    try {
      expect(controller.start('hall', 'enter', false, navigate)).toBe(true);
      expect(controller.start('board', 'enter', false, navigate)).toBe(false);
      expect(controller.getState().phase).toBe('entering');
      jest.advanceTimersByTime(BUILDING_TRANSITION_DURATION_MS - 1);
      expect(navigate).not.toHaveBeenCalled();
      jest.advanceTimersByTime(1);
      expect(navigate).toHaveBeenCalledTimes(1);
      expect(controller.getState().phase).toBe('idle');
    } finally {
      controller.dispose();
      jest.useRealTimers();
    }
  });

  it('뒤로가기는 진행 중 진입을 취소해 지연 navigation을 막는다', () => {
    jest.useFakeTimers();
    const controller = createBuildingTransitionController();
    const navigate = jest.fn();
    try {
      controller.start('library', 'enter', false, navigate);
      expect(cancelBuildingTransition()).toBe(true);
      jest.advanceTimersByTime(BUILDING_TRANSITION_DURATION_MS);
      expect(navigate).not.toHaveBeenCalled();
      expect(controller.getState().phase).toBe('idle');
    } finally {
      controller.dispose();
      jest.useRealTimers();
    }
  });

  it('reduceMotion에서는 애니메이션 대기 없이 route로 이동한다', () => {
    const controller = createBuildingTransitionController();
    const navigate = jest.fn();
    expect(controller.start('fire', 'enter', true, navigate)).toBe(true);
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(controller.getState().phase).toBe('idle');
    controller.dispose();
  });

  it('복귀 방향도 같은 고정 duration으로 실행한다', () => {
    jest.useFakeTimers();
    const controller = createBuildingTransitionController();
    const navigate = jest.fn();
    try {
      controller.start('fire', 'return', false, navigate);
      expect(controller.getState().phase).toBe('returning');
      jest.advanceTimersByTime(BUILDING_TRANSITION_DURATION_MS - 1);
      expect(navigate).not.toHaveBeenCalled();
      jest.advanceTimersByTime(1);
      expect(navigate).toHaveBeenCalledTimes(1);
    } finally {
      controller.dispose();
      jest.useRealTimers();
    }
  });

  it('목적지 route가 바뀐 직후 로딩 가림을 켠다', () => {
    jest.useFakeTimers();
    const controller = createBuildingTransitionController();
    const navigate = jest.fn();
    try {
      controller.start('fire', 'enter', false, navigate, 10);
      jest.advanceTimersByTime(10);
      expect(navigate).toHaveBeenCalledTimes(1);
      expect(isBuildingTransitionRouteCovered()).toBe(true);
      jest.advanceTimersByTime(900);
      expect(isBuildingTransitionRouteCovered()).toBe(false);
    } finally {
      controller.dispose();
      jest.useRealTimers();
    }
  });
});
