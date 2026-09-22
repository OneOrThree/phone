import { GuideBox, MailboxGuide } from '@/screens/island/NpcGuide';
import { getSession } from '@/services/api/session';
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
  Friend,
  shouldShowMailboxGuide,
  Building,
  Color,
  currentIsland,
  mainIsland,
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
  balance,
  dayKey,
  kstMonthDay,
  kstHourMinute,
  trackNames,
} from '@/services/model';
import { useAppLayout } from '@/utils/layout';
import { ApiError } from '@/services/api/client';
import type { IslandSummary } from '@/services/api/islands';
import type { RequestStatusEntry } from '@/services/model';
import { FinalIsland as IslandHome } from '@/screens/island/WorldMap';
import { FocusSea, clock } from '@/screens/focus/FocusSea';
import { RestWorld, Sailing } from '@/screens/world/WorldViews';
import { assets } from '@/constants/assets';
import { BUNDLED_AUDIO_TRACK_IDS, hasBundledAudio } from '@/constants/audio';
import { Scarf, Flag } from '@/screens/cosmetics/Cosmetics';
import { useScreenInsets } from '@/design-system/primitives';
import { screenTime } from '@/services/screenTime';
import ScreenTimeReportView from '@/components/ScreenTimeReportView';
import { componentTokens, primitiveTokens } from '@/design-system/tokens';
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
  st,
  sheetInput,
  SheetRow,
  SheetGroup,
  SheetChev,
  RowIcon,
  Avatar,
  Preview,
  IslandThumb,
  HatArt,
  HatOn,
  RaftCatArt,
  Cta,
  SearchField,
} from '@/screens/island/IslandSheet';
import { useIslandRankings } from '@/screens/island/useIslandRankings';
import { useShop } from '@/screens/island/useShop';
import type { FriendsScreenState } from '@/screens/island/useFriendsScreen';
import {
  acceptFriendRequest,
  cancelFriendRequest,
  deleteFriend,
  friendErrorKind,
  rejectFriendRequest,
  sendFriendRequest,
} from '@/services/api/friends';
// 서버 카탈로그 kind → 카드가 아는 로컬 kind (GROMO-2017). clothes/decor 은 모두 「내 꾸미기」다.
const shopUiKind = (kind: string) =>
  kind === 'island_theme'
    ? 'island'
    : kind === 'building_theme'
      ? 'building'
      : kind === 'audio'
        ? 'audio'
        : 'clothes';
