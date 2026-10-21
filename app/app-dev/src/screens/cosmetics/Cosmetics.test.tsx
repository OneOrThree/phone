import React from 'react';
import { render } from '@testing-library/react-native';
import { BoatPortrait } from './Cosmetics';

jest.mock('@/services/customizationCatalog', () => ({
  useCustomizationCatalog: () => ({
    hat: {
      productId: 'hat',
      slot: 'head',
      imageUrl: 'https://x/hat.png',
      width: 256,
      height: 128,
      anchorX: 0.5,
      anchorY: 0.2,
    },
  }),
}));

const state = (equipped: Record<string, unknown>) =>
  ({
    color: 'black',
    equipped: { clothes: 'default', decor: 'none', hull: 'raft', position: 'front', ...equipped },
  }) as any;

test('head 를 장착하면 레이어 1개, 키 없음이면 0개', async () => {
  const on = await render(<BoatPortrait state={state({ head: 'hat' })} />);
  expect(on.getAllByTestId(/^outfit-/)).toHaveLength(1);
  const off = await render(<BoatPortrait state={state({})} />);
  expect(off.queryAllByTestId(/^outfit-/)).toHaveLength(0);
});
