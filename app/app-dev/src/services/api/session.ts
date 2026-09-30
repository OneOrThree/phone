/**
 * 인증 세션 보관 — 토큰 저장소 + 세션 세대(generation).
 *
 * 토큰은 앱 상태(AsyncStorage `gromo-r61-user-v2` JSON 덩어리)와 **다른 곳**에 둔다. 리프레시 토큰은
 * 수명이 길고(서버 30일, 게스트는 더 길다) 평문 저장이면 기기에서 그대로 읽힌다 — iOS 키체인 /
 * 안드로이드 Keystore 를 쓰는 expo-secure-store 가 그 자리다. 웹은 보안 저장소가 없어
 * AsyncStorage 로 떨어진다(개발·리뷰 빌드 전용 경로다).
 *
 * ## 세션 세대
 * 레거시 `app/legacy/app-dev/src/services/api.ts` 에서 이식했다. 로그인·로그아웃처럼 **인증 세션
 * 자체가 교체될 때만** 올린다. 요청은 시작 시점의 세대를 들고 가고, 응답을 적용하기 전에 같은
 * 세대인지 본다 — 재로그인 경합에서 옛 계정의 늦은 응답이 새 계정을 덮거나 로그아웃시키는 것을
 * 막는 장치다. 토큰 갱신은 같은 세션의 연장이므로 올리지 않는다(현재 갱신 경로 자체가 없다 —
 * 2.0 공개 표면에 refresh 엔드포인트가 아직 없다).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

export interface Session {
  accessToken: string;
  refreshToken: string;
  userId: string;
}

const KEY_ACCESS = 'gromo.accessToken';
const KEY_REFRESH = 'gromo.refreshToken';
const KEY_USER = 'gromo.userId';
// 로그아웃은 자격 증명만 폐기한다. 재로그인 후 로컬 사용자 데이터의 소유자를 판정하는 데 쓴다.
const KEY_LAST_USER = 'gromo.lastUserId';
const KEY_LAST_USER_CLEAR_STATE = 'gromo.lastUserIdClearState';
/** AsyncStorage 에 삭제 의도를 못 남겼을 때 쓰는 보조 표식(SecureStore). */
const KEY_LAST_USER_CLEAR_PENDING_FALLBACK = 'gromo.lastUserIdClearPending';
/**
 * 채택 대기 표식 — 기록된 소유자와 다른 계정의 세션을 커밋하기 **전에** 남기고, 그 계정의 소유자
 * 기록이 끝나면 지운다. 소유자 표식이 없는 기기(업그레이드 직후)에서 로그인 저장 뒤 채택 전에
 * 앱이 종료되면, 다음 부팅이 「세션이 있으니 그 계정이 소유자」로 추론해 이전 사용자의 로컬 데이터를
 * 새 계정에 올린다. 이 표식이 남아 있으면 추론하지 않고 소유자 미상으로 격리한다.
 * 값은 채택 대상 userId 다 — 커밋이 실패하거나 포인터 교체 전에 종료돼 표식만 남아도, 복구된
 * 세션의 사용자와 같을 때만 대기로 본다. 그래야 커밋되지 않은 로그인의 표식이 기존 세션 사용자의
 * 데이터를 잘못 격리하지 않는다.
 */
const KEY_OWNER_ADOPTION_PENDING = 'gromo.ownerAdoptionPending';
/** 커밋 마커 — **항상 마지막에** 쓴다. 자세한 이유는 {@link saveSession}. */
const KEY_BUNDLE = 'gromo.sessionBundle';
const SESSION_SLOT_PREFIX = 'gromo.sessionSlot';
const SESSION_SLOTS = ['A', 'B'] as const;
const KEY_LEGACY_MIGRATED = 'gromo.legacySessionMigrated';
const KEY_LEGACY_PENDING_PROMOTION = 'gromo.legacySessionPendingPromotion';
// 키 이름은 Android 한정이던 때의 것을 유지한다 — 이미 기록된 표식을 계속 읽어야 한다.
const KEY_LOGOUT_PENDING = 'gromo.androidLegacyLogoutPending';
const LEGACY_ACCESS = 'gromo:accessToken';
const LEGACY_REFRESH = 'gromo:refreshToken';

// SecureStore 는 웹에 구현이 없어 호출하면 던진다. 네이티브에서만 쓴다.
const useSecureStore = Platform.OS !== 'web';

const readItem = (key: string): Promise<string | null> =>
  useSecureStore ? SecureStore.getItemAsync(key) : AsyncStorage.getItem(key);

const writeItem = (key: string, value: string): Promise<void> =>
  useSecureStore ? SecureStore.setItemAsync(key, value) : AsyncStorage.setItem(key, value);

const removeItem = (key: string): Promise<void> =>
  useSecureStore ? SecureStore.deleteItemAsync(key) : AsyncStorage.removeItem(key);

