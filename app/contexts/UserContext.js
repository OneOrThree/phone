import { createContext, useCallback, useContext, useRef, useState } from 'react';

const UserContext = createContext(null);

const PHONE_USAGE_SECONDS = 3 * 3600 + 28 * 60; // TODO: ScreenTime API 연동

export function UserProvider({ initialNickname, children }) {
  const [nickname, setNickname] = useState(initialNickname ?? '익명');
  const [goalSeconds, setGoalSecondsState] = useState(3 * 3600);
  const goalSecondsRef = useRef(3 * 3600);

  const setGoalSeconds = useCallback((v) => {
    goalSecondsRef.current = v;
    setGoalSecondsState(v);
  }, []);

  return (
    <UserContext.Provider
      value={{
        nickname,
        setNickname,
        goalSeconds,
        setGoalSeconds,
        goalSecondsRef,
        phoneUsageSeconds: PHONE_USAGE_SECONDS,
      }}
    >
      {children}
    </UserContext.Provider>
  );
}

export const useUser = () => useContext(UserContext);
