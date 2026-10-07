// v2 · 섬 위 게임 시트 공통 컴포넌트
// 건물 기능은 새 화면으로 넘어가지 않고, 그 건물로 다가간 섬 배경 위에 시트·팝업·나무 게시판으로 뜬다.
// 수치는 tools/build-redesign-gallery-v2.py(V2_CSS·QB_CSS)와 tools/redesign-landscape.py(L_CSS)의
// 402×874(세로) / 874×402(가로) 기준값을 그대로 옮겼다.
import React, { createContext, useContext, useEffect, useState, Ref } from 'react';
import {
  View,
  Pressable,
  ScrollView,
  Image,
  StyleSheet,
  StyleProp,
  ViewStyle,
  ImageStyle,
  TextStyle,
  Platform,
  AccessibilityInfo,
} from 'react-native';
import Svg, {
  Path,
  Circle,
  Ellipse,
  Rect,
  Defs,
  ClipPath,
  G,
  Polygon,
  Image as SvgImage,
} from 'react-native-svg';
import { useFonts } from 'expo-font';
import { C, art, k, Txt, Pic, Btn, Gear } from '@/design-system/patterns';
import { TextInput } from '@/design-system/typography';
import { componentTokens } from '@/design-system/tokens';
import { assets } from '@/constants/assets';
import { useAppLayout } from '@/utils/layout';

// 꽉 채우는 그림. 웹(react-native-web)은 absoluteFill만 주면 원본 픽셀 크기로 그려서 폭·높이를 같이 준다
const fill: ImageStyle = { position: 'absolute', left: 0, top: 0, width: '100%', height: '100%' };

const ISLAND_SHEET_RADIUS = 30;
const ISLAND_SHEET_BORDER_WIDTH = 2;
const ISLAND_SHEET_CONTENT_RADIUS = ISLAND_SHEET_RADIUS - ISLAND_SHEET_BORDER_WIDTH;

export type IslandBgKey =
  'hall' | 'board' | 'tower' | 'mail' | 'shop' | 'dock' | 'gram' | 'fire' | 'library';

