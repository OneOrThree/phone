import React from 'react';
import { Text } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { createLazyRoot, retryOnce } from './LazyRoot';

const Ready = () => <Text>준비됨</Text>;

beforeEach(() => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  jest.restoreAllMocks();
});

it('retryOnce는 첫 실패 뒤 한 번만 더 받고, 그래도 실패하면 번들 실패 표식을 단다', async () => {
  const load = jest
    .fn()
    .mockRejectedValueOnce(new Error('chunk'))
    .mockResolvedValueOnce({ default: Ready });
  await expect(retryOnce(load, 0)()).resolves.toEqual({ default: Ready });
  expect(load).toHaveBeenCalledTimes(2);

  const failing = jest.fn().mockRejectedValue(new Error('chunk'));
  await expect(retryOnce(failing, 0)()).rejects.toMatchObject({
    name: 'ScreenChunkError',
    screenChunkFailed: true,
  });
  expect(failing).toHaveBeenCalledTimes(2);
});

it('화면 번들을 받으면 그 화면을 그린다', async () => {
  const Root = createLazyRoot(() => Promise.resolve({ default: Ready }), {
    reload: jest.fn(),
    retryDelayMs: 0,
  });
  await render(<Root />);
  expect(await screen.findByText('준비됨')).toBeTruthy();
});

it('두 번 다 받지 못하면 연결 안내와 다시 불러오기를 보이고 번들 실패로 알린다', async () => {
  const reload = jest.fn();
  const onError = jest.fn();
  const load = jest.fn().mockRejectedValue(new Error('chunk'));
  const Root = createLazyRoot(load, { reload, onError, retryDelayMs: 0 });
  await render(<Root />);
  const button = await screen.findByText('다시 불러오기');
  expect(screen.getByText(/연결을 확인하고/)).toBeTruthy();
  expect(load).toHaveBeenCalledTimes(2);
  expect(onError).toHaveBeenCalledTimes(1);
  expect(onError.mock.calls[0][0]).toBe('chunk');
  await act(async () => fireEvent.press(button));
  expect(reload).toHaveBeenCalledTimes(1);
});

it('받은 화면이 그리다 실패하면 연결 안내 없이 다시 불러오기를 보이고 렌더 실패로 알린다', async () => {
  const Broken = () => {
    throw new TypeError('boom');
  };
  const onError = jest.fn();
  const Root = createLazyRoot(() => Promise.resolve({ default: Broken }), {
    reload: jest.fn(),
    onError,
    retryDelayMs: 0,
  });
  await render(<Root />);
  expect(await screen.findByText('다시 불러오기')).toBeTruthy();
  expect(screen.queryByText(/연결을 확인하고/)).toBeNull();
  expect(onError).toHaveBeenCalledWith('render', expect.any(TypeError));
});