const shopCard = (p: any) => ({
  ...p,
  kind: shopUiKind(p.kind),
  building: p.targetBuilding ?? p.building,
});
// 서버가 준 구매 불가 사유 → 화면 문구. 모르는 코드는 일반 문구로 접는다.
const shopBlockReason = (p: { blockedReason?: string | null; reason?: string | null }) => {
  const reason = p.blockedReason ?? p.reason;
  if (reason === 'INSUFFICIENT_FUNDS') return '섬 물고기가 모자라요.';
  if (reason === 'STATE_CONFLICT') return '아직 판매 준비 중이에요.';
  if (reason === 'FACILITY_LOCKED') return '필요한 건물이 아직 없어요.';
  if (reason === 'MEMBER_ONLY' || reason === 'FORBIDDEN') return '섬 주민만 살 수 있어요.';
  return '지금은 구매할 수 없어요.';
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
// 날짜 "M/D"와 시각 "HH:MM"(Asia/Seoul)
const md = kstMonthDay;
const hm = kstHourMinute;
function Thumb({ h = 220, warm = false }: any) {
  return (
    <View style={[k.preview, { height: h }]}>
      <Pic id={warm ? 'island/whole/warm' : 'island/whole'} w="100%" h="100%" cover />
    </View>
  );
}
function IslandCircle({ size }: { size: number }) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        borderWidth: 2,
        borderColor: C.brown,
        overflow: 'hidden',
        backgroundColor: C.sky,
      }}
    >
      <Pic id="island/whole" w="100%" h="100%" cover />
    </View>
  );
}
function MainIslandRadio({ selected }: { selected: boolean }) {
  return (
    <View
      style={{
        width: 24,
        height: 24,
        borderRadius: 12,
        borderWidth: 2,
        borderColor: C.brown,
        backgroundColor: C.paper,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {selected && (
        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: C.pink }} />
      )}
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
function StopIcon({ size = 16 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M6 6h12v12H6z" fill={C.ink} />
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
    [mainIslandPick, setMainIslandPick] = useState(state.mainIslandId ?? ''),
    // 20b 회관 안내를 이번 홈 방문 동안만 띄우는 창 상태
    [hallGuideOpen, setHallGuideOpen] = useState(false),
    [discoveryIndex] = useState(() => Math.floor(Math.random() * 10)),
    // 섬 찾기에서 ‹ ›·가입 신청으로 고른 섬 id
    [discoveryPick, setDiscoveryPick] = useState<string | null>(null),
    // ── 서버 온보딩(GROMO-2006). e.islands 가 있으면 실제 API 모드다 ──
    [serverBusy, setServerBusy] = useState(false),
    [serverError, setServerError] = useState(''),
    [soundDialog, setSoundDialog] = useState<{
      kind: 'confirm' | 'success' | 'error';
      productId: string;
    } | null>(null),
    // 초대 코드 확인으로 받은 섬 미리보기 — 가입은 사용자가 카드를 보고 명시적으로 누른다
    [invitePick, setInvitePick] = useState<IslandSummary | null>(null),
    // 생성·가입 뒤 서버 current 가 확인된 섬 이름. arrival 은 CurrentScreens 차단으로 열지 않는다
    [serverDone, setServerDone] = useState('');
  const chat = useRef<ScrollView>(null),
    emoteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentMainIslandId = mainIsland(state)?.id ?? '';
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
    setServerError('');
    setSoundDialog(null);
    setInvitePick(null);
    setServerDone('');
  }, [route]);
  // 서버 명령 실행기 — 진행 중 중복 탭은 한 의도를 두 번 만들지 않게 막고, 오류는 화면 문구로 바꾼다.
  // stale 세션의 늦은 응답(CLIENT_STALE_SESSION)은 문구 없이 버린다.
  const server = e.islands;
  const serverErrorText = (thrown: unknown) => {
    if (!(thrown instanceof ApiError)) return '연결을 확인한 뒤 다시 시도해 주세요.';
    const code = thrown.code;
    if (code === 'CLIENT_STALE_SESSION') return '';
    if (code === 'SLUG_NOT_FOUND') return '초대 코드를 다시 확인해 주세요.';
    if (code === 'INVITATION_EXPIRED') return '만료된 초대예요. 새 초대를 받아 주세요.';
    if (code === 'FORBIDDEN' && thrown.message) return thrown.message;
    if (code === 'STATE_CONFLICT' || code === 'VERSION_CONFLICT')
      return '섬 정보가 바뀌었어요. 최신 상태로 다시 시도해 주세요.';
    if (code === 'REQUEST_IN_PROGRESS' || thrown.retryable)
      return '처리 중이에요. 잠시 뒤 다시 시도해 주세요.';
    return thrown.message || '연결을 확인한 뒤 다시 시도해 주세요.';
  };
  const run = (fn: () => Promise<unknown>, fail: (m: string) => void = setServerError) => {
    if (serverBusy) return;
    setServerBusy(true);
    fail('');
    Promise.resolve()
      .then(fn)
      .catch((thrown) => {
        const m = serverErrorText(thrown);
        if (m) fail(m);
      })
      .finally(() => setServerBusy(false));
  };
  // 서버 스냅샷 단축 — 첫 로드 전엔 undefined
  const snap = state.serverIslands;
  // 전망대 주간 섬 랭킹(GROMO-2018) — 서버 모드이고 tower route 일 때만 조회한다
  const islandRankings = useIslandRankings({ active: route === 'tower' && !!server });
  // 상점·주문·인벤토리·꾸미기 서버 계약(GROMO-2017) — 상점 계열 route 일 때만 읽는다.
  // 가격·권한·버전은 서버 응답이 정본이고, 로컬 products/owned/orders 는 목업 경로에서만 쓴다.
  const shopApi = useShop({
    active: !!server && ['shop', 'product', 'orders', 'wardrobe', 'sound'].includes(route),
    islandId: snap?.currentIslandId ?? null,
    route,
    category: tab === '우리 섬 꾸미기' ? 'island' : 'personal',
    orderScope: tab === '섬 공동 구매' ? 'shared' : 'personal',
    productId: route === 'product' ? detail : null,
    dispatch,
  });
  // 서버 상품은 owned 가 응답에 실린다 — 목업 경로만 로컬 보유 목록을 본다.
  const owned = (p: any) =>
    server && p.owned !== undefined
      ? !!p.owned
      : (p.kind === 'clothes' ? state.owned : island.sharedOwned).includes(p.id);
  const productTitle = (id: string) =>
    server ? (shopApi.titles[id] ?? id) : products.find((p) => p.id === id)?.title || id;
  // 친구 관리·친구 찾기(GROMO-2015) — 서버 모드면 /screens/friends 조각과 명령 API 가 정본이다
  const friendsScreen = e.friendsScreen as FriendsScreenState;
  // 친구 명령의 공통 실패 처리 — 게이트는 회원 전환 시트로, 이미 처리·중복은 재조회로 닫는다
  const friendFail = (thrown: unknown) => {
    if (e.conversion?.offer(thrown)) return;
    const kind = friendErrorKind(thrown);
    if (kind === 'duplicate') notify('이미 친구이거나 보낸 요청이 있어요.');
    else if (kind === 'already-handled') notify('이미 처리된 요청이에요. 목록을 새로고침했어요.');
    else if (kind === 'privacy') notify('이 작업을 할 수 있는 상대가 아니에요.');
    else if (kind === 'network') notify('네트워크를 확인한 뒤 다시 시도해 주세요.');
    else
      notify(thrown instanceof ApiError && thrown.message ? thrown.message : '다시 시도해 주세요.');
    if (kind === 'duplicate' || kind === 'already-handled') friendsScreen.refresh();
  };
  // 성공(2xx) 확인 뒤에만 목록이 바뀐다 — optimistic 성공 없이 command 가 재조회를 건다
  const friendCmd = (fn: () => Promise<unknown>) => {
    friendsScreen.command(fn).catch(friendFail);
  };
  // 신청 목록에 단건 상태 조회 결과를 얹은 유효 목록 — requestStatus가 최신 상태다.
  // 단건 결과엔 표시 필드가 없으므로 목록에 없는 신청은 상태만 안다.
  const reqList = [
    ...(snap?.joinRequests ?? []),
    ...(snap?.requestStatus ?? []).filter(
      (r) => !(snap?.joinRequests ?? []).some((x) => x.id === r.id),
    ),
  ].map((r): RequestStatusEntry & { islandName?: string | null } => ({
    ...r,
    status: snap?.requestStatus?.find((x) => x.id === r.id)?.status ?? r.status,
  }));
  // approval 경로에서 기다릴 pending 신청 — detail이 있으면 그 섬의 pending만(다른 섬의
  // 신청이 이 화면을 가로채지 않는다), detail이 없을 때만 첫 pending
  const pendingReq = () =>
    detail
      ? reqList.find((r) => r.status === 'pending' && r.islandId === detail)
      : reqList.find((r) => r.status === 'pending');
  // 서버 소속 확인 카드 — 생성·가입 성공과 재시작 복구에 공용. arrival은 열지 않는다
  const doneCard = (title: string, sub: string) => (
    <View
      style={{
        gap: 4,
        borderWidth: 1.5,
        borderColor: C.brown,
        borderRadius: 14,
        backgroundColor: C.butter,
        paddingVertical: 12,
        paddingHorizontal: 14,
      }}
    >
      <Txt style={H17}>{title}</Txt>
      <Txt kind="meta" style={META}>
        {sub}
      </Txt>
    </View>
  );
  // 섬 찾기·승인 대기 진입 시 첫 페이지와 pending 목록을 서버에서 가져온다(재실행 복구 포함).
  // 다른 route를 거쳐 같은 route로 돌아오면 다시 가져온다 — 나갔다 재진입이 dead-end가 되지 않게.
  const serverTried = useRef('');
  useEffect(() => {
    if (!server || (route !== 'joinIsland' && route !== 'approval')) {
      serverTried.current = '';
      return;
    }
    if (serverTried.current === route) return;
    serverTried.current = route;
    run(() => server.explore());
  }, [route, server]);
  // 승인 대기 중엔 4초마다 신청 상태를 폴링 — 다른 기기의 승인·거절을 반영한다
  const pendingId = pendingReq()?.id;
  useEffect(() => {
    if (!server || route !== 'approval' || !pendingId) return;
    const t = setInterval(() => {
      Promise.resolve(server.status(pendingId)).catch(() => {});
    }, 4000);
    return () => clearInterval(t);
  }, [server, route, pendingId]);
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
    if (!soundDialog) return;
    const backSub = BackHandler.addEventListener('hardwareBackPress', () => {
      setSoundDialog(null);
      return true;
    });
    return () => backSub.remove();
  }, [soundDialog]);
  useEffect(() => {
    if (route !== 'profile') return;
    setProfileName(state.name);
    setProfileColor(state.color);
  }, [route, state.name, state.color]);
  useEffect(() => {
    if (route === 'mainIsland') setMainIslandPick(currentMainIslandId);
  }, [route, currentMainIslandId]);
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
    if (i.kicked) {
      notify('강퇴된 섬에는 다시 가입할 수 없어요.');
      return;
    }
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
    // 서버 모드: 코드 해석 → 섬 미리보기 → 사용자가 카드의 참여 버튼을 눌러야 가입한다
    if (server) {
      run(async () => setInvitePick(await server.resolveInvite(inviteCode.trim())), setInviteError);
      return;
    }
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
  // 섬 구경 시트의 가입 신청 알림(시트 위 토스트 한 줄)
  const [sheetToast, setSheetToast] = useState('');
  useEffect(() => {
    if (!sheetToast) return;
    const t = setTimeout(() => setSheetToast(''), 2400);
    return () => clearTimeout(t);
  }, [sheetToast]);
  useEffect(() => setSheetToast(''), [route]);
  // 나만 미리듣기가 곡 끝까지 재생되면 버튼을 다시 재생 모양으로
  useEffect(() => {
    if (!previewAudio) return;
    const sub = player.addListener?.('playbackStatusUpdate', (status: any) => {
      if (status?.didJustFinish) setPreviewAudio(false);
    });
    return () => sub?.remove();
  }, [previewAudio]);
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
            {/* 부팅 섬 동기화 실패 — 로컬 저장본으로 home에 가지 않고 명시 오류+재시도를 띄운다 */}
            {server && e.islandBootError && (
              <View
                style={{
                  gap: 6,
                  borderWidth: 1.5,
                  borderColor: C.danger,
                  borderRadius: 14,
                  paddingVertical: 12,
                  paddingHorizontal: 14,
                }}
              >
                <Txt style={H17}>섬 정보를 불러오지 못했어요</Txt>
                <Txt kind="meta" style={[META, serverError ? { color: C.danger } : null]}>
                  {serverError || '연결을 확인한 뒤 다시 시도해 주세요.'}
                </Txt>
                <Btn
                  kind="ghost"
                  title="다시 시도"
                  disabled={serverBusy}
                  onPress={() => run(() => server.sync())}
                />
              </View>
            )}
            {/* 진행 중 가입 신청 — 발견 후보에 없어도 재시작 후 상태·취소에 닿을 수 있게 한다 */}
            {server &&
              !e.islandBootError &&
              (() => {
                const pending = reqList.find((r) => r.status === 'pending');
                return pending ? (
                  <Btn
                    kind="sec"
                    id="pending-resume"
                    title={`「${pending.islandName ?? '신청한 섬'}」 가입 신청이 진행 중이에요`}
                    onPress={() => go('approval', pending.islandId)}
                  />
                ) : null;
              })()}
            {/* 재시작 복구 — 서버 current가 확인된 소속을 보여준다(home은 열지 않는다) */}
            {server &&
              !e.islandBootError &&
              (() => {
                const cur = snap?.memberships.find((m) => m.id === snap.currentIslandId);
                return cur
                  ? doneCard('가입이 확인됐어요', `서버에서 「${cur.name}」 소속이 확인됐어요.`)
                  : null;
              })()}
            {/* 서버 가입 완료 확인 — arrival 은 CurrentScreens 차단으로 열지 않는다 */}
            {serverDone && doneCard('가입이 완료됐어요', `「${serverDone}」의 주민이 됐어요.`)}
            {/* 초대받은 섬: 코드 확인 → 승인 없는 섬은 바로 참여, 승인 필요 섬은 가입 신청 */}
            <Btn
              kind="sec"
              id="invite-open"
              title="이미 초대받은 섬이 있어요!"
              style={{ marginTop: 6 }}
              onPress={() => {
                setInviteError('');
                setInvitePick(null);
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
              onPress={() => {
                setInvite(false);
                setInvitePick(null);
              }}
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
                      onPress={() => {
                        setInvite(false);
                        setInvitePick(null);
                      }}
                    >
                      <Txt style={{ fontSize: 24, lineHeight: 34.8, color: C.muted }}>×</Txt>
                    </Pressable>
                  </View>
                  {invitePick ? (
                    <>
                      {/* 확인된 초대 섬 — 공개 DTO 필드만 보여주고 가입은 이 버튼으로 확정한다 */}
                      <View
                        style={{
                          gap: 6,
                          borderWidth: 1.5,
                          borderColor: '#E7CF9A',
                          borderRadius: 14,
                          paddingVertical: 10,
                          paddingHorizontal: 14,
                        }}
                      >
                        <Txt style={H17}>{invitePick.name}</Txt>
                        <Txt kind="meta" style={META}>
                          {invitePick.intro}
                        </Txt>
                        <Txt kind="meta" style={META}>
                          {`주민 ${invitePick.memberCount}/${invitePick.maxMembers}명`}
                        </Txt>
                        <Badge soft>
                          {invitePick.approvalRequired ? '승인 필요' : '바로 참여'}
                        </Badge>
                      </View>
                      <Txt
                        kind="meta"
                        lineBreakStrategyIOS="hangul-word"
                        style={[META, KEEP, inviteError ? { color: C.danger } : null]}
                      >
                        {inviteError}
                      </Txt>
                      <Btn
                        title={invitePick.approvalRequired ? '가입 신청' : '이 섬에 참여'}
                        disabled={serverBusy}
                        onPress={() =>
                          run(async () => {
                            const r = await server.join(invitePick.id);
                            // pending 은 App 이 approval 경로로 보낸다 — active 만 여기서 확정 표시
                            if (r.status === 'active') {
                              setServerDone(invitePick.name);
                              setInvitePick(null);
                              setInvite(false);
                            }
                          }, setInviteError)
                        }
                      />
                    </>
                  ) : (
                    <>
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
                      <Btn
                        title="확인"
                        onPress={resolveInvite}
                        disabled={!inviteCode.trim() || serverBusy}
                      />
                    </>
                  )}
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
          serverDone ? undefined : (
            <Btn
              title="섬 만들기"
              disabled={!text.trim() || serverBusy}
              onPress={() => {
                // 서버 모드: 응답만으로 성공 처리하지 않고 App 이 /me/islands 재조회로 확정한다
                if (server) {
                  const capacity = parseInt(capacityPick, 10);
                  if (capacity < CAPACITY_MIN || capacity > CAPACITY_MAX) {
                    setServerError(`정원은 ${CAPACITY_MIN}~${CAPACITY_MAX}명이에요.`);
                    return;
                  }
                  run(async () => {
                    await server.create({
                      name: text.trim(),
                      intro: body.trim() || undefined,
                      approvalRequired: approval,
                      maxMembers: capacity,
                    });
                    setServerDone(text.trim());
                  });
                  return;
                }
                act('CREATE_ISLAND', {
                  name: text,
                  intro: body,
                  approval,
                  capacity: parseInt(capacityPick, 10),
                });
                go('arrival');
              }}
            />
          )
        }
      >
        {serverDone ? (
          // 서버 current 확인 상태 — rich 섬 데이터가 없어 arrival 로는 이동하지 않는다
          <View style={{ gap: 6 }}>
            <Txt style={H22}>섬을 만들었어요</Txt>
            <Txt kind="meta" style={META}>
              {`「${serverDone}」이 내 섬이 됐어요.`}
            </Txt>
          </View>
        ) : null}
        {serverError ? (
          <Txt kind="meta" style={[META, { color: C.danger }]}>
            {serverError}
          </Txt>
        ) : null}
        {!serverDone && (
          <>
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
          </>
        )}
      </Onboard>
    );
  }
  if ((route === 'joinIsland' || route === 'approval') && server) {
    // ── 서버 모드: 공개 DTO 만 그린다 — members·평균·건물·퀘스트는 합성하지 않는다 ──
    const candidates = snap?.candidates ?? [],
      req = pendingReq(),
      // approval 경로에서 방금 종결된 신청 — rejected/cancelled/approved 안내를 띄운다.
      // joinIsland(detail='')에서 무관한 옛 종결을 집어 참여 CTA를 숨기지 않게 route로 한정하고,
      // 현재 pending이 있으면 종결 카드보다 신청이 우선한다(취소 CTA 보존). 종결 이력이 여러 개면
      // requestStatus가 최신을 끝에 붙이므로 역순으로 최신 것을 고른다.
      closed =
        route === 'approval' && !req
          ? [...reqList]
              .reverse()
              .find((r) => r.status !== 'pending' && (!detail || r.islandId === detail))
          : undefined;
    const idx = candidates.findIndex((c) => c.id === discoveryPick),
      i = candidates[idx >= 0 ? idx : 0],
      iReq = i && reqList.find((r) => r.islandId === i.id && r.status === 'pending'),
      joined = !!i && snap?.currentIslandId === i.id;
    const move = (n: number) => {
      if (!candidates.length) return;
      // 마지막 후보에서 › 는 다음 페이지를 서버에서 가져온다. 커서가 죽었으면 첫 페이지부터 다시.
      if (n > 0 && idx >= candidates.length - 1 && snap?.nextCursor)
        return run(async () => {
          try {
            await server.discover(snap.nextCursor!);
          } catch (thrown) {
            if (
              thrown instanceof ApiError &&
              (thrown.code === 'INVALID_CURSOR' || thrown.code === 'CURSOR_EXPIRED')
            )
              await server.explore();
            else throw thrown;
          }
        });
      setDiscoveryPick(
        candidates[(Math.max(0, idx) + n + candidates.length) % candidates.length].id,
      );
    };
    const pendingCard = (r: RequestStatusEntry & { islandName?: string | null }) => (
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
        <View style={{ gap: 2, flex: 1 }}>
          <Txt style={{ fontSize: 15, lineHeight: 21.75, fontWeight: '700' }}>
            가입 신청 대기 중
          </Txt>
          <Txt kind="meta" style={{ lineHeight: 18.85 }}>
            {r.islandName
              ? `「${r.islandName}」 방장이 확인하면 알려드릴게요`
              : '방장이 확인하면 알려드릴게요'}
          </Txt>
        </View>
        <Spinner reduce={state.settings.reduceMotion} />
      </View>
    );
    const joinedCard = (name: string) =>
      doneCard('가입이 완료됐어요', `「${name}」의 주민이 됐어요.`);
    return (
      <Onboard
        title={route === 'approval' ? '가입 신청' : '섬 찾기'}
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
          serverDone || joined || closed?.status === 'approved' ? undefined : req &&
            route === 'approval' ? (
            <>
              <Btn
                kind="sec"
                title="가입 신청 취소"
                disabled={serverBusy}
                onPress={() => run(() => server.cancel(req.id))}
              />
              <Btn kind="ghost" title="다른 섬 보기" onPress={() => go('joinIsland')} />
            </>
          ) : closed && route === 'approval' ? (
            <Btn title="다른 섬 찾기" onPress={() => go('joinIsland')} />
          ) : iReq ? (
            <>
              <Btn
                kind="sec"
                title="가입 신청 취소"
                disabled={serverBusy}
                onPress={() => run(() => server.cancel(iReq.id))}
              />
              <Btn
                kind="ghost"
                title="다른 섬 보기"
                disabled={candidates.length < 2 && !snap?.nextCursor}
                onPress={() => move(1)}
              />
            </>
          ) : (
            <>
              <Btn
                title={!i ? '참여하기' : i.approvalRequired ? '가입 신청' : `${i.name}에 참여하기`}
                disabled={!i || serverBusy}
                onPress={() =>
                  i &&
                  run(async () => {
                    const r = await server.join(i.id);
                    if (r.status === 'active') setServerDone(i.name);
                  })
                }
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
        {/* 승인 대기 복구 카드 — 재실행 뒤에도 pending 신청이 먼저 보인다 */}
        {route === 'approval' && req && pendingCard(req)}
        {route === 'approval' &&
          !req &&
          closed &&
          (closed.status === 'approved' ? (
            joinedCard(closed.islandName ?? '그 섬')
          ) : (
            <View style={{ gap: 4 }}>
              <Txt style={H17}>
                {closed.status === 'rejected' ? '신청이 거절됐어요' : '신청이 취소됐어요'}
              </Txt>
              <Txt kind="meta" style={META}>
                다른 섬을 찾아보세요.
              </Txt>
            </View>
          ))}
        {serverDone && joinedCard(serverDone)}
        {joined && i && joinedCard(i.name)}
        {serverError ? (
          <View style={{ gap: 8 }}>
            <Txt kind="meta" style={[META, { color: C.danger }]}>
              {serverError}
            </Txt>
            <Btn
              kind="ghost"
              title="다시 불러오기"
              disabled={serverBusy}
              onPress={() => run(() => server.explore())}
            />
          </View>
        ) : null}
        {route === 'joinIsland' &&
          (i ? (
            <>
              {!layout.compact && <Thumb h={210} />}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 50 }}>
                <Pressable
                  style={{ flex: 1, gap: 2 }}
                  accessibilityRole="button"
                  accessibilityLabel={`${i.name} 정보 보기`}
                  // 카드를 누르면 방문 화면 DTO 로 공개 정보를 더 보여준다
                  onPress={() => run(() => server.visit(i.id))}
                >
                  <Txt style={H22}>{i.name}</Txt>
                  <Txt kind="meta" style={META}>
                    {i.intro}
                  </Txt>
                </Pressable>
                {['‹', '›'].map((v, n) => (
                  <Pressable
                    key={v}
                    accessibilityRole="button"
                    accessibilityLabel={n ? '다음 섬' : '이전 섬'}
                    accessibilityState={{ disabled: serverBusy }}
                    disabled={serverBusy}
                    onPress={() => move(n ? 1 : -1)}
                    style={{
                      opacity: serverBusy ? 0.45 : 1,
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
              <Txt kind="meta" style={META}>
                {`주민 ${i.memberCount}/${i.maxMembers}명`}
              </Txt>
              <Badge soft>{i.approvalRequired ? '승인 필요' : '바로 참여'}</Badge>
              {/* 방문 화면 DTO — 공개 주민 목록만, 집중 평균·건물은 서버가 주지 않는다 */}
              {snap?.visit && snap.visit.island.id === i.id && (
                <View
                  style={{
                    gap: 4,
                    borderWidth: 1.5,
                    borderColor: '#E7CF9A',
                    borderRadius: 14,
                    paddingVertical: 10,
                    paddingHorizontal: 14,
                  }}
                >
                  <Txt style={H17}>{snap.visit.island.name}</Txt>
                  {snap.visit.members.items.length ? (
                    <Txt kind="meta" style={META}>
                      {`주민 ${snap.visit.members.items.map((m) => m.name ?? '주민').join(', ')}`}
                    </Txt>
                  ) : null}
                </View>
              )}
              {iReq && pendingCard(iReq)}
            </>
          ) : serverBusy ? (
            <Txt kind="meta" style={META}>
              공개 섬을 찾는 중이에요…
            </Txt>
          ) : (
            !serverError && <Txt>지금 참여할 수 있는 공개 섬이 없어요.</Txt>
          ))}
      </Onboard>
    );
  }
  if (route === 'joinIsland' || route === 'approval') {
    // 망원경으로 찾은 공개 섬: 주민이 있고 정원이 남은 섬(신청 중인 섬은 가득 차도 남긴다)
    const pendings = state.pendingIslands ?? [];
    const candidates = state.islands.filter(
      (i) =>
        !i.closed &&
        !i.kicked &&
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
    const guideUserId = getSession()?.userId ?? 'local';
    const mailboxGuide = shouldShowMailboxGuide(state, guideUserId);
    const hallGuide = !mailboxGuide && hallGuideOpen && !island.buildings.includes('hall'),
      w = layout.compact ? Math.min(layout.floatingWidth, 374) : layout.floatingWidth;
    return (
      <View style={{ flex: 1 }}>
        {mailboxGuide ? (
          backgroundHome
        ) : (
          <IslandHome
            state={state}
            go={go}
            build={build}
            request={e.walkRequest}
            notify={notify}
            dispatch={dispatch}
          />
        )}
        {mailboxGuide && (
          <MailboxGuide
            key={`${guideUserId}:${island.id}`}
            onDone={(openMailbox) => {
              dispatch({ type: 'MAILBOX_GUIDE_DONE', userId: guideUserId });
              if (openMailbox) go('mail');
            }}
          />
        )}
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
            {island.playing && island.track ? trackNames[island.track] : '음악 선택'}
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
    const gramophone = componentTokens.gramophone;
    const scene = !!state.session;
    const audioProducts: any[] = server
      ? shopApi.items
      : products.filter((p) => p.kind === 'audio');
    const localAudioIds = new Set<string>(BUNDLED_AUDIO_TRACK_IDS);
    const serverAudioLoaded = !!shopApi.shared;
    const ownedTrackIds = (serverAudioLoaded ? shopApi.shared!.audio : island.sharedOwned).filter(
      hasBundledAudio,
    );
    const trackLabel = (id: string) => trackNames[id] ?? shopApi.titles[id] ?? id;
    const hasOwnedTracks = ownedTrackIds.length > 0;
    const currentTrack = typeof island.track === 'string' ? island.track : null;
    const serverPlaybackReady = !server || !!e.playback?.state;
    const hasCurrentTrack =
      serverPlaybackReady && currentTrack !== null && ownedTrackIds.includes(currentTrack);
    const trackIds = scene
      ? ownedTrackIds
      : [
          ...ownedTrackIds,
          ...audioProducts.map((p) => p.id).filter((id) => !ownedTrackIds.includes(id)),
        ];
    const largeText = (layout.fontScale ?? 1) >= gramophone.largeTextThreshold;
    const dialogProduct = soundDialog
      ? audioProducts.find((product) => product.id === soundDialog.productId)
      : undefined;
    const changePlayback = async (patch: { trackId?: string; playing?: boolean }) => {
      if (!server) {
        if (patch.trackId) setTrack(patch.trackId);
        else if (patch.playing !== undefined) act('PLAY', { value: patch.playing });
        return true;
      }
      try {
        await e.playback.update(patch);
        return true;
      } catch (thrown) {
        if (e.conversion?.offer(thrown)) return false;
        notify(serverErrorText(thrown) || '재생 상태를 바꾸지 못했어요. 다시 시도해 주세요.');
        return false;
      }
    };
    const selectTrack = (id: string) => {
      if (ownedTrackIds.includes(id)) changePlayback({ trackId: id, playing: true });
      else {
        const product = audioProducts.find((item) => item.id === id);
        if (
          !localAudioIds.has(id) ||
          (server && (product?.available === false || product?.price == null))
        )
          return;
        setSoundDialog({ kind: 'confirm', productId: id });
      }
    };
    const buyTrack = async () => {
      if (!dialogProduct) return;
      if (server) {
        try {
          await shopApi.buy(dialogProduct);
          setSoundDialog({ kind: 'success', productId: dialogProduct.id });
        } catch (thrown) {
          if (e.conversion?.offer(thrown)) setSoundDialog(null);
          else if (thrown instanceof ApiError && thrown.code === 'INSUFFICIENT_FUNDS')
            setSoundDialog({ kind: 'error', productId: dialogProduct.id });
          else {
            setSoundDialog(null);
            notify(
              thrown instanceof ApiError && thrown.message
                ? thrown.message
                : '구매하지 못했어요. 다시 시도해 주세요.',
            );
          }
        }
        return;
      }
      if (canBuy(state, dialogProduct)) {
        setSoundDialog({ kind: 'error', productId: dialogProduct.id });
        return;
      }
      act('BUY', { id: dialogProduct.id });
      setSoundDialog({ kind: 'success', productId: dialogProduct.id });
    };
    const bottomWidth = Math.min(gramophone.panelWidth, layout.width - ins.left - ins.right - 36);
    const panelWidth = layout.compact
      ? Math.min(gramophone.compactPanelWidth, layout.width - ins.left - ins.right - 36)
      : bottomWidth;
    const panelHeight = layout.compact ? gramophone.compactPanelHeight : gramophone.panelHeight;
    const contentHeight = layout.compact
      ? gramophone.compactContentHeight
      : gramophone.contentHeight;
    return (
      <View style={{ flex: 1, backgroundColor: C.paper }}>
        <View
          testID="sound-background-content"
          style={StyleSheet.absoluteFill}
          pointerEvents={soundDialog ? 'none' : 'auto'}
          accessibilityElementsHidden={!!soundDialog}
          importantForAccessibility={soundDialog ? 'no-hide-descendants' : 'auto'}
        >
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
              <Pic id={(layout.compact ? 'L/bldbg/' : 'bldbg/') + 'gram'} w="100%" h="100%" cover />
            )}
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={scene ? '집중으로 돌아가기' : '섬으로 돌아가기'}
            onPress={back}
            style={{
              position: 'absolute',
              left: 20 + ins.left,
              top: 16 + ins.top,
              width: gramophone.touchMin,
              height: gramophone.touchMin,
              borderRadius: gramophone.touchMin / 2,
              borderWidth: 1.5,
              borderColor: C.brown,
              backgroundColor: C.paper,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Txt tabletScale={1} style={{ fontSize: 28, lineHeight: 31 }}>
              ‹
            </Txt>
          </Pressable>
          {!scene && (
            <View
              style={[
                gradient(
                  `linear-gradient(90deg, ${gramophone.signStart}, ${gramophone.signCenter} 50%, ${gramophone.signEnd})`,
                ),
                {
                  position: 'absolute',
                  top: 20 + ins.top,
                  alignSelf: 'center',
                  minWidth: 124,
                  height: 40,
                  borderWidth: 1.5,
                  borderColor: gramophone.woodBorder,
                  borderRadius: 8,
                  alignItems: 'center',
                  justifyContent: 'center',
                  boxShadow: gramophone.signShadow,
                },
              ]}
            >
              <Txt
                tabletScale={1}
                style={{ color: gramophone.signForeground, fontSize: 17, lineHeight: 24 }}
              >
                축음기
              </Txt>
            </View>
          )}
          <View
            style={{
              position: 'absolute',
              left: (layout.width - panelWidth) / 2,
              bottom: Math.max(18, ins.bottom + 8),
              width: panelWidth,
              height: panelHeight,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 12,
              padding: 16,
              borderWidth: 2,
              borderColor: C.brown,
              borderRadius: 14,
              backgroundColor: gramophone.panelBackground,
              boxShadow: gramophone.panelShadow,
            }}
          >
            {island.buildings.includes('gram') ? (
              <>
                <View
                  style={{
                    width: 128,
                    height: contentHeight,
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}
                >
                  <View
                    accessibilityLabel={
                      hasCurrentTrack
                        ? `${trackLabel(currentTrack!)} 레코드판`
                        : '재생할 수 있는 곡이 없는 레코드판'
                    }
                    style={{
                      width: gramophone.recordSize,
                      height: gramophone.recordSize,
                      borderRadius: gramophone.recordSize / 2,
                      borderWidth: 6,
                      borderColor: gramophone.recordGroove,
                      backgroundColor: gramophone.recordBackground,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    {[88, 68, 48].map((size) => (
                      <View
                        key={size}
                        style={{
                          position: 'absolute',
                          width: size,
                          height: size,
                          borderRadius: size / 2,
                          borderWidth: 4,
                          borderColor: gramophone.recordGroove,
                        }}
                      />
                    ))}
                    <View
                      style={{
                        width: 30,
                        height: 30,
                        borderRadius: 15,
                        backgroundColor: C.pink,
                        borderWidth: 2,
                        borderColor: gramophone.recordGroove,
                      }}
                    />
                  </View>
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="재생"
                      accessibilityState={{ disabled: !hasCurrentTrack }}
                      disabled={!hasCurrentTrack}
                      onPress={() => changePlayback({ playing: true })}
                      style={{
                        width: gramophone.controlWidth,
                        height: gramophone.touchMin,
                        borderWidth: 1.5,
                        borderColor: C.brown,
                        borderRadius: 8,
                        backgroundColor: C.pink,
                        opacity: hasCurrentTrack ? 1 : 0.5,
                        alignItems: 'center',
                        justifyContent: 'center',
                        boxShadow: '0px 2px 0px ' + C.brown,
                      }}
                    >
                      <PlayIcon />
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="정지"
                      accessibilityState={{ disabled: !serverPlaybackReady }}
                      disabled={!serverPlaybackReady}
                      onPress={() => changePlayback({ playing: false })}
                      style={{
                        width: gramophone.controlWidth,
                        height: gramophone.touchMin,
                        borderWidth: 1.5,
                        borderColor: C.brown,
                        borderRadius: 8,
                        backgroundColor: C.paper,
                        alignItems: 'center',
                        justifyContent: 'center',
                        boxShadow: '0px 2px 0px ' + C.brown,
                      }}
                    >
                      <StopIcon />
                    </Pressable>
                  </View>
                </View>
                <View style={{ flex: 1, minWidth: 0, height: contentHeight, gap: 8 }}>
                  <View testID="sound-current-track" style={{ minHeight: 36, flexShrink: 0 }}>
                    <Txt
                      tabletScale={1}
                      style={{ color: gramophone.foreground, fontSize: 19, lineHeight: 24 }}
                    >
                      {hasCurrentTrack
                        ? trackLabel(currentTrack!)
                        : hasOwnedTracks
                          ? '재생할 곡을 골라 주세요'
                          : '보유한 곡이 없어요'}
                    </Txt>
                    <Txt
                      tabletScale={1}
                      style={{ color: gramophone.foregroundMuted, fontSize: 11, lineHeight: 14 }}
                    >
                      {hasCurrentTrack
                        ? island.playing
                          ? '재생 중'
                          : '정지됨'
                        : hasOwnedTracks
                          ? '보유곡에서 선택해 주세요'
                          : scene
                            ? '섬에서 곡을 구매할 수 있어요'
                            : '곡을 구매해 주세요'}
                    </Txt>
                  </View>
                  <Volume
                    value={state.settings.volume ?? 0.55}
                    onChange={(value: number) => act('SETTING', { key: 'volume', value })}
                  />
                  <ScrollView
                    style={{ flex: 1 }}
                    contentContainerStyle={{ gap: 4, paddingRight: 4 }}
                    showsVerticalScrollIndicator
                  >
                    {trackIds.map((id) => {
                      const owned = ownedTrackIds.includes(id);
                      const product = audioProducts.find((item) => item.id === id);
                      const selected = island.track === id;
                      const unavailable =
                        !owned &&
                        (!localAudioIds.has(id) ||
                          (server && (product?.available === false || product?.price == null)));
                      const status = owned
                        ? '보유'
                        : !localAudioIds.has(id)
                          ? '앱 업데이트가 필요해요'
                          : unavailable
                            ? shopBlockReason(product ?? {})
                            : `${product?.price}마리 · 구매`;
                      return (
                        <Pressable
                          key={id}
                          accessibilityRole="button"
                          accessibilityLabel={
                            owned
                              ? `${trackLabel(id)}, 보유`
                              : unavailable
                                ? `${trackLabel(id)}, ${status}`
                                : `${trackLabel(id)}, ${product?.price}마리로 구매`
                          }
                          accessibilityState={{ selected, disabled: unavailable }}
                          disabled={unavailable}
                          onPress={() => selectTrack(id)}
                          style={{
                            minHeight: gramophone.rowMinHeight,
                            paddingHorizontal: 10,
                            flexDirection: 'row',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            borderWidth: 1.25,
                            borderColor: C.brown,
                            borderRadius: 7,
                            backgroundColor: selected ? C.pink : owned ? C.paper : C.butter,
                            opacity: unavailable ? 0.62 : 1,
                          }}
                        >
                          <View style={{ flex: 1, minWidth: 0, paddingRight: 8 }}>
                            <Txt
                              testID={`sound-track-title-${id}`}
                              tabletScale={1}
                              style={{ fontSize: 11, lineHeight: 14, flexShrink: 1 }}
                            >
                              {trackLabel(id)}
                            </Txt>
                          </View>
                          <Txt
                            testID={`sound-track-status-${id}`}
                            tabletScale={1}
                            style={{
                              maxWidth: '45%',
                              flexShrink: 1,
                              textAlign: 'right',
                              color: gramophone.rowForeground,
                              fontSize: 9,
                              lineHeight: 12,
                            }}
                          >
                            {selected && island.playing ? '재생 중' : status}
                          </Txt>
                        </Pressable>
                      );
                    })}
                  </ScrollView>
                </View>
              </>
            ) : (
              <View style={{ flex: 1, alignItems: 'center', gap: 12 }}>
                <Txt style={{ color: gramophone.foreground }}>축음기를 먼저 지어 주세요.</Txt>
                <Btn title="마을회관에서 건설" onPress={() => go('construction')} />
              </View>
            )}
          </View>
        </View>
        {soundDialog && dialogProduct && (
          <View
            accessibilityViewIsModal
            style={[
              StyleSheet.absoluteFill,
              {
                backgroundColor: componentTokens.overlay.background,
                alignItems: 'center',
                justifyContent: 'center',
                padding: 24,
              },
            ]}
          >
            <View
              testID="sound-dialog-card"
              style={{
                width: Math.min(354, layout.width - 48),
                maxHeight: layout.height - ins.top - ins.bottom - 32,
                borderWidth: 2,
                borderColor: C.brown,
                borderRadius: 22,
                backgroundColor: C.paper,
                boxShadow: '0px 6px 0px ' + C.brown,
              }}
            >
              <ScrollView
                testID="sound-dialog-scroll"
                style={{ flexShrink: 1 }}
                contentContainerStyle={{ padding: 20, gap: 16 }}
              >
                {soundDialog.kind === 'error' && (
                  <View
                    style={{
                      width: 50,
                      height: 50,
                      borderRadius: 25,
                      alignSelf: 'center',
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: C.butter,
                    }}
                  >
                    <Txt tabletScale={1} style={{ fontSize: 27, lineHeight: 32 }}>
                      !
                    </Txt>
                  </View>
                )}
                <Txt
                  style={{ fontSize: 20, lineHeight: 28, fontWeight: '700', textAlign: 'center' }}
                >
                  {soundDialog.kind === 'confirm'
                    ? `${dialogProduct.title}를 구매할까요?`
                    : soundDialog.kind === 'success'
                      ? '구매했어요'
                      : '물고기가 부족해요'}
                </Txt>
                {soundDialog.kind === 'confirm' && (
                  <Txt kind="meta" style={{ textAlign: 'center', lineHeight: 20 }}>
                    구매한 곡은 같은 섬 주민 모두가 함께 들을 수 있어요.
                  </Txt>
                )}
                {soundDialog.kind === 'confirm' ? (
                  <View
                    testID="sound-dialog-actions"
                    style={{ flexDirection: largeText ? 'column' : 'row', gap: 8 }}
                  >
                    <Btn
                      title="취소"
                      kind="glass"
                      dynamicHeight={largeText}
                      onPress={() => setSoundDialog(null)}
                      style={largeText ? undefined : { flex: 1 }}
                    />
                    <Btn
                      title={`${dialogProduct.price}마리로 구매`}
                      dynamicHeight={largeText}
                      disabled={server && shopApi.writing}
                      onPress={buyTrack}
                      style={largeText ? undefined : { flex: 1 }}
                    />
                  </View>
                ) : (
                  <Btn
                    title={soundDialog.kind === 'success' ? '지금 재생하기' : '확인'}
                    dynamicHeight={largeText}
                    disabled={server && shopApi.writing}
                    onPress={async () => {
                      if (soundDialog.kind === 'success') {
                        const changed = await changePlayback({
                          trackId: dialogProduct.id,
                          playing: true,
                        });
                        if (!changed) return;
                      }
                      setSoundDialog(null);
                    }}
                  />
                )}
              </ScrollView>
            </View>
          </View>
        )}
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
          {state.settings.permission &&
          state.settings.screenTimeMeasurementReady &&
          (Platform.OS !== 'android' || state.settings.screenTimeMeasurementDay === dayKey(now)) ? (
            <>
              <Txt kind="meta">
                {Platform.OS === 'android'
                  ? '오늘 · 전체 앱 사용 시간'
                  : '오늘 · 선택한 앱의 사용 시간'}
              </Txt>
              <Group flat>
                <Row
                  title="오늘 폰 사용"
                  sub={md(now)}
                  right={
                    Platform.OS === 'android' ? (
                      <Txt>{state.screenMinutes}분</Txt>
                    ) : (
                      <ScreenTimeReportView
                        reportContext="Compact Activity"
                        style={{
                          width: primitiveTokens.space[16] * 2,
                          minHeight: primitiveTokens.size.tapMin,
                        }}
                      />
                    )
                  }
                />
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
                <Txt kind="h17">
                  {state.settings.permission
                    ? Platform.OS === 'android'
                      ? '오늘 사용 시간을 확인하고 있어요'
                      : '측정할 앱을 선택해야 해요'
                    : '스크린타임 연결이 꺼져 있어요'}
                </Txt>
                <Txt kind="meta" style={{ textAlign: 'center' }}>
                  {state.settings.permission
                    ? Platform.OS === 'android'
                      ? '오늘 측정이 확인되면 사용 시간을 표시해요.'
                      : `측정할 앱이나 카테고리를 선택하면\n오늘 폰 사용 시간을 볼 수 있어요.`
                    : `연결하면 오늘 폰 사용 시간을 여기서 볼 수 있어요.\n기록이 없는 것과 0분은 달라요.`}
                </Txt>
                <Btn
                  title={
                    state.settings.permission
                      ? Platform.OS === 'android'
                        ? '측정 권한 확인하기'
                        : '측정 앱 선택하기'
                      : '설정에서 켜기'
                  }
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
    // 섬 간 랭킹만 보여 준다(우리 섬 주민 순위 없음). 주민 평균 집중(이번 주) 순서, 매주 일요일 00시 초기화
    if (server) {
      // 서버 주간 랭킹이 정본(GROMO-2018) — rank(동점 공동)·myRank(전체 모집단 기준)는
      // 서버 값 그대로고, 앱이 순번을 다시 매기거나 0위를 지어내지 않는다.
      const rk = islandRankings,
        myIslandId = snap?.currentIslandId;
      return (
        <IslandSheet
          bg="tower"
          sign="bld/observatory"
          title="전망대"
          tight
          action="섬 찾기"
          actionPress={() => go('explore')}
          onClose={home}
        >
          <Txt kind="meta" style={st.meta}>
            주민 평균 집중 시간 · 매주 일요일 00시에 새로 시작해요
          </Txt>
          {rk.status === 'loading' && (
            <Txt
              kind="meta"
              testID="rankings-loading"
              style={[st.meta, { textAlign: 'center', paddingVertical: 24 }]}
            >
              순위를 불러오는 중이에요
            </Txt>
          )}
          {rk.status === 'error' && (
            <View style={{ alignItems: 'center', paddingVertical: 20, gap: 10 }}>
              <Txt kind="meta" style={[st.meta, { textAlign: 'center' }]}>
                {rk.error?.message ?? '순위를 불러오지 못했어요.'}
              </Txt>
              <Btn small kind="sec" testID="rankings-retry" title="다시 시도" onPress={rk.retry} />
            </View>
          )}
          {rk.status === 'ready' && rk.data && !rk.data.items.length && (
            <Txt kind="meta" style={[st.meta, { textAlign: 'center', paddingVertical: 24 }]}>
              아직 순위에 오른 섬이 없어요
            </Txt>
          )}
          {rk.status === 'ready' && rk.data && rk.data.items.length > 0 && (
            <>
              <SheetGroup>
                {rk.data.items.map((item) => (
                  <SheetRow
                    key={item.islandId}
                    title={item.name}
                    sub={`평균 ${hoursMinutes(item.averageFocusSeconds)}`}
                    label={`${item.rank}위 ${item.name}, 평균 ${hoursMinutes(item.averageFocusSeconds)}`}
                    tone={item.islandId === myIslandId ? 'butter' : undefined}
                    lead={
                      <Txt
                        style={{
                          width: 26,
                          fontSize: 18,
                          lineHeight: 26.1,
                          fontWeight: '800',
                          textAlign: 'center',
                        }}
                      >
                        {item.rank}
                      </Txt>
                    }
                    tail={<IslandThumb />}
                    chevron={item.islandId !== myIslandId}
                    onPress={
                      item.islandId === myIslandId
                        ? undefined
                        : () => run(() => server.visit(item.islandId))
                    }
                  />
                ))}
              </SheetGroup>
              {rk.data.myRank !== null && (
                <Txt kind="meta" style={[st.meta, { textAlign: 'center', paddingTop: 10 }]}>
                  우리 섬 이번 주 {rk.data.myRank}위
                </Txt>
              )}
            </>
          )}
        </IslandSheet>
      );
    }
    const islands = state.islands
      // 주민 2명 이상인 섬만 순위에 올린다(혼자 섬은 평균이 의미 없어서)
      .filter(
        (i) =>
          !i.closed &&
          !i.kicked &&
          (i.joined || i.visibility !== 'private') &&
          residentCount(i) >= 2,
      )
      .map((i) => ({ i, avg: islandWeeklyAverage(state, i, now) }))
      .sort((a, b) => b.avg - a.avg);
    return (
      <IslandSheet
        bg="tower"
        sign="bld/observatory"
        title="전망대"
        tight
        action="섬 찾기"
        actionPress={() => go('explore')}
        onClose={home}
      >
        <Txt kind="meta" style={st.meta}>
          주민 평균 집중 시간 · 매주 일요일 00시에 새로 시작해요
        </Txt>
        {!islands.length && (
          <Txt kind="meta" style={[st.meta, { textAlign: 'center', paddingVertical: 24 }]}>
            아직 순위에 오른 섬이 없어요
          </Txt>
        )}
        <SheetGroup>
          {islands.map(({ i, avg }, n) => (
            <SheetRow
              key={i.id}
              title={i.name}
              sub={`평균 ${hoursMinutes(avg)} · 주민 ${residentCount(i)}`}
              label={`${n + 1}위 ${i.name}, 평균 ${hoursMinutes(avg)}, 주민 ${residentCount(i)}명`}
              tone={n === 0 ? 'butter' : undefined}
              lead={
                <Txt
                  style={{
                    width: 26,
                    fontSize: 18,
                    lineHeight: 26.1,
                    fontWeight: '800',
                    textAlign: 'center',
                  }}
                >
                  {n + 1}
                </Txt>
              }
              tail={<IslandThumb warm={i.id === 'strawberry'} />}
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
          ))}
        </SheetGroup>
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
          !i.kicked &&
          i.visibility !== 'private' &&
          (!query || i.name.includes(query)) &&
          (i.joined || !isFull(i))) ||
        (!i.closed && !i.kicked && i.id === codeTarget),
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
        <SearchField value={search} onChange={setSearch} placeholder="섬 이름이나 초대 코드" />
        <Txt kind="meta" style={st.meta}>
          섬 이름이나 초대 코드를 입력해요. 이미 참가한 섬은 소속됨으로 표시돼요.
        </Txt>
        {results.length ? (
          <SheetGroup>
            {results.map((i) => (
              <SheetRow
                key={i.id}
                title={i.name}
                sub={`${i.intro} · 주민 ${residentCount(i)}`}
                chevron={!i.joined}
                tail={
                  <>
                    {i.joined && <Badge soft>소속됨</Badge>}
                    <IslandThumb warm={i.id === 'strawberry'} />
                  </>
                }
                onPress={() => {
                  setVisited(i.id);
                  i.id === island.id ? home() : go('visit', i.id);
                }}
              />
            ))}
          </SheetGroup>
        ) : (
          <Txt kind="meta" style={st.meta}>
            찾는 섬이 없어요. 이름이나 초대 코드를 확인해 주세요.
          </Txt>
        )}
      </IslandSheet>
    );
  }
  if (route === 'visit' || route === 'approval') {
    const i =
        state.islands.find((i) => i.id === (detail || visited || state.pendingIsland)) ||
        state.islands[1],
      pending = (state.pendingIslands ?? []).includes(i.id) || state.pendingIsland === i.id;
    const sail = () => {
      if (state.session) return notify('집중을 마친 뒤 이동해 주세요.');
      act('TRAVEL_FROM', { name: island.name });
      setVisited(i.id);
      go('travel', i.id);
    };
    // 승인 필요 섬은 신청만 하고 같은 시트에 토스트 한 줄(승인 대기 화면 없음). 방장이 확인하면 알림
    const apply = () => {
      if (state.session) return notify('집중을 마친 뒤 가입해 주세요.');
      if (i.kicked) return notify('강퇴된 섬에는 다시 가입할 수 없어요.');
      if (isFull(i)) return notify('정원이 가득 찬 섬이에요');
      act('JOIN', { id: i.id });
      if (i.approval) setSheetToast('참여 신청이 완료됐어요. 방장이 확인하면 알려드릴게요.');
      else {
        act('TRAVEL_FROM', { name: island.name });
        setVisited(i.id);
        go(state.onboarded ? 'travel' : 'arrival', i.id);
      }
    };
    return (
      <IslandSheet
        bg="tower"
        sign="bld/observatory"
        title="바다 건너 섬"
        tall
        onBack={back}
        onClose={state.onboarded ? home : () => replace('chooseIsland')}
        toast={sheetToast}
        footer={
          state.onboarded ? (
            // 소속 섬은 이동하고, 미가입 섬은 읽기 전용 관전 경로로 이동한다.
            <Cta
              note={pending ? '참여 신청을 보냈어요. 방장이 확인하면 알려드릴게요.' : undefined}
              title={i.joined ? '이 섬으로 가기' : '섬 둘러보기'}
              onPress={sail}
            />
          ) : (
            // 첫 섬 고르기: 아직 내 섬이 없어 구경할 수 없으므로 여기서 가입한다
            <Cta
              title="배 타고 이동"
              onPress={sail}
              ghost={
                i.joined
                  ? '소속된 섬'
                  : pending
                    ? '참여 신청됨 · 취소'
                    : i.approval
                      ? '가입 신청'
                      : '이 섬에 가입'
              }
              onGhost={
                i.joined
                  ? () => notify('이미 소속된 섬이에요.')
                  : pending
                    ? () => act('CANCEL_JOIN', { id: i.id })
                    : apply
              }
            />
          )
        }
      >
        {/* 가로 패널: 그림과 정보를 나란히 */}
        <View style={layout.compact ? { flexDirection: 'row', gap: 14 } : { gap: 14 }}>
          <Preview h={220} w={layout.compact ? 220 : undefined}>
            <Pic id="island/whole" w="100%" h="100%" cover />
          </Preview>
          <View style={{ flex: layout.compact ? 1 : undefined, minWidth: 0, gap: 14 }}>
            <Txt style={st.h22}>{i.name}</Txt>
            <Txt style={st.body}>{i.intro}</Txt>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <AvStack list={i.members.slice(0, 3).map((m) => m.color)} />
              <Txt kind="meta" style={[st.meta, { flex: 1 }]}>
                {`주민 ${residentCount(i)}명 · 평균 ${hoursMinutes(islandWeeklyAverage(state, i, now))}`}
              </Txt>
            </View>
            <Badge soft>{i.approval ? '승인 필요' : '바로 참여'}</Badge>
          </View>
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
  // 뗏목 위 고양이 그림. 합성 그림은 검정 고양이만 있어서 다른 털색은 뗏목 + 고양이를 겹쳐 그린다
  const worn = state.equipped.clothes;
  // 스카프는 합성 그림, 밀짚모자는 그림 위에 도형을 겹친다(모자 쓴 고양이 그림이 없어서)
  const raftCat = (h: number, scarf = worn === 'scarf', hat = worn === 'straw-hat') =>
    state.color === 'black' ? (
      <Preview h={h}>
        <Pic id={scarf ? 'boat/raft/cat-scarf' : 'boat/raft/cat'} w="92%" h="86%" />
        {hat && <HatOn image="raft" style={{ width: '92%', height: '86%' }} />}
      </Preview>
    ) : (
      <View>
        <Boat state={state} h={layout.compact ? 150 : h} scarf={scarf} />
        {hat && (
          // Boat 안 고양이 자리(left 0.36h · top 0.12h · 폭 0.42h) + 테두리 2
          <HatOn
            image="cat"
            style={{
              left: 2 + (layout.compact ? 150 : h) * 0.36,
              top: 2 + (layout.compact ? 150 : h) * 0.12,
              width: (layout.compact ? 150 : h) * 0.42,
              height: (layout.compact ? 150 : h) * 0.42,
            }}
          />
        )}
      </View>
    );
  const fishStrip = (
    <Strip
      label={island.name + ' 물고기'}
      value={
        server
          ? shopApi.wallets
            ? shopApi.wallets.villagePoints.toLocaleString() + '마리'
            : '…'
          : balance(island).toLocaleString() + '마리'
      }
    />
  );
  if (route === 'shop') {
    // 탭 2개: 내 꾸미기(옷·장신구) · 우리 섬 꾸미기(섬·건물 테마). 음원은 축음기에서 산다
    // 서버 모드는 탭이 곧 category 이고 목록은 서버 응답 그대로다(GROMO-2017).
    const mine = tab !== '우리 섬 꾸미기',
      cols = layout.compact ? 4 : 2,
      items = server
        ? shopApi.items.map(shopCard)
        : products.filter((p) =>
            mine ? p.kind === 'clothes' : p.kind === 'island' || p.kind === 'building',
          );
    const card = (p: any) => (
      <Pressable
        key={p.id}
        accessibilityRole="button"
        accessibilityLabel={`${p.title}, ${p.price == null ? '준비 중' : `${p.price}마리`}${owned(p) ? ', 보유 중' : ''}`}
        onPress={() => go('product', p.id)}
        style={{
          flex: 1,
          padding: 10,
          gap: 6,
          borderWidth: 1.5,
          borderColor: C.brown,
          borderRadius: 18,
          backgroundColor: C.paper,
        }}
      >
        <View
          style={{
            height: layout.compact ? 84 : 112,
            borderRadius: 12,
            backgroundColor: mine ? '#FFF0F3' : '#E3F4FC',
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'hidden',
          }}
        >
          {p.id === 'straw-hat' ? (
            <HatArt />
          ) : p.kind === 'island' ? (
            <Pic id="island/whole" w="100%" h="100%" cover />
          ) : (
            <Pic
              id={p.kind === 'building' ? 'bld/' + buildingArt[p.building || 'hall'] : 'scarf-cat'}
              w="92%"
              h="92%"
            />
          )}
        </View>
        {owned(p) && (
          <View
            style={{
              position: 'absolute',
              left: 16,
              top: 16,
              paddingHorizontal: 8,
              paddingVertical: 2,
              borderWidth: 1.5,
              borderColor: C.brown,
              borderRadius: 999,
              backgroundColor: C.butter,
            }}
          >
            <Txt style={{ fontSize: 11, lineHeight: 15.95, fontWeight: '700' }}>보유 중</Txt>
          </View>
        )}
        <Txt
          style={{
            fontSize: layout.compact ? 13 : 14,
            lineHeight: layout.compact ? 18.85 : 20.3,
            fontWeight: '700',
          }}
        >
          {p.title}
        </Txt>
        <Txt kind="meta" style={{ lineHeight: 18.85 }}>
          {p.price == null ? '준비 중' : `${p.price}마리`}
        </Txt>
      </Pressable>
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
        {fishStrip}
        <Chips
          items={['내 꾸미기', '우리 섬 꾸미기']}
          value={mine ? '내 꾸미기' : '우리 섬 꾸미기'}
          onChange={setTab}
        />
        {mine ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Pic id="dog" w={56} />
            <Txt kind="meta" style={[st.meta, { flex: 1 }]}>
              어서 와, 기다렸어! 물고기로 사는 건 내 뗏목에서 입어.
            </Txt>
          </View>
        ) : (
          <Txt kind="meta" style={st.meta}>
            섬 물고기로 사고 여기서 바로 적용해요. 주민 누구나 바꿀 수 있어요.
          </Txt>
        )}
        {server && shopApi.error ? (
          <View style={{ alignItems: 'center', gap: 10, paddingVertical: 24 }}>
            <Txt kind="meta" style={st.meta}>
              {serverErrorText(shopApi.error) || '상점을 불러오지 못했어요.'}
            </Txt>
            <Btn title="다시 시도" onPress={shopApi.retry} />
          </View>
        ) : server && shopApi.loading ? (
          <Txt kind="meta" style={[st.meta, { textAlign: 'center', paddingVertical: 24 }]}>
            불러오는 중…
          </Txt>
        ) : null}
        {/* 세로 2열 · 가로 4열. 마지막 줄이 모자라면 빈칸으로 폭을 맞춘다 */}
        <View style={{ gap: layout.compact ? 10 : 12 }}>
          {Array.from({ length: Math.ceil(items.length / cols) }, (_, r) => (
            <View key={r} style={{ flexDirection: 'row', gap: layout.compact ? 10 : 12 }}>
              {Array.from({ length: cols }, (_, c) => {
                const p = items[r * cols + c];
                // 칸마다 같은 폭(카드 안쪽 여백이 폭 나누기에 끼지 않게 한 겹 감싼다)
                return (
                  <View key={c} style={{ flex: 1, minWidth: 0 }}>
                    {p && card(p)}
                  </View>
                );
              })}
            </View>
          ))}
        </View>
      </IslandSheet>
    );
  }
  if (route === 'product') {
    // 서버 모드는 상품 상세 계약이 정본이다(GROMO-2017) — 가격·owned·available·버전 모두
    // 서버 응답을 쓰고 목업 products/canBuy 는 건드리지 않는다.
    const sp = server
      ? ((shopApi.detail && shopApi.detail.id === detail ? shopApi.detail : null) ??
        shopApi.items.find((i) => i.id === detail) ??
        null)
      : null;
    if (server && !sp) {
      return (
        <IslandSheet
          bg="shop"
          sign="dog"
          signKind="npc"
          title="상품 상세"
          tall
          onBack={back}
          onClose={home}
        >
          <Txt kind="meta" style={[st.meta, { textAlign: 'center', paddingVertical: 24 }]}>
            {shopApi.detailLoading
              ? '불러오는 중…'
              : serverErrorText(shopApi.detailError) || '상품을 불러오지 못했어요.'}
          </Txt>
        </IslandSheet>
      );
    }
    const p = sp
        ? shopCard({ ...sp, description: '' })
        : products.find((p) => p.id === detail) || products[0],
      audio = p.kind === 'audio',
      clothes = p.kind === 'clothes',
      has = server ? !!sp?.owned : owned(p),
      // 살 수 없는 이유 — 서버 모드는 available/blockedReason 응답이 정본이다
      error = has
        ? null
        : server
          ? sp!.available
            ? null
            : shopBlockReason(sp!)
          : canBuy(state, p),
      remaining = Math.max(
        0,
        (server ? (shopApi.wallets?.villagePoints ?? 0) : balance(island)) - (p.price ?? 0),
      ),
      applied =
        p.kind === 'island'
          ? (server ? shopApi.shared?.appearance.islandThemeId : island.theme) === p.id
          : p.kind === 'building'
            ? (server
                ? shopApi.shared?.appearance.buildingThemes?.[p.building || 'hall']
                : island.buildingThemes?.[p.building || 'hall']) === p.id
            : false;
    // 적용은 서버 PATCH 가 정본 — 실패하면 성공 토스트를 띄우지 않는다(false 반환).
    const apply = (value: string): Promise<boolean> => {
      if (server)
        return shopApi
          .applyTheme(
            p.kind === 'island'
              ? { islandThemeId: value }
              : { buildingThemes: { [p.building || 'hall']: value } },
          )
          .then(() => true)
          .catch((thrown) => {
            const m = serverErrorText(thrown);
            if (m) notify(m);
            return false;
          });
      act('THEME', { kind: p.kind, building: p.building || 'hall', value });
      return Promise.resolve(true);
    };
    const buy = () =>
      confirm(
        p.title + '를 살까요?',
        `섬 물고기 ${p.price}마리 사용 · 구매 후 ${remaining.toLocaleString()}마리` +
          (clothes ? '\n산 사람의 보유품이라 섬을 떠나도 남아요.' : ''),
        () => {
          if (server) {
            // 응답 + 지갑·인벤토리·내역 재조회가 끝날 때만 성공 토스트 — 실패·응답 유실에는 붙지 않는다.
            shopApi
              .buy({ id: p.id, productVersion: sp!.productVersion })
              .then(() => setSheetToast('구매했어요.'))
              .catch((thrown) => {
                const m = serverErrorText(thrown);
                if (m) notify(m);
              });
            return;
          }
          act('BUY', { id: p.id });
          setSheetToast('구매했어요.');
        },
        { ok: '구매' },
      );
    const cta = !has ? (
      <Cta
        note={
          error ??
          (audio
            ? `구매 후 ${remaining.toLocaleString()}마리`
            : `섬 물고기 ${p.price}마리 사용 · 구매 후 ${remaining.toLocaleString()}마리`)
        }
        title={audio ? `섬 물고기 ${p.price}마리로 구매` : `${p.price}마리로 구매`}
        onPress={buy}
        disabled={!!error || (server && shopApi.writing)}
      />
    ) : clothes ? (
      <Cta title="내 뗏목에서 갈아입기" onPress={() => walkTo('wardrobe')} />
    ) : audio ? (
      <Cta title="축음기에서 듣기" onPress={() => go('sound')} />
    ) : (
      <Cta
        title={applied ? '우리 섬에 적용됨' : '우리 섬에 적용'}
        // 적용됨은 시안 모양 그대로 두고 누름만 막는다(Btn이 비활성으로 읽음)
        onPress={
          applied
            ? undefined
            : () =>
                void apply(p.id).then((ok) => {
                  if (ok) setSheetToast('우리 섬에 적용했어요.');
                })
        }
        ghost="기본 외양으로 해제"
        onGhost={() => {
          const current =
            p.kind === 'island'
              ? server
                ? shopApi.shared?.appearance.islandThemeId
                : island.theme
              : server
                ? shopApi.shared?.appearance.buildingThemes?.[p.building || 'hall']
                : island.buildingThemes?.[p.building || 'hall'];
          if (!current || current === 'default') {
            setSheetToast('이미 기본 외양이에요');
            return;
          }
          void apply('default').then((ok) => {
            if (ok) setSheetToast('기본 외양으로 되돌렸어요.');
          });
        }}
      />
    );
    return (
      <IslandSheet
        bg={audio ? 'gram' : 'shop'}
        sign={audio ? 'bld/gramophone' : 'dog'}
        signKind={audio ? '' : 'npc'}
        title={audio ? '음원 사기' : '상품 상세'}
        tall
        onBack={back}
        onClose={home}
        footer={cta}
        toast={sheetToast}
      >
        {clothes ? (
          raftCat(260, p.id === 'scarf', p.id === 'straw-hat')
        ) : audio ? (
          <Preview h={220} bg={C.soft}>
            <Pic id="bld/gramophone" w={170} />
            <View style={{ position: 'absolute', left: 16, bottom: 22 }}>
              <Badge soft>나만 미리듣기</Badge>
            </View>
            {/* 미리듣기는 내 기기에서만. 섬 재생에는 영향 없음 */}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={previewAudio ? '미리듣기 멈춤' : '나만 미리듣기'}
              onPress={() => {
                try {
                  if (previewAudio) {
                    player.pause();
                    setPreviewAudio(false);
                  } else {
                    player.replace(assets['audio/' + p.id + '.wav']);
                    // 미리듣기는 한 번만(끝나면 재생 종료 이벤트로 버튼을 되돌린다)
                    player.loop = false;
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
              <PlayIcon pause={previewAudio} />
            </Pressable>
          </Preview>
        ) : p.kind === 'island' ? (
          <Preview h={220}>
            <Pic id="island/whole" w="100%" h="100%" cover />
          </Preview>
        ) : (
          <Preview h={220}>
            <Pic id={'bld/' + buildingArt[p.building || 'hall']} w={180} />
          </Preview>
        )}
        <Txt style={st.h22}>{p.title}</Txt>
        {has && !audio && <Badge>보유 중{applied ? ' · 적용됨' : ''}</Badge>}
        <Txt style={st.body}>
          {p.description}
          {p.kind === 'island' && applied ? ' 지금 우리 섬에 적용돼 있어요.' : ''}
        </Txt>
        {clothes && (
          <Txt kind="meta" style={st.meta}>
            산 사람의 보유품이라 섬을 떠나도 남아요.
          </Txt>
        )}
        {audio && (
          <Txt kind="meta" style={st.meta}>
            주민 누구나 살 수 있어요. 사면 섬 전체가 함께 들어요.
          </Txt>
        )}
      </IslandSheet>
    );
  }
  if (route === 'orders') {
    // 내 구매 = 옷·장신구(날짜·시각), 섬 공동 구매 = 이 섬 테마·음원(날짜·구매자, 방장이면 "방장")
    // 서버 모드는 scope=personal|shared 응답이 정본 — 내역 가격은 당시 확정가 스냅숏이다(GROMO-2017).
    const shared = tab === '섬 공동 구매';
    const list: State['orders'] = server
      ? shopApi.orders.map((o) => ({
          id: o.id,
          product: o.productId,
          islandId: island.id,
          currency: 'village_points',
          price: o.price,
          at: Date.parse(o.createdAt),
        }))
      : state.orders.filter((o) => {
          const kind = products.find((p) => p.id === o.product)?.kind;
          return shared ? kind !== 'clothes' && o.islandId === island.id : kind === 'clothes';
        });
    return (
      <IslandSheet
        bg="shop"
        sign="dog"
        signKind="npc"
        title="구매 내역"
        tight
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
        {server && shopApi.ordersLoading ? (
          <Txt kind="meta" style={[st.meta, { textAlign: 'center', paddingVertical: 24 }]}>
            불러오는 중…
          </Txt>
        ) : server && shopApi.ordersError ? (
          <View style={{ alignItems: 'center', gap: 10, paddingVertical: 24 }}>
            <Txt kind="meta" style={st.meta}>
              {serverErrorText(shopApi.ordersError) || '구매 내역을 불러오지 못했어요.'}
            </Txt>
            <Btn title="다시 시도" onPress={shopApi.retry} />
          </View>
        ) : list.length ? (
          <SheetGroup>
            {list.map((o) => (
              <SheetRow
                key={o.id}
                title={productTitle(o.product)}
                sub={
                  shared
                    ? [md(o.at), o.buyer && (isHostName(o.buyer) ? '방장' : o.buyer)]
                        .filter(Boolean)
                        .join(' · ')
                    : `${md(o.at)} · ${hm(o.at)}`
                }
                right={`${o.price}마리`}
                chevron
                onPress={() => go('product', o.product)}
              />
            ))}
          </SheetGroup>
        ) : (
          <Txt kind="meta" style={[st.meta, { textAlign: 'center', paddingVertical: 24 }]}>
            아직 구매한 물건이 없어요.
          </Txt>
        )}
      </IslandSheet>
    );
  }
  const friends = state.friends ?? [];
  if (route === 'boat') {
    const received = friends.filter((f) => f.status === 'received').length,
      joinedIslands = state.islands.filter((candidate) => candidate.joined && !candidate.closed),
      primaryIsland = mainIsland(state) ?? island,
      canChangeMainIsland = joinedIslands.length > 1;
    const mainIslandCard = (
      <>
        <IslandCircle size={112} />
        <View style={{ flex: 1, height: 128, marginLeft: 20, paddingTop: 1, paddingRight: 22 }}>
          <Txt
            kind="meta"
            style={{ fontSize: 13, lineHeight: 19, fontWeight: '600', color: C.muted }}
          >
            현재 내 메인 섬
          </Txt>
          <Txt style={[st.h22, { marginTop: 1 }]}>{primaryIsland.name}</Txt>
          <Txt kind="meta" style={{ fontSize: 12, lineHeight: 18, marginTop: 1, color: C.muted }}>
            친구 목록과 프로필에 표시돼요
          </Txt>
          {canChangeMainIsland && (
            <Txt
              style={{
                position: 'absolute',
                left: 0,
                bottom: 1,
                fontSize: 13,
                lineHeight: 19,
                fontWeight: '600',
                color: '#9A4C3E',
              }}
            >
              메인 섬 변경하기
            </Txt>
          )}
          {canChangeMainIsland && (
            <View style={{ position: 'absolute', right: 0, top: 51 }}>
              <SheetChev />
            </View>
          )}
        </View>
      </>
    );
    return (
      <IslandSheet bg="dock" sign="boat/raft" title="내 뗏목" tight onClose={home}>
        {canChangeMainIsland ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`현재 내 메인 섬 ${primaryIsland.name}, 메인 섬 변경하기`}
            onPress={() => go('mainIsland')}
            style={({ pressed }) => ({
              height: 164,
              flexDirection: 'row',
              alignItems: 'center',
              paddingHorizontal: 16,
              backgroundColor: C.paper,
              borderWidth: 2,
              borderColor: C.brown,
              borderRadius: 20,
              boxShadow: '0px 4px 0px #8B695657',
              opacity: pressed ? 0.78 : 1,
            })}
          >
            {mainIslandCard}
          </Pressable>
        ) : (
          <View
            accessible
            accessibilityLabel={`현재 내 메인 섬 ${primaryIsland.name}`}
            style={{
              height: 164,
              flexDirection: 'row',
              alignItems: 'center',
              paddingHorizontal: 16,
              backgroundColor: C.paper,
              borderWidth: 2,
              borderColor: C.brown,
              borderRadius: 20,
              boxShadow: '0px 4px 0px #8B695657',
            }}
          >
            {mainIslandCard}
          </View>
        )}
        <SheetGroup>
          <SheetRow
            title="보유품 꾸미기"
            sub="옷 · 장신구"
            lead={<Pic id="scarf-cat" w={28} />}
            chevron
            onPress={() => go('wardrobe')}
          />
          <SheetRow
            title="친구 관리"
            sub="친구 찾기 · 요청 · 친구 목록"
            lead={<RowIcon name="group" />}
            right={
              received ? (
                <Txt
                  style={{
                    fontSize: 15,
                    lineHeight: 21.75,
                    fontWeight: '700',
                    fontVariant: ['tabular-nums'],
                  }}
                >
                  요청 {received}
                </Txt>
              ) : undefined
            }
            chevron
            onPress={() => go('friends')}
          />
          <SheetRow
            title="내 정보"
            sub="닉네임 · 털색 · 계정"
            lead={<Pic id={'avatar/' + state.color} w={28} />}
            chevron
            onPress={() => go('profile')}
          />
          <SheetRow
            title="앱 설정"
            sub="알림 · 소리 · 앱 권한 · 튜토리얼 다시보기"
            lead={<RowIcon name="gear" />}
            chevron
            onPress={() => go('settings')}
          />
        </SheetGroup>
      </IslandSheet>
    );
  }
  if (route === 'mainIsland') {
    const joinedIslands = state.islands.filter(
        (candidate) => candidate.joined && !candidate.closed,
      ),
      primaryIsland = mainIsland(state),
      selectedIsland =
        joinedIslands.find((candidate) => candidate.id === mainIslandPick) ?? primaryIsland,
      unchanged = !selectedIsland || selectedIsland.id === primaryIsland?.id;
    return (
      <IslandSheet
        bg="dock"
        sign="island/whole"
        title="내 메인 섬 변경하기"
        tall
        tight
        onBack={back}
        onClose={home}
      >
        <View style={{ gap: 5 }}>
          <Txt style={{ fontSize: 18, lineHeight: 25, fontWeight: '700' }}>
            대표로 보여줄 섬을 골라 주세요
          </Txt>
          <Txt kind="meta" style={{ fontSize: 12, lineHeight: 18, color: C.muted }}>
            친구 목록과 프로필에 표시되는 대표 섬이에요.{`\n`}
            집중하거나 접속 중인 섬은 바뀌지 않아요.
          </Txt>
        </View>
        <View
          style={{
            backgroundColor: C.paper,
            borderWidth: 2,
            borderColor: C.brown,
            borderRadius: 18,
            overflow: 'hidden',
            boxShadow: '0px 4px 0px #8B695657',
          }}
        >
          {joinedIslands.map((candidate, index) => {
            const selected = candidate.id === selectedIsland?.id,
              current = candidate.id === primaryIsland?.id;
            return (
              <Pressable
                key={candidate.id}
                accessibilityRole="radio"
                accessibilityLabel={`${candidate.name}, 주민 ${residentCount(candidate)}명, ${isHost(candidate) ? '내가 방장' : '멤버'}${current ? ', 현재 메인 섬' : ''}`}
                accessibilityState={{ selected }}
                onPress={() => setMainIslandPick(candidate.id)}
                style={({ pressed }) => ({
                  height: 84,
                  flexDirection: 'row',
                  alignItems: 'center',
                  paddingHorizontal: 14,
                  backgroundColor: selected ? C.soft : C.paper,
                  borderBottomWidth: index < joinedIslands.length - 1 ? 1 : 0,
                  borderBottomColor: '#8B695633',
                  opacity: pressed ? 0.76 : 1,
                })}
              >
                <IslandCircle size={56} />
                <View style={{ flex: 1, minWidth: 0, marginLeft: 14, gap: 3 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Txt style={{ fontSize: 16, lineHeight: 22, fontWeight: '700' }}>
                      {candidate.name}
                    </Txt>
                    {current ? (
                      <View
                        style={{
                          height: 22,
                          paddingHorizontal: 10,
                          borderRadius: 11,
                          backgroundColor: C.sky,
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        <Txt style={{ fontSize: 10, lineHeight: 14, fontWeight: '600' }}>
                          현재 메인 섬
                        </Txt>
                      </View>
                    ) : (
                      selected && (
                        <Txt
                          style={{
                            fontSize: 11,
                            lineHeight: 16,
                            fontWeight: '600',
                            color: '#9A4C3E',
                          }}
                        >
                          선택됨
                        </Txt>
                      )
                    )}
                  </View>
                  <Txt kind="meta" style={{ fontSize: 12, lineHeight: 18, color: C.muted }}>
                    주민 {residentCount(candidate)}명 · {isHost(candidate) ? '내가 방장' : '멤버'}
                  </Txt>
                </View>
                <MainIslandRadio selected={selected} />
              </Pressable>
            );
          })}
        </View>
        <Txt
          kind="meta"
          style={{ width: '100%', fontSize: 11, lineHeight: 17, textAlign: 'center' }}
        >
          메인 섬을 바꿔도 현재 접속한 섬은 그대로예요.
        </Txt>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            selectedIsland ? `${selectedIsland.name}으로 변경하기` : '메인 섬 변경하기'
          }
          accessibilityState={{ disabled: unchanged }}
          disabled={unchanged}
          onPress={() => {
            if (!selectedIsland) return;
            act('MAIN_ISLAND', { id: selectedIsland.id });
            back();
          }}
          style={({ pressed }) => ({
            width: '100%',
            height: 52,
            borderRadius: 26,
            borderWidth: 2,
            borderColor: C.brown,
            backgroundColor: C.pink,
            alignItems: 'center',
            justifyContent: 'center',
            opacity: unchanged ? 0.42 : pressed ? 0.76 : 1,
          })}
        >
          <Txt style={{ fontSize: 15, lineHeight: 22, fontWeight: '800' }}>
            {selectedIsland ? `${selectedIsland.name}으로 변경하기` : '메인 섬 변경하기'}
          </Txt>
        </Pressable>
      </IslandSheet>
    );
  }
  if (route === 'wardrobe') {
    // 가진 옷·장신구만 보여 주고, 누르면 바로 입는다(선택 = 적용)
    const thumb = (value: string, label: string, picture: React.ReactNode) => {
      const on = worn === value || (value === 'default' && ['default', 'none'].includes(worn));
      return (
        <Pressable
          key={value}
          accessibilityRole="button"
          accessibilityLabel={label}
          accessibilityState={{ selected: on }}
          onPress={() => {
            // 서버 모드는 PATCH /me/appearance 가 정본 — 실패하면 착용 표시도 바꾸지 않는다.
            if (server) {
              const patch =
                value === 'default'
                  ? { clothes: null }
                  : shopApi.kinds[value] === 'decor'
                    ? { decor: value }
                    : { clothes: value };
              shopApi.equip(patch).catch((thrown) => {
                const m = serverErrorText(thrown);
                if (m) notify(m);
              });
              return;
            }
            act('EQUIP', { key: 'clothes', value });
          }}
          style={{ width: 76, gap: 5, alignItems: 'center' }}
        >
          <View
            style={{
              width: 76,
              height: 76,
              borderWidth: 2,
              borderColor: on ? C.brown : '#D9C6B8',
              borderRadius: 16,
              backgroundColor: on ? C.soft : C.paper,
              boxShadow: on ? '0px 3px 0px ' + C.brown : 'none',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {picture}
            {on && (
              <View style={{ position: 'absolute', top: -6, right: -6 }}>
                <CheckDot />
              </View>
            )}
          </View>
          <Txt
            style={{
              fontSize: 12,
              lineHeight: 17.4,
              fontWeight: on ? '700' : '600',
              color: on ? C.ink : C.muted,
            }}
          >
            {label}
          </Txt>
        </Pressable>
      );
    };
    return (
      <IslandSheet
        bg="dock"
        sign="boat/raft"
        title="내 꾸미기"
        tall
        tight
        onBack={back}
        onClose={home}
      >
        {raftCat(260)}
        <Txt kind="section" style={st.sec}>
          옷·장신구
        </Txt>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
          {thumb('default', '기본', <Pic id={'cat/' + state.color} w={60.5} />)}
          {(server
            ? [...(shopApi.my?.clothes ?? []), ...(shopApi.my?.decor ?? [])]
            : products
                .filter((p) => p.kind === 'clothes' && state.owned.includes(p.id))
                .map((p) => p.id)
          ).map((id) =>
            thumb(
              id,
              server ? productTitle(id) : products.find((p) => p.id === id)?.title || id,
              id === 'straw-hat' ? <HatArt w={72} scale={0.7} /> : <Pic id="scarf-cat" w={60.5} />,
            ),
          )}
        </View>
      </IslandSheet>
    );
  }
  if (route === 'friends' || route === 'friendSearch') {
    const serverMode = !!server;
    const data = serverMode ? friendsScreen.data : null;
    const received = serverMode
      ? (data?.friendRequests ?? [])
      : friends.filter((friend) => friend.status === 'received');
    const sent = serverMode
      ? (data?.sentFriendRequests ?? [])
      : friends.filter((friend) => friend.status === 'sent');
    const accepted = serverMode
      ? (data?.friends ?? [])
      : friends.filter((friend) => friend.status === 'friend');
    const queryValue = serverMode ? friendsScreen.query : search;
    const query = queryValue.trim().toLowerCase();
    const localResults = query
      ? friendDirectory.filter((friend) => friend.name.toLowerCase() === query)
      : [];
    const sectionTitle = (title: string, count?: number) => (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
        <Txt kind="section" style={[st.sec, { marginTop: 0 }]}>
          {title}
        </Txt>
        {count !== undefined && <Badge small>{count}</Badge>}
      </View>
    );
    const friendMenu = (name: string, onDelete: () => void) => (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${name} 친구 삭제`}
        hitSlop={6}
        onPress={() =>
          confirm(
            '친구를 삭제할까요?',
            `${name}님과 더 이상 편지를 주고받을 수 없어요. 아직 읽지 않은 편지도 지워져요.`,
            onDelete,
            { ok: '삭제', destructive: true },
          )
        }
        style={{ width: 32, height: 32, alignItems: 'center', justifyContent: 'center' }}
      >
        <Txt
          style={{
            fontSize: 20,
            lineHeight: 29,
            fontWeight: '800',
            letterSpacing: 1,
            color: C.brown,
          }}
        >
          ···
        </Txt>
      </Pressable>
    );
    const requestActions = (onAccept: () => void, onReject: () => void) => (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Btn small title="수락" disabled={serverMode && friendsScreen.busy} onPress={onAccept} />
        <Btn
          small
          kind="sec"
          title="거절"
          disabled={serverMode && friendsScreen.busy}
          onPress={onReject}
        />
      </View>
    );
    const localFriendRow = (friend: (typeof friends)[number], searchResult = false) => (
      <SheetRow
        key={friend.id}
        title={friend.name}
        sub={
          friend.island +
          (friend.status === 'sent'
            ? ' · 수락 기다리는 중'
            : searchResult && friend.status === 'received'
              ? ' · 받은 요청'
              : '')
        }
        tone={friend.status === 'received' ? 'butter' : undefined}
        lead={<Avatar color={friend.color} />}
        tail={
          friend.status === 'received' ? (
            requestActions(
              () => act('FRIEND_ACCEPT', { id: friend.id }),
              () => act('FRIEND_REJECT', { id: friend.id }),
            )
          ) : friend.status === 'sent' ? (
            <Btn
              small
              kind="sec"
              title="요청 취소"
              onPress={() => act('FRIEND_CANCEL', { id: friend.id })}
            />
          ) : friend.status === 'friend' ? (
            searchResult ? (
              <Badge soft>친구</Badge>
            ) : (
              friendMenu(friend.name, () => act('FRIEND_DELETE', { id: friend.id }))
            )
          ) : (
            <Btn
              small
              title="친구 요청"
              onPress={() => act('FRIEND_REQUEST', { id: friend.id, friend })}
            />
          )
        }
      />
    );
    const serverReceivedRows = (data?.friendRequests ?? []).map((friend) => {
      const name = friend.nickname ?? '탈퇴한 사용자';
      return (
        <SheetRow
          key={friend.requestId}
          title={name}
          tone="butter"
          lead={<Avatar color="white" />}
          tail={requestActions(
            () => friendCmd(() => acceptFriendRequest(friend.requestId)),
            () => friendCmd(() => rejectFriendRequest(friend.requestId)),
          )}
        />
      );
    });
    const serverSentRows = (data?.sentFriendRequests ?? []).map((friend) => (
      <SheetRow
        key={friend.requestId}
        title={friend.nickname ?? '탈퇴한 사용자'}
        sub="수락 기다리는 중"
        lead={<Avatar color="white" />}
        tail={
          <Btn
            small
            kind="sec"
            title="요청 취소"
            disabled={friendsScreen.busy}
            onPress={() => friendCmd(() => cancelFriendRequest(friend.requestId))}
          />
        }
      />
    ));
    const serverFriendRows = (data?.friends ?? []).map((friend) => {
      const name = friend.nickname ?? '탈퇴한 사용자';
      return (
        <SheetRow
          key={friend.userId}
          title={name}
          sub={friend.mainIslandName ?? undefined}
          lead={<Avatar color="white" />}
          tail={friendMenu(name, () => friendCmd(() => deleteFriend(friend.userId)))}
        />
      );
    });
    const receivedRows = serverMode
      ? serverReceivedRows
      : (received as Friend[]).map((friend) => localFriendRow(friend));
    const sentRows = serverMode
      ? serverSentRows
      : (sent as Friend[]).map((friend) => localFriendRow(friend));
    const friendRows = serverMode
      ? serverFriendRows
      : (accepted as Friend[]).map((friend) => localFriendRow(friend));
    const empty = (message = '아직 없어요.') => (
      <Txt kind="meta" style={[st.meta, { paddingVertical: 10 }]}>
        {message}
      </Txt>
    );
    const searchRows = serverMode
      ? friendsScreen.searchItems.map((friend) => (
          <SheetRow
            key={friend.userId}
            title={friend.nickname}
            sub={friend.relation === 'FRIEND' ? '친구' : undefined}
            lead={<Avatar color="white" />}
            tail={
              friend.relation === 'NONE' ? (
                <Btn
                  small
                  title="친구 요청"
                  disabled={friendsScreen.busy}
                  onPress={() => friendCmd(() => sendFriendRequest(friend.userId))}
                />
              ) : (
                <Btn
                  small
                  kind="sec"
                  disabled
                  title={friend.relation === 'PENDING' ? '요청 중' : '친구'}
                />
              )
            }
          />
        ))
      : localResults.map((candidate) => {
          const existing = friends.find((friend) => friend.id === candidate.id);
          return localFriendRow(existing ?? { ...candidate, status: 'none', messages: [] }, true);
        });
    const searchContent =
      serverMode && friendsScreen.searchStatus === 'error' ? (
        <SheetGroup>
          <View style={{ alignItems: 'center', gap: 9, paddingVertical: 18 }}>
            <Txt kind="meta">{friendsScreen.searchError?.message ?? '검색하지 못했어요'}</Txt>
            <Btn small kind="sec" title="다시 시도" onPress={friendsScreen.retry} />
          </View>
        </SheetGroup>
      ) : serverMode && friendsScreen.searchStatus !== 'ready' ? (
        <Txt kind="meta" style={[st.meta, { paddingVertical: 10 }]}>
          찾는 중이에요…
        </Txt>
      ) : searchRows.length ? (
        <SheetGroup>{searchRows}</SheetGroup>
      ) : (
        <SheetGroup>
          <View style={{ paddingVertical: 24, paddingHorizontal: 18, alignItems: 'center' }}>
            <Txt style={{ fontSize: 16, lineHeight: 23, fontWeight: '700' }}>
              검색 결과가 없어요
            </Txt>
          </View>
        </SheetGroup>
      );
    const leftColumn = query ? (
      <View style={{ flex: layout.compact ? 1 : undefined, minWidth: 0, gap: 7 }}>
        {sectionTitle('검색 결과')}
        {searchContent}
      </View>
    ) : (
      <View style={{ flex: layout.compact ? 1 : undefined, minWidth: 0, gap: 16 }}>
        <View style={{ gap: 7 }}>
          {sectionTitle('받은 요청', receivedRows.length)}
          {receivedRows.length ? <SheetGroup>{receivedRows}</SheetGroup> : empty()}
        </View>
        <View style={{ gap: 7 }}>
          {sectionTitle('보낸 요청')}
          {sentRows.length ? <SheetGroup>{sentRows}</SheetGroup> : empty()}
        </View>
      </View>
    );
    const friendColumn = (
      <View style={{ flex: layout.compact ? 1 : undefined, minWidth: 0, gap: 7 }}>
        {sectionTitle('친구')}
        {serverMode && friendsScreen.status === 'loading' ? (
          <Txt kind="meta" style={[st.meta, { paddingVertical: 10 }]}>
            불러오는 중이에요
          </Txt>
        ) : serverMode && friendsScreen.status === 'error' ? (
          <View style={{ alignItems: 'center', gap: 9, paddingVertical: 12 }}>
            <Txt kind="meta">{friendsScreen.error?.message ?? '친구 목록을 불러오지 못했어요'}</Txt>
            <Btn small kind="sec" title="다시 시도" onPress={friendsScreen.retry} />
          </View>
        ) : friendRows.length ? (
          <SheetGroup>{friendRows}</SheetGroup>
        ) : (
          empty('아직 친구가 없어요.')
        )}
      </View>
    );
    return (
      <IslandSheet bg="dock" sign="boat/raft" title="친구 관리" tall onBack={back} onClose={home}>
        <SearchField
          value={queryValue}
          onChange={serverMode ? friendsScreen.setQuery : setSearch}
          placeholder="닉네임으로 친구 찾기"
        />
        {serverMode && !query && friendsScreen.status === 'loading' ? (
          <Txt kind="meta" style={[st.meta, { textAlign: 'center', paddingVertical: 24 }]}>
            불러오는 중이에요
          </Txt>
        ) : serverMode && !query && friendsScreen.status === 'error' ? (
          <View style={{ alignItems: 'center', gap: 9, paddingVertical: 24 }}>
            <Txt kind="meta">{friendsScreen.error?.message ?? '친구 목록을 불러오지 못했어요'}</Txt>
            {friendErrorKind(friendsScreen.error) === 'guest' && e.conversion ? (
              <Btn
                small
                title="소셜 로그인하기"
                onPress={() => e.conversion.offer(friendsScreen.error)}
              />
            ) : (
              <Btn small kind="sec" title="다시 시도" onPress={friendsScreen.retry} />
            )}
          </View>
        ) : (
          <View
            style={
              layout.compact
                ? { flexDirection: 'row', alignItems: 'flex-start', gap: 18 }
                : { gap: 16 }
            }
          >
            {leftColumn}
            {friendColumn}
          </View>
        )}
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
        <View style={{ alignItems: 'center' }}>
          <Avatar color={profileColor} size={96} />
        </View>
        <AvatarGrid mini value={profileColor} onChange={setProfileColor} />
        <Field
          label="닉네임"
          value={profileName}
          onChange={setProfileName}
          inputStyle={sheetInput}
        />
        <SheetGroup>
          <SheetRow title="연동 계정" sub={state.name + '님의 GROMO 계정 · Apple'} />
          <SheetRow
            title="로그아웃"
            chevron
            onPress={() =>
              confirm('로그아웃할까요?', '저장된 기록은 그대로 남아요.', () => {
                e.signOut();
                act('LOGOUT');
                reset('login');
              })
            }
          />
        </SheetGroup>
        <Btn
          title="회원 탈퇴"
          kind="danger"
          style={{ alignSelf: 'center' }}
          onPress={() =>
            mustTransferHost
              ? notify('방장을 다른 주민에게 넘긴 뒤 회원 탈퇴할 수 있어요.')
              : confirm(
                  '회원 탈퇴할까요?',
                  '계정과 저장된 기록을 모두 삭제해요. 되돌릴 수 없어요.\n모은 물고기는 섬에 남아요.',
                  () => {
                    screenTime
                      .resetScreenTimeData()
                      .catch(() => {})
                      .finally(() => {
                        act('DELETE_ACCOUNT');
                        reset('login');
                      });
                  },
                  { ok: '탈퇴', destructive: true },
                )
          }
        />
      </IslandSheet>
    );
  }
  if (route === 'settings') {
    const toggle = (label: string, key: string, sub?: string) => (
      <SheetRow
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
    const sec = (name: string) => (
      <Txt kind="section" style={st.sec}>
        {name}
      </Txt>
    );
    // 기록 공개 토글은 없다(도서관 기록은 전체 공개 고정)
    return (
      <IslandSheet
        bg="dock"
        sign="boat/raft"
        title="앱 설정"
        tall
        tight
        onBack={back}
        onClose={home}
      >
        {sec('알림·소리')}
        <SheetGroup flat>
          {toggle('알림', 'notifications')}
          {toggle('소리', 'sound')}
          {toggle('가벼운 진동', 'haptics')}
        </SheetGroup>
        {sec('화면')}
        <SheetGroup flat>
          {toggle('동작 줄이기', 'reduceMotion', '이동·전환 애니메이션을 줄여요')}
        </SheetGroup>
        {sec('권한')}
        <SheetGroup flat>
          <SheetRow
            title="앱 권한 관리"
            sub="스크린타임 권한 · 측정 앱"
            chevron
            onPress={() => go('permission', 'settings')}
          />
        </SheetGroup>
        {sec('도움말')}
        <SheetGroup flat>
          <SheetRow
            title="튜토리얼 다시보기"
            sub="앵무새 안내를 처음부터 다시 봐요"
            chevron
            onPress={() => {
              setGuideStep(0);
              go('guide');
            }}
          />
        </SheetGroup>
        {sec('앱 정보')}
        <SheetGroup flat>
          <SheetRow title="버전" sub="R61 · v2" />
          <SheetRow
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
        </SheetGroup>
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
  // 시안 .slider: 좌우 4px 안쪽의 6px 막대 + 24px 손잡이. 잡기 쉽게 손잡이 높이만큼 칸을 두고, 늘어난 높이는 위아래 여백으로 되돌린다
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
      style={{
        height: 44,
        marginHorizontal: 4,
        justifyContent: 'center',
      }}
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
          left: width * value - 12,
          top: 10,
          width: 24,
          height: 24,
          borderRadius: 12,
          borderWidth: 2,
          borderColor: C.brown,
          backgroundColor: C.paper,
        }}
      />
    </View>
  );
}

// 친구 찾기 목업 사용자. 닉네임이 같은 사람이 여럿일 수 있다(시안 보리 2명)
const friendDirectory: Omit<Friend, 'status' | 'messages'>[] = [
  { id: 'saebom', name: '새봄', color: 'white', island: '딸기 섬' },
  { id: 'minji', name: '민지', color: 'ginger', island: '소다 섬' },
  { id: 'haneul', name: '하늘', color: 'calico', island: '구름 섬' },
  { id: 'bori-strawberry', name: '보리', color: 'gray', island: '딸기 섬' },
  { id: 'bori', name: '보리', color: 'cream', island: '구름 섬' },
];
