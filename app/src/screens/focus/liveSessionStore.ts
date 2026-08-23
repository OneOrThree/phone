import AsyncStorage from '@react-native-async-storage/async-storage';
import { STORAGE_KEYS } from '@/types/storage';
import type { LiveFocusSession } from './types';

/**
 * 라이브 세션 레코드의 **단일 직렬화 경로** (GROMO-1604 코드리뷰).
 *
 * ## 왜 필요한가
 *
 * 이 키는 쓰는 곳이 여럿이다 — 세션 화면의 주기 저장(`saveLive`), 정상 종료의 삭제,
 * 화면을 떠날 때의 표식, 다음 실행의 고아 정산. 이들이 서로 모르는 채로 읽고 쓰면
 * **읽기와 쓰기 사이에 남이 끼어든다.**
 *
 * 처음엔 "읽은 값 그대로면 쓴다"로 막아 보려 했는데, 그건 CAS 가 아니다 — `getItem` 과
 * `setItem` 이 별개의 비동기 호출이라 그 사이가 여전히 열려 있다. 실제 사고는 이렇게 난다:
 *
 *   1. 고아 정산이 레코드를 읽는다 (옛 세션)
 *   2. 새 세션의 `saveLive()` 가 자기 레코드를 쓴다
 *   3. 고아 정산이 "안 바뀌었다"고 판단하고 옛 레코드로 덮는다
 *   4. 정산이 끝나며 그 값을 지운다 → **새 세션의 복구 레코드가 사라진다**
 *
 * 그래서 비교가 아니라 **직렬화**로 푼다. 이 모듈을 거치는 한 같은 키의 읽기·갱신·삭제는
 * 서로 겹치지 않는다.
 *
 * ## 한계
 *
 * 같은 JS 컨텍스트 안에서만 성립한다. 프로세스가 둘이면(위젯 확장 등) 이걸로는 못 막는다 —
 * 지금 이 키를 쓰는 건 앱 프로세스뿐이라 그 선에서 충분하다.
 */
let chain: Promise<unknown> = Promise.resolve();

/** 큐에 넣어 순서대로 실행한다. 앞선 작업이 실패해도 뒤가 막히지 않는다. */
function serialize<T>(task: () => Promise<T>): Promise<T> {
  const next = chain.then(task, task);
  // 체인 자체는 실패를 삼켜 다음 작업이 계속 돌게 한다(반환된 promise 로는 그대로 전파된다).
  chain = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

/** 현재 레코드. 없으면 null. */
export function readLiveSession(): Promise<LiveFocusSession | null> {
  return serialize(async () => {
    const raw = await AsyncStorage.getItem(STORAGE_KEYS.focusLiveSession);
    return raw ? (JSON.parse(raw) as LiveFocusSession) : null;
  });
}

/** 통째로 쓴다(세션 화면의 주기 저장). */
export function writeLiveSession(record: LiveFocusSession): Promise<void> {
  return serialize(() =>
    AsyncStorage.setItem(STORAGE_KEYS.focusLiveSession, JSON.stringify(record)),
  );
}

/**
 * 읽고 → 고쳐서 → 쓰는 한 덩어리. 중간에 다른 접근이 끼어들지 않는다.
 *
 * `update` 가 null 을 돌려주면 아무것도 쓰지 않는다 — "이 레코드는 내 것이 아니다"를
 * 그 자리에서 판단하고 빠질 수 있게 한다.
 */
export function updateLiveSession(
  update: (rec: LiveFocusSession | null) => LiveFocusSession | null,
): Promise<LiveFocusSession | null> {
  return serialize(async () => {
    const raw = await AsyncStorage.getItem(STORAGE_KEYS.focusLiveSession);
    const cur = raw ? (JSON.parse(raw) as LiveFocusSession) : null;
    const next = update(cur);
    if (next === null) return cur;
    await AsyncStorage.setItem(STORAGE_KEYS.focusLiveSession, JSON.stringify(next));
    return next;
  });
}

/**
 * 지운다. `expect` 를 주면 **그 레코드일 때만** 지운다 —
 * 정산이 끝난 사이 새 세션이 자기 레코드를 썼다면 건드리면 안 된다.
 */
export function removeLiveSession(expect?: (rec: LiveFocusSession) => boolean): Promise<void> {
  return serialize(async () => {
    if (expect) {
      const raw = await AsyncStorage.getItem(STORAGE_KEYS.focusLiveSession);
      if (!raw) return;
      if (!expect(JSON.parse(raw) as LiveFocusSession)) return;
    }
    await AsyncStorage.removeItem(STORAGE_KEYS.focusLiveSession);
  });
}
