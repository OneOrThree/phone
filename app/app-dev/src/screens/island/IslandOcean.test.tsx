import React from 'react';
import { render } from '@testing-library/react-native';
import { IslandOcean } from './IslandOcean';

function patterns(node: any): any[] {
  if (!node || typeof node !== 'object') return [];
  if (Array.isArray(node)) return node.flatMap(patterns);
  return [...(node.props?.patternUnits === 1 ? [node.props] : []), ...patterns(node.children)];
}

it('팬·줌과 같은 원점·배율을 쓰고 두 지도 패턴의 ID를 분리한다', async () => {
  const screen = await render(
    <>
      <IslandOcean left={-123} top={77} scale={0.5} />
      <IslandOcean left={20} top={-5} scale={2} night />
    </>,
  );
  const p = patterns(screen.toJSON());
  expect(p).toHaveLength(2);
  expect(p[0]).toMatchObject({
    x: 0,
    y: 0,
    width: 256,
    height: 256,
    patternTransform: [1, 0, 0, 1, -123, 77],
  });
  expect(p[1]).toMatchObject({
    x: 0,
    y: 0,
    width: 1024,
    height: 1024,
    patternTransform: [1, 0, 0, 1, 20, -5],
  });
  expect(p[0].name).not.toBe(p[1].name);
  await screen.rerender(<IslandOcean left={-400} top={-300} scale={1.5} night />);
  expect(patterns(screen.toJSON())[0]).toMatchObject({
    x: 0,
    y: 0,
    width: 768,
    height: 768,
    patternTransform: [1, 0, 0, 1, -400, -300],
  });
});