/**
 * 소유자를 알 수 없는 로컬 데이터의 소유자 값. 실제 사용자 ID와 겹치지 않으므로 복구된 세션과
 * 항상 불일치로 판정돼, 서버 확인 전까지 로컬 저장본을 올리지 않고 채택 때 비운다.
 */
export const UNOWNED_LOCAL_DATA_OWNER = '\u0000gromo.unownedLocalData';

let cached: Session | null = null;
let lastUserId: string | null = null;
let localDataOwnerClearPending = false;
let localDataOwnerIntentionallyUnset = false;
let generation = 0;
let onLost: (() => void) | null = null;
const listeners = new Set<(session: Session | null) => void>();

/** 세션 공개 상태 변경 구독. 등록 즉시 현재 snapshot을 알리고 이후 공개 전환도 알린다. */
export function subscribeSession(listener: (session: Session | null) => void): () => void {
  listeners.add(listener);
  try {
    listener(cached);
  } catch {
    // 화면 구독자가 실패해도 인증 저장소 전환을 중단하거나 다른 구독자를 막지 않는다.
  }
  return () => listeners.delete(listener);
}

function notifySessionChanged(): void {
  listeners.forEach((listener) => {
    try {
      listener(cached);
    } catch {
      // 구독자 하나의 렌더 실패는 durable token 삭제·다른 구독자에게 전파되지 않는다.
    }
  });
}

/**
 * 인증 상태를 바꾸는 저장소 작업(복구·저장·삭제)을 한 줄로 세운다 — 계정 LLD §3 전환 gate 1
 * 「single-flight 잠금으로 로그인·로그아웃·401 정리를 직렬화한다」.
 *
 * **잠금과 세대 검사 둘 다 필요하다.** 세대 재검사만 두면 검사와 공개 사이의 `commit()` 이 키마다
 * 양보하므로 그 틈에 끼어든 삭제와 쓰기가 섞여 저장소의 최종 상태가 정해지지 않는다. 직렬화만
 * 두면 로그아웃이 줄에 먼저 서도 뒤이은 **늦은 저장이 그대로 세션을 되살린다**. 그래서 잠금이
 * 「검사 → 저장 → 공개」를 쪼갤 수 없게 만들고, 그 안의 세대 검사가 늦은 저장을 버린다.
 *
 * 교착은 구조적으로 없다 — 잠금은 이 파일의 저장소 작업 **안에서만** 잡히고, 그 안에서 `request()`·
 * `notifySessionLost()` 같은 바깥 코드를 부르지 않는다. 401 정리(client)도 `logout()` 도 잠금을
 * 들고 들어오는 것이 아니라 줄 뒤에 설 뿐이라 서로를 기다리는 고리가 생기지 않는다.
 */
let queue: Promise<unknown> = Promise.resolve();

function serialized<T>(work: () => Promise<T>): Promise<T> {
  // 앞 작업이 던져도 줄은 계속 흐른다(then 의 두 자리에 같은 work).
  const done = queue.then(work, work);
  queue = done.catch(() => undefined);
  return done;
}

/** 요청이 시작된 시점의 세션 세대. 응답 적용 전에 다시 읽어 비교한다. */
export function sessionGeneration(): number {
  return generation;
}

/** 캐시된 세션. 복구(restoreSession) 전에는 null이다. */
export function getSession(): Session | null {
  return cached;
}

/** 현재 세션이 없어도 마지막으로 채택 완료한 로컬 데이터 소유자의 ID를 돌려준다. */
export function getLastSessionUserId(): string | null {
  if (localDataOwnerClearPending || (localDataOwnerIntentionallyUnset && !lastUserId)) return null;
  return lastUserId ?? cached?.userId ?? null;
}

/** Retry a durable owner invalidation. A failed retry must never expose the old owner. */
async function resolveLocalDataOwnerClear(): Promise<'normal' | 'cleared' | 'blocked'> {
  let pending: string | null;
  try {
    pending = await AsyncStorage.getItem(KEY_LAST_USER_CLEAR_STATE);
    // 주 표식을 못 남긴 탈퇴는 보조 표식에만 pending 이 있다. 'cleared' 가 이미 확정됐으면 무시한다.
    if (
      pending !== 'cleared' &&
      (await readItem(KEY_LAST_USER_CLEAR_PENDING_FALLBACK)) === 'pending'
    )
      pending = 'pending';
  } catch {
    localDataOwnerClearPending = true;
    lastUserId = null;
    return 'blocked';
  }
  if (pending !== 'pending' && pending !== 'cleared') {
    localDataOwnerClearPending = false;
    localDataOwnerIntentionallyUnset = false;
    return 'normal';
  }
  localDataOwnerIntentionallyUnset = true;
  if (pending === 'cleared') {
    localDataOwnerClearPending = false;
    return 'cleared';
  }
  localDataOwnerClearPending = true;
  lastUserId = null;
  try {
    await removeItem(KEY_LAST_USER);
    await AsyncStorage.setItem(KEY_LAST_USER_CLEAR_STATE, 'cleared');
    await removeItem(KEY_LAST_USER_CLEAR_PENDING_FALLBACK).catch(() => {});
    localDataOwnerClearPending = false;
    return 'cleared';
  } catch {
    return 'blocked';
  }
}