// 건물로 다가간 섬 배경(가로 화면이면 가로용) + 옅은 스크림. 스크림을 누르면 닫힌다
function Backdrop({ bg, onClose }: { bg?: IslandBgKey; onClose: () => void }) {
  const { landscape } = useAppLayout();
  return (
    <>
      {bg && (
        <Image
          source={art[(landscape ? 'L/bldbg/' : 'bldbg/') + bg]}
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

// × 닫기 동그라미 버튼
function CloseX({
  onPress,
  size,
  font,
  style,
}: {
  onPress: () => void;
  size: number;
  font: number;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="닫기"
      onPress={onPress}
      hitSlop={6}
      style={[
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          borderWidth: 1.5,
          borderColor: C.brown,
          backgroundColor: C.paper,
          alignItems: 'center',
          justifyContent: 'center',
        },
        style,
      ]}
    >
      <Txt tabletScale={1} style={{ fontSize: font, lineHeight: font * 1.2, color: C.ink }}>
        ×
      </Txt>
    </Pressable>
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
  keepOnBackdrop = false,
  children,
}: {
  bg: IslandBgKey;
  sign: string;
  signKind?: '' | 'npc' | 'av';
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
  // 글을 쓰는 시트는 바깥(스크림)을 눌러도 닫지 않는다. 작성 중인 글 보호용, × 닫기는 그대로
  keepOnBackdrop?: boolean;
  children?: React.ReactNode;
}) {
  const L = useAppLayout();
  const ins = L.insets;
  const panel = L.compact;
  const g = GEO[panel ? 'panel' : 'sheet'];
  const top = panel ? ins.top : 0;
  // 알림(.toast)은 아래 버튼 줄 바로 위에 뜬다(세로 48 · 가로 14 간격)
  const [footH, setFootH] = useState(0);
  const endPad = panel ? Math.max(22, ins.bottom) : L.tablet ? 18 : ins.bottom + 12;
  const cardH = Math.min(L.height * (tall ? 0.9 : 0.76), L.height - ins.top - ins.bottom - 72);
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
          top: tall ? 100 : 210,
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
        {!panel && !L.tablet && (
          <View
            style={{
              position: 'absolute',
              top: 9,
              left: '50%',
              width: 44,
              height: 5,
              marginLeft: -22,
              borderRadius: 3,
              backgroundColor: '#D9C6B8',
            }}
          />
        )}
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
            w={g.img[signKind]}
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
          {onBack && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="뒤로"
              onPress={onBack}
              style={{
                width: 34,
                height: 34,
                marginLeft: -10,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Svg width={22} height={22} viewBox="0 0 24 24">
                <Path
                  d="M15 5l-7 7 7 7"
                  stroke={C.ink}
                  strokeWidth={2.4}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  fill="none"
                />
              </Svg>
            </Pressable>
          )}
          <Txt
            accessibilityRole="header"
            numberOfLines={1}
            style={{
              flex: 1,
              fontSize: 19,
              lineHeight: 26,
              fontWeight: '800',
              letterSpacing: -0.38,
            }}
          >
            {title}
          </Txt>
          {!!action && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={action === '⚙' ? '섬 관리' : action}
              onPress={actionPress}
              style={{ paddingVertical: 6, paddingHorizontal: 4 }}
            >
              {action === '⚙' ? (
                <Gear />
              ) : (
                <Txt style={{ fontSize: 14, lineHeight: 20, fontWeight: '700' }}>{action}</Txt>
              )}
            </Pressable>
          )}
          <CloseX onPress={onClose} size={34} font={19} />
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

// 섬 위 작은 팝업(.gpop). 가로 폰에서는 children | side 를 2단(.land .gpop)으로 눕힌다
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
    <View style={StyleSheet.absoluteFill}>
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
          <CloseX
            onPress={onClose}
            size={32}
            font={18}
            style={{ position: 'absolute', right: 14, top: 14, zIndex: 1 }}
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

// ───────── 나무 게시판 ─────────
// 402px 화면 기준 좌표(QB_*). 보드 그림 안쪽 크림 면은 x 67~334 / y 139~678 (보드 왼쪽 위 기준).
// clip = 탭 줄 아래부터 안쪽 면 끝까지를 스크롤 영역으로 쓴다.
const QB = { h: 773, l: 75, r: 76, tabs: 153, note: 195, clip: 181, bottom: 678 };
type BoardTab = 'quest' | 'notice';
// s = 402px 기준 배율, flow = 가로 폰 사이드 패널 안에서 흐름 배치
const BoardCtx = createContext<{ s: number; flow: boolean; font?: string }>({
  s: 1,
  flow: false,
});
// 목업 qnote 좌표·색을 i번째마다 번갈아 이어 붙인다 (0·1번은 목업과 같다)
const noteAt = (i: number) =>
  i % 2
    ? { x: 126, y: QB.note + i * 212, rot: 2, paper: 'qb/note/peach', pin: 'qb/pin/sky' }
    : { x: QB.l, y: QB.note + i * 212, rot: -2.5, paper: 'qb/note/butter', pin: 'qb/pin/pink' };
const paperY = (i: number) => QB.note + i * 108;

// 퀘스트/공지 탭. 세로 게시판에서는 오른쪽 끝에 ＋ 만들기/작성도 붙는다
function BoardTabs({
  tab,
  onTab,
  make,
  onMake,
}: {
  tab: BoardTab;
  onTab: (tab: BoardTab) => void;
  make?: string;
  onMake?: () => void;
}) {
  const { s, font } = useContext(BoardCtx);
  const pill = (label: string, fill: string, onPress?: () => void, selected?: boolean) => (
    <Pressable
      key={label}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={selected === undefined ? undefined : { selected }}
      onPress={onPress}
      style={{
        paddingVertical: 5 * s,
        paddingHorizontal: 11 * s,
        borderRadius: 999,
        borderWidth: 1.5,
        borderColor: C.brown,
        backgroundColor: fill,
        marginLeft: selected === undefined ? 'auto' : 0,
      }}
    >
      <Txt
        tabletScale={1}
        style={{ fontFamily: font, fontSize: 12 * s, lineHeight: 17 * s, fontWeight: '700' }}
      >
        {label}
      </Txt>
    </Pressable>
  );
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 * s }}>
      {pill('퀘스트', tab === 'quest' ? C.pink : C.paper, () => onTab('quest'), tab === 'quest')}
      {pill('공지', tab === 'notice' ? C.pink : C.paper, () => onTab('notice'), tab === 'notice')}
      {!!make && pill(make, C.butter, onMake)}
    </View>
  );
}

// "게시판" 제목의 갈색 외곽선: CSS text-shadow 5겹을 글자 복제로 흉내 낸다
const OUTLINE: [number, number, string][] = [
  [0, 3, '#5E3A22'],
  [0, 2, '#7A4E30'],
  [1, 0, '#7A4E30'],
  [-1, 0, '#7A4E30'],
  [0, -1, '#7A4E30'],
];

export function WoodBoard({
  tab,
  onTab,
  onMake,
  onClose,
  children,
}: {
  tab: BoardTab;
  onTab: (tab: BoardTab) => void;
  onMake: () => void;
  onClose: () => void;
  children?: React.ReactNode;
}) {
  const L = useAppLayout();
  // 사용자가 직접 쓴 퀘스트·공지 제목이 올라가므로 서브셋이 아닌 전체 고운돋움을 쓴다.
  // 항해·휴식 화면과 같은 파일이라 같은 글꼴 이름으로 한 번만 등록한다
  const [loaded] = useFonts({
    GromoSailing: require('@/assets/fonts/gowun-dodum.ttf'),
  });
  const font = loaded ? 'GromoSailing' : undefined;
  const make = tab === 'quest' ? '＋ 만들기' : '＋ 작성';

  // 가로 폰: 세로형 보드가 안 들어가므로 오른쪽 사이드 패널 안에 같은 포스트잇·종이를 흐름 배치
  if (L.compact)
    return (
      <BoardCtx.Provider value={{ s: 1, flow: true, font }}>
        <IslandSheet
          bg="board"
          sign="bld/notice-board"
          title="게시판"
          action={make}
          actionPress={onMake}
          onClose={onClose}
        >
          <BoardTabs tab={tab} onTab={onTab} />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 16, paddingTop: 9 }}>
            {children}
          </View>
        </IslandSheet>
      </BoardCtx.Provider>
    );

  // 세로·태블릿: 보드 그림을 화면에 맞춰 늘리고(402px 기준 s배), 화면 아래에 붙인다
  const s = Math.min(L.width / 402, L.height / 874);
  const title = {
    fontFamily: font,
    fontSize: 22 * s,
    lineHeight: 32 * s,
    textAlign: 'center' as const,
    fontWeight: '700' as const,
    letterSpacing: 0.88 * s,
  };
  // 스크롤 내용 높이 = 마지막 쪽지 아래 끝
  // ponytail: 공지 종이 높이는 100px로 어림. 제목이 3줄 넘게 길면 마지막 종이 아래가 조금 잘릴 수 있음 → 그땐 onLayout으로 실제 높이 측정
  const end = React.Children.toArray(children).reduce<number>((m, c) => {
    if (!React.isValidElement<{ i?: number }>(c)) return m;
    const i = c.props.i ?? 0;
    return Math.max(m, c.type === QuestNote ? noteAt(i).y + 200 : paperY(i) + 100);
  }, 0);
  return (
    <BoardCtx.Provider value={{ s, flow: false, font }}>
      <View style={StyleSheet.absoluteFill}>
        <Backdrop bg="board" onClose={onClose} />
        <View
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            alignItems: 'center',
            pointerEvents: 'box-none',
          }}
        >
          <View style={{ width: 402 * s, height: QB.h * s }}>
            <Image source={art['qb/board']} resizeMode="stretch" style={fill} />
            {/* 제목 줄은 보드 폭 전체라 복제 글자가 줄바꿈되지 않는다 */}
            <View style={{ position: 'absolute', left: 0, right: 0, top: 81 * s, height: 32 * s }}>
              {OUTLINE.map(([x, y, color]) => (
                <Txt
                  key={`${x},${y}`}
                  tabletScale={1}
                  aria-hidden
                  accessibilityElementsHidden
                  importantForAccessibility="no"
                  style={[
                    title,
                    { position: 'absolute', left: x * s, right: -x * s, top: y * s, color },
                  ]}
                >
                  게시판
                </Txt>
              ))}
              <Txt tabletScale={1} accessibilityRole="header" style={[title, { color: '#FFF3DF' }]}>
                게시판
              </Txt>
              <CloseX
                onPress={onClose}
                size={32 * s}
                font={19 * s}
                style={{
                  position: 'absolute',
                  right: 6 * s,
                  top: -12 * s,
                  boxShadow: `0px ${2 * s}px 0px ${C.brown}`,
                }}
              />
            </View>
            <View
              style={{ position: 'absolute', left: QB.l * s, right: QB.r * s, top: QB.tabs * s }}
            >
              <BoardTabs tab={tab} onTab={onTab} make={make} onMake={onMake} />
            </View>
            <ScrollView
              style={{
                position: 'absolute',
                left: 0,
                width: 402 * s,
                top: QB.clip * s,
                height: (QB.bottom - QB.clip) * s,
              }}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{
                height: (Math.max(QB.bottom, end + 12) - QB.clip) * s,
              }}
            >
              {children}
            </ScrollView>
          </View>
        </View>
      </View>
    </BoardCtx.Provider>
  );
}

