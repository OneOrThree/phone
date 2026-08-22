// v2 집중 플로우(GROMO-553) 공용 타입 — 과목선택(02)→집중세션(06~11)에서 함께 쓴다.
import type { BlockToday } from './blockToday';

// 타이머 방식(03)
export type FocusTimerMode = 'countup' | 'countdown' | 'pomodoro';

// 뽀모도로 설정(05)
export interface PomodoroConfig {
  focusMin: number; // 집중 블록(분)
  breakMin: number; // 휴식 블록(분)
  sets: number; // 총 세트 수
}

// 과목(02) — 예시 데이터. accumulatedSeconds = '오늘' 집중시간(로컬 자정 리셋, 표시용).
export interface Subject {
  id: string;
  name: string;
  accumulatedSeconds: number; // 오늘 누적(초) — SubjectContext가 날짜 경계에 0으로 리셋
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
  serverSessionId?: string | null; // 서버 라이브 마커 세션 id(GROMO-873) — 강제종료 시 서버 스윕이 마감
  // 날짜별 집중초 스냅샷(GROMO-1252) — 고아 정산이 '오늘 몫'(local 축)을 고르는 근거이자
  // 서버 업로드의 focusSecondsByDate(server 축). 두 축을 나눠 두는 이유는 blockToday.ts 주석 참고.
  // 없으면(구버전 레코드) 구간 겹침으로 폴백한다.
  focusDays?: BlockToday;
  // 화면을 정상적으로 빠져나가며 **실드를 직접 내렸는가**(GROMO-1604 코드리뷰).
  //
  // 시스템 Back 으로 나가는 경로는 레코드를 일부러 남긴다(시간 적립은 다음 실행의 고아 정산이
  // 한다). 그래서 레코드가 남아 있다는 것만으로는 '강제 종료됐다'를 뜻하지 않는다. 이 표식이
  // 없을 때만 프로세스가 실제로 죽은 것으로 보고 '차단이 함께 풀렸다'를 알린다 — 표식을 안
  // 보면 정상 이탈에도 거짓 알림이 나간다.
  shieldReleasedCleanly?: boolean;
}

// 집중 중 허용앱(11) — 예시. initial = 아이콘 사각에 넣는 한 글자.
export interface AllowedApp {
  id: string;
  name: string;
  initial: string;
  color: string;
}
