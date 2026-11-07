import React from 'react';
import { Text } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { createLazyRoot, retryOnce } from './LazyRoot';

const Ready = () => <Text>준비됨</Text>;

it('retryOnce는 첫 실패 뒤 한 번만 더 받는다', async () => {
  const load = jest
    .fn()
    .mockRejectedValueOnce(new Error('chunk'))
    .mockResolvedValueOnce({ default: Ready });
  await expect(retryOnce(load, 0)()).resolves.toEqual({ default: Ready });
  expect(load).toHaveBeenCalledTimes(2);

  const failing = jest.fn().mockRejectedValue(new Error('chunk'));
  await expect(retryOnce(failing, 0)()).rejects.toThrow('chunk');
  expect(failing).toHaveBeenCalledTimes(2);
});

it('화면 번들을 받으면 그 화면을 그린다', async () => {
  const Root = createLazyRoot(() => Promise.resolve({ default: Ready }), { retryDelayMs: 0 });
  await render(<Root />);
  expect(await screen.findByText('준비됨')).toBeTruthy();
});

it('두 번 다 받지 못하면 흰 화면 대신 다시 불러오기를 보이고 실패를 알린다', async () => {
  const reload = jest.fn();
  const onError = jest.fn();
  jest.spyOn(console, 'error').mockImplementation(() => {});
  const load = jest.fn().mockRejectedValue(new Error('chunk'));
  const Root = createLazyRoot(load, { reload, onError, retryDelayMs: 0 });
  await render(<Root />);
  const button = await screen.findByText('다시 불러오기');
  expect(load).toHaveBeenCalledTimes(2);
  expect(onError).toHaveBeenCalledTimes(1);
  await act(async () => fireEvent.press(button));
  expect(reload).toHaveBeenCalledTimes(1);
});