// 퀘스트 포스트잇(qnote). i = 게시판 안 순서 → 위치·기울기·색·압정이 정해진다
export function QuestNote({
  i,
  title,
  pct,
  onPress,
}: {
  i: number;
  title: string;
  // null = 측정 권한이 없어 달성률을 알 수 없음 → "확인 필요"
  pct: number | null;
  onPress?: () => void;
}) {
  const { s, flow, font } = useContext(BoardCtx);
  const n = noteAt(i);
  const t = { fontFamily: font, color: C.ink };
  return (
    <View
      style={[
        { width: 200 * s, height: 200 * s, transform: [{ rotate: `${n.rot}deg` }] },
        !flow && { position: 'absolute', left: n.x * s, top: (n.y - QB.clip) * s },
      ]}
    >
      <Image source={art[n.paper]} resizeMode="stretch" style={fill} />
      <View
        style={{
          position: 'absolute',
          left: 19 * s,
          right: 19 * s,
          top: 40 * s,
          bottom: 21 * s,
          justifyContent: 'space-between',
        }}
      >
        <Txt
          tabletScale={1}
          numberOfLines={3}
          style={[t, { fontSize: 15 * s, lineHeight: 19.5 * s, fontWeight: '800' }]}
        >
          {title}
        </Txt>
        <View>
          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'baseline',
            }}
          >
            <Txt tabletScale={1} style={[t, { fontSize: 11 * s, lineHeight: 16 * s }]}>
              내 달성률
            </Txt>
            <Txt
              tabletScale={1}
              style={[
                t,
                {
                  fontSize: 15 * s,
                  lineHeight: 21 * s,
                  fontWeight: '800',
                  fontVariant: ['tabular-nums'],
                },
              ]}
            >
              {pct === null ? '확인 필요' : `${pct}%`}
            </Txt>
          </View>
          <View
            style={{
              height: 7 * s,
              borderRadius: 4 * s,
              backgroundColor: '#8B695626',
              overflow: 'hidden',
              marginTop: 3 * s,
              marginBottom: 6 * s,
            }}
          >
            <View
              style={{
                height: '100%',
                width: `${Math.max(0, Math.min(100, pct ?? 0))}%`,
                backgroundColor: C.pink,
                borderRadius: 4 * s,
              }}
            />
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${title} 자세히 보기`}
            onPress={onPress}
            style={{
              alignSelf: 'flex-start',
              height: 28 * s,
              paddingHorizontal: 11 * s,
              borderRadius: 999,
              borderWidth: 1.5,
              borderColor: C.brown,
              backgroundColor: C.paper,
              justifyContent: 'center',
            }}
          >
            <Txt
              tabletScale={1}
              style={[t, { fontSize: 11 * s, lineHeight: 15 * s, fontWeight: '700' }]}
            >
              자세히 보기
            </Txt>
          </Pressable>
        </View>
      </View>
      <Image
        source={art[n.pin]}
        resizeMode="contain"
        style={{ position: 'absolute', left: 82 * s, top: -9 * s, width: 36 * s, height: 40 * s }}
      />
    </View>
  );
}

// 공지 종이(qpaper). 마스킹테이프 · 제목 · (방장 배지) 작성자·날짜 · 댓글 수. 누르면 공지 상세
export function NoticePaper({
  i,
  title,
  meta,
  comments,
  badge,
  onPress,
}: {
  i: number;
  title: string;
  meta: string;
  comments: number;
  badge?: string;
  onPress?: () => void;
}) {
  const { s, flow, font } = useContext(BoardCtx);
  const t = { fontFamily: font, color: C.ink };
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${badge ? badge + ' ' : ''}${title}, ${meta}, 댓글 ${comments}개`}
      onPress={onPress}
      style={[
        {
          backgroundColor: C.paper,
          borderWidth: 1.5,
          borderColor: C.brown,
          borderTopLeftRadius: 7 * s,
          borderTopRightRadius: 11 * s,
          borderBottomRightRadius: 9 * s,
          borderBottomLeftRadius: 13 * s,
          boxShadow: '0px 3px 0px #8B695633',
          paddingTop: 16 * s,
          paddingHorizontal: 14 * s,
          paddingBottom: 12 * s,
          gap: 5 * s,
          transform: [{ rotate: `${i % 2 ? 1 : -1.2}deg` }],
        },
        flow
          ? { width: '100%' }
          : {
              position: 'absolute',
              left: QB.l * s,
              width: (402 - QB.l - QB.r) * s,
              top: (paperY(i) - QB.clip) * s,
            },
      ]}
    >
      <View
        style={{
          position: 'absolute',
          left: '50%',
          top: -9 * s,
          width: 62 * s,
          height: 17 * s,
          marginLeft: -31 * s,
          backgroundColor: '#ADE1F8CC',
          borderWidth: 1,
          borderColor: '#8B695655',
          transform: [{ rotate: '-2deg' }],
        }}
      />
      <Txt tabletScale={1} style={[t, { fontSize: 16 * s, lineHeight: 21 * s, fontWeight: '700' }]}>
        {title}
      </Txt>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 * s }}>
        {!!badge && (
          <View
            style={{
              backgroundColor: C.butter,
              borderWidth: 1,
              borderColor: C.brown,
              borderRadius: 999,
              paddingVertical: 1 * s,
              paddingHorizontal: 7 * s,
            }}
          >
            <Txt
              tabletScale={1}
              style={[t, { fontSize: 10 * s, lineHeight: 14 * s, fontWeight: '700' }]}
            >
              {badge}
            </Txt>
          </View>
        )}
        <Txt tabletScale={1} style={[t, { fontSize: 12 * s, lineHeight: 17 * s, color: C.muted }]}>
          {meta}
        </Txt>
        <Txt
          tabletScale={1}
          style={[
            t,
            { marginLeft: 'auto', fontSize: 12 * s, lineHeight: 17 * s, fontWeight: '700' },
          ]}
        >
          💬 {comments}
        </Txt>
      </View>
    </Pressable>
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
  size = 40,
  radius = 14,
}: {
  color: string;
  size?: number;
  radius?: number;
}) {
  return (
    <Pic
      id={'avatar/' + color}
      w={size}
      style={{
        borderRadius: radius,
        backgroundColor: C.sky,
        borderWidth: 1.5,
        borderColor: C.brown,
      }}
    />
  );
}

