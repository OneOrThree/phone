import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Image,
  ImageSourcePropType,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  ViewStyle,
} from 'react-native';
import Svg, { G, Path, Polygon } from 'react-native-svg';
import { Asset } from 'expo-asset';
import { useFonts } from 'expo-font';

// 원본: gachisup-R61-assets/preview/concepts/building-interiors-3 (index.html · app.js · board.js · style.css)
// 건물 안 장면 위에 기능 화면을 얹는 38개 시안을 RN으로 옮긴다. 수치는 원본 CSS 그대로다.

export type Item = [string, string, string];
export type Concept = {
  title: string;
  kind: string;
  position: 'scene' | 'bottom' | 'middle';
  items: Item[];
  managementTab?: 'info' | 'residents' | 'requests';
  boardPanel?: '' | 'notice' | 'quest' | 'blueprint';
  boardRole?: 'owner' | 'resident';
  boardView?: string;
};
export type BuildingData = {
  id: string;
  name: string;
  background: ImageSourcePropType;
  concepts: Concept[];
};
export type ArtifactProps = {
  building: BuildingData;
  concept: Concept;
  index: number;
  width: number;
  height: number;
  reduceMotion: boolean;
  showToast: (message: string) => void;
};
export type ArtifactRenderer = (props: ArtifactProps) => React.ReactElement | null;

export const interiorArt = {
  buildings: {
    hall: require('@/assets/interiors/buildings/hall.png'),
    noticeboard: require('@/assets/interiors/buildings/noticeboard.png'),
    observatory: require('@/assets/interiors/buildings/observatory.png'),
    mailbox: require('@/assets/interiors/buildings/mailbox.png'),
    shop: require('@/assets/interiors/buildings/shop.png'),
    gramophone: require('@/assets/interiors/buildings/gramophone.png'),
    library: require('@/assets/interiors/buildings/library.png'),
  },
  avatars: {
    black: require('@/assets/interiors/avatars/black.png'),
    calico: require('@/assets/interiors/avatars/calico.png'),
    cream: require('@/assets/interiors/avatars/cream.png'),
    ginger: require('@/assets/interiors/avatars/ginger.png'),
    gray: require('@/assets/interiors/avatars/gray.png'),
    white: require('@/assets/interiors/avatars/white.png'),
  },
  catBlack: require('@/assets/redesign/cat-black.png'),
  boardPaper: {
    notice: require('@/assets/interiors/ui/board-sheet-notice-v2.png'),
    quest: require('@/assets/interiors/ui/board-sheet-quest-v2.png'),
  },
};

// 원본 이미지 픽셀 크기 (배경은 모두 1024×1536)
export const artSize = {
  background: [1024, 1536],
  hall: [1163, 1178],
  noticeboard: [837, 877],
  observatory: [695, 1067],
  mailbox: [550, 849],
  shop: [1050, 874],
  gramophone: [632, 910],
  library: [814, 1178],
  avatar: [256, 256],
} as const;

export const kindCopy: Record<string, string> = {
  'island-management': '섬 관리',
  'hall-desk': '마을회관 책상',
  'building-models': '목각 건물',
  'village-ledger': '공동 가계부',
  'building-blueprint': '건물 청사진',
  'board-final': '게시판',
  'board-notice': '공지 목록',
  'board-notice-detail': '공지 상세',
  'board-quest': '퀘스트 상세',
  'board-blueprint': '청사진 상세',
  'observatory-desk': '노트북과 지도',
  'island-ranking': '섬 랭킹',
  'old-map': '낡은 지도',
  'mail-home': '열린 우체통',
  'island-room': '섬 편지방',
  'friend-mail': '친구 편지',
  tryon: '거울',
  counter: '진열대',
  themes: '섬 테마',
  records: '레코드판',
  player: '턴테이블',
  catalog: '음원 상자',
};

export const buildOptions = [
  {
    id: 'library',
    name: '도서관',
    image: interiorArt.buildings.library,
    size: artSize.library,
    price: '1인당 20마리',
    time: '공사 15분',
    summary: '집중·스크린타임 기록',
    detail: '나와 주민들의 집중 기록, 스크린타임, 누적 물고기를 일·주·월로 확인해요.',
    locked: false,
  },
  {
    id: 'observatory',
    name: '전망대',
    image: interiorArt.buildings.observatory,
    size: artSize.observatory,
    price: '1인당 40마리',
    time: '공사 30분',
    summary: '다른 섬 랭킹과 탐색',
    detail: '다른 섬의 주간 랭킹을 보고 공개 섬을 찾아 구경하거나 가입해요.',
    locked: false,
  },
  {
    id: 'mailbox',
    name: '우체통',
    image: interiorArt.buildings.mailbox,
    size: artSize.mailbox,
    price: '1인당 30마리',
    time: '공사 20분',
    summary: '주민·친구 편지',
    detail: '섬 주민 모두의 편지방과 다른 섬 친구에게 보내는 개인 편지를 이용해요.',
    locked: false,
  },
  {
    id: 'gramophone',
    name: '축음기',
    image: interiorArt.buildings.gramophone,
    size: artSize.gramophone,
    price: '1인당 10마리',
    time: '공사 5분',
    summary: '공동 음원 재생',
    detail: '모닥불과 집중 화면에서 함께 들을 음원을 구매하고 재생해요.',
    locked: false,
  },
  {
    id: 'shop',
    name: '상점',
    image: interiorArt.buildings.shop,
    size: artSize.shop,
    price: '1인당 50마리',
    time: '공사 1시간',
    summary: '의상·섬 테마 구매',
    detail: '고양이 의상과 장신구, 섬과 건물 테마를 공동 물고기로 구매해요.',
    locked: true,
  },
];

const board = (
  title: string,
  boardPanel: Concept['boardPanel'],
  boardRole: Concept['boardRole'],
  boardView: string,
): Concept => ({
  title,
  kind: 'board-view',
  position: 'scene',
  items: [],
  boardPanel,
  boardRole,
  boardView,
});

export const buildings: BuildingData[] = [
  {
    id: 'hall',
    name: '마을회관',
    background: require('@/assets/interiors/hall-cute-v1.png'),
    concepts: [
      {
        title: '마을회관 책상',
        kind: 'hall-desk',
        position: 'scene',
        items: [
          ['섬 관리', '소다 섬 관리', '섬 이름·소개 · 가입 방식 · 주민 8/15'],
          ['건물 선택', '다음 건물 고르기', '방장이 목표를 정하고 게시판에서 진행해요'],
          ['공동 가계부', '공동 물고기 1,240마리', '적립과 건설·공동 구매 내역'],
        ],
      },
      {
        title: '목각 건물 고르기',
        kind: 'building-models',
        position: 'scene',
        items: [
          ['도서관', '공부 기록을 모아보는 도서관', '1인당 20마리 · 15분'],
          ['전망대', '다른 섬을 찾아보는 전망대', '1인당 40마리 · 30분'],
          ['우체통', '주민과 친구의 편지가 오가는 곳', '1인당 30마리 · 20분'],
        ],
      },
      {
        title: '공동 가계부',
        kind: 'village-ledger',
        position: 'bottom',
        items: [
          ['현재 잔액', '공동 물고기 1,240마리', '소다 섬이 함께 보유한 물고기'],
          ['적립 내역', '오늘 +125마리', '집중과 퀘스트 보상으로 적립'],
          ['사용 내역', '축음기 음원 −80마리', '어제 · 주민 공동 구매'],
        ],
      },
      {
        title: '건물 청사진',
        kind: 'building-blueprint',
        position: 'scene',
        items: [
          ['도서관', '도서관 건설 계획', '1인당 20마리 · 공사 15분'],
          ['전망대', '전망대 건설 계획', '1인당 40마리 · 공사 30분'],
          ['우체통', '우체통 건설 계획', '1인당 30마리 · 공사 20분'],
        ],
      },
      {
        title: '섬 관리 · 섬 정보',
        kind: 'island-management',
        managementTab: 'info',
        position: 'scene',
        items: [],
      },
      {
        title: '섬 관리 · 주민',
        kind: 'island-management',
        managementTab: 'residents',
        position: 'scene',
        items: [],
      },
      {
        title: '섬 관리 · 가입 신청',
        kind: 'island-management',
        managementTab: 'requests',
        position: 'scene',
        items: [],
      },
    ],
  },
  {
    id: 'board',
    name: '게시판',
    background: require('@/assets/interiors/board-three-papers-v5.png'),
    concepts: [
      board('게시판 기본 화면', '', 'owner', 'list'),
      board('공지 목록 · 방장', 'notice', 'owner', 'list'),
      board('공지 목록 · 주민', 'notice', 'resident', 'list'),
      board('공지 상세 · 방장', 'notice', 'owner', 'detail'),
      board('공지 상세 · 주민', 'notice', 'resident', 'detail'),
      board('공지 작성 · 방장', 'notice', 'owner', 'write'),
      board('공지 수정 · 방장', 'notice', 'owner', 'edit'),
      board('공지 저장 실패 · 방장', 'notice', 'owner', 'write-failed'),
      board('댓글 작성 · 주민', 'notice', 'resident', 'comment'),
      board('퀘스트 목록 · 방장', 'quest', 'owner', 'list'),
      board('퀘스트 목록 · 주민', 'quest', 'resident', 'list'),
      board('퀘스트 자세히 보기', 'quest', 'resident', 'detail'),
      board('일일 퀘스트 생성·수정', 'quest', 'owner', 'write'),
      board('청사진 · 준비 중', 'blueprint', 'owner', 'waiting'),
      board('청사진 · 방장 건설 가능', 'blueprint', 'owner', 'ready'),
      board('청사진 · 주민 대기', 'blueprint', 'resident', 'ready'),
      board('청사진 · 공사 중', 'blueprint', 'owner', 'building'),
    ],
  },
  {
    id: 'observatory',
    name: '전망대',
    background: require('@/assets/interiors/observatory-cute-v1.png'),
    concepts: [
      {
        title: '노트북과 낡은 지도',
        kind: 'observatory-desk',
        position: 'scene',
        items: [
          ['낡은 노트북', '다른 섬 주간 랭킹', '이번 주 집중 평균으로 순위를 봐요'],
          ['오래된 지도', '다른 섬 찾기', '공개 섬을 찾고 구경하거나 가입해요'],
        ],
      },
      {
        title: '노트북 속 섬 랭킹',
        kind: 'island-ranking',
        position: 'bottom',
        items: [
          ['1위', '라임 섬 · 42시간 20분', '주민 12명'],
          ['2위 · 우리 섬', '소다 섬 · 38시간 45분', '주민 8명'],
          ['3위', '구름 섬 · 34시간 10분', '주민 6명'],
        ],
      },
      {
        title: '낡은 지도 펼치기',
        kind: 'old-map',
        position: 'bottom',
        items: [
          ['내 소속 섬', '소다 섬', '현재 머무는 곳'],
          ['공개 섬 찾기', '새로운 섬 둘러보기', '조건에 맞는 섬 12개'],
          ['초대 입력', '초대받은 섬 찾기', '초대 코드를 지도에 찍어요'],
        ],
      },
    ],
  },
  {
    id: 'mail',
    name: '우체통',
    background: require('@/assets/interiors/mail-cute-v1.png'),
    concepts: [
      {
        title: '열린 우체통',
        kind: 'mail-home',
        position: 'bottom',
        items: [
          ['우리 섬', '주민 모두의 편지방', '새 편지 7개'],
          ['받은 편지', '친구가 보낸 봉투', '읽지 않은 편지 3개'],
          ['편지 쓰기', '친구 한 명에게', '받는 친구를 먼저 골라요'],
        ],
      },
      {
        title: '우리 섬 편지방',
        kind: 'island-room',
        position: 'bottom',
        items: [
          ['민지', '오늘 밤 모닥불에서 만나자', '방금'],
          ['두부', '새 레코드 같이 들어볼 사람?', '8분 전'],
          ['수아', '오늘 물고기 많이 잡았어', '21분 전'],
        ],
      },
      {
        title: '친구에게 보내는 편지',
        kind: 'friend-mail',
        position: 'bottom',
        items: [
          ['민지', '구름 섬 · 친구', '마지막 편지 오늘 09:12'],
          ['밤이', '밤비 섬 · 친구', '마지막 편지 어제 22:40'],
          ['보리', '라임 섬 · 친구', '아직 주고받은 편지 없음'],
        ],
      },
    ],
  },
  {
    id: 'shop',
    name: '상점',
    background: require('@/assets/interiors/shop-cute-v1.png'),
    concepts: [
      {
        title: '거울 앞 바로 입어보기',
        kind: 'tryon',
        position: 'bottom',
        items: [
          ['꽃 밀짚모자', '살랑살랑 여름 모자', '물고기 120마리'],
          ['파란 스카프', '바닷빛이 도는 스카프', '물고기 80마리'],
          ['조개 브로치', '작은 진주가 반짝여요', '물고기 60마리'],
        ],
      },
      {
        title: '카운터 위 오늘의 상품',
        kind: 'counter',
        position: 'bottom',
        items: [
          ['오늘의 추천', '꽃 밀짚모자', '오늘만 10% 할인'],
          ['새로 들어왔어요', '파란 물결 러그', '섬 꾸미기 상품'],
          ['주민 인기 상품', '데이지 머리핀', '7명이 보유 중'],
        ],
      },
      {
        title: '유리돔 속 섬 테마',
        kind: 'themes',
        position: 'middle',
        items: [
          ['초록 정원', '꽃과 덩굴이 가득한 섬', '공동 물고기 800마리'],
          ['노을 해변', '매일 따뜻한 저녁빛', '공동 물고기 1,000마리'],
          ['별빛 야영', '랜턴과 별이 빛나는 밤', '공동 물고기 1,200마리'],
        ],
      },
    ],
  },
  {
    id: 'gram',
    name: '축음기',
    background: require('@/assets/interiors/gram-cute-v1.png'),
    concepts: [
      {
        title: '레코드 상자 뒤적이기',
        kind: 'records',
        position: 'bottom',
        items: [
          ['파도 소리', '잔잔한 해변 ASMR', '현재 재생 중'],
          ['숲의 바람', '잎사귀가 흔들리는 소리', '보유 음원'],
          ['빗방울', '천막 위로 내리는 비', '보유 음원'],
        ],
      },
      {
        title: '바늘을 직접 내리기',
        kind: 'player',
        position: 'bottom',
        items: [
          ['재생', '파도 소리', '00:42 / 30:00'],
          ['음량', '내 기기 60%', '다른 주민에게 영향 없음'],
          ['음소거', '내 기기에서만 끄기', '공동 재생은 계속돼요.'],
        ],
      },
      {
        title: '앨범 표지 진열대',
        kind: 'catalog',
        position: 'middle',
        items: [
          ['밤의 모닥불', '장작 타는 소리와 풀벌레', '미리듣기 30초'],
          ['고요한 도서관', '종이 넘기는 소리', '미리듣기 30초'],
          ['작은 기차 여행', '규칙적인 레일 소리', '미리듣기 30초'],
        ],
      },
    ],
  },
];

// 원본 body 글꼴 스택. 웹에서는 Gowun에 없는 기호가 원본과 같은 대체 글꼴로 그려지게 스택째 넘긴다
export const BODY_FONT =
  Platform.OS === 'web'
    ? "Gowun,-apple-system,BlinkMacSystemFont,'Apple SD Gothic Neo',sans-serif"
    : 'Gowun';
export const GOWUN = 'Gowun';
export const INK = '#493b39';
export const OUTLINE = '#7d5f4d';

// CSS 그라데이션 문자열: 웹은 background-image, 네이티브는 RN 0.76+의 experimental_backgroundImage
export const gradient = (css: string): any =>
  Platform.OS === 'web' ? { backgroundImage: css } : { experimental_backgroundImage: css };
// 웹 전용 CSS (backdrop-filter 등). 네이티브에서는 무시한다
export const webOnly = (style: Record<string, unknown>): any =>
  Platform.OS === 'web' ? style : null;
// react-native-web은 반투명 색의 알파를 소수 둘째 자리로 반올림해 원본과 1단계 어긋난다.
// var() 로 감싸면 색 문자열을 그대로 CSS에 넘긴다 (변수는 없으니 뒤의 색이 쓰인다)
export const exact = (color: string): string =>
  Platform.OS === 'web' ? `var(--exact,${color})` : color;
// CSS text-shadow 한 겹 (x y 색). 웹은 문자열 그대로, 네이티브는 textShadow* 로 푼다
export const textShadow = (x: number, y: number, color: string): any =>
  Platform.OS === 'web'
    ? { textShadow: `${x}px ${y}px ${color}` }
    : { textShadowColor: color, textShadowOffset: { width: x, height: y }, textShadowRadius: 0 };
// 웹에서 원본 CSS와 같은 방식으로 그림을 깔 때 쓰는 주소
export const assetUri = (source: ImageSourcePropType) => Asset.fromModule(source as number).uri;
// 원본 크롬은 줄 높이를 1/64px 단위로 내려 잡는다. 같은 높이로 맞춰야 회전한 요소 가장자리가 어긋나지 않는다
export const lh = (px: number) => Math.floor(px * 64) / 64;

export function useInteriorFonts() {
  return useFonts({
    Gowun: require('@/assets/fonts/gowun-dodum.ttf'),
    BoardHand: require('@/assets/interiors/fonts/Gaegu-Regular.ttf'),
    'BoardHand-Bold': require('@/assets/interiors/fonts/Gaegu-Bold.ttf'),
  });
}

// CSS ease (cubic-bezier(.25,.1,.25,1))
const ease = Easing.bezier(0.25, 0.1, 0.25, 1);

const hotspotAt: Record<string, [string, string]> = {
  'building-models': ['47%', '45%'],
  'village-ledger': ['47%', '45%'],
  'building-blueprint': ['47%', '45%'],
  'island-ranking': ['48%', '49%'],
  'old-map': ['48%', '49%'],
  'mail-home': ['49%', '45%'],
  'island-room': ['49%', '45%'],
  'friend-mail': ['49%', '45%'],
  tryon: ['47%', '48%'],
  counter: ['47%', '48%'],
  themes: ['47%', '48%'],
  records: ['48%', '51%'],
  player: ['48%', '51%'],
  catalog: ['48%', '51%'],
};

// @keyframes hotspot 1.8s ease-in-out infinite: 50%에서 scale 1.06, 바깥 링 6px→11px
// 웹은 원본과 같은 CSS 애니메이션을 그대로 건다 (그림자 문자열은 Animated 보간으로 적용되지 않는다)
const hotspotPulse =
  Platform.OS === 'web'
    ? StyleSheet.create({
        pulse: {
          animationKeyframes: [
            {
              '50%': {
                boxShadow: '0 0 0 2px #fff9,0 0 0 11px #f4a7bb1c',
                transform: 'scale(1.06)',
              },
            },
          ],
          animationDuration: '1.8s',
          animationTimingFunction: 'ease-in-out',
          animationIterationCount: 'infinite',
        } as any,
      }).pulse
    : null;
const easeInOut = Easing.bezier(0.42, 0, 0.58, 1);

function Hotspot({
  at,
  label,
  reduceMotion,
  onPress,
}: {
  at: [string, string];
  label: string;
  reduceMotion: boolean;
  onPress: () => void;
}) {
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduceMotion || Platform.OS === 'web') return;
    // 네이티브는 크기만 뛴다 (키프레임 구간마다 ease-in-out)
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(t, { toValue: 1, duration: 900, easing: easeInOut, useNativeDriver: true }),
        Animated.timing(t, { toValue: 0, duration: 900, easing: easeInOut, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [reduceMotion, t]);
  return (
    <Animated.View
      style={[
        {
          position: 'absolute',
          zIndex: 5,
          left: at[0] as any,
          top: at[1] as any,
          width: 36,
          height: 36,
          borderRadius: 18,
          backgroundColor: exact('#fffc'),
          boxShadow: '0 0 0 2px #fff9,0 0 0 6px #f4a7bb55',
        },
        reduceMotion
          ? null
          : Platform.OS === 'web'
            ? hotspotPulse
            : {
                transform: [
                  { scale: t.interpolate({ inputRange: [0, 1], outputRange: [1, 1.06] }) },
                ],
              },
      ]}
    >
      <Pressable
        testID="scene-hotspot"
        accessibilityLabel={label}
        onPress={onPress}
        style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }}
      >
        <View
          style={{
            position: 'absolute',
            left: 10,
            right: 10,
            top: 10,
            bottom: 10,
            borderRadius: 8,
            backgroundColor: '#f4a7bb',
          }}
        />
      </Pressable>
    </Animated.View>
  );
}

// @keyframes toast 1.7s ease both: 0% 투명·아래 18px → 15~75% 보임 → 100% 투명·위 8px
function Toast({ message, serial }: { message: string; serial: number }) {
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    t.setValue(0);
    Animated.timing(t, {
      toValue: 1,
      duration: 1700,
      easing: Easing.linear,
      useNativeDriver: false,
    }).start();
  }, [serial, t]);
  return (
    <Animated.View
      testID="scene-toast"
      style={{
        position: 'absolute',
        zIndex: 30,
        left: '50%',
        bottom: 28,
        maxWidth: '80%',
        paddingVertical: 7,
        paddingHorizontal: 12,
        borderWidth: 1.5,
        borderColor: '#69503e',
        borderRadius: 99,
        backgroundColor: '#fff8e9',
        boxShadow: '0 3px 8px #34221842',
        pointerEvents: 'none',
        opacity: t.interpolate({ inputRange: [0, 0.15, 0.75, 1], outputRange: [0, 1, 1, 0] }),
        transform: [
          { translateX: '-50%' },
          {
            translateY: t.interpolate({
              inputRange: [0, 0.15, 0.75, 1],
              outputRange: [18, 0, 0, -8],
            }),
          },
        ],
      }}
    >
      <Text
        numberOfLines={1}
        style={{
          fontFamily: BODY_FONT,
          fontSize: 8,
          lineHeight: lh(12.8),
          fontWeight: '800',
          color: '#4a3931',
        }}
      >
        {message}
      </Text>
    </Animated.View>
  );
}

const fill = { position: 'absolute' as const, left: 0, right: 0, top: 0, bottom: 0 };

