/**
 * 실드 없는 집중에서 앱을 나갔을 때의 폴백(GROMO-2635). 1.x `leaveNotifications`·`OrphanFocusSettler` 이식.
 *
 * - 나가는 순간 서버 세션을 휴식(pause)으로 바꾼다 — 휴식 중에는 물고기 적립·황금 추첨이 멈추고 휴식 구간은
 *   집중 시간에서 빠진다(GROMO-2636 협의). 끝내 안 돌아오면 서버가 휴식 1시간 뒤 닫는다.
 * - 알림 2개(경고 1초 뒤 · 종료 안내 15초 뒤)를 예약하고, 돌아오면 취소한다.
 * - 15초 안에 돌아오면 이어서 집중(resume), 넘기면 끝낸다(finish). 나간 채 앱이 꺼졌으면 다음 실행에서 같은 판정을 한다.
 * - 실드 적용 세션·바다 항해(휴식이 없다)·이미 휴식 중인 세션·튜토리얼 세션은 건드리지 않는다.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { TimeIntervalTriggerInput } from 'expo-notifications';
import { useEffect, useState, type RefObject } from 'react';
import { AppState, Platform } from 'react-native';
import { t } from '@/i18n';
import { focusShieldApplied } from '@/services/focusShield';
import type { Session, State } from '@/services/model';
import { bridgedNotifications } from '@/services/push';
import { screenTimeNative } from '@/services/ScreenTimeModule';

/** 1.x LEAVE_END_S — 이보다 오래 나가 있으면 집중을 끝낸다. */
export const LEAVE_END_MS = 15_000;
/** 이만큼 백그라운드에 있다 오면 서버가 세션을 닫았는지 다시 본다 — 서버 방치 종결의 가장 짧은 기준(바다 3시간). */
export const ENDED_CHECK_MS = 3 * 60 * 60 * 1000;
const MARK_KEY = 'catus:focus-leave:v1';
// 고정 id — 다시 예약하면 덮어쓰고, 앱이 꺼졌다 켜져도 같은 id 로 지운다
const NOTIFICATION_IDS = ['catus-focus-leave-warn', 'catus-focus-leave-end'] as const;

export type LeaveMark = { sessionId: string; leftAt: number };
export type LeaveHandlers = {
  resume: () => void;
  finish: () => void;
  /** 서버가 세션을 이미 닫았는지 정본을 다시 읽어 맞춘다. */
  checkEnded: () => void;
};

/** 폴백을 걸 세션 — 진행 중인 서버 섬 집중. */
export const leaveTarget = (
  session: Session | null,
  tutorial?: State['tutorial'],
): session is Session =>
  !!session &&
  session.version != null &&
  session.status === 'active' &&
  session.kind !== 'sea' &&
  tutorial?.sessionId !== session.id;

/** 돌아왔을 때(또는 다음 실행에서) 할 일. 표시한 세션이 아니면 아무것도 하지 않는다. */
export const leaveSettlement = (
  mark: LeaveMark,
  session: Session | null,
  returnedAt: number,
): 'resume' | 'finish' | null => {
  if (!session || session.id !== mark.sessionId) return null;
  // 시계가 뒤로 가도 음수가 아니게 — 1.x 와 같은 하한
  if (Math.max(0, returnedAt - mark.leftAt) > LEAVE_END_MS) return 'finish';
  return session.status === 'paused' ? 'resume' : null;
};

// Android 는 화면을 끈(잠근) 것도 'background' 다 — 꺼진 화면은 나간 것으로 보지 않는다(2026-11-03 오스카 결정).
// iOS 는 잠금과 앱 이동을 가를 공식 방법이 없어 잠금도 나감이다. 함수가 없는 옛 바이너리는 화면이 켜진 것으로 본다.
const screenOff = async () =>
  Platform.OS === 'android' &&
  (await screenTimeNative?.isScreenInteractive?.().catch(() => true)) === false;

// Android 는 시스템 권한 창이 뜨는 것도 'background' 로 알린다 — 그동안은 나간 것으로 보지 않는다
let systemPrompts = 0;
/** 집중 중 시스템 권한 창을 띄우는 동안 이탈 폴백을 멈춘다. */
export async function duringSystemPrompt<T>(work: () => Promise<T>): Promise<T> {
  systemPrompts += 1;
  try {
    return await work();
  } finally {
    systemPrompts -= 1;
  }
}

// 나간 표시는 앱이 꺼져도 다음 실행이 이어 받도록 기기에 둔다. 세션 id 로 대조하므로 계정이 바뀌어도 남의 세션을 끝내지 않는다.
const saveMark = (mark: LeaveMark) =>
  AsyncStorage.setItem(MARK_KEY, JSON.stringify(mark)).catch(() => {});
const clearMark = () => AsyncStorage.removeItem(MARK_KEY).catch(() => {});
const takeMark = async (): Promise<LeaveMark | null> => {
  const raw = await AsyncStorage.getItem(MARK_KEY).catch(() => null);
  if (!raw) return null;
  await clearMark();
  try {
    const mark = JSON.parse(raw) as LeaveMark;
    return typeof mark?.sessionId === 'string' && Number.isFinite(mark.leftAt) ? mark : null;
  } catch {
    return null;
  }
};

