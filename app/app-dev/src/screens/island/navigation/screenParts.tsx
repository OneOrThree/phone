import { C, Pic, Txt } from '@/design-system/patterns';
import { useScreenInsets } from '@/design-system/primitives';
import { t } from '@/i18n';
import { colorName, colors } from '@/services/model';
import { useAppLayout } from '@/utils/layout';
import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Keyboard, Platform, Pressable, ScrollView, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

// 서버가 준 구매 불가 사유 → 화면 문구. 모르는 코드는 일반 문구로 접는다.
export const shopBlockReason = (p: { blockedReason?: string | null; reason?: string | null }) => {
  const reason = p.blockedReason ?? p.reason;
  if (reason === 'INSUFFICIENT_FUNDS') return t('ui.misc.insufficientFish');
  if (reason === 'STATE_CONFLICT') return t('ui.misc.notForSaleYet');
  if (reason === 'FACILITY_LOCKED') return t('ui.misc.requiredBuilding');
  if (reason === 'MEMBER_ONLY' || reason === 'FORBIDDEN') return t('ui.misc.residentsOnly');
  return t('ui.misc.purchaseUnavailable');
};

// mini = 내 정보의 한 줄 3칸 정사각(그림이 칸을 채우고 이름 글자는 읽는 이름으로만, GROMO-2473), six = 가로 온보딩의 6칸 한 줄.
// v2 avgrid: 3열(세로)·6열 칸을 같은 폭으로 나눈다
export function AvatarGrid({ value, onChange, mini = false, six = false, disabled = false }: any) {
  const per = six ? 6 : 3,
    gap = mini ? 12 : six ? 8 : 10,
    size = six ? 12 : 13,
    [width, setWidth] = useState(0);
  // 가로 6칸은 칸이 좁아지면(작은 가로 폰) 그림을 칸 안쪽 폭(여백 2·테두리 2)에 맞춰 줄이고, 3칸 정사각은 칸 폭(테두리 2) 그대로다
  const avatarSize = mini
    ? width
      ? (width - gap * 2) / 3 - 4
      : 96
    : six
      ? width
        ? Math.min(54, (width - gap * 5) / 6 - 8)
        : 54
      : 64;
  return (
    <View
      style={{ gap }}
      onLayout={mini || six ? (ev) => setWidth(ev.nativeEvent.layout.width) : undefined}
    >
      {[colors.slice(0, per), colors.slice(per)]
        .filter((line) => line.length)
        .map((line, r) => (
          <View key={r} style={{ flexDirection: 'row', gap }}>
            {line.map((c) => {
              const on = c === value;
              return (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={colorName(colors.indexOf(c))}
                  accessibilityState={{ selected: on }}
                  disabled={disabled}
                  key={c}
                  onPress={() => onChange(c)}
                  style={{
                    flex: 1,
                    alignItems: 'center',
                    gap: 6,
                    paddingTop: mini ? 0 : six ? 6 : 10,
                    paddingBottom: mini ? 0 : six ? 6 : 8,
                    paddingHorizontal: mini ? 0 : six ? 2 : 6,
                    borderRadius: 18,
                    borderWidth: 2,
                    borderColor: on ? C.brown : 'transparent',
                    backgroundColor: on ? C.soft : C.paper,
                    boxShadow: on ? '0px 3px 0px ' + C.brown : 'none',
                  }}
                >
                  <Pic
                    id={'avatar/' + c}
                    w={avatarSize}
                    style={{ borderRadius: 16, backgroundColor: C.sky }}
                  />
                  {!mini && (
                    <Txt
                      style={{
                        fontSize: size,
                        lineHeight: size * 1.45,
                        fontWeight: on ? '700' : '600',
                        color: on ? C.ink : C.muted,
                      }}
                    >
                      {colorName(colors.indexOf(c))}
                    </Txt>
                  )}
                </Pressable>
              );
            })}
          </View>
        ))}
    </View>
  );
}

