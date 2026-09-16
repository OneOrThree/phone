// v2 · 섬 위 게임 시트 공통 컴포넌트
// 건물 기능은 새 화면으로 넘어가지 않고, 그 건물로 다가간 섬 배경 위에 시트·팝업·나무 게시판으로 뜬다.
// 수치는 tools/build-redesign-gallery-v2.py(V2_CSS·QB_CSS)와 tools/redesign-landscape.py(L_CSS)의
// 402×874(세로) / 874×402(가로) 기준값을 그대로 옮겼다.
import React, { createContext, useContext, Ref } from 'react';
import {
  View,
  Pressable,
  ScrollView,
  Image,
  StyleSheet,
  StyleProp,
  ViewStyle,
  ImageStyle,
} from 'react-native';
import { useFonts } from 'expo-font';
import { C, art, Txt, Pic, Chevron, Gear } from '@/components/Kit';
import { useAppLayout } from '@/utils/layout';

// 꽉 채우는 그림. 웹(react-native-web)은 absoluteFill만 주면 원본 픽셀 크기로 그려서 폭·높이를 같이 준다
const fill: ImageStyle = { position: 'absolute', left: 0, top: 0, width: '100%', height: '100%' };

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
  onBack,
  action,
  actionPress,
  onClose,
  footer,
  scrollRef,
  keepOnBackdrop = false,
  children,
}: {
  bg: IslandBgKey;
  sign: string;
  signKind?: '' | 'npc' | 'av';
  title: string;
  tall?: boolean;
  onBack?: () => void;
  action?: string;
  actionPress?: () => void;
  onClose: () => void;
  footer?: React.ReactNode;
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
  // 가로 폰은 오른쪽 안전영역까지 패널이 덮고, 내용은 그만큼 안쪽으로
  const right = panel ? ins.right : 0;
  const top = panel ? ins.top : 0;
  const endPad = panel ? Math.max(22, ins.bottom) : L.tablet ? 18 : ins.bottom + 12;
  const cardH = Math.min(L.height * (tall ? 0.9 : 0.76), L.height - ins.top - ins.bottom - 72);
  // 상자: 세로 폰 = 아래 시트(76% top 210 / 90% top 100), 가로 폰 = 오른쪽 540 패널, 태블릿 = 가운데 카드
  const box: ViewStyle = panel
    ? {
        top: 0,
        bottom: 0,
        right: 0,
        width: Math.min(540 + ins.right, L.width - ins.left - 80),
        borderLeftWidth: 2,
        borderTopLeftRadius: 30,
        borderBottomLeftRadius: 30,
        boxShadow: '-5px 0px 0px #8B695640',
      }
    : L.tablet
      ? {
          width: L.modalWidth,
          height: cardH,
          left: (L.width - L.modalWidth) / 2,
          top: (L.height - cardH) / 2 + 18,
          borderWidth: 2,
          borderRadius: 30,
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
              <Chevron back />
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
        <ScrollView
          ref={scrollRef}
          style={{ flex: 1 }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{
            gap: g.gap,
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
