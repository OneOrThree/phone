// 상점·내 뗏목·프로필·설정 묶음. 한 줄 = 한 장. name_ = 대상 id (targets-shop-boat.json)
// 실행: node capture-shop-boat.cjs   (capture.cjs 사본 — 추가 옵션 serverUi·blocks·after·reload·external 은 그 파일 머리말)
// 순서 주의: 걸어서 들어가는 전환 연출 두 장은 홈 지도 상태를 남기므로 맨 끝에 두고 reload 로 새 페이지에서 찍는다.
const fish500 = (s, is) => {
  is.fish = 500;
};
// 내 정보: 방장을 넘길 섬이 없어야 탈퇴 확인창이 뜬다 → 다른 주민을 방장으로. 연동 계정은 카카오로 표시
const kakao = (s) => {
  s.linkedProviders = ['kakao'];
};
const kakaoNotHost = (s, is) => {
  s.linkedProviders = ['kakao'];
  is.members[0].role = 'host';
};
const blocked = [
  { id: 'u1', name: '하늘' },
  { id: 'u2', name: '보리' },
];

module.exports = [
  // ── 상점 ──
  { route: 'shop', title: '강아지 상점 · 내 꾸미기 탭', mutate: fish500, name_: 'shop' },
  {
    route: 'shop',
    title: '강아지 상점 · 우리 섬 꾸미기 탭',
    mutate: fish500,
    steps: [{ click: '우리 섬 꾸미기' }],
    name_: 'shop.islandTab',
  },
  {
    route: 'shop',
    title: '강아지 첫 상점 안내',
    mutate: fish500,
    npcGuide: true,
    delay: 900,
    name_: 'shop.guide',
  },
  {
    route: 'product',
    title: '상품 상세(미보유 · 구매 가능)',
    detail: 'scarf',
    mutate: fish500,
    name_: 'product',
  },
  {
    route: 'product',
    title: '상품 상세 — 구매 불가(잔액 부족)',
    detail: 'scarf',
    mutate: (s, is) => {
      is.fish = 40;
    },
    name_: 'product.blocked',
  },
  {
    route: 'product',
    title: '물고기로 구매 확인창',
    detail: 'scarf',
    mutate: fish500,
    steps: [{ click: '100마리로 구매' }],
    name_: 'product.buyConfirm',
  },
  {
    route: 'product',
    title: '상품 상세 — 보유 중(옷·장신구)',
    detail: 'scarf',
    mutate: (s, is) => {
      is.fish = 400;
      s.owned = ['scarf'];
    },
    name_: 'product.ownedClothes',
  },
  {
    route: 'product',
    title: '상품 상세 — 보유 중(테마, 미적용)',
    detail: 'soda-theme',
    mutate: (s, is) => {
      is.fish = 500;
      is.sharedOwned.push('soda-theme');
    },
    name_: 'product.ownedTheme',
  },
  {
    route: 'product',
    title: '상품 상세 — 보유 중 · 적용됨(테마)',
    detail: 'soda-theme',
    mutate: (s, is) => {
      is.fish = 500;
      is.sharedOwned.push('soda-theme');
      is.theme = 'soda-theme';
    },
    name_: 'product.themeApplied',
  },
  {
    route: 'product',
    title: '음원 사기 시트 — 보유 음원',
    detail: 'rain',
    mutate: (s, is) => {
      is.fish = 500;
      is.sharedOwned.push('rain');
    },
    name_: 'product.ownedAudio',
  },
  {
    route: 'orders',
    title: '구매 내역 · 내 구매 탭',
    mutate: (s, is) => {
      const D = 86400000;
      is.fish = 325;
      s.owned = ['scarf', 'straw-hat'];
      s.orders = [
        { id: 'o2', product: 'straw-hat', islandId: is.id, currency: 'fish', price: 75, at: Date.now() - 3600000, buyer: s.name },
        { id: 'o1', product: 'scarf', islandId: is.id, currency: 'fish', price: 100, at: Date.now() - 2 * D, buyer: s.name },
      ];
    },
    name_: 'orders',
  },
  {
    route: 'orders',
    title: '구매 내역 · 섬 공동 구매 탭',
    mutate: (s, is) => {
      const D = 86400000;
      is.sharedOwned.push('soda-theme', 'rain', 'strawberry-roof');
      s.orders = [
        { id: 'o5', product: 'rain', islandId: is.id, currency: 'fish', price: 30, at: Date.now() - 3600000, buyer: '민지' },
        { id: 'o4', product: 'strawberry-roof', islandId: is.id, currency: 'fish', price: 300, at: Date.now() - D, buyer: '두부' },
        { id: 'o3', product: 'soda-theme', islandId: is.id, currency: 'fish', price: 1000, at: Date.now() - 3 * D, buyer: s.name },
        { id: 'o1', product: 'scarf', islandId: is.id, currency: 'fish', price: 100, at: Date.now() - 4 * D, buyer: s.name },
      ];
      s.owned = ['scarf'];
    },
    steps: [{ click: '섬 공동 구매' }],
    name_: 'orders.sharedTab',
  },
  {
    route: 'orders',
    title: '구매 내역 비어 있음',
    mutate: (s) => {
      s.orders = [];
    },
    name_: 'orders.empty',
  },
  // ── 내 뗏목 ──
  // 가입한 섬이 2개여야 메인 섬 카드에 '메인 섬 변경하기'가 보이고 눌린다(mainIsland 로 가는 길)
  {
    route: 'boat',
    title: '내 뗏목(섬 2개 — 메인 섬 변경하기 보임)',
    mutate: (s) => {
      s.islands[1].joined = true;
    },
    name_: 'boat',
  },
  // 참고용(final 에 넣지 않음): 섬이 1개뿐인 기본 상태 — 카드가 눌리지 않고 '메인 섬 변경하기'가 없다
  { route: 'boat', title: '내 뗏목(섬 1개, 참고용)', name_: 'extra-boat.oneIsland' },
  {
    route: 'mainIsland',
    title: '내 메인 섬 변경하기',
    mutate: (s) => {
      s.islands[1].joined = true;
    },
    name_: 'mainIsland',
  },
  {
    route: 'mainIsland',
    title: '메인 섬 변경 — 다른 섬 선택됨',
    mutate: (s) => {
      s.islands[1].joined = true;
    },
    steps: [{ click: '딸기 섬' }],
    name_: 'mainIsland.picked',
  },
  {
    route: 'wardrobe',
    title: '내 꾸미기(옷·장신구 선택)',
    mutate: (s) => {
      s.owned = ['scarf', 'straw-hat'];
      s.equipped = { ...s.equipped, clothes: 'scarf' };
    },
    name_: 'wardrobe',
  },
  { route: 'wardrobe', title: '내 꾸미기 — 보유품 없음', name_: 'wardrobe.empty' },
  { route: 'profile', title: '내 정보', mutate: kakao, name_: 'profile' },
  {
    route: 'profile',
    title: '로그아웃 확인창',
    mutate: kakao,
    steps: [{ click: '로그아웃' }],
    name_: 'profile.logoutConfirm',
  },
  {
    route: 'profile',
    title: '회원 탈퇴 확인창',
    mutate: kakaoNotHost,
    steps: [{ click: '회원 탈퇴' }],
    name_: 'profile.deleteAccountConfirm',
  },
  // 실제 앱(서버 모드)에만 있는 '안전' 섹션을 켜고 찍는다 — 차단한 사용자로 가는 길이 여기 있다
  { route: 'settings', title: '앱 설정', serverUi: true, name_: 'settings' },
  {
    route: 'settings',
    title: '개인정보 처리 안내 팝업',
    serverUi: true,
    steps: [{ click: '개인정보 처리 안내' }],
    name_: 'settings.privacyNotice',
  },
  // 앱 밖 브라우저로 여는 원문 — 앱 화면이 아니라 그 주소의 웹 페이지
  {
    route: 'settings',
    title: '이용약관 원문(외부 브라우저)',
    external: 'https://oneorthree.world/catus/terms',
    name_: 'settings.termsExternal',
  },
  {
    route: 'settings',
    title: '개인정보처리방침 원문(외부 브라우저)',
    external: 'https://oneorthree.world/catus/privacy',
    name_: 'settings.privacyExternal',
  },
  // ── 차단한 사용자(서버 모드 전용 화면 — 번들 패치 + 흉내 응답) ──
  { route: 'blockedUsers', title: '차단한 사용자(목록 있음)', serverUi: true, blocks: blocked, name_: 'blockedUsers' },
  { route: 'blockedUsers', title: '차단한 사용자 없음', serverUi: true, blocks: [], name_: 'blockedUsers.empty' },
  { route: 'blockedUsers', title: '차단 목록 불러오기 실패', serverUi: true, blocks: 'error', name_: 'blockedUsers.loadError' },
  // ── 탈퇴 뒤 기기 정리 실패: 저장소 쓰기를 2.5초 동안 실패시키고 탈퇴를 누른다 ──
  {
    route: 'profile',
    title: '내 정보 — 기기 데이터 정리 다시 시도',
    mutate: kakaoNotHost,
    steps: [
      {
        js: "(()=>{const o=Storage.prototype.setItem;Storage.prototype.setItem=function(){throw new Error('quota')};setTimeout(()=>{Storage.prototype.setItem=o},2500)})()",
      },
      { click: '회원 탈퇴' },
      { click: '탈퇴', settle: 900 },
    ],
    after: 2800,
    name_: 'profile.withdrawCleanupRetry',
  },
  // ── 상점 전환 연출(중간 프레임). 상점까지 걷기 약 5.0초 → 문 프레임 0.66초 → 덮개 0.62초 ──
  {
    route: 'home',
    title: '상점 진입 전환(원형 덮개 확대 중)',
    reload: true,
    steps: [{ click: '상점', settle: 5800 }],
    after: 3000,
    name_: 'shop.enterTransition',
  },
  {
    route: 'home',
    title: '상점 → 섬 복귀 전환(원형 덮개 축소 중)',
    reload: true,
    // 실제 흐름 그대로: 걸어서 들어갔다가 × 로 닫는다(고양이가 상점 앞에 서 있는 상태)
    steps: [{ click: '상점', settle: 7500 }, { waitText: '강아지 상점' }, { click: '×', settle: 340 }],
    after: 2500,
    expectRoute: 'home',
    name_: 'shop.returnTransition',
  },
];