export function InteriorScreen({
  buildingIndex,
  conceptIndex,
  width,
  height,
  reduceMotion = false,
  hideArtifact = false,
}: {
  buildingIndex: number;
  conceptIndex: number;
  width: number;
  height: number;
  reduceMotion?: boolean;
  hideArtifact?: boolean;
}) {
  const building = buildings[buildingIndex],
    concept = building.concepts[conceptIndex];
  const [toast, setToast] = useState({ message: '', serial: 0 });
  const showToast = (message: string) => setToast((prev) => ({ message, serial: prev.serial + 1 }));
  // 핫스팟을 누르면 .artifact-wrap.peek: 기능 화면을 아래로 88% 내리고 흐리게 (transition .3s ease)
  const [peek, setPeek] = useState(false);
  const peekAnim = useRef(new Animated.Value(0)).current;
  const [wrapHeight, setWrapHeight] = useState(0);
  useEffect(() => {
    if (Platform.OS === 'web') return;
    Animated.timing(peekAnim, {
      toValue: peek ? 1 : 0,
      duration: reduceMotion ? 0 : 300,
      easing: ease,
      useNativeDriver: true,
    }).start();
  }, [peek, reduceMotion, peekAnim]);
  const peekStyle =
    Platform.OS === 'web'
      ? [
          peek && { transform: [{ translateY: '88%' }], opacity: 0.75 },
          !reduceMotion &&
            webOnly({
              transitionProperty: 'transform, opacity',
              transitionDuration: '0.3s',
              transitionTimingFunction: 'ease',
            }),
        ]
      : {
          opacity: peekAnim.interpolate({ inputRange: [0, 1], outputRange: [1, 0.75] }),
          transform: [
            {
              translateY: peekAnim.interpolate({
                inputRange: [0, 1],
                outputRange: [0, wrapHeight * 0.88],
              }),
            },
          ],
        };
  const isHall = building.id === 'hall';
  const hotspot = building.id === 'board' ? undefined : hotspotAt[concept.kind];
  const Artifact = artifacts[concept.kind];
  const modeLabel =
    isHall || building.id === 'board'
      ? ''
      : `${String.fromCharCode(65 + conceptIndex)}안 · ${kindCopy[concept.kind]} 중심`;
  const wrap =
    concept.position === 'scene'
      ? fill
      : concept.position === 'bottom'
        ? { left: 14, right: 14, bottom: 22 }
        : { left: 14, right: 14, top: '23%' as const };
  const screenGradient =
    'linear-gradient(180deg,#37271d12 0%,transparent 24%,transparent 70%,#37271d0c 100%)';
  // background-size:auto 100% · 가운데 정렬
  const bgWidth = (height * artSize.background[0]) / artSize.background[1];

  return (
    <View
      testID="interiors-screen"
      style={[
        { width, height, overflow: 'hidden' },
        // 웹은 원본과 같은 CSS 배경으로 깔아야 그림 확대 결과가 픽셀까지 같다
        webOnly({
          backgroundImage: `${screenGradient},url("${assetUri(building.background)}")`,
          backgroundSize: 'auto 100%',
          backgroundPosition: ['hall', 'observatory', 'mail'].includes(building.id)
            ? 'center top'
            : 'center',
        }),
      ]}
    >
      {Platform.OS !== 'web' && (
        <>
          <Image
            source={building.background}
            resizeMode="stretch"
            style={{
              position: 'absolute',
              top: 0,
              left: (width - bgWidth) / 2,
              width: bgWidth,
              height,
            }}
          />
          <View style={[fill, { pointerEvents: 'none' }, gradient(screenGradient)]} />
        </>
      )}
      {building.id === 'mail' && (
        <View
          style={[
            fill,
            { zIndex: 1, pointerEvents: 'none' },
            gradient('linear-gradient(180deg,transparent 38%,#4d25142b 82%,#381c1452)'),
          ]}
        />
      )}
      <View
        testID="status-bar"
        style={{
          position: 'absolute',
          zIndex: 12,
          left: 18,
          right: 18,
          top: 8,
          flexDirection: 'row',
          justifyContent: 'space-between',
        }}
      >
        <Text style={[statusText, { fontWeight: '900' }]}>9:41</Text>
        <Text style={statusText}>● ● ▰</Text>
      </View>
      <Pressable
        testID="scene-back"
        accessibilityLabel="섬으로 돌아가기"
        onPress={() => showToast('섬으로 돌아가는 전환이 이어집니다')}
        style={{
          position: 'absolute',
          zIndex: 12,
          left: 14,
          top: 36,
          width: 34,
          height: 34,
          alignItems: 'center',
          justifyContent: 'center',
          borderWidth: isHall ? 2 : 1.5,
          borderColor: isHall ? '#8B6956' : OUTLINE,
          borderRadius: isHall ? 999 : 17,
          backgroundColor: exact(isHall ? '#FFF7EB' : '#fff8eddb'),
          boxShadow: isHall ? '0 3px 0 #8B6956' : `0 2px 0 ${OUTLINE}`,
        }}
      >
        <Text
          style={{
            fontFamily: GOWUN,
            fontSize: 23,
            lineHeight: 23,
            color: INK,
            fontWeight: isHall ? '800' : '400',
          }}
        >
          ‹
        </Text>
      </Pressable>
      <View
        testID="place-sign"
        style={[
          {
            position: 'absolute',
            zIndex: 9,
            left: '50%',
            top: 43,
            minWidth: isHall ? 115 : 94,
            paddingTop: 5,
            paddingHorizontal: 14,
            paddingBottom: 6,
            transform: [{ translateX: '-50%' }, { rotate: '-1deg' }],
            borderWidth: 1.5,
            borderColor: '#65462f',
            borderTopLeftRadius: 6,
            borderTopRightRadius: 6,
            borderBottomLeftRadius: 9,
            borderBottomRightRadius: 9,
            boxShadow: '0 3px 0 #65462f',
            alignItems: 'center',
          },
          gradient('linear-gradient(90deg,#b87848,#d19b61,#b87848)'),
        ]}
      >
        <Text
          style={[
            {
              fontFamily: BODY_FONT,
              fontSize: isHall ? 16 : 12,
              lineHeight: lh((isHall ? 16 : 12) * 1.6),
              color: '#fff7e7',
              textAlign: 'center',
            },
            textShadow(0, 1, '#684a34'),
          ]}
        >
          {building.name}
        </Text>
      </View>
      {hotspot && (
        <Hotspot
          at={hotspot}
          label={`${kindCopy[concept.kind]} 살펴보기`}
          reduceMotion={reduceMotion}
          onPress={() => {
            showToast(peek ? '공간 전체를 봅니다' : '물건을 가까이 봅니다');
            setPeek(!peek);
          }}
        />
      )}
      {!hideArtifact &&
        (concept.kind === 'village-ledger' || concept.kind === 'island-management') && (
          <View
            style={[
              fill,
              { zIndex: 6, backgroundColor: exact('#4e3d2918') },
              webOnly({ backdropFilter: 'blur(2.5px)' }),
            ]}
          />
        )}
      {!hideArtifact && Artifact && (
        <Animated.View
          testID="artifact-wrap"
          onLayout={(e) => setWrapHeight(e.nativeEvent.layout.height)}
          style={[{ position: 'absolute', zIndex: 7, ...wrap }, peekStyle as any]}
        >
          <Artifact
            building={building}
            concept={concept}
            index={conceptIndex}
            width={width}
            height={height}
            reduceMotion={reduceMotion}
            showToast={showToast}
          />
        </Animated.View>
      )}
      {/* 원본은 동작 줄이기에서 토스트 애니메이션이 꺼져 보이지 않는다 */}
      {!reduceMotion && toast.serial > 0 && <Toast message={toast.message} serial={toast.serial} />}
      {modeLabel !== '' && (
        <View
          testID="tap-label"
          style={{
            position: 'absolute',
            zIndex: 8,
            right: 13,
            top: 82,
            paddingVertical: 3,
            paddingHorizontal: 8,
            borderWidth: 1,
            borderColor: '#725947',
            borderRadius: 99,
            backgroundColor: exact('#fffaf1d9'),
          }}
        >
          <Text
            style={{
              fontFamily: BODY_FONT,
              fontSize: 7,
              lineHeight: lh(11.2),
              fontWeight: '800',
              color: INK,
            }}
          >
            {modeLabel}
          </Text>
        </View>
      )}
      <View
        style={[
          fill,
          { zIndex: 0, pointerEvents: 'none' },
          gradient('linear-gradient(90deg,#39281b16,transparent 24%,transparent 76%,#39281b16)'),
        ]}
      />
    </View>
  );
}

const statusText = {
  fontFamily: GOWUN,
  fontSize: 9,
  lineHeight: 9,
  fontWeight: '800' as const,
  color: INK,
  ...textShadow(0, 1, '#fff8'),
};

// 웹 비교용 화면: /?interiors=1&b=건물&c=시안&w=폭&h=높이[&noartifact=1]
export function InteriorsReview() {
  const q = new URLSearchParams(window.location.search);
  const [fontsLoaded] = useInteriorFonts();
  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  useEffect(() => {
    document.documentElement.lang = 'ko';
    if (!fontsLoaded) return;
    requestAnimationFrame(() =>
      requestAnimationFrame(() => ((window as any).__interiorsReady = true)),
    );
  }, [fontsLoaded]);
  if (!fontsLoaded) return null;
  const w = Number(q.get('w') || 402),
    h = Number(q.get('h') || 874);
  return (
    <View
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width: w,
        height: h,
        backgroundColor: '#fff',
      }}
    >
      <InteriorScreen
        buildingIndex={Number(q.get('b') || 0)}
        conceptIndex={Number(q.get('c') || 0)}
        width={w}
        height={h}
        reduceMotion={reduceMotion}
        hideArtifact={q.has('noartifact')}
      />
    </View>
  );
}

// ───────────── 마을회관 ─────────────

// 마을회관 기능 화면: hall-desk · building-models · village-ledger · building-blueprint · island-management
// 수치는 원본 style.css에 .screen-hall(딸기 소다 키트) 규칙까지 겹친 계산값이다.

const HALL_OUTLINE = '#8B6956';
const BG = '#FFF7EB';
const SURFACE = '#FFFDFA';
const PRIMARY = '#FFA6BC';
const HALL_SKY = '#ADE1F8';
const MUTED = '#665348';
const PAPER_INK = '#3e352e'; // .island-management-view 글자색
const PLAN_INK = '#f7fcff'; // .building-blueprint-view 글자색

type Option = (typeof buildOptions)[number];
type Weight = '400' | '700' | '800' | '850' | '900';
type Tab = 'info' | 'residents' | 'requests';

// View는 글꼴을 물려주지 않으니 글자마다 크기·줄높이(px)·굵기·색·글꼴을 모두 준다.
// 줄높이는 CSS 값(글자 크기 × 배수)을 lh()로 넘긴다.
// 굵기 850: Gowun은 어느 굵기든 가짜 굵게로 같지만, Gowun에 없는 기호(× ↗ ‹)를 그리는 대체 글꼴은 굵기마다 모양이 달라 그대로 준다
const hallFont = (
  fontSize: number,
  lineHeight: number,
  fontWeight: Weight = '400',
  color = INK,
  fontFamily = BODY_FONT,
) => ({
  fontFamily,
  fontSize,
  lineHeight: lh(lineHeight),
  fontWeight: (fontWeight === '850' && Platform.OS !== 'web' ? '800' : fontWeight) as any,
  color,
});
const nowrap = () => webOnly({ whiteSpace: 'nowrap' });

// CSS transition: 목표값이 바뀌면 duration 동안 따라간다 (동작 줄이기면 즉시)
function useEased(target: number, duration: number, reduceMotion: boolean) {
  const v = useRef(new Animated.Value(target)).current;
  useEffect(() => {
    if (reduceMotion || duration === 0) v.setValue(target);
    else
      Animated.timing(v, {
        toValue: target,
        duration,
        easing: ease,
        useNativeDriver: false,
      }).start();
  }, [target, duration, reduceMotion, v]);
  return v;
}

// @keyframes 한 번 재생: key가 바뀔 때마다 0→1 (key 0은 재생하지 않음)
function useKeyframe(key: number, duration: number, reduceMotion: boolean) {
  const t = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (reduceMotion || key === 0) return;
    t.setValue(0);
    Animated.timing(t, {
      toValue: 1,
      duration,
      easing: Easing.linear,
      useNativeDriver: false,
    }).start();
  }, [key, duration, reduceMotion, t]);
  return t;
}

// @keyframes object-react .42s ease: 45%에서 scale(1.025) rotate(-.5deg)
function reactStyle(t: Animated.Value) {
  const at = (outputRange: any[]) =>
    t.interpolate({ inputRange: [0, 0.45, 1], outputRange, easing: ease });
  return { transform: [{ scale: at([1, 1.025, 1]) }, { rotate: at(['0deg', '-0.5deg', '0deg']) }] };
}

// 원본 <img object-fit:contain>. CSS 배경은 축소 결과가 달라서 웹은 같은 <img>를 상자에 꽉 채운다
function Art({ source, style }: { source: ImageSourcePropType; style: any }) {
  if (Platform.OS !== 'web') return <Image source={source} resizeMode="contain" style={style} />;
  return (
    <View style={style}>
      {React.createElement('img', {
        src: assetUri(source),
        alt: '',
        style: { display: 'block', width: '100%', height: '100%', objectFit: 'contain' },
      })}
    </View>
  );
}

// .screen-hall :is(.stamp-action, .management-invite, .request-row>button, .management-confirm button)
// :active는 3px 아래로 눌리며 그림자가 1px로 준다
function HallPill({
  testID,
  onPress,
  style,
  shadow = 4,
  children,
}: {
  testID?: string;
  onPress?: () => void;
  style?: any;
  shadow?: number;
  children: React.ReactNode;
}) {
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      style={({ pressed }) => [
        {
          minHeight: 44,
          paddingVertical: 9,
          paddingHorizontal: 15,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          columnGap: 8,
          borderWidth: 2,
          borderColor: HALL_OUTLINE,
          borderRadius: 999,
          backgroundColor: PRIMARY,
          boxShadow: `0 ${pressed ? 1 : shadow}px 0 ${HALL_OUTLINE}`,
        },
        style,
        pressed && { transform: [{ translateY: 3 }] },
      ]}
    >
      {typeof children === 'string' ? (
        <Text style={hallFont(13, 16.25, '850')}>{children}</Text>
      ) : (
        children
      )}
    </Pressable>
  );
}

// ───────── 목각 건물 목록 · 청사진 ─────────

function BuildingGrid({ scaled, onChoose }: { scaled: boolean; onChoose: (item: Option) => void }) {
  const rows = [buildOptions.slice(0, 2), buildOptions.slice(2, 4), buildOptions.slice(4)];
  return (
    <View style={[{ rowGap: 10 }, scaled && { transform: [{ scale: 0.985 }] }]}>
      {rows.map((row, r) => (
        <View key={r} style={{ flexDirection: 'row', columnGap: 10 }}>
          {row.map((item, i) => (
            <Pressable
              key={item.id}
              testID={`building-choice-${r * 2 + i}`}
              onPress={() => onChoose(item)}
              style={({ pressed }) => [
                {
                  flex: 1,
                  minHeight: 88,
                  paddingVertical: 7,
                  paddingHorizontal: 5,
                  flexDirection: 'row',
                  alignItems: 'center',
                  columnGap: 5,
                  borderWidth: 2,
                  borderColor: HALL_OUTLINE,
                  borderRadius: 13,
                  backgroundColor: SURFACE,
                  boxShadow: `0 ${pressed ? 1 : 3}px 0 ${HALL_OUTLINE}`,
                },
                pressed && { transform: [{ translateY: 3 }] },
              ]}
            >
              <Art
                source={item.image}
                style={[
                  { width: 44, height: 54 },
                  webOnly({ filter: 'drop-shadow(0 3px 2px #68483240)' }),
                ]}
              />
              <View style={{ flex: 1, rowGap: 2 }}>
                <Text style={hallFont(14, 18.2, '850')}>
                  {item.name}
                  {item.locked ? ' ' : ''}
                  {item.locked && (
                    <View
                      style={[
                        {
                          paddingVertical: 1,
                          paddingHorizontal: 3,
                          borderRadius: 99,
                          backgroundColor: '#decfbd',
                        },
                        webOnly({ verticalAlign: '1px' }),
                      ]}
                    >
                      <Text style={hallFont(10, 13, '850', '#806e61')}>잠김</Text>
                    </View>
                  )}
                </Text>
                <Text style={hallFont(12, 16.8, '400', MUTED)}>{item.summary}</Text>
              </View>
            </Pressable>
          ))}
        </View>
      ))}
    </View>
  );
}

function Blueprint({
  item,
  shown,
  isStatic,
  goal,
  reduceMotion,
  onBack,
  onGoal,
}: {
  item: Option;
  shown: boolean;
  isStatic: boolean;
  goal: string;
  reduceMotion: boolean;
  onBack: () => void;
  onGoal: () => void;
}) {
  // transition: transform .38s ease, opacity .2s
  const move = useEased(shown ? 1 : 0, 380, reduceMotion);
  const opacity = useEased(shown ? 1 : 0, 200, reduceMotion);
  const dashed = {
    borderTopWidth: 1,
    borderStyle: 'dashed' as const,
    borderColor: exact('#dff7ffaa'),
  };
  return (
    <Animated.View
      style={[
        {
          position: 'absolute',
          zIndex: 12,
          left: 8,
          right: 8,
          top: '50%',
          height: 276,
          padding: 12,
          borderWidth: 2,
          borderColor: '#d9f3f7',
          borderRadius: 12,
          backgroundColor: exact('#4f94b1f7'),
          boxShadow: 'inset 0 0 0 4px #4a899f,0 12px 26px #273c46a8',
          opacity,
          pointerEvents: shown ? 'auto' : 'none',
          transform: [
            { translateY: move.interpolate({ inputRange: [0, 1], outputRange: ['-35%', '-50%'] }) },
            { scale: move.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1] }) },
          ],
        },
        webOnly({
          backgroundImage:
            'linear-gradient(#dff7ff24 1px,transparent 1px),linear-gradient(90deg,#dff7ff24 1px,transparent 1px),linear-gradient(#dff7ff12 1px,transparent 1px),linear-gradient(90deg,#dff7ff12 1px,transparent 1px)',
          backgroundSize: '32px 32px,32px 32px,8px 8px,8px 8px',
        }),
      ]}
    >
      {!isStatic && (
        <Pressable
          testID="blueprint-back"
          accessibilityLabel="건물 목록으로 돌아가기"
          onPress={onBack}
          style={{
            position: 'absolute',
            zIndex: 3,
            left: 10,
            top: 10,
            width: 26,
            height: 26,
            alignItems: 'center',
            justifyContent: 'center',
            borderWidth: 2,
            borderColor: HALL_OUTLINE,
            borderRadius: 999,
            backgroundColor: BG,
            boxShadow: `0 3px 0 ${HALL_OUTLINE}`,
          }}
        >
          <Text style={hallFont(19, 19, '850', INK, GOWUN)}>‹</Text>
        </Pressable>
      )}
      <Text
        style={[
          hallFont(12, 19.2, '400', '#e8faff'),
          { letterSpacing: 0.48, marginBottom: 10, paddingLeft: isStatic ? 0 : 32 },
        ]}
      >
        BUILDING PLAN · 01
      </Text>
      <View style={{ flex: 1, flexDirection: 'row', columnGap: 10 }}>
        <View
          style={{
            width: '36%',
            paddingTop: 5,
            paddingHorizontal: 5,
            paddingBottom: 4,
            borderWidth: 1,
            borderColor: exact('#dff7ffaa'),
            backgroundColor: exact('#eaf8fb19'),
            overflow: 'hidden',
          }}
        >
          <View
            style={{
              position: 'absolute',
              left: '50%',
              top: 6,
              bottom: 6,
              width: 1,
              backgroundColor: exact('#dff7ff55'),
            }}
          />
          <View
            style={{
              position: 'absolute',
              top: '50%',
              left: 6,
              right: 6,
              height: 1,
              backgroundColor: exact('#dff7ff55'),
            }}
          />
          <Text
            style={[
              hallFont(11, 17.6, '400', exact('#dff7ffaa')),
              { position: 'absolute', zIndex: 1, right: 5, top: 3 },
            ]}
          >
            ＋
          </Text>
          <View style={{ flex: 1, zIndex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <Art
              source={item.image}
              style={[
                { width: 94, maxWidth: '100%', height: 104 },
                webOnly({ filter: 'drop-shadow(0 4px 2px #244c5c80)' }),
              ]}
            />
          </View>
          <View
            style={{
              alignSelf: 'center',
              zIndex: 1,
              paddingVertical: 1,
              paddingHorizontal: 5,
              borderWidth: 1,
              borderColor: exact('#dff7ffaa'),
              borderRadius: 99,
              backgroundColor: '#4f94b1',
            }}
          >
            <Text style={hallFont(11, 17.6, '400', '#fff')}>예상 모습</Text>
          </View>
        </View>
        <View style={{ flex: 1, alignSelf: 'center' }}>
          <Text style={[hallFont(22, 24.2, '400', PLAN_INK, GOWUN), { marginBottom: 7 }]}>
            {item.name}
          </Text>
          {[
            ['가격', item.price],
            ['시간', item.time],
          ].map(([key, value]) => (
            <View
              key={key}
              style={[
                {
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  columnGap: 5,
                  paddingVertical: 3,
                },
                dashed,
              ]}
            >
              <Text style={hallFont(12, 16.2, '400', PLAN_INK)}>{key}</Text>
              <Text style={hallFont(12, 16.2, '700', PLAN_INK)}>{value}</Text>
            </View>
          ))}
          <Text
            style={[hallFont(12, 17.4, '400', PLAN_INK), { marginTop: 6, paddingTop: 6 }, dashed]}
          >
            {item.detail}
          </Text>
        </View>
      </View>
      <HallPill testID="blueprint-goal" onPress={onGoal} style={{ marginTop: 8 }}>
        {goal || '이 건물을 목표로 정하기'}
      </HallPill>
    </Animated.View>
  );
}

// 청사진 버튼 동작을 hall-desk · building-flow가 함께 쓴다
function useBlueprint(showToast: (message: string) => void) {
  const [item, setItem] = useState<Option>(buildOptions[0]);
  const [open, setOpen] = useState(false);
  const [goal, setGoal] = useState('');
  return {
    item,
    open,
    goal,
    choose: (next: Option) => {
      setItem(next);
      setOpen(true);
      showToast(`${next.name} 청사진을 펼쳤어요`);
    },
    back: () => {
      setOpen(false);
      showToast('건물 목록으로 돌아왔어요');
    },
    setGoal: () => {
      setGoal(`${item.name} 선택 완료 ✓`);
      showToast(`${item.name}을 다음 건설 목표로 정했어요`);
    },
    close: () => setOpen(false),
  };
}

