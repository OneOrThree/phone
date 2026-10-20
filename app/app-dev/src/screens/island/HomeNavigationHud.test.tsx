import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { applyLocalePref } from '@/i18n';
import { HomeNavigationHud } from './HomeNavigationHud';

afterEach(() => applyLocalePref('ko'));

test('프로필·친구·설정은 각 화면으로 바로 이어지고 꾸미기 글자는 표시하지 않는다', async () => {
  const go = jest.fn();
  const screen = await render(
    <HomeNavigationHud name="구름섬" clock="01:24:08" color="black" requests={2} go={go} />,
  );
  expect(screen.queryByText('꾸미기')).toBeNull();
  expect(screen.getByLabelText('구름섬 오늘 집중 01:24:08')).toBeTruthy();
  await fireEvent.press(screen.getByLabelText('내 고양이 꾸미기'));
  await fireEvent.press(screen.getByLabelText('친구, 받은 요청 2개'));
  await fireEvent.press(screen.getByLabelText('설정'));
  expect(go.mock.calls).toEqual([['wardrobe'], ['friends'], ['settings']]);
});

test('요청이 없으면 친구 버튼에 요청 수를 읽지 않고 영어에서도 입구를 유지한다', async () => {
  applyLocalePref('en');
  const screen = await render(
    <HomeNavigationHud
      name="Cloud Island"
      clock="00:00:00"
      color="gray"
      requests={0}
      go={jest.fn()}
    />,
  );
  expect(screen.getByLabelText('Friends')).toBeTruthy();
  expect(screen.getByLabelText('Customize my cat')).toBeTruthy();
  expect(screen.getByLabelText('Settings')).toBeTruthy();
  expect(screen.queryByText('0')).toBeNull();
});

test('안내 화면 뒤의 홈에는 조작 입구를 노출하지 않는다', async () => {
  const screen = await render(
    <HomeNavigationHud
      name="구름섬"
      clock="00:00:00"
      color="black"
      requests={1}
      go={jest.fn()}
      interactive={false}
    />,
  );
  expect(screen.queryAllByRole('button')).toHaveLength(0);
  expect(screen.getByLabelText('구름섬 오늘 집중 00:00:00')).toBeTruthy();
});
