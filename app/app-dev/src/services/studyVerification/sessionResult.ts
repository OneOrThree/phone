import { sessionGeneration } from '@/services/api/session';

const STALE_MS = 2_000;
// 이번 실행의 결과창 전달용 메모리뿐이다. 앱 상태·기록·디스크·API에는 넣지 않는다.
let run: {
  sessionId: string;
  generation: number;
  verifiedMs: number;
  capture: object | null;
  advance?: (now: number) => void;
} | null = null;

const current = (sessionId: string) =>
  run?.sessionId === sessionId && run.generation === sessionGeneration() ? run : null;

/** 사용하지 않은 세션은 undefined, 사용했으나 확인되지 않은 세션은 0이다. */
export function verificationResult(sessionId: string | undefined, totalSeconds = Infinity) {
  const result = sessionId ? current(sessionId) : null;
  result?.advance?.(Date.now());
  return result
    ? Math.max(0, Math.min(Math.floor(result.verifiedMs / 1000), Math.floor(totalSeconds)))
    : undefined;
}

/** 끄기·휴식·화면 이탈 때 닫는다. 다음 촬영과 늦게 도착한 프레임을 섞지 않는다. */
export function openVerificationCapture(
  sessionId: string,
  { holdMs = 0 }: { holdMs?: number } = {},
) {
  if (!current(sessionId))
    run = { sessionId, generation: sessionGeneration(), verifiedMs: 0, capture: null };
  const owner = run!;
  owner.advance?.(Date.now());
  const token = {};
  owner.capture = token;
  let open = true;
  let lastPositiveAt: number | null = null;
  let validUntil = 0;
  const valid = () => open && current(sessionId) === owner && owner.capture === token;
  const advance = (now: number) => {
    if (!valid() || !holdMs || lastPositiveAt == null || now <= lastPositiveAt) return;
    const end = Math.min(now, validUntil);
    owner.verifiedMs += Math.max(0, end - lastPositiveAt);
    lastPositiveAt = now < validUntil ? end : null;
  };
  owner.advance = holdMs ? advance : undefined;
  return {
    observe(focused: boolean, now = Date.now()) {
      if (!valid()) return undefined;
      advance(now);
      if (!holdMs && focused && lastPositiveAt != null) {
        const elapsed = now - lastPositiveAt;
        if (elapsed > 0 && elapsed < STALE_MS) owner.verifiedMs += elapsed;
      }
      lastPositiveAt = focused ? now : null;
      validUntil = focused ? now + holdMs : 0;
      return Math.floor(owner.verifiedMs / 1000);
    },
    pause() {
      advance(Date.now());
      lastPositiveAt = null;
    },
    close() {
      advance(Date.now());
      open = false;
      lastPositiveAt = null;
      if (owner.capture === token) {
        owner.capture = null;
        owner.advance = undefined;
      }
    },
  };
}

export function clearVerificationResult(sessionId: string | undefined) {
  if (sessionId && run?.sessionId === sessionId) run = null;
}