function BuildingFlow({ concept, reduceMotion, showToast }: ArtifactProps) {
  const standalone = concept.kind === 'building-blueprint';
  const plan = useBlueprint(showToast);
  const shown = standalone || plan.open;
  return (
    <View style={fill}>
      <View
        style={{
          position: 'absolute',
          left: 14,
          right: 14,
          bottom: 22,
          minHeight: 352,
          paddingTop: 16,
          paddingHorizontal: 13,
          paddingBottom: 17,
          borderWidth: 2,
          borderColor: '#8b6248',
          borderTopLeftRadius: 18,
          borderTopRightRadius: 18,
          borderBottomLeftRadius: 10,
          borderBottomRightRadius: 10,
          backgroundColor: '#fff3d8',
          boxShadow: 'inset 0 0 0 4px #eed4aa,0 8px 18px #4b2d1e66',
          overflow: 'hidden',
        }}
      >
        <View style={{ rowGap: 1, marginBottom: 9 }}>
          <View
            style={{
              alignSelf: 'flex-start',
              marginBottom: 3,
              paddingVertical: 2,
              paddingHorizontal: 8,
              borderWidth: 1,
              borderColor: '#7f624f',
              borderRadius: 99,
              backgroundColor: '#fff8e9',
            }}
          >
            <Text style={hallFont(12, 16.8, '800', MUTED)}>목각 건물 고르기</Text>
          </View>
          <Text style={hallFont(20, 25, '400', INK, GOWUN)}>어떤 건물을 지을까요?</Text>
          <Text style={hallFont(12, 16.8, '400', MUTED)}>
            {standalone ? '도서관을 눌러 청사진을 펼친 상태예요' : '건물을 누르면 청사진을 펼쳐요'}
          </Text>
        </View>
        <BuildingGrid scaled={shown} onChoose={plan.choose} />
      </View>
      <Blueprint
        item={plan.item}
        shown={shown}
        isStatic={standalone}
        goal={plan.goal}
        reduceMotion={reduceMotion}
        onBack={plan.back}
        onGoal={plan.setGoal}
      />
    </View>
  );
}

// ───────── 섬 관리 (섬 등록부) ─────────

type Cat = keyof (typeof interiorArt)['avatars'];
const residents: [string, Cat][] = [
  ['나', 'black'],
  ['민지', 'calico'],
  ['두부', 'white'],
  ['수아', 'cream'],
  ['밤이', 'gray'],
  ['보리', 'ginger'],
  ['구름', 'white'],
  ['소금', 'calico'],
];
const avatarBg = ['#dfe9cc', '#f3d4d4', '#d4e7e9'];

// .resident-avatar: 둥근 틀 안에서 그림을 아래 기준으로 1.2배 키운다
function Avatar({ color, bg }: { color: Cat; bg: string }) {
  return (
    <View
      style={{
        width: 32,
        height: 32,
        borderWidth: 1,
        borderColor: '#c4af88',
        borderRadius: 16,
        backgroundColor: bg,
        overflow: 'hidden',
      }}
    >
      <Art
        source={interiorArt.avatars[color]}
        style={{ width: 30, height: 30, transform: [{ scale: 1.2 }], transformOrigin: '50% 100%' }}
      />
    </View>
  );
}

// 주민 정원: 웹은 원본과 같은 <select>, 네이티브는 누를 때마다 다음 값으로 바꾼다
function QuotaSelect() {
  const options = ['8명', '10명', '15명'];
  const [value, setValue] = useState('15명');
  if (Platform.OS === 'web')
    return React.createElement(
      'select',
      {
        'aria-label': '주민 정원',
        'data-testid': 'quota-select',
        value,
        onChange: (e: any) => setValue(e.target.value),
        style: {
          boxSizing: 'border-box',
          margin: 0,
          padding: '4px 6px',
          border: '1px solid #a88b69',
          borderRadius: 5,
          background: '#fffaf0',
          font: '12px Gowun',
          color: '#493b39',
        },
      },
      options.map((option) =>
        React.createElement('option', { key: option, value: option }, option),
      ),
    );
  return (
    <Pressable
      testID="quota-select"
      onPress={() => setValue(options[(options.indexOf(value) + 1) % options.length])}
      style={{
        paddingVertical: 4,
        paddingHorizontal: 6,
        borderWidth: 1,
        borderColor: '#a88b69',
        borderRadius: 5,
        backgroundColor: '#fffaf0',
      }}
    >
      <Text style={{ fontFamily: GOWUN, fontSize: 12, color: INK }}>{value} ▾</Text>
    </Pressable>
  );
}

// .management-info input · textarea: 원본처럼 값은 입력칸에만 두고, 저장에 쓰는 이름만 받아 둔다
function HallField({
  testID,
  defaultValue,
  onChangeText,
  maxLength,
  multiline = false,
}: {
  testID: string;
  defaultValue: string;
  onChangeText?: (text: string) => void;
  maxLength: number;
  multiline?: boolean;
}) {
  return (
    <TextInput
      testID={testID}
      defaultValue={defaultValue}
      onChangeText={onChangeText}
      maxLength={maxLength}
      multiline={multiline}
      style={[
        {
          paddingVertical: 7,
          paddingHorizontal: 8,
          borderWidth: 1,
          borderColor: '#b9a081',
          borderRadius: 5,
          backgroundColor: '#fffaf0',
          ...hallFont(13, 18.2, '400', PAPER_INK, GOWUN),
        },
        multiline && { height: 52 },
      ]}
    />
  );
}

function IslandManagement({
  width,
  isStatic,
  initialTab,
  shown,
  reduceMotion,
  showToast,
  onClose,
}: {
  width: number;
  isStatic: boolean;
  initialTab: Tab;
  shown: boolean;
  reduceMotion: boolean;
  showToast: (message: string) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [heading, setHeading] = useState('소다 섬');
  const [name, setName] = useState('소다 섬');
  const [approval, setApproval] = useState(true);
  const [requests, setRequests] = useState<[string, Cat][]>([
    ['모카', 'cream'],
    ['치즈', 'ginger'],
  ]);
  const [confirm, setConfirm] = useState<[string, string] | null>(null);
  // transition: transform .3s, opacity .2s
  const move = useEased(shown ? 1 : 0, 300, reduceMotion);
  const opacity = useEased(shown ? 1 : 0, 200, reduceMotion);

  const tabBase = {
    minHeight: 32,
    paddingVertical: 5,
    paddingHorizontal: 7,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    borderWidth: 2,
    borderColor: HALL_OUTLINE,
    borderRadius: 99,
  };
  const label = hallFont(13, 20.8, '800', PAPER_INK);
  const setting = {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    columnGap: 8,
    paddingVertical: 7,
    borderBottomWidth: 1,
    borderStyle: 'dashed' as const,
    borderColor: '#cdb58e',
  };
  const sectionTitle = {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    columnGap: 5,
    marginTop: 3,
    marginBottom: 12,
  };
  const note = [hallFont(12, 18, '400', MUTED), { marginTop: 10 }];
  const count = String(requests.length);
  // grid 1fr 1fr 1.2fr: flex-grow는 안쪽 여백을 뺀 나머지만 나눠 너비가 달라지므로 칸 너비를 직접 구한다 (좌우 14 · 테두리 2 · 안쪽 13 · 간격 5×2)
  const fr = (width - 58 - 10) / 3.2;

  const leave = () =>
    setConfirm(['소다 섬에서 나갈까요?', '방장은 다른 주민에게 먼저 방장을 위임해야 해요.']);

  return (
    <Animated.View
      style={[
        {
          position: 'absolute',
          zIndex: 13,
          left: 14,
          right: 14,
          top: '50%',
          height: 580,
          paddingTop: 15,
          paddingHorizontal: 13,
          paddingBottom: 10,
          borderWidth: 2,
          borderColor: '#806449',
          borderRadius: 14,
          backgroundColor: '#fff3d8',
          boxShadow: 'inset 0 0 0 4px #ead6b1,0 12px 26px #3b2c2380',
          opacity,
          pointerEvents: shown ? 'auto' : 'none',
          transform: [
            { translateY: move.interpolate({ inputRange: [0, 1], outputRange: ['-45%', '-50%'] }) },
            { scale: move.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] }) },
          ],
        },
        gradient('linear-gradient(90deg,#ead6b126,transparent 12%)'),
      ]}
    >
      <View style={{ marginBottom: 9 }}>
        <Text testID="management-heading" style={hallFont(12, 19.2, '400', MUTED)}>
          {heading} · 섬 등록부
        </Text>
        <Text style={[hallFont(24, 28.8, '400', PAPER_INK, GOWUN), { marginTop: 3 }]}>
          {'섬 관리 '}
          <View
            style={[
              {
                paddingVertical: 2,
                paddingHorizontal: 7,
                borderWidth: 1,
                borderColor: '#75946e',
                borderRadius: 99,
                backgroundColor: '#deebcf',
              },
              webOnly({ verticalAlign: '3px' }),
            ]}
          >
            <Text style={hallFont(11, 13.2, '400', '#44643d', GOWUN)}>방장</Text>
          </View>
        </Text>
        <Pressable
          testID="management-close"
          accessibilityLabel="섬 관리 닫기"
          onPress={() => (isStatic ? showToast('섬 관리 화면 시안이에요') : onClose())}
          // 줄높이 27.2가 안쪽 23보다 커서 <button>은 가운데가 아니라 위에 붙인다
          style={{
            position: 'absolute',
            right: 0,
            top: 2,
            width: 27,
            height: 27,
            alignItems: 'center',
            borderWidth: 2,
            borderColor: HALL_OUTLINE,
            borderRadius: 999,
            backgroundColor: BG,
            boxShadow: `0 3px 0 ${HALL_OUTLINE}`,
          }}
        >
          <Text style={hallFont(17, 27.2, '850')}>×</Text>
        </Pressable>
      </View>

      <View style={{ flexDirection: 'row', columnGap: 5, marginBottom: 13 }}>
        {(
          [
            ['info', '섬 정보', ''],
            ['residents', '주민', '8'],
            ['requests', '가입 신청', count],
          ] as const
        ).map(([key, text, badge], i) => (
          <Pressable
            key={key}
            testID={`management-tab-${i}`}
            onPress={() => setTab(key)}
            style={[
              tabBase,
              { width: (i === 2 ? 1.2 : 1) * fr, backgroundColor: tab === key ? PRIMARY : SURFACE },
              tab === key && { boxShadow: `0 2px 0 ${HALL_OUTLINE}` },
            ]}
          >
            <Text style={[hallFont(12, 14.4, '800'), { textAlign: 'center' }]}>
              {text}
              {badge !== '' && ' '}
              {badge !== '' && <Text style={{ marginLeft: 2, fontWeight: '900' }}>{badge}</Text>}
            </Text>
          </Pressable>
        ))}
      </View>

      <View style={{ flex: 1 }}>
        {tab === 'info' && (
          <View>
            <View style={{ rowGap: 4, marginBottom: 9 }}>
              <Text style={label}>섬 이름</Text>
              <HallField
                testID="island-name-input"
                defaultValue="소다 섬"
                onChangeText={setName}
                maxLength={20}
              />
            </View>
            <View style={{ rowGap: 4, marginBottom: 9 }}>
              <Text style={label}>섬 소개</Text>
              <HallField
                testID="island-intro-input"
                defaultValue="함께 집중하고, 느긋하게 쉬어가는 섬."
                maxLength={100}
                multiline
              />
            </View>
            <View style={setting}>
              <View style={{ rowGap: 1 }}>
                <Text style={hallFont(13, 20.8, '700', PAPER_INK)}>가입 승인</Text>
                <Text style={hallFont(12, 16.8, '400', MUTED)}>
                  {approval ? '방장 승인 후 가입해요' : '승인 없이 바로 가입해요'}
                </Text>
              </View>
              <Pressable
                testID="approval-toggle"
                accessibilityLabel="가입 승인 필요"
                onPress={() => setApproval(!approval)}
                style={{
                  width: 32,
                  height: 19,
                  borderWidth: 2,
                  borderColor: HALL_OUTLINE,
                  borderRadius: 99,
                  backgroundColor: approval ? PRIMARY : BG,
                }}
              >
                <Knob on={approval} reduceMotion={reduceMotion} />
              </Pressable>
            </View>
            <View style={setting}>
              <View style={{ rowGap: 1 }}>
                <Text style={hallFont(13, 20.8, '700', PAPER_INK)}>주민 정원</Text>
                <Text style={hallFont(12, 16.8, '400', MUTED)}>현재 주민 8명 · 최대 15명</Text>
              </View>
              <QuotaSelect />
            </View>
            <HallPill
              testID="management-invite"
              onPress={() => showToast('섬 초대 링크를 공유하는 화면으로 이어져요')}
              style={{ marginTop: 8, justifyContent: 'space-between', backgroundColor: HALL_SKY }}
            >
              <Text style={hallFont(13, 16.25, '850')}>섬 초대 링크 공유</Text>
              <Text style={hallFont(13, 16.25, '850')}>↗</Text>
            </HallPill>
            <HallPill
              testID="management-save"
              onPress={() => {
                const trimmed = name.trim();
                if (!trimmed) return showToast('섬 이름을 적어주세요');
                setHeading(trimmed);
                showToast('섬 정보를 저장했어요');
              }}
              style={{ marginTop: 8 }}
            >
              변경사항 저장
            </HallPill>
          </View>
        )}

        {tab === 'residents' && (
          <View>
            <View style={sectionTitle}>
              <Text style={hallFont(14, 22.4, '700', PAPER_INK)}>함께 사는 주민</Text>
              <Text style={hallFont(12, 19.2, '400', MUTED)}>8 / 15명</Text>
            </View>
            <View style={{ rowGap: 6 }}>
              {[0, 2, 4, 6].map((start) => (
                <View key={start} style={{ flexDirection: 'row', columnGap: 6 }}>
                  {residents.slice(start, start + 2).map(([resident, color], offset) => {
                    const i = start + offset;
                    return (
                      <Pressable
                        key={resident + i}
                        testID={`resident-${i}`}
                        onPress={() =>
                          i === 0
                            ? showToast('현재 소다 섬의 방장이에요')
                            : setConfirm([
                                `${resident}에게 방장 위임`,
                                '방장 권한을 넘기고 나는 주민으로 남아요.',
                              ])
                        }
                        style={{
                          flex: 1,
                          minHeight: 60,
                          padding: 6,
                          flexDirection: 'row',
                          alignItems: 'center',
                          columnGap: 7,
                          borderWidth: 2,
                          borderColor: HALL_OUTLINE,
                          borderRadius: 13,
                          backgroundColor: SURFACE,
                        }}
                      >
                        <Avatar color={color} bg={avatarBg[i % 3]} />
                        <View style={{ rowGap: 2 }}>
                          <Text style={hallFont(14, 22.4, '700', PAPER_INK)}>{resident}</Text>
                          <Text style={hallFont(12, 15.6, '400', MUTED)}>
                            {i === 0 ? '방장' : '주민'}
                          </Text>
                        </View>
                        <Text style={[hallFont(15, 24, '400', '#8c765e'), { marginLeft: 'auto' }]}>
                          {i === 0 ? '♛' : '›'}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              ))}
            </View>
            <Text style={note}>주민을 눌러 방장 위임·주민 관리를 할 수 있어요.</Text>
          </View>
        )}

        {tab === 'requests' && (
          <View>
            <View style={sectionTitle}>
              <Text style={hallFont(14, 22.4, '700', PAPER_INK)}>새 이웃이 기다리고 있어요</Text>
              <Text style={hallFont(12, 19.2, '400', MUTED)}>
                <Text style={{ fontWeight: '700' }}>{count}</Text>명
              </Text>
            </View>
            {requests.map(([neighbor, color], i) => {
              const settle = (approve: boolean) => {
                setRequests(requests.filter((_, j) => j !== i));
                showToast(approve ? '새 이웃의 가입을 승인했어요' : '가입 신청을 거절했어요');
              };
              return (
                <View
                  key={neighbor}
                  style={{
                    minHeight: 72,
                    marginBottom: 8,
                    paddingVertical: 12,
                    paddingHorizontal: 8,
                    flexDirection: 'row',
                    alignItems: 'center',
                    columnGap: 7,
                    borderWidth: 1,
                    borderColor: '#c5ad8a',
                    borderRadius: 7,
                    backgroundColor: '#fffaf0',
                  }}
                >
                  <Avatar color={color} bg={avatarBg[0]} />
                  <View style={{ flex: 1, rowGap: 3 }}>
                    <Text style={hallFont(14, 22.4, '700', PAPER_INK)}>{neighbor}</Text>
                    <Text style={hallFont(12, 15.6, '400', MUTED)}>같이 집중하고 싶어요!</Text>
                  </View>
                  <HallPill
                    testID={`request-approve-${i}`}
                    shadow={3}
                    onPress={() => settle(true)}
                    style={{ minHeight: 32, paddingVertical: 5, paddingHorizontal: 8 }}
                  >
                    <Text style={hallFont(12, 15, '850')}>승인</Text>
                  </HallPill>
                  <HallPill
                    testID={`request-reject-${i}`}
                    shadow={3}
                    onPress={() => settle(false)}
                    style={{
                      width: 32,
                      minHeight: 32,
                      paddingVertical: 0,
                      paddingHorizontal: 0,
                      backgroundColor: BG,
                    }}
                  >
                    <Text style={hallFont(17, 21.25, '850')}>×</Text>
                  </HallPill>
                </View>
              );
            })}
            {/* 블록 여백 겹침: 행 margin-bottom 8 · 제목 margin-bottom 12 와 note margin-top 10 중 큰 값만 남는다 */}
            <Text style={[note, { marginTop: requests.length ? 2 : 0 }]}>
              승인한 이웃은 소다 섬에 들어올 수 있어요.
            </Text>
          </View>
        )}
      </View>

      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'space-between',
          columnGap: 10,
          paddingTop: 10,
          borderTopWidth: 1,
          borderColor: '#ccb48f',
        }}
      >
        <Pressable
          testID="management-delegate"
          onPress={() => {
            setTab('residents');
            showToast('방장을 맡길 주민을 골라주세요');
          }}
          style={[tabBase, { backgroundColor: BG }]}
        >
          <Text style={hallFont(12, 14.4, '800')}>방장 위임</Text>
        </Pressable>
        <Pressable
          testID="management-leave"
          onPress={leave}
          style={[tabBase, { backgroundColor: SURFACE }]}
        >
          <Text style={hallFont(12, 14.4, '800')}>섬 탈퇴</Text>
        </Pressable>
      </View>

      {confirm && (
        <View
          style={{
            position: 'absolute',
            zIndex: 5,
            left: 16,
            right: 16,
            top: '50%',
            transform: [{ translateY: '-50%' }],
            paddingVertical: 16,
            paddingHorizontal: 13,
            borderWidth: 2,
            borderColor: '#806449',
            borderRadius: 9,
            backgroundColor: '#fffaf0',
            boxShadow: '0 0 0 150px #44362966,0 8px 16px #3b2c2355',
          }}
        >
          <Text style={hallFont(15, 24, '400', PAPER_INK)}>
            <Text style={hallFont(17, 27.2, '700', PAPER_INK)}>{confirm[0]}</Text>
          </Text>
          <Text style={[hallFont(13, 20.8, '400', PAPER_INK), { marginVertical: 13 }]}>
            {confirm[1]}
          </Text>
          <View style={{ flexDirection: 'row', columnGap: 8 }}>
            <HallPill
              testID="confirm-cancel"
              onPress={() => setConfirm(null)}
              style={{ flex: 1, minHeight: 37, backgroundColor: BG }}
            >
              취소
            </HallPill>
            <HallPill
              testID="confirm-ok"
              onPress={() => {
                setConfirm(null);
                showToast('확인 후 처리 화면으로 이어져요');
              }}
              style={{ flex: 1, minHeight: 37 }}
            >
              확인
            </HallPill>
          </View>
        </View>
      )}
    </Animated.View>
  );
}

// .approval-toggle i: transition left .2s
function Knob({ on, reduceMotion }: { on: boolean; reduceMotion: boolean }) {
  const left = useEased(on ? 15 : 2, 200, reduceMotion);
  return (
    <Animated.View
      style={{
        position: 'absolute',
        left,
        top: 1,
        width: 13,
        height: 13,
        borderRadius: '50%',
        backgroundColor: '#fffaf0',
        boxShadow: '0 1px 2px #4b382940',
      }}
    />
  );
}

// ───────── 마을회관 책상 ─────────

const deskSpots = [
  {
    box: { left: '28%', top: '43%', width: '44%', height: '18%' },
    label: { left: '14%', bottom: '9%' },
  },
  {
    box: { left: '20%', top: '31%', width: '60%', height: '15%' },
    label: { left: '50%', bottom: -5 },
  },
  {
    box: { right: '7%', top: '55%', width: '27%', height: '15%' },
    label: { left: '50%', bottom: -3 },
  },
] as const;
const deskPanels = ['island', 'buildings', 'ledger'] as const;

// .hall-desk .object-choice i: @keyframes hall-hotspot 1.8s ease-in-out infinite (0%·100% 6px 링, 50% 11px 링 · 1.06배)
// 웹은 원본과 같은 CSS 애니메이션을 건다 (그림자 문자열은 Animated 보간으로 적용되지 않는다). 네이티브는 크기만 뛴다
const ring = (spread: number, alpha: string, scale: number) => ({
  transform: `translate(-50%,-50%) scale(${scale})`,
  boxShadow: `0 0 0 2px #fff9,0 0 0 ${spread}px #f4a7bb${alpha}`,
});
const deskPulse =
  Platform.OS === 'web'
    ? StyleSheet.create({
        pulse: {
          animationKeyframes: [
            { '0%': ring(6, '55', 1), '50%': ring(11, '1c', 1.06), '100%': ring(6, '55', 1) },
          ],
          animationDuration: '1.8s',
          animationTimingFunction: 'ease-in-out',
          animationIterationCount: 'infinite',
        } as any,
      }).pulse
    : null;

function DeskHotspot({ reduceMotion }: { reduceMotion: boolean }) {
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduceMotion || Platform.OS === 'web') return;
    const loop = Animated.loop(
      Animated.timing(t, {
        toValue: 1,
        duration: 1800,
        easing: Easing.linear,
        useNativeDriver: false,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [reduceMotion, t]);
  const scale = t.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [1, 1.06, 1],
    easing: easeInOut,
  });
  const moving = !reduceMotion && Platform.OS !== 'web';
  return (
    <Animated.View
      style={[
        {
          position: 'absolute',
          left: '50%',
          top: '50%',
          width: 36,
          height: 36,
          borderRadius: 18,
          backgroundColor: exact('#ffffff73'),
          boxShadow: '0 0 0 2px #ffffff70,0 0 0 6px #f4a7bb55',
          transform: [
            { translateX: '-50%' },
            { translateY: '-50%' },
            { scale: moving ? scale : 1 },
          ],
        },
        !reduceMotion && deskPulse,
      ]}
    >
      <View
        style={{
          position: 'absolute',
          left: 10,
          right: 10,
          top: 10,
          bottom: 10,
          borderRadius: 8,
          backgroundColor: '#f4a7bb',
        }}
      />
    </Animated.View>
  );
}

