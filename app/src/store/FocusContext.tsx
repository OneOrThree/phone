import { createContext, useContext, useState, useEffect, useRef, type ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { STORAGE_KEYS } from '@/types/storage';
import { fetchTodayFocusRestore, sessionFocusSeconds } from '@/screens/focus/focusRestore';
import { todayStr } from '@/utils/localDate';

interface FocusContextValue {
  todayFocusSeconds: number;
  // 로컬 로드(+서버 복원) 완료 여부 — 복원 스냅샷이 이후 적립분을 덮지 않게
  // OrphanFocusSettler가 이걸 기다린다(리뷰 반영).
  ready: boolean;
  addFocusSeconds: (seconds: number) => void;
  removeFocusSeconds: (seconds: number) => void;
}

const FocusContext = createContext<FocusContextValue | null>(null);

interface SavedFocus {
  todayFocusSeconds?: number;
  date?: string;
}

export function FocusProvider({ children }: { children: ReactNode }) {
  const [todayFocusSeconds, setTodayFocusSeconds] = useState(0);
  const [ready, setReady] = useState(false);
  const loaded = useRef(false);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEYS.focus).then(async (raw) => {
      if (raw) {
        const saved = JSON.parse(raw) as SavedFocus;
        // 날짜가 바뀌면 오늘 집중 시간 초기화
        if (saved.date === todayStr()) {
          setTodayFocusSeconds(saved.todayFocusSeconds ?? 0);
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
            const total = sessions
              .filter((s) => s.focusTagId === null || activeTagIds.has(s.focusTagId))
              .reduce((acc, s) => acc + sessionFocusSeconds(s), 0);
            // 복원 대기 중 들어온 적립분(고아 정산 등)을 덮지 않도록 대입이 아니라 가산(리뷰 반영)
            if (total > 0) setTodayFocusSeconds((prev) => prev + total);
          }
        } catch {}
      }
      loaded.current = true;
      setReady(true);
    });
  }, []);

  useEffect(() => {
    if (!loaded.current) return;
    AsyncStorage.setItem(
      STORAGE_KEYS.focus,
      JSON.stringify({
        todayFocusSeconds,
        date: todayStr(),
      }),
    );
  }, [todayFocusSeconds]);

  function addFocusSeconds(seconds: number) {
    setTodayFocusSeconds((prev) => prev + seconds);
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