// 리스트 행(.row). tone = on(분홍) · butter(노랑). dense = 가로 축음기 시트의 낮은 행
export function SheetRow({
  title,
  sub,
  right,
  lead,
  tail,
  chevron = false,
  onPress,
  tone,
  dense = false,
  divider = false,
  disabled = false,
  label,
}: {
  title: string;
  sub?: string;
  right?: React.ReactNode;
  lead?: React.ReactNode;
  tail?: React.ReactNode;
  chevron?: boolean;
  onPress?: () => void;
  tone?: 'on' | 'butter';
  dense?: boolean;
  // 묶음 안 두 번째 행부터 위 구분선. 시안처럼 최소 높이 안에 포함된다
  divider?: boolean;
  disabled?: boolean;
  label?: string;
}) {
  const style: ViewStyle = {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: dense ? 48 : 58,
    paddingVertical: dense ? 6 : 11,
    paddingHorizontal: 14,
    borderTopWidth: divider ? 1 : 0,
    borderTopColor: '#8B695633',
    backgroundColor: tone === 'on' ? C.soft : tone === 'butter' ? '#FFF3CF' : undefined,
  };
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
      </View>
      {typeof right === 'string' ? (
        <Txt
          style={{ fontSize: 15, lineHeight: 21.75, color: C.muted, fontVariant: ['tabular-nums'] }}
        >
          {right}
        </Txt>
      ) : (
        right
      )}
      {tail}
      {chevron && <SheetChev />}
    </>
  );
  return onPress ? (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label ?? (sub ? `${title}, ${sub}` : title)}
      accessibilityState={{ disabled }}
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
      {React.Children.toArray(children)
        .filter(React.isValidElement)
        .map((c: any, i) => React.cloneElement(c, { divider: i > 0 }))}
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