function HallDesk({ concept, width, reduceMotion, showToast }: ArtifactProps) {
  const [pressed, setPressed] = useState(0);
  const [open, setOpen] = useState(false);
  const [reacting, setReacting] = useState(0);
  const plan = useBlueprint(showToast);
  const panel = deskPanels[pressed];
  const react = useKeyframe(reacting, 420, reduceMotion);
  // .hall-detail: transition transform .35s, opacity .2s · 열릴 때는 paper-open .45s가 transform을 덮는다
  const detailOpacity = useEased(open ? 1 : 0, 200, reduceMotion);
  const detailSlide = useEased(open ? 0 : 1, open ? 0 : 350, reduceMotion);
  const hop = useKeyframe(open ? reacting : 0, 450, reduceMotion);
  const hopAt = (outputRange: any[]) =>
    hop.interpolate({ inputRange: [0, 0.5, 1], outputRange, easing: ease });

  const choose = (i: number) => {
    setPressed(i);
    setOpen(true);
    plan.close();
    setReacting((n) => n + 1);
    showToast(`${concept.items[i][0]} 선택`);
  };

  return (
    <Animated.View style={[fill, !reduceMotion && reactStyle(react)]}>
      <View style={fill}>
        {deskSpots.map((spot, i) => (
          <Pressable
            key={i}
            testID={`hall-choice-${i}`}
            onPress={() => choose(i)}
            style={[
              { position: 'absolute', ...spot.box },
              i === 2
                ? {
                    transform:
                      pressed === 2
                        ? [{ translateY: -3 }, { rotate: '2deg' }]
                        : [{ rotate: '4deg' }],
                  }
                : pressed === i && { transform: [{ translateY: -3 }] },
            ]}
          >
            <View
              style={[
                {
                  position: 'absolute',
                  ...spot.label,
                  paddingVertical: 5,
                  paddingHorizontal: 9,
                  borderWidth: 1,
                  borderColor: '#71513d',
                  borderRadius: 99,
                  backgroundColor: pressed === i ? '#fff0ad' : exact('#fff7e9e8'),
                  boxShadow: '0 2px 5px #4c2c1d38',
                  transform: [{ translateX: '-50%' }],
                },
              ]}
            >
              <Text style={[hallFont(12, 15, '800'), { textAlign: 'center' }, nowrap()]}>
                {concept.items[i][0]}
              </Text>
            </View>
            <DeskHotspot reduceMotion={reduceMotion} />
          </Pressable>
        ))}
      </View>

      {panel !== 'island' && (
        <Animated.View
          style={{
            position: 'absolute',
            left: 12,
            right: 12,
            bottom: 22,
            paddingTop: panel === 'buildings' ? 11 : 10,
            paddingBottom: panel === 'buildings' ? 12 : 10,
            paddingHorizontal: 12,
            borderWidth: 1.5,
            borderColor: '#75533d',
            borderRadius: 10,
            backgroundColor: exact('#fff2d5f5'),
            boxShadow: '0 5px 12px #4b2c1e55',
            opacity: detailOpacity,
            pointerEvents: open ? 'auto' : 'none',
            transform: [
              {
                translateY: detailSlide.interpolate({
                  inputRange: [0, 1],
                  outputRange: ['0%', '125%'],
                }),
              },
              ...(reduceMotion
                ? []
                : [
                    { translateY: hopAt([0, -8, 0]) },
                    { rotate: hopAt(['0deg', '-1deg', '0deg']) },
                  ]),
            ],
          }}
        >
          {panel === 'buildings' ? (
            <View>
              <View style={{ rowGap: 1, marginBottom: 9 }}>
                <Text style={hallFont(20, 25, '400', INK, GOWUN)}>다음에 지을 건물</Text>
                <Text style={hallFont(12, 16.8, '400', MUTED)}>건물을 누르면 청사진을 펼쳐요</Text>
              </View>
              <BuildingGrid scaled={plan.open} onChoose={plan.choose} />
            </View>
          ) : (
            <View>
              <Text style={hallFont(15, 24)}>
                <View
                  style={{
                    marginBottom: 4,
                    paddingVertical: 2,
                    paddingHorizontal: 8,
                    borderWidth: 1,
                    borderColor: '#7f624f',
                    borderRadius: 99,
                    backgroundColor: '#fff8e9',
                  }}
                >
                  <Text style={[hallFont(7, 11.2, '800'), { letterSpacing: 0.7 }]}>
                    마을회관 책상
                  </Text>
                </View>
              </Text>
              {/* margin-bottom 5는 닫기 버튼의 margin-top 9와 겹쳐(collapse) 사라진다 */}
              <View style={{ rowGap: 1 }}>
                <Text style={hallFont(13, 16.25, '400', INK, GOWUN)}>
                  {concept.items[pressed][1]}
                </Text>
                <Text style={hallFont(8, 11.2, '400', '#79685d')}>{concept.items[pressed][2]}</Text>
              </View>
            </View>
          )}
          <HallPill
            testID="hall-close"
            onPress={() => {
              setOpen(false);
              showToast('문서를 책상 위에 다시 놓았어요');
            }}
            style={
              panel === 'buildings'
                ? { marginTop: 7, backgroundColor: '#f6e1bd' }
                : { marginTop: 9 }
            }
          >
            닫기
          </HallPill>
        </Animated.View>
      )}

      <Blueprint
        item={plan.item}
        shown={plan.open}
        isStatic={false}
        goal={plan.goal}
        reduceMotion={reduceMotion}
        onBack={plan.back}
        onGoal={plan.setGoal}
      />
      <IslandManagement
        width={width}
        isStatic={false}
        initialTab="info"
        shown={open && panel === 'island'}
        reduceMotion={reduceMotion}
        showToast={showToast}
        onClose={() => setOpen(false)}
      />
    </Animated.View>
  );
}

// ───────── 공동 가계부 ─────────

function LedgerRow({ label, sub, value }: { label: string; sub: string; value: string }) {
  return (
    <View
      style={{
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        columnGap: 8,
        paddingVertical: 7,
        paddingHorizontal: 1,
        borderBottomWidth: 1,
        borderStyle: 'dashed',
        borderColor: '#c9ad87',
      }}
    >
      <View>
        <Text style={hallFont(13, 20.8, '700')}>{label}</Text>
        <Text style={hallFont(12, 19.2, '400', MUTED)}>{sub}</Text>
      </View>
      <Text
        style={[hallFont(16, 16, '400', INK, GOWUN), { fontVariant: ['tabular-nums'] }, nowrap()]}
      >
        {value}
      </Text>
    </View>
  );
}

function LedgerHead({ kicker, title, total }: { kicker: string; title: string; total: string }) {
  return (
    <>
      <Text style={[hallFont(12, 19.2, '400', MUTED), { letterSpacing: 0.36 }]}>{kicker}</Text>
      <Text style={[hallFont(22, 27.5, '400', INK, GOWUN), { marginTop: 1 }]}>{title}</Text>
      <Text style={[hallFont(28, 35, '400', INK, GOWUN), { marginTop: 2 }, nowrap()]}>{total}</Text>
    </>
  );
}

function Ledger({ concept, reduceMotion, showToast }: ArtifactProps) {
  const [tab, setTab] = useState(0);
  const [reacting, setReacting] = useState(0);
  const react = useKeyframe(reacting, 420, reduceMotion);
  const tabs = [
    ['잔액', '#f2c1c8'],
    ['적립', '#f1d77f'],
    ['지출', '#acd5df'],
  ];
  const roundButton = {
    width: 32,
    height: 32,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    borderWidth: 2,
    borderColor: HALL_OUTLINE,
    borderRadius: 999,
    backgroundColor: BG,
    boxShadow: `0 3px 0 ${HALL_OUTLINE}`,
  };

  return (
    <Animated.View
      style={[
        { minHeight: 492 },
        webOnly({ filter: 'drop-shadow(0 11px 12px #3c261b62)' }),
        !reduceMotion && reactStyle(react),
      ]}
    >
      <View
        style={[
          {
            position: 'absolute',
            top: 9,
            right: -3,
            bottom: -5,
            left: 10,
            borderWidth: 2,
            borderColor: '#6f503a',
            borderTopLeftRadius: 7,
            borderTopRightRadius: 13,
            borderBottomRightRadius: 13,
            borderBottomLeftRadius: 6,
            boxShadow: 'inset 7px 0 #48634d',
          },
          Platform.OS === 'web'
            ? webOnly({
                backgroundImage: 'repeating-linear-gradient(#f1e4c9 0 3px,#b99b76 4px,#f1e4c9 5px)',
              })
            : { backgroundColor: '#f1e4c9' },
        ]}
      />
      <View
        style={{
          position: 'absolute',
          top: 4,
          right: 4,
          bottom: 1,
          left: 5,
          borderWidth: 2,
          borderColor: '#684d39',
          borderTopLeftRadius: 6,
          borderTopRightRadius: 12,
          borderBottomRightRadius: 12,
          borderBottomLeftRadius: 6,
          backgroundColor: '#678268',
          boxShadow: 'inset 8px 0 #405e48',
        }}
      />

      <View
        style={[
          {
            position: 'absolute',
            top: 10,
            right: 8,
            bottom: 7,
            left: 15,
            paddingTop: 47,
            paddingRight: 22,
            paddingBottom: 18,
            paddingLeft: 29,
            borderWidth: 1.5,
            borderColor: '#937154',
            borderTopLeftRadius: 4,
            borderTopRightRadius: 10,
            borderBottomRightRadius: 10,
            borderBottomLeftRadius: 5,
            boxShadow: 'inset 7px 0 9px #8d704333',
          },
          Platform.OS === 'web'
            ? webOnly({
                backgroundImage:
                  'linear-gradient(90deg,#c3a77d22 0 3%,transparent 8%),repeating-linear-gradient(#fff3d8 0 24px,#ead8b9 25px)',
              })
            : { backgroundColor: '#fff3d8' },
        ]}
      >
        <View
          style={{
            position: 'absolute',
            left: 4,
            top: '4%',
            bottom: '4%',
            width: 10,
            borderRadius: '50%',
            backgroundColor: exact('#99764b22'),
            boxShadow: 'inset -3px 0 4px #7a5a3833',
          }}
        />
        <View
          style={{
            position: 'absolute',
            left: 32,
            right: 22,
            top: 14,
            flexDirection: 'row',
            alignItems: 'center',
            columnGap: 5,
          }}
        >
          <Pressable testID="ledger-prev" style={roundButton}>
            <Text style={hallFont(13, 20.8, '850')}>‹</Text>
          </Pressable>
          <Text style={[hallFont(12, 19.2), { flex: 1, textAlign: 'center' }]}>2026년 9월</Text>
          <Pressable
            testID="ledger-next"
            disabled
            style={[roundButton, { opacity: 0.35, boxShadow: 'none' }]}
          >
            <Text style={hallFont(13, 20.8, '850')}>›</Text>
          </Pressable>
        </View>

        {tab === 0 && (
          <View>
            <LedgerHead kicker="SODA ISLAND LEDGER" title="우리 섬 물고기" total="🐟 1,240마리" />
            <Text style={hallFont(15, 24)}>
              <View
                style={{
                  marginTop: 5,
                  marginBottom: 9,
                  paddingVertical: 2,
                  paddingHorizontal: 7,
                  borderWidth: 1,
                  borderColor: '#886b53',
                  borderRadius: 5,
                  backgroundColor: '#efd070',
                  transform: [{ rotate: '-2deg' }],
                }}
              >
                <Text style={hallFont(12, 15.6)}>섬 주민이 함께 모은 물고기</Text>
              </View>
            </Text>
            <View style={{ flexDirection: 'row', columnGap: 7, marginVertical: 9 }}>
              {[
                ['이번 달 적립', '+386'],
                ['이번 달 사용', '−180'],
              ].map(([label, value]) => (
                <View
                  key={label}
                  style={{
                    flex: 1,
                    padding: 7,
                    borderWidth: 1,
                    borderColor: '#c7aa83',
                    backgroundColor: '#fff8e7',
                  }}
                >
                  <Text style={hallFont(12, 19.2)}>{label}</Text>
                  <Text style={hallFont(15, 24)}>
                    <Text
                      style={[
                        hallFont(17, 23.8, '400', INK, GOWUN),
                        { fontVariant: ['tabular-nums'] },
                      ]}
                    >
                      {value}
                    </Text>
                  </Text>
                </View>
              ))}
            </View>
            <LedgerRow label="오늘 집중 보상" sub="9월 15일" value="+125" />
            <LedgerRow label="축음기 음원 구매" sub="9월 14일" value="−80" />
          </View>
        )}
        {tab === 1 && (
          <View>
            <LedgerHead kicker="FISH IN" title="적립 내역" total="이번 달 +386마리" />
            <LedgerRow label="집중으로 획득" sub="오늘 · 주민 5명" value="+93" />
            <LedgerRow label="일일 퀘스트 보상" sub="오늘 · 전원 달성" value="+15" />
            <LedgerRow label="집중으로 획득" sub="어제 · 주민 4명" value="+74" />
          </View>
        )}
        {tab === 2 && (
          <View>
            <LedgerHead kicker="FISH OUT" title="사용 내역" total="이번 달 −180마리" />
            <LedgerRow label="축음기 음원 구매" sub="9월 14일 · 빗방울" value="−80" />
            <LedgerRow label="도서관 건설" sub="9월 10일" value="−100" />
            <Text
              style={[
                hallFont(12, 18, '400', MUTED),
                {
                  marginTop: 14,
                  padding: 7,
                  borderWidth: 1,
                  borderColor: '#c7aa83',
                  backgroundColor: '#fff8e7',
                },
              ]}
            >
              주민별 누적 획득량은 도서관에서 확인해요.
            </Text>
          </View>
        )}
      </View>

      <View
        style={[
          {
            position: 'absolute',
            zIndex: 4,
            left: 10,
            top: -34,
            minWidth: 103,
            paddingTop: 6,
            paddingHorizontal: 15,
            paddingBottom: 7,
            borderWidth: 1.5,
            borderColor: '#68482f',
            borderTopLeftRadius: 6,
            borderTopRightRadius: 6,
            borderBottomLeftRadius: 9,
            borderBottomRightRadius: 9,
            boxShadow: '0 3px 0 #68482f',
            transform: [{ rotate: '-1deg' }],
          },
          gradient('linear-gradient(90deg,#b97949,#d2a064,#bd814d)'),
        ]}
      >
        <Text
          style={[
            hallFont(15, 18, '400', '#fff8e8', GOWUN),
            { textAlign: 'center' },
            textShadow(0, 1, '#66442e'),
          ]}
        >
          공동 가계부
        </Text>
      </View>

      <View
        style={{
          position: 'absolute',
          zIndex: 5,
          right: 15,
          top: -17,
          flexDirection: 'row',
          columnGap: 3,
        }}
      >
        {tabs.map(([label, color], i) => (
          <Pressable
            key={label}
            testID={`ledger-tab-${i}`}
            onPress={() => {
              setTab(i);
              setReacting((n) => n + 1);
              showToast(`${label} 선택`);
            }}
            style={[
              {
                width: 56,
                minHeight: 40,
                paddingTop: 5,
                paddingHorizontal: 4,
                paddingBottom: 8,
                alignItems: 'center',
                justifyContent: 'center',
                borderWidth: 1.5,
                borderColor: '#775846',
                borderTopLeftRadius: 4,
                borderTopRightRadius: 4,
                borderBottomLeftRadius: 2,
                borderBottomRightRadius: 2,
                backgroundColor: color,
                boxShadow: '0 2px 0 #775846',
              },
              webOnly({ clipPath: 'polygon(0 0,100% 0,100% 100%,50% 80%,0 100%)' }),
              tab === i && [
                { transform: [{ translateY: -6 }] },
                webOnly({ filter: 'brightness(1.04)' }),
              ],
            ]}
          >
            <Text style={[hallFont(12, 15, '800'), { textAlign: 'center' }]}>{label}</Text>
          </Pressable>
        ))}
      </View>
    </Animated.View>
  );
}

const hallArtifacts: Record<string, ArtifactRenderer> = {
  'hall-desk': (props) => <HallDesk {...props} />,
  'building-models': (props) => <BuildingFlow {...props} />,
  'building-blueprint': (props) => <BuildingFlow {...props} />,
  'village-ledger': (props) => <Ledger {...props} />,
  // 섬 정보 · 주민 · 가입 신청 세 시안이 같은 kind라 시안이 바뀌면 새로 그린다
  'island-management': (props) => (
    <View key={props.index} style={fill}>
      <IslandManagement
        width={props.width}
        isStatic
        initialTab={props.concept.managementTab ?? 'info'}
        shown
        reduceMotion={props.reduceMotion}
        showToast={props.showToast}
        onClose={() => {}}
      />
    </View>
  ),
};

// ───────────── 게시판 ─────────────

// 게시판 기능 화면: board-view (원본 board.js의 공지·퀘스트·청사진 상태 기계와 마크업)

type Notice = { title: string; time: string; body: string; comments: [string, string][] };
type Quest = { title: string; type: string; target: number; rate: number };
type QuestForm = { type: string; title: string; target: string };
type BoardState = {
  role: 'owner' | 'resident';
  panel: '' | 'notice' | 'quest' | 'blueprint';
  view: string;
  noticeIndex: number;
  questIndex: number;
  draft: { title: string; body: string } | null;
  commentDraft: string;
  error: string;
  editing: boolean;
  ready: boolean;
  balance: number;
  deleteTarget: 'notice' | 'comment';
  commentIndex: number;
  questEditing: boolean;
  questForm: QuestForm | null;
  // 원본은 상태가 바뀔 때마다 innerHTML을 새로 그려 퀘스트 종이 애니메이션이 다시 시작된다
  serial: number;
};

const OWNER = '민지';
const NOTICES: Notice[] = [
  {
    title: '수아가 소다 섬에 도착했어요',
    time: '오늘',
    body: '오늘부터 수아도 소다 섬에서 함께 집중해요.\n모닥불에서 만나면 반갑게 인사해 주세요.',
    comments: [
      ['두부', '수아야, 어서 와!'],
      ['수아', '반겨줘서 고마워요. 같이 열심히 해요!'],
      ['밤이', '저녁에 같이 낚시하자!'],
    ],
  },
  {
    title: '오늘 밤, 모닥불에서 만나요',
    time: '오늘',
    body: '밤 9시에 모닥불에서 잠깐 쉬어가요.\n오늘 들을 음악도 같이 골라봐요.',
    comments: [
      ['민지', '좋아! 집중 끝나고 갈게.'],
      ['보리', '나는 파도 소리 듣고 싶어.'],
    ],
  },
  {
    title: '다음 건물은 도서관이에요',
    time: '어제',
    body: '다음 목표는 도서관이에요. 게시판의 청사진에서 모은 물고기와 주민별 현황을 확인할 수 있어요.',
    comments: [
      ['구름', '일기장 펼쳐보고 싶다!'],
      ['소금', '오늘 물고기 열심히 모아볼게.'],
      ['두부', '우리 같이 완성하자!'],
    ],
  },
];
const QUESTS: Quest[] = [
  { title: '아침 25분 집중', type: 'focus', target: 25, rate: 100 },
  { title: '하루 폰 90분 이하', type: 'phone', target: 90, rate: 75 },
  { title: '저녁 40분 집중', type: 'focus', target: 40, rate: 38 },
];
const RESIDENTS = [
  ['민지', 'calico'],
  ['두부', 'white'],
  ['수아', 'cream'],
] as const;
const QUEST_TYPES: [string, string][] = [
  ['focus', '집중 시간'],
  ['phone', '하루 폰 사용'],
];
const HANDWRITING = [
  'M5 10 C8 2 12 4 10 10 C8 16 16 15 17 8 C18 2 24 3 22 11 C20 16 29 13 31 7 M39 10 C41 3 46 4 45 10 C44 16 51 15 53 7 C56 2 59 6 58 11 C57 16 65 13 67 7 C69 3 74 6 73 12 C73 16 81 11 85 9',
  'M6 27 C10 20 14 21 12 27 C10 33 18 31 21 24 C24 19 28 23 26 29 C24 34 33 31 35 25 C37 20 42 22 41 29 M49 26 C52 19 58 22 55 29 C53 34 63 31 64 24 C66 20 70 24 69 29 C70 33 76 30 80 26 C84 22 89 26 93 25',
  'M5 44 C8 37 13 38 11 45 C9 50 17 49 19 41 C21 36 26 39 24 46 C24 50 31 46 33 40 M41 44 C44 36 49 40 46 47 C45 52 53 48 55 42 C58 36 62 40 60 46 C60 51 68 46 71 42 C74 37 80 42 78 47',
  'M7 61 C10 55 15 56 13 62 C12 67 21 64 23 58 C25 53 29 58 28 63 C29 67 36 61 38 58 M47 60 C50 54 56 55 53 63 C52 67 61 64 64 58 C67 53 71 58 69 63 C68 67 75 63 80 60 C84 56 88 61 92 59',
];

// 크롬 레이아웃 단위(1/64px)로 내림: 원본 img 크기 계산을 같은 반올림으로 따라간다
const lu = (value: number) => Math.floor(value * 64) / 64;

// 원본 CSS의 font 값 (크기 · 줄높이 배수). View는 글꼴을 물려주지 않아 글자마다 지정한다.
// 줄높이는 lh()로 1/64px 내림: 크롬 원본과 같은 줄 높이가 된다 (중첩 Text는 px가 그대로 물려지므로 크기가 다르면 따로 준다)
const boardFont = (
  size: number,
  lineHeight: number,
  weight: '400' | '700' | '800' = '400',
  color = INK,
  family = BODY_FONT,
): any => ({
  fontFamily: family,
  fontSize: size,
  lineHeight: lh(size * lineHeight),
  fontWeight: weight,
  color,
  ...webOnly({ whiteSpace: 'normal' }),
});

function makeState(concept: Concept): BoardState {
  const view = concept.boardView || 'list';
  const state: BoardState = {
    role: concept.boardRole || 'owner',
    panel: concept.boardPanel || '',
    view,
    noticeIndex: 0,
    questIndex: 0,
    draft: null,
    commentDraft: '',
    error: '',
    editing: false,
    ready: view === 'ready' || view === 'building',
    balance: 240,
    deleteTarget: 'notice',
    commentIndex: 0,
    questEditing: false,
    questForm: null,
    serial: 0,
  };
  if (['edit', 'write-failed'].includes(view)) {
    state.draft = { title: NOTICES[0].title, body: NOTICES[0].body };
    state.editing = view === 'edit';
  }
  if (view === 'write-failed') {
    state.view = 'write';
    state.error = '저장하지 못했어요. 입력한 내용은 그대로 남아 있어요.';
  }
  if (view === 'comment') state.commentDraft = '수아야, 어서 와! 같이 낚시하자.';
  return state;
}

