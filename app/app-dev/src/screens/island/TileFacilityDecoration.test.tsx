import React from 'react';
import { render, configure } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { TileFacilityOutline } from './TileFacilityDecoration';
import { componentTokens } from '@/design-system/tokens';
configure({ defaultIncludeHiddenElements: true });

it.each([true, false])(
  '네이티브 외곽선은 빠른 줌에도 기본 이미지 좌표를 유지하고 건물과 함께 확대를 쓴다 (crop %s)',
  async (cropped) => {
    const rect = { x: 150, y: 24, w: 112, h: 193 };
    const baseScale = 0.73;
    const source = require('@/assets/village-world/motion/observatory/frame-0.png');
    const outline = (scale: number) => (
      <TileFacilityOutline
        source={source}
        rect={rect}
        left={-120}
        top={50}
        scale={scale}
        baseScale={baseScale}
        cropped={cropped}
        pressed={false}
        reduceMotion={false}
      />
    );
    const screen = await render(outline(1));
    for (const scale of [0.26, 1.9, 0.35, 1.5, 0.26]) {
      await screen.rerender(outline(scale));
      const outer = StyleSheet.flatten(screen.getByTestId('native-facility-outline').props.style);
      expect(outer).toMatchObject({
        left: -120 + rect.x * scale,
        top: 50 + rect.y * scale,
        width: rect.w * baseScale,
        height: rect.h * baseScale,
      });
      expect(outer.transform).toEqual([{ scale: scale / baseScale }]);
      const nodes: any[] = [];
      const walk = (node: any) => {
        if (!node || typeof node !== 'object') return;
        if (Array.isArray(node)) return node.forEach(walk);
        if (node.type === 'Image') nodes.push(node);
        (node.children ?? []).forEach(walk);
      };
      walk(screen.toJSON());
      expect(nodes).toHaveLength(8);
      for (const node of nodes) {
        const image = StyleSheet.flatten(node.props.style);
        expect(image.width).toBe((cropped ? rect.w : 1536) * baseScale);
        expect(image.height).toBe((cropped ? rect.h : 1024) * baseScale);
        const pad = componentTokens.tileFacility.outlineWidth * 2;
        const dx = image.left - pad + (cropped ? 0 : rect.x * baseScale);
        const dy = image.top - pad + (cropped ? 0 : rect.y * baseScale);
        expect(Math.max(Math.abs(dx), Math.abs(dy))).toBeCloseTo(
          componentTokens.tileFacility.outlineWidth,
        );
        expect(node.props.fadeDuration).toBe(0);
      }
    }
    await screen.unmount();
  },
);