// 밀짚모자 그림(.hatart). 시안도 그림 파일 없이 CSS 도형(타원 챙 + 둥근 모자 + 분홍 띠)으로 그린다.
// w = 줄어든 상자 폭(꾸미기 썸네일은 칸이 좁아 72로 줄어든 뒤 scale 0.7), 높이는 56 고정
export function HatArt({ scale = 1, w = 88 }: { scale?: number; w?: number }) {
  return (
    <Svg width={w * scale} height={56 * scale} viewBox={`0 0 ${w} 56`}>
      <HatShapes w={w} />
    </Svg>
  );
}
function HatShapes({ w }: { w: number }) {
  // CSS처럼 모서리 반지름(위 22 · 아래 6)이 몸통 폭을 넘으면 같은 비율로 줄인다
  const f = Math.min(1, (w - 46) / 44);
  // i만큼 안쪽으로 들어간 모자 몸통 윤곽
  const crown = (i: number) => {
    const [x0, x1, y0, y1, rt, rb] = [23 + i, w - 23 - i, 10 + i, 44 - i, 22 * f - i, 6 * f - i];
    return `M${x0} ${y0 + rt}A${rt} ${rt} 0 0 1 ${x0 + rt} ${y0}H${x1 - rt}A${rt} ${rt} 0 0 1 ${x1} ${y0 + rt}V${y1 - rb}A${rb} ${rb} 0 0 1 ${x1 - rb} ${y1}H${x0 + rb}A${rb} ${rb} 0 0 1 ${x0} ${y1 - rb}Z`;
  };
  return (
    <>
      <Defs>
        <ClipPath id={`hat-crown-${w}`}>
          <Path d={crown(1.5)} />
        </ClipPath>
      </Defs>
      <Ellipse
        cx={w / 2}
        cy={43}
        rx={w / 2 - 0.75}
        ry={10.25}
        fill="#F2CF7E"
        stroke={C.brown}
        strokeWidth={1.5}
      />
      <Path d={crown(0)} fill="#F2CF7E" />
      <Rect
        x={23}
        y={34.5}
        width={w - 46}
        height={8}
        fill={C.pink}
        clipPath={`url(#hat-crown-${w})`}
      />
      <Path d={crown(0.75)} fill="none" stroke={C.brown} strokeWidth={1.5} />
    </>
  );
}

