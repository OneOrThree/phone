import React, { useEffect, useMemo, useRef, useState } from 'react';
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
import { useAppLayout } from '@/utils/layout';
import {
  Building,
  Route,
  State,
  balance,
  buildMinutes,
  buildingCost,
  buildingNames,
  buildingReady,
  buildingShare,
  canSendLetter,
  clockMinutes,
  clockText,
  collectedBy,
  currentIsland,
  dayKey,
  isHost,
  isOwnComment,
  kstDayStart,
  newChatCount,
  questMemberRate,
  residentCount,
  targetIds,
  unreadLetters,
  viewIsland,
} from '@/services/model';
import { ApiError, CLIENT_STALE_SESSION } from '@/services/api/client';
import { semanticTokens } from '@/design-system/tokens';
import { HOME_QUEST_LIST_DETAIL } from '@/screens/island/HomeQuestIndicator';
import { useBoardNotices } from './useBoardNotices';

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
  // 앱 라우트 문맥(App.tsx의 e). 있으면 목업 대신 앱 상태를 그리고 라우트로 이동한다
  e?: any;
  // 배경 장면을 맞출 높이. 키보드로 화면이 줄어도 창 높이 기준으로 고정한다 (없으면 height)
  sceneHeight?: number;
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
    detail: require('@/assets/interiors/ui/board-sheet-notice-detail-v3.png'),
    quest: require('@/assets/interiors/ui/board-sheet-quest-v2.png'),
  },
  blueprintReadyStamp: require('@/assets/interiors/ui/blueprint-ready-stamp-v3.png'),
  letterEnvelope: require('@/assets/interiors/ui/letter-envelope-v1.png'),
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
  'island-room': '섬 채팅방',
  'received-letters': '받은 편지',
  'letter-detail': '편지 상세',
  'friend-select': '친구 선택',
  'friend-compose': '편지 쓰기',
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

