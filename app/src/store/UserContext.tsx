import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type RefObject,
  type SetStateAction,
} from 'react';
import { setUserId } from '@/services/analytics';
import { setIdentityProps } from '@/services/analyticsEvents';

interface UserContextValue {
  userId: string | null;
  isGuest: boolean; // 게스트 세션 여부 (로그인 시점 태깅 → 서버 isGuest 응답 시 그 값)
  nickname: string;
  setNickname: Dispatch<SetStateAction<string>>;
  isNewUser: boolean;
  setIsNewUser: Dispatch<SetStateAction<boolean>>;
  goalSeconds: number; // 하루 목표 집중시간(공부)
  setGoalSeconds: (v: number) => void;
  goalSecondsRef: RefObject<number>;
  screenTimeGoalSeconds: number; // 하루 목표 사용시간(핸드폰)
  setScreenTimeGoalSeconds: (v: number) => void;
}

interface UserProviderProps {
  initialNickname?: string;
  initialUserId?: string | null;
  initialIsGuest?: boolean;
  initialGoalSeconds?: number | null; // 집중 목표(온보딩 17단계 dailyFocusMinutes)
  initialScreenTimeGoalSeconds?: number | null; // 사용시간 목표(온보딩 12단계 usageGoalMinutes)
  initialIsNewUser?: boolean;
  children: ReactNode;
}

const UserContext = createContext<UserContextValue | null>(null);

export function UserProvider({
  initialNickname,
  initialUserId,
  initialIsGuest,
  initialGoalSeconds,
  initialScreenTimeGoalSeconds,
  initialIsNewUser,
  children,
}: UserProviderProps) {
  const [nickname, setNickname] = useState(initialNickname ?? '익명');
  const [userId] = useState<string | null>(initialUserId ?? null);
  const isGuest = initialIsGuest ?? false;
  const [isNewUser, setIsNewUser] = useState(initialIsNewUser ?? false);
  const [goalSeconds, setGoalSecondsState] = useState(initialGoalSeconds ?? 3 * 3600);
  const [screenTimeGoalSeconds, setScreenTimeGoalSeconds] = useState(
    initialScreenTimeGoalSeconds ?? 4 * 3600,
  );
  const goalSecondsRef = useRef(3 * 3600);

  const setGoalSeconds = useCallback((v: number) => {
    goalSecondsRef.current = v;
    setGoalSecondsState(v);
  }, []);

  // GA4 User-ID / 게스트 여부 연결 (분석 식별의 단일 지점).
  // userId는 로그인/게스트 진입 시 1회 정해지고, 로그아웃 시 트리가 리마운트된다.
  useEffect(() => {
    setUserId(userId); // 게스트 포함 항상 JWT sub의 UUID(디코드 실패 시에만 null) — 게스트 구분은 is_guest
    setIdentityProps({ is_guest: isGuest });
  }, [userId, isGuest]);

  return (
    <UserContext.Provider
      value={{
        userId,
        isGuest,
        nickname,
        setNickname,
        isNewUser,
        setIsNewUser,
        goalSeconds,
        setGoalSeconds,
        goalSecondsRef,
        screenTimeGoalSeconds,
        setScreenTimeGoalSeconds,
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