// 뗏목 위 고양이 합성(시안 prep-redesign-assets.py raft_cat과 같은 좌표: 뒤 판자 → 고양이 400px (279,368) → 앞 판자).
// 검정 고양이는 미리 합성한 그림이 있고, 다른 털색은 여기서 겹친다. 크기는 상자에 맞춰 비율 유지(contain)
export function RaftCatArt({
  color,
  scarf = false,
  hat = false,
  width,
  height,
}: {
  color: string;
  scarf?: boolean;
  hat?: boolean;
  width: number | `${number}%`;
  height: number | `${number}%`;
}) {
  return (
    <Svg width={width} height={height} viewBox="48 307 928 669">
      <SvgImage href={assets['boats/raft/layers/back-day.png']} width={1024} height={1024} />
      <G transform="translate(279 368) scale(0.78125)">
        <SvgImage href={assets[`characters/cat/${color}/idle.png`]} width={512} height={512} />
        {scarf && (
          // 바다 스카프: 512px 고양이의 턱 아래 목 + 가슴 오른쪽 끝자락
          <>
            <Rect
              x={179.5}
              y={299.5}
              width={218}
              height={36}
              rx={17.5}
              fill={C.pink}
              stroke={C.brown}
              strokeWidth={7}
            />
            <Polygon
              points="338,322 376,326 388,392 350,386"
              fill={C.pink}
              stroke={C.brown}
              strokeWidth={7}
              strokeLinejoin="round"
            />
          </>
        )}
      </G>
      <SvgImage href={assets['boats/raft/layers/front-day.png']} width={1024} height={1024} />
      {hat && (
        <G
          transform={`translate(${279 + 175 * 0.78125} ${368 + 23 * 0.78125}) scale(${(230 * 0.78125) / 88})`}
        >
          <HatShapes w={88} />
        </G>
      )}
    </Svg>
  );
}

