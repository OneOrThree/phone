import { createContext, useCallback, useContext, useRef, useState } from 'react';

const UserContext = createContext(null);

const PHONE_USAGE_SECONDS = 3 * 3600 + 28 * 60; // TODO: ScreenTime API 연동

export function UserProvider({
  initialNickname,
  initialUserId,
  initialGoalSeconds,
  initialIsNewUser,
  children,
}) {
  const [nickname, setNickname] = useState(initialNickname ?? '익명');
  const [userId] = useState(initialUserId ?? null);
  const [isNewUser, setIsNewUser] = useState(initialIsNewUser ?? false);
  const [goalSeconds, setGoalSecondsState] = useState(initialGoalSeconds ?? 3 * 3600);
  const goalSecondsRef = useRef(3 * 3600);

  const setGoalSeconds = useCallback((v) => {
    goalSecondsRef.current = v;
    setGoalSecondsState(v);
  }, []);

  return (
    <UserContext.Provider
      value={{
        userId,
        nickname,
        setNickname,
        isNewUser,
        setIsNewUser,
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