// 예약·취소를 한 줄로 세운다 — 예약이 끝나기 전에 돌아와도 취소가 그 예약 뒤에 실행된다.
let notifications: Promise<unknown> = Promise.resolve();
const queueNotifications = (
  work: (N: NonNullable<ReturnType<typeof bridgedNotifications>>) => Promise<unknown>,
) => {
  const N = bridgedNotifications();
  if (N) notifications = notifications.then(() => work(N)).catch(() => {});
};
const scheduleLeaveNotifications = () =>
  // 권한은 묻지 않는다 — 없으면 OS 가 조용히 버리고, 폴백 판정은 알림과 무관하게 동작한다.
  queueNotifications((N) => {
    const after = (seconds: number): TimeIntervalTriggerInput => ({
      type: N.SchedulableTriggerInputTypes.TIME_INTERVAL,
      seconds,
      repeats: false,
    });
    return Promise.all([
      // 즉시(null)는 백그라운드 전환 직후 포그라운드 발송으로 취급돼 배너가 안 뜰 수 있어 1초 뒤로 둔다(1.x).
      N.scheduleNotificationAsync({
        identifier: NOTIFICATION_IDS[0],
        content: {
          title: t('focus.leave.warnTitle'),
          body: t('focus.leave.warnBody', { count: LEAVE_END_MS / 1000 }),
          sound: true,
        },
        trigger: after(1),
      }),
      N.scheduleNotificationAsync({
        identifier: NOTIFICATION_IDS[1],
        content: { title: t('focus.leave.endTitle'), body: t('focus.leave.endBody'), sound: true },
        trigger: after(LEAVE_END_MS / 1000),
      }),
    ]);
  });
const cancelLeaveNotifications = () =>
  queueNotifications((N) =>
    Promise.all(NOTIFICATION_IDS.map((id) => N.cancelScheduledNotificationAsync(id))),
  );

export function useFocusLeaveFallback({
  enabled,
  stateRef,
  pause,
  busy,
  handlers,
}: {
  /** 서버 세션을 쓰는 실제 앱(부팅 끝, 검토·데모 아님). */
  enabled: boolean;
  stateRef: RefObject<State>;
  pause: () => Promise<unknown>;
  /** 집중 명령(휴식·종료 등)이 진행 중인지 — 사용자가 누른 명령과 겹치지 않게 그동안은 나간 것으로 보지 않는다. */
  busy: () => boolean;
  /** 매 렌더의 App 핸들러 — 화면 이동이 그 렌더의 경로·기록을 보게 한다. */
  handlers: RefObject<LeaveHandlers | null>;
}) {
  // 판정은 다시 그린 뒤에 한다 — pause 응답이 넣은 세션(버전)을 stateRef 가 반영한 다음이어야 옛 버전으로 명령하지 않는다
  const [due, setDue] = useState<{ mark: LeaveMark; returnedAt: number } | null>(null);
  useEffect(() => {
    if (!due) return;
    setDue(null);
    const action = leaveSettlement(due.mark, stateRef.current.session, due.returnedAt);
    if (action) handlers.current?.[action]();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ref 만 더 읽는다
  }, [due]);
  useEffect(() => {
    if (!enabled || (Platform.OS !== 'ios' && Platform.OS !== 'android')) return;
    let alive = true;
    let mark: LeaveMark | null = null;
    let backgroundAt: number | null = null;
    // 앱 상태가 바뀔 때마다 오른다 — 늦게 끝난 처리가 그 뒤의 이탈·복귀를 덮지 않게
    let epoch = 0;
    // 나갈 때의 실드 확인·pause — 돌아오면 이것이 끝난 뒤에 판정한다
    let leaving: Promise<unknown> = Promise.resolve();
    // 나간 채 앱이 꺼졌던 집중 — 부팅 복구가 세션을 되살린 뒤 같은 판정을 한다
    void takeMark().then((m) => {
      if (!alive || !m) return;
      cancelLeaveNotifications();
      setDue({ mark: m, returnedAt: Date.now() });
    });
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'background') {
        const seq = ++epoch;
        backgroundAt = Date.now();
        const state = stateRef.current,
          session = state.session,
          notify = state.settings.notifications !== false;
        // 판정 전에 또 나갔다 — 표시는 처음 것을 두고 알림만 다시 건다(복귀 때 이미 지웠다)
        if (mark) {
          if (notify) scheduleLeaveNotifications();
          return;
        }
        if (systemPrompts > 0 || busy() || !leaveTarget(session, state.tutorial)) return;
        // 표시는 바로 단다 — 실드 확인 중에 'background' 가 또 와도 pause 를 두 번 보내지 않게
        const m: LeaveMark = { sessionId: session.id, leftAt: backgroundAt };
        mark = m;
        leaving = Promise.all([focusShieldApplied(), screenOff()])
          .then(async ([shielded, off]) => {
            // 실드가 걸렸거나, 화면을 껐거나, 확인하는 사이 돌아왔으면 아무것도 하지 않는다
            if (shielded || off || seq !== epoch) {
              if (mark === m) mark = null;
              return;
            }
            void saveMark(m);
            if (notify) scheduleLeaveNotifications();
            await pause();
          })
          .catch(() => {});
        return;
      }
      if (next !== 'active') return;
      const seq = ++epoch,
        returnedAt = Date.now(),
        away = backgroundAt == null ? 0 : returnedAt - backgroundAt;
      backgroundAt = null;
      // 알림은 돌아오자마자 지운다 — pause 응답이 늦어도 종료 안내가 뜨지 않게
      if (mark) cancelLeaveNotifications();
      void leaving.then(() => {
        // 그사이 다시 나갔으면 다음 복귀가 판정한다
        if (!alive || seq !== epoch) return;
        const m = mark;
        mark = null;
        if (m) {
          void clearMark();
          setDue({ mark: m, returnedAt });
        } else if (away >= ENDED_CHECK_MS && stateRef.current.session?.version != null)
          handlers.current?.checkEnded();
      });
    });
    return () => {
      alive = false;
      subscription.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ref 둘과 App 이 한 번 만든 명령(pause·busy)이라 바뀌지 않는다
  }, [enabled]);
}
