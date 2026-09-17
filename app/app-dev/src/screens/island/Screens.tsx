import { Text } from '@/design-system/typography';
import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Image,
  Pressable,
  ScrollView,
  FlatList,
  Share,
  PanResponder,
  StyleSheet,
  Platform,
  Animated,
  Easing,
  Keyboard,
  BackHandler,
} from 'react-native';
import Svg, { Path, Line } from 'react-native-svg';
import {
  State,
  Building,
  Color,
  currentIsland,
  isHost,
  sessionSeconds,
  questRate,
  canBuild,
  canBuy,
  products,
  costs,
  buildingNames,
  colors,
  colorNames,
  residentCount,
  capacityOf,
  isFull,
  islandWeeklyAverage,
  hoursMinutes,
  CAPACITY_MIN,
  CAPACITY_MAX,
  inviteCodeOf,
  findIslandByInviteCode,
} from '@/services/model';
import { useAppLayout } from '@/utils/layout';
import { FinalIsland as IslandHome } from '@/screens/island/WorldMap';
import { FocusSea, clock } from '@/screens/focus/FocusSea';
import { RestWorld, Sailing } from '@/screens/world/WorldViews';
import { assets } from '@/constants/assets';
import { Scarf, Flag } from '@/screens/cosmetics/Cosmetics';
import { useScreenInsets } from '@/design-system/primitives';
import {
  art,
  C,
  k,
  Txt,
  Pic,
  Btn,
  Group,
  Row,
  Seg,
  Chips,
  Field,
  Toggle,
  Bar,
  Badge,
  Strip,
  Page,
  Overlay,
  Wheel,
  Graph,
} from '@/design-system/patterns';
import {
  IslandSheet,
  IslandPopup,
  WoodBoard,
  QuestNote,
  NoticePaper,
} from '@/screens/island/IslandSheet';
const names: Record<string, string> = {
  waves: '잔잔한 파도',
  campfire: '모닥불 소리',
  'forest-wind': '숲바람',
  rain: '오두막의 빗소리',
};
const buildingArt: Record<string, string> = {
  library: 'library',
  gram: 'gramophone',
  hall: 'hall',
  board: 'notice-board',
  tower: 'observatory',
  mail: 'mailbox',
  shop: 'shop',
};
const pad = (n: number) => String(n).padStart(2, '0');
const hhmmss = (n: number) =>
  `${pad(Math.floor(n / 3600))}:${pad(Math.floor(n / 60) % 60)}:${pad(Math.floor(n) % 60)}`;
// 날짜 "M/D"와 시각 "HH:MM"
const md = (at: number) => {
  const d = new Date(at);
  return `${d.getMonth() + 1}/${d.getDate()}`;
};
const hm = (at: number) => {
  const d = new Date(at);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
function Thumb({ h = 220, warm = false }: any) {
  return (
    <View style={[k.preview, { height: h }]}>
      <Pic id={warm ? 'island/whole/warm' : 'island/whole'} w="100%" h="100%" cover />
    </View>
  );
}
function Boat({ state, h = 260, scarf }: any) {
  return (
    <View style={[k.preview, { height: h }]}>
      <Pic id="boat/raft" w={h * 0.86} />
      <Pic
        id={'cat/' + state.color}
        w={h * 0.42}
        style={{ position: 'absolute', left: h * 0.36, top: h * 0.12 }}
      />
      {scarf && (
        <View
          style={{
            position: 'absolute',
            left: '44%',
            top: '41%',
            width: 44,
            height: 16,
            borderRadius: 8,
            backgroundColor: C.pink,
            borderWidth: 1.5,
            borderColor: C.brown,
            transform: [{ rotate: '-8deg' }],
          }}
        />
      )}
    </View>
  );
}
// mini = 내 정보의 6칸 작은 그리드, six = 가로 온보딩의 6칸 한 줄. v2 avgrid: 3열(세로)·6열 칸을 같은 폭으로 나눈다
function AvatarGrid({ value, onChange, mini = false, six = false }: any) {
  const per = mini || six ? 6 : 3,
    gap = mini ? 6 : six ? 8 : 10,
    size = mini ? 11 : six ? 12 : 13,
    [width, setWidth] = useState(0);
  // 가로 6칸은 칸이 좁아지면(작은 가로 폰) 그림을 칸 안쪽 폭(여백 2·테두리 2)에 맞춰 줄인다
  const avatarSize = mini ? 40 : six ? (width ? Math.min(54, (width - gap * 5) / 6 - 8) : 54) : 64;
  return (
    <View
      style={{ gap }}
      onLayout={six ? (ev) => setWidth(ev.nativeEvent.layout.width) : undefined}
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
                  accessibilityLabel={colorNames[colors.indexOf(c)]}
                  accessibilityState={{ selected: on }}
                  key={c}
                  onPress={() => onChange(c)}
                  style={{
                    flex: 1,
                    alignItems: 'center',
                    gap: 6,
                    paddingTop: mini || six ? 6 : 10,
                    paddingBottom: mini ? 4 : six ? 6 : 8,
                    paddingHorizontal: mini || six ? 2 : 6,
                    borderRadius: mini ? 12 : 18,
                    borderWidth: 2,
                    borderColor: on ? C.brown : 'transparent',
                    backgroundColor: on ? C.soft : C.paper,
                    boxShadow: on ? '0px 3px 0px ' + C.brown : 'none',
                  }}
                >
                  <Pic
                    id={'avatar/' + c}
                    w={avatarSize}
                    style={{ borderRadius: mini ? 10 : 16, backgroundColor: C.sky }}
                  />
                  <Txt
                    style={{
                      fontSize: size,
                      lineHeight: size * 1.45,
                      fontWeight: on ? '700' : '600',
                      color: on ? C.ink : C.muted,
                    }}
                  >
                    {colorNames[colors.indexOf(c)]}
                  </Txt>
                </Pressable>
              );
            })}
          </View>
        ))}
    </View>
  );
}
// v2 온보딩 글자 단계(시안 .h22 · .h17 · .meta · .sec · .row .rs · .inp). 글자 간격 -0.15px는 Txt 기본 스타일에 있다(입력칸만 따로)
const H22 = { fontSize: 22, lineHeight: 28.6, fontWeight: '800', letterSpacing: -0.44 } as const;
const H17 = { fontSize: 17, lineHeight: 22.95, fontWeight: '700' } as const;
const META = { lineHeight: 18.2 } as const;
const RS = { lineHeight: 17.55 } as const;
const SEC = {
  fontSize: 13,
  lineHeight: 18.85,
  fontWeight: '700',
  color: C.muted,
  letterSpacing: 0.26,
} as const;
// 한 줄 입력칸 줄 높이는 웹에서만(iOS 한 줄 TextInput은 lineHeight를 주면 글자가 아래로 밀린다). 여러 줄은 모든 플랫폼
const INP: any = { letterSpacing: -0.15, ...(Platform.OS === 'web' ? { lineHeight: 23.2 } : null) };
const INP_TA = { lineHeight: 23.2, letterSpacing: -0.15 } as const;
// 한국어 문장을 단어 단위로 줄바꿈(시안 word-break:keep-all). iOS는 lineBreakStrategyIOS로
const KEEP: any = Platform.OS === 'web' ? { wordBreak: 'keep-all' } : null;
// CSS 그라데이션: 웹은 background-image, 네이티브는 experimental_backgroundImage
const gradient = (css: string): any =>
  Platform.OS === 'web' ? { backgroundImage: css } : { experimental_backgroundImage: css };