/** 계정 채택과 로컬 동기화가 모두 성공한 뒤, 아직 같은 세션일 때 데이터 소유자를 기록한다. */
export function rememberLocalDataOwner(
  userId: string,
  expectedGeneration?: number,
): Promise<boolean> {
  return serialized(async () => {
    const clearStatus = await resolveLocalDataOwnerClear();
    if (clearStatus === 'blocked') return false;
    if (
      cached?.userId !== userId ||
      (expectedGeneration !== undefined && generation !== expectedGeneration)
    )
      return false;
    await writeItem(KEY_LAST_USER, userId);
    lastUserId = userId;
    localDataOwnerClearPending = false;
    localDataOwnerIntentionallyUnset = false;
    // 소유자가 확정됐으니 채택 대기 표식을 내린다. 실패해도 소유자 표식이 있으면 표식은 읽히지 않는다.
    await removeItem(KEY_OWNER_ADOPTION_PENDING).catch(() => {});
    // 보조 표식이 남은 채 'cleared' 를 지우면 다음 부팅이 새 소유자를 탈퇴 대상으로 오인한다.
    if (
      clearStatus === 'cleared' &&
      (await removeItem(KEY_LAST_USER_CLEAR_PENDING_FALLBACK).then(
        () => true,
        () => false,
      ))
    )
      await AsyncStorage.removeItem(KEY_LAST_USER_CLEAR_STATE);
    return true;
  });
}

/** 탈퇴 성공처럼 로컬 사용자 데이터도 함께 폐기할 때 소유자 표식을 제거한다. */
export function clearLocalDataOwner(): Promise<void> {
  return serialized(async () => {
    lastUserId = null;
    localDataOwnerIntentionallyUnset = true;
    localDataOwnerClearPending = true;
    try {
      await AsyncStorage.setItem(KEY_LAST_USER_CLEAR_STATE, 'pending');
    } catch (error) {
      // 주 표식 기록이 실패해도 다음 부팅이 삭제를 재시도할 수 있게 보조 표식을 남긴다.
      // 둘 다 실패하면 소유자 값이라도 지워 본 뒤 실패를 알린다.
      try {
        await writeItem(KEY_LAST_USER_CLEAR_PENDING_FALLBACK, 'pending');
      } catch {
        await removeItem(KEY_LAST_USER).catch(() => {});
        throw error;
      }
    }
    await removeItem(KEY_LAST_USER);
    await AsyncStorage.setItem(KEY_LAST_USER_CLEAR_STATE, 'cleared');
    await removeItem(KEY_LAST_USER_CLEAR_PENDING_FALLBACK).catch(() => {});
    localDataOwnerClearPending = false;
  });
}

export function getAccessToken(): string | null {
  return cached?.accessToken ?? null;
}

/**
 * 앱 시작 시 저장소 → 메모리. 세션 «교체»가 아니므로 세대를 올리지 않는다.
 *
 * 세 값이 모두 **같은 커밋**의 것일 때만 세션으로 인정한다 — 계정 LLD §3 「정상 RT 회전의
 * 클라이언트 전환 gate」: 새 AT + 회전 전 RT 의 혼합은 subject·sid·세대가 같아도 완전한 쌍이
 * 아니고, 서버는 원자 저장이 검증되지 않은 클라이언트에 회전을 열지 않는다.
 */