// 원본 <img object-fit:contain>. 웹은 CSS 배경이면 확대 결과가 달라 실제 img를 박스에 채운다
function Picture({
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
function BoardPaper({ source, style }: { source: ImageSourcePropType; style?: any }) {
  const frame = [{ position: 'absolute', left: -34, right: -34, top: -38, bottom: -30 }, style];
  if (Platform.OS !== 'web') {
    return (
      <Image
        source={source}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        resizeMode="stretch"
        style={frame}
      />
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
function Handwriting({ short }: { short?: boolean }) {
  return (
    <Svg
      viewBox={`0 0 100 ${short ? 34 : 70}`}
      pointerEvents="none"
      style={
        short
          ? { width: '86%', maxHeight: 20, aspectRatio: 100 / 34, opacity: 0.72 }
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

// 스크롤 패널: 웹은 원본처럼 overflow-y:auto 인 div (ScrollView는 translateZ(0)을 붙여 그리기가 달라진다)
// overscroll-behavior 는 원본처럼 공지 패널에만 준다: 붙이면 크롬이 패널을 합성 레이어로 올려 색이 1씩 달라진다
function Scroll({ style, children }: { style: any; children: React.ReactNode }) {
  if (Platform.OS !== 'web') return <ScrollView style={style}>{children}</ScrollView>;
  return <View style={[style, webOnly({ overflowX: 'auto', overflowY: 'auto' })]}>{children}</View>;
}

// .artifact-tag (게시판 크기)
function BoardTag({ label }: { label: string }) {
  return (
    <View
      style={{
        alignSelf: 'flex-start',
        marginBottom: 7,
        paddingVertical: 3,
        paddingHorizontal: 9,
        borderWidth: 1,
        borderColor: '#7f624f',
        borderRadius: 99,
        backgroundColor: '#fff8e9',
      }}
    >
      <Text style={boardFont(12, 1.6, '800')}>{label}</Text>
    </View>
  );
}

// .board-primary · .board-outline
function BoardPill({
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

// .notice-list-back
function Back({
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
      onPress={onPress}
      style={[
        {
          minHeight: 40,
          justifyContent: 'center',
          paddingVertical: 5,
          paddingHorizontal: 12,
          borderWidth: 2,
          borderColor: '#8b6956',
          borderRadius: 999,
          backgroundColor: '#fffdfa',
          boxShadow: '0 3px 0 #8b6956',
        },
        style,
      ]}
    >
      <Text
        style={[
          boardFont(14, 1.6, '700'),
          { textAlign: 'center' },
          webOnly({ whiteSpace: 'nowrap' }),
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

// .board-text (밑줄 글자 버튼)
function Link({
  label,
  onPress,
  testID,
  danger,
  size = 13,
}: {
  label: string;
  onPress: () => void;
  testID: string;
  danger?: boolean;
  size?: number;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      onPress={onPress}
      style={{ paddingVertical: 4 }}
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
function PaperAction({
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
          boardFont(16, 1.2, '400', '#7e5541', 'BoardHand-Bold'),
          { textDecorationLine: 'underline' },
          webOnly({ textUnderlineOffset: 4 }),
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

// .quest-card-track
function Track({ rate, color, style }: { rate: number; color: string; style?: any }) {
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

// 폼 label (글자 한 줄 + 입력칸)
function BoardField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: 7 }}>
      <Text style={boardFont(14, 1.6, '700')}>{label}</Text>
      {children}
    </View>
  );
}

// 입력칸: font 14px/1.5 Gowun (textarea 줄바꿈은 브라우저 기본값을 둔다)
const inputStyle = (): any => ({
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

// <select>: 웹은 브라우저 기본 모양(화살표)까지 같도록 실제 select를 그린다
function Choice({
  testID,
  options,
  value,
  onChange,
}: {
  testID: string;
  options: [string, string][];
  value: string;
  onChange: (value: string) => void;
}) {
  if (Platform.OS === 'web')
    return (
      <select
        data-testid={testID}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        style={{
          boxSizing: 'border-box',
          width: '100%',
          minWidth: 0,
          minHeight: 44,
          margin: 0,
          padding: 10,
          border: '1.5px solid #b49472',
          borderRadius: 8,
          background: '#fffdf5',
          color: INK,
          font: '14px/1.5 Gowun',
        }}
      >
        {options.map(([option, label]) => (
          <option key={option} value={option}>
            {label}
          </option>
        ))}
      </select>
    );
  const index = Math.max(
    0,
    options.findIndex(([option]) => option === value),
  );
  return (
    <Pressable
      testID={testID}
      onPress={() => onChange(options[(index + 1) % options.length][0])}
      style={[inputStyle(), { justifyContent: 'center' }]}
    >
      <Text style={boardFont(14, 1.5, '400', INK, GOWUN)}>{`${options[index][1]} ▾`}</Text>
    </Pressable>
  );
}

// .quest-sheet-card: 목록이 펼쳐질 때 @keyframes quest-paper-open .45s cubic-bezier(.16,.8,.25,1), 1~3번째는 .12/.22/.32s 늦게
function QuestCard({
  quest,
  index,
  owner,
  reduceMotion,
  onDetail,
  onEdit,
}: {
  quest: Quest;
  index: number;
  owner: boolean;
  reduceMotion: boolean;
  onDetail: () => void;
  onEdit: () => void;
}) {
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduceMotion) return;
    Animated.timing(t, {
      toValue: 1,
      duration: 450,
      delay: [120, 220, 320][index] ?? 0,
      easing: Easing.bezier(0.16, 0.8, 0.25, 1),
      useNativeDriver: false,
    }).start();
  }, [index, reduceMotion, t]);
  const complete = quest.rate === 100;
  // 웹은 부모의 perspective:700px 를 쓰고, 네이티브는 transform 안에 넣는다
  const unfold: any = reduceMotion
    ? null
    : {
        opacity: t,
        transform: [
          ...(Platform.OS === 'web' ? [] : [{ perspective: 700 }]),
          { translateY: t.interpolate({ inputRange: [0, 1], outputRange: [-18, 0] }) },
          { rotateX: t.interpolate({ inputRange: [0, 1], outputRange: ['-65deg', '0deg'] }) },
          { scaleY: t.interpolate({ inputRange: [0, 1], outputRange: [0.7, 1] }) },
        ],
      };
  return (
    <Animated.View
      style={[
        {
          paddingVertical: 10,
          paddingHorizontal: 2,
          borderBottomWidth: 1,
          borderColor: '#b9965866',
          borderStyle: 'dashed',
          transformOrigin: 'center top',
        },
        unfold,
      ]}
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 6,
        }}
      >
        <Text style={boardFont(18, 1.2, '400', INK, 'BoardHand-Bold')}>{quest.title}</Text>
      </View>
      <View
        style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8, marginVertical: 7 }}
      >
        <Text style={boardFont(13, 1.6, '400', '#786147')}>내 달성률</Text>
        <Text style={boardFont(13, 1.6, '700')}>{`${quest.rate}%`}</Text>
      </View>
      <Track
        rate={quest.rate}
        color={complete ? '#7eaa71' : '#c9943f'}
        style={{ height: 5, backgroundColor: '#b99e5b33' }}
      />
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8, marginTop: 7 }}>
        <Link testID={`board-quest-detail-${index}`} label="자세히 보기 ›" onPress={onDetail} />
        {owner && <Link testID={`board-quest-edit-${index}`} label="수정" onPress={onEdit} />}
      </View>
    </Animated.View>
  );
}

function Board({ concept, width, height, reduceMotion }: ArtifactProps) {
  const [s, setS] = useState(() => makeState(concept));
  const [notices, setNotices] = useState(NOTICES);
  const [quests, setQuests] = useState(QUESTS);
  const owner = s.role === 'owner';
  const user = owner ? OWNER : '두부';
  const render = (change: Partial<BoardState>) => setS({ ...s, ...change, serial: s.serial + 1 });

  const publish = () => {
    if (!owner) return;
    const draft = s.draft;
    if (!draft?.title.trim() || !draft.body.trim())
      return render({ error: '제목과 본문을 입력해주세요.', view: 'write' });
    const next = { title: draft.title.trim(), body: draft.body.trim() };
    if (s.editing && notices[s.noticeIndex]) {
      setNotices(
        notices.map((notice, i) => (i === s.noticeIndex ? { ...notice, ...next } : notice)),
      );
      return render({ view: 'detail', error: '', editing: false, draft: null });
    }
    setNotices([...notices, { ...next, time: '오늘', comments: [] }]);
    render({ noticeIndex: notices.length, view: 'detail', error: '', editing: false, draft: null });
  };

  // 원본 handleBulletinClick 의 data-bulletin 동작
  const act = (action: string, index = 0) => {
    if (
      [
        'notice-new',
        'notice-edit',
        'notice-delete',
        'quest-new',
        'quest-edit',
        'build-start',
      ].includes(action) &&
      !owner
    )
      return;
    const comments = notices[s.noticeIndex]?.comments ?? [];
    switch (action) {
      case 'notice-new':
        return render({
          view: 'write',
          editing: false,
          draft: s.draft ?? { title: '', body: '' },
          error: '',
        });
      case 'notice-edit':
        return render({
          editing: true,
          draft: { title: notices[s.noticeIndex].title, body: notices[s.noticeIndex].body },
          view: 'edit',
          error: '',
        });
      case 'notice-delete':
        return render({ deleteTarget: 'notice', view: 'confirm' });
      case 'comment-delete':
        if (!owner && comments[index][0] !== user) return;
        return render({ deleteTarget: 'comment', commentIndex: index, view: 'confirm' });
      case 'delete-confirm':
        if (s.deleteTarget === 'notice') {
          setNotices(notices.filter((_, i) => i !== s.noticeIndex));
          return render({ noticeIndex: 0, view: 'list' });
        }
        if (!owner && comments[s.commentIndex][0] !== user) return;
        setNotices(
          notices.map((notice, i) =>
            i === s.noticeIndex
              ? { ...notice, comments: notice.comments.filter((_, j) => j !== s.commentIndex) }
              : notice,
          ),
        );
        return render({ view: 'detail' });
      case 'quest-edit':
        return render({ questIndex: index, questEditing: true, questForm: null, view: 'write' });
      case 'build-start':
        if (!s.ready || s.balance < 60) return;
        return render({ balance: s.balance - 60, view: 'building' });
    }
  };

  const submitComment = () => {
    const text = s.commentDraft.trim();
    if (!text) return;
    setNotices(
      notices.map((notice, i) =>
        i === s.noticeIndex ? { ...notice, comments: [...notice.comments, [user, text]] } : notice,
      ),
    );
    render({ commentDraft: '', view: 'detail', error: '' });
  };

  const submitQuest = (form: QuestForm) => {
    if (!owner) return;
    const title = form.title.trim(),
      target = Number(form.target);
    if (!title || !(target > 0)) return;
    const quest = { title, target, type: form.type, rate: 0 };
    setQuests(
      s.questEditing
        ? quests.map((item, i) => (i === s.questIndex ? quest : item))
        : [...quests, quest],
    );
    render({ view: 'list', questEditing: false, questForm: null });
  };

  const h4 = boardFont(20, 1.35, '700', INK, GOWUN);
  const author = boardFont(13, 1.6, '400', '#786151');
  const body = [boardFont(14, 1.6), webOnly({ whiteSpace: 'pre-line', overflowWrap: 'anywhere' })];
  const muted = (style: any) => [boardFont(14, 1.5, '400', '#786151'), style];
  const formError = s.error !== '' && (
    <Text style={boardFont(13, 1.45, '400', '#a35952')}>{s.error}</Text>
  );
  const detailHead = (back: React.ReactNode) => (
    <View
      style={{
        minHeight: 44,
        marginBottom: 8,
        paddingRight: 30,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 8,
      }}
    >
      {back}
    </View>
  );

  const noticeList = () => (
    <View>
      <View>
        <Text style={[boardFont(14, 1.2, '400', '#9b7058', 'BoardHand'), { marginBottom: 1 }]}>
          소다 섬 게시판
        </Text>
        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 8,
            marginBottom: 6,
          }}
        >
          <Text style={boardFont(28, 1.15, '400', INK, 'BoardHand-Bold')}>
            공지{' '}
            <Text style={{ fontSize: 16, lineHeight: lh(16 * 1.15), color: '#9b7058' }}>
              {notices.length}
            </Text>
          </Text>
          {owner && (
            <PaperAction
              testID="board-notice-new"
              label="+ 새 공지"
              onPress={() => act('notice-new')}
            />
          )}
        </View>
      </View>
      <View>
        {notices.length ? (
          notices.map((notice, i) => (
            <Pressable
              key={i}
              testID={`board-notice-item-${i}`}
              accessibilityRole="button"
              onPress={() => render({ noticeIndex: i, view: 'detail', error: '' })}
              style={({ pressed }) => ({
                minHeight: 66,
                gap: 5,
                paddingVertical: 10,
                paddingHorizontal: 2,
                borderBottomWidth: 1,
                borderColor: '#b48c704d',
                borderStyle: 'dashed',
                backgroundColor: pressed ? exact('#b67c4d14') : 'transparent',
              })}
            >
              <Text
                style={[
                  boardFont(17, 1.25, '400', INK, 'BoardHand-Bold'),
                  webOnly({ wordBreak: 'keep-all' }),
                ]}
                lineBreakStrategyIOS="hangul-word"
              >
                {notice.title}
              </Text>
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 8,
                }}
              >
                <Text
                  style={boardFont(12, 1.3, '400', '#786151', GOWUN)}
                >{`${OWNER} · ${notice.time}`}</Text>
                <Text
                  style={[
                    boardFont(12, 1.3, '400', '#786151', GOWUN),
                    webOnly({ whiteSpace: 'nowrap' }),
                  ]}
                >
                  {`댓글 ${notice.comments.length} `}
                  <Text
                    style={{
                      fontSize: 19,
                      lineHeight: lh(19 * 1.3),
                      color: '#73533e',
                      marginLeft: 3,
                    }}
                  >
                    ›
                  </Text>
                </Text>
              </View>
            </Pressable>
          ))
        ) : (
          <Text style={muted({ marginTop: 4, marginBottom: 14 })}>아직 등록된 공지가 없어요.</Text>
        )}
      </View>
    </View>
  );

  const noticeDetail = () => {
    const notice = notices[s.noticeIndex];
    if (!notice) return noticeList();
    const comments = notice.comments.map((comment, i) => [comment, i] as const);
    return (
      <View>
        {detailHead(
          <PaperAction
            testID="board-notice-back"
            label="← 목록"
            onPress={() => render({ view: 'list' })}
          />,
        )}
        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            gap: 8,
            marginTop: 4,
            marginBottom: 10,
          }}
        >
          <Text style={author}>{OWNER}</Text>
          <Text style={author}>{notice.time}</Text>
        </View>
        <Text
          style={[
            boardFont(23, 1.2, '400', INK, 'BoardHand-Bold'),
            { marginTop: 4, marginBottom: 12 },
            webOnly({ wordBreak: 'keep-all', textWrap: 'pretty' }),
          ]}
          lineBreakStrategyIOS="hangul-word"
        >
          {notice.title}
        </Text>
        <Text style={[body, { marginBottom: 14 }]}>{notice.body}</Text>
        {owner && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16, marginBottom: 14 }}>
            <PaperAction
              testID="board-notice-edit"
              label="수정"
              onPress={() => act('notice-edit')}
            />
            <Link
              testID="board-notice-delete"
              label="삭제"
              danger
              onPress={() => act('notice-delete')}
            />
          </View>
        )}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
            marginTop: 8,
            marginBottom: 12,
          }}
        >
          <Text style={boardFont(15, 1.4, '700')}>
            주민 댓글{' '}
            <Text style={{ marginLeft: 4, color: '#99644f' }}>{notice.comments.length}</Text>
          </Text>
          <PaperAction
            testID="board-comment-new"
            label="+ 댓글 쓰기"
            onPress={() => render({ view: 'comment', error: '' })}
          />
        </View>
        <View>
          {comments.length ? (
            comments.map(([[name, text], commentIndex]) => (
              <View
                key={commentIndex}
                style={{
                  flexDirection: 'row',
                  gap: 8,
                  paddingVertical: 10,
                  borderTopWidth: 1,
                  borderColor: '#d7bea0',
                }}
              >
                <Text style={[boardFont(13, 1.5, '700', '#815742'), { width: 38 }]}>{name}</Text>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text
                    style={[
                      boardFont(14, 1.5),
                      webOnly({ whiteSpace: 'pre-line', overflowWrap: 'anywhere' }),
                    ]}
                  >
                    {text}
                  </Text>
                  {(owner || name === user) && (
                    <View style={{ flexDirection: 'row', marginTop: 5 }}>
                      <Link
                        testID={`board-comment-delete-${commentIndex}`}
                        label="삭제"
                        danger
                        size={12}
                        onPress={() => act('comment-delete', commentIndex)}
                      />
                    </View>
                  )}
                </View>
              </View>
            ))
          ) : (
            <Text style={muted({ marginTop: 4, marginBottom: 14 })}>첫 댓글을 남겨보세요.</Text>
          )}
        </View>
      </View>
    );
  };

  const noticeEditor = () => {
    if (!owner) return noticeList();
    const draft = s.draft ?? { title: '', body: '' };
    const setDraft = (patch: Partial<typeof draft>) =>
      setS((prev) => ({
        ...prev,
        draft: { ...(prev.draft ?? { title: '', body: '' }), ...patch },
      }));
    return (
      <View>
        {detailHead(
          <Back
            testID="board-notice-cancel"
            label="‹ 돌아가기"
            onPress={() => render({ view: s.editing ? 'detail' : 'list', error: '' })}
          />,
        )}
        <BoardTag label={OWNER} />
        <Text
          style={[h4, { marginTop: 4, marginRight: 34, marginBottom: 12 }]}
        >{`공지 ${s.editing ? '수정' : '쓰기'}`}</Text>
        <View style={{ gap: 12 }}>
          <BoardField label="제목">
            <TextInput
              testID="board-notice-title"
              value={draft.title}
              onChangeText={(title) => setDraft({ title })}
              placeholder="공지 제목을 적어주세요"
              placeholderTextColor="#757575"
              style={inputStyle()}
            />
          </BoardField>
          <BoardField label="본문">
            <TextInput
              testID="board-notice-body"
              multiline
              textAlignVertical="top"
              value={draft.body}
              onChangeText={(text) => setDraft({ body: text })}
              placeholder="주민들에게 전할 소식을 적어주세요"
              placeholderTextColor="#757575"
              style={[inputStyle(), { height: 106 }]}
            />
          </BoardField>
          {formError}
          <BoardPill
            testID="board-notice-submit"
            label={s.editing ? '수정 저장' : '게시하기'}
            primary
            style={{ marginTop: 4 }}
            onPress={publish}
          />
        </View>
      </View>
    );
  };

  const commentView = () => (
    <View>
      {detailHead(
        <Back
          testID="board-comment-cancel"
          label="‹ 공지로"
          onPress={() => render({ view: 'detail' })}
        />,
      )}
      <Text style={[h4, { marginRight: 34, marginBottom: 12 }]}>댓글 쓰기</Text>
      <Text style={muted({ marginBottom: 14 })}>{notices[s.noticeIndex]?.title || '공지'}</Text>
      <BoardTag label={user} />
      <View style={{ gap: 12 }}>
        <TextInput
          testID="board-comment-input"
          accessibilityLabel="댓글 내용"
          multiline
          textAlignVertical="top"
          value={s.commentDraft}
          onChangeText={(commentDraft) => setS((prev) => ({ ...prev, commentDraft }))}
          placeholder="주민들에게 따뜻한 말을 남겨주세요"
          placeholderTextColor="#757575"
          style={[inputStyle(), { height: 85 }]}
        />
        {formError}
        <BoardPill
          testID="board-comment-submit"
          label="댓글 등록"
          primary
          disabled={!s.commentDraft.trim()}
          onPress={submitComment}
        />
      </View>
    </View>
  );

  const noticeContent = () => {
    switch (s.view) {
      case 'detail':
        return noticeDetail();
      case 'write':
      case 'edit':
        return noticeEditor();
      case 'comment':
        return commentView();
      case 'confirm':
        return (
          <View>
            <Text
              style={[h4, { marginTop: 4, marginRight: 34, marginBottom: 12 }]}
            >{`${s.deleteTarget === 'notice' ? '공지를' : '댓글을'} 삭제할까요?`}</Text>
            <Text style={[boardFont(14, 1.6), { marginTop: 2, marginBottom: 18 }]}>
              삭제한 내용은 되돌릴 수 없어요.
            </Text>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <BoardPill
                testID="board-delete-cancel"
                label="취소"
                style={{ flex: 1 }}
                onPress={() => render({ view: 'detail' })}
              />
              <BoardPill
                testID="board-delete-confirm"
                label="삭제"
                primary
                style={{ flex: 1 }}
                onPress={() => act('delete-confirm')}
              />
            </View>
          </View>
        );
      default:
        return noticeList();
    }
  };

  const questBack = (
    <Back
      testID="board-quest-back"
      label="‹ 퀘스트 목록"
      onPress={() => render({ view: 'list', questEditing: false, questForm: null })}
      style={s.view === 'detail' && { alignSelf: 'flex-start', marginBottom: 10 }}
    />
  );

  const questContent = () => {
    if (s.view === 'detail') {
      const quest = quests[s.questIndex] ?? quests[0];
      return (
        <>
          {questBack}
          <Text style={[h4, { marginTop: 4, marginRight: 34, marginBottom: 12 }]}>
            {quest.title}
          </Text>
          <Text style={[boardFont(13, 1.65, '400', '#786151'), { marginBottom: 4 }]}>
            주민별 달성률
          </Text>
          <View>
            {RESIDENTS.map(([name, color], i) => {
              const rate = i < 2 ? quest.rate : 48;
              return (
                <View
                  key={name}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 9,
                    minHeight: 62,
                    paddingVertical: 9,
                    paddingHorizontal: 2,
                    borderBottomWidth: 1,
                    borderColor: '#b9965866',
                    borderStyle: 'dashed',
                  }}
                >
                  <Picture
                    source={interiorArt.avatars[color]}
                    label={`${name} 고양이 프로필`}
                    style={{ width: 42, height: 42 }}
                  />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={boardFont(14, 1.6, '700')}>
                      {name === user ? `${name} · 나` : name}
                    </Text>
                    <Track rate={rate} color="#91b67e" style={{ marginTop: 7 }} />
                  </View>
                  <Text style={[boardFont(14, 1.6, '700'), { width: 42 }]}>{`${rate}%`}</Text>
                </View>
              );
            })}
          </View>
        </>
      );
    }
    if (s.view === 'write') {
      const editing = s.questEditing && quests[s.questIndex];
      const form = s.questForm ?? {
        type: editing && editing.type === 'phone' ? 'phone' : 'focus',
        title: editing ? editing.title : '',
        target: String(editing ? editing.target : 25),
      };
      const setForm = (patch: Partial<QuestForm>) =>
        setS((prev) => ({ ...prev, questForm: { ...form, ...prev.questForm, ...patch } }));
      return (
        <>
          {questBack}
          <Text
            style={[h4, { marginTop: 4, marginRight: 34, marginBottom: 12 }]}
          >{`일일 퀘스트 ${s.questEditing ? '수정' : '만들기'}`}</Text>
          <View style={{ gap: 12 }}>
            <BoardField label="종류">
              <Choice
                testID="board-quest-type"
                options={QUEST_TYPES}
                value={form.type}
                onChange={(type) => setForm({ type })}
              />
            </BoardField>
            <BoardField label="퀘스트 제목">
              <TextInput
                testID="board-quest-title"
                value={form.title}
                onChangeText={(title) => setForm({ title })}
                placeholder="예: 저녁 40분 집중"
                placeholderTextColor="#757575"
                style={inputStyle()}
              />
            </BoardField>
            <BoardField label="목표 시간 · 분">
              <TextInput
                testID="board-quest-target"
                keyboardType="number-pad"
                value={form.target}
                onChangeText={(target) => setForm({ target })}
                style={inputStyle()}
              />
            </BoardField>
            <Text style={muted({ marginTop: 4, marginBottom: 14 })}>매일 새 회차로 진행해요.</Text>
            <BoardPill
              testID="board-quest-save"
              label="퀘스트 저장"
              primary
              onPress={() => submitQuest(form)}
            />
          </View>
        </>
      );
    }
    return (
      <>
        <View style={{ marginBottom: 4 }}>
          <Text style={[boardFont(14, 1.2, '400', '#98713d', 'BoardHand'), { marginBottom: 1 }]}>
            매일 한 장씩
          </Text>
          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <Text style={boardFont(27, 1.15, '400', INK, 'BoardHand-Bold')}>
              오늘의 퀘스트{' '}
              <Text style={{ fontSize: 16, lineHeight: lh(16 * 1.15), color: '#92713f' }}>
                {quests.length}
              </Text>
            </Text>
            {owner && (
              <PaperAction
                testID="board-quest-new"
                label="+ 만들기"
                onPress={() => render({ view: 'write', questEditing: false, questForm: null })}
              />
            )}
          </View>
        </View>
        <View key={s.serial} style={[{ paddingHorizontal: 2 }, webOnly({ perspective: 700 })]}>
          {quests.map((quest, i) => (
            <QuestCard
              key={i}
              quest={quest}
              index={i}
              owner={owner}
              reduceMotion={reduceMotion}
              onDetail={() => render({ questIndex: i, view: 'detail' })}
              onEdit={() => act('quest-edit', i)}
            />
          ))}
        </View>
      </>
    );
  };

  const blueprint = () => {
    const ready = s.ready && s.balance >= 60;
    const light = '#f7fcff';
    const dashed = { borderStyle: 'dashed' as const, borderColor: exact('#dff7ffaa') };
    const copyRow = (label: string, value: string) => (
      <View
        style={[
          {
            flexDirection: 'row',
            justifyContent: 'space-between',
            gap: 5,
            paddingVertical: 4,
            borderTopWidth: 1,
          },
          dashed,
        ]}
      >
        <Text style={boardFont(12, 1.35, '400', light)}>{label}</Text>
        <Text style={boardFont(12, 1.35, '700', light)}>{value}</Text>
      </View>
    );
    const fishRow = (label: string, value: string) => (
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={boardFont(14, 1.6, '700', light)}>{label}</Text>
        <Text style={boardFont(14, 1.6, '400', light)}>{value}</Text>
      </View>
    );
    return (
      <>
        <View style={[{ paddingBottom: 14, borderBottomWidth: 1 }, dashed]}>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 10,
              paddingRight: 38,
              marginBottom: 10,
            }}
          >
            <Text style={[boardFont(12, 1.6, '400', '#e8faff'), { letterSpacing: 0.48 }]}>
              BUILDING PLAN · 01
            </Text>
            <Text
              style={[
                boardFont(11, 1.6, '800', light),
                {
                  paddingVertical: 3,
                  paddingHorizontal: 8,
                  borderWidth: 1,
                  borderColor: exact('#dff7ffaa'),
                  borderRadius: 99,
                  backgroundColor: exact('#eaf8fb1f'),
                },
              ]}
            >
              {s.view === 'building' ? '공사 중' : ready ? '준비 완료' : '건설 준비'}
            </Text>
          </View>
          <View style={{ flexDirection: 'row', gap: 10, minHeight: 142 }}>
            <View
              style={{
                width: '36%',
                minHeight: 142,
                alignItems: 'center',
                paddingTop: 7,
                paddingHorizontal: 5,
                paddingBottom: 6,
                borderWidth: 1,
                borderColor: exact('#dff7ffaa'),
                backgroundColor: exact('#eaf8fb19'),
                overflow: 'hidden',
              }}
            >
              <View
                style={{
                  position: 'absolute',
                  left: '50%',
                  top: 6,
                  bottom: 6,
                  width: 1,
                  backgroundColor: exact('#dff7ff55'),
                }}
              />
              <View
                style={{
                  position: 'absolute',
                  top: '50%',
                  left: 6,
                  right: 6,
                  height: 1,
                  backgroundColor: exact('#dff7ff55'),
                }}
              />
              <Text
                style={[
                  boardFont(11, 1.6, '400', exact('#dff7ffaa')),
                  { position: 'absolute', zIndex: 1, right: 5, top: 3 },
                ]}
              >
                ＋
              </Text>
              <View
                style={{
                  flex: 1,
                  alignSelf: 'stretch',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Picture
                  source={interiorArt.buildings.library}
                  label="도서관 건물 미리보기"
                  shadow="0 4px 2px #244c5c80"
                  style={{ zIndex: 1, width: 94, maxWidth: '100%', height: 104 }}
                />
              </View>
              <Text
                style={[
                  boardFont(11, 1.6, '400', '#fff'),
                  {
                    zIndex: 1,
                    paddingVertical: 1,
                    paddingHorizontal: 5,
                    borderWidth: 1,
                    borderColor: exact('#dff7ffaa'),
                    borderRadius: 99,
                    backgroundColor: '#4f94b1',
                  },
                ]}
              >
                예상 모습
              </Text>
            </View>
            <View style={{ flex: 1, minWidth: 0, alignSelf: 'center' }}>
              <Text style={[boardFont(22, 1.1, '700', light, GOWUN), { marginBottom: 7 }]}>
                도서관
              </Text>
              {copyRow('가격', '1인당 20마리')}
              {copyRow('시간', '공사 15분')}
              <Text
                style={[
                  boardFont(12, 1.45, '400', light),
                  { marginTop: 6, paddingTop: 6, borderTopWidth: 1 },
                  dashed,
                ]}
              >
                나와 주민들의 집중 기록, 스크린타임, 누적 물고기를 일·주·월로 확인해요.
              </Text>
            </View>
          </View>
        </View>
        {s.view === 'building' ? (
          <View style={{ gap: 10, paddingTop: 16, paddingHorizontal: 2, paddingBottom: 2 }}>
            <Text style={boardFont(21, 1.25, '700', light, GOWUN)}>도서관을 짓고 있어요</Text>
            <Text style={boardFont(13, 1.6, '400', '#e8faff')}>공사 진행률 · 35%</Text>
            <Track
              rate={35}
              color="#f3d16d"
              style={{
                height: 10,
                borderWidth: 1,
                borderColor: '#dff7ff',
                backgroundColor: '#eaf8fb',
              }}
            />
            <Text style={boardFont(14, 1.5, '400', light)}>
              섬 물고기 60마리를 사용했어요. 공사가 끝나면 다음 건물 목표를 고를 수 있어요.
            </Text>
          </View>
        ) : (
          <View style={{ paddingTop: 14 }}>
            <View style={{ gap: 7 }}>
              {fishRow('주민 준비량', `${s.ready ? 60 : 50} / 60마리`)}
              <View
                style={{
                  height: 10,
                  borderWidth: 1,
                  borderColor: '#dff7ff',
                  borderRadius: 99,
                  backgroundColor: '#eaf8fb',
                  overflow: 'hidden',
                }}
              >
                {/* 웹은 원본 <u>처럼 쌓임 맥락 없는 블록으로 둔다: 100%로 가득 차면 둥근 잘림의 가장자리 픽셀이 달라진다 */}
                <View
                  style={[
                    { width: s.ready ? '100%' : '83%', height: '100%', backgroundColor: '#f3d16d' },
                    webOnly({ position: 'static', zIndex: 'auto' }),
                  ]}
                />
              </View>
              {fishRow('섬 잔액 / 공사 가격', `${s.balance} / 60마리`)}
            </View>
            <Text style={[boardFont(14, 1.6, '700', light), { marginTop: 14, marginBottom: 8 }]}>
              목표 선택 당시 주민 3명 · 1인당 20마리
            </Text>
            <View style={{ gap: 7 }}>
              {RESIDENTS.map(([name], i) => (
                <View
                  key={name}
                  style={{
                    flexDirection: 'row',
                    justifyContent: 'space-between',
                    minHeight: 42,
                    padding: 10,
                    borderWidth: 1,
                    borderColor: '#dff7ff',
                    borderRadius: 5,
                    backgroundColor: exact('#eaf8fbe8'),
                  }}
                >
                  <Text style={boardFont(13, 1.6, '400', '#395e70')}>{name}</Text>
                  <Text
                    style={boardFont(13, 1.6, '700', '#395e70')}
                  >{`${s.ready ? 20 : [20, 18, 12][i]} / 20마리${s.ready || i === 0 ? ' ✓' : ''}`}</Text>
                </View>
              ))}
            </View>
            {ready && (
              <View
                style={{
                  alignSelf: 'center',
                  marginTop: 13,
                  paddingVertical: 4,
                  paddingHorizontal: 12,
                  borderWidth: 2,
                  borderColor: '#e6f4d8',
                  borderRadius: 7,
                }}
              >
                <Text style={boardFont(23, 1.2, '400', '#f0ffdc', 'BoardHand-Bold')}>
                  준비 완료
                </Text>
              </View>
            )}
            {owner && (
              <BoardPill
                testID="board-build-start"
                label="60마리로 건설하기"
                primary
                disabled={!ready}
                style={{ marginTop: 16, backgroundColor: '#ffa6bc' }}
                onPress={() => act('build-start')}
              />
            )}
            <Text style={[boardFont(13, 1.5, '400', light), { marginTop: 12 }]}>
              {ready
                ? owner
                  ? '전원 준비와 섬 잔액이 충족됐어요.'
                  : '방장이 건설을 시작할 수 있어요.'
                : '주민 전원이 요구량을 채워야 건설할 수 있어요.'}
            </Text>
          </View>
        )}
      </>
    );
  };

  // 장면 속 청사진 종이 위 도서관 그림: grid 행 높이가 그림 비율로 정해지는 원본 계산을 그대로 따른다
  const planeWidth = lu((height * 2) / 3);
  const blueprintInner = lu(planeWidth * 0.19) - 10;
  const libraryWidth = lu(blueprintInner * 0.82);
  const libraryRow = lu((libraryWidth * artSize.library[1]) / artSize.library[0]);
  const libraryHeight = lu(libraryRow * 0.92);
  const open = (panel: BoardState['panel']) => {
    if (s.panel === panel) return render({ panel: '', view: 'list', error: '' });
    return render({
      panel,
      view: panel === 'blueprint' ? (s.ready ? 'ready' : 'waiting') : 'list',
      error: '',
    });
  };
  const pressedFilter = (panel: BoardState['panel']) =>
    s.panel === panel && webOnly({ filter: 'brightness(1.08)' });
  const paperPanel = s.panel === 'notice' || s.panel === 'quest';
  const noticeDetailOpen = s.panel === 'notice' && s.view === 'detail';
  const paperSource =
    s.panel === 'quest' ? interiorArt.boardPaper.quest : interiorArt.boardPaper.notice;

  return (
    <View style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }}>
      <View
        style={{
          position: 'absolute',
          left: '50%',
          top: 0,
          height: '100%',
          aspectRatio: 2 / 3,
          transform: [{ translateX: '-50%' }],
        }}
      >
        <Pressable
          testID="board-notice-area"
          accessibilityRole="button"
          accessibilityLabel="공지"
          onPress={() => open('notice')}
          style={[
            {
              position: 'absolute',
              left: '22.3%',
              top: '23.5%',
              width: '25.3%',
              height: '22.6%',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 9,
              padding: 12,
            },
            pressedFilter('notice'),
          ]}
        >
          <Text
            style={[boardFont(28, 1.1, '400', '#76503c', 'BoardHand'), { letterSpacing: 0.56 }]}
          >
            공지
          </Text>
          <Handwriting />
        </Pressable>
        <Pressable
          testID="board-quest-area"
          accessibilityRole="button"
          accessibilityLabel="퀘스트 목록 펼치기"
          onPress={() => open('quest')}
          style={[
            {
              position: 'absolute',
              left: '51%',
              top: '24%',
              width: '27%',
              height: '9%',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 3,
              paddingTop: 8,
              paddingHorizontal: 10,
              paddingBottom: 4,
            },
            pressedFilter('quest'),
          ]}
        >
          <Text style={boardFont(22, 1.1, '400', '#82652c', 'BoardHand-Bold')}>퀘스트</Text>
          <Handwriting short />
        </Pressable>
        <Pressable
          testID="board-blueprint-area"
          accessibilityRole="button"
          accessibilityLabel="도서관 건설 현황 보기"
          onPress={() => open('blueprint')}
          style={[
            {
              position: 'absolute',
              zIndex: 2,
              left: '61%',
              top: '34.2%',
              width: '19%',
              height: '12.8%',
            },
            pressedFilter('blueprint'),
          ]}
        >
          <Picture
            source={interiorArt.buildings.library}
            label="도서관"
            shadow="0 2px 2px #173e5140"
            style={{
              position: 'absolute',
              left: 5 + lu((blueprintInner - libraryWidth) / 2),
              top: 5 + lu((libraryRow - libraryHeight) / 2),
              width: libraryWidth,
              height: libraryHeight,
            }}
          />
        </Pressable>
      </View>
      <View
        testID="board-drawer"
        style={[
          {
            position: 'absolute',
            zIndex: 4,
            left: 0,
            right: 0,
            bottom: 10,
            maxHeight: height - 105,
            padding: 16,
            borderWidth: 2,
            borderColor: '#75533d',
            borderTopLeftRadius: 18,
            borderTopRightRadius: 18,
            backgroundColor: '#fff2d8',
            boxShadow: '0 8px 18px #3b281b77',
          },
          // 닫힘: 높이 50%(좁은 화면 74%)로 아래로 내려가 투명
          s.panel
            ? { transform: [{ translateY: 0 }] }
            : {
                height: width <= 290 ? '74%' : '50%',
                minHeight: 340,
                opacity: 0,
                transform: [{ translateY: '125%' }],
              },
          paperPanel && {
            height: Math.min(height * 0.58, 492),
            minHeight: 0,
            paddingTop: 58,
            paddingHorizontal: 30,
            paddingBottom: 31,
            borderWidth: 0,
            borderRadius: 0,
            backgroundColor: 'transparent',
            boxShadow: 'none',
          },
        ]}
      >
        {paperPanel && <BoardPaper source={paperSource} />}
        {!paperPanel && (
          <Pressable
            testID="board-drawer-close"
            accessibilityRole="button"
            accessibilityLabel="내용 닫기"
            onPress={() => render({ panel: '' })}
            style={({ pressed }) => ({
              position: 'absolute',
              zIndex: 3,
              top: 8,
              right: 8,
              width: 44,
              height: 44,
              alignItems: 'center',
              justifyContent: 'center',
              borderWidth: 1,
              borderColor: '#dff7ff',
              borderRadius: 22,
              backgroundColor: '#eaf8fb',
              opacity: pressed ? 0.55 : 1,
            })}
          >
            <Text style={[boardFont(23, 1.6, '400', '#395e70'), { textAlign: 'center' }]}>×</Text>
          </Pressable>
        )}
        {s.panel === 'notice' && (
          <Scroll
            style={[
              {
                flexGrow: 1,
                flexShrink: 1,
                minHeight: 0,
                maxHeight: Math.min(height * 0.58, 492) - 89,
              },
              webOnly({ overscrollBehavior: 'contain' }),
            ]}
          >
            {noticeDetailOpen ? noticeList() : noticeContent()}
          </Scroll>
        )}
        {s.panel === 'quest' && (
          <Scroll style={{ maxHeight: Math.min(height * 0.58, 492) - 89 }}>{questContent()}</Scroll>
        )}
        {s.panel === 'blueprint' && (
          <Scroll
            style={[
              {
                margin: -16,
                padding: 16,
                minHeight: 241,
                maxHeight: height - 109,
                borderWidth: 2,
                borderColor: '#d9f3f7',
                borderTopLeftRadius: 16,
                borderTopRightRadius: 16,
                backgroundColor: '#4f94b1',
                boxShadow: 'inset 0 0 0 4px #4a899f,0 12px 26px #273c4666',
              },
              gradient(
                'linear-gradient(#dff7ff24 1px,transparent 1px),linear-gradient(90deg,#dff7ff24 1px,transparent 1px),linear-gradient(#dff7ff12 1px,transparent 1px),linear-gradient(90deg,#dff7ff12 1px,transparent 1px)',
              ),
              webOnly({ backgroundSize: '32px 32px,32px 32px,8px 8px,8px 8px' }),
            ]}
          >
            {blueprint()}
          </Scroll>
        )}
      </View>
      {noticeDetailOpen && (
        <>
          <Pressable
            testID="board-notice-overlay-scrim"
            accessibilityLabel="공지 상세 닫기"
            onPress={() => render({ view: 'list' })}
            style={{
              position: 'absolute',
              zIndex: 5,
              left: 0,
              right: 0,
              top: 0,
              bottom: 0,
              backgroundColor: exact('#3f302f2b'),
            }}
          />
          <View
            testID="board-notice-overlay"
            accessibilityViewIsModal
            style={{
              position: 'absolute',
              zIndex: 6,
              left: 32,
              right: 32,
              top: '20%',
              maxHeight: '58%',
              paddingTop: 37,
              paddingHorizontal: 22,
              paddingBottom: 27,
              boxShadow: '0 8px 18px #2f211d45',
            }}
          >
            <BoardPaper
              source={interiorArt.boardPaper.notice}
              style={{ left: -28, right: -28, top: -32, bottom: -26 }}
            />
            <Scroll
              style={[
                { minHeight: 0, maxHeight: height * 0.49 },
                webOnly({ overscrollBehavior: 'contain' }),
              ]}
            >
              {noticeDetail()}
            </Scroll>
          </View>
        </>
      )}
    </View>
  );
}

