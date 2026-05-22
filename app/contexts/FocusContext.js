import React, { createContext, useContext, useState } from 'react';

const FocusContext = createContext(null);

export function FocusProvider({ children }) {
  const [todayFocusSeconds, setTodayFocusSeconds] = useState(0);

  function addFocusSeconds(seconds) {
    setTodayFocusSeconds((prev) => prev + seconds);
  }

  return (
    <FocusContext.Provider
      value={{
        todayFocusSeconds,
        addFocusSeconds,
      }}
    >
      {children}
    </FocusContext.Provider>
  );
}

export function useFocus() {
  const context = useContext(FocusContext);

  if (!context) {
    throw new Error('useFocus must be used inside FocusProvider');
  }

  return context;
}