// 온보딩 표시용 포맷 유틸.

// 분 → "N시간 M분". 0시간이면 "M분", 0분이면 "N시간".
export function formatDuration(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m}분`;
  return m ? `${h}시간 ${m}분` : `${h}시간`;
}

// 한글 주격/보조사 은/는 선택 — 마지막 글자 받침 있으면 '은', 없으면 '는'(한글 아니면 '는').
export function eunNeun(word: string): string {
  if (!word) return '는';
  const code = word.charCodeAt(word.length - 1);
  if (code < 0xac00 || code > 0xd7a3) return '는';
  return (code - 0xac00) % 28 !== 0 ? '은' : '는';
}

// 한글 주격조사 이/가 선택 — 받침 있으면 '이', 없으면 '가'(한글 아니면 '가').
export function iGa(word: string): string {
  if (!word) return '가';
  const code = word.charCodeAt(word.length - 1);
  if (code < 0xac00 || code > 0xd7a3) return '가';
  return (code - 0xac00) % 28 !== 0 ? '이' : '가';
}