// v2 온보딩 글자 단계(시안 .h22 · .h17 · .meta · .sec · .row .rs · .inp). 글자 간격 -0.15px는 Txt 기본 스타일에 있다(입력칸만 따로)
export const H22 = {
  fontSize: 22,
  lineHeight: 28.6,
  fontWeight: '800',
  letterSpacing: -0.44,
} as const;

export const H17 = { fontSize: 17, lineHeight: 22.95, fontWeight: '700' } as const;

export const META = { lineHeight: 18.2 } as const;

// 한 줄 입력칸 줄 높이는 웹에서만(iOS 한 줄 TextInput은 lineHeight를 주면 글자가 아래로 밀린다). 여러 줄은 모든 플랫폼
export const INP: any = {
  letterSpacing: -0.15,
  ...(Platform.OS === 'web' ? { lineHeight: 23.2 } : null),
};

// CSS 그라데이션: 웹은 background-image, 네이티브는 experimental_backgroundImage
export const gradient = (css: string): any =>
  Platform.OS === 'web' ? { backgroundImage: css } : { experimental_backgroundImage: css };

// 가입 신청 대기 표시(시안 .spinner). 움직임 줄이기면 멈춘다
export function Spinner({ reduce }: { reduce: boolean }) {
  const turn = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduce) return;
    const loop = Animated.loop(
      Animated.timing(turn, {
        toValue: 1,
        duration: 900,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [reduce, turn]);
  return (
    <Animated.View
      style={{
        width: 22,
        height: 22,
        borderRadius: 11,
        borderWidth: 3,
        borderColor: '#EADFD2',
        borderTopColor: C.brown,
        transform: [
          { rotate: turn.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) },
        ],
      }}
    />
  );
}

// v2 온보딩 페이지: 헤더(.hdr) · 스크롤(.scroll) · 아래 고정 CTA(.ctabar, 그라데이션으로 스크롤 위에 겹침).
// 가로 폰은 왼쪽 330px 그림 칸(.lsplit .lleft) + 오른쪽 페이지(다이내믹 아일랜드 자리 56px 비움).
// 작은 가로 폰(667 폭 등)은 그림 칸을 폭의 38%로 줄이고 오른쪽 여백은 20px(안전 영역이 더 크면 그만큼)
export function Onboard({
  title,
  back,
  left,
  leftBg = C.sky,
  cta,
  hideCtaOnKeyboard = false,
  children,
}: any) {
  const layout = useAppLayout(),
    ins = useScreenInsets(),
    land = layout.compact,
    gutter = land ? 22 : 20,
    [ctaHeight, setCtaHeight] = useState(0),
    [keyboardVisible, setKeyboardVisible] = useState(false);
  useEffect(() => {
    if (!hideCtaOnKeyboard) return;
    // 키보드 애니메이션이 끝나기 전에 CTA를 제거해 첫 포커스 탭과 입력 칸을 가리지 않는다.
    const show = Keyboard.addListener('keyboardWillShow', () => setKeyboardVisible(true));
    const didShow =
      Platform.OS === 'ios'
        ? undefined
        : Keyboard.addListener('keyboardDidShow', () => setKeyboardVisible(true));
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboardVisible(false));
    return () => {
      show.remove();
      didShow?.remove();
      hide.remove();
    };
  }, [hideCtaOnKeyboard]);
  const page = (
    <View
      style={{
        flex: 1,
        marginRight: land ? Math.max(ins.right + 4, layout.width >= 800 ? 56 : 20) : 0,
        width: land ? undefined : layout.contentWidth,
        alignSelf: land ? 'stretch' : 'center',
      }}
    >
      <View
        style={{
          marginTop: land ? 0 : ins.top,
          height: land ? 48 : 52,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
          paddingLeft: 8,
          paddingRight: 12,
        }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('onboarding.back')}
          onPress={back}
          style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }}
        >
          <Svg width={22} height={22} viewBox="0 0 24 24">
            <Path
              d="M15 5l-7 7 7 7"
              stroke={C.ink}
              strokeWidth={2.4}
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </Svg>
        </Pressable>
        <Txt
          numberOfLines={1}
          style={{ flex: 1, fontSize: 20, lineHeight: 29, fontWeight: '800', letterSpacing: -0.4 }}
        >
          {title}
        </Txt>
      </View>
      <ScrollView
        style={{ flex: 1 }}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets={hideCtaOnKeyboard}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingHorizontal: gutter,
          paddingTop: land ? 6 : 16,
          paddingBottom:
            cta && !(hideCtaOnKeyboard && keyboardVisible)
              ? Math.max(land ? 92 : 120, ctaHeight)
              : land
                ? 28
                : 48,
          gap: land ? 12 : 14,
        }}
      >
        {children}
      </ScrollView>
      {cta && !(hideCtaOnKeyboard && keyboardVisible) && (
        <View
          onLayout={(ev) => setCtaHeight(ev.nativeEvent.layout.height)}
          style={[
            {
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: 0,
              paddingHorizontal: gutter,
              paddingTop: land ? 8 : 14,
              paddingBottom: land ? Math.max(22, ins.bottom + 1) : ins.bottom + 12,
              gap: 8,
            },
            gradient('linear-gradient(#FFF7EB00,#FFF7EB 32%)'),
          ]}
        >
          {cta}
        </View>
      )}
    </View>
  );
  return (
    <View style={{ flex: 1, flexDirection: land ? 'row' : 'column', backgroundColor: C.cream }}>
      {land && (
        <View
          style={{
            width: Math.min(330, layout.width * 0.38),
            borderRightWidth: 2,
            borderColor: C.brown,
            backgroundColor: leftBg,
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'hidden',
          }}
        >
          {left}
        </View>
      )}
      {page}
    </View>
  );
}