export function restoreSession(): Promise<Session | null> {
  // 읽기도 줄에 세운다 — 로그아웃 «도중»에 읽으면 지워지는 중인 값을 세션으로 되살린다.
  return serialized(async () => {
    try {
      await finishInterruptedLogout();
      const bundle = await readItem(KEY_BUNDLE);
      cached = bundle ? await readBundledSession(bundle) : null;
      const ownerClearStatus = await resolveLocalDataOwnerClear();
      const savedLastUserId = ownerClearStatus === 'blocked' ? null : await readItem(KEY_LAST_USER);
      // 소유자 표식이 없을 때만 의미가 있다. 표식 값(채택 대상 userId)이 복구된 세션의 사용자와
      // 같을 때만 대기로 본다 — 다르면 커밋되지 못한 다른 로그인의 잔여 표식이다. 읽지 못하면
      // 채택 대기로 간주한다 — 추론이 틀리면 이전 사용자의 데이터가 다른 계정에 올라가므로,
      // 모르면 격리하는 쪽이 안전하다.
      const adoptionPending =
        ownerClearStatus === 'normal' && !savedLastUserId
          ? await readItem(KEY_OWNER_ADOPTION_PENDING).then(
              (value) => value !== null && value === cached?.userId,
              () => true,
            )
          : false;
      // 저장된 소유자가 있으면 활성 세션과 달라도 유지한다. 로그인 저장만 끝나고 /me 채택이
      // 실패한 전환을 재시도할 때 이전 로컬 소유자 기준으로 reset 여부를 다시 판단해야 한다.
      // 채택 대기 중이면 세션이 있다는 사실만으로 소유자를 추론하지 않는다 — 소유자 미상이다.
      lastUserId =
        ownerClearStatus === 'normal'
          ? (savedLastUserId ??
            (adoptionPending ? UNOWNED_LOCAL_DATA_OWNER : (cached?.userId ?? null)))
          : savedLastUserId;
      localDataOwnerIntentionallyUnset = ownerClearStatus !== 'normal' && !savedLastUserId;
      if (ownerClearStatus === 'normal' && cached && !savedLastUserId && !adoptionPending) {
        lastUserId = cached.userId;
        await writeItem(KEY_LAST_USER, cached.userId).catch(() => {});
      }
      // Android 1.x는 토큰을 AsyncStorage 평문 키에 저장했다. 현재 커밋 마커가 없을 때만
      // 한 번 가져온다. 기존 bundle이 손상된 경우에는 구 토큰으로 우회 복구하지 않는다.
      if (!bundle && Platform.OS === 'android') {
        cached = await migrateLegacySession();
        if (ownerClearStatus === 'normal' && cached && !lastUserId) {
          lastUserId = cached.userId;
          await writeItem(KEY_LAST_USER, cached.userId).catch(() => {});
        }
      }
    } catch {
      // 키체인 접근 실패(잠긴 기기 등)를 로그인 상태로 오인하지 않는다.
      cached = null;
    }
    notifySessionChanged();
    return cached;
  });
}

async function migrateLegacySession(): Promise<Session | null> {
  if (await finishInterruptedLogout()) return null;
  if ((await SecureStore.getItemAsync(KEY_LEGACY_MIGRATED)) === '1') return null;
  const [legacyAccess, legacyRefresh] = await Promise.all([
    AsyncStorage.getItem(LEGACY_ACCESS),
    AsyncStorage.getItem(LEGACY_REFRESH),
  ]);
  if (!legacyAccess && !legacyRefresh) return null;

  const accessToken = legacyAccess?.trim();
  const refreshToken = legacyRefresh?.trim();
  const userId = accessToken ? subjectFromToken(accessToken) : null;
  if (!accessToken || !refreshToken || !userId) {
    // 유효성을 확인할 수 없어도 레거시 자격 증명은 자동으로 폐기하지 않는다.
    return null;
  }

  const session = { accessToken, refreshToken, userId };
  // pending 보호 표식을 secure bundle보다 먼저 기록한다. 순서가 반대면 bundle 커밋 직후
  // 프로세스가 죽었을 때 다음 부팅의 /me 401이 pending을 못 보고 legacy 원본까지 지울 수 있다.
  // 표식 기록에 실패하면 commit을 시작하지 않아 원본 RT를 보호할 수 없는 복사본을 만들지 않는다.
  await SecureStore.setItemAsync(KEY_LEGACY_PENDING_PROMOTION, '1');
  // 구 키는 SecureStore 복사만으로 폐기하지 않는다. legacy refresh 계약은 멱등하지 않아
  // 자동 회전하면 응답 유실 시 원 RT와 회전된 RT를 모두 잃을 수 있다. /me만 확인하고
  // 서버에 안전한 전환 계약이 생길 때까지 원본과 pending 표시를 유지한다.
  await commit(session);
  return session;
}

/** 로그아웃 tombstone을 어느 저장소에도 기록하지 못했다. 세션은 그대로 남아 있다. */
export class LogoutNotDurableError extends Error {
  constructor(readonly cause: unknown) {
    super('로그아웃 상태를 기기에 기록하지 못했어요.');
    this.name = 'LogoutNotDurableError';
  }
}

async function writeLogoutTombstone(): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY_LOGOUT_PENDING, '1');
  } catch (error) {
    try {
      await writeItem(KEY_LOGOUT_PENDING, '1');
    } catch {
      throw new LogoutNotDurableError(error);
    }
  }
}

/**
 * 명시 로그아웃의 첫 단계. 세션을 지우기 전에 모든 플랫폼에서 tombstone을 남긴다 — 삭제가
 * 실패하거나 정리 전에 앱이 종료돼도 다음 복구가 로그아웃을 마저 끝낸다. 기록하지 못하면
 * 아무것도 바꾸지 않고 {@link LogoutNotDurableError}를 던진다. 화면은 이 결과를 보고
 * 로그인 화면 전환 여부를 정한다 — 실패한 로그아웃을 성공처럼 보여 주면 재실행 때 계정이 복구된다.
 */
