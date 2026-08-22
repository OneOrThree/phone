// 정산 저널 (GROMO-1600 — PRD §4.1-②·§4.3 「시작은 원자적이어야 한다」).
//
// 역할 분담: **저널 = 부팅 복구의 원장, 내구 큐(pendingFocusUploads) = 네트워크 재시도.**
// 겹치지 않는다 — settle intent는 업로드가 큐로 인계되는 순간(saved/alreadyEnded/queued)
// 소멸하고, 큐 저장까지 실패(failed)했을 때만 남아 다음 부팅의 복구가 재업로드한다.
// 그래서 이 파일은 pendingFocusUploads의 「직렬화 락」만 차용하고 3상 flush는 만들지 않는다.
//
// 원자적 시작(§4.3-ⓐ): `starting`→`active` 전이는 같은 저널 레코드의 setItem 원자 갱신 —
// 중간 상태가 없다. 복구(§4.3-ⓑ)는 미완 `starting`을 만나면 **v1 커밋 흔적을 먼저 확인**해,
// 있으면 실드를 풀지 않고 저널을 소급 완결하고, 없으면 실드 해제 + 저널 소거한다(실드만
// 남는 크래시 창 회수). 재생 중복은 서버가 (user, startedAt, endedAt, COMPLETED)로 걸러낸다
// (uploadFocusBlock 헤더 계약).

import AsyncStorage from '@react-native-async-storage/async-storage';
import { STORAGE_KEYS } from '@/types/storage';
import type { FocusSessionRequest } from '@/types/dto/focus';

export interface JournalSession {
  sessionKey: string;
  state: 'starting' | 'active';
  /** 실드 적용을 요청했는가 — write-ahead(실드 **전에** 기록)라 복구의 해제 판단 근거 */
  shieldRequested: boolean;
  serverSessionId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SettleIntent {
  intentId: string; // 멱등 키 — 재생이 겹쳐도 서버 dedupe + 제거 멱등으로 안전
  sessionKey: string;
  serverSessionId: string | null;
  body: FocusSessionRequest; // 태그 해석까지 끝난 완성 바디 — 재생은 그대로 업로드만 한다
  userId: string | null;
  createdAt: string;
}

interface FocusSessionJournal {
  version: 1;
  session: JournalSession | null;
  settles: SettleIntent[];
}

// intent 폭주 방어 — 정상 흐름에선 0~1개다(업로드 완료 즉시 소멸).
//
// ⚠️ **상한을 넘기면 가장 오래된 intent가 사라진다.** intent는 업로드와 내구 큐 저장이
// **둘 다** 실패했을 때만 남는 마지막 기록이라, 버리는 순간 로컬 적립만 되고 서버엔 없는
// 영구 불일치가 된다 — 이 PR이 고치려던 D1 결함이 상한 경계에서 재현되는 셈이다.
// 상한은 내구 큐(pendingFocusUploads, 50)와 맞춰 두되, 잔여 위험을 여기 남긴다:
// 이 지점에 닿으려면 **저장소 쓰기가 깨진 채 50블록**이 쌓여야 한다(POST 실패 + 큐 저장
// 실패가 연속). 그 상태면 저널 쓰기도 함께 실패할 가능성이 커서 실질 도달 확률은 낮다.
// 더 줄이려면 폐기를 계측해 가시화해야 하는데, 그건 이 티켓 범위 밖이다(GROMO-1616 후속).
const MAX_SETTLES = 50;

const EMPTY: FocusSessionJournal = { version: 1, session: null, settles: [] };

// 저장소 읽기-수정-쓰기 직렬화 — pendingFocusUploads.ts와 같은 패턴(락 밖 네트워크 없음).
let chain: Promise<unknown> = Promise.resolve();
function serialize<T>(task: () => Promise<T>): Promise<T> {
  const next = chain.then(task, task);
  chain = next.catch(() => {});
  return next;
}

async function read(): Promise<FocusSessionJournal> {
  const raw = await AsyncStorage.getItem(STORAGE_KEYS.focusJournalV1);
  if (!raw) return { ...EMPTY, settles: [] };
  try {
    const j = JSON.parse(raw) as FocusSessionJournal;
    if (j.version !== 1) return { ...EMPTY, settles: [] };
    return { version: 1, session: j.session ?? null, settles: j.settles ?? [] };
  } catch {
    return { ...EMPTY, settles: [] };
  }
}

async function write(j: FocusSessionJournal): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEYS.focusJournalV1, JSON.stringify(j));
}

