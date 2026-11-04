import { Concept } from '../types';
import { BoardState, Notice, Quest } from './types';

export const OWNER = '민지';

export const NOTICES: Notice[] = [
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

export const QUESTS: Quest[] = [
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

export const RESIDENTS = [
  ['민지', 'calico'],
  ['두부', 'white'],
  ['수아', 'cream'],
] as const;

export const HANDWRITING = [
  'M5 10 C8 2 12 4 10 10 C8 16 16 15 17 8 C18 2 24 3 22 11 C20 16 29 13 31 7 M39 10 C41 3 46 4 45 10 C44 16 51 15 53 7 C56 2 59 6 58 11 C57 16 65 13 67 7 C69 3 74 6 73 12 C73 16 81 11 85 9',
  'M6 27 C10 20 14 21 12 27 C10 33 18 31 21 24 C24 19 28 23 26 29 C24 34 33 31 35 25 C37 20 42 22 41 29 M49 26 C52 19 58 22 55 29 C53 34 63 31 64 24 C66 20 70 24 69 29 C70 33 76 30 80 26 C84 22 89 26 93 25',
  'M5 44 C8 37 13 38 11 45 C9 50 17 49 19 41 C21 36 26 39 24 46 C24 50 31 46 33 40 M41 44 C44 36 49 40 46 47 C45 52 53 48 55 42 C58 36 62 40 60 46 C60 51 68 46 71 42 C74 37 80 42 78 47',
  'M7 61 C10 55 15 56 13 62 C12 67 21 64 23 58 C25 53 29 58 28 63 C29 67 36 61 38 58 M47 60 C50 54 56 55 53 63 C52 67 61 64 64 58 C67 53 71 58 69 63 C68 67 75 63 80 60 C84 56 88 61 92 59',
];

// 가로 화면의 상세 패널은 화면 폭에 맞춰 배치한다.
export const LAND = {
  drawer: { left: 324, right: 30 },
  overlay: { left: 338, right: 36, top: 28, maxHeight: '65%' as const },
  blueprint: { left: 324, right: 30 },
};

export function makeState(concept: Concept): BoardState {
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
