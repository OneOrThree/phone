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
/** 커밋 마커 — **항상 마지막에** 쓴다. 자세한 이유는 {@link saveSession}. */
const KEY_BUNDLE = 'gromo.sessionBundle';

// SecureStore 는 웹에 구현이 없어 호출하면 던진다. 네이티브에서만 쓴다.
const useSecureStore = Platform.OS !== 'web';

const readItem = (key: string): Promise<string | null> =>
  useSecureStore ? SecureStore.getItemAsync(key) : AsyncStorage.getItem(key);

const writeItem = (key: string, value: string): Promise<void> =>
  useSecureStore ? SecureStore.setItemAsync(key, value) : AsyncStorage.setItem(key, value);

const removeItem = (key: string): Promise<void> =>
  useSecureStore ? SecureStore.deleteItemAsync(key) : AsyncStorage.removeItem(key);

let cached: Session | null = null;
let generation = 0;
let onLost: (() => void) | null = null;

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
      const [bundle, accessToken, refreshToken, userId] = await Promise.all([
        readItem(KEY_BUNDLE),
        readItem(KEY_ACCESS),
        readItem(KEY_REFRESH),
        readItem(KEY_USER),
      ]);
      cached = bundle ? unbundled(bundle, accessToken, refreshToken, userId) : null;
    } catch {
      // 키체인 접근 실패(잠긴 기기 등)를 로그인 상태로 오인하지 않는다.
      cached = null;
    }
    return cached;
  });
}

/** 세 값이 모두 `bundle` 태그를 달고 있을 때만 세션이다. 하나라도 어긋나면 찢어진 저장이다. */
function unbundled(bundle: string, ...values: (string | null)[]): Session | null {
  const prefix = `${bundle}.`;
  const [accessToken, refreshToken, userId] = values.map((v) =>
    v && v.startsWith(prefix) ? v.slice(prefix.length) : null,
  );
  return accessToken && refreshToken && userId ? { accessToken, refreshToken, userId } : null;
}

/**
 * 세 값 + 커밋 마커를 저장소에 쓴다. 마커는 **마지막**이다.
 *
 * SecureStore 는 여러 키를 한 트랜잭션으로 쓰지 못하고, 값 하나에 몰아넣기엔 Android 상한
 * (2KiB)이 걸린다. 그래서 커밋 마커를 쓴다: 값마다 이번 커밋의 `bundleId` 를 접두로 달고,
 * 마커는 **마지막에** 쓴다. 중간에 죽으면 마커가 이전 커밋을 가리키므로 새로 쓰인 값의 태그와
 * 어긋나 복구가 거부된다 — 새 AT + 옛 RT 가 「셋 다 값이 있다」는 이유로 유효 세션으로
 * 살아나는 경로를 닫는다(LLD 검증표 「구 앱 AT setItem 뒤 RT setItem 전 종료」).
 */
async function commit(session: Session): Promise<void> {
  const bundleId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  await Promise.all([
    writeItem(KEY_ACCESS, `${bundleId}.${session.accessToken}`),
    writeItem(KEY_REFRESH, `${bundleId}.${session.refreshToken}`),
    writeItem(KEY_USER, `${bundleId}.${session.userId}`),
  ]);
  await writeItem(KEY_BUNDLE, bundleId);
}

/**
 * 세션을 **커밋이 끝난 뒤에** 공개한다(계정 LLD §2.4 「commit 표지·완전한 세션 snapshot 확정」).
 *
 * 메모리 세션·세대를 먼저 바꾸면 부분 실패에서 화면은 「전환 실패」인데 요청은 새 계정 토큰으로
 * 나가고, 재시작해도 이전 세션이 복구되지 않는다. 그래서 3키 + 마커가 모두 쓰인 뒤에만
 * `cached`·세대를 교체하고, 실패하면 이전 snapshot 을 다시 커밋해 되돌린다.
 *
 * @param expectedGeneration 호출부가 **요청을 시작할 때** 잡아 둔 세대. 임계구역에 들어간 시점에
 *   세대가 달라졌으면(그 사이 로그아웃이나 다른 로그인이 끝났으면) 저장을 **버린다** — 늦게
 *   도착한 저장이 이미 끝난 로그아웃을 되살리거나 새 계정 세션을 덮는 것을 막는다({@link queue}).
 * @returns 공개했으면 true, 세대가 바뀌어 버렸으면 false. 저장소 실패는 그대로 던진다.
 */
export function saveSession(session: Session, expectedGeneration?: number): Promise<boolean> {
  return serialized(async () => {
    if (expectedGeneration !== undefined && expectedGeneration !== generation) return false;
    const previous = cached;
    try {
      await commit(session);
    } catch (error) {
      // 커밋하지 못한 저장은 «없는 것»으로 확정한다: 마커부터 치우고 이전 snapshot 을 되살린다.
      // 되살리기까지 실패하면 마커 없는 상태로 남고, 재시작은 로그아웃으로 복구한다 —
      // 새 계정 토큰이 반쯤 살아남는 것보다 안전하다.
      await removeItem(KEY_BUNDLE).catch(() => {});
      if (previous) await commit(previous).catch(() => {});
      throw error;
    }
    cached = session;
    generation += 1;
    return true;
  });
}

/**
 * 마커를 **먼저** 지운다 — 뒤의 삭제가 실패해도 남은 값이 세션으로 복구되지 않는다.
 * 마커 삭제가 실패해도 나머지 셋은 계속 지운다: 하나만 사라져도 복구는 거부되므로
 * 「마커 삭제 실패 → 값이 통째로 남아 다음 실행에 되살아나는 세션」이 생기지 않는다.
 *
 * @returns 실제로 지운 세션. 줄 앞에서 다른 로그인이 먼저 공개했으면 호출부가 읽어 둔 것과
 *   **다른** 세션이다 — 서버 폐기 대상은 이쪽이다({@link queue}).
 */
export function clearSession(): Promise<Session | null> {
  return serialized(async () => {
    const cleared = cached;
    cached = null;
    generation += 1;
    const failed: unknown[] = [];
    const swallow = (error: unknown): void => void failed.push(error);
    await removeItem(KEY_BUNDLE).catch(swallow);
    await Promise.all([
      removeItem(KEY_ACCESS).catch(swallow),
      removeItem(KEY_REFRESH).catch(swallow),
      removeItem(KEY_USER).catch(swallow),
    ]);
    if (failed.length > 0) throw failed[0];
    return cleared;
  });
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
