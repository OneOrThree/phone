// 웹 로컬 방의 집중 계약. 앱 계정이나 운영 집중 기록과는 연결하지 않는다.
export type IslandId = "home" | "focus";
export type FocusSession = {
  seatId: number;
  subject: string;
  status: "focusing" | "paused";
  elapsedMs: number;
  startedAt: number | null;
};
export type FocusResult = {
  subject: string;
  elapsedMs: number;
  finishedAt: number;
};
export type SeatReservation = {
  seatId: number;
  residentId: string;
  name: string;
  status: "focusing" | "paused";
};
export function focusElapsedMs(
  session: FocusSession | null,
  now = Date.now(),
): number {
  if (!session) return 0;
  return (
    session.elapsedMs +
    (session.status === "focusing" && session.startedAt !== null
      ? Math.max(0, now - session.startedAt)
      : 0)
  );
}
