import React from 'react';
import { Image, StyleSheet, Text, View, Platform, type ImageSourcePropType } from 'react-native';
import { componentTokens, primitiveTokens } from '@/design-system/tokens';
import { facilityPressStyle, type FacilityRect } from './tileFacilities';
import { WebFacilitySignText } from './WebFacilitySignText';

const tokens = componentTokens.tileFacility;
const sign = require('@/assets/village-world/ui/wooden-name-sign.png');
// 아래 그림은 scripts/build-facility-crops.py 산출물이다(GROMO-2378). 1536×1024 레이어 대신
// 시설 rect(TILE_FACILITIES) 크기로 잘라 디코드 메모리를 줄인다. [낮, 밤] 순서.
// 게시판·축음기·우체통 정적 그림. 회관·전망대·상점·도서관은 모션 첫 프레임이 같은 rect 로 그린다.
const layerSources: Record<string, readonly ImageSourcePropType[]> = {
  board: [
    require('@/assets/village-world/facility/board-day.png'),
    require('@/assets/village-world/facility/board-night.png'),
  ],
  gram: [
    require('@/assets/village-world/facility/gram-day.png'),
    require('@/assets/village-world/facility/gram-night.png'),
  ],
  mail: [
    require('@/assets/village-world/facility/mail-day.png'),
    require('@/assets/village-world/facility/mail-night.png'),
  ],
};
export const tileFacilityLayerSource = (id: string, night: boolean) =>
  layerSources[id]?.[night ? 1 : 0];

/** 외곽선 마스크는 시설 rect 사방으로 이만큼(원화 px) 크다. build-facility-crops.py OUTLINE_MARGIN 과 같다. */
export const TILE_FACILITY_OUTLINE_MARGIN = 4;
// 외곽선은 건물 알파를 8방향으로 민 합성을 미리 그린 흰색 마스크 한 장이다. 색은 tintColor 로 입힌다.
const outlineSources: Record<string, readonly ImageSourcePropType[]> = {
  hall: [
    require('@/assets/village-world/facility/outline/hall-day.png'),
    require('@/assets/village-world/facility/outline/hall-night.png'),
  ],
  board: [
    require('@/assets/village-world/facility/outline/board-day.png'),
    require('@/assets/village-world/facility/outline/board-night.png'),
  ],
  gram: [
    require('@/assets/village-world/facility/outline/gram-day.png'),
    require('@/assets/village-world/facility/outline/gram-night.png'),
  ],
  library: [
    require('@/assets/village-world/facility/outline/library-day.png'),
    require('@/assets/village-world/facility/outline/library-night.png'),
  ],
  mail: [
    require('@/assets/village-world/facility/outline/mail-day.png'),
    require('@/assets/village-world/facility/outline/mail-night.png'),
  ],
  tower: [
    require('@/assets/village-world/facility/outline/tower-day.png'),
    require('@/assets/village-world/facility/outline/tower-night.png'),
  ],
  shop: [
    require('@/assets/village-world/facility/outline/shop-day.png'),
    require('@/assets/village-world/facility/outline/shop-night.png'),
  ],
  // 새 편지가 있을 때 우체통 자리를 대신하는 펠리컨(TILE_MAILBOX_PELICAN_RECT). 낮·밤 같은 그림이다.
  'mail-pelican': [
    require('@/assets/village-world/facility/outline/mail-pelican.png'),
    require('@/assets/village-world/facility/outline/mail-pelican.png'),
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
};

// ponytail: 외곽선 두께는 원화 px 로 고정(기준 화면 402×874 에서 outlineWidth pt)이라 기본 배율을 따라
// 기기마다 조금 달라진다(건물 대비 비율은 같다). 기기별로 pt 를 맞춰야 하면 두께별 마스크를 더 만든다.
export function TileFacilityOutline({
  source,
  rect,
  left,
  top,
  scale,
  baseScale = 1,
  pressed,
  reduceMotion,
}: OutlineProps) {
  const zoom = scale / baseScale;
  const pad = tokens.outlineWidth * 2;
  const margin = TILE_FACILITY_OUTLINE_MARGIN * baseScale;
  // 건물과 같은 RN 이미지 레이아웃으로 그린다. 별도 Skia surface의 크기 갱신을 기다리지 않는다.
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
          ...facilityPressStyle(pressed, reduceMotion),
        }}
      >
        <Image
          source={source}
          accessible={false}
          fadeDuration={0}
          resizeMode="stretch"
          style={{
            position: 'absolute',
            left: pad - margin,
            top: pad - margin,
            width: rect.w * baseScale + margin * 2,
            height: rect.h * baseScale + margin * 2,
            tintColor: tokens.outline,
          }}
        />
      </View>
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
          {Platform.OS === 'web' ? (
            <WebFacilitySignText label={label} />
          ) : (
            <Text numberOfLines={1} adjustsFontSizeToFit style={styles.text}>
              {label}
            </Text>
          )}
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
