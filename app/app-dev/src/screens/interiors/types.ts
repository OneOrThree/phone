import type { ScreenEnvironment } from '@/navigation/ScreenEnvironment';
import React from 'react';
import { ImageSourcePropType } from 'react-native';

// 원본: gachisup-R61-assets/preview/concepts/building-interiors-3 (index.html · app.js · board.js · style.css)
// 건물 안 장면 위에 기능 화면을 얹는 38개 시안을 RN으로 옮긴다. 수치는 원본 CSS 그대로다.

export type Item = [string, string, string];

export type Concept = {
  title: string;
  kind: string;
  position: 'scene' | 'bottom' | 'middle';
  items: Item[];
  managementTab?: 'info' | 'residents' | 'requests';
  boardPanel?: '' | 'notice' | 'quest' | 'blueprint' | 'guestbook';
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
  e?: ScreenEnvironment;
  // 배경 장면을 맞출 높이. 키보드로 화면이 줄어도 창 높이 기준으로 고정한다 (없으면 height)
  sceneHeight?: number;
  // 현재 건물 밖의 보상 모달이 더 위에 열려 있으면 게시판 키보드 트랩을 쉰다
  higherModalOpen?: boolean;
  onBoardModalChange?: (open: boolean) => void;
};

export type ArtifactRenderer = (props: ArtifactProps) => React.ReactElement | null;
