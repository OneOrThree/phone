// v2 · 섬 위 게임 시트 공통 컴포넌트
// 건물 기능은 새 화면으로 넘어가지 않고, 그 건물로 다가간 섬 배경 위에 시트·팝업으로 뜬다.
// 수치는 tools/build-redesign-gallery-v2.py(V2_CSS)와 tools/redesign-landscape.py(L_CSS)의
// 402×874(세로) / 874×402(가로) 기준값을 그대로 옮겼다.
import React, { useEffect, useState, Ref } from 'react';
import {
  View,
  Pressable,
  ScrollView,
  Image,
  StyleSheet,
  ViewStyle,
  ImageStyle,
  TextStyle,
  StyleProp,
  Platform,
  AccessibilityInfo,
} from 'react-native';
import Svg, { Path, Circle } from 'react-native-svg';
import { C, art, k, Txt, Pic, Btn, Gear, NavBtn } from '@/design-system/patterns';
import { TextInput } from '@/design-system/typography';
import { componentTokens, semanticTokens } from '@/design-system/tokens';
import { CatAvatar } from '@/components/CatAvatar';
import type { Outfit } from '@/components/CatOutfitLayers';
import { useAppLayout } from '@/utils/layout';
import { t } from '@/i18n';
import { seaAssets } from '@/screens/sea/seaAssets';

// 꽉 채우는 그림. 웹(react-native-web)은 absoluteFill만 주면 원본 픽셀 크기로 그려서 폭·높이를 같이 준다
const fill: ImageStyle = { position: 'absolute', left: 0, top: 0, width: '100%', height: '100%' };

const ISLAND_SHEET_RADIUS = 30;
const ISLAND_SHEET_BORDER_WIDTH = 2;
const ISLAND_SHEET_CONTENT_RADIUS = ISLAND_SHEET_RADIUS - ISLAND_SHEET_BORDER_WIDTH;

export type IslandBgKey =
  'hall' | 'board' | 'tower' | 'mail' | 'shop' | 'dock' | 'gram' | 'fire' | 'library' | 'sea';

// 건물로 다가간 섬 배경(가로 화면이면 가로용) + 옅은 스크림. 스크림을 누르면 닫힌다
function Backdrop({ bg, onClose }: { bg?: IslandBgKey; onClose: () => void }) {
  const { landscape } = useAppLayout();
  return (
    <>
      {bg && (
        <Image
          testID="island-sheet-backdrop"
          source={
            bg === 'sea' ? seaAssets.background : art[(landscape ? 'L/bldbg/' : 'bldbg/') + bg]
          }
          resizeMode="cover"
          style={fill}
        />
      )}
      <Pressable
        accessible={false}
        importantForAccessibility="no-hide-descendants"
        onPress={onClose}
        style={[StyleSheet.absoluteFill, { backgroundColor: '#493B3938' }]}
      />
    </>
  );
}

// 간판·헤더·스크롤 수치. sheet = 세로 .gsheet(태블릿 카드도 같이), panel = 가로 폰 .lpanel
const GEO = {
  sheet: {
    sign: { size: 92, left: 18, top: -36 },
    img: { '': 72, npc: 86, av: 66 },
    npcTop: 8,
    head: { left: 120, right: 12, top: 14, height: 52 },
    body: 72,
    padTop: 10,
    padX: 20,
    gap: 14,
  },
  panel: {
    sign: { size: 76, left: -62, top: 14 },
    img: { '': 58, npc: 70, av: 52 },
    npcTop: 6,
    head: { left: 26, right: 14, top: 10, height: 46 },
    body: 64,
    padTop: 6,
    padX: 22,
    gap: 12,
  },
};

