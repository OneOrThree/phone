import React from 'react';
import { Image, StyleSheet, View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { componentTokens } from '@/design-system/tokens';
import { raftTelescope, RAFT_TELESCOPE_ASPECT, telescopeSea } from '@/screens/sea/seaAssets';

const token = componentTokens.observatory.scenery;
const styles = StyleSheet.create({
  sea: { width: '100%', height: '100%' },
  footer: { flexGrow: 1, minHeight: token.footerHeight, justifyContent: 'flex-end' },
  raft: {
    alignSelf: 'flex-end',
    width: token.raftWidth,
    height: token.raftWidth / RAFT_TELESCOPE_ASPECT,
  },
});

/** 기존 망원경의 바다를 그대로 쓰고 검색창 뒤 하늘만 옅게 덮는다. */
export function ObservatoryOcean() {
  return (
    <View
      pointerEvents="none"
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={StyleSheet.absoluteFill}
    >
      <Image source={telescopeSea.source} resizeMode="cover" style={styles.sea} />
      <Svg width="100%" height="100%" style={StyleSheet.absoluteFill}>
        <Defs>
          <LinearGradient id="observatory-sky-wash" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={token.sky} />
            <Stop offset="0.12" stopColor={token.sky} stopOpacity="0.87" />
            <Stop offset="0.43" stopColor={token.sky} stopOpacity="0.13" />
            <Stop offset="0.65" stopColor={token.sky} stopOpacity="0" />
          </LinearGradient>
        </Defs>
        <Rect width="100%" height="100%" fill="url(#observatory-sky-wash)" />
      </Svg>
    </View>
  );
}

/** 목록 뒤에 이어지는 장식이라 작은 화면과 큰 글자에서도 행을 가리지 않는다. */
export function ObservatoryRaft() {
  return (
    <View
      pointerEvents="none"
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={styles.footer}
    >
      <Image source={raftTelescope.black} resizeMode="contain" style={styles.raft} />
    </View>
  );
}
