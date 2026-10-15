import {
  createContext,
  useContext,
  useState,
  useEffect,
  useRef,
  useCallback,
  type ReactNode,
} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { STORAGE_KEYS } from '@/types/storage';
import { fetchTodayFocusRestore, todayRestoreSeconds } from '@/screens/focus/focusRestore';
import { todayStr } from '@/utils/localDate';
import { subscribeDayChange } from '@/utils/dayChange';

interface FocusContextValue {
  todayFocusSeconds: number;
  // 로컬 로드(+서버 복원) 완료 여부 — 복원 스냅샷이 이후 적립분을 덮지 않게
  // OrphanFocusSettler가 이걸 기다린다(리뷰 반영).
  ready: boolean;
  addFocusSeconds: (seconds: number) => void;
  removeFocusSeconds: (seconds: number) => void;
}

const FocusContext = createContext<FocusContextValue | null>(null);

// 하루 총 집중시간의 물리적 상한(GROMO-1253). 적립 경로가 늘어도 여기서 한 번에 막는다 —
// 하루 24시간을 넘는 값은 어떤 경로로 들어와도 버그다. 저장분 로드에도 적용해
// 이미 부푼 기기 값이 다음 자정까지 남지 않게 한다.
// SubjectContext 도 같은 상한을 쓴다 — 총합만 막으면 과목별 누적이 부푼 채 남아
// 도넛이 어긋나고, 그 과목을 지울 때 총합에서 24시간 넘는 값을 빼 0으로 떨어진다(코드리뷰).
export const DAY_SECONDS = 24 * 3600;

interface SavedFocus {
  todayFocusSeconds?: number;
  date?: string;
}