export function prepareExplicitLogout(
  markIntent?: () => Promise<void>,
  withdrawIntent?: () => Promise<void>,
): Promise<void> {
  // 세션 줄 안에서 실행한다 — 뒤이어 줄에 선 clearSession 보다 늦은 로그인 저장이 앞서지 못한다.
  return serialized(async () => {
    await markIntent?.();
    try {
      await writeLogoutTombstone();
    } catch (error) {
      await withdrawIntent?.();
      throw error;
    }
  });
}

/** An explicit logout must win over a crash before session (and Android legacy RT) cleanup completes. */
async function finishInterruptedLogout(): Promise<boolean> {
  const [asyncMarker, secureMarker] = await Promise.all([
    AsyncStorage.getItem(KEY_LOGOUT_PENDING),
    readItem(KEY_LOGOUT_PENDING),
  ]);
  if (asyncMarker !== '1' && secureMarker !== '1') return false;
  const failed: unknown[] = [];
  const swallow = (error: unknown): void => void failed.push(error);
  await removeItem(KEY_BUNDLE).catch(swallow);
  await Promise.all([
    removeItem(KEY_ACCESS).catch(swallow),
    removeItem(KEY_REFRESH).catch(swallow),
    removeItem(KEY_USER).catch(swallow),
    ...SESSION_SLOTS.flatMap((slot) => {
      const prefix = `${SESSION_SLOT_PREFIX}.${slot}`;
      return [
        removeItem(`${prefix}.accessToken`).catch(swallow),
        removeItem(`${prefix}.refreshToken`).catch(swallow),
        removeItem(`${prefix}.userId`).catch(swallow),
      ];
    }),
    ...(Platform.OS === 'android'
      ? [
          AsyncStorage.removeItem(LEGACY_ACCESS).catch(swallow),
          AsyncStorage.removeItem(LEGACY_REFRESH).catch(swallow),
          removeItem(KEY_LEGACY_PENDING_PROMOTION).catch(swallow),
        ]
      : []),
  ]);
  if (failed.length) throw failed[0];
  await AsyncStorage.removeItem(KEY_LOGOUT_PENDING);
  await removeItem(KEY_LOGOUT_PENDING);
  return true;
}

/** 현재 세션이 서버 승격/검증을 기다리는 Android legacy 복사본인지 확인한다. */
export async function isLegacySessionPendingPromotion(): Promise<boolean> {
  return (
    Platform.OS === 'android' &&
    (await SecureStore.getItemAsync(KEY_LEGACY_PENDING_PROMOTION)) === '1'
  );
}

/** JWT 페이로드의 `sub`(서명 검증 없음) — 저장된 토큰의 소유 계정 판정용. 읽지 못하면 null. */
export function subjectFromToken(token: string): string | null {
  try {
    const encoded = token.split('.')[1];
    if (!encoded) return null;
    const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(atob(base64)) as { sub?: unknown };
    return typeof payload.sub === 'string' && payload.sub.trim() ? payload.sub.trim() : null;
  } catch {
    return null;
  }
}

/** 세 값이 모두 `bundle` 태그를 달고 있을 때만 세션이다. 하나라도 어긋나면 찢어진 저장이다. */
function unbundled(bundle: string, ...values: (string | null)[]): Session | null {
  const prefix = `${bundle}.`;
  const [accessToken, refreshToken, userId] = values.map((v) =>
    v && v.startsWith(prefix) ? v.slice(prefix.length) : null,
  );
  return accessToken && refreshToken && userId ? { accessToken, refreshToken, userId } : null;
}

function parseSlotMarker(
  bundle: string,
): { slot: (typeof SESSION_SLOTS)[number]; id: string } | null {
  const match = /^slot([AB]):(.+)$/.exec(bundle);
  if (!match) return null;
  return { slot: match[1] as (typeof SESSION_SLOTS)[number], id: match[2] };
}

async function readBundledSession(bundle: string): Promise<Session | null> {
  const marker = parseSlotMarker(bundle);
  if (!marker) {
    // 이전 앱 버전은 고정 키 세 개를 직접 덮어썼다. 기존 커밋은 읽되, 다음 저장부터
    // 비활성 슬롯으로 옮겨 이후 갱신이 기존 유효 RT를 파괴하지 않게 한다.
    const [accessToken, refreshToken, userId] = await Promise.all([
      readItem(KEY_ACCESS),
      readItem(KEY_REFRESH),
      readItem(KEY_USER),
    ]);
    return unbundled(bundle, accessToken, refreshToken, userId);
  }
  const prefix = `${SESSION_SLOT_PREFIX}.${marker.slot}`;
  const [accessToken, refreshToken, userId] = await Promise.all([
    readItem(`${prefix}.accessToken`),
    readItem(`${prefix}.refreshToken`),
    readItem(`${prefix}.userId`),
  ]);
  return unbundled(marker.id, accessToken, refreshToken, userId);
}

