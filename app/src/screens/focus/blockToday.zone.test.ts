// 기기 존 ≠ 서버 존일 때 업로드 축과 표시 축이 갈리는지 — GROMO-1252 코드리뷰 3차 ②.
//
// 서버는 유저 존(country_code 파생, 미지정·미지원은 Asia/Seoul) 날짜로 귀속·검증한다. 앱이 기기 로컬
// 날짜 키만 보내면 PDT 지역에 있는 KR 유저처럼 두 존이 어긋날 때 서버가 못 알아보는 키가 나가고,
// 검증 맵이 비어 있지 않아 벽시계 폴백도 안 타서 그 날 몫이 조용히 버려진다.
//
// 러너 TZ는 KST 고정이라(jest.config.js) 실제 기기 존을 바꿀 수 없다 — 러너가 process.env.TZ 변경을
// 반영하지 않으므로 표시 축 헬퍼(localDateStr)만 PDT로 대체해 두 존이 갈린 상황을 만든다.
// KST 축(kstDateStr)은 실제 구현 그대로 쓴다.
jest.mock('@/utils/localDate', () => {
  const actual = jest.requireActual('@/utils/localDate');
  const PDT_TO_KST_MS = 16 * 3600 * 1000; // KST(+09:00) − PDT(−07:00)
  return {
    ...actual,
    localDateStr: (d: Date) => actual.kstDateStr(new Date(d.getTime() - PDT_TO_KST_MS)),
  };
});

import { newBlockToday, creditTick, type BlockToday } from './blockToday';

function runTicks(state: BlockToday, startKstISO: string, seconds: number): BlockToday {
  const base = new Date(`${startKstISO}+09:00`).getTime();
  let s = state;
  for (let i = 1; i <= seconds; i++) s = creditTick(s, new Date(base + i * 1000));
  return s;
}

it('PDT 기기의 KR 유저 — 로컬로는 하루지만 KST로는 자정을 걸친다', () => {
  // 08-08 07:40~08:20 PDT 집중 = KST 08-08 23:40 ~ 08-09 00:20 (40분).
  const s = runTicks(newBlockToday(), '2026-08-08T23:40:00', 2400);

  // 표시(로컬 적립) 축 — 유저가 보는 '오늘'은 PDT 하루 안에 다 들어온다.
  expect(s.local).toEqual({ '2026-08-08': 2400 });
  // 업로드 축 — 서버 버킷과 같은 KST 자정에서 갈린다(20분/20분). 로컬 축만 보냈다면
  // 서버는 '2026-08-08' 키 하나만 받아 KST 08-09 몫 20분을 버렸다.
  expect(s.kst).toEqual({ '2026-08-08': 1200, '2026-08-09': 1200 });
});
