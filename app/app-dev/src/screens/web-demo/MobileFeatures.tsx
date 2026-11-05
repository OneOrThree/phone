import React from 'react';
import { Linking, StyleSheet, View } from 'react-native';
import { Btn, Txt } from '@/design-system/patterns';
import { semanticTokens as s } from '@/design-system/tokens';
import type { ScreenProps } from '@/navigation/ScreenEnvironment';
import { STORE_URLS } from '@/services/developerLetter';
import { captureWebDemoEvent } from '@/services/webDemoAnalytics';
import { Sheet } from '../shared/ScreenSheet';

export function MobileFeatures({ e }: ScreenProps) {
  const open = (platform: 'ios' | 'android') => {
    captureWebDemoEvent('store_clicked', { platform, placement: 'mobile_features' });
    Linking.openURL(STORE_URLS[platform]).catch(() =>
      e.notify('스토어를 열지 못했어요. 다시 눌러 주세요.'),
    );
  };
  return (
    <Sheet e={e} title="앱에서 더 깊이 집중해요">
      <View style={styles.content}>
        <Txt>
          웹에서는 함께 집중하고 섬을 둘러볼 수 있어요. 기기 권한이 필요한 기능은 모바일 앱에서
          이용해 주세요.
        </Txt>
        <Txt kind="h">AI 집중 측정</Txt>
        <Txt>카메라를 이용해 실제로 집중한 시간을 측정해요.</Txt>
        <Txt kind="h">휴대폰 사용 시간</Txt>
        <Txt>어떤 앱을 얼마나 썼는지 돌아보고 집중 습관을 만들어 보세요.</Txt>
        <Txt kind="h">iPhone에서 다른 앱 차단</Txt>
        <Txt>집중하는 동안 방해되는 앱을 막을 수 있어요.</Txt>
        <Btn title="Google Play에서 받기" onPress={() => open('android')} />
        <Btn title="App Store에서 받기" kind="secondary" onPress={() => open('ios')} />
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({ content: { gap: s.spacing.component } });