// fit 시트가 내용 높이를 기다리는 최대 시간
export const FIT_REVEAL_FALLBACK_MS = 300;
export function IslandSheet({
  bg,
  sign,
  signKind = '',
  title,
  tall = false,
  tight = false,
  onBack,
  action,
  actionPress,
  onClose,
  footer,
  toast,
  scrollRef,
  onScroll,
  keepOnBackdrop = false,
  fit = false,
  children,
}: {
  // 없으면 건물 배경을 깔지 않는다 — 부르는 쪽이 섬 홈을 뒤에 깐다(채팅방)
  bg?: IslandBgKey;
  sign: string;
  // island = 섬 그림을 원 안에 꽉 채운다(cover). 그 밖은 원 안에 그림을 그대로(contain)
  signKind?: '' | 'npc' | 'av' | 'island';
  title: string;
  tall?: boolean;
  // 시안 .scroll.tight: 세로 시트 안 간격 10(가로 패널은 원래 12)
  tight?: boolean;
  onBack?: () => void;
  action?: string;
  actionPress?: () => void;
  onClose: () => void;
  footer?: React.ReactNode;
  // 시트 위 한 줄 알림(.toast). 주 버튼 + 고스트 버튼 CTA 바로 위에 뜬다
  toast?: string;
  // 편지방처럼 새 글을 보낸 뒤 아래로 스크롤해야 할 때
  scrollRef?: Ref<ScrollView>;
  onScroll?: React.ComponentProps<typeof ScrollView>['onScroll'];
  // 글을 쓰는 시트는 바깥(스크림)을 눌러도 닫지 않는다. 작성 중인 글 보호용, × 닫기는 그대로
  keepOnBackdrop?: boolean;
  // 세로 폰 아래 시트를 내용 높이까지만 올린다(내용이 길면 tall 과 같다). 짧은 상세의 설명~아래 버튼 사이 빈 공간을 없앤다(GROMO-2412)
  fit?: boolean;
  children?: React.ReactNode;
}) {
  const L = useAppLayout();
  const ins = L.insets;
  const panel = L.compact;
  const g = GEO[panel ? 'panel' : 'sheet'];
  const top = panel ? ins.top : 0;
  // 알림(.toast)은 아래 버튼 줄 바로 위에 뜬다(세로 48 · 가로 14 간격)
  const [footH, setFootH] = useState(0);
  const [contentH, setContentH] = useState(0);
  const hasFooter = !!footer;
  // 버튼 줄이 빠지면 잰 높이도 버린다 — 다시 붙으면(로딩 → 상품 상세) 새로 잴 때까지 «아직 못 잼»이다
  useEffect(() => {
    if (!hasFooter) setFootH(0);
  }, [hasFooter]);
  // fit: 내용·버튼 줄 높이를 다 잰 동안만 그 높이로 자리를 잡는다(위 여백 + 위 테두리 2 + 내용 + 버튼 줄)
  const fitTop =
    fit && contentH > 0 && (!hasFooter || footH > 0)
      ? Math.max(100, L.height - (g.body + 2 + contentH + (hasFooter ? footH : 0)))
      : null;
  // 마지막으로 보인 자리 — 한 번 보인 뒤 다시 재는 동안은 숨기지 않고 이 자리에 둔 채 다 재면 높이만 바꾼다
  const [shownTop, setShownTop] = useState<number | null>(null);
  useEffect(() => {
    if (fitTop != null) setShownTop(fitTop);
  }, [fitTop]);
  // 재는 주기마다 안전장치 — FIT_REVEAL_FALLBACK_MS 안에 못 재면 tall 높이로 보인다. 다 재면 타이머를 끄고 초기화한다
  const fitMeasuring = fit && fitTop == null;
  const [fitGaveUp, setFitGaveUp] = useState(false);
  useEffect(() => {
    if (!fitMeasuring) {
      setFitGaveUp(false);
      return;
    }
    const timer = setTimeout(() => setFitGaveUp(true), FIT_REVEAL_FALLBACK_MS);
    return () => clearTimeout(timer);
  }, [fitMeasuring]);
  // 처음 다 재기 전에는 숨긴다(높은 시트가 번쩍였다 줄어들지 않게)
  const sheetTop = fit ? (fitTop ?? (fitGaveUp ? 100 : (shownTop ?? 100))) : tall ? 100 : 210;
  const sheetHidden = fit && fitTop == null && shownTop == null && !fitGaveUp;
  const endPad = panel ? Math.max(22, ins.bottom) : L.tablet ? 18 : ins.bottom + 12;
  const cardH = Math.min(
    L.height * (tall || fit ? 0.9 : 0.76),
    L.height - ins.top - ins.bottom - 72,
  );
  // 가로 폰은 오른쪽 안전영역까지 패널이 덮고, 내용은 그만큼 안쪽으로(iOS 가로 인셋은 좌우 대칭)
  const right = panel ? ins.right : 0;
  // 상자: 세로 폰 = 아래 시트(76% top 210 / 90% top 100), 가로 폰 = 오른쪽 540 패널, 태블릿 = 가운데 카드
  const box: ViewStyle = panel
    ? {
        top: 0,
        bottom: 0,
        right: 0,
        width: Math.min(540 + right, L.width - ins.left - 80),
        borderLeftWidth: ISLAND_SHEET_BORDER_WIDTH,
        borderTopLeftRadius: ISLAND_SHEET_RADIUS,
        borderBottomLeftRadius: ISLAND_SHEET_RADIUS,
        boxShadow: '-5px 0px 0px #8B695640',
      }
    : L.tablet
      ? {
          width: L.modalWidth,
          height: cardH,
          left: (L.width - L.modalWidth) / 2,
          top: (L.height - cardH) / 2 + 18,
          borderWidth: ISLAND_SHEET_BORDER_WIDTH,
          borderRadius: ISLAND_SHEET_RADIUS,
          boxShadow: `0px 6px 0px ${C.brown}`,
        }
      : {
          left: 0,
          right: 0,
          bottom: 0,
          top: sheetTop,
          opacity: sheetHidden ? 0 : 1,
          borderTopWidth: 2,
          borderTopLeftRadius: 30,
          borderTopRightRadius: 30,
          boxShadow: '0px -5px 0px #8B695640',
        };
  return (
    <View style={StyleSheet.absoluteFill}>
      <Backdrop bg={bg} onClose={keepOnBackdrop ? () => {} : onClose} />
      {/* 키보드는 App 최상단 KeyboardAvoidingView가 루트를 줄여 주므로 시트도 따라 줄어든다 */}
      <View
        testID="island-sheet-box"
        style={[
          {
            position: 'absolute',
            backgroundColor: C.cream,
            borderColor: C.brown,
            paddingTop: g.body + top,
          },
          box,
        ]}
      >
        {/* 시트 위 손잡이 막대는 두지 않는다(GROMO-2473) — 끌어 닫는 동작이 없어 눌리는 것처럼만 보였다 */}
        <View
          style={{
            position: 'absolute',
            left: g.sign.left,
            top: g.sign.top,
            width: g.sign.size,
            height: g.sign.size,
            borderRadius: g.sign.size / 2,
            backgroundColor: C.paper,
            borderWidth: 2,
            borderColor: C.brown,
            boxShadow: `0px 4px 0px ${C.brown}`,
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'hidden',
          }}
        >
          <Pic
            id={sign}
            w={signKind === 'island' ? '100%' : g.img[signKind]}
            h={signKind === 'island' ? '100%' : undefined}
            cover={signKind === 'island'}
            style={
              signKind === 'npc'
                ? { marginTop: g.npcTop }
                : signKind === 'av'
                  ? { borderRadius: 16 }
                  : undefined
            }
          />
        </View>
        <View
          style={{
            position: 'absolute',
            left: g.head.left,
            right: g.head.right + right,
            top: g.head.top + top,
            height: g.head.height,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
          }}
        >
          {/* 뒤로 ‹·닫기 × 는 공용 NavBtn(DESIGN §7.14). 뒤로는 한 단계 위, 닫기는 시트를 접고 섬으로 */}
          {onBack && (
            <NavBtn label={t('common.back')} onPress={onBack} style={{ marginLeft: -10 }} />
          )}
          <Txt
            accessibilityRole="header"
            numberOfLines={1}
            style={{
              // 액션이 있으면 제목이 제 폭을 먼저 갖고 액션이 남은 폭에서 줄을 바꾼다 — 360dp·글자 1.3배에서
              // 「구매 내역」에 밀려 「강아지 …」로 잘렸다(GROMO-2888). 제목이 아주 길면 제목만 줄어 말줄임한다
              ...(action ? { flexShrink: 1 } : { flex: 1 }),
              fontSize: 19,
              lineHeight: 26,
              fontWeight: '800',
              letterSpacing: -0.38,
            }}
          >
            {title}
          </Txt>
          {!!action && (
            <View style={{ flex: 1, minWidth: semanticTokens.size.tapMin, alignItems: 'flex-end' }}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={action === '⚙' ? t('common.manageIsland') : action}
                onPress={actionPress}
                // 뒤로·닫기 NavBtn 과 같은 44 상자 — 보이는 아이콘·글자는 가운데에 그대로 둔다
                style={{
                  minWidth: semanticTokens.size.tapMin,
                  minHeight: semanticTokens.size.tapMin,
                  alignItems: 'center',
                  justifyContent: 'center',
                  paddingHorizontal: 4,
                }}
              >
                {action === '⚙' ? (
                  <Gear />
                ) : (
                  <Txt style={{ fontSize: 14, lineHeight: 20, fontWeight: '700' }}>{action}</Txt>
                )}
              </Pressable>
            </View>
          )}
          <NavBtn close label={t('common.close')} onPress={onClose} />
        </View>
        <View
          testID="island-sheet-content-clip"
          style={{
            flex: 1,
            overflow: 'hidden',
            borderBottomLeftRadius: panel || L.tablet ? ISLAND_SHEET_CONTENT_RADIUS : 0,
            borderBottomRightRadius: L.tablet ? ISLAND_SHEET_CONTENT_RADIUS : 0,
          }}
        >
          <ScrollView
            ref={scrollRef}
            testID="island-sheet-scroll"
            onScroll={onScroll}
            onContentSizeChange={fit ? (_, h) => setContentH(h) : undefined}
            scrollEventThrottle={16}
            style={{ flex: 1 }}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{
              gap: tight && !panel ? 10 : g.gap,
              paddingTop: g.padTop,
              paddingLeft: g.padX,
              paddingRight: g.padX + right,
              paddingBottom: footer ? 12 : endPad,
            }}
          >
            {children}
          </ScrollView>
          {!!footer && (
            <View
              testID="island-sheet-footer"
              onLayout={(e) => setFootH(e.nativeEvent.layout.height)}
              style={{
                gap: 8,
                paddingTop: panel ? 8 : 10,
                paddingLeft: g.padX,
                paddingRight: g.padX + right,
                paddingBottom: endPad,
              }}
            >
              {footer}
            </View>
          )}
        </View>
        {/* 가로 패널·태블릿 카드에서는 상자 안(.lpanel .toast) */}
        {!!toast && (panel || L.tablet) && (
          <SheetToast text={toast} bottom={(footer ? footH : 0) + 14} right={right} />
        )}
      </View>
      {!!toast && !panel && !L.tablet && (
        <SheetToast text={toast} bottom={(footer ? footH : 0) + 48} />
      )}
    </View>
  );
}

