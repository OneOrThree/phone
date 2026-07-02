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
}

// 함께 집중 중인 친구(09) — 예시.
export type FriendStatus = 'focus' | 'rest' | 'off';
export interface Friend {
  id: string;
  name: string;
  color: string; // 별 아바타 색
  status: FriendStatus;
  elapsedSeconds: number; // 현재 세션 경과(focus일 때만 표시)
}

// 집중 중 허용앱(11) — 예시. initial = 아이콘 사각에 넣는 한 글자.
export interface AllowedApp {
  id: string;
  name: string;
  initial: string;
  color: string;
}
