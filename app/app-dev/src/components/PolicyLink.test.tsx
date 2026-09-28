import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { Linking, Pressable, Text } from 'react-native';
import { PRIVACY_URL, TERMS_URL } from '@/constants/legal';
import { PolicyLink } from './PolicyLink';

function Agreement({ onToggle }: { onToggle: () => void }) {
  return (
    <Pressable testID="agreement" accessibilityRole="checkbox" onPress={onToggle}>
      <Text>
        <PolicyLink policy="terms" />과 <PolicyLink policy="privacy" />에 동의해요.
      </Text>
    </Pressable>
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
});

afterEach(() => {
  jest.restoreAllMocks();
});

test('정책 URL은 team-page Catus 정책 포털(oneorthree.world)의 한국어 문서를 가리킨다', () => {
  expect(TERMS_URL).toBe('https://oneorthree.world/catus/terms');
  expect(PRIVACY_URL).toBe('https://oneorthree.world/catus/privacy');
});

test('동의 문구 안의 이용약관을 누르면 원문을 열고 동의는 토글하지 않는다', async () => {
  const onToggle = jest.fn();
  const screen = await render(<Agreement onToggle={onToggle} />);

  fireEvent.press(screen.getByTestId('policy-link-terms'));

  expect(Linking.openURL).toHaveBeenCalledWith(TERMS_URL);
  expect(onToggle).not.toHaveBeenCalled();
});

test('동의 문구 안의 개인정보처리방침을 누르면 원문을 열고 동의는 토글하지 않는다', async () => {
  const onToggle = jest.fn();
  const screen = await render(<Agreement onToggle={onToggle} />);

  fireEvent.press(screen.getByTestId('policy-link-privacy'));

  expect(Linking.openURL).toHaveBeenCalledWith(PRIVACY_URL);
  expect(onToggle).not.toHaveBeenCalled();
});

test('링크 밖의 동의 문구를 누르면 동의가 토글된다', async () => {
  const onToggle = jest.fn();
  const screen = await render(<Agreement onToggle={onToggle} />);

  fireEvent.press(screen.getByTestId('agreement'));

  expect(onToggle).toHaveBeenCalledTimes(1);
  expect(Linking.openURL).not.toHaveBeenCalled();
});

test('링크는 스크린 리더에 link 역할과 원문 보기 라벨로 노출된다', async () => {
  const screen = await render(<Agreement onToggle={() => {}} />);

  expect(screen.getByRole('link', { name: '이용약관 원문 보기' })).toBeTruthy();
  expect(screen.getByRole('link', { name: '개인정보처리방침 원문 보기' })).toBeTruthy();
});

test('브라우저를 열 수 없어도 예외를 밖으로 던지지 않는다', async () => {
  jest.spyOn(Linking, 'openURL').mockRejectedValue(new Error('no browser'));
  const screen = await render(<Agreement onToggle={() => {}} />);

  expect(() => fireEvent.press(screen.getByTestId('policy-link-terms'))).not.toThrow();
});
