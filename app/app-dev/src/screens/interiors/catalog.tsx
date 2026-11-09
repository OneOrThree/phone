import { BuildingData, Concept, Item } from './types';

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
          ['건물 선택', '다음 건물 고르기', '섬장이 목표를 정하고 게시판에서 진행해요'],
          ['공동 가계부', '공동 물고기 1,240마리', '적립과 건설·공동 구매 내역'],
        ],
      },
      {
        title: '목각 건물 고르기',
        kind: 'building-models',
        position: 'scene',
        items: [
          ['도서관', '공부 기록을 모아보는 도서관', '총 2,720마리 · 15분'],
          ['전망대', '다른 섬을 찾아보는 전망대', '총 5,440마리 · 30분'],
          ['우체통', '주민과 친구의 편지가 오가는 곳', '총 4,080마리 · 20분'],
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
          ['도서관', '도서관 건설 계획', '총 2,720마리 · 공사 15분'],
          ['전망대', '전망대 건설 계획', '총 5,440마리 · 공사 30분'],
          ['우체통', '우체통 건설 계획', '총 4,080마리 · 공사 20분'],
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
      board('공지 목록 · 섬장', 'notice', 'owner', 'list'),
      board('공지 목록 · 주민', 'notice', 'resident', 'list'),
      board('공지 목록 · 빈 상태', 'notice', 'resident', 'empty'),
      board('공지 상세 · 섬장', 'notice', 'owner', 'detail'),
      board('공지 상세 · 주민', 'notice', 'resident', 'detail'),
      board('댓글 작성 · 주민', 'notice', 'resident', 'comment'),
      board('댓글 작성 · 주민 · 입력 중', 'notice', 'resident', 'comment-input'),
      board('공지 작성 · 섬장', 'notice', 'owner', 'write'),
      board('공지 작성 · 섬장 · 입력 중', 'notice', 'owner', 'write-input'),
      board('공지 수정 · 섬장', 'notice', 'owner', 'edit'),
      board('공지 저장 실패 · 섬장', 'notice', 'owner', 'write-failed'),
      board('퀘스트 목록 · 섬장', 'quest', 'owner', 'list'),
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
      board('청사진 · 섬장 건설 가능', 'blueprint', 'owner', 'ready'),
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
