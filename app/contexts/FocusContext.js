import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'gromo:focus';
const FocusContext = createContext(null);

function todayDateString() {
  return new Date().toISOString().slice(0, 10);
}

export function FocusProvider({ children }) {
  const [todayFocusSeconds, setTodayFocusSeconds] = useState(0);
  const loaded = useRef(false);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((raw) => {
      if (raw) {
        const saved = JSON.parse(raw);
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
      STORAGE_KEY,
      JSON.stringify({
        todayFocusSeconds,
        date: todayDateString(),
      }),
    );
  }, [todayFocusSeconds]);

  function addFocusSeconds(seconds) {
    setTodayFocusSeconds((prev) => prev + seconds);
  }

  return (
    <FocusContext.Provider value={{ todayFocusSeconds, addFocusSeconds }}>
      {children}
    </FocusContext.Provider>
  );
}

export function useFocus() {
  const context = useContext(FocusContext);
  if (!context) throw new Error('useFocus must be used inside FocusProvider');
  return context;
}