const boardArtifacts: Record<string, ArtifactRenderer> = {
  // 시안이 바뀌면 상태를 새로 만든다
  'board-view': (props) => <Board key={props.index} {...props} />,
};

// ───────────── 전망대·우체통 ─────────────

// 전망대·우체통 기능 화면: observatory-desk · island-ranking · old-map · mail-home · island-room · friend-mail

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

// 본문 글꼴 스택 한 벌 (font-size · line-height 배수)
const obsFont = (
  fontSize: number,
  factor: number,
  color: string = INK,
  fontWeight: '400' | '700' | '800' | '900' = '400',
) => ({ fontFamily: BODY_FONT, fontSize, lineHeight: lh(fontSize * factor), color, fontWeight });

// .artifact.reacting: @keyframes object-react .42s ease (45%에서 scale 1.025 · rotate -.5deg, 키프레임 구간마다 ease)
function useReact(reduceMotion: boolean, rotate = '0deg'): [any, () => void] {
  const t = useRef(new Animated.Value(0)).current;
  const run = () => {
    if (reduceMotion) return;
    t.setValue(0);
    Animated.sequence([
      Animated.timing(t, { toValue: 0.45, duration: 189, easing: ease, useNativeDriver: false }),
      Animated.timing(t, { toValue: 1, duration: 231, easing: ease, useNativeDriver: false }),
    ]).start();
  };
  if (reduceMotion) return [rotate === '0deg' ? undefined : [{ rotate }], run];
  const at = (outputRange: any[]) => t.interpolate({ inputRange: [0, 0.45, 1], outputRange });
  return [[{ scale: at([1, 1.025, 1]) }, { rotate: at([rotate, '-0.5deg', rotate]) }], run];
}

// .artifact-tag. inline이면 부모 줄 상자(15px/1.6) 안의 inline-block이라 위에 7px이 생긴다
function ObsTag({
  label,
  inline,
  color = INK,
  background = '#fff8e9',
}: {
  label: string;
  inline?: boolean;
  color?: string;
  background?: string;
}) {
  return (
    <View
      style={{
        alignSelf: 'flex-start',
        marginTop: inline ? 7 : 0,
        marginBottom: inline ? 7 : 4,
        paddingVertical: 2,
        paddingHorizontal: 8,
        borderWidth: 1,
        borderColor: '#7f624f',
        borderRadius: 99,
        backgroundColor: background,
      }}
    >
      <Text style={[obsFont(7, 1.6, color, '800'), { letterSpacing: 0.7 }]}>{label}</Text>
    </View>
  );
}

// .selection-copy: 제목 font 16px/1.25 Gowun, 설명 line-height 1.4, 사이 1px
function Selection({
  title,
  note,
  size,
  noteSize,
  color = INK,
  noteColor = '#79685d',
  style,
}: {
  title: string;
  note: string;
  size: number;
  noteSize: number;
  color?: string;
  noteColor?: string;
  style?: any;
}) {
  return (
    <View style={[{ rowGap: 1 }, style]}>
      <Text style={{ fontFamily: GOWUN, fontSize: size, lineHeight: lh(size * 1.25), color }}>
        {title}
      </Text>
      <Text style={obsFont(noteSize, 1.4, noteColor)}>{note}</Text>
    </View>
  );
}

// .stamp-action: 버튼 글자는 세로 가운데
function Stamp({
  label,
  background,
  onPress,
}: {
  label: string;
  background: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      testID="stamp-action"
      onPress={onPress}
      style={{
        minHeight: 34,
        marginTop: 9,
        paddingVertical: 6,
        paddingHorizontal: 10,
        justifyContent: 'center',
        borderWidth: 1.5,
        borderColor: OUTLINE,
        borderRadius: 9,
        backgroundColor: background,
        boxShadow: `0 2px 0 ${OUTLINE}`,
      }}
    >
      <Text style={[obsFont(9, 1.6, INK, '800'), { textAlign: 'center' }]}>{label}</Text>
    </Pressable>
  );
}

// .object-choice 안의 이름(span)과 짧은 막대(i)
function ChoiceLabel({ label }: { label: string }) {
  return (
    <>
      <Text style={[obsFont(8, 1.25, INK, '800'), { textAlign: 'center' }]}>{label}</Text>
      <View
        style={{
          alignSelf: 'center',
          width: 11,
          height: 3,
          marginTop: 4,
          borderRadius: 99,
          backgroundColor: exact('#7f624f55'),
        }}
      />
    </>
  );
}

// .laptop-base: 화면보다 좌우 8%씩 넓은 받침
function LaptopBase() {
  return (
    <View
      style={[
        {
          height: 19,
          marginHorizontal: '-8%',
          borderWidth: 2,
          borderColor: '#5e493d',
          borderTopLeftRadius: 2,
          borderTopRightRadius: 2,
          borderBottomLeftRadius: 10,
          borderBottomRightRadius: 10,
          boxShadow: 'inset 0 2px #c9b39c',
        },
        gradient('linear-gradient(#a78d75,#6e5849)'),
      ]}
    >
      <View
        style={{
          position: 'absolute',
          left: '38%',
          right: '38%',
          top: 4,
          height: 5,
          borderWidth: 1,
          borderColor: '#59483e',
          borderRadius: 2,
          backgroundColor: '#85705f',
        }}
      />
    </View>
  );
}

