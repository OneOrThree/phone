import React from 'react';
import { render } from '@testing-library/react-native';
import { VillageScenery } from './VillageScenery';
import { villageScene } from '@/utils/village-world';

describe('VillageScenery', () => {
  it('레이어드 미리보기 게시판에 서버 상태 알림을 표시한다', async () => {
    const scene = villageScene(['board']);
    const view = await render(
      <VillageScenery scene={scene} scale={1} reduce mailboxLetters={false} />,
    );
    expect(view.queryByTestId('village-board-new-indicator')).toBeNull();

    await view.rerender(
      <VillageScenery scene={scene} scale={1} reduce mailboxLetters={false} boardStatus="unread" />,
    );
    expect(view.getByTestId('village-board-scene-indicator')).toBeTruthy();
    expect(view.getByTestId('village-board-new-indicator').props.accessibilityLabel).toBe(
      '읽지 않은 새 소식이 있습니다',
    );
    expect(view.getByTestId('village-board-tooltip')).toBeTruthy();
    expect(view.queryByTestId('village-board-still-image')).toBeNull();
    await view.unmount();
  });

  it('레이어드 전망대는 순위 배지와 야간 진입 피드백을 표시한다', async () => {
    const scene = villageScene(['tower']);
    const view = await render(
      <VillageScenery
        scene={scene}
        scale={1}
        reduce
        mailboxLetters={false}
        observatoryRankState="rank-changed"
        towerArrivalActive
        towerArrivalGeneration={3}
        dayNight="night"
      />,
    );

    expect(
      view.getByTestId('village-observatory-rank-indicator', { includeHiddenElements: true }),
    ).toBeTruthy();
    expect(view.queryByTestId('village-observatory-frame-0')).toBeNull();
    expect(
      view.getByTestId('village-observatory-entry-highlight', { includeHiddenElements: true }),
    ).toBeTruthy();
    expect(
      view.getByTestId('village-observatory-entry-feedback', { includeHiddenElements: true }),
    ).toBeTruthy();
    await view.unmount();
  });
});