// v2 목업(build-redesign-gallery.py ICON)의 선 아이콘. 연필·보내기·체크는 24칸, 나머지는 32칸
const ICON: Record<string, string> = {
  hammer: 'M6 3L17 3L22 8L18 12L15 9L4 24L8 28L19 14L23 18L29 12L23 6',
  clock: 'M16 3a13 13 0 1 0 0 26a13 13 0 1 0 0-26ZM16 8V16L22 20',
  crown: 'M3 9L10 16L16 4L22 16L29 9L25 27H7Z',
  medal: 'M8 2L16 11L24 2M16 10a10 10 0 1 0 0 20a10 10 0 1 0 0-20Z',
  person: 'M16 16a6 6 0 1 0 0-12a6 6 0 1 0 0 12ZM5 29Q5 20 16 20Q27 20 27 29',
  group:
    'M12 15a5 5 0 1 0 0-10a5 5 0 1 0 0 10ZM3 28Q3 19 12 19Q21 19 21 28M23 5a5 5 0 0 1 0 10M24 20Q30 21 30 28',
  phone: 'M9 3h14v26H9zM13 25h6',
  pencil: 'M4 20h4l10-10-4-4L4 16zM13 7l4 4',
  send: 'M5 12h13M12 5l7 7-7 7',
  check: 'M5 12l5 5 9-10',
};

export function Icon({ name, size = 22, color = C.ink, stroke = 2.2, fill = 'none' }: any) {
  const box = ['pencil', 'send', 'check'].includes(name) ? 24 : 32;
  return (
    <Svg width={size} height={size} viewBox={`0 0 ${box} ${box}`}>
      <Path
        d={ICON[name]}
        stroke={color}
        strokeWidth={stroke}
        fill={fill}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

// 겹친 아바타(avstack): 34px, 8px씩 겹침
export function AvStack({ list }: { list: string[] }) {
  return (
    <View style={{ flexDirection: 'row' }}>
      {list.map((c, i) => (
        <Pic
          key={i}
          id={'avatar/' + c}
          w={34}
          style={{
            marginLeft: i ? -8 : 0,
            borderRadius: 10,
            borderWidth: 1.5,
            borderColor: C.brown,
            backgroundColor: C.sky,
          }}
        />
      ))}
    </View>
  );
}
