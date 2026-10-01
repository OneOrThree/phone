import React from 'react';
import {
  Pressable,
  Text,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { PRIVACY_URL, TERMS_URL, openPolicy } from '@/constants/legal';
import { semanticTokens } from '@/design-system/tokens';

const policies = {
  terms: { title: '이용약관', url: TERMS_URL },
  privacy: { title: '개인정보처리방침', url: PRIVACY_URL },
} as const;

/**
 * 동의 체크박스 «밖»에 두는 약관 원문 링크 두 개. 각 링크가 최소 터치 영역(44pt)을 갖는 독립
 * 컨트롤이라, 링크를 조금 빗나가게 눌러도 문서 대신 동의가 토글되는 일이 없다.
 */
export function PolicyLinks({
  style,
  textStyle,
}: {
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
}) {
  return (
    <View style={[{ flexDirection: 'row', justifyContent: 'center', flexWrap: 'wrap' }, style]}>
      {(Object.keys(policies) as (keyof typeof policies)[]).map((policy) => {
        const { title, url } = policies[policy];
        return (
          <Pressable
            key={policy}
            testID={`policy-link-${policy}`}
            accessibilityRole="link"
            accessibilityLabel={`${title} 원문 보기`}
            onPress={() => openPolicy(url)}
            style={{
              minHeight: semanticTokens.size.tapMin,
              minWidth: semanticTokens.size.tapMin,
              paddingHorizontal: 10,
              justifyContent: 'center',
            }}
          >
            <Text style={[{ textDecorationLine: 'underline' }, textStyle]}>{title} 보기</Text>
          </Pressable>
        );
      })}
    </View>
  );
}