export function FocusProvider({ children }: { children: ReactNode }) {
  const [todayFocusSeconds, setTodayFocusSeconds] = useState(0);
  const [ready, setReady] = useState(false);
  const loaded = useRef(false);
  // 지금 메모리의 todayFocusSeconds가 속한 로컬 날짜 — SubjectContext와 같은 롤오버 기준(코드리뷰 반영).
  // 과목별 스토어만 자정에 리셋되면 홈·통계의 '오늘 집중' 총합은 어제 값이 남아 서로 어긋난다.
  const dayRef = useRef(todayStr());

  // 자정 롤오버 — 날짜가 바뀌었으면 '오늘 집중' 총합을 0으로 리셋.
  // SubjectContext와 같은 경계(날짜 경계 신호·적립 직전·저장 직전)에서 호출해 두 스토어를 함께 넘긴다.
  const rolloverIfNeeded = useCallback(() => {
    if (dayRef.current === todayStr()) return;
    dayRef.current = todayStr();
    setTodayFocusSeconds(0);
  }, []);

  // 공유 날짜 경계 신호 구독(코드리뷰 반영) — 앱이 활성인 채 자정을 넘긴 뒤 과목만 바뀌는
  // 경우(이름변경·색·순서 등)엔 이 스토어로 오는 AppState 전환·적립이 없어 어제 총합이 남았다.
  // SubjectContext와 같은 신호(dayChange)를 구독해 같은 경계에서 함께 리셋한다(기존 개별
  // AppState 리스너 대체). 이 스토어는 플랫폼 공통이라 iOS 홈·통계 총합에도 동일 적용.
  useEffect(() => subscribeDayChange(rolloverIfNeeded), [rolloverIfNeeded]);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEYS.focus).then(async (raw) => {
      if (raw) {
        const saved = JSON.parse(raw) as SavedFocus;
        // 날짜가 바뀌면 오늘 집중 시간 초기화
        if (saved.date === todayStr()) {
          setTodayFocusSeconds(Math.min(DAY_SECONDS, saved.todayFocusSeconds ?? 0));
        }
      } else {
        // 로컬 데이터 없음(첫 실행·재로그인) — 오늘 서버 세션 구간 합으로 '오늘 집중' 복원(GROMO-677).
        // 소프트 삭제된 태그의 세션은 제외 — 과목 삭제가 홈 총합에서 차감하는 로컬 규칙과 일치(리뷰 반영).
        // 과목 미분류(tagId null) 세션은 포함. 실패하면 기존처럼 0에서 시작.
        // ⚠️ 한계(리뷰): 서버 '이름 변경'도 옛 태그를 소프트삭제 + 새 채택이라(FocusService.updateFocusTag)
        // 이름 변경 전 오늘 세션이 삭제 취급돼 복원 총합이 줄 수 있다. 클라에선 rename/delete 구분 불가 —
        // rename 시 오늘 세션 재연결은 BE 요청으로 등록(app/.docs/be-요청사항.md 7번).
        try {
          // 복원 조회는 SubjectContext와 공유 — 같은 스냅샷에서 계산해 자정 경계 불일치 제거(GROMO-920)
          const { sessions, tags } = await fetchTodayFocusRestore();
          if (sessions && tags) {
            const activeTagIds = new Set(tags.map((t) => t.tagId));
            // 세션 전체 길이가 아니라 '오늘 몫'만 더한다(GROMO-1252) — 자정을 걸친 세션은
            // 어제 몫을 잘라내야 홈 총합이 서버 날짜 버킷과 같아진다. 몫 산정은
            // todayRestoreSeconds(서버 확정 분포 우선, 없거나 축이 다르면 구간 겹침 폴백).
            const total = sessions
              .filter((s) => s.focusTagId === null || activeTagIds.has(s.focusTagId))
              .reduce((acc, s) => acc + todayRestoreSeconds(s), 0);
            // 복원 대기 중 들어온 적립분(고아 정산 등)을 덮지 않도록 대입이 아니라 가산(리뷰 반영)
            if (total > 0) setTodayFocusSeconds((prev) => Math.min(DAY_SECONDS, prev + total));
          }
        } catch {}
      }
      // 로드가 오늘 기준으로 리셋·복원을 끝냈으므로 여기서 롤오버 기준 날짜를 잡는다
      dayRef.current = todayStr();
      loaded.current = true;
      setReady(true);
    });
  }, []);

  useEffect(() => {
    if (!loaded.current) return;
    // 쓰기 직전에도 날짜 검증 — 자정을 넘긴 뒤의 변경이 어제 총합을 오늘 날짜 도장으로
    // 저장하지 않게(코드리뷰 반영). 롤오버만 하고 리턴 — 리셋된 값으로 이 effect가 다시 돈다.
    if (dayRef.current !== todayStr()) {
      rolloverIfNeeded();
      return;
    }
    AsyncStorage.setItem(
      STORAGE_KEYS.focus,
      JSON.stringify({
        todayFocusSeconds,
        date: todayStr(),
      }),
    );
  }, [todayFocusSeconds, rolloverIfNeeded]);

  function addFocusSeconds(seconds: number) {
    // 자정을 넘긴 뒤 첫 적립이면 어제 총합을 먼저 0으로 — 리셋 없이 더하면 어제+오늘이 섞인다
    rolloverIfNeeded();
    setTodayFocusSeconds((prev) => Math.min(DAY_SECONDS, prev + seconds));
  }

  // 과목 삭제 등으로 기록을 되돌릴 때 — 오늘치보다 크면 0으로 클램프.
  function removeFocusSeconds(seconds: number) {
    if (seconds <= 0) return;
    setTodayFocusSeconds((prev) => Math.max(0, prev - seconds));
  }

  return (
    <FocusContext.Provider
      value={{ todayFocusSeconds, ready, addFocusSeconds, removeFocusSeconds }}
    >
      {children}
    </FocusContext.Provider>
  );
}

export function useFocus(): FocusContextValue {
  const context = useContext(FocusContext);
  if (!context) throw new Error('useFocus must be used inside FocusProvider');
  return context;
}