// 시트 위 한 줄 알림. 안드로이드는 live region, iOS는 직접 읽어 준다
function SheetToast({ text, bottom, right = 0 }: { text: string; bottom: number; right?: number }) {
  useEffect(() => {
    if (Platform.OS === 'ios') AccessibilityInfo.announceForAccessibility(text);
  }, [text]);
  return (
    <View
      pointerEvents="none"
      accessibilityLiveRegion="polite"
      style={{
        position: 'absolute',
        left: 24,
        right: 24 + right,
        bottom,
        backgroundColor: C.ink,
        borderRadius: 16,
        paddingVertical: 14,
        paddingHorizontal: 16,
      }}
    >
      <Txt
        style={{
          fontSize: 14,
          lineHeight: 20.3,
          fontWeight: '600',
          color: C.paper,
          textAlign: 'center',
        }}
      >
        {text}
      </Txt>
    </View>
  );
}

// 섬 위 작은 팝업(.gpop). 가로 폰에서는 children | side 를 2단(.land .gpop)으로 눕힌다.
// 표현만 한다 — 열려 있는 동안 모달이라는 것은 iOS accessibilityViewIsModal 로만 알린다(VoiceOver 가 형제 장면을 무시).
// 안드로이드 뒤로 가기와 Android 스크린리더용 뒤 장면 숨김(importantForAccessibility="no-hide-descendants")은 호출자 몫이다:
// 뒤로 가기는 e.backOverride 로 팝업 닫기를 걸고(App 의 뒤로 가기 핸들러가 방문 분기보다 먼저 본다), 형제를 가릴 수 없는
// 팝업 대신 뒤 장면을 감싼 쪽이 숨긴다.
export function IslandPopup({
  bg,
  onClose,
  side,
  children,
}: {
  bg?: IslandBgKey;
  onClose: () => void;
  side?: React.ReactNode;
  children?: React.ReactNode;
}) {
  const L = useAppLayout();
  const ins = L.insets;
  const two = L.compact;
  const col: ViewStyle = { flex: 1, gap: 10, minWidth: 0 };
  return (
    <View style={StyleSheet.absoluteFill} accessibilityViewIsModal>
      <Backdrop bg={bg} onClose={onClose} />
      <View
        style={[
          StyleSheet.absoluteFill,
          { alignItems: 'center', justifyContent: 'center', pointerEvents: 'box-none' },
        ]}
      >
        <View
          style={{
            width: two ? L.width - 220 : L.tablet ? L.modalWidth : L.width - 44,
            maxHeight: L.height - ins.top - ins.bottom - 24,
            backgroundColor: C.cream,
            borderWidth: 2,
            borderColor: C.brown,
            borderRadius: 26,
            boxShadow: `0px 6px 0px ${C.brown}`,
          }}
        >
          <NavBtn
            close
            label={t('common.close')}
            onPress={onClose}
            style={{ position: 'absolute', right: 9, top: 9, zIndex: 1 }}
          />
          <ScrollView
            style={{ flexGrow: 0, flexShrink: 1 }}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={
              two
                ? {
                    flexDirection: 'row',
                    gap: 18,
                    paddingTop: 18,
                    paddingHorizontal: 20,
                    paddingBottom: 16,
                  }
                : { gap: 12, paddingTop: 20, paddingHorizontal: 20, paddingBottom: 18 }
            }
          >
            {two ? (
              <>
                <View style={col}>{children}</View>
                {!!side && <View style={col}>{side}</View>}
              </>
            ) : (
              <>
                {children}
                {side}
              </>
            )}
          </ScrollView>
        </View>
      </View>
    </View>
  );
}

