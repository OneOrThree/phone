// blockPause.ts
// 미정산 집중 블록의 '방해' 초 — 수동 일시정지 누적(GROMO-1214 코드리뷰).
//
// 왜 필요한가: 일시정지 구간은 정산 구간 [settleAt, endedAt] 안에 그대로 들어 있는데 집중은
// 멈춰 있다. 앱이 서버에 totalDistractionSeconds=0을 박아 보내던 종전엔 그 시간이 통째로
// 집중으로 지급·집계됐다 — 1h 집중 + 30m 정지 + 30m 집중이 서버에선 2h·120코인이 됐다.
//
// **방해로 세는 건 수동 일시정지뿐이다**:
//   - 뽀모도로 휴식: 정상 플로우이고, 애초에 휴식 경계에서 정산 구간이 옮겨져 구간 밖이다.
//   - 실드 세션의 이탈 크레딧 구간: "자리 비운 시간도 집중으로 인정"이 확정 정책이다.
//   - 크레딧 상한(8h) 초과 공백: 상한 시각에 부분 정산하고 복귀 시점에 새 블록을 열어 구간 밖이다.
//
// blockToday.ts와 같은 결의 '블록 단위 카운터'다 — 정산할 때 읽고, 새 블록 시작에 리셋한다.
// 세션 전체 누적을 매 블록에 실으면 과다 차감이므로 반드시 블록마다 리셋해야 한다.

export interface BlockPause {
  pausedMs: number; // 이 블록에서 닫힌 일시정지 구간의 합
  count: number; // 이 블록의 일시정지 횟수
  startedAt: number | null; // 아직 안 닫힌(진행 중) 일시정지의 시작 시각 — 없으면 null
}

// 새 블록 시작 상태. 정지 중에 블록이 바뀌면(정지 상태로 정산) 남은 정지분이 새 블록 몫이 되게
// 기준 시각만 다시 찍는다 — 이전 블록 몫은 이미 정산에 실렸다.
export function newBlockPause(prev?: BlockPause, at: number = Date.now()): BlockPause {
  return { pausedMs: 0, count: 0, startedAt: prev?.startedAt != null ? at : null };
}

// 일시정지 시작. 이미 정지 중이면 무시한다(중복 시작으로 기준 시각이 밀리지 않게).
export function pauseStart(state: BlockPause, at: number = Date.now()): BlockPause {
  if (state.startedAt != null) return state;
  return { ...state, count: state.count + 1, startedAt: at };
}

// 재개 — 열린 구간을 닫아 누적에 더한다. 정지 중이 아니면 무시한다.
export function pauseEnd(state: BlockPause, at: number = Date.now()): BlockPause {
  if (state.startedAt == null) return state;
  return {
    pausedMs: state.pausedMs + Math.max(0, at - state.startedAt),
    count: state.count,
    startedAt: null,
  };
}

// 서버 DTO 검증 상한 — totalDistractionSeconds 는 0 이상 24시간 이하여야 한다(넘기면 400).
export const MAX_DISTRACTION_SECONDS = 24 * 3600;

// 이 블록의 방해 초 — 아직 안 닫힌 구간(정지 중 정지 버튼으로 종료)까지 포함한다.
// 상한으로 자르는 건 최후 방어일 뿐이다 — 상한을 넘는 정지는 아래 pauseCutAt 이 업로드 구간
// 자체를 끊어 애초에 여기까지 오지 않는다.
export function blockPauseSeconds(state: BlockPause, at: number = Date.now()): number {
  const openMs = state.startedAt != null ? Math.max(0, at - state.startedAt) : 0;
  return Math.min(MAX_DISTRACTION_SECONDS, Math.round((state.pausedMs + openMs) / 1000));
}

// 업로드 구간을 끊어야 하는 시각 — 이 블록의 방해 총합이 DTO 상한을 넘기면 진행 중인 정지의
// **시작 시각**을, 아니면 null(끊을 필요 없음)을 준다 (GROMO-1214 코드리뷰 2차).
//
// 왜 자르는 대신 끊나: blockPauseSeconds 로 값만 상한에 맞추면 업로드 구간 [startedAt, endedAt]은
// 그대로라 초과분이 서버에서 통째로 집중이 된다 — 36시간 정지에 타이머 진행 0이어도 서버는
// 36h − 24h = 12h 집중으로 계산해 720코인 캡까지 지급한다(돈 경로). 정산 블록을 정지 시작
// 시점에서 닫고 재개 시점에 새 블록을 열면 서버가 받는 구간 안에 24h 초과 공백이 남지 않는다.
export function pauseCutAt(state: BlockPause, at: number = Date.now()): number | null {
  const { startedAt, pausedMs } = state;
  if (startedAt == null) return null;
  const totalSeconds = (pausedMs + Math.max(0, at - startedAt)) / 1000;
  return totalSeconds > MAX_DISTRACTION_SECONDS ? startedAt : null;
}
