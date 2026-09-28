import React from 'react';
import { Text, type GestureResponderEvent } from 'react-native';
import { PRIVACY_URL, TERMS_URL, openPolicy } from '@/constants/legal';

const policies = {
  terms: { title: '이용약관', url: TERMS_URL },
  privacy: { title: '개인정보처리방침', url: PRIVACY_URL },
} as const;

/**
 * 동의 문구 안에 끼워 넣는 밑줄 링크. 부모 글꼴을 그대로 물려받는다.
 * 웹에서는 클릭이 부모 체크박스로 전파되지 않게 막아, 링크를 눌러도 동의가 토글되지 않는다.
 */
export function PolicyLink({ policy }: { policy: keyof typeof policies }) {
  const { title, url } = policies[policy];
  return (
    <Text
      testID={`policy-link-${policy}`}
      accessibilityRole="link"
      accessibilityLabel={`${title} 원문 보기`}
      suppressHighlighting
      onPress={(event: GestureResponderEvent) => {
        event?.stopPropagation?.();
        openPolicy(url);
      }}
      style={{ textDecorationLine: 'underline' }}
    >
      {title}
    </Text>
  );
}
