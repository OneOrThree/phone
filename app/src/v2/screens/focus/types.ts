// v2 집중 플로우(GROMO-553) 공용 타입 — 과목선택(02)→집중세션(06~11)에서 함께 쓴다.

// 타이머 방식(03)
export type FocusTimerMode = 'countup' | 'countdown' | 'pomodoro';

// 뽀모도로 설정(05)
export interface PomodoroConfig {
  focusMin: number; // 집중 블록(분)
  breakMin: number; // 휴식 블록(분)
  sets: number; // 총 세트 수
}

// 과목(02) — 예시 데이터. accumulatedSeconds = 누적 집중시간(표시용).
export interface Subject {
  id: string;
  name: string;
  accumulatedSeconds: number;
  color: string; // 대표색 — T.subjectPalette 중 하나(드로어 비율 바·행 아이콘에 사용)
}

// 진행 중 세션의 라이브 레코드 — 강제 종료 대비로 AsyncStorage에 주기 저장.
// 정상 종료(finish) 시 삭제되고, 앱 시작 시 남아 있으면 죽은 세션으로 보고 정산한다.
export interface LiveFocusSession {
  subjectId: string;
  subjectName: string;
  elapsed: number; // 마지막 저장 시점까지의 집중 초
  startedAt: string; // ISO
  updatedAt: string; // ISO — 마지막 저장 시각
  userId?: string | null; // 세션 소유 계정(UUID) 또는 null(게스트) — 고아 정산 시 현재 계정과 대조
  settledLocally?: boolean; // 고아 정산에서 로컬 적립(집중시간·과목·코인) 완료 — 업로드 재시도 시 중복 적립 방지
}

// 집중 중 허용앱(11) — 예시. initial = 아이콘 사각에 넣는 한 글자.
export interface AllowedApp {
  id: string;
  name: string;
  initial: string;
  color: string;
}