const mailHomeItems: Item[] = [
  ['우리 섬 채팅방', '주민 모두의 대화', '새 글 7개'],
  ['받은 편지', '친구가 보낸 봉투', '새 편지 3통'],
  ['편지 쓰기', '친구 한 명에게', ''],
];

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
      board('공지 목록 · 빈 상태', 'notice', 'resident', 'empty'),
      board('공지 상세 · 방장', 'notice', 'owner', 'detail'),
      board('공지 상세 · 주민', 'notice', 'resident', 'detail'),
      board('댓글 작성 · 주민', 'notice', 'resident', 'comment'),
      board('댓글 작성 · 주민 · 입력 중', 'notice', 'resident', 'comment-input'),
      board('공지 작성 · 방장', 'notice', 'owner', 'write'),
      board('공지 작성 · 방장 · 입력 중', 'notice', 'owner', 'write-input'),
      board('공지 수정 · 방장', 'notice', 'owner', 'edit'),
      board('공지 저장 실패 · 방장', 'notice', 'owner', 'write-failed'),
      board('퀘스트 목록 · 방장', 'quest', 'owner', 'list'),
      board('퀘스트 목록 · 주민', 'quest', 'resident', 'list'),
      board('퀘스트 목록 · 빈 상태', 'quest', 'resident', 'empty'),
      board('퀘스트 상세 · 시간대 집중', 'quest', 'resident', 'detail-focus'),
      board('퀘스트 상세 · 스크린타임', 'quest', 'resident', 'detail-phone'),
      board('스크린타임 · 측정 전', 'quest', 'resident', 'detail-unknown'),
      board('퀘스트 만들기 · 시간대 집중', 'quest', 'owner', 'write-focus'),
      board('퀘스트 만들기 · 시간대 집중 · 입력 중', 'quest', 'owner', 'write-focus-input'),
      board('퀘스트 만들기 · 스크린타임', 'quest', 'owner', 'write-phone'),
      board('퀘스트 만들기 · 스크린타임 · 입력 중', 'quest', 'owner', 'write-phone-input'),
      board('청사진 · 준비 중', 'blueprint', 'owner', 'waiting'),
      board('청사진 · 방장 건설 가능', 'blueprint', 'owner', 'ready'),
      board('청사진 · 주민 대기', 'blueprint', 'resident', 'ready'),
      board('청사진 · 공사 중', 'blueprint', 'owner', 'building'),
      board('청사진 · 완공', 'blueprint', 'owner', 'complete'),
      board('게시판 · 다른 섬 방문자', 'notice', 'resident', 'visitor'),
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
      { title: '열린 우체통', kind: 'mail-home', position: 'bottom', items: mailHomeItems },
      { title: '우리 섬 채팅방', kind: 'island-room', position: 'bottom', items: mailHomeItems },
      { title: '받은 편지함', kind: 'received-letters', position: 'middle', items: mailHomeItems },
      { title: '받은 편지 상세', kind: 'letter-detail', position: 'middle', items: mailHomeItems },
      {
        title: '편지 보낼 친구 선택',
        kind: 'friend-select',
        position: 'middle',
        items: mailHomeItems,
      },
      {
        title: '친구에게 편지 쓰기',
        kind: 'friend-compose',
        position: 'middle',
        items: mailHomeItems,
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
const MAIL_LAND = { left: 338, right: 36 };
// 2:3 배경 장면을 화면에 cover로 깔고 세로 38% 지점에 맞춘다 (세로 화면은 높이에 딱 맞아 위아래 여백이 없다)
export const interiorScene = (width: number, height: number) => {
  const w = Math.max(width, (height * artSize.background[0]) / artSize.background[1]),
    h = (w * artSize.background[1]) / artSize.background[0];
  return { left: (width - w) / 2, top: (height - h) * 0.38, width: w, height: h };
};

export function InteriorScreen({
  buildingIndex,
  conceptIndex,
  width,
  height,
  reduceMotion = false,
  hideArtifact = false,
  e,
  insets,
  sceneHeight = height,
}: {
  buildingIndex: number;
  conceptIndex: number;
  width: number;
  height: number;
  reduceMotion?: boolean;
  hideArtifact?: boolean;
  e?: any;
  insets?: { top: number; left: number };
  sceneHeight?: number;
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
  // 핫스폿은 시안 구경용이라 앱 화면에서는 끈다
  const hotspot = e || building.id === 'board' ? undefined : hotspotAt[concept.kind];
  const Artifact = artifacts[concept.kind];
  const modeLabel =
    isHall || building.id === 'board' || building.id === 'mail'
      ? ''
      : `${String.fromCharCode(65 + conceptIndex)}안 · ${kindCopy[concept.kind]} 중심`;
  // 가로 우체통은 편지·채팅 종이를 오른쪽 열(폭 500)에 둔다
  const side = building.id === 'mail' && width > sceneHeight ? MAIL_LAND : { left: 14, right: 14 };
  const wrap =
    concept.position === 'scene'
      ? fill
      : concept.position === 'bottom'
        ? { ...side, bottom: building.id === 'mail' ? 8 : 22 }
        : building.id === 'mail'
          ? // 가운데에 두되, 화면보다 긴 편지는 위 12에 붙이고 아래로 넘친다
            wrapHeight
            ? { ...side, top: Math.max(12, (height - wrapHeight) / 2) }
            : { ...side, top: '50%' as const, transform: [{ translateY: '-50%' }] }
          : { left: 14, right: 14, top: '23%' as const };
  const screenGradient =
    'linear-gradient(180deg,#37271d12 0%,transparent 24%,transparent 70%,#37271d0c 100%)';
  // 게시판·우체통은 가로에서도 장면이 이어지게 cover로 깐다. 나머지는 원본 background-size:auto 100%
  const coverScene = building.id === 'board' || building.id === 'mail';
  const bg = coverScene
    ? interiorScene(width, sceneHeight)
    : {
        left: (width - (height * artSize.background[0]) / artSize.background[1]) / 2,
        top: 0,
        width: (height * artSize.background[0]) / artSize.background[1],
        height,
      };
  // 앱에서는 가짜 상태 표시줄을 빼고, 안전 영역보다 너무 위로 올라가지 않게 뒤로 가기·간판을 내린다
  const chromeTop = Math.max(0, (insets?.top ?? 0) - 52),
    chromeLeft = Math.max(0, (insets?.left ?? 0) - 52);

  return (
    <View
      testID="interiors-screen"
      style={[
        { width, height, overflow: 'hidden' },
        // 웹은 원본과 같은 CSS 배경으로 깔아야 그림 확대 결과가 픽셀까지 같다
        webOnly({
          backgroundImage: `${screenGradient},url("${assetUri(building.background)}")`,
          // 키보드로 높이가 줄면 창 높이로 계산한 위치에 그대로 둔다
          backgroundSize:
            sceneHeight !== height
              ? `100% 100%,${bg.width}px ${bg.height}px`
              : coverScene
                ? 'cover'
                : 'auto 100%',
          backgroundPosition:
            sceneHeight !== height
              ? `0 0,${bg.left}px ${bg.top}px`
              : coverScene
                ? 'center 38%'
                : ['hall', 'observatory'].includes(building.id)
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
            style={{ position: 'absolute', ...bg }}
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
      {!e && (
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
      )}
      <Pressable
        testID="scene-back"
        accessibilityLabel="섬으로 돌아가기"
        onPress={() => (e ? e.home() : showToast('섬으로 돌아가는 전환이 이어집니다'))}
        style={{
          position: 'absolute',
          zIndex: 12,
          left: 14 + chromeLeft,
          top: 36 + chromeTop,
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
      {/* 가로에서 키보드가 올라와 화면이 아주 낮아지면 간판이 입력 종이를 가리지 않게 뺀다 */}
      {height >= 260 && (
        <View
          testID="place-sign"
          style={[
            {
              position: 'absolute',
              zIndex: 9,
              left: '50%',
              top: 43 + chromeTop,
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
      )}
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
        (concept.kind === 'village-ledger' ||
          concept.kind === 'island-management' ||
          (building.id === 'mail' && conceptIndex >= 2)) && (
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
          onLayout={(event) => setWrapHeight(event.nativeEvent.layout.height)}
          style={[
            { position: 'absolute', zIndex: 7, ...wrap },
            hotspot ? (peekStyle as any) : undefined,
          ]}
        >
          <Artifact
            building={building}
            concept={concept}
            index={conceptIndex}
            width={width}
            height={height}
            reduceMotion={reduceMotion}
            showToast={showToast}
            e={e}
            sceneHeight={sceneHeight}
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

// 앱 라우트에서 게시판(board·notice·noticeEdit·quest·questEdit)과
// 우체통(mail·chat·friendMail)을 건물 안 장면으로 그린다. 크기는 실제 화면(키보드로 줄어든 높이 포함)을 따른다
export function InteriorRoute({ e }: { e: any }) {
  const [fontsLoaded, fontError] = useInteriorFonts();
  const layout = useAppLayout();
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const r: Route = e.route;
  const mail = r === 'mail' || r === 'chat' || r === 'friendMail';
  const friend = (e.state as State).friends?.some(
    (f) => f.id === e.detail && f.status === 'friend',
  );
  // 우체통 시안 번호: 0 열린 우체통 · 1 채팅방 · 2 받은 편지 · 3 편지 상세 · 4 친구 선택 · 5 편지 쓰기
  const conceptIndex = !mail
    ? 0
    : r === 'chat'
      ? 1
      : r === 'friendMail'
        ? friend
          ? 5
          : 4
        : e.detail
          ? 3
          : e.tab === '받은 편지'
            ? 2
            : 0;
  const width = size?.width ?? layout.width,
    height = size?.height ?? layout.height;
  // 우체통은 316×686 폰 시안 크기로 그린 뒤 더 큰 화면에서는 통째로 키운다 (작아지지는 않는다)
  // 배율은 창 크기로 정해 키보드가 올라와 높이가 줄어도 글자 크기가 바뀌지 않게 한다
  const k = mail ? Math.max(1, Math.min(layout.width / 316, layout.height / 686)) : 1;
  return (
    <View
      style={{ flex: 1, overflow: 'hidden' }}
      onLayout={(event) => {
        const { width: w, height: h } = event.nativeEvent.layout;
        setSize({ width: w, height: h });
      }}
    >
      {/* 글꼴을 못 불러와도 기본 글꼴로 계속 그린다 */}
      {(fontsLoaded || fontError) && (
        <View style={{ transformOrigin: 'left top', transform: [{ scale: k }] }}>
          <InteriorScreen
            buildingIndex={mail ? 3 : 1}
            conceptIndex={conceptIndex}
            width={width / k}
            height={height / k}
            reduceMotion={e.state.settings.reduceMotion}
            e={e}
            insets={{ top: layout.insets.top / k, left: layout.insets.left / k }}
            sceneHeight={Math.max(height, layout.height) / k}
          />
        </View>
      )}
    </View>
  );
}

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
type QuestType = 'focus' | 'phone';
type Quest = {
  title: string;
  type: QuestType;
  startTime?: string;
  endTime?: string;
  target: number;
  rate: number;
};
// 화면이 그리는 모양. 목업(Notice·Quest)과 앱 상태(e) 둘 다 이 모양으로 바꿔 넘긴다
type NoticeView = {
  id: string;
  title: string;
  time: string;
  body: string;
  comments: { id: string; name: string; text: string; mine: boolean }[];
  // 서버 목록 계약의 댓글 수 — 목록엔 댓글 본문이 없어 이 수를 그린다 (상세 GET 이 댓글을 준다)
  commentCount?: number;
};
// rate가 null이면 아직 측정하지 못한 값이다 (0%로 그리지 않는다)
// 서버 회차 필드(claimable·claimed·보상)는 서버 경로에서만 채운다 — 목업·로컬은 비어 있다.
type QuestView = Omit<Quest, 'rate'> & {
  id: string;
  /** 서버 퀘스트 정의 ID. id 는 회차별 라우트 키(occurrenceId)다. */
  questId?: string;
  rate: number | null;
  claimable?: boolean;
  claimed?: boolean;
  claimBlockedReason?: string | null;
  rewardAmount?: number;
  bonusAmount?: number;
  bonusGranted?: boolean;
};
// achieved·claimed 는 서버 회차 진행의 명시 플래그다 — rate 로 추정하지 않는다.
type ResidentRate = {
  id: string;
  name: string;
  color: Cat;
  rate: number | null;
  achieved?: boolean;
  claimed?: boolean;
};
type BlueprintView = {
  state: 'none' | 'waiting' | 'ready' | 'building' | 'complete';
  name: string;
  image: ImageSourcePropType;
  price: string;
  time: string;
  detail: string;
  collected: number;
  needed: number;
  balance: number;
  cost: number;
  progress: number;
  residents: { id: string; name: string; value: string }[];
};
type QuestForm = {
  type: QuestType;
  title: string;
  startTime: string;
  endTime: string;
  target: string;
};
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
  questForm: QuestForm | null;
  screenUnknown: boolean;
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
  {
    title: '아침 집중',
    type: 'focus',
    startTime: '07:00',
    endTime: '09:00',
    target: 25,
    rate: 100,
  },
  { title: '하루 폰 90분 이하', type: 'phone', target: 90, rate: 75 },
  { title: '저녁 집중', type: 'focus', startTime: '19:00', endTime: '22:00', target: 60, rate: 38 },
];
const RESIDENTS = [
  ['민지', 'calico'],
  ['두부', 'white'],
  ['수아', 'cream'],
] as const;
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

// 가로(874×402 시안) 배치: 게시판 종이·상세·청사진을 오른쪽 열에 둔다
const LAND = {
  // 장면 글자·청사진 누름 영역 (장면 상자 기준 비율, 874×402 정본에 맞춘 값)
  labels: {
    position: 'absolute' as const,
    left: '3.95%' as const,
    top: '9.95%' as const,
    width: '92.68%' as const,
    height: '75.06%' as const,
  },
  blueprintArea: {
    left: '59.94%' as const,
    top: '32.53%' as const,
    width: '18.58%' as const,
    height: '17.07%' as const,
  },
  drawer: { left: 324, right: 30 },
  overlay: { left: 338, right: 36, top: 28, maxHeight: '65%' as const },
  blueprint: { left: 324, right: 30 },
};

function makeState(concept: Concept): BoardState {
  const requestedView = concept.boardView || 'list';
  let view = requestedView;
  if (requestedView === 'comment-input') view = 'comment';
  if (requestedView === 'write-input') view = 'write';
  if (requestedView.startsWith('detail-')) view = 'detail';
  if (requestedView.startsWith('write-focus') || requestedView.startsWith('write-phone'))
    view = 'write';
  if (requestedView === 'empty') view = 'list';
  // 방문자 시안은 댓글 자리 안내가 보이도록 공지 상세로 연다
  if (requestedView === 'visitor') view = 'detail';
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
    questForm: null,
    screenUnknown: requestedView === 'detail-unknown',
    serial: 0,
  };
  if (['edit', 'write-failed'].includes(requestedView)) {
    state.draft = { title: NOTICES[0].title, body: NOTICES[0].body };
    state.editing = requestedView === 'edit';
  }
  if (requestedView === 'write-failed') {
    state.view = 'write';
    state.error = '저장하지 못했어요. 입력한 내용은 그대로 남아 있어요.';
  }
  if (requestedView === 'comment' || requestedView === 'comment-input')
    state.commentDraft = '수아야, 어서 와! 같이 낚시하자.';
  if (requestedView === 'write-input')
    state.draft = {
      title: '내일도 우리 같이 힘내요',
      body: '아침 집중은 각자 편한 시간에 시작해요.',
    };
  if (requestedView === 'detail-phone' || requestedView === 'detail-unknown') state.questIndex = 1;
  if (requestedView.startsWith('write-focus')) {
    state.questForm = {
      type: 'focus',
      title: '저녁 집중',
      startTime: '19:00',
      endTime: '22:00',
      target: '50',
    };
  }
  if (requestedView.startsWith('write-phone')) {
    state.questForm = {
      type: 'phone',
      title: '하루 폰 90분 이하',
      startTime: '19:00',
      endTime: '22:00',
      target: '90',
    };
  }
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
  if (Platform.OS !== 'web')
    return (
      <ScrollView style={style} keyboardShouldPersistTaps="handled">
        {children}
      </ScrollView>
    );
  return <View style={[style, webOnly({ overflowX: 'auto', overflowY: 'auto' })]}>{children}</View>;
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

// 공지 종이 위의 주요 동작은 앱 버튼 대신 잉크 도장을 찍은 것처럼 보이게 한다.
function PaperStamp({
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
      <Text style={boardFont(16, 1.2, '400', '#8d5b50', 'BoardHand-Bold')}>{label}</Text>
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

function BlueprintReadyStamp({ reduceMotion }: { reduceMotion: boolean }) {
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
      style={{
        width: 126,
        height: 126,
        opacity: impact,
        transform: [
          { scale: impact.interpolate({ inputRange: [0, 0.82, 1], outputRange: [1.65, 0.94, 1] }) },
        ],
      }}
    >
      <Picture
        source={interiorArt.blueprintReadyStamp}
        label="준비 완료 도장"
        style={{ width: '100%', height: '100%' }}
      />
    </Animated.View>
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

function QuestTimeInput({
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
  if (Platform.OS === 'web')
    return (
      <input
        data-testid={testID}
        aria-label={label}
        type="time"
        // 웹 time 입력은 HH:MM만 읽는다. "9:00"으로 저장된 예전 값도 보이게 맞춰서 넘긴다
        value={clockText(value)}
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
      />
    );
  return (
    <TextInput
      testID={testID}
      accessibilityLabel={label}
      value={value}
      onChangeText={onChange}
      onEndEditing={() => onChange(clockText(value))}
      placeholder="00:00"
      placeholderTextColor="#757575"
      keyboardType="numbers-and-punctuation"
      maxLength={5}
      style={inputStyle()}
    />
  );
}

function QuestTypeChoice({
  value,
  onChange,
}: {
  value: QuestType;
  onChange: (value: QuestType) => void;
}) {
  const options: [QuestType, string, string][] = [
    ['focus', '시간대 집중', '정한 시간 안에 집중'],
    ['phone', '하루 폰 사용', '하루 사용량 상한'],
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

// .quest-sheet-card: 목록이 펼쳐질 때 @keyframes quest-paper-open .45s cubic-bezier(.16,.8,.25,1), 1~3번째는 .12/.22/.32s 늦게
function QuestCard({
  quest,
  index,
  reduceMotion,
  onDetail,
  visitor,
}: {
  quest: QuestView;
  index: number;
  reduceMotion: boolean;
  onDetail: () => void;
  visitor?: boolean;
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
      <Text style={[boardFont(12, 1.45, '400', '#786147', GOWUN), { marginTop: 5 }]}>
        {quest.type === 'phone'
          ? `하루 폰 사용 ${quest.target}분 이하`
          : quest.startTime
            ? `${quest.startTime}–${quest.endTime} · ${quest.target}분 집중`
            : `${quest.target}분 집중`}
      </Text>
      {/* 방문자는 이 섬 퀘스트에 참여하지 않으므로 내 달성률이 없다 */}
      {!visitor && (
        <>
          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              gap: 8,
              marginVertical: 7,
            }}
          >
            <Text style={boardFont(13, 1.6, '400', '#786147')}>내 달성률</Text>
            <Text style={boardFont(13, 1.6, '700')}>
              {quest.rate == null ? '측정 전' : `${quest.rate}%`}
            </Text>
          </View>
          <Track
            rate={quest.rate ?? 0}
            color={complete ? '#7eaa71' : '#c9943f'}
            style={{ height: 5, backgroundColor: '#b99e5b33' }}
          />
          {/* 수령 상태는 서버 필드가 정본 — 수령 가능/완료를 진행률과 섞지 않는다 */}
          {(quest.claimed || quest.claimable) && (
            <Text
              style={[
                boardFont(12, 1.45, '700', semanticTokens.color.textMuted, GOWUN),
                { marginTop: 6 },
              ]}
            >
              {quest.claimed
                ? '보상 수령 완료'
                : `보상 받을 수 있어요${quest.rewardAmount != null ? ` · ${quest.rewardAmount}마리` : ''}`}
            </Text>
          )}
        </>
      )}
      <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginTop: 7 }}>
        <Link testID={`board-quest-detail-${index}`} label="자세히 보기 ›" onPress={onDetail} />
      </View>
    </Animated.View>
  );
}

// 앱 라우트의 게시판 탭 이름 ↔ 종이
const boardTabs = { notice: '공지', quest: '퀘스트', blueprint: '청사진' } as const;
// 건물 → 청사진 설명(buildOptions)과 완공 후 이동할 라우트
const blueprintOption: Partial<Record<Building, string>> = {
  library: 'library',
  tower: 'observatory',
  mail: 'mailbox',
  gram: 'gramophone',
  shop: 'shop',
};
const buildingRoute: Partial<Record<Building, Route>> = {
  library: 'library',
  tower: 'tower',
  mail: 'mail',
  gram: 'sound',
  shop: 'shop',
};
// 받침이 있으면 앞 조사, 없으면 뒤 조사 (으로/로는 ㄹ받침도 '로')
export const josa = (word: string, withFinal: string, without: string) => {
  const code = word.charCodeAt(word.length - 1) - 0xac00;
  const final = code >= 0 && code <= 11171 ? code % 28 : 0;
  return word + (final && !(without === '로' && final === 8) ? withFinal : without);
};
const minutesLabel = (m: number) => (m % 60 ? `${m}분` : `${m / 60}시간`);
// 공지 작성일: 오늘 · 어제 · M월 D일 (Asia/Seoul)
const dayLabel = (at: number | undefined, now: number) => {
  if (!at) return '';
  const diff = Math.round((kstDayStart(dayKey(now)) - kstDayStart(dayKey(at))) / 86400000);
  if (diff === 0) return '오늘';
  if (diff === 1) return '어제';
  const [, month, date] = dayKey(at).split('-').map(Number);
  return `${month}월 ${date}일`;
};
// 퀘스트 만들기 입력 검사 (목업·앱 공통)
const questError = (form: QuestForm) => {
  const target = Number(form.target);
  if (
    !form.title.trim() ||
    !Number.isInteger(target) ||
    target < 0 ||
    (form.type === 'focus' && target === 0)
  )
    return '제목과 목표 시간을 입력해주세요.';
  if (form.type === 'phone') return '';
  const start = clockMinutes(form.startTime),
    parsedEnd = clockMinutes(form.endTime),
    // 서버 LocalTime은 24:00을 받지 못해 23:59로 전송한다. 검증도 같은 창을 써야
    // UI에서는 통과하고 서버에서 QUEST_TARGET_OUT_OF_RANGE로 거절되는 차이가 없다.
    end = parsedEnd === 24 * 60 ? 23 * 60 + 59 : parsedEnd;
  if (start === null || end === null) return '시작·종료 시간을 입력해주세요.';
  if (end <= start) return '종료 시간은 시작 시간보다 늦어야 해요.';
  if (target > end - start) return '목표 집중 시간은 진행 시간 안으로 정해주세요.';
  return '';
};

// 앱 상태(e)를 게시판이 그리는 모양으로 바꾼다
function boardFromApp(e: any) {
  // 다른 섬을 구경 중이면 그 섬 게시판을 읽기 전용으로 보여 준다
  const state: State = e.state,
    i = viewIsland(state),
    now: number = e.now;
  const member = (id: string) => i.members.find((m) => m.id === id);
  const notices: NoticeView[] = i.notices.map((n) => ({
    id: n.id,
    title: n.title,
    time: dayLabel(n.at, now),
    body: n.body,
    comments: n.comments.map((c) => ({
      id: c.id,
      name: c.name,
      text: c.text,
      mine: isOwnComment(state, c),
    })),
  }));
  const quests: QuestView[] = i.quests.map((q) => ({
    id: q.id,
    title: q.title,
    type: q.type === 'screen' ? 'phone' : 'focus',
    startTime: q.windowStart,
    endTime: q.windowEnd,
    target: q.target,
    rate: questMemberRate(state, q, 'me', i.id, now),
  }));
  // 오늘 회차가 있으면 보상 판정과 같은 대상 스냅숏으로, 회차 전이면 지금 주민으로 보여 준다
  const ratesOf = (quest: QuestView): ResidentRate[] => {
    const q = i.quests.find((x) => x.id === quest.id);
    const targets = q?.rounds?.[dayKey(now)]?.targets ?? targetIds(i);
    return targets.map((id) => {
      const who = member(id) ?? i.formerMembers?.find((m) => m.id === id);
      return {
        id,
        name: id === 'me' ? `${state.name} · 나` : (who?.name ?? '떠난 주민'),
        color: id === 'me' ? state.color : (who?.color ?? 'gray'),
        rate: q ? questMemberRate(state, q, id, i.id, now) : null,
      };
    });
  };
  const goal = i.buildingQuest,
    work = i.construction,
    b = work?.building ?? goal?.building ?? i.completed?.building;
  const option = buildOptions.find((o) => o.id === (b && blueprintOption[b]));
  const share = b ? buildingShare(i, b) : 0,
    targets = goal?.targets ?? [];
  const blueprint: BlueprintView = {
    // 회관·게시판처럼 청사진 설명이 없는 건물은 보여 줄 청사진이 없다
    state: !option
      ? 'none'
      : work
        ? 'building'
        : goal
          ? buildingReady(i)
            ? 'ready'
            : 'waiting'
          : i.completed
            ? 'complete'
            : 'none',
    name: b ? buildingNames[b] : '',
    image: option?.image ?? interiorArt.buildings.library,
    price: `1인당 ${share}마리`,
    time: `공사 ${b ? minutesLabel(buildMinutes[b]) : ''}`,
    detail: option?.detail ?? '',
    collected: targets.reduce((n, id) => n + Math.min(share, Math.max(0, collectedBy(i, id))), 0),
    needed: share * targets.length,
    balance: balance(i),
    cost: b ? buildingCost(i, b) : 0,
    progress: work
      ? Math.round(
          Math.min(1, Math.max(0, (now - work.startedAt) / (work.endsAt - work.startedAt))) * 100,
        )
      : 0,
    residents: targets.map((id) => {
      const got = Math.max(0, collectedBy(i, id));
      return {
        id,
        name: id === 'me' ? state.name : (member(id)?.name ?? '탈퇴한 주민'),
        value: `${got} / ${share}마리${got >= share ? ' ✓' : ''}`,
      };
    }),
  };
  return {
    island: i,
    owner: !state.visitingIslandId && isHost(i),
    visitor: !!state.visitingIslandId,
    notices,
    quests,
    ratesOf,
    blueprint,
    building: b,
  };
}

export function Board({
  concept,
  width,
  height,
  reduceMotion,
  e,
  showToast,
  sceneHeight = height,
}: ArtifactProps) {
  const [local, setS] = useState(() => makeState(concept));
  const [mockNotices, setNotices] = useState(() =>
    concept.boardPanel === 'notice' && concept.boardView === 'empty' ? [] : NOTICES,
  );
  const [mockQuests, setQuests] = useState(() =>
    concept.boardPanel === 'quest' && concept.boardView === 'empty' ? [] : QUESTS,
  );
  // 앱 라우트에서도 화면 안에서만 잠깐 쓰는 상태: 댓글 입력 열림 · 삭제 확인 · 목표 분 · 오류
  const [ui, setUi] = useState({
    comment: false,
    confirm: null as null | { target: 'notice' | 'comment'; index: number },
    target: '',
    error: '',
  });
  // 매초 오는 now로 다시 계산하지 않게, 상태가 바뀌거나 날짜가 넘어갈 때만 계산한다
  // (집중·공사 중에는 달성률·공사 진행률이 시간에 따라 변하므로 매번 계산)
  const live = !!e && (!!e.state.session || !!viewIsland(e.state).construction);
  const app = useMemo(
    () => (e ? boardFromApp(e) : null),
    [e?.state, e ? dayKey(e.now) : '', live ? e.now : 0],
  );
  const routeKey = e ? `${e.route}/${e.detail}/${e.tab}` : '';
  useEffect(() => {
    if (!e) return;
    // 퀘스트 수정으로 들어오면 목표 분을 기존 값으로 채운다 (나머지 값은 App의 text·body·시간대)
    const editing =
      e.route === 'questEdit' && e.detail
        ? serverBoard
          ? board.quests.find((q) => q.occurrenceId === e.detail)
          : currentIsland(e.state).quests.find((q) => q.id === e.detail)
        : undefined;
    setUi((prev) => ({
      ...prev,
      comment: false,
      confirm: null,
      error: '',
      target: editing
        ? String('targetMinutes' in editing ? editing.targetMinutes : editing.target)
        : prev.target,
    }));
  }, [routeKey]);

  // e 는 App 이 렌더마다 새로 조립하고 e.back/setText/setBody 는 그 렌더의 history·초안을
  // 닫은 클로저다 — 쓰기가 끝날 때 옛 e 를 그대로 부르면 현재 화면을 엉뚱하게 바꾼다.
  // 콜백은 항상 최신 e(eRef)를 쓰고, route/detail(tab)이 바뀌면 올라가는 routeGen 으로
  // 「쓰기를 시작한 화면」인지 확인한다 — 나갔다 같은 화면으로 돌아와도 옛 작업은 무효다.
  const eRef = useRef(e);
  eRef.current = e;
  const mountedRef = useRef(false);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  const routeGen = useRef(0);
  const seenRouteKey = useRef(routeKey);
  if (e && seenRouteKey.current !== routeKey) {
    seenRouteKey.current = routeKey;
    routeGen.current += 1;
  }
  // 쓰기를 시작한 화면이 그대로면 최신 e, 아니면 null — null 이면 back/setText/창 닫기를 안 한다.
  const liveE = (gen: number) =>
    mountedRef.current && eRef.current && routeGen.current === gen ? eRef.current : null;
  // 초안·입력창·확인창 상호작용 세대 — draft/comment 입력, editor·comment·confirm 의
  // 열기/닫기마다 올라간다. routeKey 가 같아도(취소 후 다시 열기, 같은 화면에서 계속 수정)
  // 세대가 다르면 진행 중이던 쓰기의 성공 부수효과는 무효다 — 옛 작업이 새 초안을 지우거나
  // 다시 연 입력창을 닫지 않는다. 값 비교가 아니라 단조 카운터라 A→B→A 도 무효가 된다.
  const draftEpoch = useRef(0);
  // 진행 중 쓰기의 의도 페이로드 — 같은 내용의 중복 탭만 무시하고 다른 내용은 훅에 맡겨
  // 명시 거절(CLIENT_WRITE_IN_PROGRESS)시킨다. 조용히 삼키면 새 초안이 어디도 안 간다.
  const noticeInflight = useRef<string | null>(null);
  const deleteInflight = useRef<string | null>(null);
  const commentInflight = useRef<string | null>(null);
  const questInflight = useRef<string | null>(null);
  const claimInflight = useRef<string | null>(null);

  // 다른 섬 방문자: 공지·댓글·퀘스트는 읽기만 하고 청사진은 보지 않는다
  const visitor = app ? app.visitor : concept.boardView === 'visitor';
  // 라이브 앱 경로 — App.tsx 와 같은 판정으로 웹 ?review·?demo 목업을 걸러 낸다.
  // 목업에서도 e 가 있으므로 e 유무만으로는 서버 경로를 켤 수 없다.
  const liveApp =
    !!e &&
    !(
      Platform.OS === 'web' &&
      typeof window !== 'undefined' &&
      (new URLSearchParams(window.location.search).has('review') ||
        new URLSearchParams(window.location.search).has('demo'))
    );
  // 서버 게시판: 라이브 앱 라우트 + 비방문자일 때만 API 를 부른다. 방문자·목업·갤러리는 0콜이다.
  const serverBoard = liveApp && !visitor;
  const board = useBoardNotices({
    active: serverBoard,
    scopeKey: app ? String(app.island.id) : 'mock',
  });
  useEffect(() => {
    if (!serverBoard || !e || !board.islandId || !board.wallets) return;
    e.dispatch({
      type: 'SERVER_VILLAGE_POINTS',
      islandId: board.islandId,
      value: board.wallets.villagePoints,
      version: board.wallets.villagePointsVersion,
    });
  }, [
    serverBoard,
    board.islandId,
    board.wallets?.villagePoints,
    board.wallets?.villagePointsVersion,
  ]);
  // 쓰기 권한은 서버 섬 role 이 정본 — 로딩·실패 중엔 추측하지 않고 숨긴다.
  // 목업·갤러리 경로는 기존 로컬 owner 판정 그대로다.
  const owner = serverBoard
    ? board.islandRole === 'host'
    : app
      ? app.owner
      : local.role === 'owner';
  const user = owner ? OWNER : '두부';
  // 공지 상세는 라우트가 연다 — route 'notice' 의 detail id 를 따라 select 한다.
  const noticeDetailId = e && e.route === 'notice' ? e.detail : null;
  // 이 라우트 id 의 상세를 이미 요청했는지 — 요청 전 한 프레임과 「삭제로 비워진」 상태를 구분한다.
  const noticeAsked = useRef<string | null>(null);
  useEffect(() => {
    if (!serverBoard) return;
    noticeAsked.current = noticeDetailId;
    board.select(noticeDetailId).catch(() => {});
    // islandId 는 첫 getBoard 가 끝나야 생긴다 — 생기는 순간 다시 select 한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverBoard, noticeDetailId, board.islandId, board.select]);

  // 퀘스트 상세도 라우트가 연다 — 'quest' 의 detail(단, 청사진의 'building' 은 제외)을 따라 select 한다.
  const questDetailId =
    e && e.route === 'quest' && e.detail && e.detail !== 'building' ? e.detail : null;
  useEffect(() => {
    if (!serverBoard) return;
    board.selectQuest(questDetailId).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverBoard, questDetailId, board.islandId, board.selectQuest]);

  // 서버 목록 항목은 id·title·commentCount 만 온다 — 시간·본문·댓글을 합성하지 않는다.
  const serverNotices: NoticeView[] = board.items.map((n) => ({
    id: n.id,
    title: n.title,
    time: '',
    body: '',
    comments: [],
    commentCount: n.commentCount,
  }));
  // 서버 경로만 API 목록 — 방문자·목업·갤러리는 기존 로컬 공지 그대로다.
  const notices: NoticeView[] = serverBoard
    ? serverNotices
    : (app?.notices ??
      mockNotices.map((notice, i) => ({
        ...notice,
        id: String(i),
        comments: notice.comments.map(([name, text], j) => ({
          id: String(j),
          name,
          text,
          mine: name === user,
        })),
      })));
  // 서버 회차 헤더 → 화면 모양. 진행률·수령·보상은 응답 필드가 정본이다(rate===100 추정 금지).
  const serverQuests: QuestView[] = board.quests.map((q) => ({
    id: q.occurrenceId,
    questId: q.id,
    title: q.title,
    type: q.type === 'screen' ? 'phone' : 'focus',
    startTime: q.windowStart ?? undefined,
    endTime: q.windowEnd ?? undefined,
    target: q.targetMinutes,
    rate: q.myRate,
    claimable: q.claimable,
    claimed: q.claimed,
    claimBlockedReason: q.claimBlockedReason,
    rewardAmount: q.reward.amount,
    bonusAmount: q.bonusAmount,
    bonusGranted: q.bonusGranted,
  }));
  const quests: QuestView[] = serverBoard
    ? serverQuests
    : (app?.quests ?? mockQuests.map((q, i) => ({ ...q, id: String(i) })));
  const residentsOf = (quest: QuestView): ResidentRate[] => {
    // 서버 경로의 주민 목록은 progress GET 이 정본 — 응답에 털색이 없으니 중립 자리표시자다.
    if (serverBoard) {
      const open = board.questDetail?.occurrenceId === quest.id ? board.questDetail : null;
      return (open?.members ?? []).map((m) => ({
        id: m.userId,
        name: m.name ?? '주민',
        color: 'gray' as Cat,
        rate: m.rate,
        achieved: m.achieved,
        claimed: m.claimed,
      }));
    }
    return (
      app?.ratesOf(quest) ??
      RESIDENTS.map(([name, color], i) => ({
        id: name,
        name: name === user ? `${name} · 나` : name,
        color,
        rate: local.screenUnknown && quest.type === 'phone' ? null : i < 2 ? quest.rate : 48,
      }))
    );
  };
  const mockReady = local.ready && local.balance >= 60;
  const localBlueprintView: BlueprintView = app?.blueprint ?? {
    ...buildOptions[0],
    state: ['building', 'complete'].includes(local.view)
      ? (local.view as 'building' | 'complete')
      : mockReady
        ? 'ready'
        : 'waiting',
    collected: local.ready ? 60 : 50,
    needed: 60,
    balance: local.balance,
    cost: 60,
    progress: 35,
    residents: RESIDENTS.map(([name], i) => ({
      id: name,
      name,
      value: `${local.ready ? 20 : [20, 18, 12][i]} / 20마리${local.ready || i === 0 ? ' ✓' : ''}`,
    })),
  };
  const blueprintView: BlueprintView =
    serverBoard && board.wallets
      ? {
          ...localBlueprintView,
          balance: board.wallets.villagePoints,
          state:
            localBlueprintView.state === 'waiting' || localBlueprintView.state === 'ready'
              ? localBlueprintView.collected >= localBlueprintView.needed &&
                board.wallets.villagePoints >= localBlueprintView.cost
                ? 'ready'
                : 'waiting'
              : localBlueprintView.state,
        }
      : localBlueprintView;

  // 없는 공지·퀘스트 id로 상세를 열면 목록을 보여 주고 라우트도 목록으로 바꾼다
  // 서버 경로의 공지는 이 검사를 건너뛴다 — 목록은 첫 페이지뿐이라 없는 id 판정이 틀리고,
  // 진짜 없는 공지는 상세 GET 의 오류 화면이 담당한다.
  const homeQuestList = e?.route === 'quest' && e.detail === HOME_QUEST_LIST_DETAIL;
  const missing =
    !!e &&
    ((!serverBoard &&
      (e.route === 'notice' || (e.route === 'noticeEdit' && e.detail)) &&
      !notices.some((n) => n.id === e.detail)) ||
      // 서버 경로의 퀘스트도 이 검사를 건너뛴다 — 목록 로딩 중엔 모르고, 진짜 없는 회차는
      // progress GET 의 오류 화면(QUEST_GONE·404)이 담당한다.
      (!serverBoard &&
        ((e.route === 'quest' && e.detail !== 'building' && !homeQuestList) ||
          (e.route === 'questEdit' && e.detail)) &&
        !quests.some((q) => q.id === e.detail)));
  useEffect(() => {
    if (!missing) return;
    e.replace('board');
    e.setTab(e.route === 'quest' || e.route === 'questEdit' ? boardTabs.quest : boardTabs.notice);
  }, [missing]);
  // 앱 라우트 → 게시판 상태. 공지·퀘스트·청사진 종이와 상세·작성 화면은 route/detail/tab으로 정해진다
  const s: BoardState = (() => {
    if (!e) return local;
    const r = e.route,
      detail: string = e.detail;
    const routePanel: BoardState['panel'] =
      r === 'notice' || r === 'noticeEdit'
        ? 'notice'
        : r === 'questEdit' || (r === 'quest' && detail !== 'building')
          ? 'quest'
          : r === 'quest'
            ? 'blueprint'
            : ((Object.keys(boardTabs) as (keyof typeof boardTabs)[]).find(
                (k) => boardTabs[k] === e.tab,
              ) ?? '');
    const panel = visitor && routePanel === 'blueprint' ? '' : routePanel;
    const view = missing
      ? 'list'
      : ui.confirm
        ? 'confirm'
        : r === 'notice'
          ? ui.comment
            ? 'comment'
            : 'detail'
          : r === 'noticeEdit'
            ? detail
              ? 'edit'
              : 'write'
            : r === 'questEdit'
              ? 'write'
              : panel === 'quest' && r === 'quest'
                ? homeQuestList
                  ? 'list'
                  : 'detail'
                : panel === 'blueprint'
                  ? blueprintView.state
                  : 'list';
    return {
      ...local,
      role: owner ? 'owner' : 'resident',
      panel,
      view,
      noticeIndex: Math.max(
        0,
        notices.findIndex((n) => n.id === detail),
      ),
      questIndex: Math.max(
        0,
        quests.findIndex((q) => q.id === detail),
      ),
      draft: r === 'noticeEdit' ? { title: e.text, body: e.body } : null,
      commentDraft: e.text,
      error: ui.error,
      editing: (r === 'noticeEdit' || r === 'questEdit') && !!detail,
      deleteTarget: ui.confirm?.target ?? 'notice',
      commentIndex: ui.confirm?.index ?? 0,
      questForm:
        r === 'questEdit'
          ? {
              type: e.body === 'screen' ? 'phone' : 'focus',
              title: e.text,
              startTime: e.windowStart,
              endTime: e.windowEnd,
              target: ui.target,
            }
          : null,
    };
  })();
  const render = (change: Partial<BoardState>) => setS({ ...s, ...change, serial: s.serial + 1 });
  const setError = (error: string) =>
    e ? setUi((prev) => ({ ...prev, error })) : render({ error });
  const failCopy = '저장하지 못했어요. 입력한 내용은 그대로 남아 있어요.';
  // 서버 오류 message 는 그대로 띄울 수 있는 계약이다 — 아니면 기존 문구로 떨어진다.
  const apiMessage = (err: unknown, fallback = failCopy) =>
    err instanceof ApiError && err.message ? err.message : fallback;
  // stale(계정·범위 교체 중 시작된) 쓰기 오류는 새 화면에 띄우지 않는다.
  const apiWriteMessage = (err: unknown) =>
    err instanceof ApiError && err.code === CLIENT_STALE_SESSION ? '' : apiMessage(err);
  // 서버 상세 — 본문·댓글은 getNotice 만 준다. 탈퇴 작성자의 name 은 null 그대로 두고
  // (합성 금지) 댓글 삭제는 공개 API 에 없으니 mine 을 붙이지 않는다.
  const serverDetailView: NoticeView | null = board.detail
    ? {
        id: board.detail.id,
        title: board.detail.title,
        time: '',
        body: board.detail.body,
        comments: board.detail.comments.map((c) => ({
          id: c.id,
          name: c.name ?? '',
          text: c.text,
          mine: false,
        })),
      }
    : null;

  // 화면 동작. 목업은 로컬 상태를, 앱은 라우트 이동과 reducer 액션을 쓴다
  const nav = {
    open: (panel: BoardState['panel']) => {
      if (visitor && panel === 'blueprint') return;
      if (!e) {
        if (s.panel === panel) return render({ panel: '', view: 'list', error: '' });
        return render({
          panel,
          view: panel === 'blueprint' ? (s.ready ? 'ready' : 'waiting') : 'list',
          error: '',
        });
      }
      // 열린 종이를 다시 누르면 닫고, 다른 종이는 기록을 쌓지 않고 바꿔 연다
      if (s.panel === panel) return e.back();
      if (s.panel) e.replace('board');
      else e.go('board');
      if (panel) e.setTab(boardTabs[panel]);
    },
    closePanel: () => (e ? e.back() : render({ panel: '' })),
    openNotice: (index: number) =>
      e
        ? e.go('notice', notices[index].id)
        : render({ noticeIndex: index, view: 'detail', error: '' }),
    backToNotices: () => (e ? e.back() : render({ view: 'list', commentDraft: '', error: '' })),
    newNotice: () => {
      if (!owner) return;
      draftEpoch.current += 1;
      if (e) return e.go('noticeEdit');
      render({
        view: 'write',
        editing: false,
        draft: s.draft ?? { title: '', body: '' },
        error: '',
      });
    },
    editNotice: () => {
      if (!owner) return;
      // 서버 경로의 본문은 상세 GET 에 있다 — 목록 항목엔 본문이 없다.
      const notice = serverBoard ? serverDetailView : notices[s.noticeIndex];
      if (!notice) return;
      draftEpoch.current += 1;
      if (!e)
        return render({
          editing: true,
          draft: { title: notice.title, body: notice.body },
          view: 'edit',
          error: '',
        });
      e.go('noticeEdit', notice.id);
      e.setText(notice.title);
      e.setBody(notice.body);
    },
    cancelEditor: () => {
      draftEpoch.current += 1;
      return e ? e.back() : render({ view: s.editing ? 'detail' : 'list', error: '' });
    },
    setDraft: (patch: { title?: string; body?: string }) => {
      draftEpoch.current += 1;
      if (!e)
        return setS((prev) => ({
          ...prev,
          draft: { ...(prev.draft ?? { title: '', body: '' }), ...patch },
        }));
      if (patch.title !== undefined) e.setText(patch.title);
      if (patch.body !== undefined) e.setBody(patch.body);
    },
    publish: () => {
      if (!owner) return;
      const draft = s.draft;
      if (!draft?.title.trim() || !draft.body.trim())
        return setError('제목과 본문을 입력해주세요.');
      const next = { title: draft.title.trim(), body: draft.body.trim() };
      if (e) {
        // 목업 서버: 다음 저장을 실패로 만들면 입력을 그대로 두고 문구만 보여 준다
        if (e.failNext) {
          e.setFailNext(false);
          return setError(failCopy);
        }
        if (!serverBoard) {
          // 목업(review/demo) 경로 — 기존 로컬 dispatch 그대로.
          e.dispatch({ type: 'NOTICE_SAVE', id: e.detail, ...next });
          return e.back();
        }
        // 서버 경로: 쓰기 성공 + 정본 재조회까지 끝나야 돌아간다.
        // 실패해도 e.text·e.body 초안은 건드리지 않는다.
        // 같은 의도의 중복 탭만 무시 — 다른 내용은 훅이 진행 중 거절로 명시 실패시켜
        // 문구를 띄우고 초안을 보존한다(조용히 삼키면 새 내용이 어디도 안 간다).
        const intent = `${s.editing ? e.detail : ''}${next.title}\n${next.body}`;
        if (noticeInflight.current === intent) return;
        const write =
          s.editing && e.detail ? board.updateNotice(e.detail, next) : board.createNotice(next);
        noticeInflight.current = intent;
        const op = routeGen.current;
        const draftOp = draftEpoch.current;
        write.then(
          () => {
            if (noticeInflight.current === intent) noticeInflight.current = null;
            // 시작한 화면 + 그대로인 초안일 때만 뒤로 간다 — 이동·재진입·추가 입력은 무효.
            const now = liveE(op);
            if (now && draftEpoch.current === draftOp) now.back();
          },
          (err: unknown) => {
            if (noticeInflight.current === intent) noticeInflight.current = null;
            if (liveE(op)) setError(apiWriteMessage(err));
          },
        );
        return;
      }
      if (s.editing && mockNotices[s.noticeIndex]) {
        setNotices(
          mockNotices.map((notice, i) => (i === s.noticeIndex ? { ...notice, ...next } : notice)),
        );
        return render({ view: 'detail', error: '', editing: false, draft: null });
      }
      setNotices([...mockNotices, { ...next, time: '오늘', comments: [] }]);
      render({
        noticeIndex: mockNotices.length,
        view: 'detail',
        error: '',
        editing: false,
        draft: null,
      });
    },
    askDelete: (target: 'notice' | 'comment', index = 0) => {
      if (visitor) return;
      if (target === 'notice' ? !owner : !owner && !notices[s.noticeIndex].comments[index].mine)
        return;
      draftEpoch.current += 1;
      if (e) return setUi((prev) => ({ ...prev, confirm: { target, index } }));
      render(
        target === 'notice'
          ? { deleteTarget: 'notice', view: 'confirm' }
          : { deleteTarget: 'comment', commentIndex: index, view: 'confirm' },
      );
    },
    cancelDelete: () => {
      draftEpoch.current += 1;
      return e ? setUi((prev) => ({ ...prev, confirm: null })) : render({ view: 'detail' });
    },
    confirmDelete: () => {
      if (s.deleteTarget === 'notice') {
        if (!owner) return;
        if (e && !serverBoard) {
          // 목업(review/demo) 경로 — 기존 로컬 dispatch 그대로.
          const notice = notices[s.noticeIndex];
          if (!notice) return;
          e.dispatch({ type: 'NOTICE_DELETE', id: notice.id });
          return e.back();
        }
        if (serverBoard && e) {
          // 서버 경로의 삭제 대상 id 는 라우트 detail 이 정본이다 — 목록 첫 페이지에
          // 없는 공지도 지울 수 있다.
          const id = e.detail || notices[s.noticeIndex]?.id;
          if (!id || deleteInflight.current === id) return;
          const write = board.deleteNotice(id);
          deleteInflight.current = id;
          const op = routeGen.current;
          const draftOp = draftEpoch.current;
          write.then(
            () => {
              if (deleteInflight.current === id) deleteInflight.current = null;
              // 확인창을 취소·재열거나 화면이 바뀌면 옛 삭제의 닫기/back 은 실행하지 않는다.
              const now = liveE(op);
              if (!now || draftEpoch.current !== draftOp) return;
              setUi((prev) => ({ ...prev, confirm: null }));
              now.back();
            },
            (err: unknown) => {
              if (deleteInflight.current === id) deleteInflight.current = null;
              const now = liveE(op);
              if (!now || draftEpoch.current !== draftOp) return;
              setUi((prev) => ({ ...prev, confirm: null, error: apiWriteMessage(err) }));
            },
          );
          return;
        }
        const notice = notices[s.noticeIndex];
        if (!notice) return;
        setNotices(mockNotices.filter((_, i) => i !== s.noticeIndex));
        return render({ noticeIndex: 0, view: 'list' });
      }
      // 댓글 삭제는 공개 API 에 없다 — 서버 경로는 확인창만 닫는다(버튼도 숨겨져 있다).
      if (e && serverBoard) return setUi((prev) => ({ ...prev, confirm: null }));
      const notice = notices[s.noticeIndex];
      if (!notice) return;
      const comment = notice.comments[s.commentIndex];
      if (!comment || (!owner && !comment.mine)) return;
      if (e) {
        // 목업(review/demo) 경로 — 기존 로컬 dispatch 그대로.
        e.dispatch({ type: 'COMMENT_DELETE', id: notice.id, commentId: comment.id });
        return setUi((prev) => ({ ...prev, confirm: null }));
      }
      setNotices(
        mockNotices.map((n, i) =>
          i === s.noticeIndex
            ? { ...n, comments: n.comments.filter((_, j) => j !== s.commentIndex) }
            : n,
        ),
      );
      render({ view: 'detail' });
    },
    openComment: () => {
      if (visitor) return;
      draftEpoch.current += 1;
      if (e) return setUi((prev) => ({ ...prev, comment: true }));
      render({ view: 'comment', error: '' });
    },
    cancelComment: () => {
      draftEpoch.current += 1;
      if (!e) return render({ view: 'detail', commentDraft: '', error: '' });
      e.setText('');
      setUi((prev) => ({ ...prev, comment: false }));
    },
    setCommentDraft: (commentDraft: string) => {
      draftEpoch.current += 1;
      return e ? e.setText(commentDraft) : setS((prev) => ({ ...prev, commentDraft }));
    },
    submitComment: () => {
      const text = s.commentDraft.trim(),
        // 서버 경로의 대상 id 는 라우트 detail — 목록 첫 페이지 밖의 공지에도 달 수 있다.
        noticeId = serverBoard ? e?.detail : notices[s.noticeIndex]?.id;
      if (visitor || !text || !noticeId) return;
      if (e) {
        if (!serverBoard) {
          // 목업(review/demo) 경로 — 기존 로컬 dispatch 그대로.
          e.dispatch({ type: 'COMMENT', id: noticeId, text });
          e.setText('');
          return setUi((prev) => ({ ...prev, comment: false }));
        }
        // 성공(쓰기 + 정본 재조회)해야 입력을 비우고 닫는다 — 실패하면 댓글 초안이 남는다.
        // 입력창을 닫았다 열거나 내용이 한 글자라도 바뀌면 옛 작업의 비우기·닫기는 무효다 —
        // e.text 는 공유 필드라 새 초안을 지울 수 있다. 같은 내용 중복 탭만 무시한다.
        const intent = `${noticeId}${text}`;
        if (commentInflight.current === intent) return;
        const write = board.addComment(noticeId, text);
        commentInflight.current = intent;
        const op = routeGen.current;
        const draftOp = draftEpoch.current;
        write.then(
          () => {
            if (commentInflight.current === intent) commentInflight.current = null;
            const now = liveE(op);
            if (!now || draftEpoch.current !== draftOp) return;
            now.setText('');
            setUi((prev) => ({ ...prev, comment: false, error: '' }));
          },
          (err: unknown) => {
            if (commentInflight.current === intent) commentInflight.current = null;
            if (liveE(op)) setError(apiWriteMessage(err));
          },
        );
        return;
      }
      setNotices(
        mockNotices.map((n, i) =>
          i === s.noticeIndex ? { ...n, comments: [...n.comments, [user, text]] } : n,
        ),
      );
      render({ commentDraft: '', view: 'detail', error: '' });
    },
    openQuest: (index: number) =>
      e
        ? e.go('quest', quests[index].id)
        : render({ questIndex: index, view: 'detail', screenUnknown: false }),
    backToQuests: () =>
      e
        ? e.back()
        : render({ view: s.editing ? 'detail' : 'list', questForm: null, editing: false }),
    newQuest: () => {
      if (!owner) return;
      if (!e) return render({ view: 'write', questForm: null, editing: false, error: '' });
      e.go('questEdit');
      e.setBody('focus');
      e.setWindowStart('');
      e.setWindowEnd('');
      setUi((prev) => ({ ...prev, target: '' }));
    },
    // 방장만: 기존 값을 채운 만들기 종이를 연다. 저장하면 상세로 돌아온다
    editQuest: (quest: QuestView) => {
      if (!owner) return;
      const form: QuestForm = {
        type: quest.type,
        title: quest.title,
        startTime: quest.startTime ?? '',
        endTime: quest.endTime ?? '',
        target: String(quest.target),
      };
      if (!e) return render({ view: 'write', editing: true, questForm: form, error: '' });
      e.go('questEdit', quest.id);
      e.setText(form.title);
      e.setBody(quest.type === 'phone' ? 'screen' : 'focus');
      e.setWindowStart(form.startTime);
      e.setWindowEnd(form.endTime);
      // 목표 분은 routeKey effect 가 서버 목록에서 못 찾을 수 있으니 여기서도 채운다.
      if (serverBoard) setUi((prev) => ({ ...prev, target: String(quest.target) }));
    },
    setQuestForm: (form: QuestForm, patch: Partial<QuestForm>) => {
      // 저장 요청 후에 입력을 바꾸면 이전 성공 콜백이 새 초안을 닫지 못하게 한다.
      draftEpoch.current += 1;
      if (!e)
        return setS((prev) => ({
          ...prev,
          error: '',
          questForm: { ...form, ...prev.questForm, ...patch },
        }));
      if (patch.type) e.setBody(patch.type === 'phone' ? 'screen' : 'focus');
      if (patch.title !== undefined) e.setText(patch.title);
      if (patch.startTime !== undefined) e.setWindowStart(patch.startTime);
      if (patch.endTime !== undefined) e.setWindowEnd(patch.endTime);
      // 목표 분은 정수만 받는다
      setUi((prev) => ({
        ...prev,
        error: '',
        target: patch.target === undefined ? prev.target : patch.target.replace(/\D/g, ''),
      }));
    },
    submitQuest: (form: QuestForm) => {
      if (!owner) return;
      const error = questError(form);
      if (error) return e ? setError(error) : render({ view: 'write', questForm: form, error });
      const title = form.title.trim(),
        target = Number(form.target);
      if (e) {
        if (!serverBoard) {
          // 목업(review/demo) 경로 — 기존 로컬 dispatch 그대로.
          e.dispatch({
            type: 'QUEST_SAVE',
            id: s.editing ? e.detail : undefined,
            title,
            kind: form.type === 'phone' ? 'screen' : 'focus',
            target,
            windowStart: clockText(form.startTime),
            windowEnd: clockText(form.endTime),
          });
          return e.back();
        }
        // 서버 경로: PATCH 는 title/targetMinutes 만 받는다 — 종류·창·expectedVersion 을 섞으면 400.
        // 성공(쓰기 + getBoard 재조회)해야 돌아간다 — 실패해도 초안은 그대로다.
        const endText = clockText(form.endTime);
        const intent = `${s.editing ? e.detail : ''}${title}|${target}|${form.type}|${form.startTime}|${form.endTime}`;
        if (questInflight.current === intent) return;
        const write =
          s.editing && e.detail
            ? board.updateQuest(
                quests.find((quest) => quest.id === e.detail)?.questId ?? e.detail,
                { title, targetMinutes: target },
              )
            : board.createQuest({
                title,
                type: form.type === 'phone' ? 'screen' : 'focus',
                targetMinutes: target,
                ...(form.type === 'focus'
                  ? {
                      windowStart: clockText(form.startTime),
                      // 서버 HH:mm(LocalTime)은 24:00 을 표현하지 못한다 — 자정 종료는 23:59 로 내린다.
                      windowEnd: endText === '24:00' ? '23:59' : endText,
                      timezone: 'UTC',
                    }
                  : {}),
              });
        questInflight.current = intent;
        const op = routeGen.current;
        const draftOp = draftEpoch.current;
        write.then(
          () => {
            if (questInflight.current === intent) questInflight.current = null;
            const now = liveE(op);
            if (now && draftEpoch.current === draftOp) now.back();
          },
          (err: unknown) => {
            if (questInflight.current === intent) questInflight.current = null;
            if (liveE(op)) setError(apiWriteMessage(err));
          },
        );
        return;
      }
      const next: Quest =
        form.type === 'phone'
          ? { title, type: 'phone', target, rate: 0 }
          : {
              title,
              type: 'focus',
              startTime: form.startTime,
              endTime: form.endTime,
              target,
              rate: 0,
            };
      if (s.editing && mockQuests[s.questIndex]) {
        setQuests(mockQuests.map((q, i) => (i === s.questIndex ? { ...next, rate: q.rate } : q)));
        return render({ view: 'detail', questForm: null, editing: false, error: '' });
      }
      setQuests([...mockQuests, next]);
      render({ view: 'list', questForm: null, error: '' });
    },
    // 개인 몫 수령 — 본문·지급량은 서버 판정이다. 성공하면 훅이 목록·지갑을 다시 읽고
    // 여기서는 응답의 적립량을 알리기만 한다(로컬 재화 가산 없음).
    claimQuest: (quest: QuestView) => {
      if (!serverBoard || !quest.claimable || quest.claimed) return;
      const item = board.quests.find((q) => q.occurrenceId === quest.id);
      if (!item || claimInflight.current === item.occurrenceId) return;
      claimInflight.current = item.occurrenceId;
      const op = routeGen.current;
      board.claimQuest(item).then(
        (result) => {
          if (claimInflight.current === item.occurrenceId) claimInflight.current = null;
          if (!liveE(op)) return;
          showToast?.(
            result.bonusAdded > 0
              ? `보상 ${result.villagePointsAdded}마리와 전원 달성 보너스 ${result.bonusAdded}마리가 섬에 쌓였어요`
              : `보상 ${result.villagePointsAdded}마리가 섬에 쌓였어요`,
          );
        },
        (err: unknown) => {
          if (claimInflight.current === item.occurrenceId) claimInflight.current = null;
          if (liveE(op)) setError(apiWriteMessage(err));
        },
      );
    },
    build: () => {
      if (!owner || blueprintView.state !== 'ready') return;
      if (e) return app?.building && e.build(app.building);
      if (s.balance < 60) return;
      render({ balance: s.balance - 60, view: 'building' });
    },
    openBuilding: () => {
      const r = app?.building && buildingRoute[app.building];
      if (r) e.go(r);
    },
  };

  const h4 = boardFont(20, 1.35, '700', INK, GOWUN);
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
          {app ? `${app.island.name} 게시판` : '소다 섬 게시판'}
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
            <PaperAction testID="board-notice-new" label="+ 새 공지" onPress={nav.newNotice} />
          )}
        </View>
      </View>
      <View>
        {serverBoard && board.loading ? (
          <Text style={muted({ marginTop: 4, marginBottom: 14 })}>불러오는 중…</Text>
        ) : serverBoard && board.error ? (
          <View>
            <Text style={muted({ marginTop: 4, marginBottom: 8 })}>
              {apiMessage(board.error, '불러오지 못했어요.')}
            </Text>
            <PaperAction
              testID="board-notices-retry"
              label="다시 시도"
              onPress={() => board.retry().catch(() => {})}
            />
          </View>
        ) : notices.length ? (
          notices.map((notice, i) => (
            <Pressable
              key={notice.id}
              testID={`board-notice-item-${i}`}
              accessibilityRole="button"
              onPress={() => nav.openNotice(i)}
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
                <Text style={boardFont(12, 1.3, '400', '#786151', GOWUN)}>{notice.time}</Text>
                <Text
                  style={[
                    boardFont(12, 1.3, '400', '#786151', GOWUN),
                    webOnly({ whiteSpace: 'nowrap' }),
                  ]}
                >
                  {`댓글 ${notice.commentCount ?? notice.comments.length} `}
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
        {serverBoard && board.nextCursor !== null && (
          <PaperAction
            testID="board-notices-more"
            label={board.loadingMore ? '불러오는 중…' : '더 보기'}
            onPress={() => board.loadMore()}
          />
        )}
      </View>
    </View>
  );

  const noticeDetail = () => {
    // 서버 경로의 상세는 hook 의 detail 이 정본이다 — 목록 항목엔 본문·댓글이 없다.
    const notice = serverBoard ? serverDetailView : notices[s.noticeIndex];
    if (serverBoard && board.detailError)
      return (
        <View>
          {detailHead(
            <PaperAction testID="board-notice-back" label="← 목록" onPress={nav.backToNotices} />,
          )}
          <Text style={muted({ marginTop: 4, marginBottom: 8 })}>
            {apiMessage(board.detailError, '불러오지 못했어요.')}
          </Text>
          <PaperAction
            testID="board-notice-retry"
            label="다시 시도"
            onPress={() => board.select(e.detail).catch(() => {})}
          />
        </View>
      );
    if (serverBoard && !notice)
      return (
        <View>
          {detailHead(
            <PaperAction testID="board-notice-back" label="← 목록" onPress={nav.backToNotices} />,
          )}
          {/* 요청을 냈고 로딩도 끝났는데 detail 이 없으면 종결 — 삭제로 비워진 공지다. */}
          <Text style={muted({ marginTop: 4 })}>
            {board.detailLoading || !board.islandId || noticeAsked.current !== noticeDetailId
              ? '불러오는 중…'
              : '삭제됐거나 더 이상 볼 수 없는 공지예요.'}
          </Text>
        </View>
      );
    if (!notice) return noticeList();
    const comments = notice.comments.map((comment, i) => [comment, i] as const);
    return (
      <View>
        {detailHead(
          <PaperAction testID="board-notice-back" label="← 목록" onPress={nav.backToNotices} />,
        )}
        <Text
          style={[
            boardFont(23, 1.2, '400', INK, 'BoardHand-Bold'),
            { marginTop: 4, marginBottom: 3 },
            webOnly({ wordBreak: 'keep-all', textWrap: 'pretty' }),
          ]}
          lineBreakStrategyIOS="hangul-word"
        >
          {notice.title}
        </Text>
        {notice.time !== '' && (
          <Text
            style={[boardFont(11, 1.45, '400', '#8a7364', GOWUN), { marginBottom: 14 }]}
          >{`작성일 · ${notice.time}`}</Text>
        )}
        <Text style={[body, { marginBottom: 14 }]}>{notice.body}</Text>
        {formError}
        {owner && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16, marginBottom: 14 }}>
            <PaperAction testID="board-notice-edit" label="수정" onPress={nav.editNotice} />
            <Link
              testID="board-notice-delete"
              label="삭제"
              danger
              onPress={() => nav.askDelete('notice')}
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
          {!visitor &&
            (s.view === 'comment' ? (
              <PaperAction testID="board-comment-cancel" label="취소" onPress={nav.cancelComment} />
            ) : (
              <PaperAction
                testID="board-comment-new"
                label="+ 댓글 쓰기"
                onPress={nav.openComment}
              />
            ))}
        </View>
        {/* 방문자는 댓글 입력칸 자리에 주민 안내만 둔다 */}
        {visitor && (
          <View
            testID="board-comment-visitor"
            style={{
              marginBottom: 14,
              paddingVertical: 12,
              paddingHorizontal: 14,
              borderWidth: 1,
              borderColor: '#b49472',
              borderStyle: 'dashed',
              borderRadius: 8,
              backgroundColor: '#fffaf0',
            }}
          >
            <Text style={muted({ textAlign: 'center' })}>주민이 되면 댓글을 남길 수 있어요</Text>
          </View>
        )}
        {s.view === 'comment' && (
          <View
            style={{
              gap: 8,
              marginBottom: 14,
              paddingBottom: 14,
              borderBottomWidth: 1,
              borderColor: '#d7bea0',
            }}
          >
            <TextInput
              testID="board-comment-input"
              accessibilityLabel="댓글 내용"
              autoFocus
              multiline
              textAlignVertical="top"
              value={s.commentDraft}
              onChangeText={nav.setCommentDraft}
              placeholder="댓글을 적어주세요"
              placeholderTextColor="#8d796a"
              style={[
                inputStyle(),
                {
                  height: 76,
                  borderWidth: 0,
                  borderBottomWidth: 1.5,
                  borderRadius: 0,
                  paddingHorizontal: 2,
                  backgroundColor: 'transparent',
                },
              ]}
            />
            {formError}
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end' }}>
              <PaperAction
                testID="board-comment-submit"
                label="등록 →"
                onPress={nav.submitComment}
                style={!s.commentDraft.trim() && { opacity: 0.38 }}
              />
            </View>
          </View>
        )}
        <View>
          {comments.length ? (
            comments.map(([{ id, name, text, mine }, commentIndex]) => (
              <View
                key={id}
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
                  {/* 댓글 삭제는 공개 API 에 없다 — 서버 경로에서는 버튼을 숨긴다 */}
                  {!visitor && !serverBoard && (owner || mine) && (
                    <View style={{ flexDirection: 'row', marginTop: 5 }}>
                      <Link
                        testID={`board-comment-delete-${commentIndex}`}
                        label="삭제"
                        danger
                        size={12}
                        onPress={() => nav.askDelete('comment', commentIndex)}
                      />
                    </View>
                  )}
                </View>
              </View>
            ))
          ) : (
            <Text style={muted({ marginTop: 4, marginBottom: 14 })}>
              {visitor ? '아직 댓글이 없어요.' : '첫 댓글을 남겨보세요.'}
            </Text>
          )}
          {serverBoard && board.detail?.nextCommentsCursor !== null && board.detail && (
            <PaperAction
              testID="board-comments-more"
              label={board.loadingMoreComments ? '불러오는 중…' : '댓글 더 보기'}
              onPress={() => board.loadMoreComments()}
            />
          )}
        </View>
      </View>
    );
  };

  const noticeEditor = () => {
    if (!owner) return noticeList();
    const draft = s.draft ?? { title: '', body: '' };
    const setDraft = nav.setDraft;
    return (
      <View>
        {detailHead(
          <PaperAction
            testID="board-notice-cancel"
            label={s.editing ? '← 공지' : '← 목록'}
            onPress={nav.cancelEditor}
          />,
        )}
        <Text
          style={[h4, { marginTop: 4, marginRight: 34, marginBottom: 12 }]}
        >{`공지 ${s.editing ? '수정' : '쓰기'}`}</Text>
        <View style={{ gap: 12 }}>
          <BoardField label="제목">
            <TextInput
              testID="board-notice-title"
              accessibilityLabel="공지 제목"
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
              accessibilityLabel="공지 본문"
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
          <PaperStamp
            testID="board-notice-submit"
            label={s.editing ? '수정 저장' : '게시하기'}
            onPress={nav.publish}
          />
        </View>
      </View>
    );
  };

  const noticeContent = () => {
    switch (s.view) {
      case 'detail':
        return noticeDetail();
      case 'write':
      case 'edit':
        return noticeEditor();
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
                onPress={nav.cancelDelete}
              />
              <BoardPill
                testID="board-delete-confirm"
                label="삭제"
                primary
                style={{ flex: 1 }}
                onPress={nav.confirmDelete}
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
      label={s.editing ? '‹ 퀘스트' : '‹ 퀘스트 목록'}
      onPress={nav.backToQuests}
    />
  );

  // 서버가 내려주는 수령 불가 사유 — 값을 만들지 않고 알려진 코드만 번역한다.
  const questBlockedText = (reason: string | null | undefined) =>
    reason === 'NOT_ACHIEVED'
      ? '목표를 채우면 보상을 받을 수 있어요.'
      : reason === 'MEASUREMENT_PENDING'
        ? '측정이 끝나야 보상을 받을 수 있어요.'
        : reason
          ? '지금은 보상을 받을 수 없어요.'
          : '';

  const questContent = (listOnly = false) => {
    if (!listOnly && s.view === 'detail') {
      const quest = quests[s.questIndex] ?? quests[0];
      if (!quest) return questContent(true);
      // 서버 경로의 상세 본문은 progress GET 이 정본이다 — 목록 항목엔 주민 목록이 없다.
      const progress = serverBoard
        ? board.questDetail?.occurrenceId === quest.id
          ? board.questDetail
          : null
        : null;
      return (
        <>
          {detailHead(
            <PaperAction testID="board-quest-back" label="← 목록" onPress={nav.backToQuests} />,
          )}
          <Text style={[h4, { marginTop: 4, marginRight: 34, marginBottom: 4 }]}>
            {progress?.title ?? quest.title}
          </Text>
          <Text style={[boardFont(13, 1.55, '400', '#786151', GOWUN), { marginBottom: 12 }]}>
            {quest.type === 'phone'
              ? `하루 폰 사용 ${quest.target}분 이하`
              : quest.startTime
                ? `${quest.startTime}부터 ${quest.endTime}까지 · 목표 ${quest.target}분 집중`
                : `목표 ${quest.target}분 집중`}
          </Text>
          {owner && (
            <View style={{ flexDirection: 'row', marginTop: -6, marginBottom: 4 }}>
              <PaperAction
                testID="board-quest-edit"
                label="수정"
                onPress={() => nav.editQuest(quest)}
              />
            </View>
          )}
          {serverBoard && board.questDetailError ? (
            <View>
              <Text style={muted({ marginTop: 4, marginBottom: 8 })}>
                {apiMessage(board.questDetailError, '불러오지 못했어요.')}
              </Text>
              <PaperAction
                testID="board-quest-detail-retry"
                label="다시 시도"
                onPress={() => board.selectQuest(quest.id).catch(() => {})}
              />
            </View>
          ) : serverBoard && !progress ? (
            <Text style={muted({ marginTop: 4, marginBottom: 14 })}>불러오는 중…</Text>
          ) : (
            <>
              <Text style={[boardFont(13, 1.65, '400', '#786151'), { marginBottom: 4 }]}>
                주민별 달성률
              </Text>
              <View>
                {residentsOf(quest).map(({ id, name, color, rate, achieved, claimed }) => {
                  const unknown = rate == null;
                  return (
                    <View
                      key={id}
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
                          {name}
                          {claimed ? ' · 수령 완료' : achieved ? ' · 달성' : ''}
                        </Text>
                        {!unknown && <Track rate={rate} color="#91b67e" style={{ marginTop: 7 }} />}
                      </View>
                      <Text style={[boardFont(14, 1.6, '700'), { width: unknown ? 52 : 42 }]}>
                        {unknown ? '측정 전' : `${rate}%`}
                      </Text>
                    </View>
                  );
                })}
              </View>
              {/* 개인 몫 수령은 받기 버튼으로만 — 전원 보너스는 서버가 자동 적립한 값을 보여 준다 */}
              {serverBoard && (
                <View style={{ marginTop: 12, gap: 6 }}>
                  {quest.claimed ? (
                    <Text style={muted({})}>내 몫은 이미 받았어요.</Text>
                  ) : quest.claimable ? (
                    <BoardPill
                      testID="board-quest-claim"
                      label={`보상 받기${quest.rewardAmount != null ? ` · ${quest.rewardAmount}마리` : ''}`}
                      primary
                      onPress={() => nav.claimQuest(quest)}
                    />
                  ) : quest.claimBlockedReason ? (
                    <Text style={muted({})}>{questBlockedText(quest.claimBlockedReason)}</Text>
                  ) : null}
                  {quest.bonusGranted && !!quest.bonusAmount && (
                    <Text style={muted({})}>
                      모두 달성 보너스 {quest.bonusAmount}마리가 섬에 쌓였어요.
                    </Text>
                  )}
                  {formError}
                </View>
              )}
            </>
          )}
        </>
      );
    }
    if (!listOnly && s.view === 'write') {
      const form = s.questForm ?? {
        type: 'focus',
        title: '',
        startTime: '19:00',
        endTime: '22:00',
        target: '50',
      };
      const setForm = (patch: Partial<QuestForm>) => nav.setQuestForm(form, patch);
      // 서버 PATCH 는 title/targetMinutes 만 받는다 — 수정할 때 종류·창은 읽기 전용으로 보여 준다.
      const serverEdit = serverBoard && s.editing;
      return (
        <>
          {questBack}
          <Text style={[h4, { marginTop: 4, marginRight: 34, marginBottom: 12 }]}>
            {s.editing ? '퀘스트 수정' : '퀘스트 만들기'}
          </Text>
          <View style={{ gap: 12 }}>
            <BoardField label="퀘스트 종류">
              {serverEdit ? (
                <Text style={[inputStyle(), { paddingTop: 13 }]}>
                  {form.type === 'phone' ? '하루 폰 사용' : '시간대 집중'}
                </Text>
              ) : (
                <QuestTypeChoice value={form.type} onChange={(type) => setForm({ type })} />
              )}
            </BoardField>
            <BoardField label="퀘스트 제목">
              <TextInput
                testID="board-quest-title"
                accessibilityLabel="퀘스트 제목"
                value={form.title}
                onChangeText={(title) => setForm({ title })}
                placeholder={form.type === 'focus' ? '예: 저녁 집중' : '예: 하루 폰 90분 이하'}
                placeholderTextColor="#757575"
                style={inputStyle()}
              />
            </BoardField>
            {form.type === 'focus' && serverEdit ? (
              <BoardField label="진행 시간">
                <Text style={[inputStyle(), { paddingTop: 13 }]}>
                  {form.startTime}–{form.endTime}
                </Text>
              </BoardField>
            ) : (
              form.type === 'focus' && (
                <BoardField label="진행 시간">
                  <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8 }}>
                    <View style={{ flex: 1, gap: 4 }}>
                      <Text style={boardFont(12, 1.4, '400', '#786151', GOWUN)}>시작</Text>
                      <QuestTimeInput
                        testID="board-quest-start"
                        label="시작 시간"
                        value={form.startTime}
                        onChange={(startTime) => setForm({ startTime })}
                      />
                    </View>
                    <Text
                      style={[boardFont(16, 1.4, '400', '#786151', GOWUN), { paddingBottom: 10 }]}
                    >
                      →
                    </Text>
                    <View style={{ flex: 1, gap: 4 }}>
                      <View
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                        }}
                      >
                        <Text style={boardFont(12, 1.4, '400', '#786151', GOWUN)}>종료</Text>
                        {/* 웹 시간 입력은 24:00을 받지 못해 자정까지는 따로 고른다. 라벨 줄 높이 안에 둔다 */}
                        <Pressable
                          testID="board-quest-midnight"
                          accessibilityRole="checkbox"
                          accessibilityLabel="자정(24:00)까지"
                          aria-checked={form.endTime === '24:00'}
                          hitSlop={14}
                          onPress={() =>
                            setForm({ endTime: form.endTime === '24:00' ? '' : '24:00' })
                          }
                        >
                          <Text
                            style={[
                              boardFont(
                                11,
                                1.4,
                                form.endTime === '24:00' ? '700' : '400',
                                form.endTime === '24:00' ? INK : '#786151',
                                GOWUN,
                              ),
                              { textDecorationLine: 'underline' },
                            ]}
                          >
                            {form.endTime === '24:00' ? '자정까지 ✓' : '자정까지'}
                          </Text>
                        </Pressable>
                      </View>
                      {form.endTime === '24:00' ? (
                        <View
                          testID="board-quest-end"
                          accessibilityLabel="종료 시간 24:00"
                          style={[inputStyle(), { justifyContent: 'center' }]}
                        >
                          <Text style={boardFont(14, 1.5, '400', INK, GOWUN)}>24:00</Text>
                        </View>
                      ) : (
                        <QuestTimeInput
                          testID="board-quest-end"
                          label="종료 시간"
                          value={form.endTime}
                          onChange={(endTime) => setForm({ endTime })}
                        />
                      )}
                    </View>
                  </View>
                </BoardField>
              )
            )}
            {serverEdit && (
              <Text style={muted({ marginTop: -2 })}>
                종류·진행 시간은 바꿀 수 없어요. 수정은 다음 회차부터 적용돼요.
              </Text>
            )}
            <BoardField
              label={form.type === 'focus' ? '목표 집중 시간 · 분' : '하루 폰 사용 상한 · 분'}
            >
              <TextInput
                testID="board-quest-target"
                accessibilityLabel={
                  form.type === 'focus' ? '목표 집중 시간(분)' : '하루 폰 사용 상한(분)'
                }
                keyboardType="number-pad"
                value={form.target}
                onChangeText={(target) => setForm({ target })}
                style={inputStyle()}
              />
            </BoardField>
            {formError}
            <Text
              style={[
                muted({ marginTop: 4, marginBottom: 14 }),
                webOnly({ wordBreak: 'keep-all' }),
              ]}
              lineBreakStrategyIOS="hangul-word"
            >
              {form.type === 'focus'
                ? '설정한 시간 안에서 목표 집중 시간을 채워요. 매일 00시에 새 회차로 시작해요.'
                : '하루 동안 폰 사용 시간이 상한 이하이면 달성해요. 매일 00시에 새 회차로 시작해요.'}
            </Text>
            <BoardPill
              testID="board-quest-save"
              label={s.editing ? '수정 저장' : '퀘스트 시작'}
              primary
              onPress={() => nav.submitQuest(form)}
            />
          </View>
        </>
      );
    }
    return (
      <>
        <View style={{ marginBottom: 4 }}>
          <Text style={[boardFont(14, 1.2, '400', '#98713d', 'BoardHand'), { marginBottom: 1 }]}>
            매일 새 도전
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
              퀘스트{' '}
              <Text style={{ fontSize: 16, lineHeight: lh(16 * 1.15), color: '#92713f' }}>
                {quests.length}
              </Text>
            </Text>
            {owner && (
              <PaperAction testID="board-quest-new" label="+ 만들기" onPress={nav.newQuest} />
            )}
          </View>
        </View>
        <View
          key={e ? routeKey : s.serial}
          style={[{ paddingHorizontal: 2 }, webOnly({ perspective: 700 })]}
        >
          {serverBoard && board.loading ? (
            <Text style={muted({ marginTop: 4, marginBottom: 14 })}>불러오는 중…</Text>
          ) : serverBoard && board.error ? (
            <View>
              <Text style={muted({ marginTop: 4, marginBottom: 8 })}>
                {apiMessage(board.error, '불러오지 못했어요.')}
              </Text>
              <PaperAction
                testID="board-quests-retry"
                label="다시 시도"
                onPress={() => board.retry().catch(() => {})}
              />
            </View>
          ) : quests.length ? (
            quests.map((quest, i) => (
              <QuestCard
                key={quest.id}
                quest={quest}
                index={i}
                reduceMotion={reduceMotion}
                onDetail={() => nav.openQuest(i)}
                visitor={visitor}
              />
            ))
          ) : (
            <View style={{ paddingVertical: 28, alignItems: 'center' }}>
              <Text style={[h4, { marginBottom: 7, textAlign: 'center' }]}>
                진행 중인 퀘스트가 없어요
              </Text>
              <Text style={muted({ textAlign: 'center' })}>
                방장이 일일 퀘스트를 만들면 여기에 붙어요.
              </Text>
            </View>
          )}
        </View>
      </>
    );
  };

  const blueprint = () => {
    const bp = blueprintView,
      stamp = bp.state === 'ready' || bp.state === 'building';
    if (bp.state === 'none')
      return (
        <Text
          style={[boardFont(14, 1.6, '700', '#f7fcff'), { paddingTop: 32, textAlign: 'center' }]}
        >
          회관에서 다음 건물을 골라 주세요.
        </Text>
      );
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
        <View style={[{ paddingTop: 32, paddingBottom: 14, borderBottomWidth: 1 }, dashed]}>
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
                  source={bp.image}
                  label={`${bp.name} 건물 미리보기`}
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
            <View style={{ position: 'relative', flex: 1, minWidth: 0, alignSelf: 'center' }}>
              <Text style={[boardFont(22, 1.1, '700', light, GOWUN), { marginBottom: 7 }]}>
                {bp.name}
              </Text>
              {copyRow('가격', bp.price)}
              {copyRow('시간', bp.time)}
              <Text
                style={[
                  boardFont(12, 1.45, '400', light),
                  { marginTop: 6, paddingTop: 6, borderTopWidth: 1 },
                  dashed,
                ]}
              >
                {bp.detail}
              </Text>
              {stamp && (
                <View
                  pointerEvents="none"
                  style={{
                    position: 'absolute',
                    zIndex: 2,
                    left: '50%',
                    top: '50%',
                    marginLeft: -63,
                    marginTop: -63,
                  }}
                >
                  <BlueprintReadyStamp reduceMotion={reduceMotion} />
                </View>
              )}
            </View>
          </View>
        </View>
        {bp.state === 'building' ? (
          <View style={{ gap: 10, paddingTop: 16, paddingHorizontal: 2, paddingBottom: 2 }}>
            <Text style={boardFont(21, 1.25, '700', light, GOWUN)}>
              {`${josa(bp.name, '을', '를')} 짓고 있어요`}
            </Text>
            <Text
              style={boardFont(13, 1.6, '400', '#e8faff')}
            >{`공사 진행률 · ${bp.progress}%`}</Text>
            <Track
              rate={bp.progress}
              color="#f3d16d"
              style={{
                height: 10,
                borderWidth: 1,
                borderColor: '#dff7ff',
                backgroundColor: '#eaf8fb',
              }}
            />
          </View>
        ) : bp.state === 'complete' ? (
          <View style={{ gap: 10, paddingTop: 16, paddingHorizontal: 2, paddingBottom: 2 }}>
            <Text style={boardFont(21, 1.25, '700', light, GOWUN)}>
              {`${josa(bp.name, '이', '가')} 완공됐어요`}
            </Text>
            <Text style={boardFont(13, 1.6, '400', '#e8faff')}>
              {bp.name === '도서관'
                ? '이제 도서관에서 주민들의 기록을 펼쳐볼 수 있어요.'
                : `이제 ${josa(bp.name, '을', '를')} 이용할 수 있어요.`}
            </Text>
            <BoardPill
              testID="board-open-library"
              label={`${josa(bp.name, '으로', '로')} 이동`}
              primary
              onPress={nav.openBuilding}
            />
          </View>
        ) : bp.state === 'ready' ? (
          owner ? (
            <View style={{ alignItems: 'center', paddingTop: 14 }}>
              <BoardPill
                testID="board-build-start"
                label="건설하기"
                primary
                style={{ backgroundColor: '#ffa6bc' }}
                onPress={nav.build}
              />
            </View>
          ) : (
            // 시안의 빈 바닥 여백 안에 들어가게 작게 붙인다
            <Text
              style={[
                boardFont(12, 1.35, '400', '#e8faff'),
                { paddingTop: 3, textAlign: 'center' },
              ]}
            >
              방장이 건설할 수 있어요
            </Text>
          )
        ) : (
          <View style={{ paddingTop: 14 }}>
            <View style={{ gap: 7 }}>
              {fishRow('주민 준비량', `${bp.collected} / ${bp.needed}마리`)}
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
                    {
                      width: `${bp.needed ? (bp.collected / bp.needed) * 100 : 0}%`,
                      height: '100%',
                      backgroundColor: '#f3d16d',
                    },
                    webOnly({ position: 'static', zIndex: 'auto' }),
                  ]}
                />
              </View>
              {fishRow('섬 잔액 / 공사 가격', `${bp.balance} / ${bp.cost}마리`)}
            </View>
            <View style={{ gap: 7, marginTop: 14 }}>
              {bp.residents.map(({ id, name, value }) => (
                <View
                  key={id}
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
                  <Text style={boardFont(13, 1.6, '700', '#395e70')}>{value}</Text>
                </View>
              ))}
            </View>
            <Text
              style={[
                boardFont(12, 1.45, '400', '#e8faff'),
                { marginTop: 10, textAlign: 'center' },
              ]}
              lineBreakStrategyIOS="hangul-word"
            >
              주민 전원이 요구량을 채워야 건설할 수 있어요.
            </Text>
          </View>
        )}
      </>
    );
  };

  // 장면(2:3)은 배경과 같은 cover · 세로 38% 기준으로 놓는다. 세로 화면에서는 높이에 딱 맞는다
  const scene = interiorScene(width, sceneHeight),
    land = width > sceneHeight;
  // 장면 속 청사진 종이 위 도서관 그림: grid 행 높이가 그림 비율로 정해지는 원본 계산을 그대로 따른다
  const planeWidth = lu((sceneHeight * 2) / 3);
  const blueprintInner = lu(planeWidth * 0.19) - 10;
  const libraryWidth = lu(blueprintInner * 0.82);
  const libraryRow = lu((libraryWidth * artSize.library[1]) / artSize.library[0]);
  const libraryHeight = lu(libraryRow * 0.92);
  const pressedFilter = (panel: BoardState['panel']) =>
    s.panel === panel && webOnly({ filter: 'brightness(1.08)' });
  const paperPanel = s.panel === 'notice' || s.panel === 'quest';
  const noticeDetailOpen = s.panel === 'notice' && (s.view === 'detail' || s.view === 'comment');
  const noticeEditorOpen = s.panel === 'notice' && (s.view === 'write' || s.view === 'edit');
  const noticeOverlayOpen = noticeDetailOpen || noticeEditorOpen;
  const dismissNoticeOverlay = () =>
    e ? e.back() : render({ view: noticeEditorOpen && s.editing ? 'detail' : 'list', error: '' });
  const questDetailOpen = s.panel === 'quest' && s.view === 'detail';
  const dismissQuestDetail = () => (e ? e.back() : render({ view: 'list', error: '' }));
  const paperSource =
    s.panel === 'quest' ? interiorArt.boardPaper.quest : interiorArt.boardPaper.notice;
  const blueprintPanelContentHeight = {
    complete: 380,
    building: 326,
    ready: owner ? 300 : 236,
    waiting: 430,
    none: 236,
  }[blueprintView.state];
  const blueprintPanelHeight = Math.min(height - 48, blueprintPanelContentHeight);
  // 종이 목록 높이. 키보드가 떠서 스크롤 칸이 너무 낮아지면 위쪽에 붙이고 화면 높이를 다 쓴다
  const sheetHeight = Math.min(height * 0.58, 492);
  const sheetCramped = sheetHeight - 89 < 140;
  const paperHeight = sheetCramped ? Math.max(0, height - 8) : sheetHeight;
  const paperPad = sheetCramped ? { top: 30, bottom: 20 } : { top: 58, bottom: 31 };
  const paperScroll = Math.max(0, paperHeight - paperPad.top - paperPad.bottom);
  // 가운데 상세 종이: 스크롤 높이는 틀 안쪽(위아래 여백 64) 이하로, 모자라면 위쪽에 붙인다
  const overlayFrame = height * (land ? 0.65 : 0.58);
  const overlayCramped = overlayFrame - 64 < 140;
  const overlayScroll = overlayCramped
    ? Math.max(0, height - 8 - 64)
    : Math.min(height * 0.49, overlayFrame - 64);
  const blueprintPanelTop = Math.max(24, (height - blueprintPanelHeight) / 2);

  return (
    <View style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }}>
      <View testID="board-scene" style={{ position: 'absolute', ...scene }}>
        {/* 가로에서는 배경에 그려진 공지 종이만 보인다 */}
        {!land && (
          <Picture
            source={interiorArt.boardPaper.notice}
            label=""
            style={{
              position: 'absolute',
              zIndex: 1,
              left: '19.7%',
              top: '20.5%',
              width: '30.5%',
              height: '27.5%',
            }}
          />
        )}
        <View style={[land ? LAND.labels : fill, { zIndex: 2 }]}>
          <Pressable
            testID="board-notice-area"
            accessibilityRole="button"
            accessibilityLabel="공지"
            onPress={() => nav.open('notice')}
            style={[
              {
                position: 'absolute',
                zIndex: 2,
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
            onPress={() => nav.open('quest')}
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
          {/* 목각 건물·청사진은 방문자에게 보이지 않는다 */}
          {!visitor && (
            <Pressable
              testID="board-blueprint-area"
              accessibilityRole="button"
              accessibilityLabel={`${blueprintView.name || '다음 건물'} 건설 현황 보기`}
              onPress={() => nav.open('blueprint')}
              style={[
                {
                  position: 'absolute',
                  zIndex: 2,
                  ...(land
                    ? LAND.blueprintArea
                    : { left: '61%', top: '34.2%', width: '19%', height: '12.8%' }),
                },
                pressedFilter('blueprint'),
              ]}
            >
              {blueprintView.state !== 'none' && (
                <Picture
                  source={blueprintView.image}
                  label={blueprintView.name}
                  shadow="0 2px 2px #173e5140"
                  style={{
                    position: 'absolute',
                    left: 5 + lu((blueprintInner - libraryWidth) / 2),
                    top: 5 + lu((libraryRow - libraryHeight) / 2),
                    width: libraryWidth,
                    height: libraryHeight,
                  }}
                />
              )}
            </Pressable>
          )}
        </View>
      </View>
      <View
        testID="board-drawer"
        style={[
          {
            position: 'absolute',
            zIndex: 4,
            padding: 16,
            borderWidth: 2,
            borderColor: '#75533d',
            backgroundColor: '#fff2d8',
            boxShadow: '0 8px 18px #3b281b77',
            ...(s.panel === 'blueprint'
              ? {
                  ...(land ? LAND.blueprint : { left: 14, right: 14 }),
                  top: blueprintPanelTop,
                  height: blueprintPanelHeight,
                  maxHeight: blueprintPanelHeight,
                  borderRadius: 18,
                }
              : {
                  ...(land ? LAND.drawer : { left: 0, right: 0 }),
                  ...(paperPanel && sheetCramped ? { top: 4 } : { bottom: 10 }),
                  maxHeight: paperPanel && sheetCramped ? paperHeight : height - 105,
                  borderTopLeftRadius: 18,
                  borderTopRightRadius: 18,
                }),
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
            height: paperHeight,
            minHeight: 0,
            paddingTop: paperPad.top,
            paddingHorizontal: 30,
            paddingBottom: paperPad.bottom,
            borderWidth: 0,
            borderRadius: 0,
            backgroundColor: 'transparent',
            boxShadow: 'none',
          },
        ]}
      >
        {paperPanel && <BoardPaper source={paperSource} />}
        {s.panel === 'blueprint' && (
          <Pressable
            testID="board-drawer-close"
            accessibilityRole="button"
            accessibilityLabel="내용 닫기"
            onPress={nav.closePanel}
            style={({ pressed }) => ({
              position: 'absolute',
              zIndex: 3,
              top: 8,
              right: 8,
              width: 44,
              height: 44,
              alignItems: 'center',
              justifyContent: 'center',
              opacity: pressed ? 0.45 : 1,
            })}
          >
            <Text style={[boardFont(21, 1.4, '400', '#dff7ff'), { textAlign: 'center' }]}>×</Text>
          </Pressable>
        )}
        {s.panel === 'notice' && (
          <Scroll
            style={[
              {
                flexGrow: 1,
                flexShrink: 1,
                minHeight: 0,
                maxHeight: paperScroll,
              },
              webOnly({ overscrollBehavior: 'contain' }),
            ]}
          >
            {noticeOverlayOpen ? noticeList() : noticeContent()}
          </Scroll>
        )}
        {s.panel === 'quest' && (
          <Scroll style={{ maxHeight: paperScroll }}>{questContent(questDetailOpen)}</Scroll>
        )}
        {s.panel === 'blueprint' && (
          <Scroll
            style={[
              {
                flex: 1,
                margin: -16,
                padding: 16,
                minHeight: Math.min(241, blueprintPanelHeight),
                maxHeight: blueprintPanelHeight,
                borderWidth: 2,
                borderColor: '#d9f3f7',
                borderRadius: 16,
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
      {noticeOverlayOpen && (
        <>
          <Pressable
            testID="board-notice-overlay-scrim"
            accessibilityLabel="공지 창 닫기"
            onPress={dismissNoticeOverlay}
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
              ...(land ? LAND.overlay : { left: 32, right: 32, top: '20%', maxHeight: '58%' }),
              ...(overlayCramped && { top: 4, maxHeight: height - 8 }),
              paddingTop: 37,
              paddingHorizontal: 22,
              paddingBottom: 27,
              boxShadow: '0 8px 18px #2f211d45',
            }}
          >
            <BoardPaper
              source={interiorArt.boardPaper.detail}
              style={{ left: -28, right: -28, top: -32, bottom: -26 }}
            />
            <Scroll
              style={[
                { minHeight: 0, maxHeight: overlayScroll },
                webOnly({ overscrollBehavior: 'contain' }),
              ]}
            >
              {noticeDetailOpen ? noticeDetail() : noticeEditor()}
            </Scroll>
          </View>
        </>
      )}
      {questDetailOpen && (
        <>
          <Pressable
            testID="board-quest-overlay-scrim"
            accessibilityLabel="퀘스트 상세 닫기"
            onPress={dismissQuestDetail}
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
            testID="board-quest-overlay"
            accessibilityViewIsModal
            style={{
              position: 'absolute',
              zIndex: 6,
              ...(land ? LAND.overlay : { left: 32, right: 32, top: '20%', maxHeight: '58%' }),
              ...(overlayCramped && { top: 4, maxHeight: height - 8 }),
              paddingTop: 37,
              paddingHorizontal: 22,
              paddingBottom: 27,
              boxShadow: '0 8px 18px #2f211d45',
            }}
          >
            <BoardPaper
              source={interiorArt.boardPaper.detail}
              style={{ left: -28, right: -28, top: -32, bottom: -26 }}
            />
            <Scroll
              style={[
                { minHeight: 0, maxHeight: overlayScroll },
                webOnly({ overscrollBehavior: 'contain' }),
              ]}
            >
              {questContent()}
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

type MailRoute = 'home' | 'island' | 'inbox' | 'letter' | 'friend-select' | 'compose';
// 화면이 그리는 모양. 목업과 앱 상태(e) 둘 다 이 모양으로 바꿔 넘긴다
type LetterView = {
  id: string;
  friendId: string;
  from: string;
  island: string;
  color: Cat;
  time: string;
  body: string;
};
type FriendView = { id: string; name: string; island: string; color: Cat };
type ChatView = {
  id: string;
  name: string;
  text: string;
  time: string;
  color: Cat;
  mine: boolean;
  failed?: boolean;
};

const receivedLetters: LetterView[] = [
  {
    id: '0',
    friendId: '0',
    from: '민지',
    island: '구름 섬',
    color: 'ginger',
    time: '오늘 09:12',
    body: '섬에 새 꽃이 피었어.\n다음에 놀러 와서 같이 보자.',
  },
  {
    id: '1',
    friendId: '1',
    from: '밤이',
    island: '밤비 섬',
    color: 'black',
    time: '어제 22:40',
    body: '오늘도 수고 많았어!\n내일도 같이 천천히 해보자.',
  },
  {
    id: '2',
    friendId: '2',
    from: '보리',
    island: '라임 섬',
    color: 'calico',
    time: '월요일',
    body: '새 레코드 들어봤어?\n모닥불 옆에서 들으면 정말 좋아.',
  },
];

const letterFriends: FriendView[] = [
  { id: '0', name: '민지', island: '구름 섬', color: 'ginger' },
  { id: '1', name: '밤이', island: '밤비 섬', color: 'black' },
  { id: '2', name: '보리', island: '라임 섬', color: 'calico' },
];

const groupMessages: ChatView[] = [
  {
    id: '0',
    name: '민지',
    text: '오늘 밤 모닥불에서 만나자',
    time: '방금',
    color: 'ginger',
    mine: false,
  },
  {
    id: '1',
    name: '두부',
    text: '새 레코드 같이 들어볼 사람?',
    time: '8분 전',
    color: 'black',
    mine: false,
  },
  {
    id: '2',
    name: '수아',
    text: '오늘 물고기 많이 잡았어',
    time: '21분 전',
    color: 'calico',
    mine: false,
  },
];

const weekdays = ['일', '월', '화', '수', '목', '금', '토'];
const kstClock = (at: number) => {
  const d = new Date(at + 9 * 3600000);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
};
// 받은 편지 시각: 오늘 09:12 · 어제 22:40 · 일주일 안이면 요일 · 그 전은 M월 D일
const letterTime = (at: number, now: number) => {
  const days = Math.round((kstDayStart(dayKey(now)) - kstDayStart(dayKey(at))) / 86400000);
  if (days === 0) return `오늘 ${kstClock(at)}`;
  if (days === 1) return `어제 ${kstClock(at)}`;
  const [year, month, date] = dayKey(at).split('-').map(Number);
  if (days < 7) return `${weekdays[new Date(Date.UTC(year, month - 1, date)).getUTCDay()]}요일`;
  return `${month}월 ${date}일`;
};
// 채팅 시각: 방금 · N분 전 · N시간 전 · 그 전은 M월 D일
const chatTime = (at: number, now: number) => {
  const minutes = Math.floor((now - at) / 60000);
  if (minutes < 1) return '방금';
  if (minutes < 60) return `${minutes}분 전`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}시간 전`;
  const [, month, date] = dayKey(at).split('-').map(Number);
  return `${month}월 ${date}일`;
};

function MailHome({ concept, height, reduceMotion, showToast, e }: ArtifactProps) {
  const mailFont = (
    fontSize: number,
    factor: number,
    color: string = INK,
    fontWeight: '400' | '700' | '800' | '900' = '400',
  ) => obsFont(Math.max(8, Math.round(fontSize * 1.3)), factor, color, fontWeight);
  const initialRoute: MailRoute =
    concept.kind === 'island-room'
      ? 'island'
      : concept.kind === 'received-letters'
        ? 'inbox'
        : concept.kind === 'letter-detail'
          ? 'letter'
          : concept.kind === 'friend-select'
            ? 'friend-select'
            : concept.kind === 'friend-compose'
              ? 'compose'
              : 'home';
  const [localRoute, setRoute] = useState<MailRoute>(initialRoute);
  const [selectedFriend, setSelectedFriend] = useState('0');
  const [selectedLetter, setSelectedLetter] = useState('0');
  const [groupText, setGroupText] = useState('오늘도 같이 집중할래?');
  const [groupSent, setGroupSent] = useState(false);
  const [letterText, setLetterText] = useState('섬에 새 꽃이 피었어. 다음에 놀러 와서 같이 보자.');
  const [deletedLetters, setDeletedLetters] = useState<string[]>([]);
  const [reactTransform, react] = useReact(reduceMotion);
  // 앱에서는 안내를 앱 알림으로 띄운다 (장면 토스트는 동작 줄이기에서 그려지지 않는다)
  const say = (message: string) => (e ? e.notify(message) : showToast(message));

  // 앱 상태 → 우체통 화면. 채팅방=chat, 받은 편지=mail+tab, 편지 상세=mail+detail, 친구 선택·편지 쓰기=friendMail
  const state: State | null = e?.state ?? null,
    island = state && currentIsland(state),
    now: number = e?.now ?? 0;
  const friends: FriendView[] = state
    ? (state.friends ?? [])
        .filter((f) => f.status === 'friend')
        .map((f) => ({ id: f.id, name: f.name, island: f.island, color: f.color }))
    : letterFriends;
  const letters: LetterView[] = state
    ? unreadLetters(state).map(({ friend, letter }) => ({
        id: letter.id,
        friendId: friend.id,
        from: friend.name,
        island: friend.island,
        color: friend.color,
        time: letterTime(letter.at, now),
        body: letter.text,
      }))
    : receivedLetters.filter((letter) => !deletedLetters.includes(letter.id));
  // 읽음 처리한 편지도 상세 화면이 열려 있는 동안은 보여 준다
  const openedLetter: LetterView | undefined = state
    ? (state.friends ?? [])
        .flatMap((f) =>
          f.messages
            .filter((m) => m.id === e.detail && m.memberId !== 'me')
            .map((m) => ({
              id: m.id,
              friendId: f.id,
              from: f.name,
              island: f.island,
              color: f.color,
              time: letterTime(m.at, now),
              body: m.text,
            })),
        )
        .at(0)
    : receivedLetters.find((letter) => letter.id === selectedLetter);
  // 채팅방은 최신 글이 위에 온다
  const chat: ChatView[] = island
    ? [...island.messages].reverse().map((m) => ({
        id: m.id,
        name: m.name,
        text: m.text,
        time: chatTime(m.at, now),
        color: m.color,
        mine: m.memberId === 'me',
        failed: m.status === 'failed',
      }))
    : groupSent
      ? [
          ...groupMessages,
          {
            ...groupMessages[0],
            id: 'sent',
            name: '나',
            text: groupText,
            time: '방금',
            mine: true,
          },
        ]
      : groupMessages;
  const friendOf = (id: string) => friends.find((f) => f.id === id);
  const route: MailRoute = !e
    ? localRoute
    : e.route === 'chat'
      ? 'island'
      : e.route === 'friendMail'
        ? friendOf(e.detail)
          ? 'compose'
          : 'friend-select'
        : e.detail && openedLetter
          ? 'letter'
          : e.tab === '받은 편지'
            ? 'inbox'
            : 'home';
  const chosen = friendOf(selectedFriend) ?? friends[0];
  const composeTo = e ? friendOf(e.detail) : chosen;
  // 보내지 못한 편지: 이 친구에게 쓴 마지막 실패 편지
  const failedLetter =
    state && composeTo
      ? state.friends
          ?.find((f) => f.id === composeTo.id)
          ?.messages.filter((m) => m.memberId === 'me' && m.status === 'failed')
          .at(-1)
      : undefined;
  const text = e ? e.text : route === 'island' ? groupText : letterText;
  const setText = (value: string) => {
    if (e) return e.setText(value);
    if (route === 'island') {
      setGroupText(value);
      setGroupSent(false);
    } else setLetterText(value);
  };

  // 채팅방을 열어 둔 동안 들어온 글은 읽은 것으로 본다
  const chatLength = island?.messages.length ?? 0;
  useEffect(() => {
    if (e && route === 'island') e.dispatch({ type: 'CHAT_READ' });
  }, [route, chatLength]);
  // 받은 편지는 여는 순간 읽음 처리한다. 어떤 방법으로 나가도 받은 편지함에서 사라진다
  useEffect(() => {
    if (e && route === 'letter' && openedLetter)
      e.dispatch({ type: 'LETTER_READ', friend: openedLetter.friendId, id: openedLetter.id });
  }, [route, e?.detail]);

  const go = (next: MailRoute, toast?: string) => {
    react();
    if (!e) {
      setRoute(next);
      if (toast) showToast(toast);
      return;
    }
    if (next === 'island') e.go('chat');
    else if (next === 'inbox') {
      e.go('mail');
      e.setTab('받은 편지');
    } else if (next === 'friend-select') e.go('friendMail', 'list');
  };
  const back = (to: MailRoute) => (e ? e.back() : go(to));

  const catAvatar = (color: Cat, size = 34) => (
    <View
      style={{
        width: size,
        height: size,
        overflow: 'hidden',
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1.2,
        borderColor: '#6d5545',
        borderRadius: size / 2,
        backgroundColor: '#f5dfbd',
        boxShadow: '0 2px 0 #b58f6b',
      }}
    >
      <Image
        source={interiorArt.avatars[color]}
        resizeMode="cover"
        style={{ width: size, height: size }}
      />
    </View>
  );

  const paperButton = (label: string, onPress: () => void, active = false) => (
    <Pressable
      testID="island-message-send"
      accessibilityRole="button"
      onPress={onPress}
      style={{
        minHeight: 28,
        paddingVertical: 5,
        paddingHorizontal: 9,
        justifyContent: 'center',
        borderWidth: 1.2,
        borderColor: '#795642',
        borderRadius: 7,
        backgroundColor: active ? '#efc56f' : '#fff8e8',
        boxShadow: '0 2px 0 #795642',
      }}
    >
      <Text style={[mailFont(7, 1.35, INK, '800'), { textAlign: 'center' }]}>{label}</Text>
    </Pressable>
  );

  // 보내지 못한 글·편지 아래에 작게 붙는 "보내지 못했어요 · 다시 보내기"
  const failedLine = (
    testID: string,
    onRetry: () => void,
    align: 'left' | 'right' | 'center' = 'right',
  ) => (
    <Text style={[mailFont(5.5, 1.25, '#a35952', '700'), { marginTop: 2, textAlign: align }]}>
      보내지 못했어요 ·{' '}
      <Text
        testID={testID}
        accessibilityRole="button"
        onPress={onRetry}
        style={{ textDecorationLine: 'underline' }}
      >
        다시 보내기
      </Text>
    </Text>
  );

  const header = (title: string, note: string, to: MailRoute = 'home') => (
    <View style={{ marginBottom: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', columnGap: 7 }}>
        <Pressable
          testID="mail-back"
          accessibilityRole="button"
          accessibilityLabel="이전 화면으로 돌아가기"
          hitSlop={9}
          onPress={() => back(to)}
          style={{
            width: 27,
            height: 27,
            alignItems: 'center',
            justifyContent: 'center',
            borderWidth: 1.2,
            borderColor: '#795642',
            borderRadius: 14,
            backgroundColor: '#fff8e8',
          }}
        >
          <Text style={{ fontFamily: GOWUN, fontSize: 17, lineHeight: 19, color: INK }}>‹</Text>
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={{ fontFamily: GOWUN, fontSize: 17, lineHeight: lh(21), color: INK }}>
            {title}
          </Text>
          {note ? <Text style={mailFont(6.5, 1.35, '#826c5b')}>{note}</Text> : null}
        </View>
      </View>
    </View>
  );

  // 우체통 주 버튼 (전망대 Stamp와 같은 모양)
  const stamp = (label: string, onPress: () => void) => (
    <Pressable
      testID="stamp-action"
      accessibilityRole="button"
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
        backgroundColor: '#f1c46f',
        boxShadow: `0 2px 0 ${OUTLINE}`,
      }}
    >
      <Text style={[obsFont(9, 1.6, INK, '800'), { textAlign: 'center' }]}>{label}</Text>
    </Pressable>
  );

  const newChat = island ? newChatCount(island) : 7,
    newLetters = state ? letters.length : 3;
  const homeItems: [string, string][] = [
    ['우리 섬 채팅방', newChat ? `새 글 ${newChat}개` : ''],
    ['받은 편지', newLetters ? `새 편지 ${newLetters}통` : ''],
    ['편지 쓰기', ''],
  ];
  const homeSlot = (i: number) => {
    const first = i === 0;
    const routes: MailRoute[] = ['island', 'inbox', 'friend-select'];
    const colors = ['#dce8c1', '#bddde0', '#efbcc4'];
    const [title, note] = homeItems[i];
    return (
      <Pressable
        key={title}
        testID={`mail-home-${i}`}
        accessibilityRole="button"
        accessibilityLabel={`${title} 열기`}
        onPress={() => go(routes[i], `${title}을 열었어요`)}
        style={[
          {
            minHeight: first ? 151 : 72,
            paddingTop: first ? 88 : 29,
            paddingHorizontal: 7,
            paddingBottom: 9,
            justifyContent: 'center',
            borderWidth: 1.5,
            borderColor: '#684434',
            borderRadius: 5,
            backgroundColor: colors[i],
            boxShadow: 'inset 0 -8px #c99870,0 3px 0 #3f1d18',
            transform: [{ rotate: i === 1 ? '1deg' : '-1deg' }],
          },
          first && webOnly({ gridRow: 'span 2' }),
        ]}
      >
        <Text style={[mailFont(8.5, 1.25, INK, '900'), { textAlign: 'center' }]}>{title}</Text>
        {note ? (
          <Text
            style={[mailFont(6.5, 1.35, '#705b4e', '700'), { marginTop: 2, textAlign: 'center' }]}
          >
            {note}
          </Text>
        ) : null}
        <View
          style={[
            {
              position: 'absolute',
              left: 8,
              right: 8,
              top: first ? 17 : 8,
              height: first ? 66 : 25,
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
      </Pressable>
    );
  };

  const home = (
    <>
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
          [homeSlot(0), homeSlot(1), homeSlot(2)]
        ) : (
          <>
            <View style={{ flex: 1.2 }}>{homeSlot(0)}</View>
            <View style={{ flex: 1, rowGap: 7 }}>
              {homeSlot(1)}
              {homeSlot(2)}
            </View>
          </>
        )}
      </View>
    </>
  );

  const sendGroup = () => {
    if (!text.trim()) return say('남길 말을 적어 주세요');
    if (e) {
      // 목업 서버: 다음 보내기를 실패로 만들면 글에 실패 표시와 다시 보내기가 붙는다
      e.dispatch({ type: 'MESSAGE', text, fail: e.failNext });
      if (e.failNext) e.setFailNext(false);
      return e.setText('');
    }
    setGroupSent(true);
    showToast('소다 섬 주민 모두에게 남겼어요');
  };
  const islandRoom = (
    <>
      {header(
        '우리 섬 채팅방',
        island
          ? `${island.name} 주민 ${residentCount(island)}명이 함께 봐요`
          : '소다 섬 주민 8명이 함께 봐요',
      )}
      <Scroll style={{ maxHeight: e ? height * 0.4 : undefined }}>
        <View style={{ rowGap: 7 }}>
          {chat.map((m) =>
            m.mine ? (
              <View
                key={m.id}
                style={{
                  alignSelf: 'flex-end',
                  maxWidth: '82%',
                  paddingVertical: 7,
                  paddingHorizontal: 9,
                  borderRadius: 11,
                  backgroundColor: '#dce9d7',
                  boxShadow: '0 2px 0 #a8bfa8',
                }}
              >
                <Text style={mailFont(8, 1.45, INK, '700')}>{m.text}</Text>
                {m.failed ? (
                  failedLine(`chat-retry-${m.id}`, () =>
                    e.dispatch({ type: 'RETRY_MESSAGE', id: m.id }),
                  )
                ) : (
                  <Text
                    style={[
                      mailFont(5.5, 1.25, '#78806f', '700'),
                      { marginTop: 2, textAlign: 'right' },
                    ]}
                  >
                    나 · {m.time}
                  </Text>
                )}
              </View>
            ) : (
              <View
                key={m.id}
                style={{ flexDirection: 'row', alignItems: 'flex-start', columnGap: 7 }}
              >
                {catAvatar(m.color, 30)}
                <View
                  style={{
                    flex: 1,
                    paddingVertical: 7,
                    paddingHorizontal: 9,
                    borderTopLeftRadius: 3,
                    borderTopRightRadius: 11,
                    borderBottomRightRadius: 11,
                    borderBottomLeftRadius: 11,
                    backgroundColor: '#fff9eb',
                    boxShadow: '0 2px 0 #c7aa83',
                  }}
                >
                  <View
                    style={{ flexDirection: 'row', justifyContent: 'space-between', columnGap: 6 }}
                  >
                    <Text style={mailFont(7, 1.25, INK, '900')}>{m.name}</Text>
                    <Text style={mailFont(5.5, 1.25, '#9b8878', '700')}>{m.time}</Text>
                  </View>
                  <Text style={[mailFont(8, 1.45, '#5f5148', '700'), { marginTop: 2 }]}>
                    {m.text}
                  </Text>
                </View>
              </View>
            ),
          )}
        </View>
      </Scroll>
      <View
        style={{
          marginTop: 5,
          padding: 7,
          borderWidth: 1.2,
          borderColor: '#b58f6b',
          borderRadius: 8,
          backgroundColor: '#fffaf0',
        }}
      >
        <TextInput
          testID="island-message-input"
          accessibilityLabel="섬 주민 모두에게 남길 말"
          value={text}
          onChangeText={setText}
          placeholder="섬 주민 모두에게 남길 말"
          placeholderTextColor="#a28e7f"
          multiline
          style={
            {
              minHeight: 44,
              padding: 4,
              fontFamily: GOWUN,
              fontSize: 11,
              lineHeight: lh(16),
              color: INK,
              outlineStyle: 'none',
            } as any
          }
        />
        <View style={{ alignSelf: 'flex-end', minWidth: 74 }}>
          {paperButton(groupSent ? '남겼어요 ✓' : '편지 남기기', sendGroup, groupSent)}
        </View>
      </View>
    </>
  );

  // 가운데 종이 화면은 머리·본문·바닥으로 나눈다. 본문만 스크롤하고 주 버튼은 바닥에 고정한다
  type Pane = { head: React.ReactNode; body: React.ReactNode; foot: React.ReactNode };
  const inbox: Pane = {
    head: header('받은 편지', `아직 열지 않은 편지 ${letters.length}통`),
    body: (
      <View style={{ rowGap: 7 }}>
        {letters.length ? (
          letters.map((letter, i) => (
            <Pressable
              key={letter.id}
              testID={`received-letter-${i}`}
              accessibilityRole="button"
              accessibilityLabel={`${letter.from}의 편지 열기`}
              onPress={() => {
                if (e) return e.go('mail', letter.id);
                setSelectedLetter(letter.id);
                setDeletedLetters((prev) => [...prev, letter.id]);
                go('letter', `${letter.from}의 편지를 열었어요`);
              }}
              style={{
                minHeight: 56,
                paddingVertical: 10,
                paddingRight: 9,
                paddingLeft: 50,
                justifyContent: 'center',
                borderWidth: 1.2,
                borderColor: '#ad8765',
                borderRadius: 7,
                backgroundColor: '#fff8e8',
                boxShadow: '0 2px 0 #b58f6b',
              }}
            >
              <Image
                source={interiorArt.letterEnvelope}
                resizeMode="contain"
                style={{
                  position: 'absolute',
                  left: 8,
                  top: 8,
                  width: 39,
                  height: 39,
                  transform: [{ rotate: i % 2 ? '2deg' : '-2deg' }],
                }}
              />
              <Text style={mailFont(9, 1.3, INK, '900')}>{letter.from}</Text>
            </Pressable>
          ))
        ) : (
          <View style={{ paddingVertical: 35, alignItems: 'center' }}>
            <Image
              source={interiorArt.letterEnvelope}
              resizeMode="contain"
              style={{ width: 48, height: 48 }}
            />
            <Text style={[mailFont(8, 1.4, '#826c5b', '800'), { marginTop: 7 }]}>
              기다리는 편지가 없어요.
            </Text>
          </View>
        )}
      </View>
    ),
    foot: (
      <Text style={[mailFont(5.8, 1.4, '#856f5f'), { marginTop: 5, textAlign: 'center' }]}>
        받은 편지는 열었다가 닫으면 사라져요.
      </Text>
    ),
  };

  const letter: Pane | undefined = openedLetter && {
    head: header('받은 편지', '읽고 닫으면 이 편지는 사라져요', 'inbox'),
    body: (
      <View
        style={[
          {
            minHeight: 280,
            paddingTop: 18,
            paddingHorizontal: 16,
            paddingBottom: 14,
            borderWidth: 1.2,
            borderColor: '#b68d68',
            boxShadow: '0 3px 5px #4d291e3d',
            transform: [{ rotate: '-0.5deg' }],
          },
          webOnly({ backgroundImage: 'repeating-linear-gradient(#fff9e9 0 22px,#eadbc2 23px)' }),
          Platform.OS !== 'web' && { backgroundColor: '#fff9e9' },
        ]}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', columnGap: 9 }}>
          {catAvatar(openedLetter.color, 40)}
          <View>
            <Text style={mailFont(7, 1.4, '#8d715e', '800')}>FROM.</Text>
            <Text
              style={{
                marginTop: 1,
                fontFamily: GOWUN,
                fontSize: 18,
                lineHeight: lh(23),
                color: INK,
              }}
            >
              {openedLetter.from}
            </Text>
            <Text style={[mailFont(6, 1.4, '#9b8878'), { marginTop: 1 }]}>
              {openedLetter.island} · {openedLetter.time}
            </Text>
          </View>
        </View>
        <Text
          style={{ marginTop: 28, fontFamily: GOWUN, fontSize: 13, lineHeight: lh(23), color: INK }}
        >
          {openedLetter.body}
        </Text>
        <Text style={[mailFont(7, 1.4, '#8d715e', '800'), { marginTop: 24, textAlign: 'right' }]}>
          TO. 나
        </Text>
      </View>
    ),
    foot: (
      <View style={{ marginTop: 9, flexDirection: 'row', columnGap: 7 }}>
        <Pressable
          testID="reply-to-letter"
          accessibilityRole="button"
          onPress={() => {
            if (e) return e.replace('friendMail', openedLetter.friendId);
            setSelectedFriend(openedLetter.friendId);
            go('compose', `${openedLetter.from}에게 답장을 써요`);
          }}
          style={{
            minHeight: 34,
            flex: 1,
            paddingVertical: 7,
            alignItems: 'center',
            justifyContent: 'center',
            borderWidth: 1.5,
            borderColor: '#7b493f',
            borderRadius: 9,
            backgroundColor: '#f1c46f',
            boxShadow: '0 2px 0 #7b493f',
          }}
        >
          <Text style={mailFont(8, 1.4, '#54352f', '900')}>답장하기</Text>
        </Pressable>
        <Pressable
          testID="close-letter"
          accessibilityRole="button"
          onPress={() => {
            back('inbox');
            if (!e) showToast('편지를 닫았어요');
          }}
          style={{
            minHeight: 34,
            flex: 1,
            paddingVertical: 7,
            alignItems: 'center',
            justifyContent: 'center',
            borderWidth: 1.5,
            borderColor: '#7b493f',
            borderRadius: 9,
            backgroundColor: '#fff8e8',
            boxShadow: '0 2px 0 #7b493f',
          }}
        >
          <Text style={mailFont(8, 1.4, '#54352f', '900')}>닫기</Text>
        </Pressable>
      </View>
    ),
  };

  const friendSelect: Pane = {
    head: header('편지 보낼 친구 선택', ''),
    body: (
      <View style={{ rowGap: 7 }}>
        {friends.map((friend, i) => (
          <Pressable
            key={friend.id}
            testID={`letter-friend-${i}`}
            accessibilityRole="button"
            accessibilityLabel={`${friend.name} · ${friend.island}`}
            accessibilityState={{ selected: chosen === friend }}
            onPress={() => {
              setSelectedFriend(friend.id);
              if (!e) showToast(`${friend.name}를 받는 친구로 골랐어요`);
            }}
            style={{
              minHeight: 57,
              padding: 8,
              flexDirection: 'row',
              alignItems: 'center',
              columnGap: 9,
              borderWidth: chosen === friend ? 2 : 1.2,
              borderColor: chosen === friend ? '#9a654d' : '#b79273',
              borderRadius: 9,
              backgroundColor: chosen === friend ? '#fff0cf' : '#fff9ea',
              transform: chosen === friend ? [{ translateX: 3 }] : undefined,
            }}
          >
            {catAvatar(friend.color, 38)}
            <View style={{ flex: 1 }}>
              <Text style={mailFont(9, 1.3, INK, '900')}>{friend.name}</Text>
              <Text style={[mailFont(6.5, 1.35, '#826c5b'), { marginTop: 2 }]}>
                {friend.island} · 친구
              </Text>
            </View>
            <Text style={mailFont(10, 1.2, chosen === friend ? '#9a654d' : '#c5ad99', '900')}>
              {chosen === friend ? '✓' : '›'}
            </Text>
          </Pressable>
        ))}
        {!friends.length && (
          <Text
            style={[
              mailFont(8, 1.4, '#826c5b', '800'),
              { paddingVertical: 24, textAlign: 'center' },
            ]}
          >
            내 뗏목에서 친구를 추가해 주세요.
          </Text>
        )}
      </View>
    ),
    foot:
      chosen &&
      stamp(`${chosen.name}에게 편지 쓰기`, () => {
        if (e) return e.go('friendMail', chosen.id);
        go('compose', `${chosen.name}에게 쓸 편지를 펼쳤어요`);
      }),
  };

  const sendLetter = () => {
    if (!composeTo) return;
    if (!text.trim()) return say('편지 내용을 적어 주세요');
    if (!e) {
      react();
      return showToast(`${composeTo.name}에게 편지를 보냈어요`);
    }
    // reducer가 거절할 편지(친구 아님·내 섬에 우체통 없음)는 보냈다고 하지 않는다
    if (!canSendLetter(e.state, composeTo.id))
      return say('지금은 이 친구에게 편지를 보낼 수 없어요');
    react();
    e.dispatch({ type: 'FRIEND_MESSAGE', id: composeTo.id, text, fail: e.failNext });
    e.setText('');
    if (e.failNext) return e.setFailNext(false);
    e.notify(`${composeTo.name}에게 편지를 보냈어요`);
    e.reset('mail');
  };
  const retryLetter = () => {
    if (!composeTo || !failedLetter) return;
    e.dispatch({ type: 'FRIEND_RETRY', id: failedLetter.id, friend: composeTo.id });
    e.notify(`${composeTo.name}에게 편지를 보냈어요`);
    e.reset('mail');
  };
  // 편지지 입력칸은 남은 높이에 맞춰 줄인다 (머리·편지지 여백·버튼·안내가 약 213)
  const letterInput = Math.max(64, Math.min(210, height - 14 - 213));
  const compose: Pane | undefined = composeTo && {
    head: header('친구에게 편지 쓰기', `${composeTo.name} · ${composeTo.island}`, 'friend-select'),
    body: (
      <View
        style={[
          {
            minHeight: letterInput + 90,
            paddingTop: 14,
            paddingHorizontal: 13,
            paddingBottom: 12,
            borderWidth: 1.2,
            borderColor: '#b68d68',
            boxShadow: '0 3px 5px #4d291e3d',
            transform: [{ rotate: '-0.4deg' }],
          },
          webOnly({ backgroundImage: 'repeating-linear-gradient(#fff9e9 0 22px,#eadbc2 23px)' }),
          Platform.OS !== 'web' && { backgroundColor: '#fff9e9' },
        ]}
      >
        <View
          style={{
            position: 'absolute',
            right: 10,
            top: 9,
            width: 31,
            height: 36,
            borderWidth: 1,
            borderStyle: 'dashed',
            borderColor: '#ba6c62',
            backgroundColor: '#e7a097',
          }}
        />
        <Text style={mailFont(7, 1.4, '#8d715e', '800')}>TO. {composeTo.name}</Text>
        <TextInput
          testID="friend-letter-input"
          accessibilityLabel={`${composeTo.name}에게 쓸 편지`}
          value={text}
          onChangeText={setText}
          placeholder="친구에게 남길 편지를 써 주세요"
          placeholderTextColor="#a28e7f"
          multiline
          style={
            {
              minHeight: letterInput,
              marginTop: 18,
              padding: 0,
              fontFamily: GOWUN,
              fontSize: 13,
              lineHeight: lh(23),
              color: INK,
              textAlignVertical: 'top',
              outlineStyle: 'none',
            } as any
          }
        />
        <Text style={[mailFont(7, 1.4, '#8d715e', '800'), { textAlign: 'right' }]}>FROM. 나</Text>
      </View>
    ),
    foot: (
      <>
        {stamp('접어서 편지 보내기', sendLetter)}
        {failedLetter ? (
          <View style={{ alignItems: 'center' }}>
            {failedLine('letter-retry', retryLetter, 'center')}
          </View>
        ) : (
          <Text style={[mailFont(5.8, 1.35, '#856f5f'), { marginTop: 5, textAlign: 'center' }]}>
            친구의 섬에 우체통이 없어도 배달돼요.
          </Text>
        )}
      </>
    ),
  };

  const pane: Pane | undefined =
    route === 'inbox'
      ? inbox
      : route === 'letter'
        ? (letter ?? inbox)
        : route === 'friend-select'
          ? friendSelect
          : route === 'compose'
            ? (compose ?? friendSelect)
            : undefined;

  if (route !== 'home') {
    return (
      <Animated.View style={{ transform: reactTransform }}>
        <View
          style={[
            {
              padding: 11,
              borderWidth: 1.2,
              borderColor: '#b38c68',
              borderRadius: 9,
              backgroundColor: '#fff1d0',
              boxShadow: '0 8px 18px #3a1d1766',
            },
            // 가운데 종이는 화면 안(위 12·아래 2)에 들어오게 하고 넘치는 본문만 스크롤한다
            pane && { maxHeight: height - 14 },
          ]}
        >
          {pane ? (
            <>
              {pane.head}
              {/* 기운 종이·그림자가 스크롤 테두리에 잘리지 않게 안쪽 여백을 주고 같은 만큼 바깥으로 뺀다 */}
              <Scroll style={{ flexShrink: 1, minHeight: 0, margin: -8, padding: 8 }}>
                {pane.body}
              </Scroll>
              {pane.foot}
            </>
          ) : (
            islandRoom
          )}
        </View>
      </Animated.View>
    );
  }

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
      {home}
    </Animated.View>
  );
}

const observatoryMailArtifacts: Record<string, ArtifactRenderer> = {
  'observatory-desk': ObservatoryDesk,
  'island-ranking': IslandRanking,
  'old-map': OldMap,
  'mail-home': MailHome,
  'island-room': MailHome,
  'received-letters': MailHome,
  'letter-detail': MailHome,
  'friend-select': MailHome,
  'friend-compose': MailHome,
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