// 고양이 그림 위에 겹쳐 쓰는 밀짚모자. 그림과 같은 상자·같은 비율(viewBox, contain)로 겹치고
// 모자 위치(x, y, 폭)는 그 그림의 원본 픽셀 좌표로 준다
export function HatOn({ image, style }: { image: 'raft' | 'cat'; style: StyleProp<ViewStyle> }) {
  // 뗏목 합성 그림 440×317의 머리 · 고양이 idle 512×512의 머리
  const [vw, vh, x, y, w] = image === 'raft' ? [440, 317, 157, 20, 110] : [512, 512, 175, 23, 230];
  return (
    <View pointerEvents="none" style={[{ position: 'absolute' }, style]}>
      <Svg width="100%" height="100%" viewBox={`0 0 ${vw} ${vh}`}>
        <G transform={`translate(${x} ${y}) scale(${w / 88})`}>
          <HatShapes w={88} />
        </G>
      </Svg>
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
}: {
  label?: string;
  value: string;
  onChange: (text: string) => void;
  placeholder?: string;
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
            { paddingLeft: 14 + SEARCH_ICON, paddingRight: value ? 50 : 14 },
          ]}
        />
        <View pointerEvents="none" style={{ position: 'absolute', left: 16, top: 15 }}>
          <Txt aria-hidden style={{ fontSize: 16, lineHeight: 23.2 }}>
            🔍
          </Txt>
        </View>
        {!!value && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="검색어 지우기"
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
