// 기기 존 ≠ 서버 존일 때 업로드 축과 표시 축이 갈리는지 — GROMO-1252 코드리뷰 3차 ②·4차 ②.
//
// 서버는 유저 존(country_code 파생, 미지정·미지원은 Asia/Seoul) 날짜로 귀속·검증한다. 앱이 기기 로컬
// 날짜 키만 보내면 두 존이 어긋날 때 서버가 못 알아보는 키가 나가고, 검증 맵이 비어 있지 않아 벽시계
// 폴백도 안 타서 그 날 몫이 조용히 버려진다.
//
// 러너 TZ는 KST 고정이라(jest.config.js) 실제 기기 존을 바꿀 수 없다 — 러너가 process.env.TZ 변경을
// 반영하지 않으므로 표시 축 헬퍼(localDateStr)만 PDT로 대체해 기기 존이 KST가 아닌 상황을 만든다.
// 존 포매터(zoneDateStr)는 실제 구현 그대로 쓴다.
jest.mock('@/utils/localDate', () => {
  const actual = jest.requireActual('@/utils/localDate');
  const PDT_TO_KST_MS = 16 * 3600 * 1000; // KST(+09:00) − PDT(−07:00)
  return {
    ...actual,
    localDateStr: (d: Date) => actual.kstDateStr(new Date(d.getTime() - PDT_TO_KST_MS)),
  };
});

import { newBlockToday, creditTick, type BlockToday } from './blockToday';
import { setServerZone } from '@/utils/serverZone';

// startISO 는 오프셋이 붙은 절대 시각. tick 은 1초의 '끝'에 발생한다.
function runTicks(state: BlockToday, startISO: string, seconds: number): BlockToday {
  const base = new Date(startISO).getTime();
  let s = state;
  for (let i = 1; i <= seconds; i++) s = creditTick(s, new Date(base + i * 1000));
  return s;
}

it('PDT 기기의 KR 유저 — 로컬로는 하루지만 서버 존(Asia/Seoul)으로는 자정을 걸친다', () => {
  setServerZone('Asia/Seoul');
  // 08-08 07:40~08:20 PDT 집중 = KST 08-08 23:40 ~ 08-09 00:20 (40분).
  const s = runTicks(newBlockToday(), '2026-08-08T23:40:00+09:00', 2400);

  // 표시(로컬 적립) 축 — 유저가 보는 '오늘'은 PDT 하루 안에 다 들어온다.
  expect(s.local).toEqual({ '2026-08-08': 2400 });
  // 업로드 축 — 서버 버킷과 같은 KST 자정에서 갈린다(20분/20분). 로컬 축만 보냈다면
  // 서버는 '2026-08-08' 키 하나만 받아 KST 08-09 몫 20분을 버렸다.
  expect(s.server).toEqual({ '2026-08-08': 1200, '2026-08-09': 1200 });
});

it('GB 유저 — 업로드 키가 KST가 아니라 서버 존(Europe/London) 날짜로 갈린다', () => {
  // 4차 ②: 3차엔 업로드 축이 KST 하드코딩이라, 서버가 Europe/London 으로 버킷을 잡는 GB 유저는
  // 런던 23:50~00:10 세션의 전날 몫 10분이 통째로 버려졌다(앱이 KST 키 하나만 보냄).
  setServerZone('Europe/London');
  // 런던 08-08 23:50 ~ 08-09 00:10 (BST +01:00) = KST 08-09 07:50~08:10 — 기기(KST)로는 하루 안.
  const s = runTicks(newBlockToday(), '2026-08-08T23:50:00+01:00', 1200);

  expect(s.server).toEqual({ '2026-08-08': 600, '2026-08-09': 600 });
});
