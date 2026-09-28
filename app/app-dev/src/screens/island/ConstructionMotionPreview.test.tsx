import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { constructionSpriteCell } from '@/components/constructionBuildingMotion';
import { ConstructionMotionPreview } from './ConstructionMotionPreview';

const buildings = ['hall', 'board', 'gram', 'library', 'mail', 'tower', 'shop'] as const;
const phases = ['foundation', 'structure', 'finishing', 'completion'] as const;

describe('ConstructionMotionPreview', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('밤으로 바꾸면 일곱 건물 × 네 단계가 모두 밤 셀로 보인다', async () => {
    const screen = await render(<ConstructionMotionPreview />);
    await fireEvent.press(screen.getByTestId('toggle-night'));

    for (const phase of phases) {
      await fireEvent.press(screen.getByTestId(`phase-${phase}`));
      for (const building of buildings) {
        expect(screen.getByTestId(`construction-sprite-${building}-${phase}`).props.source).toBe(
          constructionSpriteCell(building, phase, true).atlas,
        );
      }
    }

    await fireEvent.press(screen.getByTestId('toggle-night'));
    expect(screen.getByTestId('construction-sprite-hall-completion').props.source).toBe(
      constructionSpriteCell('hall', 'completion', false).atlas,
    );
    await screen.unmount();
  });
});
