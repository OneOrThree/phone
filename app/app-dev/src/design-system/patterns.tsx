import { TextInput, Text } from '@/design-system/typography';
import React, { useRef, useState, useEffect } from 'react';
import {
  View,
  Pressable,
  Animated,
  ScrollView,
  Image,
  Switch,
  Modal,
  KeyboardAvoidingView,
  Keyboard,
  Platform,
  StyleSheet,
  PanResponder,
} from 'react-native';
import Svg, { Path, Line, Circle, Polyline } from 'react-native-svg';
import { C, useScreenInsets, MotionContext } from '@/design-system/primitives';
import { componentTokens, primitiveTokens, semanticTokens } from '@/design-system/tokens';
import { art } from '@/constants/art';
import { assets } from '@/constants/assets';
import { useAppLayout } from '@/utils/layout';
export { C, art };
export const k = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  stack: { gap: 14 },
  grow: { flex: 1 },
  meta: { fontSize: 13, lineHeight: 18, color: C.muted, letterSpacing: -0.15 },
  body: { fontSize: 15, lineHeight: 22.5, color: C.ink, letterSpacing: -0.15 },
  h: {
    fontSize: 22,
    lineHeight: 29,
    fontWeight: '800',
    letterSpacing: -0.44,
    color: C.ink,
  },
  h17: { fontSize: 17, lineHeight: 23, fontWeight: '700', letterSpacing: -0.15, color: C.ink },
  group: {
    backgroundColor: C.paper,
    borderWidth: 2,
    borderColor: C.brown,
    borderRadius: 18,
    overflow: 'hidden',
    boxShadow: '0px 4px 0px ' + C.brown,
  },
  preview: {
    backgroundColor: C.sky,
    borderWidth: 2,
    borderColor: C.brown,
    borderRadius: 22,
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
  },
  section: { fontSize: 13, fontWeight: '700', letterSpacing: 0.26, color: C.muted, marginTop: 6 },
  field: {
    minHeight: 50,
    borderWidth: 2,
    borderColor: C.brown,
    borderRadius: 14,
    backgroundColor: C.paper,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontSize: 16,
    color: C.ink,
  },
  number: {
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
    letterSpacing: -1,
    color: C.ink,
  },
});
export function Txt({ children, kind = 'body', style, ...p }: any) {
  return (
    <Text
      {...p}
      style={[
        kind === 'h'
          ? k.h
          : kind === 'h17'
            ? k.h17
            : kind === 'meta'
              ? k.meta
              : kind === 'section'
                ? k.section
                : k.body,
        style,
      ]}
    >
      {children}
    </Text>
  );
}
export function Pic({ id, w = 40, h = w, style, cover = false }: any) {
  return (
    <Image
      source={
        art[id] ||
        (id?.startsWith('cat/') ? assets[`characters/cat/${id.split('/')[1]}/idle.png`] : undefined)
      }
      resizeMode={cover ? 'cover' : 'contain'}
      style={[{ width: w, height: h }, style]}
    />
  );
}
export function Chevron({ back = false }: any) {
  return (
    <Svg width={22} height={22} viewBox="0 0 24 24">
      <Path
        d={back ? 'M15 5L8 12L15 19' : 'M9 5L16 12L9 19'}
        stroke={C.brown}
        strokeWidth={2.4}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </Svg>
  );
}
export function Btn({
  title,
  onPress,
  kind = '',
  small = false,
  round = false,
  // 확인창 버튼(.dlg .acts .btn): 높이 46 · 글자 15
  dialog = false,
  disabled = false,
  style,
  id,
}: any) {
  const reduce = React.useContext(MotionContext),
    s = useRef(new Animated.Value(1)).current;
  return (
    <Animated.View style={[{ transform: [{ scale: s }] }, style]}>
      <Pressable
        testID={id}
        accessibilityRole="button"
        accessibilityLabel={title}
        // 누를 동작이 없는 버튼(적용됨 같은 상태 표시)은 모양은 그대로 두고 비활성으로 읽는다(흐림은 disabled일 때만)
        disabled={disabled || !onPress}
        accessibilityState={{ disabled: disabled || !onPress }}
        onPress={onPress}
        onPressIn={() => {
          if (!reduce)
            Animated.spring(s, {
              toValue: 0.97,
              useNativeDriver: true,
              speed: 35,
            }).start();
        }}
        onPressOut={() => {
          if (!reduce)
            Animated.spring(s, {
              toValue: 1,
              useNativeDriver: true,
              speed: 30,
              bounciness: 3,
            }).start();
        }}
        style={{
          height: round
            ? 88
            : small
              ? 38
              : dialog
                ? 46
                : kind === 'ghost' || kind === 'danger'
                  ? 44
                  : 52,
          ...(round ? { width: 88 } : {}),
          borderRadius: 999,
          paddingHorizontal: round ? 0 : small ? 14 : kind === 'glass' ? 22 : 20,
          borderWidth: kind === 'ghost' || kind === 'danger' ? 0 : small ? 1.5 : 2,
          borderColor: kind === 'destructive' ? componentTokens.button.destructiveBorder : C.brown,
          backgroundColor: kind ? 'transparent' : componentTokens.button.background,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: disabled ? componentTokens.button.disabledOpacity : 1,
          boxShadow: kind || disabled ? 'none' : `0px ${small ? 3 : 4}px 0px ${C.brown}`,
          ...(kind === 'sec'
            ? { backgroundColor: componentTokens.button.secondaryBackground }
            : {}),
          // glass = 몰입 화면(바다·모닥불) 위 반투명 보조 버튼, destructive = 탈퇴 같은 파괴적 확인
          ...(kind === 'glass' ? { backgroundColor: componentTokens.button.glassBackground } : {}),
          ...(kind === 'destructive'
            ? { backgroundColor: componentTokens.button.destructiveBackground }
            : {}),
          // butter = 노랑 주요 버튼(방문 중 원래 섬으로). 기본 버튼과 같은 그림자를 둔다
          ...(kind === 'butter'
            ? { backgroundColor: C.butter, boxShadow: disabled ? 'none' : `0px 4px 0px ${C.brown}` }
            : {}),
        }}
      >
        <Txt
          style={{
            fontSize: round || dialog ? 15 : small ? 14 : 16,
            ...(round ? { lineHeight: 18 } : {}),
            // v2 홈 집중하기(원형)는 보통 굵기
            fontWeight: round ? '400' : kind && kind !== 'butter' ? '700' : '800',
            color:
              kind === 'danger'
                ? componentTokens.button.destructiveBorder
                : kind === 'destructive'
                  ? componentTokens.button.destructiveForeground
                  : kind === 'ghost'
                    ? C.muted
                    : C.ink,
            textAlign: 'center',
          }}
        >
          {title}
        </Txt>
      </Pressable>
    </Animated.View>
  );
}
export function Group({ children, flat = false, style }: any) {
  return (
    <View style={[k.group, flat && { boxShadow: 'none' }, style]}>
      {React.Children.toArray(children)
        .filter(Boolean)
        .map((c: any, i) => (
          <View
            key={c.key || i}
            style={
              i
                ? {
                    borderTopWidth: componentTokens.divider.width,
                    borderTopColor: componentTokens.divider.color,
                  }
                : undefined
            }
          >
            {c}
          </View>
        ))}
    </View>
  );
}
export function Row({
  title,
  sub,
  right,
  icon,
  lead,
  tail,
  onPress,
  selected = false,
  disabled = false,
  chevron = false,
  style,
  accessibilityLabel,
}: any) {
  const content = (
    <>
      <>{lead}</>
      {icon && (
        <Pic
          id={icon}
          w={40}
          style={
            icon.startsWith('avatar/')
              ? {
                  borderRadius: 14,
                  backgroundColor: C.sky,
                  borderWidth: 1.5,
                  borderColor: C.brown,
                }
              : undefined
          }
        />
      )}
      <View style={{ flex: 1, gap: 2 }}>
        <Txt style={{ fontSize: 16, fontWeight: '600', lineHeight: 21 }}>{title}</Txt>
        {!!sub && (typeof sub === 'string' ? <Txt kind="meta">{sub}</Txt> : sub)}
      </View>
      {right !== undefined &&
        (typeof right === 'string' ? (
          <Txt style={{ fontSize: 15, fontWeight: '700' }}>{right}</Txt>
        ) : (
          right
        ))}
      {tail}
      {chevron && <Chevron />}
    </>
  );
  return onPress ? (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel || title}
      accessibilityState={{ disabled, selected }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        k.row,
        {
          minHeight: 58,
          paddingVertical: 11,
          paddingHorizontal: 14,
          backgroundColor: selected ? C.soft : undefined,
          opacity: disabled ? 0.42 : pressed ? 0.7 : 1,
        },
        style,
      ]}
    >
      {content}
    </Pressable>
  ) : (
    <View
      style={[
        k.row,
        {
          minHeight: 58,
          paddingVertical: 11,
          paddingHorizontal: 14,
          backgroundColor: selected ? C.soft : undefined,
          opacity: disabled ? 0.42 : 1,
        },
        style,
      ]}
    >
      {content}
    </View>
  );
}
export function Seg({ items, value, onChange, small = false, style }: any) {
  return (
    <View
      style={[
        {
          flexDirection: 'row',
          height: small ? 36 : 42,
          borderWidth: 2,
          borderColor: C.brown,
          borderRadius: 12,
          overflow: 'hidden',
          backgroundColor: C.paper,
        },
        style,
      ]}
    >
      {items.map((x: string, i: number) => (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={x}
          accessibilityState={{ selected: x === value }}
          key={x}
          onPress={() => onChange(x)}
          style={{
            flex: 1,
            alignItems: 'center',
            justifyContent: 'center',
            borderLeftWidth: i ? 2 : 0,
            borderColor: C.brown,
            backgroundColor: x === value ? C.pink : undefined,
          }}
        >
          <Txt
            style={{
              fontSize: small ? 13 : 14,
              fontWeight: '700',
              color: x === value ? C.ink : C.muted,
            }}
          >
            {x}
          </Txt>
        </Pressable>
      ))}
    </View>
  );
}
export function Chips({ items, value, onChange, large = false, wrap = false }: any) {
  return (
    <View
      style={{
        flexDirection: 'row',
        gap: 8,
        flexWrap: wrap ? 'wrap' : 'nowrap',
      }}
    >
      {items.map((x: string) => (
        <Pressable
          key={x}
          accessibilityRole="button"
          accessibilityLabel={x}
          accessibilityState={{ selected: x === value }}
          onPress={() => onChange(x)}
          style={{
            height: large ? 44 : 36,
            paddingHorizontal: large ? 18 : 14,
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 999,
            borderWidth: 1.5,
            borderColor: x === value ? C.brown : primitiveTokens.color.controlIdle,
            backgroundColor: x === value ? C.soft : C.paper,
          }}
        >
          <Txt
            style={{
              fontSize: large ? 15 : 13,
              fontWeight: x === value ? '700' : '600',
              color: x === value ? C.ink : C.muted,
            }}
          >
            {x}
          </Txt>
        </Pressable>
      ))}
    </View>
  );
}
export function Field({
  label,
  value,
  onChange,
  placeholder,
  multiline = false,
  numeric = false,
  inputStyle,
  placeholderColor,
  tabletScale,
}: any) {
  return (
    <View style={{ gap: 6 }}>
      {label && (
        // v2 .field label: 13px · 줄 높이 1.45
        <Txt kind="meta" style={{ fontWeight: '600', lineHeight: 18.85 }}>
          {label}
        </Txt>
      )}
      <TextInput
        tabletScale={tabletScale}
        testID={'field-' + (label || placeholder)}
        accessibilityLabel={label || placeholder}
        value={String(value ?? '')}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={placeholderColor || componentTokens.input.placeholder}
        multiline={multiline}
        returnKeyType={multiline ? 'default' : 'done'}
        blurOnSubmit={!multiline}
        onSubmitEditing={() => !multiline && Keyboard.dismiss()}
        keyboardType={numeric ? 'numeric' : 'default'}
        style={[k.field, multiline && { minHeight: 96, textAlignVertical: 'top' }, inputStyle]}
      />
    </View>
  );
}
export function Toggle({ value, onChange, label }: any) {
  // v2 .tog: 폭 46 · 켜지면 손잡이 18px 이동
  const x = useRef(new Animated.Value(value ? 18 : 0)).current;
  const reduce = React.useContext(MotionContext);
  useEffect(() => {
    Animated.timing(x, {
      toValue: value ? 18 : 0,
      duration: reduce ? 0 : 140,
      useNativeDriver: true,
    }).start();
  }, [value, reduce]);
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: value }}
      onPress={() => onChange(!value)}
      hitSlop={8}
      style={{
        width: 46,
        height: 28,
        borderRadius: 999,
        backgroundColor: value ? primitiveTokens.color.success : primitiveTokens.color.controlIdle,
      }}
    >
      <Animated.View
        style={{
          position: 'absolute',
          left: 3,
          top: 3,
          width: 22,
          height: 22,
          borderRadius: 11,
          backgroundColor: primitiveTokens.color.white,
          boxShadow: `0px 1px 2px ${primitiveTokens.color.black}33`,
          transform: [{ translateX: x }],
        }}
      />
    </Pressable>
  );
}
export function Bar({ value }: any) {
  return (
    <View
      style={{
        height: 6,
        backgroundColor: componentTokens.progress.track,
        borderRadius: 3,
        overflow: 'hidden',
        marginTop: 4,
      }}
    >
      <View
        style={{
          height: 6,
          width: `${Math.max(0, Math.min(100, value || 0))}%`,
          backgroundColor: C.pink,
          borderRadius: 3,
        }}
      />
    </View>
  );
}
export function Badge({ children, soft = false }: any) {
  return (
    <View
      style={{
        alignSelf: 'flex-start',
        height: 28,
        paddingHorizontal: 12,
        borderRadius: componentTokens.badge.radius,
        borderWidth: componentTokens.badge.borderWidth,
        borderColor: soft
          ? componentTokens.badge.soft.border
          : componentTokens.badge.default.border,
        backgroundColor: soft
          ? componentTokens.badge.soft.background
          : componentTokens.badge.default.background,
        justifyContent: 'center',
      }}
    >
      {/* v2 .badge.soft: 보통 굵기 · 옅은 글자 */}
      <Txt
        style={{
          fontSize: 13,
          lineHeight: 18.85,
          fontWeight: soft ? '600' : '700',
          color: soft
            ? componentTokens.badge.soft.foreground
            : componentTokens.badge.default.foreground,
        }}
      >
        {children}
      </Txt>
    </View>
  );
}
export function Strip({ label, value }: any) {
  return (
    <View
      style={[
        k.row,
        {
          justifyContent: 'space-between',
          paddingVertical: 10,
          paddingHorizontal: 14,
          // v2 .strip 바탕(#FFF3CF)
          backgroundColor: '#FFF3CF',
          borderWidth: 1.5,
          borderColor: primitiveTokens.color.letterBorder,
          borderRadius: 14,
        },
      ]}
    >
      <Txt kind="meta" style={{ lineHeight: 18.85 }}>
        {label}
      </Txt>
      <Txt
        style={{ fontSize: 18, lineHeight: 26.1, fontWeight: '800', fontVariant: ['tabular-nums'] }}
      >
        {value}
      </Txt>
    </View>
  );
}
// 헤더 톱니(섬 관리) 아이콘. Page와 IslandSheet가 같이 쓴다
export function Gear() {
  return (
    <Svg width={24} height={24} viewBox="0 0 24 24">
      <Circle cx={12} cy={12} r={3.2} stroke={C.ink} strokeWidth={2} fill="none" />
      <Path
        d="M19 9l2-1-2-3-2 1-3-2V2h-4v2L7 6 5 5 3 8l2 1v5l-2 1 2 3 2-1 3 2v3h4v-3l3-2 2 1 2-3-2-1z"
        stroke={C.ink}
        strokeWidth={1.8}
        strokeLinejoin="round"
        fill="none"
      />
    </Svg>
  );
}
export function Page({
  title,
  icon,
  back,
  action,
  actionPress,
  children,
  footer,
  scrollRef,
  contentStyle,
  width,
}: any) {
  const ins = useScreenInsets();
  const layout = useAppLayout();
  // width: 가로 온보딩 좌우 분할의 오른쪽 칸처럼 화면보다 좁은 자리에 놓을 때
  const w = width ?? layout.contentWidth;
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: C.cream,
        paddingTop: ins.top,
        alignItems: 'center',
      }}
    >
      <View
        style={{
          height: 52,
          width: w,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
          paddingLeft: 8,
          paddingRight: 12,
        }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="뒤로"
          onPress={back}
          style={{
            width: semanticTokens.size.tapMin,
            height: semanticTokens.size.tapMin,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Chevron back />
        </Pressable>
        {icon && <Pic id={icon} w={30} />}
        <Txt
          style={{
            flex: 1,
            fontSize: 20,
            fontWeight: '800',
            letterSpacing: -0.4,
          }}
          numberOfLines={1}
        >
          {title}
        </Txt>
        {action && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={action === '⚙' ? '섬 관리' : action}
            onPress={actionPress}
            style={{ padding: 8 }}
          >
            {action === '⚙' ? (
              <Gear />
            ) : (
              <Txt style={{ fontSize: 15, fontWeight: '700' }}>{action}</Txt>
            )}
          </Pressable>
        )}
      </View>
      <ScrollView
        style={{ width: w, flex: 1 }}
        ref={scrollRef}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[
          {
            paddingHorizontal: 20,
            paddingTop: layout.compact ? 8 : 16,
            paddingBottom: footer ? 20 : ins.bottom + 16,
            gap: 14,
          },
          contentStyle,
        ]}
      >
        {children}
      </ScrollView>
      {footer && (
        <View
          style={{
            paddingHorizontal: 20,
            paddingTop: layout.compact ? 8 : 14,
            width: w,
            paddingBottom: ins.bottom + 12,
            gap: 8,
            backgroundColor: C.cream,
          }}
        >
          {footer}
        </View>
      )}
    </View>
  );
}
export function Overlay({ children, close, sheet = false, background }: any) {
  const ins = useScreenInsets();
  const layout = useAppLayout();
  const [availableHeight, setAvailableHeight] = useState(layout.height);
  const centered = !sheet || layout.tablet || layout.compact;
  return (
    <View
      style={StyleSheet.absoluteFill}
      onLayout={(e) => setAvailableHeight(e.nativeEvent.layout.height)}
    >
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        aria-hidden={true}
        style={{ flex: 1 }}
      >
        {background}
      </View>
      <View
        style={{
          position: 'absolute',
          inset: 0,
          backgroundColor: sheet
            ? componentTokens.overlay.sheetBackground
            : componentTokens.overlay.background,
          justifyContent: centered ? 'center' : 'flex-end',
          alignItems: 'center',
          paddingTop: ins.top + (centered ? 12 : 0),
          paddingBottom: centered ? ins.bottom + 12 : 0,
        }}
      >
        <Pressable
          accessible={false}
          importantForAccessibility="no-hide-descendants"
          onPress={close}
          style={{ position: 'absolute', inset: 0 }}
        />
        <KeyboardAvoidingView
          behavior={undefined}
          style={{
            width: centered ? layout.modalWidth : '100%',
            maxHeight: Math.max(100, availableHeight - ins.top - ins.bottom - 24),
            flexShrink: 1,
          }}
        >
          <ScrollView
            keyboardShouldPersistTaps="handled"
            nestedScrollEnabled
            showsVerticalScrollIndicator={false}
            style={{
              backgroundColor: C.paper,
              borderWidth: 2,
              borderColor: C.brown,
              borderRadius: sheet ? 26 : 24,
              borderBottomLeftRadius: centered ? 24 : 0,
              borderBottomRightRadius: centered ? 24 : 0,
              flexShrink: 1,
            }}
            contentContainerStyle={{
              padding: 20,
              paddingBottom: !centered ? ins.bottom + 12 : 18,
              gap: 14,
              boxShadow: sheet ? 'none' : '0px 6px 0px ' + C.brown,
            }}
          >
            {sheet && (
              <View
                style={{
                  width: 40,
                  height: 5,
                  borderRadius: 3,
                  backgroundColor: primitiveTokens.color.controlIdle,
                  alignSelf: 'center',
                }}
              />
            )}
            {children}
          </ScrollView>
        </KeyboardAvoidingView>
      </View>
    </View>
  );
}
// label을 비우면 드럼 위 글자를 숨긴다(바깥에 필드 라벨이 있을 때). a11yLabel은 항목 읽기용 이름
export function Wheel({
  label,
  items,
  value,
  onChange,
  a11yLabel,
  // row = 한 칸 높이. v2 가로 폰은 좌우 분할 24(드럼 72) · 사이드 패널 33(드럼 100)
  row = 44,
}: any) {
  const [onSize, offSize] = row >= 44 ? [20, 17] : row >= 33 ? [17, 15] : [15, 13];
  const ref = useRef<ScrollView>(null),
    selected = Math.max(0, items.indexOf(value));
  useEffect(() => {
    requestAnimationFrame(() => ref.current?.scrollTo({ y: selected * row, animated: false }));
  }, []);
  return (
    <View style={{ flex: 1, gap: 4 }}>
      {!!label && (
        <Txt kind="meta" style={{ fontSize: 12, textAlign: 'center', fontWeight: '600' }}>
          {label}
        </Txt>
      )}
      <View
        style={{
          height: row * 3,
          borderWidth: 2,
          borderColor: C.brown,
          borderRadius: 14,
          backgroundColor: C.paper,
          overflow: 'hidden',
        }}
      >
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            top: row,
            height: row,
            left: 0,
            right: 0,
            backgroundColor: C.soft,
            borderTopWidth: 1.5,
            borderBottomWidth: 1.5,
            borderColor: `${C.brown}55`,
          }}
        />
        <ScrollView
          ref={ref}
          snapToInterval={row}
          decelerationRate="fast"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingVertical: row }}
          onMomentumScrollEnd={(e) =>
            onChange(
              items[
                Math.max(
                  0,
                  Math.min(items.length - 1, Math.round(e.nativeEvent.contentOffset.y / row)),
                )
              ],
            )
          }
        >
          {items.map((x: string, i: number) => (
            <Pressable
              key={i}
              accessibilityRole="button"
              accessibilityLabel={`${a11yLabel ?? label} ${x}`}
              onPress={() => {
                onChange(x);
                ref.current?.scrollTo({ y: i * row, animated: true });
              }}
              style={{
                height: row,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Txt
                style={{
                  fontSize: x === value ? onSize : offSize,
                  fontWeight: x === value ? '800' : '400',
                  color: x === value ? C.ink : componentTokens.input.placeholder,
                }}
              >
                {x}
              </Txt>
            </Pressable>
          ))}
        </ScrollView>
      </View>
    </View>
  );
}
export function Graph({ values, label }: any) {
  const max = Math.max(...values, 1),
    pts = values.map((v: number, i: number) => [
      14 + (i * 334) / (values.length - 1),
      20 + (1 - v / max) * 76,
    ]);
  return (
    <View style={{ gap: 4 }}>
      <Svg width="100%" height={110} viewBox="0 0 362 110">
        {[20, 58, 96].map((y) => (
          <Line key={y} x1={0} x2={362} y1={y} y2={y} stroke={`${C.brown}22`} />
        ))}
        <Path
          d={`M${pts[0][0]} 110 ${pts.map((p: any) => `L${p[0]} ${p[1]}`).join(' ')} L348 110Z`}
          fill={`${C.sky}66`}
        />
        <Polyline
          points={pts.map((p: any) => p.join(',')).join(' ')}
          fill="none"
          stroke={primitiveTokens.color.graphLine}
          strokeWidth={2.5}
        />
        {pts.map((p: any, i: number) => (
          <Circle
            key={i}
            cx={p[0]}
            cy={p[1]}
            r={i === 6 ? 6 : 3.5}
            fill={i === 6 ? C.pink : C.paper}
            stroke={C.brown}
            strokeWidth={1.5}
          />
        ))}
      </Svg>
      <View style={{ flexDirection: 'row' }}>
        {['월', '화', '수', '목', '금', '토', '일'].map((x, i) => (
          <Txt key={i} kind="meta" style={{ flex: 1, textAlign: 'center', fontSize: 12 }}>
            {x}
          </Txt>
        ))}
      </View>
    </View>
  );
}