// 행 오른쪽 꺾쇠(시안 .chev 18px)
function Chev() {
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
// 드럼 위아래 흐림(시안 .wheel:before/:after). 드럼을 감싼 칸 안에 겹친다
function WheelFade({ h }: { h: number }) {
  return (
    <>
      {[0, 1].map((n) => (
        <View
          key={n}
          pointerEvents="none"
          style={[
            {
              position: 'absolute',
              left: 2,
              right: 2,
              height: h,
              borderRadius: 12,
              ...(n ? { bottom: 2 } : { top: 2 }),
            },
            gradient(`linear-gradient(${n ? '#FFFDFA00,#FFFDFA' : '#FFFDFA,#FFFDFA00'})`),
          ]}
        />
      ))}
    </>
  );
}
// 가입 신청 대기 표시(시안 .spinner). 움직임 줄이기면 멈춘다
function Spinner({ reduce }: { reduce: boolean }) {
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
function Onboard({ title, back, left, leftBg = C.sky, cta, children }: any) {
  const layout = useAppLayout(),
    ins = useScreenInsets(),
    land = layout.compact,
    gutter = land ? 22 : 20,
    [ctaHeight, setCtaHeight] = useState(0);
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
          accessibilityLabel="뒤로"
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
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingHorizontal: gutter,
          paddingTop: land ? 6 : 16,
          paddingBottom: cta ? Math.max(land ? 92 : 120, ctaHeight) : land ? 28 : 48,
          gap: land ? 12 : 14,
        }}
      >
        {children}
      </ScrollView>
      {cta && (
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
function MiniRadio({ on }: any) {
  return (
    <View
      style={{
        width: 22,
        height: 22,
        borderRadius: 11,
        borderWidth: 2,
        borderColor: C.brown,
        backgroundColor: C.paper,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {on && (
        <View
          style={{
            width: 12,
            height: 12,
            borderRadius: 6,
            backgroundColor: C.pink,
          }}
        />
      )}
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
function Icon({ name, size = 22, color = C.ink, stroke = 2.2, fill = 'none' }: any) {
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
// 재생·일시정지(채운 도형)
function PlayIcon({ pause = false, size = 18 }: any) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d={pause ? 'M7 5h4v14H7zM13 5h4v14h-4z' : 'M8 5v14l11-7z'} fill={C.ink} />
    </Svg>
  );
}
// 분홍 원 체크(퀘스트 달성·선택한 카드·착용 중)
function CheckDot({ size = 22 }: any) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        borderWidth: 2,
        borderColor: C.brown,
        backgroundColor: C.pink,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Icon name="check" size={size * 0.55} stroke={3} />
    </View>
  );
}
// 폴더형 아이콘 타일 탭(ftabs). items = [[글자, 아이콘], ...]
function FTabs({ items, value, onChange }: any) {
  return (
    <View style={{ flexDirection: 'row', gap: 10 }}>
      {items.map(([label, icon]: string[]) => {
        const on = label === value;
        return (
          <Pressable
            key={label}
            accessibilityRole="button"
            accessibilityLabel={label}
            accessibilityState={{ selected: on }}
            onPress={() => onChange(label)}
            style={{
              flex: 1,
              height: 54,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              borderWidth: 2,
              borderColor: C.brown,
              borderRadius: 16,
              backgroundColor: on ? C.pink : C.paper,
              boxShadow: on ? '0px 4px 0px ' + C.brown : 'none',
            }}
          >
            <Icon name={icon} color={on ? C.ink : C.muted} />
            <Txt
              style={{
                fontSize: 15,
                fontWeight: on ? '800' : '700',
                color: on ? C.ink : C.muted,
              }}
            >
              {label}
            </Txt>
          </Pressable>
        );
      })}
    </View>
  );
}
// 겹친 아바타(avstack): 34px, 8px씩 겹침
function AvStack({ list }: { list: string[] }) {
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
// 재생 중 막대(eq)
function Eq() {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'flex-end',
        gap: 2,
        height: 14,
      }}
    >
      {[6, 13, 9, 12].map((h, i) => (
        <View
          key={i}
          style={{
            width: 3,
            height: h,
            borderRadius: 1,
            backgroundColor: '#D95C7F',
          }}
        />
      ))}
    </View>
  );
}
// 앵무새 대화 모달(guidebox): 대사 + 오른쪽 정렬 버튼 줄. 위치·폭은 style로
function GuideBox({ text, style, children }: any) {
  return (
    <View
      style={[
        {
          position: 'absolute',
          borderRadius: 20,
          borderWidth: 2,
          borderColor: C.brown,
          backgroundColor: '#FFFDFAF0',
          paddingVertical: 14,
          paddingHorizontal: 16,
          gap: 8,
          boxShadow: '0px 4px 0px ' + C.brown,
        },
        style,
      ]}
    >
      <View style={[k.row, { gap: 12 }]}>
        <Pic id="parrot" w={56} />
        <Txt
          lineBreakStrategyIOS="hangul-word"
          style={[{ flex: 1, fontSize: 16, lineHeight: 21.6, fontWeight: '700' }, KEEP]}
        >
          {text}
        </Txt>
      </View>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'flex-end',
          gap: 16,
        }}
      >
        {children}
      </View>
    </View>
  );
}
export function RedesignScreens({ e }: any) {
  const layout = useAppLayout();
  const state: State = e.state,
    island = currentIsland(state),
    route: string = e.route,
    ins = useScreenInsets();
  const {
    dispatch,
    go,
    replace,
    reset,
    home,
    back,
    notify,
    confirm,
    build,
    text,
    setText,
    body,
    setBody,
    tab,
    setTab,
    detail,
    now,
    terms,
    setTerms,
    approval,
    setApproval,
    visited,
    setVisited,
    guideStep,
    setGuideStep,
    player,
    previewAudio,
    setPreviewAudio,
    walkTo,
    newQuest,
  } = e;
  const [period, setPeriod] = useState('주'),
    [fan, setFan] = useState(false),
    [emote, setEmote] = useState<string | null>(null),
    [custom, setCustom] = useState(false),
    [invite, setInvite] = useState(false),
    [inviteCode, setInviteCode] = useState(''),
    [inviteError, setInviteError] = useState(''),
    // 초대 모달이 놓인 칸의 높이(키보드가 뜨면 줄어든다)
    [inviteArea, setInviteArea] = useState(layout.height),
    // iOS는 absoluteFill 칸이 키보드만큼 줄지 않아 키보드 높이를 따로 빼야 한다
    [keyboardHeight, setKeyboardHeight] = useState(0),
    [memberMenu, setMemberMenu] = useState<string | null>(null),
    [questHours, setQuestHours] = useState('0시간'),
    [questMins, setQuestMins] = useState('30분'),
    [search, setSearch] = useState(''),
    // 섬 관리: 이름·소개 편집 모드, 정원 드럼 팝업 / 새 섬 만들기와 같이 쓰는 정원 선택값
    [editing, setEditing] = useState(false),
    [capacityOpen, setCapacityOpen] = useState(false),
    [capacityPick, setCapacityPick] = useState('15명'),
    [profileName, setProfileName] = useState(state.name),
    [profileColor, setProfileColor] = useState<Color>(state.color),
    // 20b 회관 안내를 이번 홈 방문 동안만 띄우는 창 상태
    [hallGuideOpen, setHallGuideOpen] = useState(false),
    [discoveryIndex] = useState(() => Math.floor(Math.random() * 10)),
    // 섬 찾기에서 ‹ ›·가입 신청으로 고른 섬 id
    [discoveryPick, setDiscoveryPick] = useState<string | null>(null);
  const chat = useRef<ScrollView>(null),
    emoteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    setCustom(false);
    setFan(false);
    setMemberMenu(null);
    setInvite(false);
    setInviteError('');
    setSearch('');
    setEditing(false);
    setCapacityOpen(false);
    setCapacityPick('15명');
    setHallGuideOpen(false);
    setDiscoveryPick(null);
  }, [route]);
  useEffect(() => {
    if (!invite) return;
    // 안드로이드 뒤로 가기는 화면 이동 대신 초대 모달만 닫는다(App 리스너보다 나중에 등록돼 먼저 불린다)
    const backSub = BackHandler.addEventListener('hardwareBackPress', () => {
      setInvite(false);
      return true;
    });
    const show = Keyboard.addListener('keyboardDidShow', (ev) =>
      setKeyboardHeight(ev.endCoordinates.height),
    );
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboardHeight(0));
    return () => {
      backSub.remove();
      show.remove();
      hide.remove();
      setKeyboardHeight(0);
    };
  }, [invite]);
  useEffect(() => {
    if (route !== 'profile') return;
    setProfileName(state.name);
    setProfileColor(state.color);
  }, [route, state.name, state.color]);
  useEffect(() => {
    if (route !== 'questEdit') return;
    const q = island.quests.find((q) => q.id === detail);
    const target = q?.target ?? (body === 'screen' ? 120 : 30);
    setQuestHours(`${Math.floor(target / 60)}시간`);
    setQuestMins(`${String(target % 60).padStart(2, '0')}분`);
  }, [route, detail, body]);
  // 20b: 첫 집중 후 홈에 오면 바로 done으로 기록하고 창만 띄운다. 알겠어를 안 누르고 홈을 떠나도 다시 뜨지 않는다
  useEffect(() => {
    if (route !== 'home' || state.hallGuide !== 'pending') return;
    if (!island.buildings.includes('hall')) setHallGuideOpen(true);
    dispatch({ type: 'HALL_GUIDE_DONE' });
  }, [route, state.hallGuide]);
  useEffect(
    () => () => {
      if (emoteTimer.current) clearTimeout(emoteTimer.current);
    },
    [],
  );
  const act = (type: string, p: any = {}) => dispatch({ type, ...p });
  const host = !island.members.some((m) => m.role === 'host');
  // 이름으로 지금 방장인지(공지 작성자·공동 구매자 표시)
  const isHostName = (name: string) =>
    name === state.name ? host : island.members.some((m) => m.name === name && m.role === 'host');
  const backgroundHome = (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      aria-hidden={true}
      style={{ flex: 1 }}
    >
      <IslandHome
        state={state}
        go={go}
        build={build}
        showHud={route !== 'focusSetup'}
        showActions={false}
      />
    </View>
  );
  const sceneBg = (key: string) => (
    <View style={{ flex: 1 }}>
      <Pic id={key} w="100%" h="100%" cover />
    </View>
  );
  const footer = (
    primary: string,
    fn: () => void,
    ghost?: string,
    gfn?: () => void,
    note?: string,
    disabled = false,
  ) => (
    <>
      {note && (
        <Txt kind="meta" style={{ textAlign: 'center' }}>
          {note}
        </Txt>
      )}
      {/* v2 CTA 바: 가로 폰에서도 주 버튼 아래 고스트 버튼을 쌓는다 */}
      <View style={{ gap: 8 }}>
        <Btn title={primary} onPress={fn} disabled={disabled} />
        {ghost && <Btn title={ghost} onPress={gfn} kind="ghost" />}
      </View>
    </>
  );
  const join = (i: any) => {
    if (!i.joined && isFull(i)) {
      notify('정원이 가득 찬 섬이에요');
      return;
    }
    setVisited(i.id);
    act('JOIN', { id: i.id });
    // 승인 필요 섬은 섬 찾기 화면에 가입 신청 대기 상태로 남는다(이미 주민이면 바로 도착)
    if (i.approval && !i.joined) {
      if (route === 'joinIsland' || route === 'approval') setDiscoveryPick(i.id);
      else go('approval', i.id);
    } else go('arrival');
  };
  const resolveInvite = () => {
    const i = findIslandByInviteCode(state.islands, inviteCode);
    if (!i) {
      setInviteError('초대 코드를 다시 확인해 주세요.');
      return;
    }
    if (!i.joined && isFull(i)) {
      setInviteError('정원이 가득 찬 섬이에요');
      return;
    }
    setInvite(false);
    join(i);
  };
  const setTrack = (value: string) => act('TRACK', { value });
  const startFocus = () => {
    if (!island.joined) {
      notify('섬에 가입한 뒤 집중할 수 있어요.');
      e.replace('chooseIsland');
      return;
    }
    // 카운트업 집중: 목표 시간은 받지 않는다
    act('START', { subject: text });
    go('focus');
  };
  const endFocus = () =>
    confirm(
      '집중을 마칠까요?',
      `지금까지 집중한 ${Math.floor(sessionSeconds(state.session) / 60)}분 ${Math.floor(sessionSeconds(state.session) % 60)}초를 기록해요.`,
      () => {
        act('FINISH');
        reset('focusResult');
      },
    );
  const hallSwitch = (x: string) => {
    go(x === '기록' ? 'stats' : 'construction');
  };
  const hall = (selected: string, children: any, foot?: any) => (
    <IslandSheet
      bg="hall"
      sign="bld/hall"
      title="마을회관"
      tall={selected === '마을 발전'}
      action="⚙"
      actionPress={() => go('manage')}
      onClose={home}
      footer={foot}
    >
      <FTabs
        items={[
          ['기록', 'clock'],
          ['마을 발전', 'hammer'],
        ]}
        value={selected}
        onChange={hallSwitch}
      />
      {children}
    </IslandSheet>
  );
  if (route === 'login') {
    const agree = (
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: terms }}
        onPress={() => setTerms(!terms)}
        style={[k.row, layout.compact ? { minHeight: 36, paddingVertical: 4 } : { minHeight: 40 }]}
      >
        <View
          style={{
            width: 24,
            height: 24,
            borderWidth: 2,
            borderColor: C.brown,
            borderRadius: 7,
            backgroundColor: terms ? C.pink : C.paper,
          }}
        >
          {terms && <Txt style={{ textAlign: 'center' }}>✓</Txt>}
        </View>
        <Txt kind="meta">이용약관과 개인정보 안내에 동의해요.</Txt>
      </Pressable>
    );
    const start = (
      <Btn
        title="GROMO 시작하기"
        disabled={!terms}
        onPress={() => {
          act('LOGIN');
          state.onboarded ? home() : go('character');
        }}
      />
    );
    // v2 로고: 흰 글자 + 아래로 떨어지는 그림자
    const shade = {
      color: C.paper,
      textShadowColor: '#49433955',
      textShadowOffset: { width: 0, height: 2 },
      textShadowRadius: 0,
    };
    const logo = (
      <>
        <Txt
          style={[
            shade,
            {
              fontSize: 42,
              lineHeight: 42,
              fontWeight: '900',
              letterSpacing: 1,
            },
          ]}
        >
          GROMO
        </Txt>
        <Txt style={[shade, { fontSize: 15, lineHeight: 21.75, fontWeight: '700' }]}>
          오늘의 집중이 자라는 곳
        </Txt>
      </>
    );
    if (layout.compact)
      // 가로 폰: 그림을 넓게 깔고 오른쪽 크림 패널(380)에 문구·약관·시작
      return (
        <View style={{ flex: 1, backgroundColor: C.sky }}>
          <Pic
            id="L/welcome"
            w="100%"
            h="100%"
            cover
            style={{ position: 'absolute', left: 0, top: 0 }}
          />
          <View
            style={{
              position: 'absolute',
              left: Math.max(56, ins.left + 4),
              top: ins.top + 22,
            }}
          >
            {logo}
          </View>
          <Pic
            id="cat/black/sitting"
            w={150}
            style={{
              position: 'absolute',
              left: Math.max(230, ins.left + 178),
              bottom: 0,
            }}
          />
          <View
            style={{
              position: 'absolute',
              right: 0,
              top: 0,
              bottom: 0,
              // v2 welcome-panel: 폭 380 · 안쪽 여백 32 56 26 28(오른쪽 56은 다이내믹 아일랜드 자리)
              width: 380,
              gap: 10,
              paddingTop: ins.top + 32,
              paddingLeft: 28,
              paddingRight: Math.max(56, ins.right + 4),
              paddingBottom: Math.max(26, ins.bottom + 5),
              backgroundColor: C.cream,
              borderLeftWidth: 2,
              borderColor: C.brown,
              boxShadow: '-5px 0px 0px #8B695640',
            }}
          >
            <Txt kind="h" style={{ fontSize: 24, lineHeight: 31.2, letterSpacing: -0.48 }}>
              {'조금씩 집중하고,\n함께 자라요.'}
            </Txt>
            <Txt style={{ color: C.muted }}>나의 작은 배에서 시작하는 집중 습관.</Txt>
            {agree}
            <View style={{ flex: 1 }} />
            {start}
          </View>
        </View>
      );
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: C.cream,
          flexDirection: layout.landscape ? 'row' : 'column',
        }}
      >
        <View
          style={{
            // v2 welcome-top: 402×874에서 높이 490
            height: layout.landscape ? '100%' : layout.tablet ? '48%' : (layout.height * 490) / 874,
            width: layout.landscape ? '48%' : '100%',
            overflow: 'hidden',
            borderBottomLeftRadius: layout.landscape ? 0 : 44,
            borderBottomRightRadius: layout.landscape ? 0 : 44,
          }}
        >
          <Pic id="welcome" w="100%" h="100%" cover />
          <View
            style={{
              position: 'absolute',
              left: ins.left + 26,
              top: ins.top + 12,
            }}
          >
            {logo}
          </View>
          <Pic
            id="cat/black/sitting"
            w={150}
            style={{ position: 'absolute', right: 14, bottom: -8 }}
          />
        </View>
        <View
          style={{
            flex: 1,
            paddingTop: layout.landscape ? ins.top + 16 : 0,
            paddingRight: ins.right,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <ScrollView
            style={{ width: '100%', maxWidth: 580, flex: 1 }}
            contentContainerStyle={{
              padding: 24,
              paddingTop: 22,
              gap: 12,
              flexGrow: 1,
              justifyContent: layout.tablet ? 'center' : 'flex-start',
            }}
          >
            <Txt kind="h" style={{ fontSize: 26, lineHeight: 33.8, letterSpacing: -0.52 }}>
              {'조금씩 집중하고,\n함께 자라요.'}
            </Txt>
            <Txt style={{ color: C.muted }}>나의 작은 배에서 시작하는 집중 습관.</Txt>
            {agree}
          </ScrollView>
          <View
            style={{
              width: '100%',
              maxWidth: 580,
              paddingHorizontal: 20,
              paddingBottom: ins.bottom + 12,
            }}
          >
            {start}
          </View>
        </View>
      </View>
    );
  }
  if (route === 'character')
    return (
      <Onboard
        title="내 고양이"
        back={back}
        leftBg={C.soft}
        left={
          <View style={{ alignItems: 'center', gap: 6 }}>
            <Pic id="cat/black/sitting" w={170} />
            <Txt style={H17}>반가워, 나의 고양이!</Txt>
            <Txt kind="meta" style={META}>
              털색은 나중에 바꿀 수 있어요
            </Txt>
          </View>
        }
        cta={<Btn title="내 고양이와 시작" onPress={() => go('chooseIsland')} />}
      >
        {!layout.compact && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 4 }}>
            <Pic id="cat/black/sitting" w={84} />
            <View style={{ flex: 1, gap: 2 }}>
              <Txt style={H22}>반가워, 나의 고양이!</Txt>
              <Txt kind="meta" style={META}>
                털색은 나중에 내 정보에서 바꿀 수 있어요
              </Txt>
            </View>
          </View>
        )}
        <Txt style={[SEC, { marginTop: layout.compact ? 0 : 6 }]}>어떤 고양이로 시작할까요?</Txt>
        <AvatarGrid
          six={layout.compact}
          value={state.color}
          onChange={(color: Color) => act('PROFILE', { color })}
        />
        <Field
          label="닉네임"
          value={state.name}
          onChange={(name: string) => act('PROFILE', { name })}
          inputStyle={INP}
        />
      </Onboard>
    );
  if (route === 'chooseIsland')
    return (
      <View style={{ flex: 1 }}>
        {/* 초대 모달이 열리면 뒤 화면은 스크린리더에서 숨긴다 */}
        <View
          style={{ flex: 1 }}
          importantForAccessibility={invite ? 'no-hide-descendants' : 'auto'}
          accessibilityElementsHidden={invite}
          aria-hidden={invite}
        >
          <Onboard
            title="첫 섬 선택"
            back={back}
            left={
              <View style={{ alignItems: 'center', gap: 4 }}>
                <Pic id="boat/raft" w={210} />
                <Txt style={H17}>첫 항해를 떠나요</Txt>
              </View>
            }
          >
            {!layout.compact && (
              <View
                style={[
                  k.preview,
                  {
                    height: 120,
                    flexDirection: 'row',
                    justifyContent: 'flex-start',
                    paddingHorizontal: 20,
                    gap: 14,
                  },
                ]}
              >
                <Pic id="boat/raft" w={100} />
                <Txt style={H17}>첫 항해를 떠나요</Txt>
              </View>
            )}
            <Txt style={H22}>어디에서 시작할까요?</Txt>
            <Group>
              <Row
                title="혼자 시작할 섬 만들기"
                sub={
                  <Txt kind="meta" style={RS}>
                    내 이름으로 새 섬을 열어요
                  </Txt>
                }
                lead={<Pic id="boat/raft" w={52} />}
                tail={<Chev />}
                onPress={() => go('createIsland')}
              />
              <Row
                title="기존 섬 참여"
                sub={
                  <Txt kind="meta" style={RS}>
                    망원경으로 공개 섬 찾기
                  </Txt>
                }
                lead={<Pic id="bld/observatory" w={52} />}
                tail={<Chev />}
                onPress={() => go('joinIsland')}
              />
            </Group>
            {/* 초대받은 섬: 코드 확인 → 승인 없는 섬은 바로 참여, 승인 필요 섬은 가입 신청 */}
            <Btn
              kind="sec"
              id="invite-open"
              title="이미 초대받은 섬이 있어요!"
              style={{ marginTop: 6 }}
              onPress={() => {
                setInviteError('');
                setInvite(true);
              }}
            />
          </Onboard>
        </View>
        {invite && (
          <View
            // 칸이 키보드만큼 줄지 않은 환경(iOS)에서만 남는 겹침을 아래 여백으로 빼 카드를 키보드 위에 둔다
            style={[
              StyleSheet.absoluteFill,
              {
                paddingBottom: Math.max(0, keyboardHeight - (layout.height - inviteArea)),
              },
            ]}
            onLayout={(ev) => setInviteArea(ev.nativeEvent.layout.height)}
          >
            <Pressable
              accessible={false}
              onPress={() => setInvite(false)}
              style={[StyleSheet.absoluteFill, { backgroundColor: '#493B3966' }]}
            />
            <View
              pointerEvents="box-none"
              style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}
            >
              {/* 키보드가 올라와 남은 높이가 낮아지면(가로 폰) 카드 안에서 스크롤해 확인 버튼까지 닿는다 */}
              <View
                accessibilityViewIsModal
                style={{
                  width: layout.compact || layout.tablet ? layout.modalWidth : layout.width - 48,
                  maxHeight: Math.max(
                    120,
                    // 칸이 이미 줄었으면(안드로이드·웹) 그대로, 아니면 화면 높이에서 키보드를 뺀 높이
                    inviteArea -
                      Math.max(0, keyboardHeight - (layout.height - inviteArea)) -
                      ins.top -
                      ins.bottom -
                      24,
                  ),
                  backgroundColor: C.paper,
                  borderWidth: 2,
                  borderColor: C.brown,
                  borderRadius: 24,
                  boxShadow: '0px 6px 0px ' + C.brown,
                }}
              >
                <ScrollView
                  style={{ flexShrink: 1 }}
                  keyboardShouldPersistTaps="handled"
                  showsVerticalScrollIndicator={false}
                  contentContainerStyle={{
                    paddingHorizontal: 20,
                    paddingTop: layout.compact ? 14 : 20,
                    paddingBottom: layout.compact ? 14 : 18,
                    gap: layout.compact ? 10 : 14,
                  }}
                >
                  <View
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                    }}
                  >
                    <Txt style={H22}>초대 코드 입력</Txt>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="닫기"
                      hitSlop={12}
                      onPress={() => setInvite(false)}
                    >
                      <Txt style={{ fontSize: 24, lineHeight: 34.8, color: C.muted }}>×</Txt>
                    </Pressable>
                  </View>
                  <Field
                    label="초대 코드"
                    value={inviteCode}
                    onChange={(v: string) => {
                      setInviteCode(v);
                      setInviteError('');
                    }}
                    inputStyle={INP}
                  />
                  <Txt
                    kind="meta"
                    lineBreakStrategyIOS="hangul-word"
                    style={[META, KEEP, inviteError ? { color: C.danger } : null]}
                  >
                    {inviteError ||
                      '확인하면 그 섬에 바로 참여하거나, 방장에게 가입 승인을 요청해요.'}
                  </Txt>
                  <Btn title="확인" onPress={resolveInvite} disabled={!inviteCode.trim()} />
                </ScrollView>
              </View>
            </View>
          </View>
        )}
      </View>
    );
  if (route === 'createIsland') {
    const capacityWheel = (
      <View style={{ gap: 6 }}>
        <Txt kind="meta" style={{ fontWeight: '600' }}>
          정원 · 최대 {CAPACITY_MAX}명
        </Txt>
        {/* v2 드럼: 빈 라벨 칸의 아래 여백 4px(세로) · 위아래 흐림 */}
        <View style={[k.row, { marginTop: layout.compact ? 0 : 4 }]}>
          <Wheel
            a11yLabel="정원"
            row={layout.compact ? 24 : 44}
            items={Array.from(
              { length: CAPACITY_MAX - CAPACITY_MIN + 1 },
              (_, n) => n + CAPACITY_MIN + '명',
            )}
            value={capacityPick}
            onChange={setCapacityPick}
          />
          <WheelFade h={layout.compact ? 14 : 30} />
        </View>
      </View>
    );
    const approvalRow = (
      <Group flat>
        <Row
          title="승인 후 가입"
          sub={
            <Txt kind="meta" style={RS}>
              방장이 확인한 뒤 주민이 돼요
            </Txt>
          }
          tail={<Toggle label="승인 후 가입" value={approval} onChange={setApproval} />}
        />
      </Group>
    );
    return (
      <Onboard
        title="새 섬 만들기"
        back={back}
        left={<Pic id="L/home/00-start/nocat" w="100%" h="100%" cover />}
        cta={
          <Btn
            title="섬 만들기"
            disabled={!text.trim()}
            onPress={() => {
              act('CREATE_ISLAND', {
                name: text,
                intro: body,
                approval,
                capacity: parseInt(capacityPick),
              });
              go('arrival');
            }}
          />
        }
      >
        <Field label="섬 이름" value={text} onChange={setText} inputStyle={INP} />
        <Field
          label="섬 소개"
          value={body}
          onChange={setBody}
          multiline={!layout.compact}
          inputStyle={layout.compact ? INP : INP_TA}
        />
        {layout.compact ? (
          // 가로: 정원 드럼과 승인 토글을 한 줄에(1 : 1.5)
          <View style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-end' }}>
            <View style={{ flex: 1 }}>{capacityWheel}</View>
            <View style={{ flex: 1.5 }}>{approvalRow}</View>
          </View>
        ) : (
          <>
            {capacityWheel}
            {approvalRow}
          </>
        )}
      </Onboard>
    );
  }
  if (route === 'joinIsland' || route === 'approval') {
    // 망원경으로 찾은 공개 섬: 주민이 있고 정원이 남은 섬(신청 중인 섬은 가득 차도 남긴다)
    const pendings = state.pendingIslands ?? [];
    const candidates = state.islands.filter(
      (i) =>
        !i.closed &&
        !i.joined &&
        // 초대 코드로 신청한 비공개 섬은 공개 조건과 상관없이 대기 화면에 남긴다
        ((i.visibility !== 'private' && i.members.length > 0 && !isFull(i)) ||
          pendings.includes(i.id) ||
          (route === 'approval' && i.id === (detail || state.pendingIsland))),
    );
    // 처음 보여줄 섬: ‹ ›로 고른 섬 → 경로로 받은 섬 → 신청 중인 섬(다시 켜도 먼저) → 무작위
    const pickId = discoveryPick ?? (detail || state.pendingIsland);
    const picked = candidates.findIndex((c) => c.id === pickId);
    const index = picked >= 0 ? picked : discoveryIndex % Math.max(1, candidates.length),
      i = candidates[index];
    const pending = !!i && pendings.includes(i.id);
    const move = (n: number) =>
      setDiscoveryPick(candidates[(index + n + candidates.length) % candidates.length].id);
    const average = i ? hoursMinutes(islandWeeklyAverage(state, i, now)).replace(/ 0분$/, '') : '';
    return (
      <Onboard
        title="섬 찾기"
        back={back}
        left={
          <Pic
            id={i?.id === 'strawberry' ? 'island/whole/warm' : 'island/whole'}
            w="100%"
            h="100%"
            cover
          />
        }
        cta={
          pending ? (
            <>
              <Btn
                kind="sec"
                title="가입 신청 취소"
                onPress={() => act('CANCEL_JOIN', { id: i.id })}
              />
              <Btn
                kind="ghost"
                title="다른 섬 보기"
                disabled={candidates.length < 2}
                onPress={() => move(1)}
              />
            </>
          ) : (
            <>
              <Btn
                title={!i ? '참여하기' : i.approval ? '가입 신청' : `${i.name}에 참여하기`}
                disabled={!i}
                onPress={() => i && join(i)}
              />
              <Btn
                kind="ghost"
                title="찾는 섬이 없으면 새 섬 만들기"
                onPress={() => go('createIsland')}
              />
            </>
          )
        }
      >
        {i ? (
          <>
            {!layout.compact && <Thumb warm={i.id === 'strawberry'} h={210} />}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 50 }}>
              <View style={{ flex: 1, gap: 2 }}>
                <Txt style={H22}>{i.name}</Txt>
                <Txt kind="meta" style={META}>
                  {i.intro}
                </Txt>
              </View>
              {['‹', '›'].map((v, n) => (
                <Pressable
                  key={v}
                  accessibilityRole="button"
                  accessibilityLabel={n ? '다음 섬' : '이전 섬'}
                  accessibilityState={{ disabled: candidates.length < 2 }}
                  disabled={candidates.length < 2}
                  onPress={() => move(n ? 1 : -1)}
                  style={{
                    opacity: candidates.length < 2 ? 0.45 : 1,
                    width: 44,
                    height: 44,
                    marginTop: 6,
                    borderRadius: 22,
                    borderWidth: 2,
                    borderColor: C.brown,
                    backgroundColor: C.paper,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Txt
                    style={{ fontSize: 13, lineHeight: 18.85, fontWeight: '700', color: C.muted }}
                  >
                    {v}
                  </Txt>
                </Pressable>
              ))}
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <AvStack list={i.members.slice(0, 3).map((m) => m.color)} />
              <Txt kind="meta" style={[META, { flex: 1 }]}>
                {`주민 ${residentCount(i)}/${capacityOf(i)}명 · 평균 집중 ${average}`}
              </Txt>
            </View>
            {/* 합류 방식 배지: 바로 참여 / 승인 필요(버튼이 가입 신청) */}
            <View
              style={{
                alignSelf: 'flex-start',
                height: 28,
                paddingHorizontal: 12,
                justifyContent: 'center',
                borderRadius: 999,
                borderWidth: 1.5,
                borderColor: i.approval ? '#D9C6B8' : C.brown,
                backgroundColor: i.approval ? C.paper : C.butter,
              }}
            >
              <Txt
                style={{
                  fontSize: 13,
                  lineHeight: 18.85,
                  fontWeight: i.approval ? '600' : '700',
                  color: i.approval ? C.muted : C.ink,
                }}
              >
                {i.approval ? '승인 필요' : '바로 참여'}
              </Txt>
            </View>
            {pending && (
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 12,
                  backgroundColor: '#FFF3CF',
                  borderWidth: 1.5,
                  borderColor: '#E7CF9A',
                  borderRadius: 14,
                  paddingVertical: 10,
                  paddingHorizontal: 14,
                }}
              >
                <View style={{ gap: 2 }}>
                  <Txt style={{ fontSize: 15, lineHeight: 21.75, fontWeight: '700' }}>
                    가입 신청 대기 중
                  </Txt>
                  <Txt kind="meta" style={{ lineHeight: 18.85 }}>
                    방장이 확인하면 알려드릴게요
                  </Txt>
                </View>
                <Spinner reduce={state.settings.reduceMotion} />
              </View>
            )}
          </>
        ) : (
          <Txt>지금 참여할 수 있는 공개 섬이 없어요.</Txt>
        )}
      </Onboard>
    );
  }
  if (route === 'arrival' || route === 'travel')
    return (
      <Sailing
        state={state}
        from={route === 'arrival' ? '나의 작은 배' : island.name}
        destination={
          route === 'arrival'
            ? island.name
            : state.islands.find((i) => i.id === visited)?.name || '새로운 섬'
        }
        onArrive={() =>
          route === 'arrival'
            ? go('guide')
            : state.islands.find((i) => i.id === visited)?.joined
              ? (act('SWITCH_ISLAND', { id: visited }), home())
              : go('visit', visited)
        }
      />
    );
  if (route === 'guide') {
    // 회관 안내(옛 5번째 대사)는 첫 집중 후 홈(20b)으로 옮겼다
    const lines = [
      '안녕! 섬에 온 걸 환영해! 처음 보는 얼굴이네?',
      '네가 집중하는 동안 고양이는 낚시를 할 거야!\n고양이를 도와 이 섬을 하나씩 꾸며 나가자!',
      '집중하기를 누르면 배를 타고 낚시섬으로 가.\n도착해서 원하는 곳을 누르고 할 일을 정하면 돼!',
      '잠깐 쉬고 싶으면 모닥불로 와.',
      '그럼 첫 낚시 다녀와!\n다시 보고 싶으면 앱 설정의 튜토리얼 다시보기를 눌러.',
    ];
    const step = Math.min(guideStep, lines.length - 1),
      last = step === lines.length - 1,
      w = layout.compact ? Math.min(layout.floatingWidth, 414) : layout.floatingWidth;
    return (
      <View style={{ flex: 1 }}>
        {backgroundHome}
        <GuideBox
          text={lines[step]}
          style={{
            left: (layout.width - w) / 2,
            width: w,
            // v2 가로 guidebox는 아래 18px
            bottom: layout.compact ? 18 : ins.bottom + 12,
          }}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="건너뛰기"
            hitSlop={12}
            onPress={home}
          >
            <Txt
              kind="meta"
              style={{
                fontSize: 12,
                lineHeight: 16.8,
                textDecorationLine: 'underline',
              }}
            >
              건너뛰기
            </Txt>
          </Pressable>
          <Btn
            title={last ? '시작할게' : '다음'}
            small
            style={{ minWidth: 96 }}
            onPress={() => (last ? home() : setGuideStep(step + 1))}
          />
        </GuideBox>
      </View>
    );
  }
  if (route === 'home') {
    // 20b: 첫 집중을 마치고 돌아온 섬에 회관이 없으면 한 번만 뜨는 안내
    const hallGuide = hallGuideOpen && !island.buildings.includes('hall'),
      w = layout.compact ? Math.min(layout.floatingWidth, 374) : layout.floatingWidth;
    return (
      <View style={{ flex: 1 }}>
        <IslandHome state={state} go={go} build={build} request={e.walkRequest} />
        {hallGuide && (
          <GuideBox
            text={`제일 먼저 섬의 관리를 위한 마을회관부터 지어보자.\n물고기 ${costs.hall}마리만 모아줘!`}
            style={{
              left: (layout.width - w) / 2,
              width: w,
              // 건설 카드·집중 시작 버튼 위
              bottom: layout.compact ? 110 : ins.bottom + 118,
            }}
          >
            <Btn
              title="알겠어"
              small
              style={{ minWidth: 96 }}
              onPress={() => setHallGuideOpen(false)}
            />
          </GuideBox>
        )}
      </View>
    );
  }
  if (route === 'focusSetup')
    return (
      <Overlay close={home} background={backgroundHome}>
        <View style={[k.row, { justifyContent: 'space-between' }]}>
          <Txt kind="h">집중 준비</Txt>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="닫기"
            onPress={home}
            style={{
              width: 44,
              height: 44,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Svg width={22} height={22} viewBox="0 0 22 22">
              <Line
                x1={5}
                y1={5}
                x2={17}
                y2={17}
                stroke={C.ink}
                strokeWidth={2.5}
                strokeLinecap="round"
              />
              <Line
                x1={17}
                y1={5}
                x2={5}
                y2={17}
                stroke={C.ink}
                strokeWidth={2.5}
                strokeLinecap="round"
              />
            </Svg>
          </Pressable>
        </View>
        <Field label="오늘의 할 일" value={text} onChange={setText} placeholder="수학 문제 풀기" />
        <Btn title="집중 시작" id="start-focus" disabled={!text.trim()} onPress={startFocus} />
      </Overlay>
    );
  const focusScene = (
    <View style={{ flex: 1 }}>
      <FocusSea state={state} emote={emote} />
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          left: layout.compact ? ins.left + 20 : 0,
          right: layout.compact ? undefined : 0,
          top: ins.top + 12,
          alignItems: layout.compact ? 'flex-start' : 'center',
          gap: 2,
        }}
      >
        <View
          style={{
            backgroundColor: '#FFFDFAD9',
            borderRadius: 999,
            paddingHorizontal: 12,
            paddingVertical: 4,
          }}
        >
          <Txt style={{ fontSize: 13, fontWeight: '600' }}>{state.session?.subject || '집중'}</Txt>
        </View>
        <Txt
          style={{
            fontSize: layout.compact ? 38 : 46,
            lineHeight: layout.compact ? 46 : 56,
            fontWeight: '800',
            fontVariant: ['tabular-nums'],
            textShadowColor: C.paper,
            textShadowRadius: 6,
          }}
        >
          {clock(sessionSeconds(state.session, now))}
        </Txt>
      </View>
      {island.buildings.includes('gram') && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="현재 음악"
          onPress={() => go('sound')}
          style={[
            k.row,
            {
              position: 'absolute',
              right: ins.right + 16,
              top: ins.top + 12,
              height: 34,
              paddingHorizontal: 8,
              gap: 6,
              borderRadius: 999,
              backgroundColor: '#FFFDFAE0',
              borderWidth: 1.5,
              borderColor: C.brown,
            },
          ]}
        >
          <Pic id="gram" w={22} />
          <Txt style={{ fontSize: 12, fontWeight: '700' }}>
            {island.playing ? names[island.track] : '음악 선택'}
          </Txt>
        </Pressable>
      )}
    </View>
  );
  if (route === 'focus')
    return (
      <View style={{ flex: 1 }}>
        {focusScene}
        <View
          style={{
            position: 'absolute',
            left: (layout.width - layout.floatingWidth) / 2,
            width: layout.floatingWidth,
            bottom: ins.bottom + 12,
          }}
        >
          {fan && (
            <View
              style={{
                position: 'absolute',
                left: 0,
                bottom: 64,
                flexDirection: 'row',
                gap: 8,
                padding: 6,
                borderRadius: 999,
                borderWidth: 1.5,
                borderColor: C.brown,
                backgroundColor: '#FFFDFAD9',
              }}
            >
              {['hello', 'cheer', 'sleepy', 'laugh', 'hearts'].map((v, n) => (
                <Pressable
                  key={v}
                  accessibilityRole="button"
                  accessibilityLabel={['인사', '응원', '졸림', '웃음', '하트뿅뿅'][n]}
                  onPress={() => {
                    setEmote(v);
                    if (emoteTimer.current) clearTimeout(emoteTimer.current);
                    emoteTimer.current = setTimeout(() => setEmote(null), 3000);
                  }}
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: 22,
                    backgroundColor: emote === v ? C.soft : undefined,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Pic id={'emote/' + v} w={30} />
                </Pressable>
              ))}
            </View>
          )}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="이모티콘"
              onPress={() => setFan(!fan)}
              style={{
                width: 52,
                height: 52,
                borderRadius: 26,
                borderWidth: 2,
                borderColor: C.brown,
                backgroundColor: '#FFFDFAD0',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0px 3px 0px ' + C.brown,
              }}
            >
              <Pic id={'emote/' + (emote || 'hello')} w={32} />
            </Pressable>
            <Btn title="휴식하기" style={{ flex: 1 }} onPress={() => go('rest')} />
            <Btn title="종료" kind="glass" onPress={endFocus} />
          </View>
        </View>
      </View>
    );
  if (route === 'rest')
    return (
      <RestWorld
        state={state}
        travel={e.restTravel}
        resume={() => {
          act('RESUME');
          go('focus');
        }}
        home={home}
        endRest={() => {
          act('FINISH');
          reset('focusResult');
        }}
      />
    );
  if (route === 'sound') {
    // 17(집중 중) = 바다 위 시트, 66(섬에서) = 축음기로 다가간 섬 위 시트 + 축음기 간판. 가로 폰은 오른쪽 540 패널
    const scene = !!state.session,
      panel = layout.compact;
    const startOfToday = new Date(now).setHours(0, 0, 0, 0);
    const today = state.records
      .filter((r) => r.at >= startOfToday)
      .reduce((a, r) => a + r.seconds, 0);
    const card: any = panel
      ? {
          position: 'absolute',
          top: 0,
          bottom: 0,
          right: 0,
          width: Math.min(540 + ins.right, layout.width - ins.left - 80),
          borderLeftWidth: 2,
          borderTopLeftRadius: 30,
          borderBottomLeftRadius: 30,
          boxShadow: '-5px 0px 0px #8B695640',
          paddingTop: ins.top + 14,
          paddingLeft: 22,
          paddingRight: 22 + ins.right,
          paddingBottom: Math.max(22, ins.bottom),
        }
      : layout.tablet
        ? {
            width: layout.modalWidth,
            maxHeight: layout.height - ins.top - ins.bottom - 40,
            borderWidth: 2,
            borderRadius: 26,
            boxShadow: '0px 6px 0px ' + C.brown,
            padding: 20,
          }
        : {
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            maxHeight: layout.height - ins.top - 60,
            borderTopWidth: 2,
            borderTopLeftRadius: 26,
            borderTopRightRadius: 26,
            paddingTop: 10,
            paddingHorizontal: 20,
            paddingBottom: ins.bottom + 12,
          };
    return (
      <View style={{ flex: 1 }}>
        <View
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          aria-hidden={true}
          style={StyleSheet.absoluteFill}
        >
          {scene ? (
            focusScene
          ) : (
            <>
              <Pic id={(panel ? 'L/bldbg/' : 'bldbg/') + 'gram'} w="100%" h="100%" cover />
              {!panel && (
                <View
                  style={{
                    position: 'absolute',
                    left: 20 + ins.left,
                    top: 12 + ins.top,
                    minWidth: 210,
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 18,
                    paddingHorizontal: 14,
                    paddingVertical: 6,
                    borderRadius: 999,
                    backgroundColor: '#FFFDFA99',
                  }}
                >
                  <Txt style={{ fontSize: 12, color: C.muted }}>오늘 집중</Txt>
                  <Txt
                    style={{
                      fontSize: 22,
                      fontWeight: '700',
                      fontVariant: ['tabular-nums'],
                    }}
                  >
                    {hhmmss(today)}
                  </Txt>
                </View>
              )}
            </>
          )}
        </View>
        <Pressable
          accessible={false}
          importantForAccessibility="no-hide-descendants"
          onPress={back}
          style={[StyleSheet.absoluteFill, { backgroundColor: scene ? '#493B3940' : '#493B3938' }]}
        />
        <View
          pointerEvents="box-none"
          style={[
            StyleSheet.absoluteFill,
            layout.tablet && { alignItems: 'center', justifyContent: 'center' },
          ]}
        >
          <View style={[{ backgroundColor: C.paper, borderColor: C.brown }, card]}>
            {!panel && !layout.tablet && (
              <View
                style={{
                  width: 40,
                  height: 5,
                  borderRadius: 3,
                  backgroundColor: '#D9C6B8',
                  alignSelf: 'center',
                  marginBottom: 4,
                }}
              />
            )}
            {!scene && (
              <View
                style={{
                  position: 'absolute',
                  zIndex: 1,
                  left: panel ? -62 : 18,
                  top: panel ? 14 : -36,
                  width: panel ? 76 : 92,
                  height: panel ? 76 : 92,
                  borderRadius: 46,
                  borderWidth: 2,
                  borderColor: C.brown,
                  backgroundColor: C.paper,
                  boxShadow: '0px 4px 0px ' + C.brown,
                  alignItems: 'center',
                  justifyContent: 'center',
                  overflow: 'hidden',
                }}
              >
                <Pic id="gram" w={panel ? 58 : 72} />
              </View>
            )}
            <ScrollView
              style={{ flexGrow: 0, flexShrink: 1 }}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ gap: panel ? 8 : 12 }}
            >
              <View
                style={[
                  k.row,
                  {
                    justifyContent: 'space-between',
                    minHeight: 44,
                    paddingLeft: panel ? 8 : scene ? 0 : 100,
                  },
                ]}
              >
                <Txt kind="h17">우리 섬의 소리</Txt>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={island.playing ? '일시정지' : '재생'}
                  onPress={() => act('PLAY', { value: !island.playing })}
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: 22,
                    borderWidth: 2,
                    borderColor: C.brown,
                    backgroundColor: C.pink,
                    alignItems: 'center',
                    justifyContent: 'center',
                    boxShadow: '0px 3px 0px ' + C.brown,
                  }}
                >
                  <PlayIcon pause={island.playing} />
                </Pressable>
              </View>
              <Txt kind="meta">그룹원 누구나 바꿀 수 있어요 · 같은 섬이 함께 들어요</Txt>
              {island.buildings.includes('gram') ? (
                <>
                  <Group flat>
                    {island.sharedOwned
                      .filter((x) => names[x])
                      .map((id) => (
                        <Row
                          key={id}
                          title={names[id]}
                          lead={<MiniRadio on={island.track === id} />}
                          selected={island.track === id}
                          right={
                            island.track === id && island.playing ? (
                              <View style={[k.row, { gap: 6 }]}>
                                <Eq />
                                <Txt style={{ fontSize: 15, color: C.muted }}>재생 중</Txt>
                              </View>
                            ) : undefined
                          }
                          onPress={() => setTrack(id)}
                        />
                      ))}
                  </Group>
                  <Txt kind="section">내 기기 음량</Txt>
                  <Volume
                    value={(state.settings as any).volume ?? 0.55}
                    onChange={(value: number) => act('SETTING', { key: 'volume', value })}
                  />
                  <Row
                    title="나만 음소거"
                    sub="섬 재생은 그대로, 내 기기만 꺼요"
                    style={{ paddingHorizontal: 0 }}
                    tail={
                      <Toggle
                        label="나만 음소거"
                        value={!state.settings.sound}
                        onChange={(v: boolean) => act('SETTING', { key: 'sound', value: !v })}
                      />
                    }
                  />
                </>
              ) : (
                <>
                  <Txt>축음기를 먼저 지어 주세요.</Txt>
                  <Btn title="마을회관에서 건설" onPress={() => go('construction')} />
                </>
              )}
            </ScrollView>
          </View>
        </View>
      </View>
    );
  }
  if (route === 'focusResult') {
    // 20: 부두로 돌아온 섬 위 팝업. 카운트업이라 목표 배지 없음, 게시판 버튼 없음
    const r = state.lastResult;
    return (
      <IslandPopup
        bg="dock"
        onClose={home}
        side={
          <>
            {island.buildings.includes('board') && (
              <>
                <Txt kind="section" style={layout.compact ? { marginTop: 0 } : undefined}>
                  이번 퀘스트
                </Txt>
                <Group>
                  {island.quests.map((q) => {
                    const rate = questRate(state, q);
                    return (
                      <Row
                        key={q.id}
                        title={q.title}
                        sub={<Bar value={rate} />}
                        tail={rate === 100 ? <CheckDot /> : <Txt kind="meta">진행 중</Txt>}
                      />
                    );
                  })}
                </Group>
              </>
            )}
            <Btn
              title="섬으로 돌아가기"
              onPress={home}
              style={{ marginTop: layout.compact ? 'auto' : 4 }}
            />
          </>
        }
      >
        <View style={[k.row, { alignItems: 'flex-end', gap: 12 }]}>
          <Pic id="cat/black/sitting" w={96} />
          <View style={{ flex: 1, gap: 6, paddingBottom: 8 }}>
            <Txt kind="meta">{r?.subject || '아직 기록이 없어요.'}</Txt>
            <Txt style={[k.number, { fontSize: 44, lineHeight: 46 }]}>{clock(r?.seconds || 0)}</Txt>
          </View>
        </View>
        <View
          style={[
            k.row,
            {
              gap: 10,
              paddingVertical: 10,
              paddingHorizontal: 12,
              borderRadius: 16,
              borderWidth: 1.5,
              borderColor: C.brown,
              backgroundColor: '#E3F4FC',
            },
          ]}
        >
          <Pic id="fish" w={36} />
          <View style={{ gap: 1 }}>
            <Txt
              style={{
                fontSize: 22,
                lineHeight: 24,
                fontWeight: '800',
                fontVariant: ['tabular-nums'],
              }}
            >
              +{r?.fish || 0}
            </Txt>
            <Txt kind="meta" style={{ fontSize: 12, lineHeight: 14 }}>
              물고기
            </Txt>
          </View>
        </View>
      </IslandPopup>
    );
  }
  if (['hall', 'stats', 'ledger'].includes(route)) {
    const records = state.records.filter(
        (r) =>
          r.islandId === island.id && r.at > Date.now() - (period === '주' ? 7 : 30) * 86400000,
      ),
      total = records.reduce((s, r) => s + r.seconds, 0),
      days = Array.from({ length: 7 }, (_, i) =>
        records
          .filter((r) => new Date(r.at).getDay() === (i + 1) % 7)
          .reduce((s, r) => s + r.seconds / 60, 0),
      );
    const periodSeg = (
      <Seg
        small
        items={['주', '월']}
        value={period}
        onChange={setPeriod}
        style={{ width: 88, height: 32 }}
      />
    );
    // 24: 회관 기록 판의 "주민 N명의 기록 보기"로 들어오는 시트 안 2단계(stats + detail "residents")
    if (detail === 'residents')
      return (
        <IslandSheet bg="hall" sign="bld/hall" title="주민 기록" onBack={back} onClose={home}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            {periodSeg}
            <Txt kind="meta" style={{ flex: 1 }}>
              이번 {period} · 매일의 공부 시간은 모두에게 보여요
            </Txt>
          </View>
          <Group>
            <Row
              title={state.name + ' · 나'}
              icon={'avatar/' + state.color}
              sub={<Bar value={100} />}
              right={clock(total)}
            />
            {island.members.map((m) => (
              <Row
                key={m.id}
                title={m.name}
                icon={'avatar/' + m.color}
                sub={<Bar value={Math.min(100, m.seconds / 36)} />}
                right={clock(m.seconds)}
              />
            ))}
          </Group>
        </IslandSheet>
      );
    const head = (icon: string, title: string, right: any) => (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Icon name={icon} size={20} />
        <Txt style={{ flex: 1, fontSize: 17, lineHeight: 23, fontWeight: '800' }}>{title}</Txt>
        {right}
      </View>
    );
    const big = (value: string, meta: string) => (
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'baseline',
          flexWrap: 'wrap',
          gap: 10,
        }}
      >
        <Txt style={[k.number, { fontSize: 36, lineHeight: 42 }]}>{value}</Txt>
        <Txt kind="meta">{meta}</Txt>
      </View>
    );
    const divider = (
      <View
        style={{
          height: 2,
          borderRadius: 1,
          marginVertical: 2,
          backgroundColor: '#8B695622',
        }}
      />
    );
    // 22~25: 스위치 없이 집중 → 스크린타임 → 주민 기록이 한 판에 이어진다
    return hall(
      '기록',
      <>
        <View style={{ gap: 10 }}>
          {head('clock', '집중', periodSeg)}
          {big(
            `${Math.floor(total / 3600)}:${pad(Math.floor(total / 60) % 60)}`,
            `이번 ${period} · ${period === '주' ? 7 : 30}일 합계`,
          )}
          <Graph values={days} />
          <Txt kind="section">최근 기록</Txt>
          <Group flat>
            {records.length ? (
              records
                .slice()
                .reverse()
                .map((r) => (
                  <Row key={r.id} title={r.subject} sub={md(r.at)} right={clock(r.seconds)} />
                ))
            ) : (
              <Row title="아직 기록이 없어요" />
            )}
          </Group>
        </View>
        {divider}
        <View style={{ gap: 10 }}>
          {head('phone', '스크린타임', <Txt kind="meta">오늘</Txt>)}
          {state.settings.permission ? (
            <>
              {big(
                `${Math.floor(state.screenMinutes / 60)}시간 ${state.screenMinutes % 60}분`,
                '오늘 · 스크린타임 연결됨',
              )}
              <Graph values={[0, 0, 0, 0, 0, 0, state.screenMinutes]} />
              <Group flat>
                <Row title="오늘 폰 사용" sub={md(now)} right={state.screenMinutes + '분'} />
                <Row
                  title="측정 권한"
                  sub="앱 설정에서 켜고 끌 수 있어요"
                  chevron
                  onPress={() => go('settings')}
                />
              </Group>
            </>
          ) : (
            <>
              <View
                style={{
                  paddingVertical: 22,
                  paddingHorizontal: 18,
                  gap: 8,
                  borderRadius: 18,
                  borderWidth: 2,
                  borderStyle: 'dashed',
                  borderColor: '#D9C6B8',
                  alignItems: 'center',
                }}
              >
                <Txt kind="h17">스크린타임 연결이 꺼져 있어요</Txt>
                <Txt kind="meta" style={{ textAlign: 'center' }}>
                  연결하면 오늘 폰 사용 시간을 여기서 볼 수 있어요.{'\n'}기록이 없는 것과 0분은
                  달라요.
                </Txt>
                <Btn
                  title="설정에서 켜기"
                  small
                  kind="sec"
                  style={{ marginTop: 4 }}
                  onPress={() => go('settings')}
                />
              </View>
              <Group flat>
                <Row title="아직 기록이 없어요" sub="연결한 날부터 쌓여요" />
              </Group>
            </>
          )}
        </View>
        {divider}
        <Group flat>
          <Row
            lead={
              <AvStack list={[state.color, ...island.members.map((m) => m.color)].slice(0, 3)} />
            }
            title={`주민 ${island.members.length + 1}명의 기록 보기`}
            sub="매일의 공부 시간은 모두에게 보여요"
            chevron
            onPress={() => go('stats', 'residents')}
          />
        </Group>
      </>,
    );
  }
  if (route === 'manage' || route === 'members') {
    const shareInvite = () =>
      Share.share({
        message: `${island.name}에 함께해요! 초대 코드: ${inviteCodeOf(island)}`,
      }).catch(() => notify('초대 코드: ' + inviteCodeOf(island)));
    const saveEdit = () => {
      act('MANAGE', { name: text || island.name, intro: body || island.intro });
      setEditing(false);
      notify('저장했어요.');
    };
    const people = [
      { id: 'me', name: state.name, color: state.color, isHost: host },
      ...island.members.map((m) => ({
        id: m.id,
        name: m.name,
        color: m.color,
        isHost: m.role === 'host',
      })),
    ];
    const member = island.members.find((m) => m.id === memberMenu);
    // 정원은 지금 주민 수보다 작게 줄일 수 없다
    const minCapacity = Math.max(CAPACITY_MIN, residentCount(island));
    const capacityItems = Array.from(
      { length: Math.max(0, CAPACITY_MAX - minCapacity + 1) },
      (_, n) => n + minCapacity + '명',
    );
    const panelW = Math.min(540 + ins.right, layout.width - ins.left - 80);
    const option = (title: string, onPress: () => void, tone = '') => (
      <Pressable
        key={title}
        accessibilityRole="button"
        accessibilityLabel={title}
        onPress={onPress}
        style={{
          height: 54,
          borderRadius: 14,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: tone === 'cancel' ? C.cream : undefined,
        }}
      >
        <Txt
          style={{
            fontSize: 17,
            fontWeight: '700',
            color: tone === 'red' ? '#B84A32' : tone === 'cancel' ? C.muted : C.ink,
          }}
        >
          {title}
        </Txt>
      </Pressable>
    );
    // 액션 시트·정원 팝업이 떠 있으면 뒤 시트는 스크린리더에서 숨긴다
    const covered = !!member || capacityOpen;
    return (
      <View style={{ flex: 1 }}>
        <View
          style={{ flex: 1 }}
          accessibilityElementsHidden={covered}
          importantForAccessibility={covered ? 'no-hide-descendants' : 'auto'}
          aria-hidden={covered}
        >
          <IslandSheet
            keepOnBackdrop
            bg="hall"
            sign="bld/hall"
            title="섬 관리"
            tall
            onBack={back}
            onClose={home}
            action={editing ? '완료' : undefined}
            actionPress={saveEdit}
            footer={member ? undefined : footer('친구 초대하기', shareInvite)}
          >
            {editing ? (
              <>
                <Field label="섬 이름" value={text} onChange={setText} />
                <Field label="섬 소개" value={body} onChange={setBody} multiline />
              </>
            ) : (
              <>
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 10,
                  }}
                >
                  <Txt kind="h" style={{ flexShrink: 1 }}>
                    {island.name}
                  </Txt>
                  {host && (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="섬 이름·소개 수정"
                      onPress={() => {
                        setText(island.name);
                        setBody(island.intro);
                        setEditing(true);
                      }}
                      style={{
                        width: 34,
                        height: 34,
                        borderRadius: 17,
                        borderWidth: 1.5,
                        borderColor: C.brown,
                        backgroundColor: C.paper,
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <Icon name="pencil" size={16} />
                    </Pressable>
                  )}
                </View>
                {!!island.intro && (
                  <Txt kind="meta" style={{ marginTop: -6 }}>
                    {island.intro}
                  </Txt>
                )}
              </>
            )}
            <Group flat>
              <Row
                title="승인 후 가입"
                tail={
                  <Toggle
                    label="승인 후 가입"
                    value={island.approval}
                    onChange={(v: boolean) =>
                      host ? act('MANAGE', { approval: v }) : notify('방장만 바꿀 수 있어요.')
                    }
                  />
                }
              />
              <Row
                title="정원"
                sub={`최대 ${CAPACITY_MAX}명`}
                right={`${capacityOf(island)}명`}
                chevron={host}
                onPress={
                  host
                    ? () => {
                        setCapacityPick(capacityOf(island) + '명');
                        setCapacityOpen(true);
                      }
                    : undefined
                }
              />
            </Group>
            {host && !island.requestResolved && (
              <>
                <Txt kind="section">
                  가입 요청{' '}
                  <Txt kind="section" style={{ color: '#D95C7F' }}>
                    1
                  </Txt>
                </Txt>
                <Group>
                  <Row
                    title="새봄"
                    icon="avatar/white"
                    sub={'어제 · "같이 집중하고 싶어요"'}
                    style={{ backgroundColor: '#FFF3CF' }}
                    tail={
                      <View style={{ flexDirection: 'row', gap: 6 }}>
                        <Btn
                          small
                          title="승인"
                          onPress={() =>
                            isFull(island)
                              ? notify('정원이 가득 찼어요. 정원을 늘린 뒤 승인해 주세요.')
                              : act('ADD_MEMBER')
                          }
                        />
                        <Btn
                          small
                          kind="sec"
                          title="거절"
                          onPress={() =>
                            confirm('가입 요청을 거절할까요?', '새봄님의 요청을 거절해요.', () =>
                              act('REJECT_MEMBER'),
                            )
                          }
                        />
                      </View>
                    }
                  />
                </Group>
              </>
            )}
            <Txt kind="section">주민 {people.length}</Txt>
            {/* 명부 타일: 고양이 사진 · 방장 왕관 · 나는 분홍. 방장이 다른 주민 타일을 누르면 액션 시트 */}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
              {people.map((p) => {
                const selected = memberMenu === p.id;
                const tile = (
                  <>
                    <View
                      style={{
                        width: '100%',
                        aspectRatio: 1,
                        borderRadius: 16,
                        borderWidth: 2,
                        borderColor: C.brown,
                        backgroundColor: p.id === 'me' ? C.soft : '#E3F4FC',
                        alignItems: 'center',
                        justifyContent: 'center',
                        boxShadow: '0px 3px 0px ' + C.brown,
                        outlineWidth: selected ? 3 : 0,
                        outlineStyle: 'solid',
                        outlineColor: C.pink,
                        outlineOffset: 2,
                      }}
                    >
                      <Pic id={'cat/' + p.color} w="86%" h="86%" />
                      {p.isHost && (
                        <View
                          style={{
                            position: 'absolute',
                            top: -8,
                            right: -8,
                            width: 26,
                            height: 26,
                            borderRadius: 13,
                            borderWidth: 1.5,
                            borderColor: C.brown,
                            backgroundColor: C.butter,
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >
                          <Icon name="crown" size={14} stroke={2.4} fill={C.butter} />
                        </View>
                      )}
                    </View>
                    <Txt
                      numberOfLines={1}
                      style={{
                        fontSize: 13,
                        lineHeight: 18,
                        fontWeight: '700',
                      }}
                    >
                      {p.name}
                      {p.id === 'me' ? ' · 나' : ''}
                    </Txt>
                  </>
                );
                const style = {
                  width: '22.5%',
                  alignItems: 'center',
                  gap: 5,
                } as const;
                return host && p.id !== 'me' ? (
                  <Pressable
                    key={p.id}
                    accessibilityRole="button"
                    accessibilityLabel={p.name + ' 메뉴'}
                    accessibilityState={{ selected }}
                    onPress={() => setMemberMenu(p.id)}
                    style={style}
                  >
                    {tile}
                  </Pressable>
                ) : (
                  <View key={p.id} style={style}>
                    {tile}
                  </View>
                );
              })}
            </View>
            <Btn
              title="섬 탈퇴"
              kind="danger"
              style={{ alignSelf: 'center' }}
              onPress={() =>
                confirm('섬에서 나갈까요?', '이 섬의 주민 목록에서 나가요.', () => {
                  const hasOtherIsland = state.islands.some(
                    (candidate) => candidate.joined && candidate.id !== island.id,
                  );
                  act('LEAVE');
                  if (hasOtherIsland) home();
                  else reset('chooseIsland');
                })
              }
            />
          </IslandSheet>
        </View>
        {member && (
          // 28: 주민 액션 시트(시트 아래, 가로 폰은 패널 안)
          <View style={StyleSheet.absoluteFill}>
            <Pressable
              accessible={false}
              importantForAccessibility="no-hide-descendants"
              onPress={() => setMemberMenu(null)}
              style={[StyleSheet.absoluteFill, { backgroundColor: '#493B3955' }]}
            />
            <View
              style={[
                {
                  position: 'absolute',
                  bottom: 0,
                  gap: 6,
                  paddingTop: 10,
                  paddingHorizontal: 12,
                  paddingBottom: ins.bottom + 12,
                  backgroundColor: C.paper,
                  borderColor: C.brown,
                },
                layout.compact
                  ? {
                      right: 0,
                      width: panelW,
                      paddingRight: 12 + ins.right,
                      borderTopWidth: 2,
                      borderLeftWidth: 2,
                      borderTopLeftRadius: 26,
                    }
                  : layout.tablet
                    ? {
                        left: (layout.width - layout.modalWidth) / 2,
                        width: layout.modalWidth,
                        bottom: ins.bottom + 24,
                        borderWidth: 2,
                        borderRadius: 26,
                      }
                    : {
                        left: 0,
                        right: 0,
                        borderTopWidth: 2,
                        borderTopLeftRadius: 26,
                        borderTopRightRadius: 26,
                      },
              ]}
            >
              <Txt kind="meta" style={{ textAlign: 'center', paddingTop: 6, paddingBottom: 4 }}>
                {member.name}
              </Txt>
              {option('방장 위임', () =>
                confirm('방장을 위임할까요?', `${member.name}님에게 방장 권한을 넘겨요.`, () => {
                  act('TRANSFER', { id: member.id });
                  setMemberMenu(null);
                }),
              )}
              {option(
                '섬에서 내보내기',
                () =>
                  confirm('주민을 내보낼까요?', `${member.name}님이 이 섬에서 나가요.`, () => {
                    act('KICK', { id: member.id });
                    setMemberMenu(null);
                  }),
                'red',
              )}
              {option('취소', () => setMemberMenu(null), 'cancel')}
            </View>
          </View>
        )}
        {capacityOpen && (
          // 정원 행을 누르면 뜨는 작은 드럼 팝업
          <View
            style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}
          >
            <Pressable
              accessible={false}
              importantForAccessibility="no-hide-descendants"
              onPress={() => setCapacityOpen(false)}
              style={[StyleSheet.absoluteFill, { backgroundColor: '#493B3955' }]}
            />
            <View
              style={{
                width: layout.compact ? 400 : layout.modalWidth,
                gap: 10,
                paddingTop: 20,
                paddingHorizontal: 20,
                paddingBottom: 18,
                borderRadius: 22,
                borderWidth: 2,
                borderColor: C.brown,
                backgroundColor: C.paper,
                boxShadow: '0px 6px 0px ' + C.brown,
              }}
            >
              <Txt kind="h17">정원</Txt>
              <Txt kind="meta">
                지금 주민 {residentCount(island)}명보다 적게 줄일 수 없어요. 최대 {CAPACITY_MAX}명
              </Txt>
              <View style={k.row}>
                <Wheel
                  a11yLabel="정원"
                  items={capacityItems}
                  value={capacityPick}
                  onChange={setCapacityPick}
                />
              </View>
              <View style={[k.row, { justifyContent: 'flex-end' }]}>
                <Btn title="취소" kind="ghost" onPress={() => setCapacityOpen(false)} />
                <Btn
                  title="정원 저장"
                  onPress={() => {
                    const value = parseInt(capacityPick);
                    act('CAPACITY', { value });
                    setCapacityOpen(false);
                    notify(`정원을 ${value}명으로 바꿨어요.`);
                  }}
                />
              </View>
            </View>
          </View>
        )}
      </View>
    );
  }
  if (route === 'construction') {
    const selected =
        island.nextBuilding ||
        (['tower', 'mail', 'gram', 'shop'] as Building[]).find(
          (b) => !island.buildings.includes(b),
        ) ||
        'tower',
      all = ['tower', 'mail', 'gram', 'shop'] as Building[];
    // 상점 설명의 "배" 꾸미기는 정책상 뺐다(배는 기본 뗏목 고정)
    const desc = {
      tower: '다른 섬 기록 보기 · 다른 섬 참가',
      mail: '섬 전체 편지방',
      gram: '집중 중 함께 듣는 소리',
      shop: '캐릭터·섬 꾸미기',
    };
    return hall(
      '마을 발전',
      <>
        <Strip label="섬 물고기" value={island.points.toLocaleString() + 'P'} />
        {/* 건물 카드: 세로 2열, 가로 폰 4열. 선택 = 분홍 + 체크, 잠김·완료·방장 아님 = 흐리게 */}
        <View
          style={{
            flexDirection: 'row',
            flexWrap: 'wrap',
            gap: layout.compact ? 10 : 12,
          }}
        >
          {all.map((b) => {
            const made = island.buildings.includes(b),
              locked =
                b === 'shop' &&
                (!island.buildings.includes('tower') || !island.buildings.includes('mail')),
              on = selected === b,
              disabled = made || locked || !host;
            return (
              <Pressable
                key={b}
                accessibilityRole="button"
                accessibilityLabel={buildingNames[b]}
                accessibilityState={{ selected: on, disabled }}
                disabled={disabled}
                onPress={() => act('SELECT_BUILDING', { building: b })}
                style={{
                  width: layout.compact ? '23%' : '48%',
                  alignItems: 'center',
                  gap: 4,
                  paddingTop: 8,
                  paddingHorizontal: layout.compact ? 6 : 10,
                  paddingBottom: layout.compact ? 8 : 10,
                  borderRadius: 18,
                  borderWidth: 2,
                  borderColor: C.brown,
                  backgroundColor: on ? C.soft : C.paper,
                  boxShadow: on ? '0px 4px 0px ' + C.brown : 'none',
                  opacity: disabled ? 0.45 : 1,
                }}
              >
                <View
                  style={{
                    width: '100%',
                    height: layout.compact ? 66 : 84,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Pic
                    id={b === 'gram' ? 'gram' : 'bld/' + buildingArt[b]}
                    w={layout.compact ? 62 : 80}
                  />
                </View>
                <Txt
                  style={{
                    fontSize: layout.compact ? 14 : 16,
                    fontWeight: '800',
                    textAlign: 'center',
                  }}
                >
                  {buildingNames[b]}
                </Txt>
                <Txt style={{ fontSize: 15, fontWeight: '800', color: '#D95C7F' }}>
                  {made ? '건설 완료' : costs[b] + 'P'}
                </Txt>
                <Txt
                  kind="meta"
                  style={{
                    fontSize: layout.compact ? 11 : 12,
                    lineHeight: 16,
                    textAlign: 'center',
                  }}
                >
                  {desc[b as keyof typeof desc]}
                </Txt>
                {on && (
                  <View style={{ position: 'absolute', right: 10, top: 10 }}>
                    <CheckDot size={24} />
                  </View>
                )}
                {locked && (
                  <View
                    style={{
                      position: 'absolute',
                      left: 10,
                      top: 10,
                      paddingHorizontal: 8,
                      paddingVertical: 1,
                      borderRadius: 999,
                      borderWidth: 1.5,
                      borderColor: '#D9C6B8',
                      backgroundColor: C.paper,
                    }}
                  >
                    <Txt
                      style={{
                        fontSize: 12,
                        fontWeight: '700',
                        color: C.muted,
                      }}
                    >
                      전망대·우체통 먼저
                    </Txt>
                  </View>
                )}
              </Pressable>
            );
          })}
        </View>
      </>,
      footer(
        island.buildings.includes(selected)
          ? '건설 완료'
          : `${buildingNames[selected]} 짓기 · ${costs[selected]}P`,
        () => build(selected),
        undefined,
        undefined,
        `건설 후 잔액 ${Math.max(0, island.points - costs[selected]).toLocaleString()}P`,
        !!canBuild(state, selected),
      ),
    );
  }
  const editQuest = (q: any) => {
    go('questEdit', q.id);
    setText(q.title);
    setBody(q.type);
    setQuestHours(Math.floor(q.target / 60) + '시간');
    setQuestMins(pad(q.target % 60) + '분');
    e.setWindowStart(q.windowStart || '00:00');
    e.setWindowEnd(q.windowEnd || '24:00');
  };
  if (route === 'board') {
    // 32·37: 섬 위 나무 게시판. 탭은 실제로 전환되고, 쪽지를 누르면 상세로
    const onNotice = tab === '공지';
    return (
      <WoodBoard
        tab={onNotice ? 'notice' : 'quest'}
        onTab={(t) => setTab(t === 'notice' ? '공지' : '퀘스트')}
        onMake={() =>
          !host
            ? notify('방장만 만들 수 있어요.')
            : onNotice
              ? go('noticeEdit')
              : (setQuestHours('0시간'), setQuestMins('30분'), newQuest())
        }
        onClose={home}
      >
        {onNotice
          ? island.notices.map((n, i) => {
              const author = n.author || '알 수 없음';
              return (
                <NoticePaper
                  key={n.id}
                  i={i}
                  title={n.title}
                  meta={n.at ? `${author} · ${md(n.at)}` : author}
                  comments={n.comments.length}
                  badge={isHostName(author) ? '방장' : undefined}
                  onPress={() => go('notice', n.id)}
                />
              );
            })
          : island.quests.map((q, i) => (
              <QuestNote
                key={q.id}
                i={i}
                title={q.title}
                pct={questRate(state, q)}
                onPress={() => go('quest', q.id)}
              />
            ))}
      </WoodBoard>
    );
  }
  if (route === 'quest') {
    const q = island.quests.find((q) => q.id === detail) || island.quests[0];
    if (!q)
      return (
        <IslandSheet
          bg="board"
          sign="bld/notice-board"
          title="그룹원 달성률"
          tall
          onBack={back}
          onClose={home}
        >
          <Txt>진행 중인 퀘스트가 없어요.</Txt>
        </IslandSheet>
      );
    const rate = questRate(state, q);
    const people: {
      id: string;
      name: string;
      color: string;
      pct: number | null;
    }[] = [
      { id: 'me', name: state.name, color: state.color, pct: rate },
      ...island.members.map((m, i) => ({
        id: m.id,
        name: m.name,
        color: m.color,
        pct: [100, 80, 35][i % 3],
      })),
    ];
    return (
      <IslandSheet
        bg="board"
        sign="bld/notice-board"
        title="그룹원 달성률"
        tall
        onBack={back}
        onClose={home}
        action={host ? '수정' : undefined}
        actionPress={() => editQuest(q)}
        footer={footer(
          q.claimed ? '보상 받음' : '달성 보상 받기 · 10P',
          () => {
            act('CLAIM', { id: q.id });
            notify('섬 물고기 10P를 받았어요.');
          },
          undefined,
          undefined,
          '모두 100%가 되면 섬 물고기가 섬에 쌓여요',
          q.claimed || rate !== 100,
        )}
      >
        <Txt kind="h">{q.title}</Txt>
        <Txt kind="meta">
          {q.type === 'focus'
            ? `${q.windowStart || '00:00'} – ${q.windowEnd || '24:00'} · ${q.target}분 집중 · 시간대 집중 퀘스트`
            : '하루 폰 사용 · 스크린타임 기준 · 다음 날 정산'}
        </Txt>
        {/* 현상수배 포스터: 세로 2열, 가로 폰 4열. 100%면 분홍 "달성" 도장 */}
        <View
          style={{
            flexDirection: 'row',
            flexWrap: 'wrap',
            gap: 12,
            paddingTop: 4,
            paddingHorizontal: 4,
          }}
        >
          {people.map((p, n) => {
            const done = p.pct === 100;
            return (
              <View
                key={p.id}
                style={{
                  width: layout.compact ? '22.5%' : '47.5%',
                  alignItems: 'center',
                  gap: 4,
                  paddingTop: 8,
                  paddingHorizontal: 8,
                  paddingBottom: 10,
                  borderRadius: 8,
                  borderWidth: 2,
                  borderColor: C.brown,
                  backgroundColor: '#F7EAD0',
                  boxShadow: '0px 4px 0px ' + C.brown,
                  transform: [{ rotate: n % 2 ? '1.1deg' : '-1.2deg' }],
                }}
              >
                <View
                  pointerEvents="none"
                  style={{
                    position: 'absolute',
                    left: 4,
                    right: 4,
                    top: 4,
                    bottom: 4,
                    borderRadius: 5,
                    borderWidth: 1.5,
                    borderStyle: 'dashed',
                    borderColor: '#8B695666',
                  }}
                />
                <View
                  style={{
                    width: '100%',
                    aspectRatio: 4 / 3,
                    borderRadius: 6,
                    borderWidth: 1.5,
                    borderColor: C.brown,
                    backgroundColor: '#E3F4FC',
                    alignItems: 'center',
                    justifyContent: 'center',
                    overflow: 'hidden',
                  }}
                >
                  <Pic id={'cat/' + p.color} w="88%" h="88%" />
                </View>
                <Txt numberOfLines={1} style={{ marginTop: 2, fontSize: 15, fontWeight: '800' }}>
                  {p.name}
                </Txt>
                <Txt
                  style={{
                    fontSize: p.pct === null ? 15 : 23,
                    lineHeight: 26,
                    fontWeight: '800',
                    fontVariant: ['tabular-nums'],
                    color: done ? '#D95C7F' : C.ink,
                  }}
                >
                  {p.pct === null ? '확인 필요' : p.pct + '%'}
                </Txt>
                <View style={{ alignSelf: 'stretch' }}>
                  <Bar value={p.pct} />
                </View>
                {done && (
                  <View
                    style={{
                      position: 'absolute',
                      right: 8,
                      top: 30,
                      paddingHorizontal: 6,
                      paddingVertical: 1,
                      borderRadius: 6,
                      borderWidth: 2,
                      borderColor: '#D95C7F',
                      backgroundColor: '#FFFDFAD9',
                      transform: [{ rotate: '14deg' }],
                    }}
                  >
                    <Txt
                      style={{
                        fontSize: 11,
                        lineHeight: 15,
                        fontWeight: '800',
                        color: '#D95C7F',
                      }}
                    >
                      달성
                    </Txt>
                  </View>
                )}
              </View>
            );
          })}
        </View>
      </IslandSheet>
    );
  }
  if (route === 'questEdit') {
    const type = body === 'screen' ? 'screen' : 'focus',
      target = parseInt(questHours) * 60 + parseInt(questMins),
      hours = Array.from({ length: 25 }, (_, i) => pad(i) + ':00');
    return (
      <IslandSheet
        bg="board"
        sign="bld/notice-board"
        title={detail ? '퀘스트 수정' : '퀘스트 만들기'}
        tall
        onBack={back}
        onClose={home}
        keepOnBackdrop
        footer={footer(
          '게시판에 붙이기',
          () => {
            act('QUEST_SAVE', {
              id: detail,
              title: text,
              kind: type,
              target,
              windowStart: e.windowStart,
              windowEnd: e.windowEnd,
            });
            replace('board');
          },
          undefined,
          undefined,
          undefined,
          !text.trim() || target <= 0 || (type === 'focus' && e.windowStart >= e.windowEnd),
        )}
      >
        <Seg
          items={['집중 시간', '폰 사용 시간']}
          value={type === 'focus' ? '집중 시간' : '폰 사용 시간'}
          onChange={(v: string) => setBody(v === '집중 시간' ? 'focus' : 'screen')}
        />
        <Field
          label="퀘스트 제목"
          value={text}
          onChange={setText}
          placeholder={type === 'focus' ? '저녁에 한 시간 집중하기' : '오늘 폰 사용 두 시간 이내'}
        />
        {type === 'focus' && (
          <>
            <Txt kind="meta">집중 시간대</Txt>
            <View style={k.row}>
              <Wheel
                row={layout.compact ? 33 : 44}
                label="시작"
                items={hours.slice(0, 24)}
                value={e.windowStart}
                onChange={e.setWindowStart}
              />
              <Wheel
                row={layout.compact ? 33 : 44}
                label="끝"
                items={hours.slice(1)}
                value={e.windowEnd}
                onChange={e.setWindowEnd}
              />
            </View>
          </>
        )}
        <Txt kind="meta">
          {type === 'focus' ? '이 시간대 안에서 집중할 시간' : '하루 폰 사용 상한'}
        </Txt>
        <View style={k.row}>
          <Wheel
            row={layout.compact ? 33 : 44}
            label="시간"
            items={Array.from({ length: 25 }, (_, i) => i + '시간')}
            value={questHours}
            onChange={setQuestHours}
          />
          <Wheel
            row={layout.compact ? 33 : 44}
            label="분"
            items={Array.from({ length: 12 }, (_, i) => pad(i * 5) + '분')}
            value={questMins}
            onChange={setQuestMins}
          />
        </View>
        {type === 'screen' && <Txt kind="meta">스크린타임을 연결한 주민만 달성률이 계산돼요.</Txt>}
      </IslandSheet>
    );
  }
  const tabletMail = route === 'mail' && layout.tablet;
  const composer = (placeholder: string, send: () => void) => (
    <View style={[k.row, { gap: 10 }]}>
      <View style={{ flex: 1 }}>
        <Field
          placeholder={placeholder}
          value={text}
          onChange={setText}
          inputStyle={
            tabletMail
              ? {
                  fontSize: 18,
                  lineHeight: 26,
                  minHeight: 58,
                  paddingVertical: 14,
                }
              : undefined
          }
          placeholderColor={tabletMail ? C.muted : undefined}
          tabletScale={tabletMail ? 1 : undefined}
        />
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="보내기"
        disabled={!text.trim()}
        onPress={send}
        style={{
          width: tabletMail ? 56 : 48,
          height: tabletMail ? 56 : 48,
          borderRadius: tabletMail ? 28 : 24,
          borderWidth: 2,
          borderColor: C.brown,
          backgroundColor: C.pink,
          opacity: text.trim() ? 1 : 0.4,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Icon name="send" size={tabletMail ? 24 : 20} stroke={2.4} />
      </Pressable>
    </View>
  );
  if (route === 'notice') {
    const n = island.notices.find((n) => n.id === detail) || island.notices[0];
    if (!n)
      return (
        <IslandSheet
          bg="board"
          sign="bld/notice-board"
          title="공지"
          tall
          onBack={back}
          onClose={home}
        />
      );
    const author = n.author || '알 수 없음';
    return (
      <IslandSheet
        keepOnBackdrop
        bg="board"
        sign="bld/notice-board"
        title="공지"
        tall
        onBack={back}
        onClose={home}
        action={host ? '수정' : undefined}
        actionPress={() => {
          go('noticeEdit', n.id);
          setText(n.title);
          setBody(n.body);
        }}
        footer={composer('댓글을 남겨요', () => {
          act('COMMENT', { id: n.id, text });
          setText('');
        })}
      >
        <Txt kind="h">{n.title}</Txt>
        <Txt kind="meta">
          {[author, isHostName(author) && '방장', n.at && md(n.at)].filter(Boolean).join(' · ')}
        </Txt>
        <Txt>{n.body}</Txt>
        <View style={{ height: 1, backgroundColor: '#8B695633', marginVertical: 2 }} />
        <Txt kind="section">댓글 {n.comments.length}</Txt>
        {n.comments.map((c) => (
          <ChatBubble
            key={c.id}
            name={c.name}
            text={c.text}
            color="ginger"
            at={c.at ? hm(c.at) : ''}
            avatar={36}
          />
        ))}
      </IslandSheet>
    );
  }
  if (route === 'noticeEdit')
    return (
      <IslandSheet
        bg="board"
        sign="bld/notice-board"
        title={detail ? '공지 수정' : '공지 작성'}
        tall
        onBack={back}
        onClose={home}
        keepOnBackdrop
        action={detail ? '삭제' : undefined}
        actionPress={() =>
          confirm('공지를 삭제할까요?', '삭제한 공지는 되돌릴 수 없어요.', () => {
            act('NOTICE_DELETE', { id: detail });
            replace('board');
            setTab('공지');
          })
        }
        footer={footer(
          '공지 저장',
          () => {
            act('NOTICE_SAVE', { id: detail, title: text, body });
            replace('board');
            setTab('공지');
          },
          undefined,
          undefined,
          undefined,
          !text.trim() || !body.trim(),
        )}
      >
        <Field label="제목" value={text} onChange={setText} />
        <Field label="본문" value={body} onChange={setBody} multiline />
      </IslandSheet>
    );
  if (route === 'tower') {
    const ranking = [
      {
        id: 'me',
        name: state.name + ' · 나',
        color: state.color,
        seconds: state.records
          .filter((r) => r.islandId === island.id)
          .reduce((s, r) => s + r.seconds, 0),
      },
      ...island.members,
    ].sort((a, b) => b.seconds - a.seconds);
    const between = tab === '섬 간 랭킹';
    // 섬 간 랭킹은 주민 평균 집중(이번 주) 순서
    const islands = state.islands
      .filter((i) => !i.closed && i.visibility !== 'private')
      .map((i) => ({ i, avg: islandWeeklyAverage(state, i, now) }))
      .sort((a, b) => b.avg - a.avg);
    const avatar = {
      borderRadius: 14,
      backgroundColor: C.sky,
      borderWidth: 1.5,
      borderColor: C.brown,
    };
    const rankNo = (n: number) => (
      <Txt
        style={{
          width: 26,
          fontWeight: '800',
          fontSize: 18,
          textAlign: 'center',
        }}
      >
        {n + 1}
      </Txt>
    );
    return (
      <IslandSheet
        bg="tower"
        sign="bld/observatory"
        title="전망대"
        action="섬 찾기"
        actionPress={() => go('explore')}
        onClose={home}
      >
        <FTabs
          items={[
            ['우리 섬 주민', 'group'],
            ['섬 간 랭킹', 'medal'],
          ]}
          value={between ? '섬 간 랭킹' : '우리 섬 주민'}
          onChange={setTab}
        />
        <Txt kind="meta">
          {between ? '주민 평균 집중 시간 기준' : '이번 주 집중 시간 · 월요일에 새로 시작해요'}
        </Txt>
        <Group>
          {between
            ? islands.map(({ i, avg }, n) => (
                <Row
                  key={i.id}
                  title={i.name}
                  sub={`평균 ${hoursMinutes(avg)} · 주민 ${residentCount(i)}`}
                  lead={rankNo(n)}
                  tail={
                    <View style={{ width: 64 }}>
                      <Thumb h={44} warm={i.id === 'strawberry'} />
                    </View>
                  }
                  style={n === 0 ? { backgroundColor: '#FFF3CF' } : undefined}
                  chevron={i.id !== island.id}
                  onPress={
                    i.id === island.id
                      ? undefined
                      : () => {
                          setVisited(i.id);
                          go('visit', i.id);
                        }
                  }
                />
              ))
            : ranking.map((m, n) => (
                <Row
                  key={m.id}
                  title={m.name}
                  // 1위는 아바타 52px
                  icon={n === 0 ? undefined : 'avatar/' + m.color}
                  lead={
                    <>
                      {rankNo(n)}
                      {n === 0 && <Pic id={'avatar/' + m.color} w={52} style={avatar} />}
                    </>
                  }
                  right={clock(m.seconds)}
                  sub={n === 0 ? '이번 주 집중' : undefined}
                  style={n === 0 ? { backgroundColor: '#FFF3CF' } : undefined}
                />
              ))}
        </Group>
      </IslandSheet>
    );
  }
  if (route === 'explore') {
    const query = search.trim();
    const codeTarget = findIslandByInviteCode(state.islands, query)?.id;
    // 이름 검색 결과에서 정원이 찬 섬(내가 가입하지 않은)은 뺀다. 초대 코드로 찾은 섬은 보여 주고 가입할 때 막는다
    const results = state.islands.filter(
      (i) =>
        (!i.closed &&
          i.visibility !== 'private' &&
          (!query || i.name.includes(query)) &&
          (i.joined || !isFull(i))) ||
        (!i.closed && i.id === codeTarget),
    );
    return (
      <IslandSheet
        bg="tower"
        sign="bld/observatory"
        title="섬 찾기"
        tall
        onBack={back}
        onClose={home}
      >
        <View>
          <Field
            placeholder="섬 이름이나 초대 코드"
            value={search}
            onChange={setSearch}
            inputStyle={{ paddingLeft: 42 }}
          />
          <View
            pointerEvents="none"
            style={{
              position: 'absolute',
              left: 14,
              top: 0,
              bottom: 0,
              justifyContent: 'center',
            }}
          >
            <Txt style={{ fontSize: 16 }}>🔍</Txt>
          </View>
        </View>
        <Txt kind="meta">
          섬 이름이나 초대 코드를 입력해요. 이미 참가한 섬은 소속됨으로 표시돼요.
        </Txt>
        <Group>
          {results.map((i) => (
            <Row
              key={i.id}
              title={i.name}
              sub={`${i.intro} · 주민 ${residentCount(i)}`}
              chevron={!i.joined}
              tail={
                <>
                  {i.joined && (
                    <View>
                      <Badge soft>소속됨</Badge>
                    </View>
                  )}
                  <View style={{ width: 64 }}>
                    <Thumb h={44} warm={i.id === 'strawberry'} />
                  </View>
                </>
              }
              onPress={() => {
                setVisited(i.id);
                i.id === island.id ? home() : go('visit', i.id);
              }}
            />
          ))}
        </Group>
        {!results.length && (
          <Txt kind="meta">찾는 섬이 없어요. 이름이나 초대 코드를 확인해 주세요.</Txt>
        )}
      </IslandSheet>
    );
  }
  if (route === 'visit' || route === 'approval') {
    const i =
        state.islands.find((i) => i.id === (detail || visited || state.pendingIsland)) ||
        state.islands[1],
      pending = (state.pendingIslands ?? []).includes(i.id) || state.pendingIsland === i.id;
    return (
      <IslandSheet
        bg="tower"
        sign="bld/observatory"
        title="바다 건너 섬"
        tall
        onBack={back}
        onClose={home}
        footer={footer(
          '배 타고 이동',
          () => {
            setVisited(i.id);
            go('travel', i.id);
          },
          i.joined ? '소속된 섬' : pending ? '참여 신청됨 · 취소' : '이 섬에 가입',
          () =>
            i.joined
              ? notify('이미 소속된 섬이에요.')
              : pending
                ? act('CANCEL_JOIN', { id: i.id })
                : join(i),
        )}
      >
        <Thumb warm h={layout.compact ? 150 : 220} />
        <Txt kind="h">{i.name}</Txt>
        <Txt style={{ color: C.muted }}>{i.intro}</Txt>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <AvStack list={i.members.slice(0, 3).map((m) => m.color)} />
          <Txt kind="meta" style={{ flex: 1 }}>
            {`주민 ${residentCount(i)}명 · 평균 ${hoursMinutes(islandWeeklyAverage(state, i, now))}`}
          </Txt>
        </View>
      </IslandSheet>
    );
  }
  if (route === 'mail')
    return (
      <IslandSheet
        bg="mail"
        sign="bld/mailbox"
        title="우리 섬 편지방"
        tall
        onClose={home}
        keepOnBackdrop
        scrollRef={chat}
        footer={composer('우리 섬 모두에게', () => {
          act('MESSAGE', { text });
          setText('');
          setTimeout(
            () =>
              chat.current?.scrollToEnd({
                animated: !state.settings.reduceMotion,
              }),
            80,
          );
        })}
      >
        <Txt
          kind="meta"
          style={{
            textAlign: 'center',
            ...(layout.tablet ? { fontSize: 15, lineHeight: 22 } : {}),
          }}
        >
          {island.name} · {island.members.length + 1}명이 함께 나누는 이야기
        </Txt>
        <View
          style={{
            gap: layout.tablet ? 28 : 20,
            paddingTop: layout.tablet ? 16 : 10,
          }}
        >
          {island.messages.map((m) => (
            <View key={m.id}>
              <ChatBubble
                large={layout.tablet}
                name={m.memberId === 'me' ? '나' : m.name}
                color={m.color}
                text={m.text}
                own={m.memberId === 'me'}
                at={new Date(m.at).toLocaleTimeString('ko-KR', {
                  hour: '2-digit',
                  minute: '2-digit',
                  hour12: false,
                })}
              />
              {m.status === 'failed' && (
                <Btn
                  small
                  title="다시 보내기"
                  kind="ghost"
                  onPress={() => act('RETRY_MESSAGE', { id: m.id })}
                />
              )}
            </View>
          ))}
        </View>
      </IslandSheet>
    );
  const productArt = (p: any) =>
    p.kind === 'audio'
      ? 'gram'
      : p.kind === 'island'
        ? 'island/whole'
        : p.kind === 'building'
          ? 'bld/' + buildingArt[p.building || 'hall']
          : p.kind === 'clothes'
            ? 'scarf-cat'
            : '';
  const productPreview = (p: any, h: number) =>
    p.kind === 'island' ? (
      <Thumb h={h} />
    ) : p.kind === 'building' || p.kind === 'audio' ? (
      <View
        style={[k.preview, { height: h, backgroundColor: p.kind === 'audio' ? C.soft : C.sky }]}
      >
        <Pic id={productArt(p)} w={Math.min(180, h * 0.8)} />
        {p.kind === 'audio' && (
          <>
            <View style={{ position: 'absolute', left: 16, bottom: 22 }}>
              <Badge soft>나만 미리듣기</Badge>
            </View>
            {/* 그림 위 52px 원형 재생 버튼 */}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={previewAudio ? '미리듣기 멈춤' : '미리듣기'}
              onPress={() => {
                try {
                  if (previewAudio) {
                    player.pause();
                    setPreviewAudio(false);
                  } else {
                    player.replace(assets['audio/' + p.id + '.wav']);
                    player.play();
                    setPreviewAudio(true);
                  }
                } catch {
                  notify('음원을 불러오지 못했어요.');
                }
              }}
              style={{
                position: 'absolute',
                right: 16,
                bottom: 16,
                width: 52,
                height: 52,
                borderRadius: 26,
                borderWidth: 2,
                borderColor: C.brown,
                backgroundColor: C.pink,
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0px 3px 0px ' + C.brown,
              }}
            >
              <PlayIcon pause={previewAudio} size={20} />
            </Pressable>
          </>
        )}
      </View>
    ) : (
      <Boat
        state={state}
        h={h}

        scarf={p.id === 'scarf' || state.equipped.clothes === 'scarf'}
      />
    );
  const owned = (p: any) =>
    (p.currency === 'fish' ? state.owned : island.sharedOwned).includes(p.id);
  if (route === 'shop') {
    const group = tab || '내 꾸미기',
      items = products.filter((p) =>
        group === '내 꾸미기'
          ? p.currency === 'fish'
          : group === '우리 섬의 소리'
            ? p.kind === 'audio'
            : p.kind === 'island' || p.kind === 'building',
      );
    return (
      <IslandSheet
        bg="shop"
        sign="dog"
        signKind="npc"
        title="강아지 상점"
        tall
        action="구매 내역"
        actionPress={() => go('orders')}
        onClose={home}
      >
        <View
          style={[
            k.row,
            {
              paddingVertical: 10,
              paddingHorizontal: 14,
              backgroundColor: '#FFF3CF',
              borderWidth: 1.5,
              borderColor: '#E7CF9A',
              borderRadius: 14,
            },
          ]}
        >
          <View style={{ flex: 1, gap: 2 }}>
            <Txt kind="meta">내 물고기</Txt>
            <Txt style={{ fontSize: 18, fontWeight: '800' }}>
              {state.fish.toLocaleString()} 마리
            </Txt>
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <Txt kind="meta">{island.name} 섬 물고기</Txt>
            <Txt style={{ fontSize: 18, fontWeight: '800' }}>{island.points.toLocaleString()}P</Txt>
          </View>
        </View>
        <Chips
          items={['내 꾸미기', '우리 섬 꾸미기', '우리 섬의 소리']}
          value={group}
          onChange={setTab}
        />
        {group === '내 꾸미기' ? (
          <View style={[k.row, { gap: 10 }]}>
            <Pic id="dog" w={56} />
            <Txt kind="meta" style={{ flex: 1 }}>
              어서 와, 기다렸어! 물고기로 사는 건 내 배에서 입어.
            </Txt>
          </View>
        ) : group === '우리 섬 꾸미기' ? (
          <Txt kind="meta">섬 물고기로 사고 여기서 바로 적용해요. 섬 전체가 같이 바뀌어요.</Txt>
        ) : null}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
          {items.map((p) => (
            <Pressable
              key={p.id}
              accessibilityRole="button"
              accessibilityLabel={p.title}
              onPress={() => go('product', p.id)}
              style={{
                // 시트 안: 세로 2열, 가로 폰 4열
                width: layout.compact ? '22.5%' : '47.5%',
                borderWidth: 1.5,
                borderColor: C.brown,
                borderRadius: 18,
                backgroundColor: C.paper,
                overflow: 'hidden',
                padding: 10,
                gap: 6,
              }}
            >
              <View
                style={{
                  height: layout.compact ? 84 : 112,
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: 12,
                  backgroundColor: ['island', 'building'].includes(p.kind) ? '#E3F4FC' : '#FFF0F3',
                  overflow: 'hidden',
                }}
              >
                {
                  <Pic
                    id={productArt(p)}
                    w={p.kind === 'island' ? '100%' : '92%'}
                    h={p.kind === 'island' ? '100%' : '92%'}
                    cover={p.kind === 'island'}
                  />
                }
              </View>
              {owned(p) && (
                <View
                  style={{
                    position: 'absolute',
                    left: 16,
                    top: 16,
                    borderWidth: 1.5,
                    borderColor: C.brown,
                    borderRadius: 999,
                    backgroundColor: C.butter,
                    paddingHorizontal: 8,
                    paddingVertical: 2,
                  }}
                >
                  <Txt style={{ fontSize: 11, fontWeight: '700' }}>보유 중</Txt>
                </View>
              )}
              <Txt style={{ fontSize: 14, fontWeight: '700' }}>{p.title}</Txt>
              <Txt kind="meta">
                {p.price} {p.currency === 'fish' ? '물고기' : '섬 물고기'}
              </Txt>
            </Pressable>
          ))}
        </View>
        {group === '우리 섬의 소리' && (
          <>
            <Txt kind="section">
              보유 음원 {island.sharedOwned.filter((id) => names[id]).length}
            </Txt>
            <Group>
              {island.sharedOwned
                .filter((id) => names[id])
                .map((id) => (
                  <Row
                    key={id}
                    title={names[id]}
                    sub={id === 'rain' ? '구매 음원' : '기본 음원'}
                    lead={
                      <View
                        style={{
                          width: 36,
                          height: 36,
                          borderRadius: 18,
                          borderWidth: 2,
                          borderColor: C.brown,
                          backgroundColor: C.paper,
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        <PlayIcon size={16} />
                      </View>
                    }
                    onPress={() => {
                      try {
                        player.replace(assets['audio/' + id + '.wav']);
                        player.play();
                        setPreviewAudio(true);
                        notify(names[id] + ' 미리듣기');
                      } catch {}
                    }}
                  />
                ))}
            </Group>
          </>
        )}
      </IslandSheet>
    );
  }
  if (route === 'product') {
    const p = products.find((p) => p.id === detail) || products[0],
      has = owned(p),
      currency = p.currency === 'fish' ? '물고기' : '섬 물고기',
      remaining = (p.currency === 'fish' ? state.fish : island.points) - p.price,
      applied =
        p.kind === 'island'
          ? island.theme === p.id
          : p.kind === 'building'
            ? island.buildingThemes?.[p.building || 'hall'] === p.id
            : false;
    const apply = (value: string) =>
      act('THEME', { kind: p.kind, building: p.building || 'hall', value });
    const buy = () => {
      const err = canBuy(state, p);
      if (err) {
        notify(err);
        return;
      }
      confirm(
        p.title + '를 살까요?',
        `${p.price} ${currency} 사용 · 구매 후 ${remaining.toLocaleString()}${p.currency === 'fish' ? '마리' : 'P'}`,
        () => {
          act('BUY', { id: p.id });
          notify('구매했어요.');
        },
      );
    };
    return (
      <IslandSheet
        bg="shop"
        sign="dog"
        signKind="npc"
        title="상품 상세"
        tall
        onBack={back}
        onClose={home}
        footer={footer(
          !has
            ? `${p.price} ${currency}로 구매`
            : p.currency === 'fish'
              ? '내 뗏목에서 갈아입기'
              : p.kind === 'audio'
                ? '축음기에서 듣기'
                : applied
                  ? '우리 섬에 적용됨'
                  : '우리 섬에 적용',
          !has
            ? buy
            : p.currency === 'fish'
              ? () => walkTo('wardrobe')
              : p.kind === 'audio'
                ? () => go('sound')
                : () => {
                    apply(p.id);
                    notify('우리 섬에 적용했어요.');
                  },
          has && ['island', 'building'].includes(p.kind) ? '기본 외양으로 해제' : undefined,
          () => apply('default'),
          !has
            ? `구매 후 ${currency} ${Math.max(0, remaining).toLocaleString()}${p.currency === 'fish' ? '마리' : 'P'}`
            : undefined,
          applied,
        )}
      >
        {productPreview(p, layout.compact ? 150 : p.kind === 'clothes' ? 260 : 220)}
        <Txt kind="h">{p.title}</Txt>
        {has && <Badge>보유 중{applied ? ' · 적용됨' : ''}</Badge>}
        <Txt style={{ color: C.muted }}>
          {p.description}
          {p.kind === 'island' && applied ? ' 지금 우리 섬에 적용돼 있어요.' : ''}
        </Txt>
      </IslandSheet>
    );
  }
  if (route === 'orders') {
    const shared = tab === '섬 공동 구매';
    return (
      <IslandSheet
        bg="shop"
        sign="dog"
        signKind="npc"
        title="구매 내역"
        onBack={back}
        onClose={home}
      >
        <FTabs
          items={[
            ['내 구매', 'person'],
            ['섬 공동 구매', 'group'],
          ]}
          value={shared ? '섬 공동 구매' : '내 구매'}
          onChange={setTab}
        />
        <Group>
          {state.orders
            .filter((o) =>
              shared ? o.currency === 'points' && o.islandId === island.id : o.currency === 'fish',
            )
            .map((o) => (
              <Row
                key={o.id}
                title={products.find((p) => p.id === o.product)?.title || o.product}
                // 내 구매 = 날짜·시각, 공동 구매 = 날짜·구매자(방장이면 "방장")
                sub={
                  shared
                    ? [md(o.at), o.buyer && (isHostName(o.buyer) ? '방장' : o.buyer)]
                        .filter(Boolean)
                        .join(' · ')
                    : `${md(o.at)} · ${hm(o.at)}`
                }
                right={o.price + (o.currency === 'fish' ? ' 물고기' : 'P')}
                chevron
                onPress={() => go('product', o.product)}
              />
            ))}
        </Group>
      </IslandSheet>
    );
  }
  if (route === 'boat')
    return (
      <IslandSheet bg="dock" sign="boat/raft" title="내 배" onClose={home}>
        <View style={[k.row, { gap: 14 }]}>
          <View style={[k.preview, { width: 120, height: 104, borderRadius: 18 }]}>
            <Pic id="boat/raft" w={96} />
          </View>
          <View style={{ flex: 1, gap: 4 }}>
            <Txt kind="h">{state.name}의 작은 배</Txt>
            <Txt kind="meta">
              {['뗏목', state.equipped.clothes === 'scarf' ? '바다 스카프' : '']
                .filter(Boolean)
                .join(' · ')}
            </Txt>
          </View>
        </View>
        <Group>
          {/* v2의 "배 소품 · 선체"·돛단배 아이콘은 정책(기본 뗏목 고정)상 넣지 않는다 */}
          <Row
            title="보유품 꾸미기"
            sub="옷 갈아입기"
            icon="boat/raft"
            chevron
            onPress={() => go('wardrobe')}
          />
          <Row
            title="내 정보"
            sub="닉네임 · 털색 · 계정"
            icon={'avatar/' + state.color}
            chevron
            onPress={() => go('profile')}
          />
          <Row
            title="앱 설정"
            sub="알림 · 소리 · 측정 권한"
            icon="gram"
            chevron
            onPress={() => go('settings')}
          />
        </Group>
      </IslandSheet>
    );
  if (route === 'wardrobe') {
    const thumb = (key: string, value: string, label: string, picture: string, locked = false) => {
      const selected = (state.equipped as any)[key] === value;
      return (
        <Pressable
          key={value}
          accessibilityRole="button"
          accessibilityLabel={label}
          accessibilityState={{ selected, disabled: locked }}
          onPress={() =>
            locked
              ? island.buildings.includes('shop')
                ? walkTo('shop')
                : notify('상점을 지으면 구매할 수 있어요.')
              : act('EQUIP', { key, value })
          }
          style={{ width: 76, gap: 6, opacity: locked ? 0.42 : 1 }}
        >
          <View
            style={{
              height: 76,
              borderWidth: 2,
              borderColor: selected ? C.brown : '#D9C6B8',
              borderRadius: 16,
              backgroundColor: selected ? C.soft : C.paper,
              boxShadow: selected ? '0px 3px 0px ' + C.brown : 'none',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {picture === 'FLAG' ? (
              <View style={{ transform: [{ scale: 0.7 }] }}>
                <PlainFlag />
              </View>
            ) : picture ? (
              <Pic id={picture} w={64} />
            ) : (
              <Txt kind="meta">없음</Txt>
            )}
            {selected && (
              <View style={{ position: 'absolute', top: -6, right: -6 }}>
                <CheckDot />
              </View>
            )}
          </View>
          <Txt
            style={{
              fontSize: 12,
              fontWeight: selected ? '700' : '600',
              color: selected ? C.ink : C.muted,
              textAlign: 'center',
            }}
          >
            {label}
          </Txt>
        </Pressable>
      );
    };
    return (
      <IslandSheet bg="dock" sign="boat/raft" title="내 꾸미기" tall onBack={back} onClose={home}>
        <Boat
          state={state}
          h={layout.compact ? 150 : 200}
          scarf={state.equipped.clothes === 'scarf'}
        />
        <Txt kind="section">옷·장신구</Txt>
        <View style={k.row}>
          {thumb('clothes', 'none', '기본', 'cat/black')}
          {state.owned.includes('scarf') && thumb('clothes', 'scarf', '바다 스카프', 'scarf-cat')}
        </View>
      </IslandSheet>
    );
  }
  if (route === 'profile') {
    const mustTransferHost = state.islands.some(
      (candidate) => isHost(candidate) && candidate.members.length > 0,
    );
    return (
      <IslandSheet
        bg="dock"
        sign={'avatar/' + profileColor}
        signKind="av"
        title="내 정보"
        tall
        onBack={back}
        onClose={home}
        action="저장"
        actionPress={() => {
          if (!profileName.trim()) {
            notify('닉네임을 입력해 주세요.');
            return;
          }
          act('PROFILE', { name: profileName, color: profileColor });
          notify('저장했어요.');
          back();
        }}
      >
        <Pic
          id={'avatar/' + profileColor}
          w={96}
          style={{
            alignSelf: 'center',
            borderRadius: 24,
            backgroundColor: C.sky,
          }}
        />
        <AvatarGrid mini value={profileColor} onChange={setProfileColor} />
        <Field label="닉네임" value={profileName} onChange={setProfileName} />
        <Group>
          <Row title="연동 계정" sub={profileName + '님의 GROMO 계정 · Apple'} />
          <Row
            title="로그아웃"
            chevron
            onPress={() =>
              confirm('로그아웃할까요?', '저장된 기록은 그대로 남아요.', () => {
                act('LOGOUT');
                go('login');
              })
            }
          />
        </Group>
        <Btn
          title={mustTransferHost ? '방장을 위임한 뒤 회원 탈퇴할 수 있어요' : '회원 탈퇴'}
          kind="danger"
          disabled={mustTransferHost}
          style={{ alignSelf: 'center' }}
          onPress={() =>
            confirm(
              '회원 탈퇴할까요?',
              '계정과 저장된 기록을 모두 삭제해요. 되돌릴 수 없어요. 모은 물고기는 섬에 남아요.',
              () => {
                act('DELETE_ACCOUNT');
                go('login');
              },
            )
          }
        />
      </IslandSheet>
    );
  }
  if (route === 'settings') {
    const toggle = (label: string, key: string, sub?: string) => (
      <Row
        title={label}
        sub={sub}
        tail={
          <Toggle
            label={label}
            value={(state.settings as any)[key]}
            onChange={(value: boolean) => act('SETTING', { key, value })}
          />
        }
      />
    );
    return (
      <IslandSheet bg="dock" sign="boat/raft" title="앱 설정" tall onBack={back} onClose={home}>
        <Txt kind="section">알림·소리</Txt>
        <Group flat>
          {toggle('알림', 'notifications')}
          {toggle('소리', 'sound')}
          {toggle('가벼운 진동', 'haptics')}
        </Group>
        <Txt kind="section">화면</Txt>
        <Group flat>{toggle('동작 줄이기', 'reduceMotion', '이동·전환 애니메이션을 줄여요')}</Group>
        <Txt kind="section">측정</Txt>
        <Group flat>
          {toggle('스크린타임 연결', 'permission', '폰 사용 퀘스트와 기록에 써요')}
          <Row
            title="측정 권한"
            sub="iOS 설정 › 스크린타임에서 바꿔요"
            chevron
            onPress={() => go('permission')}
          />
        </Group>
        <Txt kind="meta">
          권한을 끄면 폰 사용 퀘스트 달성률은 "확인 필요"로 표시돼요. 기록이 0분으로 표시되지는
          않아요.
        </Txt>
        <Txt kind="section">앱 정보</Txt>
        <Group flat>
          <Row
            title="튜토리얼 다시 보기"
            chevron
            onPress={() => {
              setGuideStep(0);
              go('guide');
            }}
          />
          <Row title="버전" sub="R61 · v2" />
          <Row
            title="이용약관 · 개인정보"
            chevron
            onPress={() =>
              confirm(
                '이용약관 · 개인정보',
                'GROMO는 집중 기록과 섬 활동을 제공해요. 이 앱은 로컬 목업이며 계정과 결제 정보는 서버로 전송하지 않아요.\n\n닉네임, 집중 기록과 설정은 이 기기에 저장돼요. 회원 탈퇴를 누르면 삭제돼요.',
                () => {},
              )
            }
          />
        </Group>
      </IslandSheet>
    );
  }
  return (
    <Page title="GROMO" back={home}>
      <Btn title="섬으로 돌아가기" onPress={home} />
    </Page>
  );
}
function ChatBubble({ name, text, color, own = false, at = '', large = false, avatar }: any) {
  return (
    <View
      style={{
        flexDirection: own ? 'row-reverse' : 'row',
        alignItems: 'flex-start',
        gap: large ? 14 : 10,
      }}
    >
      <Pic
        id={'avatar/' + color}
        w={avatar ?? (large ? 48 : 40)}
        style={{
          borderRadius: 14,
          backgroundColor: C.sky,
          borderWidth: 1.5,
          borderColor: C.brown,
        }}
      />
      <View
        style={{
          maxWidth: large ? 560 : '78%',
          flexShrink: 1,
          gap: large ? 8 : 6,
          alignItems: own ? 'flex-end' : 'flex-start',
        }}
      >
        <Txt
          tabletScale={large ? 1 : undefined}
          kind="meta"
          style={
            large
              ? {
                  fontSize: 16,
                  lineHeight: 23,
                  fontWeight: '600',
                  color: C.ink,
                }
              : undefined
          }
        >
          {name}
          {at ? (
            <Txt
              tabletScale={large ? 1 : undefined}
              kind="meta"
              style={large ? { fontSize: 14, lineHeight: 23, fontWeight: '400' } : undefined}
            >
              {' · ' + at}
            </Txt>
          ) : null}
        </Txt>
        <View
          style={{
            backgroundColor: own ? C.soft : C.paper,
            borderWidth: 2,
            borderColor: C.brown,
            borderRadius: 18,
            paddingHorizontal: large ? 18 : 14,
            paddingVertical: large ? 14 : 11,
          }}
        >
          <Svg
            width={14}
            height={18}
            viewBox="0 0 14 18"
            style={{
              position: 'absolute',
              top: 9,
              ...(own ? { right: -12, transform: [{ scaleX: -1 }] } : { left: -12 }),
            }}
          >
            <Path
              d="M14 1 C8 1 4 1 2 3 C0 5 8 7 12 16"
              fill={own ? C.soft : C.paper}
              stroke={C.brown}
              strokeWidth={2}
              strokeLinecap="round"
            />
            <Path d="M13 1 L13 15" stroke={own ? C.soft : C.paper} strokeWidth={3} />
          </Svg>
          <Txt
            tabletScale={large ? 1 : undefined}
            style={large ? { fontSize: 19, lineHeight: 29, fontWeight: '500' } : undefined}
          >
            {text}
          </Txt>
        </View>
      </View>
    </View>
  );
}
function Volume({ value, onChange }: any) {
  const [width, setWidth] = useState(1),
    ref = useRef({ value, onChange, width });
  ref.current = { value, onChange, width };
  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) =>
        ref.current.onChange(Math.max(0, Math.min(1, e.nativeEvent.locationX / ref.current.width))),
      onPanResponderMove: (e) =>
        ref.current.onChange(Math.max(0, Math.min(1, e.nativeEvent.locationX / ref.current.width))),
    }),
  ).current;
  return (
    <View
      accessibilityRole="adjustable"
      accessibilityLabel="내 기기 음량"
      accessibilityValue={{ min: 0, max: 100, now: Math.round(value * 100) }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(e) =>
        onChange(
          Math.max(0, Math.min(1, value + (e.nativeEvent.actionName === 'increment' ? 0.1 : -0.1))),
        )
      }
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      {...pan.panHandlers}
      style={{ height: 22, justifyContent: 'center' }}
    >
      <View style={{ height: 6, borderRadius: 3, backgroundColor: '#EADFD2' }}>
        <View
          style={{
            height: 6,
            width: `${value * 100}%`,
            backgroundColor: C.pink,
            borderRadius: 3,
          }}
        />
      </View>
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          left: Math.max(0, (width - 22) * value),
          width: 22,
          height: 22,
          borderRadius: 11,
          borderWidth: 2,
          borderColor: C.brown,
          backgroundColor: C.paper,
        }}
      />
    </View>
  );
}

function PlainFlag() {
  return (
    <View style={{ width: 72, height: 84 }}>
      <View
        style={{
          position: 'absolute',
          left: 14,
          top: 4,
          width: 4,
          height: 78,
          borderRadius: 2,
          backgroundColor: C.brown,
        }}
      />
      <View
        style={{
          position: 'absolute',
          left: 18,
          top: 8,
          width: 46,
          height: 30,
          backgroundColor: C.pink,
          borderWidth: 1.5,
          borderColor: C.brown,
          borderTopLeftRadius: 2,
          borderTopRightRadius: 10,
          borderBottomRightRadius: 10,
          borderBottomLeftRadius: 2,
        }}
      />
    </View>
  );
}
