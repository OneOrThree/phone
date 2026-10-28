import React from 'react';
import { StyleSheet } from 'react-native';
import { render } from '@testing-library/react-native';
import { MotionContext } from '@/design-system/primitives';
import { colors } from '@/services/model';
import { StoryRaft } from './StoryRaft';

// 네이티브 Image는 로컬 에셋의 원본 치수를 기본 style에 넣는다.
// 가장자리만 지정하면 웹과 달리 원본 크기로 넘치므로 모든 포즈의 표시 치수를 검증한다.
describe.each(['sleep', 'sit', 'scope'] as const)('%s 뗏목', (pose) => {
  test.each(colors)('%s 이미지는 작은 폰과 일반 폰의 뗏목 영역 안에 맞춘다', async (color) => {
    for (const width of [176, 221, 350]) {
      const screen = await render(
        <MotionContext.Provider value={true}>
          <StoryRaft color={color} pose={pose} width={width} />
        </MotionContext.Provider>,
      );
      type Node = NonNullable<ReturnType<typeof screen.toJSON>>;
      const images: Node[] = [];
      const visit = (node: Node) => {
        if (node.props.source) images.push(node);
        for (const child of node.children ?? []) {
          if (typeof child !== 'string') visit(child);
        }
      };
      visit(screen.toJSON()!);
      expect(images.length).toBeGreaterThan(0);
      for (const image of images) {
        const style = StyleSheet.flatten(image.props.style);
        expect(style.width).toBeGreaterThan(0);
        expect(style.width).toBeLessThanOrEqual(width);
        expect(style.height).toBeGreaterThan(0);
        expect(style.height).toBeLessThanOrEqual(width * 0.79);
      }
      await screen.unmount();
    }
  });
});
