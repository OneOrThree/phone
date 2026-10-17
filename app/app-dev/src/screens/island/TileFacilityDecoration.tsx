import React from 'react';
import { Image, StyleSheet, Text, View, type ImageSourcePropType } from 'react-native';
import {
  BlendColor,
  Canvas,
  Image as SkiaImage,
  Morphology,
  useImage,
} from '@shopify/react-native-skia';
import { componentTokens, primitiveTokens } from '@/design-system/tokens';
import { facilityPressStyle, type FacilityRect } from './tileFacilities';

const tokens = componentTokens.tileFacility;
const sign = require('@/assets/village-world/ui/wooden-name-sign.png');
// 모션 건물은 이미 잘라 둔 첫 프레임을 재사용해 외곽선마다 1536×1024 레이어를 추가 디코드하지 않는다.
const outlineSources: Record<string, readonly ImageSourcePropType[]> = {
  hall: [
    require('@/assets/village-world/motion/hall/frame-0.png'),
    require('@/assets/village-world/motion/hall/night-frame-0.png'),
  ],
  tower: [
    require('@/assets/village-world/motion/observatory/frame-0.png'),
    require('@/assets/village-world/motion/observatory/night-frame-0.png'),
  ],
  shop: [
    require('@/assets/village-world/motion/shop/frame-0.png'),
    require('@/assets/village-world/motion/shop/night-frame-0.png'),
  ],
  library: [
    require('@/assets/village-world/motion/library/frame-0.png'),
    require('@/assets/village-world/motion/library/night-frame-0.png'),
  ],
};
export const tileFacilityOutlineSource = (id: string, night: boolean) =>
  outlineSources[id]?.[night ? 1 : 0];

/** 외곽선은 실제 건물 알파를 확장한다. 사각 보더나 별도 액션 배지는 그리지 않는다. */
export function TileFacilityOutline({
  source,
  rect,
  left,
  top,
  scale,
  pressed,
  reduceMotion,
  cropped = false,
}: {
  source: ImageSourcePropType;
  rect: FacilityRect;
  left: number;
  top: number;
  scale: number;
  pressed: boolean;
  reduceMotion: boolean;
  cropped?: boolean;
}) {
  const image = useImage(source as Parameters<typeof useImage>[0]);
  const pad = tokens.outlineWidth * 2;
  return (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: left + rect.x * scale,
        top: top + rect.y * scale,
        width: rect.w * scale,
        height: rect.h * scale,
        ...facilityPressStyle(pressed, reduceMotion),
      }}
    >
      <Canvas
        style={{
          position: 'absolute',
          left: -pad,
          top: -pad,
          width: rect.w * scale + pad * 2,
          height: rect.h * scale + pad * 2,
        }}
      >
        <SkiaImage
          image={image}
          fit="fill"
          x={pad - (cropped ? 0 : rect.x * scale)}
          y={pad - (cropped ? 0 : rect.y * scale)}
          width={(cropped ? rect.w : 1536) * scale}
          height={(cropped ? rect.h : 1024) * scale}
        >
          <Morphology radius={tokens.outlineWidth} />
          <BlendColor color={tokens.outline} mode="srcIn" />
        </SkiaImage>
      </Canvas>
    </View>
  );
}

export function TileFacilitySign({
  label,
  pressed,
  reduceMotion,
}: {
  label: string;
  pressed: boolean;
  reduceMotion: boolean;
}) {
  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[StyleSheet.absoluteFill, facilityPressStyle(pressed, reduceMotion)]}
    >
      <Image source={sign} resizeMode="stretch" style={StyleSheet.absoluteFill} />
      <View style={styles.textArea}>
        <Text numberOfLines={1} adjustsFontSizeToFit style={styles.text}>
          {label}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  textArea: {
    position: 'absolute',
    left: '11%',
    right: '11%',
    top: '12%',
    height: '57%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  text: {
    color: tokens.signTextColor,
    fontSize: tokens.signFontSize,
    fontWeight: primitiveTokens.fontWeight.extraBold,
    textAlign: 'center',
  },
});
