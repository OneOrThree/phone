import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { LoginScreen } from './LoginScreen';

jest.mock('expo-apple-authentication', () => {
  const React = jest.requireActual('react');
  const { Pressable } = jest.requireActual('react-native');

  return {
    AppleAuthenticationButton: (props: Record<string, unknown>) =>
      React.createElement(Pressable, { ...props, accessibilityRole: 'button' }),
    AppleAuthenticationButtonType: { CONTINUE: 2 },
    AppleAuthenticationButtonStyle: { WHITE_OUTLINE: 2 },
  };
});

jest.mock('@/utils/layout', () => ({
  useAppLayout: () => ({
    width: 402,
    height: 874,
    insets: { top: 0, right: 0, bottom: 0, left: 0 },
    tablet: false,
    landscape: false,
    compact: false,
  }),
}));

test('전달받은 제공자를 순서대로 표시한다', async () => {
  const screen = await render(
    <LoginScreen
      providers={['line', 'apple', 'google']}
      termsAccepted
      onTermsAcceptedChange={jest.fn()}
      onProviderPress={jest.fn()}
      onGuestPress={jest.fn()}
    />,
  );

  expect(screen.getAllByRole('button').map((button) => button.props.accessibilityLabel)).toEqual([
    'LINE으로 계속하기',
    'Apple로 계속하기',
    'Google로 계속하기',
    '게스트로 시작하기',
  ]);
  expect(screen.queryByLabelText('카카오로 계속하기')).toBeNull();
});

test('텍스트 브랜드 버튼은 큰 글자에 맞춰 최소 높이 이상으로 확장된다', async () => {
  const screen = await render(
    <LoginScreen
      providers={['line', 'google']}
      termsAccepted
      onTermsAcceptedChange={jest.fn()}
      onProviderPress={jest.fn()}
    />,
  );

  for (const provider of ['line', 'google']) {
    const style = screen.getByTestId(`login-${provider}`).props.style;
    expect(style.height).toBeUndefined();
    expect(style.minHeight).toBe(54);
    expect(style.paddingVertical).toBeGreaterThan(0);
  }
});

test('로그인 동의 영역은 약관 버전을 표시하고 법률 문서 링크를 제공한다', async () => {
  const screen = await render(
    <LoginScreen
      providers={['google']}
      termsVersion="2026-09"
      termsAccepted={false}
      onTermsAcceptedChange={jest.fn()}
    />,
  );

  expect(screen.getByLabelText('현재 약관 버전 2026-09에 동의합니다')).toBeTruthy();
  expect(screen.getByTestId('policy-link-terms').props.accessibilityRole).toBe('link');
  expect(screen.getByTestId('policy-link-privacy').props.accessibilityRole).toBe('link');
});

test('약관 동의 전에는 로그인 동작을 막고 체크 상태를 변경한다', async () => {
  const onTermsAcceptedChange = jest.fn();
  const onProviderPress = jest.fn();
  const screen = await render(
    <LoginScreen
      providers={['kakao', 'google']}
      termsAccepted={false}
      onTermsAcceptedChange={onTermsAcceptedChange}
      onProviderPress={onProviderPress}
      onGuestPress={jest.fn()}
    />,
  );

  expect(screen.getByLabelText('카카오로 계속하기').props.accessibilityState.disabled).toBe(true);
  fireEvent.press(screen.getByLabelText('카카오로 계속하기'));
  expect(onProviderPress).not.toHaveBeenCalled();

  fireEvent.press(screen.getByRole('checkbox'));
  expect(onTermsAcceptedChange).toHaveBeenCalledWith(true);
});

test('한 제공자 로그인 중에는 모든 로그인 동작과 약관 변경을 막는다', async () => {
  const onTermsAcceptedChange = jest.fn();
  const screen = await render(
    <LoginScreen
      providers={['kakao', 'google']}
      termsAccepted
      onTermsAcceptedChange={onTermsAcceptedChange}
      onProviderPress={jest.fn()}
      providerBusy="kakao"
      onGuestPress={jest.fn()}
    />,
  );

  expect(screen.getByLabelText('연결하는 중…')).toBeTruthy();
  for (const button of screen.getAllByRole('button')) {
    expect(button.props.accessibilityState.disabled).toBe(true);
  }
  fireEvent.press(screen.getByRole('checkbox'));
  expect(onTermsAcceptedChange).not.toHaveBeenCalled();
});
