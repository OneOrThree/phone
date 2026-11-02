// 첫 섬 온보딩 여정 계측(GROMO-2540). PostHog 「첫 섬 도착까지」·「섬 진입 경로별 도착률」 대시보드를 채운다.
// 계정의 '최초 여정'에만, 각 stage 를 한 번만 발행한다. 재로그인·추가 섬 가입·재설치로 새 여정을 만들지 않도록
// 발행한 stage 를 계정별(userId)로 저장하고, stage 는 앞 단계(prerequisite)가 그 계정에 기록돼 있을 때만 발행한다.
// 로그인 전 익명 식별자는 로그인 후 사용자와 posthog identify 로 연결된다(App.tsx identifyPostHogUser).
import AsyncStorage from '@react-native-async-storage/async-storage';
import { captureProductEvent } from '@/services/posthog';

const JOURNEY = 'first_island';

// 로그인 완료 이후의 계정 귀속 단계. login_viewed 는 익명이라 여기 두지 않는다.
export type ActivationStage =
  | 'login_completed'
  | 'profile_ready'
  | 'island_arrived'
  | 'first_focus_started'
  | 'first_focus_completed';

const key = (userId: string) => `gromo:activation:v1:${encodeURIComponent(userId)}`;
// 계정별 직렬 쓰기 — 동시 발행이 서로의 저장을 덮지 않게 한다(accountGuides 와 같은 방식).
const writes = new Map<string, Promise<string[]>>();

function parseStages(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const value = JSON.parse(raw);
    return Array.isArray(value) ? value.filter((s): s is string => typeof s === 'string') : [];
  } catch {
    return [];
  }
}

async function readStages(userId: string): Promise<string[]> {
  const pending = writes.get(userId);
  if (pending) await pending.catch(() => undefined);
  try {
    return parseStages(await AsyncStorage.getItem(key(userId)));
  } catch {
    return [];
  }
}

function addStage(userId: string, stage: string): Promise<string[]> {
  const prior = writes.get(userId);
  const write = (prior ?? Promise.resolve([] as string[]))
    .catch(() => [] as string[])
    .then(async () => {
      let current: string[] = [];
      try {
        current = parseStages(await AsyncStorage.getItem(key(userId)));
      } catch {
        current = [];
      }
      if (current.includes(stage)) return current;
      const next = [...current, stage];
      try {
        await AsyncStorage.setItem(key(userId), JSON.stringify(next));
      } catch {
        // 저장 실패는 다음 실행에서 다시 시도된다. 발행 자체는 막지 않는다.
      }
      return next;
    });
  writes.set(userId, write);
  void write
    .finally(() => {
      if (writes.get(userId) === write) writes.delete(userId);
    })
    .catch(() => undefined);
  return write;
}

function emit(stage: string, extra?: Record<string, string | number>, timestamp?: Date): void {
  captureProductEvent(
    'activation_step',
    {
      activation_schema_version: 1,
      journey: JOURNEY,
      stage,
      ...extra,
    },
    timestamp ? { timestamp } : undefined,
  );
}

let loginViewedEmitted = false;

/**
 * 로그인 화면 노출(stage=login_viewed). 익명이라 계정에 귀속하지 못하므로 앱 실행당 한 번만 발행하고,
 * 기존 계정 여부를 확정할 수 없는 분모 한계로 둔다. 로그인하면 posthog 가 이 익명 이벤트를 사용자와 잇는다.
 */
export function markLoginViewed(): void {
  if (loginViewedEmitted) return;
  loginViewedEmitted = true;
  emit('login_viewed');
}

/**
 * 로그인 완료 이후의 여정 stage 를 계정별로 한 번만 발행한다.
 * - 이미 발행한 stage 면 건너뛴다.
 * - prerequisite 가 그 계정에 아직 기록되지 않았으면 건너뛴다 — 그 계정의 '추적된 최초 여정'이 아니라는 뜻
 *   (재설치·기존 계정은 login_completed 부터 쌓이지 않으므로 뒤 단계가 발행되지 않는다).
 * login_completed 는 prerequisite 가 없다 — 호출부가 '신규 계정'일 때만 부른다.
 */
export async function markActivationStage(
  userId: string | undefined,
  stage: ActivationStage,
  opts: {
    prerequisite?: ActivationStage;
    extra?: Record<string, string | number>;
    // 서버 확정 시각으로 이벤트 시각을 덮어쓴다(예: 자동 종료 뒤 늦게 복구된 완료). 미지정이면 수집 시각.
    timestamp?: Date;
  } = {},
): Promise<void> {
  if (!userId) return;
  const stages = await readStages(userId);
  if (stages.includes(stage)) return;
  if (opts.prerequisite && !stages.includes(opts.prerequisite)) return;
  emit(stage, opts.extra, opts.timestamp);
  await addStage(userId, stage);
}

/** 테스트 격리용 — 실행당 1회 플래그를 되돌린다. */
export function resetActivationJourneyForTest(): void {
  loginViewedEmitted = false;
  writes.clear();
}