/**
 * 세 값 + 커밋 마커를 저장소에 쓴다. 값은 현재 활성 슬롯과 다른 슬롯에 기록하고,
 * 포인터 마커는 **마지막**에 바꾼다. 도중 종료돼도 기존 슬롯과 유효 RT는 그대로 남는다.
 *
 * SecureStore 는 여러 키를 한 트랜잭션으로 쓰지 못하고, 값 하나에 몰아넣기엔 Android 상한
 * (2KiB)이 걸린다. 슬롯을 번갈아 사용하므로 쓰기 중 이전 커밋은 덮이지 않는다. 중간에 죽으면
 * 포인터가 이전 슬롯을 가리키고, 완료 후 새 포인터가 새 슬롯 전체를 가리킨다.
 */
async function commit(session: Session): Promise<void> {
  const bundleId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  const previousMarker = await readItem(KEY_BUNDLE);
  const active = previousMarker ? parseSlotMarker(previousMarker)?.slot : null;
  const slot = active === 'A' ? 'B' : 'A';
  const prefix = `${SESSION_SLOT_PREFIX}.${slot}`;
  // ⚠️ `Promise.all` 이 아니라 **allSettled** 다. all 은 첫 실패에서 즉시 던지고 남은 쓰기를
  // 기다리지 않는데, 그러면 {@link saveSession} 의 되돌리기가 이전 snapshot 과 새 마커를 쓴 «뒤에»
  // 그 늦은 쓰기가 착지해 마커와 값의 bundleId 가 어긋난다 — 멀쩡하던 이전 세션까지 복구가
  // 거부돼 저장 실패 한 번이 로그아웃으로 번진다. 모든 쓰기가 정착한 뒤에 실패를 알린다.
  const writes = await Promise.allSettled([
    writeItem(`${prefix}.accessToken`, `${bundleId}.${session.accessToken}`),
    writeItem(`${prefix}.refreshToken`, `${bundleId}.${session.refreshToken}`),
    writeItem(`${prefix}.userId`, `${bundleId}.${session.userId}`),
  ]);
  const failure = writes.find((w): w is PromiseRejectedResult => w.status === 'rejected');
  if (failure) throw failure.reason;
  try {
    await writeItem(KEY_BUNDLE, `slot${slot}:${bundleId}`);
  } catch (error) {
    // 포인터 쓰기가 실패하면 기존 포인터를 복원한다. 값 슬롯은 별도라 이 복구 중 종료되어도
    // 이전 세션을 계속 읽을 수 있고, 이전 커밋이 없었던 경우에는 미완료 세션을 숨긴다.
    if (previousMarker) await writeItem(KEY_BUNDLE, previousMarker).catch(() => {});
    else await removeItem(KEY_BUNDLE).catch(() => {});
    throw error;
  }
}

/**
 * 세션을 **커밋이 끝난 뒤에** 공개한다(계정 LLD §2.4 「commit 표지·완전한 세션 snapshot 확정」).
 *
 * 메모리 세션·세대를 먼저 바꾸면 부분 실패에서 화면은 「전환 실패」인데 요청은 새 계정 토큰으로
 * 나가고, 재시작해도 이전 세션이 복구되지 않는다. 그래서 비활성 슬롯 3키 + 포인터가
 * 모두 쓰인 뒤에만 `cached`·세대를 교체한다. 쓰기 실패 시 활성 슬롯과 메모리는 유지된다.
 *
 * @param expectedGeneration 호출부가 **요청을 시작할 때** 잡아 둔 세대. 임계구역에 들어간 시점에
 *   세대가 달라졌으면(그 사이 로그아웃이나 다른 로그인이 끝났으면) 저장을 **버린다** — 늦게
 *   도착한 저장이 이미 끝난 로그아웃을 되살리거나 새 계정 세션을 덮는 것을 막는다({@link queue}).
 * @returns 공개했으면 true, 세대가 바뀌어 버렸으면 false. 저장소 실패는 그대로 던진다.
 */
