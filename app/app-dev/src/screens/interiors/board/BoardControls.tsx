import { Wheel } from '@/design-system/patterns';
import { semanticTokens } from '@/design-system/tokens';
import { localized, t } from '@/i18n';
import { GOWUN } from '@/screens/island/sceneKit';
import { clockMinutes } from '@/services/model';
import { LAST_KST_WINDOW_END_MINUTES } from '@/utils/questWindowTz';
import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Image,
  ImageSourcePropType,
  Platform,
  Pressable,
  View,
} from 'react-native';
import Svg, { G, Path } from 'react-native-svg';
import { interiorArt } from '../assets';
import { INK, assetUri, lh, webOnly } from '../shared/styles';
import { Text, boardFont } from '../shared/typography';
import { HANDWRITING } from './boardData';
import { QuestType } from './types';

// 원본 <img object-fit:contain>. 웹은 CSS 배경이면 확대 결과가 달라 실제 img를 박스에 채운다
export function Picture({
  source,
  label,
  style,
  shadow,
}: {
  source: ImageSourcePropType;
  label: string;
  style: any;
  shadow?: string;
}) {
  if (Platform.OS !== 'web')
    return <Image source={source} accessibilityLabel={label} resizeMode="contain" style={style} />;
  return (
    <View style={[style, webOnly({ filter: shadow && `drop-shadow(${shadow})` })]}>
      <img
        src={assetUri(source)}
        alt={label}
        style={{
          display: 'block',
          width: '100%',
          height: '100%',
          objectFit: 'contain',
          pointerEvents: 'none',
        }}
      />
    </View>
  );
}

// 공지·퀘스트 바텀시트와 공지 상세에 공통으로 쓰는 실제 종이 에셋.
// 투명 여백과 접힌 모서리까지 보존하기 위해 contain이 아니라 프레임에 맞춰 늘린다.
export function BoardPaper({ source, style }: { source: ImageSourcePropType; style?: any }) {
  const frame = [{ position: 'absolute', left: -34, right: -34, top: -38, bottom: -30 }, style];
  // iOS는 left/right/top/bottom 만 준 Image 의 그림을 상자 크기로 늘리지 않는다(원본 크기로 그림).
  // 바깥 View 가 프레임을 맡고, 잰 크기를 숫자 폭·높이로 Image 에 준다
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  if (Platform.OS !== 'web') {
    return (
      <View
        pointerEvents="none"
        style={frame}
        onLayout={(event) => {
          const { width, height } = event.nativeEvent.layout;
          if (width !== size?.width || height !== size?.height) setSize({ width, height });
        }}
      >
        {size && (
          <Image
            source={source}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            resizeMode="stretch"
            style={size}
          />
        )}
      </View>
    );
  }
  return (
    <View pointerEvents="none" style={frame}>
      <img
        aria-hidden="true"
        src={assetUri(source)}
        alt=""
        style={{
          display: 'block',
          width: '100%',
          height: '100%',
          objectFit: 'fill',
          pointerEvents: 'none',
        }}
      />
    </View>
  );
}

// 종이 위 손글씨 줄 (원본 boardHandwritingMarkup)
export function Handwriting({ short, scale = 1 }: { short?: boolean; scale?: number }) {
  return (
    <Svg
      viewBox={`0 0 100 ${short ? 34 : 70}`}
      pointerEvents="none"
      style={
        short
          ? { width: '86%', maxHeight: 20 * scale, aspectRatio: 100 / 34, opacity: 0.72 }
          : { width: '100%', aspectRatio: 100 / 70, opacity: 0.76 }
      }
    >
      <G
        fill="none"
        stroke={short ? '#947237' : '#8c6b4d'}
        strokeWidth={1.7}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {HANDWRITING.slice(0, short ? 2 : 4).map((d) => (
          <Path key={d} d={d} />
        ))}
      </G>
    </Svg>
  );
}

// .board-primary · .board-outline
export function BoardPill({
  label,
  onPress,
  testID,
  primary,
  disabled,
  size = 14,
  minHeight = 44,
  padding = [8, 13],
  style,
}: {
  label: string;
  onPress: () => void;
  testID: string;
  primary?: boolean;
  disabled?: boolean;
  size?: number;
  minHeight?: number;
  padding?: [number, number];
  style?: any;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        {
          minHeight,
          paddingVertical: padding[0],
          paddingHorizontal: padding[1],
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 6,
          borderWidth: 2,
          borderColor: '#8b6956',
          borderRadius: 999,
          backgroundColor: primary ? '#ffa6bc' : '#fffdfa',
          boxShadow: '0 4px 0 #8b6956',
        },
        disabled && { backgroundColor: '#e3d8c6', boxShadow: '0 2px 0 #a18c7e' },
        pressed && { transform: [{ translateY: 3 }], boxShadow: '0 1px 0 #8b6956' },
        style,
      ]}
    >
      <Text style={boardFont(size, 1.25, '700', disabled ? '#8a776b' : INK, GOWUN)}>{label}</Text>
    </Pressable>
  );
}