// ───────── 시트 안 공통 조각 ─────────
// 시안 SCREEN_CSS(build-redesign-gallery.py)의 .row · .lg · .sec · .pv · .strip · .prod · .btn 수치를 그대로 옮겼다.
// 글자 간격 -0.15px는 Txt 기본 스타일에 이미 있다
export const st = {
  h22: { fontSize: 22, lineHeight: 28.6, fontWeight: '800', letterSpacing: -0.44 },
  h17: { fontSize: 17, lineHeight: 22.95, fontWeight: '700' },
  body: { lineHeight: 22.5, color: C.muted },
  meta: { lineHeight: 18.2 },
  sec: { lineHeight: 18.85 },
} as const;

// 행 오른쪽 꺾쇠(.chev 18px)
export function SheetChev() {
  return (
    <Svg width={18} height={18} viewBox="0 0 24 24">
      <Path
        d="M9 6l6 6-6 6"
        stroke={C.brown}
        strokeWidth={2.4}
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

// 행 앞 선 아이콘(.ric): 친구(group 20px) · 톱니(24px)
const RIC: Record<string, [number, number, string]> = {
  group: [
    20,
    32,
    'M12 15a5 5 0 1 0 0-10a5 5 0 1 0 0 10ZM3 28Q3 19 12 19Q21 19 21 28M23 5a5 5 0 0 1 0 10M24 20Q30 21 30 28',
  ],
  gear: [
    24,
    24,
    'M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  ],
};
export function RowIcon({ name }: { name: 'group' | 'gear' }) {
  const [size, box, d] = RIC[name];
  return (
    <View style={{ width: 28, height: 28, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} viewBox={`0 0 ${box} ${box}`}>
        {name === 'gear' && (
          <Circle cx={12} cy={12} r={3.2} stroke={C.ink} strokeWidth={2} fill="none" />
        )}
        <Path
          d={d}
          stroke={C.ink}
          strokeWidth={name === 'gear' ? 2 : 2.2}
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </Svg>
    </View>
  );
}

// 아바타 그림(.av): 하늘색 바탕 · 갈색 테두리
export function Avatar({
  color,
  userId,
  outfit,
  size = 40,
  radius = 14,
}: {
  color: string | null | undefined;
  userId?: string | null;
  outfit?: Outfit | null;
  size?: number;
  radius?: number;
}) {
  return (
    <View
      style={{
        borderRadius: radius,
        backgroundColor: C.sky,
        borderWidth: 1.5,
        borderColor: C.brown,
      }}
    >
      <CatAvatar userId={userId} color={color} outfit={outfit} size={size - 3} />
    </View>
  );
}

// SheetRow 의 `below` 줄 — 본문 칸 안 sub 아래에 왼쪽 정렬
const rowBelow: ViewStyle = { alignItems: 'flex-start', marginTop: 4 };

// 리스트 행(.row). tone = on(분홍) · butter(노랑). dense = 가로 축음기 시트의 낮은 행
export function SheetRow({
  title,
  sub,
  right,
  lead,
  tail,
  below,
  chevron = false,
  onPress,
  tone,
  dense = false,
  divider = false,
  disabled = false,
  label,
  selected,
}: {
  title: string;
  sub?: string;
  right?: React.ReactNode;
  lead?: React.ReactNode;
  tail?: React.ReactNode;
  // 본문 칸(제목·sub) 안 sub 아래에 한 줄 더 놓는 내용. 큰 글자에서 tail 의 배지를 이리로 내려, 고정 폭 lead·tail 옆에서 본문 칸이 줄지 않게 한다
  below?: React.ReactNode;
  chevron?: boolean;
  onPress?: () => void;
  tone?: 'on' | 'butter';
  dense?: boolean;
  // 묶음 안 두 번째 행부터 위 구분선. 시안처럼 최소 높이 안에 포함된다
  divider?: boolean;
  disabled?: boolean;
  label?: string;
  // 현재 선택된 행(언어 선택 등). true면 tone 기본값 'on'으로 선택 배경을 쓴다
  selected?: boolean;
}) {
  const effectiveTone = selected ? (tone ?? 'on') : tone;
  const style: ViewStyle = {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: dense ? 48 : 58,
    paddingVertical: dense ? 6 : 11,
    paddingHorizontal: 14,
    borderTopWidth: divider ? 1 : 0,
    borderTopColor: '#8B695633',
    backgroundColor:
      effectiveTone === 'on' ? C.soft : effectiveTone === 'butter' ? '#FFF3CF' : undefined,
  };
  // right 가 없고 selected면 체크 표식 — 색만으로 상태를 전달하지 않는다(DESIGN.md 11장)
  const rightText = right ?? (selected ? '✓' : undefined);
  const isCheckmark = right === undefined;
  const rightColor = isCheckmark ? C.ink : C.muted;
  const content = (
    <>
      {lead}
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Txt style={{ fontSize: 16, lineHeight: 20.8, fontWeight: '600' }}>{title}</Txt>
        {!!sub && (
          <Txt kind="meta" style={{ lineHeight: 17.55 }}>
            {sub}
          </Txt>
        )}
        {!!below && <View style={rowBelow}>{below}</View>}
      </View>
      {typeof rightText === 'string' ? (
        <Txt
          // 체크 표식은 selected 로 이미 전달돼 중복 낭독되지 않게 뺀다 — 실제 right 값은 그대로 읽힌다
          accessibilityElementsHidden={isCheckmark}
          importantForAccessibility={isCheckmark ? 'no' : undefined}
          style={{
            fontSize: 15,
            lineHeight: 21.75,
            color: rightColor,
            fontVariant: ['tabular-nums'],
          }}
        >
          {rightText}
        </Txt>
      ) : (
        rightText
      )}
      {tail}
      {chevron && <SheetChev />}
    </>
  );
  return onPress ? (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label ?? (sub ? `${title}, ${sub}` : title)}
      accessibilityState={{ disabled, ...(selected !== undefined && { selected }) }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [style, pressed && { opacity: 0.7 }]}
    >
      {content}
    </Pressable>
  ) : (
    <View style={style} accessible={!!label} accessibilityLabel={label}>
      {content}
    </View>
  );
}

// 리스트 묶음(.lg). flat = 그림자 없음. 안에는 SheetRow만 넣는다(구분선을 행에 넘긴다)
export function SheetGroup({
  flat = false,
  children,
}: {
  flat?: boolean;
  children?: React.ReactNode;
}) {
  const rows = React.Children.toArray(children).filter(React.isValidElement);
  // 행이 하나도 없으면 테두리·그림자만 남아 빈 안내 아래 갈색 막대가 된다 — 묶음 자체를 그리지 않는다
  if (!rows.length) return null;
  return (
    <View
      style={{
        backgroundColor: C.paper,
        borderWidth: 2,
        borderColor: C.brown,
        borderRadius: 18,
        overflow: 'hidden',
        boxShadow: flat ? 'none' : `0px 4px 0px ${C.brown}`,
      }}
    >
      {rows.map((c: any, i) => React.cloneElement(c, { divider: i > 0 }))}
    </View>
  );
}

// 그림 상자(.pv). 가로 폰 패널에서는 높이 200대 상자를 시안처럼 150px로 줄여(transform) 그린다
export function Preview({
  h,
  w,
  bg = C.sky,
  radius = 22,
  children,
}: {
  h: number;
  w?: number;
  bg?: string;
  radius?: number;
  children?: React.ReactNode;
}) {
  const { compact } = useAppLayout();
  const scale = compact && h >= 200 && h < 300 ? 150 / h : 1;
  return (
    <View style={{ height: h * scale, width: w }}>
      <View
        style={{
          height: h,
          backgroundColor: bg,
          borderWidth: 2,
          borderColor: C.brown,
          borderRadius: radius,
          overflow: 'hidden',
          alignItems: 'center',
          justifyContent: 'center',
          transform: [{ scale }],
          transformOrigin: 'top',
        }}
      >
        {children}
      </View>
    </View>
  );
}

// 행 끝 섬 썸네일(64×44)
export function IslandThumb({ warm = false }: { warm?: boolean }) {
  return (
    <View
      style={{
        width: 64,
        height: 44,
        borderRadius: 10,
        borderWidth: 1.5,
        borderColor: C.brown,
        backgroundColor: C.sky,
        overflow: 'hidden',
      }}
    >
      <Pic id={warm ? 'island/whole/warm' : 'island/whole'} w="100%" h="100%" cover />
    </View>
  );
}

// 시트 아래 고정 버튼 줄(.ctabar): 보조 문구 · 주 버튼 · (고스트 버튼). 시트 위라 고스트는 반투명 흰 바탕(.imm .btn.ghost)
export function Cta({
  note,
  title,
  onPress,
  disabled = false,
  ghost,
  onGhost,
}: {
  note?: string;
  title: string;
  onPress?: () => void;
  disabled?: boolean;
  ghost?: string;
  onGhost?: () => void;
}) {
  return (
    <>
      {!!note && (
        <Txt kind="meta" style={{ lineHeight: 18.85, marginBottom: 2, textAlign: 'center' }}>
          {note}
        </Txt>
      )}
      <Btn title={title} onPress={onPress} disabled={disabled} />
      {!!ghost && <Btn title={ghost} kind="glass" onPress={onGhost} />}
    </>
  );
}

// 입력칸(.inp) 글자: 줄 높이 1.45. 한 줄 TextInput에 lineHeight를 주면 iOS에서 글자가 아래로 밀려 웹에서만 준다
export const sheetInput: TextStyle = {
  letterSpacing: -0.15,
  ...(Platform.OS === 'web' ? { lineHeight: 23.2 } : null),
};

// 돋보기가 앞에 붙은 검색 칸. label이 있으면 칸 위에 .field 라벨. testID = field-(label 또는 placeholder)
export function SearchField({
  label,
  value,
  onChange,
  placeholder,
  icon,
  inputStyle,
}: {
  label?: string;
  value: string;
  onChange: (text: string) => void;
  placeholder?: string;
  icon?: React.ReactNode;
  inputStyle?: StyleProp<TextStyle>;
}) {
  return (
    <View style={{ gap: 6 }}>
      {!!label && (
        <Txt kind="meta" style={{ fontWeight: '600', lineHeight: 18.85 }}>
          {label}
        </Txt>
      )}
      <View>
        <TextInput
          testID={'field-' + (label || placeholder)}
          accessibilityLabel={label || placeholder}
          value={value}
          onChangeText={onChange}
          placeholder={placeholder}
          placeholderTextColor={componentTokens.input.placeholder}
          returnKeyType="search"
          style={[
            k.field,
            sheetInput,
            inputStyle,
            { paddingLeft: 14 + SEARCH_ICON, paddingRight: value ? 50 : 14 },
          ]}
        />
        <View pointerEvents="none" style={{ position: 'absolute', left: 16, top: 15 }}>
          {icon ?? (
            <Txt aria-hidden style={{ fontSize: 16, lineHeight: 23.2 }}>
              🔍
            </Txt>
          )}
        </View>
        {!!value && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('common.clearSearch')}
            onPress={() => onChange('')}
            style={{
              position: 'absolute',
              right: 2,
              top: 3,
              width: 44,
              height: 44,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Txt style={{ fontSize: 18, lineHeight: 22, color: C.muted }}>×</Txt>
          </Pressable>
        )}
      </View>
    </View>
  );
}
// 시안 "🔍 " 글자 폭(16px 이모지 + 띄어쓰기)
const SEARCH_ICON = 24;