export function saveSession(
  session: Session,
  expectedGeneration?: number,
  onPublished?: (session: Session, generation: number) => void,
): Promise<boolean> {
  return serialized(async () => {
    if (expectedGeneration !== undefined && expectedGeneration !== generation) return false;
    // 기록된 소유자와 다른 계정이면 채택이 끝나기 전까지 소유자를 추론하지 못하게 표식을 남긴다
    // (아래). 그 표식은 앞선 채택 대기 표식(커밋은 됐고 채택 전 종료된 세션의 것)을 덮어쓰므로,
    // 커밋 실패 시 되돌릴 이전 값을 **무엇이든 쓰기 전에** 읽어 둔다. 읽지 못하면 저장을 실패로
    // 돌린다 — 되돌릴 값을 모르는 채 진행했다가 커밋이 실패하면 표식은 새 계정(B)으로, 세션은
    // 이전 계정(A)으로 남아, 다음 부팅이 「표식 불일치 → 세션 사용자 A 가 소유자」로 추론한다.
    // 이 표식이 막으려던 바로 그 추론이다. 모르면 진행하지 않는다(미상 → 격리·실패 원칙).
    const markAdoption = session.userId !== lastUserId;
    const previousAdoptionMarker = markAdoption ? await readItem(KEY_OWNER_ADOPTION_PENDING) : null;
    // 삭제 일부가 실패해 남은 로그아웃 tombstone은 새 세션 커밋 전에 마저 처리한다.
    // 그대로 두면 다음 부팅의 정리가 방금 로그인한 세션까지 지운다.
    await finishInterruptedLogout();
    if (Platform.OS === 'android') {
      // 새 로그인 세션은 레거시 복사본이 아니다. 보존 표식이 남으면 이 세션의 401 정리가 레거시로
      // 오인해 원본을 남기고, 다음 부팅의 마이그레이션이 이전 사용자 토큰을 다시 복사한다.
      // 재복사 차단 표식을 커밋 전에 기록하고, 기록하지 못하면 로그인을 실패로 돌린다.
      await SecureStore.setItemAsync(KEY_LEGACY_MIGRATED, '1');
    }
    // 채택 대기 표식을 커밋 전에 남긴다. 기록하지 못하면 커밋하지 않는다 — 채택 전 종료 시 이전
    // 데이터가 새 계정에 올라간다. 값은 채택 대상 userId 다(부팅 판정은 복구된 세션 사용자와 같을
    // 때만 대기로 본다).
    if (markAdoption) await writeItem(KEY_OWNER_ADOPTION_PENDING, session.userId);
    try {
      await commit(session);
    } catch (error) {
      // 커밋 실패 — 방금 쓴 표식을 이전 값으로 best-effort 복원한다. 복원이 실패해 남아도 값이
      // 복구될 (이전) 세션의 사용자와 다르면 부팅 판정에서 무시되므로 실패는 삼킨다.
      if (markAdoption)
        await (
          previousAdoptionMarker === null
            ? removeItem(KEY_OWNER_ADOPTION_PENDING)
            : writeItem(KEY_OWNER_ADOPTION_PENDING, previousAdoptionMarker)
        ).catch(() => {});
      throw error;
    }
    if (Platform.OS === 'android') {
      await Promise.all([
        removeItem(KEY_LEGACY_PENDING_PROMOTION).catch(() => {}),
        AsyncStorage.removeItem(LEGACY_ACCESS).catch(() => {}),
        AsyncStorage.removeItem(LEGACY_REFRESH).catch(() => {}),
      ]);
    }
    cached = session;
    generation += 1;
    try {
      onPublished?.(session, generation);
    } catch {
      // 관측 훅 실패는 이미 커밋된 세션 공개를 막지 않는다.
    }
    notifySessionChanged();
    return true;
  });
}

/**
 * 같은 세션의 AT 갱신을 저장한다. 로그인/로그아웃 fence와 bundle marker를 재사용하지만
 * session generation은 올리지 않는다. 응답이 늦어 다른 RT나 세션이 공개됐다면 아무것도 쓰지 않는다.
 */
export function saveRefreshedSession(
  accessToken: string,
  refreshToken: string | null,
  expectedGeneration: number,
  expectedAccessToken: string,
  expectedRefreshToken: string,
): Promise<Session | null> {
  return serialized(async () => {
    const previous = cached;
    if (
      !previous ||
      generation !== expectedGeneration ||
      previous.accessToken !== expectedAccessToken ||
      previous.refreshToken !== expectedRefreshToken
    )
      return null;

    const updated: Session = {
      ...previous,
      accessToken,
      refreshToken: refreshToken ?? previous.refreshToken,
    };
    await commit(updated);
    if (generation !== expectedGeneration || cached !== previous) return null;
    cached = updated;
    notifySessionChanged();
    return updated;
  });
}

