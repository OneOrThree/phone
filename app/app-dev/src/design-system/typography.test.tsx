import React from 'react';
import { render } from '@testing-library/react-native';
import { Text } from './typography';

// 공용 글자는 한국어를 단어 단위로 줄바꿈하는 것이 기본이고, 호출부가 다른 값을 주면 그 값을 쓴다
test('공용 Text 는 hangul-word 줄바꿈을 기본으로 붙이고 호출부 값으로 덮을 수 있다', async () => {
  const s = await render(
    <>
      <Text testID="default">시작해 볼까요</Text>
      <Text testID="override" lineBreakStrategyIOS="standard">
        들어요
      </Text>
    </>,
  );
  const native = (id: string) => s.getByTestId(id).props;
  expect(native('default').lineBreakStrategyIOS).toBe('hangul-word');
  expect(native('override').lineBreakStrategyIOS).toBe('standard');
});
