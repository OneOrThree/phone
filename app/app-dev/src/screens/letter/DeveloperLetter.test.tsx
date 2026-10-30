import React from 'react';
import { AccessibilityInfo } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { MotionContext } from '@/design-system/primitives';
import { DeveloperLetter } from './DeveloperLetter';

let mockLayout = { width: 390, height: 844, tablet: false };
jest.mock('@/utils/layout', () => ({
  useAppLayout: () => ({
    ...mockLayout,
    fontScale: 1,
    insets: { top: 0, bottom: 0, left: 0, right: 0 },
  }),
}));

const open = (props = {}, reduce = false) =>
  render(
    <MotionContext.Provider value={reduce}>
      <DeveloperLetter
        title="제목"
        body="본문"
        date={new Date('2026-10-30T00:00:00Z')}
        onClose={jest.fn()}
        {...props}
      />
    </MotionContext.Provider>,
  );

beforeEach(() => {
  jest.useFakeTimers();
  mockLayout = { width: 390, height: 844, tablet: false };
});
afterEach(() => jest.useRealTimers());

it('봉투를 눌러야 편지지가 나오고 제목·본문이 평문으로 보인다', async () => {
  await open();
  expect(screen.queryByText('제목')).toBeNull();
  await fireEvent.press(screen.getByTestId('developer-letter-envelope'));
  await act(() => jest.advanceTimersByTime(2000));
  expect(screen.getByText('운영진의 편지')).toBeTruthy();
  expect(screen.getByText('제목')).toBeTruthy();
  expect(screen.getByText('본문')).toBeTruthy();
});

it('폭 min(440, 폭-48), 최대 높이 70%, 긴 본문은 안쪽 ScrollView 이고 버튼은 편지 밖에 있다', async () => {
  await open({ body: '가'.repeat(10000) }, true);
  await fireEvent.press(screen.getByTestId('developer-letter-envelope'));
  const paper = screen.getByTestId('developer-letter-paper');
  const style = Object.assign({}, ...[paper.props.style].flat(Infinity));
  expect(style.width).toBe(342);
  expect(style.maxHeight).toBeCloseTo(844 * 0.7);
  expect(screen.getByTestId('developer-letter-body')).toBeTruthy();
  expect(screen.getByTestId('developer-letter-confirm')).toBeTruthy();
  expect(() =>
    require('@testing-library/react-native').within(paper).getByTestId('developer-letter-confirm'),
  ).toThrow();
});

it('태블릿은 폭이 440 으로 멈춘다', async () => {
  mockLayout = { width: 820, height: 1180, tablet: true };
  await open({}, true);
  await fireEvent.press(screen.getByTestId('developer-letter-envelope'));
  const style = Object.assign(
    {},
    ...[screen.getByTestId('developer-letter-paper').props.style].flat(Infinity),
  );
  expect(style.width).toBe(440);
});

it('잘 읽었어요로 닫고 바깥(배경) 누르기로는 닫히지 않는다(뒤로 가기는 App 테스트)', async () => {
  const onClose = jest.fn();
  await open({ onClose }, true);
  await fireEvent.press(screen.getByTestId('developer-letter'));
  await fireEvent.press(screen.getByTestId('developer-letter-envelope'));
  expect(onClose).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByTestId('developer-letter-confirm'));
  expect(onClose).toHaveBeenCalledTimes(1);
});

it('봉투가 처음 나타날 때 스크린 리더에 한 번 알린다', async () => {
  const announce = jest
    .spyOn(AccessibilityInfo, 'announceForAccessibility')
    .mockImplementation(() => {});
  announce.mockClear();
  const r = await open({}, true);
  expect(announce).toHaveBeenCalledTimes(1);
  expect(announce).toHaveBeenCalledWith('운영진의 편지가 도착했어요. 눌러서 열어 보기');
  await fireEvent.press(screen.getByTestId('developer-letter-envelope'));
  expect(announce).toHaveBeenCalledTimes(1);
  r.unmount();
});

it('reduceMotion 이면 기다림 없이 봉투가 바로 있다', async () => {
  await open({}, true);
  expect(screen.getByTestId('developer-letter-envelope')).toBeTruthy();
});

it('폰이 가로여도 600ms 뒤에는 봉투가 나온다', async () => {
  mockLayout = { width: 844, height: 390, tablet: false };
  await open({}, true);
  expect(screen.queryByTestId('developer-letter-envelope')).toBeNull();
  await act(() => jest.advanceTimersByTime(600));
  expect(screen.getByTestId('developer-letter-envelope')).toBeTruthy();
});
