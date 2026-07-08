// 집중 플로우 시간 포맷터 — 타이머(06~08)·과목 누적(02)·친구 경과(09) 공용.

// 2자리 0패딩
function pad(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

// HH:MM:SS (시 자리 2자리 고정) — 큰 타이머용. 예: 00:42:15
export function hms(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${pad(h)}:${pad(m)}:${pad(s % 60)}`;
}

// H:MM:SS (시 자리 가변) — 과목 누적표시용. 예: 12:30:00, 0:50:22
export function hmsCompact(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}:${pad(m)}:${pad(s % 60)}`;
}

// H:MM (친구 그리드 경과·메뉴 진행표시) — 예: 1:42, 0:58
export function hourMin(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}:${pad(m)}`;
}
