import React from 'react';
import { StyleSheet } from 'react-native';
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

// 본문 기본 글꼴은 고운돋움(jest Platform.OS=ios → 'Gowun Dodum'), 제목·버튼처럼 굵은 글자
// (fontWeight ≥ 700)와 호출부가 직접 지정한 글꼴은 그대로 둔다(GROMO-2639)
test('본문은 고운돋움, 굵은 글자와 직접 지정한 글꼴은 그대로 둔다', async () => {
  const s = await render(
    <>
      <Text testID="body">본문</Text>
      <Text testID="bold" style={{ fontWeight: '800' }}>
        제목
      </Text>
      <Text testID="bold-num" style={{ fontWeight: 700 }}>
        700
      </Text>
      <Text testID="scene" style={{ fontFamily: 'Gowun Dodum', fontWeight: '800' }}>
        장면
      </Text>
      <Text testID="other" style={{ fontFamily: 'Menlo' }}>
        code
      </Text>
    </>,
  );
  const family = (id: string) => StyleSheet.flatten(s.getByTestId(id).props.style)?.fontFamily;
  expect(family('body')).toBe('Gowun Dodum'); // 굵기 없는 본문 → 고운돋움
  expect(family('bold')).toBeUndefined(); // 굵은 제목 → 시스템 글꼴(기본 글꼴 안 입힘)
  expect(family('bold-num')).toBeUndefined(); // 숫자 굵기 700 도 제외
  expect(family('scene')).toBe('Gowun Dodum'); // 장면이 직접 지정한 글꼴 유지
  expect(family('other')).toBe('Menlo'); // 다른 글꼴 직접 지정도 유지
});