const laptopScreen = {
  borderColor: '#6b5547',
  borderTopLeftRadius: 8,
  borderTopRightRadius: 8,
  borderBottomLeftRadius: 4,
  borderBottomRightRadius: 4,
  backgroundColor: '#17243a',
  boxShadow: 'inset 0 0 0 2px #9b836d',
};

// 원본 ::after 점: @keyframes object-hotspot 1.8s ease-in-out infinite.
// 동작 줄이기 규칙(* { animation: none })은 가상 요소를 고르지 않아 원본은 동작 줄이기에서도 계속 뛴다 → 웹은 같은 CSS 애니메이션을 그대로 건다.
// 달리는 애니메이션이 있어야 크롬이 그 뒤에 그리는 요소(설명 상자·상단 UI)를 원본과 같은 방식으로 합성한다.
// animationKeyframes 는 StyleSheet.create 로만 쓸 수 있다
const hotspotFrame = (scale: number, ring: number, color: string) => ({
  transform: `translate(-50%,-50%) scale(${scale})`,
  boxShadow: `0 0 0 5px #fff9,0 0 0 ${ring}px ${color}`,
});
const hotspotWeb =
  Platform.OS === 'web'
    ? StyleSheet.create({
        dot: {
          animationKeyframes: [
            {
              '0%': hotspotFrame(1, 9, '#f3adbd33'),
              '50%': hotspotFrame(1.06, 15, '#f3adbd18'),
              '100%': hotspotFrame(1, 9, '#f3adbd33'),
            },
          ],
          animationDuration: '1.8s',
          animationTimingFunction: 'ease-in-out',
          animationIterationCount: 'infinite',
        } as any,
      }).dot
    : null;

function DeskDot({ reduceMotion }: { reduceMotion: boolean }) {
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (Platform.OS === 'web' || reduceMotion) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(t, {
          toValue: 1,
          duration: 900,
          easing: easeInOut,
          useNativeDriver: false,
        }),
        Animated.timing(t, {
          toValue: 0,
          duration: 900,
          easing: easeInOut,
          useNativeDriver: false,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [reduceMotion, t]);
  const base = {
    position: 'absolute' as const,
    left: '50%' as const,
    top: '50%' as const,
    width: 9,
    height: 9,
    borderRadius: 4.5,
    backgroundColor: '#f3d16d',
    boxShadow: '0 0 0 5px #fff9,0 0 0 9px #f3adbd33',
  };
  if (Platform.OS === 'web')
    return (
      <View
        style={[base, { transform: [{ translateX: '-50%' }, { translateY: '-50%' }] }, hotspotWeb]}
      />
    );
  // 네이티브는 바깥 링 대신 크기만 뛴다
  return (
    <Animated.View
      style={[
        base,
        {
          transform: [
            { translateX: '-50%' },
            { translateY: '-50%' },
            { scale: t.interpolate({ inputRange: [0, 1], outputRange: [1, 1.06] }) },
          ],
        },
      ]}
    />
  );
}

function ObservatoryDesk({ concept, reduceMotion, showToast }: ArtifactProps) {
  const [selected, setSelected] = useState(0);
  const [reactTransform, react] = useReact(reduceMotion);
  const item = concept.items[selected];
  const rows = [
    ['1', '라임 섬', '42h 20m'],
    ['2', '소다 섬', '38h 45m'],
    ['3', '구름 섬', '34h 10m'],
  ];
  return (
    <Animated.View
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        top: 0,
        bottom: 0,
        transform: reactTransform,
      }}
    >
      <View
        style={[
          { position: 'absolute', left: '24%', top: '46%', width: '52%' },
          webOnly({ filter: 'drop-shadow(0 7px 6px #1a172088)' }),
        ]}
      >
        <View
          style={[
            laptopScreen,
            {
              paddingTop: 9,
              paddingHorizontal: 9,
              paddingBottom: 8,
              borderWidth: 6,
              borderBottomWidth: 8,
            },
          ]}
        >
          <Text style={[obsFont(6, 1.6, '#d8b86c'), { marginBottom: 6, letterSpacing: 0.48 }]}>
            이번 주 다른 섬 랭킹
          </Text>
          {rows.map(([rank, name, time], i) => (
            <View
              key={rank}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                columnGap: 4,
                paddingVertical: 4,
                paddingHorizontal: 3,
                borderTopWidth: 1,
                borderTopColor: exact('#6f7b8755'),
                backgroundColor: i === 1 ? exact('#b98d4950') : undefined,
              }}
            >
              <View
                style={{
                  width: 12,
                  height: 12,
                  marginRight: 2,
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: 6,
                  backgroundColor: '#c59d55',
                }}
              >
                <Text style={obsFont(6, 1.6, '#182439')}>{rank}</Text>
              </View>
              <Text style={[obsFont(6, 1.6, '#e8e0c8', '700'), { flex: 1 }]}>{name}</Text>
              <Text style={[obsFont(5, 1.6, '#e8e0c8'), { fontVariant: ['tabular-nums'] }]}>
                {time}
              </Text>
            </View>
          ))}
        </View>
        <LaptopBase />
      </View>
      {concept.items.map((choice, i) => {
        const on = selected === i;
        return (
          <Pressable
            key={choice[0]}
            testID={`choice-${i}`}
            onPress={() => {
              setSelected(i);
              react();
              showToast(`${choice[0]} 선택`);
            }}
            style={[
              { position: 'absolute' },
              i === 0
                ? {
                    left: '24%',
                    top: '45%',
                    width: '52%',
                    height: '25%',
                    transform: on ? [{ translateY: -3 }] : undefined,
                  }
                : {
                    right: '4%',
                    top: '57%',
                    width: '32%',
                    height: '18%',
                    transform: [{ rotate: '5deg' }],
                  },
            ]}
          >
            <View
              style={{
                position: 'absolute',
                left: '50%',
                bottom: -4,
                paddingVertical: 3,
                paddingHorizontal: 7,
                transform: [{ translateX: '-50%' }],
                borderWidth: 1,
                borderColor: '#b79256',
                borderRadius: 99,
                backgroundColor: on ? '#d2a95e' : exact('#16243ad9'),
              }}
            >
              <Text
                style={[
                  obsFont(6, 1.25, on ? '#17243a' : '#fff2cb', '800'),
                  webOnly({ whiteSpace: 'nowrap' }),
                ]}
              >
                {choice[0]}
              </Text>
            </View>
            <DeskDot reduceMotion={reduceMotion} />
          </Pressable>
        );
      })}
      <View
        style={{
          position: 'absolute',
          left: 12,
          right: 12,
          bottom: 22,
          paddingVertical: 9,
          paddingHorizontal: 11,
          borderWidth: 1,
          borderColor: '#b79256',
          borderRadius: 7,
          backgroundColor: exact('#17243ae8'),
          boxShadow: '0 6px 14px #111a2b88',
        }}
      >
        <ObsTag label={kindCopy[concept.kind]} inline color="#fff5dd" />
        <Selection
          title={item[1]}
          note={item[2]}
          size={12}
          noteSize={7}
          color="#fff5dd"
          noteColor="#cbd4df"
        />
      </View>
    </Animated.View>
  );
}

function IslandRanking({ concept, reduceMotion, showToast }: ArtifactProps) {
  const [selected, setSelected] = useState(0);
  const [reactTransform, react] = useReact(reduceMotion);
  const item = concept.items[selected];
  return (
    <Animated.View style={{ transform: reactTransform }}>
      <View
        style={[
          laptopScreen,
          {
            paddingTop: 13,
            paddingHorizontal: 12,
            paddingBottom: 11,
            borderWidth: 9,
            borderBottomWidth: 11,
          },
        ]}
      >
        <View style={{ marginBottom: 8 }}>
          <Text style={[obsFont(6, 1.6, '#d8b86c'), { letterSpacing: 0.72 }]}>WEEK 37</Text>
          <View style={{ flexDirection: 'row', alignItems: 'flex-end' }}>
            <Text
              style={{
                flex: 1,
                fontFamily: GOWUN,
                fontSize: 15,
                lineHeight: lh(15 * 1.25),
                color: '#e8e0c8',
              }}
            >
              다른 섬 랭킹
            </Text>
            <Text style={obsFont(6, 1.6, '#e8e0c8')}>주간 집중 평균</Text>
          </View>
        </View>
        <View style={{ rowGap: 5 }}>
          {concept.items.map((choice, i) => (
            <Pressable
              key={choice[0]}
              testID={`choice-${i}`}
              onPress={() => {
                setSelected(i);
                react();
                showToast(`${choice[0]} 선택`);
              }}
              style={[
                {
                  minHeight: 39,
                  paddingVertical: 7,
                  paddingHorizontal: 3,
                  justifyContent: 'center',
                  borderWidth: 1.5,
                  borderColor: '#8291a0',
                  borderRadius: 3,
                  backgroundColor: i === 1 ? '#725d3e' : '#243750',
                },
                selected === i && {
                  transform: [{ translateX: 4 }],
                  outlineWidth: 2,
                  outlineStyle: 'solid',
                  outlineColor: '#e6c86f',
                },
              ]}
            >
              <Text style={[obsFont(8, 1.25, '#edf3f4', '800'), { width: 34 }]}>{choice[0]}</Text>
            </Pressable>
          ))}
        </View>
        <Selection
          title={item[1]}
          note={item[2]}
          size={10}
          noteSize={6}
          color="#e8e0c8"
          noteColor="#cbd4df"
          style={{
            marginTop: 8,
            marginHorizontal: 3,
            paddingTop: 7,
            borderTopWidth: 1,
            borderTopColor: '#718095',
          }}
        />
      </View>
      <LaptopBase />
    </Animated.View>
  );
}

function OldMap({ concept, reduceMotion, showToast }: ArtifactProps) {
  const [selected, setSelected] = useState(0);
  const [reactTransform, react] = useReact(reduceMotion, '0.6deg');
  const item = concept.items[selected];
  // 가상 요소에는 * { box-sizing: border-box } 가 닿지 않아 width 20px에 테두리 2px씩이 더해진다
  const roller = {
    position: 'absolute' as const,
    top: -3,
    bottom: -3,
    width: 24,
    borderWidth: 2,
    borderColor: '#8b623f',
    borderRadius: '50%' as const,
    backgroundColor: '#c99e68',
  };
  return (
    <Animated.View
      style={{
        paddingVertical: 18,
        paddingHorizontal: 22,
        borderRadius: 8,
        backgroundColor: '#ead3a4',
        boxShadow: '0 8px 16px #10192b88',
        transform: reactTransform,
      }}
    >
      <View style={[roller, { left: -9 }]} />
      <View style={[roller, { right: -9 }]} />
      <ObsTag label={kindCopy[concept.kind]} inline />
      <Selection
        title={item[1]}
        note={item[2]}
        size={16}
        noteSize={8}
        style={{ marginBottom: 9 }}
      />
      <View
        style={[
          {
            height: 104,
            marginHorizontal: 4,
            marginBottom: 10,
            borderWidth: 1,
            borderStyle: 'dashed',
            borderColor: '#866b4e',
            borderRadius: '45%',
            backgroundColor: exact('#76b7c755'),
          },
          webOnly({
            backgroundImage:
              'radial-gradient(circle at 24% 56%,#799f67 0 14px,transparent 15px),radial-gradient(circle at 51% 29%,#799f67 0 11px,transparent 12px),radial-gradient(circle at 77% 61%,#799f67 0 15px,transparent 16px)',
          }),
        ]}
      >
        {/* 네이티브는 radial-gradient 섬 대신 원 */}
        {Platform.OS !== 'web' &&
          [
            [24, 56, 14.5],
            [51, 29, 11.5],
            [77, 61, 15.5],
          ].map(([x, y, r]) => (
            <View
              key={x}
              style={{
                position: 'absolute',
                left: `${x}%`,
                top: `${y}%`,
                width: r * 2,
                height: r * 2,
                marginLeft: -r,
                marginTop: -r,
                borderRadius: r,
                backgroundColor: '#799f67',
              }}
            />
          ))}
        {[
          [24, 43],
          [51, 22],
          [77, 50],
        ].map(([x, y]) => (
          <View
            key={x}
            style={{
              position: 'absolute',
              left: `${x}%`,
              top: `${y}%`,
              width: 8,
              height: 8,
              borderRadius: 4,
              backgroundColor: '#c86c5a',
            }}
          />
        ))}
        <View
          style={{
            position: 'absolute',
            left: 12,
            right: 12,
            top: 12,
            bottom: 12,
            borderWidth: 1,
            borderStyle: 'dashed',
            borderColor: '#866b4e',
            borderRadius: '45%',
          }}
        />
      </View>
      <View style={{ flexDirection: 'row', columnGap: 6 }}>
        {concept.items.map((choice, i) => (
          <Pressable
            key={choice[0]}
            testID={`choice-${i}`}
            onPress={() => {
              setSelected(i);
              react();
              showToast(`${choice[0]} 선택`);
            }}
            style={{
              flex: 1,
              minHeight: 40,
              paddingVertical: 7,
              paddingHorizontal: 3,
              justifyContent: 'center',
              borderWidth: 1.5,
              borderColor: OUTLINE,
              borderRadius: 8,
              backgroundColor: '#f5e5bf',
              boxShadow: `0 2px 0 ${OUTLINE}`,
              transform: selected === i ? [{ translateY: -3 }] : undefined,
            }}
          >
            <ChoiceLabel label={choice[0]} />
          </Pressable>
        ))}
      </View>
      <Stamp
        label="선택한 섬 구경하기"
        background="#d5a85e"
        onPress={() => showToast(`${item[0]} 지도를 펼쳤어요`)}
      />
    </Animated.View>
  );
}

function MailHome({ concept, reduceMotion, showToast }: ArtifactProps) {
  const [selected, setSelected] = useState(0);
  const [opened, setOpened] = useState(false);
  const [reactTransform, react] = useReact(reduceMotion);
  const item = concept.items[selected];
  // .mail-opened 의 눌린 칸: @keyframes pull-mail .55s ease both (50% 위로 13px·-2deg → 끝 위로 4px)
  const pull = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    pull.setValue(0);
    if (reduceMotion || !opened) return;
    Animated.sequence([
      Animated.timing(pull, { toValue: 0.5, duration: 275, easing: ease, useNativeDriver: false }),
      Animated.timing(pull, { toValue: 1, duration: 275, easing: ease, useNativeDriver: false }),
    ]).start();
  }, [opened, selected, reduceMotion, pull]);
  const slot = (i: number) => {
    const on = selected === i,
      first = i === 0;
    const pressed =
      opened && !reduceMotion
        ? [
            {
              translateY: pull.interpolate({ inputRange: [0, 0.5, 1], outputRange: [-3, -13, -4] }),
            },
            {
              rotate: pull.interpolate({
                inputRange: [0, 0.5, 1],
                outputRange: ['0deg', '-2deg', '0deg'],
              }),
            },
          ]
        : [{ translateY: -3 }, { rotate: '0deg' }];
    return (
      <AnimatedPressable
        key={i}
        testID={`choice-${i}`}
        onPress={() => {
          setSelected(i);
          react();
          showToast(`${concept.items[i][0]} 선택`);
        }}
        style={[
          {
            minHeight: first ? 135 : 64,
            paddingTop: first ? 78 : 23,
            paddingHorizontal: 5,
            paddingBottom: 7,
            justifyContent: 'center',
            borderWidth: 1.5,
            borderColor: '#684434',
            borderRadius: 4,
            backgroundColor: ['#dce8c1', '#bddde0', '#efbcc4'][i],
            boxShadow: 'inset 0 -8px #c99870,0 3px 0 #3f1d18',
          },
          first && webOnly({ gridRow: 'span 2' }),
          on
            ? {
                transform: pressed,
                outlineWidth: 3,
                outlineStyle: 'solid',
                outlineColor: '#fff4ce',
                outlineOffset: -5,
              }
            : { transform: [{ rotate: i === 1 ? '1deg' : '-1deg' }] },
        ]}
      >
        <ChoiceLabel label={concept.items[i][0]} />
        {/* ::before는 position:absolute라 글자보다 나중에 그려진다 (그림자가 글자 윗부분을 덮음) */}
        <View
          style={[
            {
              position: 'absolute',
              left: 7,
              right: 7,
              top: first ? 16 : 7,
              height: first ? 58 : 22,
            },
            first
              ? [
                  webOnly({
                    backgroundImage: 'repeating-linear-gradient(#fffaf0 0 11px,#d7c5a3 12px)',
                    clipPath: 'polygon(4% 0,96% 3%,100% 95%,1% 100%)',
                  }),
                  Platform.OS !== 'web' && { backgroundColor: '#fffaf0' },
                ]
              : gradient(
                  'linear-gradient(145deg,transparent 49%,#ccb176 50%),linear-gradient(215deg,transparent 49%,#ead69f 50%)',
                ),
            webOnly({ filter: 'drop-shadow(0 2px 1px #65402a33)' }),
          ]}
        />
      </AnimatedPressable>
    );
  };
  return (
    <Animated.View
      style={{
        padding: 12,
        borderWidth: 6,
        borderColor: '#633a2e',
        borderTopLeftRadius: 16,
        borderTopRightRadius: 16,
        borderBottomLeftRadius: 9,
        borderBottomRightRadius: 9,
        backgroundColor: '#a84437',
        boxShadow: 'inset 0 0 0 2px #e67965,0 7px 16px #43251a66',
        transform: reactTransform,
      }}
    >
      <View
        style={{
          position: 'absolute',
          left: 7,
          right: 7,
          top: 7,
          height: '54%',
          borderRadius: 8,
          backgroundColor: '#6f3029',
          boxShadow: 'inset 0 5px 10px #32110c88',
        }}
      />
      <ObsTag label={kindCopy[concept.kind]} inline background="#fff0cf" />
      {/* 원본은 아래 안내 줄의 margin-top 5px이 이 9px과 겹쳐 사라진다 */}
      <Selection
        title={item[1]}
        note={item[2]}
        size={16}
        noteSize={8}
        color="#fff4df"
        noteColor="#f6d2bf"
        style={{ paddingHorizontal: 5, marginBottom: 9 }}
      />
      <Text
        style={[
          obsFont(7, 1.6, '#ffe9cf', '800'),
          { marginBottom: 7, paddingLeft: 5, letterSpacing: 0.42 },
        ]}
      >
        누가 볼 수 있나요?
      </Text>
      {/* grid 1.2fr 1fr · 첫 칸은 두 줄 차지. 웹은 CSS grid 그대로 (fr 칸 폭의 1/64px 반올림까지 원본과 같게), 네이티브는 여백 없는 두 기둥 */}
      <View
        style={[
          {
            flexDirection: 'row',
            columnGap: 7,
            rowGap: 7,
            padding: 8,
            borderWidth: 1.5,
            borderColor: '#4c241f',
            borderRadius: 8,
            backgroundColor: '#57251f',
          },
          webOnly({ display: 'grid', gridTemplateColumns: '1.2fr 1fr' }),
        ]}
      >
        {Platform.OS === 'web' ? (
          [slot(0), slot(1), slot(2)]
        ) : (
          <>
            <View style={{ flex: 1.2 }}>{slot(0)}</View>
            <View style={{ flex: 1, rowGap: 7 }}>
              {slot(1)}
              {slot(2)}
            </View>
          </>
        )}
      </View>
      <Stamp
        label="선택한 칸 열기"
        background="#f1c46f"
        onPress={() => {
          setOpened((prev) => !prev);
          showToast(`${item[0]} 칸을 열었어요`);
        }}
      />
    </Animated.View>
  );
}

function IslandRoom({ concept, reduceMotion, showToast }: ArtifactProps) {
  const [selected, setSelected] = useState(0);
  // 처음엔 시간만, 편지를 누르면 data-note("이름 · 시간")로 바뀐다
  const [note, setNote] = useState(concept.items[0][2]);
  const [sent, setSent] = useState(false);
  const [reactTransform, react] = useReact(reduceMotion);
  const stamps = ['●', '▲', '◆'];
  return (
    <Animated.View
      style={[
        {
          paddingTop: 14,
          paddingHorizontal: 13,
          paddingBottom: 13,
          borderWidth: 1.5,
          borderColor: '#633a2e',
          borderTopLeftRadius: 5,
          borderTopRightRadius: 8,
          borderBottomRightRadius: 4,
          borderBottomLeftRadius: 6,
          backgroundColor: '#fff1d0',
          boxShadow: '0 7px 16px #43251a55',
          transform: reactTransform,
        },
        webOnly({
          clipPath:
            'polygon(1% 0,99% 1%,100% 98%,96% 100%,89% 98%,81% 100%,72% 98%,64% 100%,56% 98%,47% 100%,39% 98%,31% 100%,23% 98%,15% 100%,7% 98%,0 100%)',
        }),
      ]}
    >
      <View style={{ marginBottom: 9 }}>
        <ObsTag label="주민 모두에게" />
        <View style={{ flexDirection: 'row', alignItems: 'flex-end' }}>
          <Text
            style={{
              flex: 1,
              fontFamily: GOWUN,
              fontSize: 16,
              lineHeight: lh(16 * 1.15),
              color: INK,
            }}
          >
            우리 섬 편지방
          </Text>
          <Text style={obsFont(7, 1.6, '#806b58')}>소다 섬 주민 8명</Text>
        </View>
      </View>
      <View style={{ rowGap: 6, marginBottom: 8 }}>
        {concept.items.map((letter, i) => (
          <Pressable
            key={letter[0]}
            testID={`choice-${i}`}
            onPress={() => {
              setSelected(i);
              setNote(`${letter[0]} · ${letter[2]}`);
              react();
              showToast(`${stamps[i]} 선택`);
            }}
            style={{
              minHeight: 45,
              paddingVertical: 6,
              paddingHorizontal: 7,
              borderTopLeftRadius: 7,
              borderTopRightRadius: 12,
              borderBottomRightRadius: 12,
              borderBottomLeftRadius: 7,
              backgroundColor: selected === i ? '#dce9d7' : '#fffaf0',
              boxShadow: '0 2px 0 #c7aa83',
              transform: selected === i ? [{ translateX: 3 }] : undefined,
            }}
          >
            {/* grid 27px 1fr auto · 막대(i)는 둘째 줄 첫 칸 가운데 */}
            <View style={{ flexDirection: 'row', alignItems: 'center', columnGap: 6 }}>
              <View
                style={{
                  width: 26,
                  height: 26,
                  marginRight: 1,
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderWidth: 1.5,
                  borderColor: '#6d5545',
                  borderTopLeftRadius: '42%',
                  borderTopRightRadius: '48%',
                  borderBottomRightRadius: '45%',
                  borderBottomLeftRadius: '50%',
                  backgroundColor: ['#b8d8ca', '#e8bdc5', '#efd78a'][i],
                }}
              >
                <Text style={obsFont(8, 1.25, '#6d5545', '800')}>{stamps[i]}</Text>
              </View>
              <View style={{ flex: 1, rowGap: 1 }}>
                <Text style={obsFont(8, 1.25, INK, '900')}>{letter[0]}</Text>
                <Text numberOfLines={1} style={obsFont(8, 1.25, '#5f5148', '800')}>
                  {letter[1]}
                </Text>
              </View>
              <Text
                style={[
                  obsFont(6, 1.25, '#9b8878', '800'),
                  { alignSelf: 'flex-start', paddingTop: 2 },
                ]}
              >
                {letter[2]}
              </Text>
            </View>
            <View
              style={{
                width: 11,
                height: 3,
                marginTop: 10,
                marginLeft: 8,
                borderRadius: 99,
                backgroundColor: exact('#7f624f55'),
              }}
            />
          </Pressable>
        ))}
      </View>
      <Selection
        title={concept.items[selected][1]}
        note={note}
        size={11}
        noteSize={7}
        style={{
          marginHorizontal: 2,
          marginBottom: 8,
          paddingLeft: 7,
          borderLeftWidth: 2,
          borderLeftColor: '#c39067',
        }}
      />
      <View
        style={{
          rowGap: 3,
          paddingVertical: 8,
          paddingHorizontal: 10,
          borderWidth: 1.5,
          borderStyle: 'dashed',
          borderColor: '#b58f6b',
          borderRadius: 6,
          backgroundColor: '#fffaf0',
        }}
      >
        <Text style={obsFont(7, 1.6, '#9d755b')}>우리 섬 모두에게</Text>
        <Text style={{ fontFamily: GOWUN, fontSize: 10, lineHeight: lh(10 * 1.35), color: INK }}>
          오늘도 같이 집중할래?
        </Text>
      </View>
      <Stamp
        label={sent ? '모두에게 남겼어요 ✓' : '편지 남기기'}
        background={sent ? '#a9d9c2' : '#f1c46f'}
        onPress={() => {
          setSent(true);
          showToast('소다 섬 주민 모두에게 편지를 남겼어요');
        }}
      />
    </Animated.View>
  );
}

