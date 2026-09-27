import React from 'react';
import { act, render } from '@testing-library/react-native';
import { ConstructionBuildingSprite } from './ConstructionBuildingSprite';
import {
  constructionBuildingMotion,
  constructionBurstMs,
  constructionEffectFrameMs,
  constructionEffectsAtlas,
  constructionMotionFrameMs,
  constructionMotionOffsets,
  constructionRestMs,
} from './constructionBuildingMotion';

describe('ConstructionBuildingSprite', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('일곱 건물 모두 네 공사 단계의 atlas 셀을 가진다', () => {
    for (const building of ['hall', 'board', 'gram', 'library', 'mail', 'tower', 'shop'] as const) {
      const cells = constructionBuildingMotion[building];
      expect(Object.keys(cells)).toEqual(['foundation', 'structure', 'finishing', 'completion']);
      expect(Object.values(cells).map(({ column }) => column)).toEqual([0, 1, 2, 3]);
      expect(new Set(Object.values(cells).map(({ atlas }) => atlas)).size).toBe(1);
    }
    expect(constructionBuildingMotion.tower.structure.rows).toBe(3);
    expect(constructionBuildingMotion.shop.finishing.rows).toBe(3);
  });

  it('단계에 맞는 atlas viewport를 사용하고 작업 burst 안에서 진동한다', async () => {
    const view = await render(
      <ConstructionBuildingSprite
        building="hall"
        phase="foundation"
        testID="construction-sprite"
      />,
    );
    expect(view.getByTestId('construction-sprite-hall-foundation').props.source).toBe(
      constructionBuildingMotion.hall.foundation.atlas,
    );

    await act(async () => jest.advanceTimersByTime(constructionMotionFrameMs));
    expect(view.getByTestId('construction-sprite').props.style).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ transform: [{ translateX: constructionMotionOffsets[1] }] }),
      ]),
    );

    await act(async () => {
      view.rerender(
        <ConstructionBuildingSprite
          building="hall"
          phase="finishing"
          testID="construction-sprite"
        />,
      );
    });
    expect(view.getByTestId('construction-sprite-hall-finishing').props.style).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ left: '-200%', top: '0%', height: '400%' }),
      ]),
    );
    expect(view.getByTestId('construction-effect-hall-finishing').props.style).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ height: '300%' }),
        expect.objectContaining({ left: '0%', top: '-200%' }),
      ]),
    );
    await view.unmount();
  });

  it('tower/shop viewport 높이를 atlas 행 수에 맞추고 phase 효과를 4프레임 반복한다', async () => {
    const view = await render(
      <ConstructionBuildingSprite building="shop" phase="structure" testID="construction-sprite" />,
    );
    expect(view.getByTestId('construction-sprite-shop-structure').props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({ top: '-200%', height: '300%' })]),
    );
    expect(view.getByTestId('construction-effect-shop-structure').props.source).toBe(
      constructionEffectsAtlas,
    );

    await act(async () => jest.advanceTimersByTime(constructionEffectFrameMs));
    expect(view.getByTestId('construction-effect-shop-structure').props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({ left: '-100%', top: '-100%' })]),
    );
    await act(async () => jest.advanceTimersByTime(constructionEffectFrameMs * 3));
    expect(view.getByTestId('construction-effect-shop-structure').props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({ left: '0%', top: '-100%' })]),
    );

    await act(async () => {
      view.rerender(
        <ConstructionBuildingSprite
          building="shop"
          phase="completion"
          testID="construction-sprite"
        />,
      );
    });
    expect(view.getByTestId('construction-effect-shop-completion').props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({ top: '-200%' })]),
    );
    await view.unmount();
  });

  it('짧은 작업 burst 뒤에는 건물 외형만 유지하고 건물별 휴지기 후 다시 재생한다', async () => {
    const view = await render(
      <ConstructionBuildingSprite
        building="hall"
        phase="foundation"
        testID="construction-sprite"
      />,
    );

    await act(async () => jest.advanceTimersByTime(constructionBurstMs.foundation));
    expect(view.getByTestId('construction-sprite').props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({ transform: [{ translateX: 0 }] })]),
    );
    expect(view.getByTestId('construction-effect-hall-foundation').props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({ opacity: 0 })]),
    );

    const rest = constructionRestMs('hall', 'foundation', 0);
    await act(async () => jest.advanceTimersByTime(rest - 1));
    expect(view.getByTestId('construction-effect-hall-foundation').props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({ opacity: 0 })]),
    );
    await act(async () => jest.advanceTimersByTime(1));
    expect(view.getByTestId('construction-effect-hall-foundation').props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({ opacity: 1 })]),
    );
    await view.unmount();
  });

  it('reduce motion에서는 정지 프레임을 유지하고 타이머를 만들지 않는다', async () => {
    const timeoutSpy = jest.spyOn(global, 'setTimeout');
    const view = await render(
      <ConstructionBuildingSprite
        building="tower"
        phase="structure"
        reduceMotion
        testID="construction-sprite"
      />,
    );
    expect(timeoutSpy).not.toHaveBeenCalled();
    await act(async () => jest.advanceTimersByTime(10_000));
    expect(view.getByTestId('construction-sprite').props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({ transform: [{ translateX: 0 }] })]),
    );
    expect(view.getByTestId('construction-effect-tower-structure').props.style).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ left: '0%', top: '-100%' }),
        expect.objectContaining({ opacity: 0 }),
      ]),
    );
    await view.unmount();
  });

  it('언마운트하면 다음 진동 프레임 타이머를 정리한다', async () => {
    const clearTimeoutSpy = jest.spyOn(global, 'clearTimeout');
    const view = await render(<ConstructionBuildingSprite building="shop" phase="foundation" />);
    await view.unmount();
    expect(clearTimeoutSpy).toHaveBeenCalled();
  });
});
