import {
  BUILDING_TRANSITION_DURATION_MS,
  BUILDING_TRANSITION_EASING,
  BUILDING_TRANSITION_RETURN_TARGET,
  BUILDING_TRANSITION_ROUTE,
  cancelBuildingTransition,
  clearBuildingTransitionRouteCovers,
  createBuildingTransitionController,
  isBuildingTransitionActive,
  isBuildingTransitionRouteCovered,
  runBuildingEntryWalk,
  subscribeBuildingTransitionActivity,
  subscribeBuildingTransitionRouteCover,
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
      stats: 'hall',
      manage: 'hall',
      members: 'hall',
      ledger: 'hall',
      construction: 'hall',
      board: 'board',
      notice: 'board',
      noticeEdit: 'board',
      quest: 'board',
      questEdit: 'board',
      tower: 'tower',
      explore: 'tower',
      visit: 'tower',
      shop: 'shop',
      product: 'shop',
      orders: 'shop',
      rest: 'fire',
      library: 'library',
      diary: 'library',
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
      jest.advanceTimersByTime(900);
      expect(isBuildingTransitionRouteCovered()).toBe(false);
    } finally {
      controller.dispose();
      jest.useRealTimers();
    }
  });

  it('walk 경로가 없을 때 건물 진입 대기 플래그를 해제한다', () => {
    let pending = true;
    const start = jest.fn(() => true);
    const walked = runBuildingEntryWalk(
      () => false,
      start,
      () => (pending = false),
    );
    expect(walked).toBe(false);
    expect(start).not.toHaveBeenCalled();
    expect(pending).toBe(false);
  });

  it('controller가 시작을 거부하면 walk 완료 후 대기 플래그를 해제한다', () => {
    let pending = true;
    let onArrival: () => void = () => {};
    const started = runBuildingEntryWalk(
      (callback) => {
        onArrival = callback;
        return true;
      },
      () => false,
      () => (pending = false),
    );
    expect(started).toBe(true);
    expect(pending).toBe(true);
    onArrival();
    expect(pending).toBe(false);
  });

  it('비활성 controller를 dispose해도 다른 controller의 진행 중 전환은 유지한다', () => {
    jest.useFakeTimers();
    const activeController = createBuildingTransitionController();
    const inactiveController = createBuildingTransitionController();
    const navigate = jest.fn();
    try {
      expect(activeController.start('hall', 'enter', false, navigate)).toBe(true);
      expect(inactiveController.start('board', 'enter', false, jest.fn())).toBe(false);
      inactiveController.dispose();
      expect(inactiveController.cancel()).toBe(false);
      expect(activeController.getState().phase).toBe('entering');
      expect(cancelBuildingTransition()).toBe(true);
      jest.advanceTimersByTime(BUILDING_TRANSITION_DURATION_MS);
      expect(navigate).not.toHaveBeenCalled();
      expect(activeController.getState().phase).toBe('idle');
    } finally {
      activeController.dispose();
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

  it('전환 취소 시 호출자의 대기 상태도 정리한다', () => {
    jest.useFakeTimers();
    const controller = createBuildingTransitionController();
    const navigate = jest.fn();
    const onCancel = jest.fn();
    try {
      controller.start('fire', 'enter', false, navigate, BUILDING_TRANSITION_DURATION_MS, onCancel);
      expect(controller.cancel()).toBe(true);
      expect(onCancel).toHaveBeenCalledTimes(1);
      jest.advanceTimersByTime(BUILDING_TRANSITION_DURATION_MS);
      expect(navigate).not.toHaveBeenCalled();
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
      expect(navigate).toHaveBeenCalledTimes(1);
      expect(isBuildingTransitionRouteCovered()).toBe(false);
      jest.advanceTimersByTime(BUILDING_TRANSITION_DURATION_MS - 1);
      expect(controller.getState().phase).toBe('returning');
      jest.advanceTimersByTime(1);
      expect(navigate).toHaveBeenCalledTimes(1);
      expect(controller.getState().phase).toBe('idle');
      expect(isBuildingTransitionRouteCovered()).toBe(false);
    } finally {
      controller.dispose();
      jest.useRealTimers();
    }
  });

  it('역방향 route를 즉시 표시하고 이전 loading cover를 제거한다', () => {
    jest.useFakeTimers();
    const controller = createBuildingTransitionController();
    const enter = jest.fn();
    const returnToHome = jest.fn();
    try {
      controller.start('shop', 'enter', false, enter, 10);
      jest.advanceTimersByTime(10);
      expect(isBuildingTransitionRouteCovered()).toBe(true);

      controller.start('shop', 'return', false, returnToHome);
      expect(returnToHome).toHaveBeenCalledTimes(1);
      expect(controller.getState().phase).toBe('returning');
      expect(isBuildingTransitionRouteCovered()).toBe(false);
      jest.advanceTimersByTime(BUILDING_TRANSITION_DURATION_MS);
      expect(controller.getState().phase).toBe('idle');
    } finally {
      controller.dispose();
      jest.useRealTimers();
    }
  });

  it('화톳불은 항해를 가리지 않고 다른 건물은 route cover를 켠다', () => {
    jest.useFakeTimers();
    const controller = createBuildingTransitionController();
    const navigate = jest.fn();
    try {
      controller.start('fire', 'enter', false, navigate, 10);
      jest.advanceTimersByTime(10);
      expect(navigate).toHaveBeenCalledTimes(1);
      expect(isBuildingTransitionRouteCovered()).toBe(false);

      controller.start('hall', 'enter', false, navigate, 10);
      jest.advanceTimersByTime(10);
      expect(navigate).toHaveBeenCalledTimes(2);
      expect(isBuildingTransitionRouteCovered()).toBe(true);
      jest.advanceTimersByTime(900);
      expect(isBuildingTransitionRouteCovered()).toBe(false);
    } finally {
      controller.dispose();
      jest.useRealTimers();
    }
  });

  it('전역 구독자에게 건물 진입 중 접근성 차단 상태를 알린다', () => {
    jest.useFakeTimers();
    const controller = createBuildingTransitionController();
    const onActivity = jest.fn();
    const unsubscribe = subscribeBuildingTransitionActivity(onActivity);
    try {
      expect(isBuildingTransitionActive()).toBe(false);
      expect(onActivity).toHaveBeenLastCalledWith(false);
      controller.start('board', 'enter', false, jest.fn(), 10);
      expect(isBuildingTransitionActive()).toBe(true);
      expect(onActivity).toHaveBeenLastCalledWith(true);

      expect(cancelBuildingTransition()).toBe(true);
      expect(isBuildingTransitionActive()).toBe(false);
      expect(onActivity).toHaveBeenLastCalledWith(false);
    } finally {
      unsubscribe();
      controller.dispose();
      jest.useRealTimers();
    }
  });

  it('route-cover 변경을 구독자에게 알리고 controller dispose 후에도 만료까지 유지한다', () => {
    jest.useFakeTimers();
    const controller = createBuildingTransitionController();
    const onCovered = jest.fn();
    const unsubscribe = subscribeBuildingTransitionRouteCover(onCovered);
    try {
      controller.start('shop', 'enter', false, jest.fn(), 10);
      jest.advanceTimersByTime(10);
      expect(isBuildingTransitionRouteCovered()).toBe(true);
      expect(onCovered).toHaveBeenLastCalledWith(true);
      controller.dispose();
      jest.advanceTimersByTime(899);
      expect(isBuildingTransitionRouteCovered()).toBe(true);
      jest.advanceTimersByTime(1);
      expect(isBuildingTransitionRouteCovered()).toBe(false);
      expect(onCovered).toHaveBeenLastCalledWith(false);
    } finally {
      unsubscribe();
      controller.dispose();
      jest.useRealTimers();
    }
  });

  it('강제 route 초기화는 남은 loading cover를 즉시 제거한다', () => {
    jest.useFakeTimers();
    const controller = createBuildingTransitionController();
    try {
      controller.start('shop', 'enter', false, jest.fn(), 10);
      jest.advanceTimersByTime(10);
      expect(isBuildingTransitionRouteCovered()).toBe(true);
      clearBuildingTransitionRouteCovers();
      expect(isBuildingTransitionRouteCovered()).toBe(false);
    } finally {
      controller.dispose();
      jest.useRealTimers();
    }
  });

  it('서로 다른 전환의 route-cover 만료가 다른 cover를 먼저 해제하지 않는다', () => {
    jest.useFakeTimers();
    const first = createBuildingTransitionController();
    const second = createBuildingTransitionController();
    try {
      first.start('hall', 'enter', false, jest.fn(), 10);
      jest.advanceTimersByTime(10);
      second.start('board', 'enter', false, jest.fn(), 10);
      jest.advanceTimersByTime(10);
      jest.advanceTimersByTime(880);
      expect(isBuildingTransitionRouteCovered()).toBe(true);
      jest.advanceTimersByTime(10);
      expect(isBuildingTransitionRouteCovered()).toBe(true);
      jest.advanceTimersByTime(10);
      expect(isBuildingTransitionRouteCovered()).toBe(false);
    } finally {
      first.dispose();
      second.dispose();
      jest.useRealTimers();
    }
  });

  it('reduceMotion navigation이 실패해도 idle로 복구하고 다음 전환을 허용한다', () => {
    const failed = createBuildingTransitionController();
    const next = createBuildingTransitionController();
    const error = new Error('navigation failed');
    try {
      expect(() =>
        failed.start('hall', 'enter', true, () => {
          throw error;
        }),
      ).toThrow(error);
      expect(failed.getState()).toMatchObject({ phase: 'idle', target: null, direction: null });
      expect(next.start('board', 'enter', true, jest.fn())).toBe(true);
    } finally {
      failed.dispose();
      next.dispose();
    }
  });

  it('복귀 navigation이 실패하면 진행 상태를 취소하고 예외를 다시 던진다', () => {
    const controller = createBuildingTransitionController();
    const error = new Error('return navigation failed');
    try {
      expect(() =>
        controller.start('shop', 'return', false, () => {
          throw error;
        }),
      ).toThrow(error);
      expect(controller.getState().phase).toBe('idle');
      expect(cancelBuildingTransition()).toBe(false);
    } finally {
      controller.dispose();
    }
  });

  it('지연 진입 navigation이 실패해도 idle로 복구하고 route cover를 만료시킨다', () => {
    jest.useFakeTimers();
    const controller = createBuildingTransitionController();
    const error = new Error('enter navigation failed');
    try {
      controller.start(
        'tower',
        'enter',
        false,
        () => {
          throw error;
        },
        10,
      );
      expect(() => jest.advanceTimersByTime(10)).toThrow(error);
      expect(controller.getState().phase).toBe('idle');
      expect(isBuildingTransitionRouteCovered()).toBe(true);
      jest.advanceTimersByTime(900);
      expect(isBuildingTransitionRouteCovered()).toBe(false);
    } finally {
      controller.dispose();
      jest.useRealTimers();
    }
  });

  it('활성 controller를 dispose하면 예약 navigation과 전역 전환을 함께 정리한다', () => {
    jest.useFakeTimers();
    const controller = createBuildingTransitionController();
    const navigate = jest.fn();
    try {
      controller.start('library', 'enter', false, navigate);
      controller.dispose();
      jest.advanceTimersByTime(BUILDING_TRANSITION_DURATION_MS);
      expect(navigate).not.toHaveBeenCalled();
      expect(controller.getState().phase).toBe('idle');
      expect(cancelBuildingTransition()).toBe(false);
    } finally {
      controller.dispose();
      jest.useRealTimers();
    }
  });
});
