// ToastContext.tsx
// 앱 전역 토스트 큐. `Alert`가 하던 "읽고 흘려도 되는 성공 통보"를 대체한다(정책 D8).
//
// zustand·redux를 쓰지 않는 저장소라 다른 store/*Context.tsx와 같은 Context API 구조를 따른다.
//
// 사용법
//   const { show } = useToast();
//   show({ message: '집중 중에도 앱 3개를 쓸 수 있어요' });
//   show({ message: '저장에 실패했어요', tone: 'error' });
//
// 규칙
//  - 동시에 여러 번 불러도 **순차** 재생한다(겹쳐 쌓지 않는다). 2200ms 자동 해제, 탭하면 즉시 해제.
//  - 대체 대상은 성공 통보 + 선택지 없음뿐이다. 사용자 확인·분기·조치가 필요한 알럿은 Alert로 남긴다.
//  - RN Modal(SheetShell asModal 등) 안에서 부르면 배너가 모달 아래 깔린다 — 시트를 닫은 뒤 부를 것.
//    (Toast.tsx 헤더 주석의 배치 항목 참고)
//
// ⚠️ 접근성 — 플랫폼당 공지 경로 **하나**. 여기는 iOS 경로(announceForAccessibility)만 담당하고
//    안드로이드는 Toast.tsx의 accessibilityLiveRegion="polite"가 담당한다. 둘 다 걸면 안드로이드에서
//    같은 문구가 두 번 읽힌다(정책 D8).

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AccessibilityInfo, Platform } from 'react-native';
import { Toast, type ToastOptions } from '@/components/Toast';
import { M } from '@/constants/motion';
import { useMotion } from '@/hooks/useMotion';

export type { ToastOptions, ToastTone } from '@/components/Toast';

/** 자동 해제까지의 노출 시간. 짧은 한 줄 문구 기준 — 긴 경고문은 토스트로 옮기지 않는다. */
const AUTO_DISMISS_MS = 2200;

interface ToastContextValue {
  show: (options: ToastOptions) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

// id는 재생 단위 키다 — 다음 토스트가 바로 이어질 때 Toast를 remount시켜 등장 애니메이션을
// 다시 태우는 용도(같은 컴포넌트에 문구만 갈아끼우면 등장이 생략된다).
interface QueuedToast extends ToastOptions {
  id: number;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const m = useMotion();
  const queue = useRef<QueuedToast[]>([]);
  const seq = useRef(0);
  // 재생 중 여부를 ref로 둔다 — show()가 어느 렌더의 클로저에서 불려도 최신 상태를 본다.
  const playing = useRef(false);
  const [current, setCurrent] = useState<QueuedToast | null>(null);
  const [visible, setVisible] = useState(false);

  // 퇴장 시간만큼 언마운트를 미룬다. reduce면 0 — 타이머는 남기고 지연만 없앤다.
  const exitMs = m.delay(M.dur.quick);

  const playNext = useCallback(() => {
    if (playing.current) return;
    const next = queue.current.shift();
    if (!next) return;
    playing.current = true;
    setCurrent(next);
    setVisible(true);
  }, []);

  const show = useCallback(
    (options: ToastOptions) => {
      seq.current += 1;
      queue.current.push({ ...options, id: seq.current });
      playNext();
    },
    [playNext],
  );

  // iOS 공지 경로 — 새 문구가 올라올 때 1회. (안드로이드는 Toast.tsx의 라이브 리전)
  useEffect(() => {
    if (!current) return;
    if (Platform.OS === 'ios') AccessibilityInfo.announceForAccessibility(current.message);
  }, [current]);

  // 노출 → 퇴장 → 언마운트 → 다음 장. 타이머를 한 이펙트에 모아 tap 해제와 자동 해제가
  // 서로의 타이머를 남기지 않게 한다(visible이 바뀌면 cleanup이 이전 타이머를 지운다).
  useEffect(() => {
    if (!current) return undefined;
    if (visible) {
      const t = setTimeout(() => setVisible(false), AUTO_DISMISS_MS);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => {
      setCurrent(null);
      playing.current = false;
      playNext();
    }, exitMs);
    return () => clearTimeout(t);
  }, [current, visible, exitMs, playNext]);

  const value = useMemo<ToastContextValue>(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {current ? (
        <Toast
          key={current.id}
          message={current.message}
          tone={current.tone}
          icon={current.icon}
          visible={visible}
          onDismiss={() => setVisible(false)}
        />
      ) : null}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used inside ToastProvider');
  return context;
}
