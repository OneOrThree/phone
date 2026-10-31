import React from 'react';
import { render } from '@testing-library/react-native';
import * as ScreenOrientation from 'expo-screen-orientation';
import { useRouteOrientation } from './orientation';

jest.mock('expo-screen-orientation', () => ({
  lockAsync: jest.fn(async () => undefined),
  OrientationLock: { PORTRAIT_UP: 'PORTRAIT_UP', DEFAULT: 'DEFAULT' },
}));
const lock = ScreenOrientation.lockAsync as jest.Mock;
function Probe({ force }: { force: boolean }) {
  useRouteOrientation('home', force);
  return null;
}

it('forcePortrait 동안 세로로 잠그고, 풀리면 경로 정책으로 돌아간다', async () => {
  const r = await render(<Probe force={false} />);
  expect(lock).toHaveBeenLastCalledWith('DEFAULT');
  await r.rerender(<Probe force />);
  expect(lock).toHaveBeenLastCalledWith('PORTRAIT_UP');
  await r.rerender(<Probe force={false} />);
  expect(lock).toHaveBeenLastCalledWith('DEFAULT');
});
