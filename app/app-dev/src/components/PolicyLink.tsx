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
import { t } from '@/i18n';

const policies = {
  terms: { titleKey: 'login.policy.terms', url: TERMS_URL },
  privacy: { titleKey: 'login.policy.privacy', url: PRIVACY_URL },
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
        const { titleKey, url } = policies[policy];
        const title = t(titleKey);
        return (
          <Pressable
            key={policy}
            testID={`policy-link-${policy}`}
            accessibilityRole="link"
            accessibilityLabel={t('login.policy.viewOriginalA11y', { title })}
            onPress={() => openPolicy(url)}
            style={{
              minHeight: semanticTokens.size.tapMin,
              minWidth: semanticTokens.size.tapMin,
              paddingHorizontal: 10,
              justifyContent: 'center',
            }}
          >
            <Text style={[{ textDecorationLine: 'underline' }, textStyle]}>
              {t('login.policy.view', { title })}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
