import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { constructionSpriteCell } from '@/components/constructionBuildingMotion';
import { ConstructionMotionPreview } from './ConstructionMotionPreview';

const buildings = ['hall', 'board', 'gram', 'library', 'mail', 'tower', 'shop'] as const;
const phases = [
  ['foundation', '기초 공사'],
  ['structure', '골조 공사'],
  ['finishing', '마감 공사'],
  ['completion', '완공 대기'],
] as const;

describe('ConstructionMotionPreview', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('밤으로 바꾸면 일곱 건물 × 네 단계가 모두 밤 셀로 보인다', async () => {
    const screen = await render(<ConstructionMotionPreview />);
    await fireEvent.press(screen.getByLabelText('밤'));

    for (const [phase, label] of phases) {
      await fireEvent.press(screen.getByLabelText(label));
      for (const building of buildings) {
        expect(screen.getByTestId(`construction-sprite-${building}-${phase}`).props.source).toBe(
          constructionSpriteCell(building, phase, true).atlas,
        );
      }
    }

    await fireEvent.press(screen.getByLabelText('낮'));
    expect(screen.getByTestId('construction-sprite-hall-completion').props.source).toBe(
      constructionSpriteCell('hall', 'completion', false).atlas,
    );
    await screen.unmount();
  });
});