function FriendMail({ concept, reduceMotion, showToast }: ArtifactProps) {
  const [selected, setSelected] = useState(0);
  const [sent, setSent] = useState(false);
  const [reactTransform, react] = useReact(reduceMotion);
  const item = concept.items[selected];
  // .letter-sent .writing-paper: transition .45s 로 접혀 사라진다
  const fold = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!sent) return;
    if (reduceMotion) fold.setValue(1);
    else
      Animated.timing(fold, {
        toValue: 1,
        duration: 450,
        easing: ease,
        useNativeDriver: false,
      }).start();
  }, [sent, reduceMotion, fold]);
  const folded = (outputRange: any[]) => fold.interpolate({ inputRange: [0, 1], outputRange });
  return (
    <Animated.View
      style={{
        padding: 13,
        borderWidth: 1.5,
        borderColor: '#633a2e',
        borderRadius: 10,
        backgroundColor: '#b7784e',
        boxShadow: 'inset 0 0 0 3px #d9a36e,0 7px 16px #43251a66',
        transform: reactTransform,
      }}
    >
      <View style={{ marginBottom: 9, paddingHorizontal: 3 }}>
        <ObsTag label="한 친구에게" color="#5d463a" />
        <View style={{ flexDirection: 'row', alignItems: 'flex-end' }}>
          <Text
            style={{
              flex: 1,
              fontFamily: GOWUN,
              fontSize: 16,
              lineHeight: lh(16 * 1.15),
              color: '#fff5df',
            }}
          >
            친구 편지
          </Text>
          <Text style={obsFont(7, 1.6, '#f3ddc4')}>실시간 대화가 아닌 편지예요</Text>
        </View>
      </View>
      {/* 원본 margin-top 9px은 위 제목의 margin-bottom 9px과 겹친다 */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'flex-end',
          columnGap: 6,
          marginBottom: 8,
          paddingTop: 8,
          paddingHorizontal: 7,
          borderRadius: 7,
          backgroundColor: '#6c432f',
          opacity: sent ? 0.45 : 1,
        }}
      >
        {concept.items.map((friend, i) => (
          <Pressable
            key={friend[0]}
            testID={`choice-${i}`}
            onPress={() => {
              setSelected(i);
              react();
              showToast(`${friend[0]} 선택`);
            }}
            style={[
              {
                flex: 1,
                minHeight: 58,
                paddingTop: 25,
                paddingHorizontal: 4,
                paddingBottom: 5,
                justifyContent: 'center',
                borderWidth: 1.5,
                borderColor: '#5f4032',
                borderTopLeftRadius: 4,
                borderTopRightRadius: 4,
                borderBottomLeftRadius: 1,
                borderBottomRightRadius: 1,
                backgroundColor: ['#f0dca9', '#bfdde0', '#edbec5'][i],
                boxShadow: 'inset 0 -8px #c58f68,0 2px 0 #4d2e22',
              },
              selected === i && {
                transform: [{ translateY: -5 }],
                outlineWidth: 2,
                outlineStyle: 'solid',
                outlineColor: '#fff2c7',
                outlineOffset: -4,
              },
            ]}
          >
            <View
              style={[
                { position: 'absolute', left: 6, right: 6, top: 6, height: 22 },
                gradient(
                  'linear-gradient(145deg,transparent 49%,#d2b878 50%),linear-gradient(215deg,transparent 49%,#ead69f 50%)',
                ),
              ]}
            />
            <ChoiceLabel label={friend[0]} />
          </Pressable>
        ))}
      </View>
      <Selection
        title={item[1]}
        note={item[2]}
        size={11}
        noteSize={7}
        color="#fff8e8"
        noteColor="#f1d6c1"
        style={{ marginHorizontal: 4, marginBottom: 7 }}
      />
      <Animated.View
        style={[
          // transform이 있는 편지지는 뒤의 버튼보다 나중에 그려져 그림자가 버튼 윗변에 얹힌다
          {
            zIndex: 1,
            minHeight: 118,
            paddingTop: 12,
            paddingHorizontal: 12,
            paddingBottom: 10,
            borderWidth: 1,
            borderColor: '#b68d68',
            boxShadow: '0 3px 5px #4d291e3d',
            opacity: folded([1, 0]),
            transform: [
              { translateY: folded([0, -45]) },
              { scale: folded([1, 0.55]) },
              { rotate: folded(['-1deg', '8deg']) },
            ],
          },
          webOnly({ backgroundImage: 'repeating-linear-gradient(#fff9e9 0 19px,#eadbc2 20px)' }),
          Platform.OS !== 'web' && { backgroundColor: '#fff9e9' },
        ]}
      >
        {/* 가상 요소라 content-box: 25×29에 테두리가 더해진다 */}
        <View
          style={{
            position: 'absolute',
            right: 10,
            top: 9,
            width: 27,
            height: 31,
            borderWidth: 1,
            borderStyle: 'dashed',
            borderColor: '#ba6c62',
            backgroundColor: '#e7a097',
          }}
        />
        {/* span은 부모 줄 상자(15px/1.6) 안의 inline이라 바깥 Text가 그 줄 높이를 만든다 */}
        <Text style={obsFont(15, 1.6)}>
          <Text style={{ fontSize: 8, lineHeight: lh(8 * 1.6), letterSpacing: 0.48 }}>
            TO. <Text style={{ fontWeight: '700' }}>{item[0]}</Text>
          </Text>
        </Text>
        <Text
          style={{
            marginTop: 14,
            marginBottom: 10,
            fontFamily: GOWUN,
            fontSize: 10,
            lineHeight: lh(10 * 1.8),
            color: INK,
          }}
        >
          {'섬에 새 꽃이 피었어.\n다음에 놀러 와서 같이 보자.'}
        </Text>
        <Text style={[obsFont(7, 1.6), { textAlign: 'right' }]}>FROM. 나</Text>
      </Animated.View>
      <Stamp
        label={sent ? '우체통에 넣었어요 ✓' : '접어서 편지 보내기'}
        background={sent ? '#a9d9c2' : '#f1c46f'}
        onPress={() => {
          setSent(true);
          showToast(`${item[0]}에게 편지를 보냈어요`);
        }}
      />
    </Animated.View>
  );
}

const observatoryMailArtifacts: Record<string, ArtifactRenderer> = {
  'observatory-desk': ObservatoryDesk,
  'island-ranking': IslandRanking,
  'old-map': OldMap,
  'mail-home': MailHome,
  'island-room': IslandRoom,
  'friend-mail': FriendMail,
};

// ───────────── 상점·축음기 ─────────────

// 상점·축음기 기능 화면: tryon · counter · themes · records · player · catalog
// 원본 app.js artifactMarkup · handleChoice · data-control(play/stamp) 과 style.css 상점/축음기 규칙을 옮겼다.

const PINK = '#f4a7bb';
const SHOP_SKY = '#a9d9e7';
const controlCopy: Record<string, string> = {
  counter: '종 울려 구매하기',
  records: '바늘 내리기',
  player: '재생',
  catalog: '30초 미리듣기',
};

// .object-choice 기본값 위에 건물별 규칙 (.tryon-mirror/.record-player/.record-crate/.album-catalog .object-choice)
const choiceBox: Record<string, ViewStyle> = {
  tryon: { minHeight: 31 },
  player: { minHeight: 29, paddingTop: 4, paddingBottom: 4, paddingHorizontal: 4 },
  records: { minHeight: 69, paddingTop: 30, borderRadius: 4 },
  catalog: { minHeight: 76, paddingTop: 40 },
};

function ShopGramArtifact({ concept, reduceMotion, showToast }: ArtifactProps) {
  const kind = concept.kind;
  const [selected, setSelected] = useState(0);
  // 진열대 .stamped · 축음기 .is-playing (null = 아직 안 눌러서 처음 문구)
  const [on, setOn] = useState<boolean | null>(null);
  const react = useRef(new Animated.Value(0)).current;
  const spin = useRef(new Animated.Value(0)).current;
  const spinning = kind === 'player' && !!on && !reduceMotion;

  // .is-playing .vinyl { animation: spin 2.3s linear infinite }
  useEffect(() => {
    if (!spinning) return;
    const loop = Animated.loop(
      Animated.timing(spin, {
        toValue: 1,
        duration: 2300,
        easing: Easing.linear,
        useNativeDriver: false,
      }),
    );
    loop.start();
    return () => {
      loop.stop();
      spin.setValue(0);
    };
  }, [spinning, spin]);

  const choose = (i: number) => {
    setSelected(i);
    // .artifact.reacting { animation: object-react .42s ease } · 45%에서 scale(1.025) rotate(-.5deg)
    if (!reduceMotion) {
      react.setValue(0);
      Animated.sequence([
        Animated.timing(react, { toValue: 1, duration: 189, easing: ease, useNativeDriver: false }),
        Animated.timing(react, { toValue: 0, duration: 231, easing: ease, useNativeDriver: false }),
      ]).start();
    }
    showToast(`${concept.items[i][0]} 선택`);
  };

  const toggle = () => {
    const next = !on;
    setOn(next);
    showToast(
      kind === 'counter'
        ? '종이에 도장을 꾹 찍었어요'
        : next
          ? '모닥불 주변에 음악이 흘러요'
          : '음악을 잠시 멈췄어요',
    );
  };

  const side = kind === 'tryon' || kind === 'player'; // grid 2단: 그림 | 글
  const center = kind === 'themes'; // .theme-dome { text-align:center }
  const color = kind === 'catalog' ? '#fffaf0' : INK; // .album-catalog { color:#fffaf0 } 는 태그·제목·버튼 글자까지 물려받는다
  const item = concept.items[selected];
  const control = controlCopy[kind];
  const controlLabel =
    on === null
      ? control
      : kind === 'counter'
        ? on
          ? '도장 완료 ✓'
          : '다시 확인'
        : on
          ? '잠시 멈추기'
          : '다시 재생';

  const looks: Record<string, ViewStyle> = {
    tryon: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      borderWidth: 7,
      borderColor: '#b57a46',
      borderTopLeftRadius: '45%',
      borderTopRightRadius: '45%',
      borderBottomLeftRadius: 14,
      borderBottomRightRadius: 14,
      backgroundColor: exact('#d8ebdcdd'),
      boxShadow: 'inset 0 0 0 3px #f0ca83,0 6px 14px #3b291c55',
    },
    counter: {
      borderTopLeftRadius: 60,
      borderTopRightRadius: 60,
      borderBottomLeftRadius: 10,
      borderBottomRightRadius: 10,
      backgroundColor: '#b97c49',
      boxShadow: 'inset 0 3px #e4b477,0 7px 14px #3b291c55',
    },
    themes: {
      borderWidth: 6,
      borderColor: '#b77949',
      borderTopLeftRadius: '50%',
      borderTopRightRadius: '50%',
      borderBottomLeftRadius: 14,
      borderBottomRightRadius: 14,
      backgroundColor: exact('#d8ebdcdd'),
    },
    records: {
      borderWidth: 6,
      borderRadius: 7,
      backgroundColor: '#ad7348',
      boxShadow: 'inset 0 0 0 2px #ddaa73,0 7px 14px #3b291c66',
    },
    player: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 9,
      borderRadius: 10,
      backgroundColor: '#9c6440',
      boxShadow: 'inset 0 0 0 4px #cd9160,0 7px 14px #3b291c66',
    },
    catalog: {
      borderRadius: 12,
      backgroundColor: '#6f4f3d',
      boxShadow: 'inset 0 0 0 4px #ad7954,0 7px 14px #3b291c66',
    },
  };

  const body = (
    <>
      {/* .artifact-tag: inline-block이라 부모 줄(15px/24px) 안에서 위로 7px 내려앉는다 */}
      <View
        style={{
          alignSelf: center ? 'center' : 'flex-start',
          marginVertical: 7,
          paddingVertical: 2,
          paddingHorizontal: 8,
          borderWidth: 1,
          borderColor: '#7f624f',
          borderRadius: 99,
          backgroundColor: '#fff8e9',
        }}
      >
        <Text
          style={{
            fontFamily: BODY_FONT,
            fontSize: 7,
            lineHeight: lh(7 * 1.6),
            fontWeight: '800',
            letterSpacing: 0.7,
            color,
          }}
        >
          {kindCopy[kind]}
        </Text>
      </View>
      <View style={{ gap: 1, marginBottom: 9 }}>
        <Text
          testID="selection-title"
          style={{
            fontFamily: GOWUN,
            fontSize: side ? 13 : 16,
            lineHeight: lh(side ? 13 * 1.25 : 16 * 1.25),
            color,
            textAlign: center ? 'center' : undefined,
          }}
        >
          {item[1]}
        </Text>
        <Text
          testID="selection-note"
          style={{
            fontFamily: BODY_FONT,
            fontSize: 8,
            lineHeight: lh(8 * 1.4),
            color: kind === 'catalog' ? '#e8d8c9' : '#79685d',
            textAlign: center ? 'center' : undefined,
          }}
        >
          {item[2]}
        </Text>
      </View>
      {kind === 'counter' && (
        // .product-stage (margin-top -5px는 위 margin 9px과 겹쳐 4px이 된다 · flex에서도 합이 같다)
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'flex-end',
            justifyContent: 'center',
            gap: 18,
            height: 54,
            marginTop: -5,
          }}
        >
          {['#f3d590', SHOP_SKY, '#edbcc5'].map((c, i) => (
            <View
              key={c}
              style={{
                width: 35,
                height: i === 1 ? 42 : 30,
                borderWidth: 2,
                borderColor: '#76543e',
                borderTopLeftRadius: '50%',
                borderTopRightRadius: '50%',
                borderBottomLeftRadius: 9,
                borderBottomRightRadius: 9,
                backgroundColor: c,
              }}
            />
          ))}
        </View>
      )}
      {kind === 'themes' && (
        // .glass-dome
        <View
          style={[
            {
              alignSelf: 'center',
              width: 112,
              height: 78,
              marginTop: -1,
              marginBottom: 8,
              borderWidth: 3,
              borderColor: exact('#eaf7eccc'),
              borderTopLeftRadius: 60,
              borderTopRightRadius: 60,
              borderBottomLeftRadius: 15,
              borderBottomRightRadius: 15,
              backgroundColor: exact('#9cd7df55'),
              boxShadow: 'inset 0 -9px #70b6c4',
            },
            gradient('linear-gradient(145deg,#fff8 0 12%,transparent 13%)'),
          ]}
        >
          <View
            style={{
              position: 'absolute',
              left: 23,
              right: 23,
              bottom: 10,
              height: 26,
              borderRadius: '50%',
              backgroundColor: '#85ad6f',
            }}
          />
          {Platform.OS === 'web' ? (
            <View
              style={[
                {
                  position: 'absolute',
                  left: 48,
                  bottom: 29,
                  width: 16,
                  height: 28,
                  backgroundColor: '#608e59',
                },
                webOnly({ clipPath: 'polygon(45% 0,70% 50%,100% 100%,0 100%,28% 50%)' }),
              ]}
            />
          ) : (
            <Svg width={16} height={28} style={{ position: 'absolute', left: 48, bottom: 29 }}>
              <Polygon points="7.2,0 11.2,14 16,28 0,28 4.48,14" fill="#608e59" />
            </Svg>
          )}
        </View>
      )}
      <View style={{ flexDirection: side ? 'column' : 'row', gap: 6 }}>
        {concept.items.map((choice, i) => (
          <Pressable
            key={choice[0]}
            testID={`choice-${i}`}
            accessibilityRole="button"
            accessibilityState={{ selected: i === selected }}
            onPress={() => choose(i)}
            style={[
              {
                flex: side ? undefined : 1,
                minHeight: 40,
                paddingTop: 7,
                paddingBottom: 7,
                paddingHorizontal: 3,
                justifyContent: 'center',
                borderWidth: 1.5,
                borderColor: OUTLINE,
                borderRadius: 8,
                boxShadow: `0 2px 0 ${OUTLINE}`,
              },
              choiceBox[kind],
              // 레코드 상자·음원 상자는 뒤에 오는 규칙이 눌림 분홍 배경을 덮는다
              {
                backgroundColor:
                  kind === 'records'
                    ? '#ead39f'
                    : kind === 'catalog'
                      ? ['#e6c58f', '#abcfc5', '#a9bedb'][i]
                      : i === selected
                        ? PINK
                        : '#fffaf0',
              },
              i === selected && { transform: [{ translateY: -3 }] },
            ]}
          >
            {(kind === 'records' || kind === 'catalog') && (
              // .object-choice::before 레코드판
              <View
                style={[
                  {
                    position: 'absolute',
                    left: '50%',
                    top: 7,
                    width: 30,
                    height: 30,
                    borderRadius: 15,
                    transform: [{ translateX: '-50%' }],
                  },
                  gradient(
                    `radial-gradient(circle,${kind === 'records' ? ['#e89c7d', '#9dcfbb', '#8fbad5'][i] : '#e89c7d'} 0 4px,#26211f 5px 14px,#4b443e 15px)`,
                  ),
                ]}
              />
            )}
            <Text
              style={{
                fontFamily: BODY_FONT,
                fontSize: 8,
                lineHeight: lh(8 * 1.25),
                fontWeight: '800',
                color: INK,
                textAlign: 'center',
              }}
            >
              {choice[0]}
            </Text>
            <View
              style={{
                alignSelf: 'center',
                width: 11,
                height: 3,
                marginTop: 4,
                borderRadius: 99,
                backgroundColor: exact('#7f624f55'),
              }}
            />
          </Pressable>
        ))}
      </View>
      {control && (
        <Pressable
          testID="artifact-control"
          accessibilityRole="button"
          onPress={toggle}
          style={{
            minHeight: 34,
            marginTop: 9,
            paddingVertical: 6,
            paddingHorizontal: 10,
            justifyContent: 'center',
            borderWidth: 1.5,
            borderColor: OUTLINE,
            borderRadius: 9,
            backgroundColor: on ? SHOP_SKY : PINK,
            boxShadow: `0 2px 0 ${OUTLINE}`,
          }}
        >
          <Text
            style={{
              fontFamily: BODY_FONT,
              fontSize: 9,
              lineHeight: lh(9 * 1.6),
              fontWeight: '800',
              color,
              textAlign: 'center',
            }}
          >
            {controlLabel}
          </Text>
        </Pressable>
      )}
    </>
  );

  return (
    <Animated.View
      testID="artifact"
      style={[
        { padding: 14, borderWidth: 1.5, borderColor: OUTLINE, boxShadow: '0 5px 12px #3e291d42' },
        looks[kind],
        !reduceMotion && {
          transform: [
            { scale: react.interpolate({ inputRange: [0, 1], outputRange: [1, 1.025] }) },
            { rotate: react.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '-0.5deg'] }) },
          ],
        },
      ]}
    >
      {kind === 'tryon' &&
        (Platform.OS === 'web' ? (
          // 웹은 원본 <img>와 같은 결과가 나오게 CSS 배경으로 그린다
          <View
            accessibilityLabel="검은 고양이 미리보기"
            style={[
              { width: '35%', aspectRatio: 1 },
              webOnly({
                backgroundImage: `url("${assetUri(interiorArt.catBlack)}")`,
                backgroundSize: '100% 100%',
                filter: 'drop-shadow(0 5px 3px #51372b44)',
              }),
            ]}
          />
        ) : (
          <Image
            accessibilityLabel="검은 고양이 미리보기"
            source={interiorArt.catBlack}
            style={{ width: '35%', aspectRatio: 1 }}
          />
        ))}
      {kind === 'player' && (
        // .vinyl: 네이티브는 repeating-radial-gradient가 없어 단색으로 대신한다
        <Animated.View
          style={[
            { width: '42%', aspectRatio: 1, borderRadius: '50%', boxShadow: '0 4px 4px #34221866' },
            webOnly({
              backgroundImage: 'repeating-radial-gradient(circle,#24211f 0 3px,#3a3631 4px 6px)',
            }) ?? { backgroundColor: '#2f2b28' },
            spinning && {
              transform: [
                {
                  rotate: spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }),
                },
              ],
            },
          ]}
        >
          <View
            style={{
              position: 'absolute',
              left: '38%',
              right: '38%',
              top: '38%',
              bottom: '38%',
              borderRadius: '50%',
              backgroundColor: PINK,
            }}
          />
        </Animated.View>
      )}
      {side ? <View style={{ flex: 1 }}>{body}</View> : body}
    </Animated.View>
  );
}

const shopGramArtifacts: Record<string, ArtifactRenderer> = {
  tryon: ShopGramArtifact,
  counter: ShopGramArtifact,
  themes: ShopGramArtifact,
  records: ShopGramArtifact,
  player: ShopGramArtifact,
  catalog: ShopGramArtifact,
};

const artifacts: Record<string, ArtifactRenderer> = {
  ...hallArtifacts,
  ...boardArtifacts,
  ...observatoryMailArtifacts,
  ...shopGramArtifacts,
};
