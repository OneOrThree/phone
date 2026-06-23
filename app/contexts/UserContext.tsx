import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type RefObject,
  type SetStateAction,
} from 'react';

interface UserContextValue {
  userId: number | null;
  nickname: string;
  setNickname: Dispatch<SetStateAction<string>>;
  isNewUser: boolean;
  setIsNewUser: Dispatch<SetStateAction<boolean>>;
  goalSeconds: number;
  setGoalSeconds: (v: number) => void;
  goalSecondsRef: RefObject<number>;
  phoneUsageSeconds: number;
}

interface UserProviderProps {
  initialNickname?: string;
  initialUserId?: number | null;
  initialGoalSeconds?: number | null;
  initialIsNewUser?: boolean;
  children: ReactNode;
}

const UserContext = createContext<UserContextValue | null>(null);

const PHONE_USAGE_SECONDS = 3 * 3600 + 28 * 60; // TODO: ScreenTime API 연동

export function UserProvider({
  initialNickname,
  initialUserId,
  initialGoalSeconds,
  initialIsNewUser,
  children,
}: UserProviderProps) {
  const [nickname, setNickname] = useState(initialNickname ?? '익명');
  const [userId] = useState<number | null>(initialUserId ?? null);
  const [isNewUser, setIsNewUser] = useState(initialIsNewUser ?? false);
  const [goalSeconds, setGoalSecondsState] = useState(initialGoalSeconds ?? 3 * 3600);
  const goalSecondsRef = useRef(3 * 3600);

  const setGoalSeconds = useCallback((v: number) => {
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

export function useUser(): UserContextValue {
  const context = useContext(UserContext);
  if (!context) throw new Error('useUser must be used inside UserProvider');
  return context;
}
