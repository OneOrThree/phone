import React, { useId } from 'react';
import { Image, StyleSheet, Text, View, Platform, type ImageSourcePropType } from 'react-native';
import Svg, {
  Defs,
  Filter,
  FeMorphology,
  FeFlood,
  FeComposite,
  Image as SvgImage,
} from 'react-native-svg';
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
type OutlineProps = {
  source: ImageSourcePropType;
  rect: FacilityRect;
  left: number;
  top: number;
  scale: number;
  baseScale?: number;
  pressed: boolean;
  reduceMotion: boolean;
  cropped?: boolean;
};

export function TileFacilityOutline(props: OutlineProps) {
  return Platform.OS === 'web' ? (
    <WebFacilityOutline {...props} />
  ) : (
    <NativeFacilityOutline {...props} />
  );
}

function NativeFacilityOutline({
  source,
  rect,
  left,
  top,
  scale,
  baseScale = 1,
  pressed,
  reduceMotion,
  cropped = false,
}: OutlineProps) {
  const zoom = scale / baseScale;
  const pad = tokens.outlineWidth * 2;
  // 건물과 같은 RN 이미지 레이아웃으로 그린다. 별도 Skia surface의 크기 갱신을 기다리지 않는다.
  const width = (cropped ? rect.w : 1536) * baseScale;
  const height = (cropped ? rect.h : 1024) * baseScale;
  return (
    <View
      testID="native-facility-outline"
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        position: 'absolute',
        left: left + rect.x * scale,
        top: top + rect.y * scale,
        width: rect.w * baseScale,
        height: rect.h * baseScale,
        transformOrigin: [0, 0, 0],
        transform: [{ scale: zoom }],
      }}
    >
      <View
        style={{
          position: 'absolute',
          left: -pad,
          top: -pad,
          width: rect.w * baseScale + pad * 2,
          height: rect.h * baseScale + pad * 2,
          overflow: 'hidden',
          ...facilityPressStyle(pressed, reduceMotion),
        }}
      >
        {OUTLINE_OFFSETS.map(([dx, dy], index) => (
          <Image
            key={index}
            source={source}
            accessible={false}
            fadeDuration={0}
            resizeMode="stretch"
            style={{
              position: 'absolute',
              left: pad - (cropped ? 0 : rect.x * baseScale) + dx * tokens.outlineWidth,
              top: pad - (cropped ? 0 : rect.y * baseScale) + dy * tokens.outlineWidth,
              width,
              height,
              tintColor: tokens.outline,
            }}
          />
        ))}
      </View>
    </View>
  );
}

const OUTLINE_OFFSETS = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [-1, 0],
  [1, 0],
  [-1, 1],
  [0, 1],
  [1, 1],
] as const;

function WebFacilityOutline({
  source,
  rect,
  left,
  top,
  scale,
  baseScale = 1,
  pressed,
  reduceMotion,
  cropped = false,
}: OutlineProps) {
  const uid = useId().replace(/:/g, '');
  const zoom = scale / baseScale;
  const pad = tokens.outlineWidth * 2;
  return (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: left + rect.x * scale,
        top: top + rect.y * scale,
        width: rect.w * baseScale,
        height: rect.h * baseScale,
        transformOrigin: [0, 0, 0],
        transform: [{ scale: zoom }],
      }}
    >
      <Svg
        width={rect.w * baseScale + pad * 2}
        height={rect.h * baseScale + pad * 2}
        style={{
          position: 'absolute',
          left: -pad,
          top: -pad,
          ...facilityPressStyle(pressed, reduceMotion),
        }}
      >
        <Defs>
          <Filter
            id={uid}
            x={0}
            y={0}
            width={rect.w * baseScale + pad * 2}
            height={rect.h * baseScale + pad * 2}
            filterUnits="userSpaceOnUse"
          >
            <FeMorphology
              in="SourceAlpha"
              operator="dilate"
              radius={tokens.outlineWidth}
              result="edge"
            />
            <FeFlood floodColor={tokens.outline} result="color" />
            <FeComposite in="color" in2="edge" operator="in" />
          </Filter>
        </Defs>
        <SvgImage
          href={source}
          filter={`url(#${uid})`}
          x={pad - (cropped ? 0 : rect.x * baseScale)}
          y={pad - (cropped ? 0 : rect.y * baseScale)}
          width={(cropped ? rect.w : 1536) * baseScale}
          height={(cropped ? rect.h : 1024) * baseScale}
          preserveAspectRatio="none"
        />
      </Svg>
    </View>
  );
}

export function TileFacilitySign({
  width,
  height,
  label,
  zoom = 1,
  pressed,
  reduceMotion,
}: {
  width: number;
  height: number;
  label: string;
  zoom?: number;
  pressed: boolean;
  reduceMotion: boolean;
}) {
  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      collapsable={false}
      style={[{ width, height }, facilityPressStyle(pressed, reduceMotion)]}
    >
      <View
        style={{
          width: width / zoom,
          height: height / zoom,
          transformOrigin: [0, 0, 0],
          transform: [{ scale: zoom }],
        }}
      >
        <Image
          source={sign}
          fadeDuration={0}
          resizeMode="stretch"
          style={[styles.signImage, { width: width / zoom, height: height / zoom }]}
        />
        <View style={styles.textArea}>
          <Text numberOfLines={1} adjustsFontSizeToFit style={styles.text}>
            {label}
          </Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  signImage: {
    ...StyleSheet.absoluteFill,
    width: '100%',
    height: '100%',
  },
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
