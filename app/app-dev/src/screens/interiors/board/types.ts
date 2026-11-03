import { type Outfit } from '@/components/CatOutfitLayers';
import { ImageSourcePropType } from 'react-native';

// ───────────── 게시판 ─────────────

// 게시판 기능 화면: board-view (원본 board.js의 공지·퀘스트·청사진 상태 기계와 마크업)

export type Notice = { title: string; time: string; body: string; comments: [string, string][] };

export type QuestType = 'focus' | 'phone';

export type Quest = {
  title: string;
  type: QuestType;
  startTime?: string;
  endTime?: string;
  target: number;
  rate: number;
};

// 화면이 그리는 모양. 목업(Notice·Quest)과 앱 상태(e) 둘 다 이 모양으로 바꿔 넘긴다
export type NoticeView = {
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
export type QuestView = Omit<Quest, 'rate'> & {
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
export type ResidentRate = {
  id: string;
  name: string;
  // 서버가 털색을 안 준 주민(탈퇴 등)은 null — 그릴 때 빈 상자로 둔다(색을 추측하지 않는다)
  color: string | null;
  outfit?: Outfit;
  rate: number | null;
  achieved?: boolean;
  claimed?: boolean;
};

export type BlueprintView = {
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

export type QuestForm = {
  type: QuestType;
  title: string;
  startTime: string;
  endTime: string;
  target: string;
};

export type BoardState = {
  role: 'owner' | 'resident';
  panel: '' | 'notice' | 'quest' | 'blueprint' | 'guestbook';
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
