// 공지 카드 캡션의 경과일 표기 — '오늘' / '어제' / 'n일 전' / '7월 29일'(§6-4 목업).
// 그룹방(GroupRoomScreen)에서만 쓰지만, 시간대 의존 로직이라 테스트에서 러너 TZ를 바꿔 가며
// 직접 부를 수 있게 화면에서 떼어 뒀다(now 주입 = 기준 시각 고정).

// 로컬 달력 날짜의 서수(=1970-01-01부터의 날짜 수).
// **로컬 자정끼리의 밀리초 차이를 86,400,000으로 나누지 않는다** — DST를 쓰는 시간대에서는
// 봄 전환이 낀 두 자정 사이가 23시간이라 나눔·내림이 0이 되어 어제 공지가 '오늘'로 보이고,
// 오차는 그다음 날까지 밀려 이틀 전 공지가 '어제'가 된다. 연·월·일만 뽑아 UTC 서수로 바꾸면
// 하루 길이와 무관하게 달력 날짜 차이 그대로가 나온다.
function dayNumber(d: Date): number {
  return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000;
}

// ISO 시각 → 화면 문구. 파싱 실패한 값은 조용히 비운다.
export function fmtNoticeDate(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const days = dayNumber(now) - dayNumber(d);
  if (days <= 0) return '오늘';
  if (days === 1) return '어제';
  if (days < 7) return `${days}일 전`;
  return `${d.getMonth() + 1}월 ${d.getDate()}일`;
}
