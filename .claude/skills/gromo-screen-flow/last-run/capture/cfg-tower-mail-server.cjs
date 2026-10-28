// 전망대·우체통 묶음 중 '서버 모드에서만 그려지는' 화면. capture-tower-mail.cjs(번들 조건 치환판)로만 찍는다.
// 실행: CAPTURE_CONFIG=cfg-tower-mail-server.cjs CAPTURE_OUT=../shots/tower-mail/patched node capture-tower-mail.cjs
const LETTERS = `
  const t = Date.now();
  s.friends[0].messages.push({ id: 'l1', memberId: 'saebom', name: '새봄', color: 'white',
    text: '오늘 우리 섬에 벚꽃이 피었어. 시험 끝나면 놀러 와! 같이 낚시하자.', at: t - 40 * 60000, status: 'sent' });
`;
const letter = { route: 'mail', detail: 'l1', mutate: `(s, is) => { ${LETTERS} }` };
const more = { label: '새봄 더보기' };

module.exports = [
  { ...letter, name_: 'mail.letter-server', title: "받은 편지 상세(서버 모드 모양: '···' 버튼)" },
  { ...letter, name_: 'mail.letterSafetySheet', title: '편지 보낸 사람 더보기 시트', steps: [more] },
  {
    ...letter,
    name_: 'mail.letterSafetyReport',
    title: '편지 신고하기',
    steps: [more, { click: '신고하기' }],
  },
  {
    ...letter,
    name_: 'mail.letterSafetyBlock',
    title: '편지 보낸 사람 차단 확인',
    steps: [more, { click: '차단하기' }],
  },
  { route: 'friends', name_: 'friends.safetySheet', title: '친구 더보기 시트', steps: [more] },
  {
    route: 'friends',
    name_: 'friends.safetyReport',
    title: '사용자 신고하기',
    steps: [more, { click: '신고하기' }],
  },
  {
    route: 'friends',
    name_: 'friends.safetyBlock',
    title: '사용자 차단 확인',
    steps: [more, { click: '차단하기' }],
  },
  {
    route: 'chat',
    name_: 'chat.empty',
    title: '우리 섬 채팅방 — 글 없음(서버 모드 문구)',
    mutate: `(s, is) => { is.messages = []; }`,
  },
];
