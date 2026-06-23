import { createContext, useContext, useState, useEffect, useRef, type ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { STORAGE_KEYS } from '@/types/storage';

interface FocusContextValue {
  todayFocusSeconds: number;
  addFocusSeconds: (seconds: number) => void;
}

const FocusContext = createContext<FocusContextValue | null>(null);

function todayDateString(): string {
  return new Date().toISOString().slice(0, 10);
}

interface SavedFocus {
  todayFocusSeconds?: number;
  date?: string;
}

export function FocusProvider({ children }: { children: ReactNode }) {
  const [todayFocusSeconds, setTodayFocusSeconds] = useState(0);
  const loaded = useRef(false);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEYS.focus).then((raw) => {
      if (raw) {
        const saved = JSON.parse(raw) as SavedFocus;
        // 날짜가 바뀌면 오늘 집중 시간 초기화
        if (saved.date === todayDateString()) {
          setTodayFocusSeconds(saved.todayFocusSeconds ?? 0);
        }
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
        date: todayDateString(),
      }),
    );
  }, [todayFocusSeconds]);

  function addFocusSeconds(seconds: number) {
    setTodayFocusSeconds((prev) => prev + seconds);
  }

  return (
    <FocusContext.Provider value={{ todayFocusSeconds, addFocusSeconds }}>
      {children}
    </FocusContext.Provider>
  );
}

export function useFocus(): FocusContextValue {
  const context = useContext(FocusContext);
  if (!context) throw new Error('useFocus must be used inside FocusProvider');
  return context;
}
