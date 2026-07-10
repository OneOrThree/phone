import { createContext, useContext, useState, useEffect, useRef, type ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { STORAGE_KEYS } from '@/types/storage';
import { fetchTodayFocusSessions, sessionFocusSeconds } from '@/screens/focus/focusRestore';
import { todayStr } from '@/utils/localDate';

interface FocusContextValue {
  todayFocusSeconds: number;
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
        // 과목 미분류 세션도 총합엔 포함. 실패하면 기존처럼 0에서 시작.
        try {
          const sessions = await fetchTodayFocusSessions();
          const total = sessions.reduce((acc, s) => acc + sessionFocusSeconds(s), 0);
          if (total > 0) setTodayFocusSeconds(total);
        } catch {}
      }
      loaded.current = true;
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
    <FocusContext.Provider value={{ todayFocusSeconds, addFocusSeconds, removeFocusSeconds }}>
      {children}
    </FocusContext.Provider>
  );
}

export function useFocus(): FocusContextValue {
  const context = useContext(FocusContext);
  if (!context) throw new Error('useFocus must be used inside FocusProvider');
  return context;
}