function mutate(fn: (j: FocusSessionJournal) => FocusSessionJournal | null): Promise<void> {
  return serialize(async () => {
    const j = await read();
    const next = fn(j);
    if (next != null) await write(next);
  }).catch(() => {});
}

/** ⓪ write-ahead — 실드 적용 **전에** 시작 의도를 기록한다. 실패하면 조용히 계속(현행 UX 우선). */
export function journalStartIntent(sessionKey: string): Promise<void> {
  const now = new Date().toISOString();
  return mutate((j) => ({
    ...j,
    session: {
      sessionKey,
      state: 'starting',
      shieldRequested: true,
      serverSessionId: null,
      createdAt: now,
      updatedAt: now,
    },
  }));
}

/** ②의 짝 — 같은 레코드의 원자 갱신으로 starting→active 전이(중간 상태 없음, §4.3-ⓐ) */
export function journalActivateSession(sessionKey: string): Promise<void> {
  return mutate((j) => {
    if (j.session?.sessionKey !== sessionKey) return null;
    return {
      ...j,
      session: { ...j.session, state: 'active', updatedAt: new Date().toISOString() },
    };
  });
}

export function journalSetServerSessionId(sessionKey: string, id: string | null): Promise<void> {
  return mutate((j) => {
    if (j.session?.sessionKey !== sessionKey) return null;
    return {
      ...j,
      session: { ...j.session, serverSessionId: id, updatedAt: new Date().toISOString() },
    };
  });
}

/**
 * finish·실패 복구 — 세션 항목만 소거(잔여 settle intent는 그대로 재생 대상).
 *
 * `sessionKey`를 주면 **그 세션일 때만** 지운다. 이전 화면의 시작 정리가 뒤늦게 도착하는
 * 사이에 새 세션이 이미 `starting`을 기록했을 수 있는데, 무조건 지우면 새 시작의 저널이
 * 사라져 실드 적용 직후 크래시를 복구할 근거가 없어진다(직렬화 체인에서 순서가 뒤집힌다).
 */
export function journalClearSession(sessionKey?: string): Promise<void> {
  return mutate((j) => {
    if (sessionKey != null && j.session?.sessionKey !== sessionKey) return null;
    return { ...j, session: null };
  });
}

/**
 * 정산 의도 기록(D1) — settleFocusBlock이 업로드 **착수 전에** await로 남긴다.
 * 결과가 saved/alreadyEnded/queued면 resolveSettleIntent로 소멸, failed(큐 저장까지
 * 실패)면 보존 → 다음 부팅 recover가 같은 바디로 재업로드한다. 이것이 「업로드 failed에도
 * 화면이 레코드를 이미 지워 블록이 영구 유실」되던 공백(특성화 :839)의 수리다.
 */
export function recordSettleIntent(intent: SettleIntent): Promise<void> {
  return mutate((j) => ({
    ...j,
    // 같은 intentId면 **교체**한다 — 정산은 네트워크 대기 전에 먼저 기록하고(그 사이에
    // 죽으면 바디가 어디에도 없다), 태그·마커가 풀린 뒤 완성본으로 다시 부른다.
    settles: [...j.settles.filter((it) => it.intentId !== intent.intentId), intent].slice(
      -MAX_SETTLES,
    ),
  }));
}

export function resolveSettleIntent(intentId: string): Promise<void> {
  return mutate((j) => ({
    ...j,
    settles: j.settles.filter((it) => it.intentId !== intentId),
  }));
}

/** 복구 입력 — recoverFocusEngine(부팅 배선)이 읽는다. */
export function readJournal(): Promise<FocusSessionJournal> {
  return serialize(read);
}

export function clearJournal(): Promise<void> {
  return serialize(async () => {
    await AsyncStorage.removeItem(STORAGE_KEYS.focusJournalV1);
  }).catch(() => {});
}
