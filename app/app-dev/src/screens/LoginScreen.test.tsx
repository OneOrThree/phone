import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { applyLocalePref } from '@/i18n';
import { LoginScreen } from './LoginScreen';

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
      providers={['line', 'apple', 'google']}
      termsAccepted
      onTermsAcceptedChange={jest.fn()}
      onProviderPress={jest.fn()}
    />,
  );

  for (const provider of ['line', 'apple', 'google']) {
    const style = screen.getByTestId(`login-${provider}`).props.style;
    expect(style.height).toBeUndefined();
    expect(style.minHeight).toBe(54);
    expect(style.paddingVertical).toBeGreaterThan(0);
  }
});

test('Apple·Google 버튼은 높이·여백·모서리와 라벨 글꼴을 공유하고 색만 다르다', async () => {
  const screen = await render(
    <LoginScreen
      providers={['apple', 'google']}
      termsAccepted
      onTermsAcceptedChange={jest.fn()}
      onProviderPress={jest.fn()}
    />,
  );

  const apple = screen.getByTestId('login-apple').props.style;
  const google = screen.getByTestId('login-google').props.style;
  for (const key of [
    'minHeight',
    'paddingVertical',
    'paddingHorizontal',
    'borderRadius',
    'borderWidth',
  ]) {
    expect(apple[key]).toBe(google[key]);
  }
  expect(apple.backgroundColor).not.toBe(google.backgroundColor);

  const label = (text: string) => screen.getByText(text).props.style;
  const appleLabel = [label('Apple로 계속하기')].flat().reduce((a, s) => ({ ...a, ...s }), {});
  const googleLabel = [label('Google로 계속하기')].flat().reduce((a, s) => ({ ...a, ...s }), {});
  expect(appleLabel.fontSize).toBe(googleLabel.fontSize);
  expect(appleLabel.fontWeight).toBe(googleLabel.fontWeight);
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

describe('en', () => {
  const mockLocales = jest.requireMock('expo-localization').getLocales as jest.Mock;

  afterEach(() => {
    mockLocales.mockReturnValue([{ languageCode: 'ko', languageTag: 'ko-KR' }]);
    applyLocalePref('system');
  });

  test('기기 언어가 en 이면 제공자 라벨과 게스트 문구를 영문으로 보여준다', async () => {
    mockLocales.mockReturnValue([{ languageCode: 'en', languageTag: 'en-US' }]);
    applyLocalePref('system');
    const screen = await render(
      <LoginScreen
        providers={['google']}
        termsAccepted
        onTermsAcceptedChange={jest.fn()}
        onGuestPress={jest.fn()}
      />,
    );

    expect(screen.getByText('Continue with Google')).toBeTruthy();
    expect(screen.getByText('Start as a guest')).toBeTruthy();
  });
});