// .board-text (밑줄 글자 버튼)
export function Link({
  label,
  onPress,
  testID,
  danger,
  size = 13,
  minTapHeight,
}: {
  label: string;
  onPress: () => void;
  testID: string;
  danger?: boolean;
  size?: number;
  minTapHeight?: number;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      onPress={onPress}
      style={[
        { paddingVertical: 4 },
        minTapHeight != null && {
          minWidth: minTapHeight,
          minHeight: minTapHeight,
          alignItems: 'center',
          justifyContent: 'center',
        },
      ]}
    >
      <Text
        style={[
          boardFont(size, 1.3, '400', danger ? '#a35952' : '#786151', GOWUN),
          { textAlign: 'center', textDecorationLine: 'underline' },
          webOnly({ textUnderlineOffset: 3 }),
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

// 종이에 직접 적힌 것처럼 보이는 동작. 실제 터치 영역은 44pt로 유지한다.
export function PaperAction({
  label,
  onPress,
  testID,
  style,
}: {
  label: string;
  onPress: () => void;
  testID: string;
  style?: any;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      hitSlop={4}
      onPress={onPress}
      style={({ pressed }) => [
        {
          minHeight: 44,
          paddingHorizontal: 4,
          justifyContent: 'center',
          opacity: pressed ? 0.55 : 1,
        },
        style,
      ]}
    >
      <Text
        style={[
          boardFont(16, 1.2, '700', '#7e5541'),
          { textDecorationLine: 'underline' },
          webOnly({ textUnderlineOffset: 4 }),
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

// 공지 종이 위의 주요 동작은 앱 버튼 대신 잉크 도장을 찍은 것처럼 보이게 한다.
export function PaperStamp({
  label,
  onPress,
  testID,
  disabled,
}: {
  label: string;
  onPress: () => void;
  testID: string;
  disabled?: boolean;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        {
          alignSelf: 'flex-end',
          minHeight: 44,
          marginTop: 5,
          paddingVertical: 8,
          paddingHorizontal: 17,
          alignItems: 'center',
          justifyContent: 'center',
          borderWidth: 2,
          borderColor: '#9a6557',
          borderRadius: 4,
          backgroundColor: '#fffaf1',
          transform: [{ rotate: '-1deg' }],
        },
        disabled && { opacity: 0.42 },
        pressed && { opacity: 0.55, transform: [{ rotate: '-1deg' }, { scale: 0.98 }] },
      ]}
    >
      <Text style={boardFont(16, 1.2, '700', '#8d5b50')}>{label}</Text>
    </Pressable>
  );
}

// .quest-card-track
export function Track({ rate, color, style }: { rate: number; color: string; style?: any }) {
  return (
    <View
      style={[
        { height: 7, borderRadius: 99, backgroundColor: '#e6d9af', overflow: 'hidden' },
        style,
      ]}
    >
      <View
        style={{ width: `${rate}%`, height: '100%', borderRadius: 99, backgroundColor: color }}
      />
    </View>
  );
}

export function BlueprintReadyStamp({ reduceMotion }: { reduceMotion: boolean }) {
  const impact = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;
  useEffect(() => {
    if (reduceMotion) return;
    Animated.timing(impact, {
      toValue: 1,
      duration: 240,
      easing: Easing.out(Easing.back(1.8)),
      useNativeDriver: false,
    }).start();
  }, [impact, reduceMotion]);
  return (
    <Animated.View
      testID="board-blueprint-ready-stamp"
      style={{
        // 시안 크기 126까지, 좁은 화면에서는 들어 있는 그림 칸 폭만큼 줄어든다(정사각형 유지)
        width: '100%',
        maxWidth: 126,
        aspectRatio: 1,
        opacity: impact,
        transform: [
          { scale: impact.interpolate({ inputRange: [0, 0.82, 1], outputRange: [1.65, 0.94, 1] }) },
        ],
      }}
    >
      <Picture
        source={localized(interiorArt.blueprintReadyStamp)}
        label={t('common.readyStampA11y')}
        style={{ width: '100%', height: '100%' }}
      />
    </Animated.View>
  );
}

// 폼 label (글자 한 줄 + 입력칸)
export function BoardField({
  label,
  children,
  style,
}: {
  label: string;
  children: React.ReactNode;
  style?: any;
}) {
  return (
    <View style={[{ gap: 7 }, style]}>
      <Text style={boardFont(14, 1.6, '700')}>{label}</Text>
      {children}
    </View>
  );
}

// 입력칸: font 14px/1.5 Gowun (textarea 줄바꿈은 브라우저 기본값을 둔다)
export const inputStyle = (): any => ({
  width: '100%',
  minWidth: 0,
  minHeight: 44,
  padding: 10,
  borderWidth: 1.5,
  borderColor: '#b49472',
  borderRadius: 8,
  backgroundColor: '#fffdf5',
  color: INK,
  fontFamily: GOWUN,
  fontSize: 14,
  lineHeight: lh(14 * 1.5),
});

// 시·분 드럼 피커 — 자유 텍스트 대신 공용 Wheel 두 개를 가로로 둔다(§7.12, GROMO-2672).
const HOUR_ITEMS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));

const HOUR_ITEMS_WITH_MIDNIGHT = [...HOUR_ITEMS, '24'];

const MINUTE_ITEMS = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0'));

const pad2 = (n: number) => String(n).padStart(2, '0');

// 시 Wheel + 분 Wheel. 24 시(하루 끝)를 고르면 분은 00 으로 고정한다.
function HourMinuteWheels({
  testID,
  label,
  hours,
  hh,
  mm,
  onPick,
}: {
  testID: string;
  label: string;
  hours: string[];
  hh: string;
  mm: string;
  onPick: (hh: string, mm: string) => void;
}) {
  return (
    <View testID={testID} style={{ flexDirection: 'row', gap: semanticTokens.spacing.control }}>
      <Wheel
        label=""
        a11yLabel={t('ui.board.hour', { v0: label })}
        items={hours}
        value={hh}
        onChange={(h: string) => onPick(h, mm)}
      />
      <Wheel
        label=""
        a11yLabel={t('ui.board.minute', { v0: label })}
        items={hh === '24' ? ['00'] : MINUTE_ITEMS}
        value={mm}
        onChange={(m: string) => onPick(hh, m)}
      />
    </View>
  );
}

// 시간대 집중 창의 시작·종료 시각(KST 벽시계 "HH:mm"). 둘 다 23:59 까지다 — 종료 24:00 은 운영 DB
// CHECK 에 걸려 만들 수 없다(GROMO-2886). 값이 24:00 이면 휠은 어댑터가 보낼 23:59 를 가리킨다.
export function QuestTimeInput({
  testID,
  label,
  value,
  onChange,
}: {
  testID: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const total = Math.min(clockMinutes(value) ?? 0, LAST_KST_WINDOW_END_MINUTES);
  return (
    <HourMinuteWheels
      testID={testID}
      label={label}
      hours={HOUR_ITEMS}
      hh={pad2(Math.floor(total / 60))}
      mm={pad2(total % 60)}
      onPick={(h, m) => onChange(`${h}:${m}`)}
    />
  );
}

// 목표 집중 시간 · 폰 사용 상한(분). 창과 달리 이건 duration 이라 KST/UTC 변환이 없다 — 총 분 문자열을 유지한다.
export function QuestTargetInput({
  testID,
  label,
  value,
  onChange,
}: {
  testID: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  // 서버 상한은 1440분(=24:00) 이다 — 하루 폰 사용 상한의 하루 전체(1440)를 고를 수 있어야 한다(GROMO-2672).
  const total = Math.max(0, Math.min(24 * 60, Number(value) || 0));
  const hh = pad2(Math.min(24, Math.floor(total / 60)));
  const mm = hh === '24' ? '00' : pad2(total % 60);
  return (
    <HourMinuteWheels
      testID={testID}
      label={label}
      hours={HOUR_ITEMS_WITH_MIDNIGHT}
      hh={hh}
      mm={mm}
      onPick={(h, m) => onChange(String(Number(h) * 60 + (h === '24' ? 0 : Number(m))))}
    />
  );
}

export function QuestTypeChoice({
  value,
  onChange,
}: {
  value: QuestType;
  onChange: (value: QuestType) => void;
}) {
  const options: [QuestType, string, string][] = [
    ['focus', t('ui.board.scheduledFocus'), t('ui.board.focusWithinSchedule')],
    ['phone', t('ui.board.dailyPhoneUse'), t('ui.board.dailyUsageCap')],
  ];
  return (
    <View testID="board-quest-type" style={{ flexDirection: 'row', gap: 8 }}>
      {options.map(([option, label, note]) => {
        const selected = option === value;
        return (
          <Pressable
            key={option}
            testID={`board-quest-type-${option}`}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            onPress={() => onChange(option)}
            style={({ pressed }) => ({
              flex: 1,
              minHeight: 64,
              paddingVertical: 9,
              paddingHorizontal: 8,
              justifyContent: 'center',
              borderWidth: 1.5,
              borderColor: selected ? '#8b6956' : '#c8aa86',
              borderRadius: 9,
              backgroundColor: selected ? '#fff0b9' : '#fffdf5',
              boxShadow: selected ? '0 3px 0 #8b6956' : 'none',
              opacity: pressed ? 0.65 : 1,
            })}
          >
            <Text style={[boardFont(14, 1.35, '700'), { textAlign: 'center' }]}>{label}</Text>
            <Text
              style={[
                boardFont(11, 1.35, '400', '#786151', GOWUN),
                { marginTop: 3, textAlign: 'center' },
              ]}
            >
              {note}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