/**
 * 마커를 **먼저** 지운다 — 뒤의 삭제가 실패해도 남은 값이 세션으로 복구되지 않는다.
 * 마커 삭제가 실패해도 나머지 셋은 계속 지운다: 하나만 사라져도 복구는 거부되므로
 * 「마커 삭제 실패 → 값이 통째로 남아 다음 실행에 되살아나는 세션」이 생기지 않는다.
 *
 * @param expectedGeneration {@link saveSession} 과 **대칭인 fence**. 큐 바깥에서 한 세대 검사는
 *   「저장이 끝나기 전」의 값이라, 그 사이 공개된 새 세션을 뒤늦게 지운다 — 계정 전환 중 옛 세션의
 *   401 이 방금 채택한 새 세션을 끊는 경로다. 그래서 임계구역 **안에서** 다시 본다. 사용자가 직접
 *   누른 로그아웃은 무조건 이겨야 하므로 생략한다(= fence 없음).
 * @returns 실제로 지운 세션. fence 에 걸려 건너뛰었으면 null이고 저장소는 건드리지 않는다.
 *   줄 앞에서 다른 로그인이 먼저 공개했으면 호출부가 읽어 둔 것과 **다른** 세션이다 — 서버
 *   폐기 대상은 이쪽이다({@link queue}).
 */
export function clearSession(
  expectedGeneration?: number,
  preserveLegacy = false,
  explicitLogout = false,
  precondition?: Promise<void>,
): Promise<Session | null> {
  return serialized(async () => {
    // 명시 로그아웃 준비(tombstone 등)가 실패했으면 아무것도 지우지 않는다.
    if (precondition) await precondition;
    if (expectedGeneration !== undefined && expectedGeneration !== generation) return null;
    const failed: unknown[] = [];
    const swallow = (error: unknown): void => void failed.push(error);
    let logoutTombstoneWritten = false;
    if (explicitLogout) {
      // Without a durable tombstone, do not invalidate the bundle: a crash could migrate legacy RT.
      // 준비 단계가 이미 tombstone을 확정했으면 다시 쓰지 않는다 — 두 번째 쓰기 실패가 화면은
      // 로그아웃인데 세션만 남기는 결과를 만든다.
      if (!precondition) await writeLogoutTombstone();
      logoutTombstoneWritten = true;
    }
    const cleared = cached;
    cached = null;
    generation += 1;
    notifySessionChanged();
    await removeItem(KEY_BUNDLE).catch(swallow);
    await Promise.all([
      removeItem(KEY_ACCESS).catch(swallow),
      removeItem(KEY_REFRESH).catch(swallow),
      removeItem(KEY_USER).catch(swallow),
      ...SESSION_SLOTS.flatMap((slot) => {
        const prefix = `${SESSION_SLOT_PREFIX}.${slot}`;
        return [
          removeItem(`${prefix}.accessToken`).catch(swallow),
          removeItem(`${prefix}.refreshToken`).catch(swallow),
          removeItem(`${prefix}.userId`).catch(swallow),
        ];
      }),
    ]);
    if (Platform.OS === 'android' && !preserveLegacy) {
      await Promise.all([
        AsyncStorage.removeItem(LEGACY_ACCESS).catch(swallow),
        AsyncStorage.removeItem(LEGACY_REFRESH).catch(swallow),
      ]);
      await removeItem(KEY_LEGACY_PENDING_PROMOTION).catch(swallow);
    }
    if (logoutTombstoneWritten && failed.length === 0) {
      await AsyncStorage.removeItem(KEY_LOGOUT_PENDING).catch(swallow);
      await removeItem(KEY_LOGOUT_PENDING).catch(swallow);
    }
    if (failed.length > 0) throw failed[0];
    return cleared;
  });
}

/**
 * 서버가 거절한 세션(401·`USER_NOT_FOUND`)의 정리. 「**정말로 정리했는가**」만 돌려준다.
 *
 * 저장소 삭제 실패는 삼키되 **true** 다 — fence 에 걸리면 저장소를 건드리지 않고 즉시 돌아오므로,
 * 던졌다는 것 자체가 fence 를 통과해 정리에 들어갔다는 뜻이다. 메모리 세션·세대는 삭제보다 먼저
 * 비우니 화면을 로그인으로 되돌려도 된다. false 면 그 사이 세션이 교체된 것이라, 옛 세션의 거절
 * 판정으로 새 세션을 끊지 않는다. pending 표식을 읽지 못하면 legacy 원본은 보존 대상으로 간주하되,
 * secure copy 정리와 generation fence는 그대로 수행한다.
 */
export function clearRejectedSession(expectedGeneration: number): Promise<boolean> {
  return isLegacySessionPendingPromotion()
    .catch(() => true)
    .then((preserveLegacy) => clearSession(expectedGeneration, preserveLegacy))
    .then(
      (cleared) => cleared !== null,
      () => true,
    );
}

/**
 * 세션이 서버에서 거절됐을 때(401) 불린다. 화면이 로그인으로 돌아가라는 신호이고,
 * 저장소 정리는 부르는 쪽(client)이 이미 끝낸 상태다.
 */
export function setSessionLostHandler(fn: (() => void) | null): void {
  onLost = fn;
}

export function notifySessionLost(): void {
  onLost?.();
}
