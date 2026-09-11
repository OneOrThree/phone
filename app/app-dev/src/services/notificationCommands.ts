import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';
import {
  API_URL,
  getFreshAccessToken,
  getUserIdFromToken,
  runAuthSessionTransition,
} from '@/services/api';
import { STORAGE_KEYS } from '@/types/storage';
import type { NotificationSettingsRequest } from '@/types/dto/user';

type Kind = 'settings' | 'register' | 'delete' | 'logout' | 'language';
interface Command {
  id: string;
  kind: Kind;
  userId: string;
  accessToken: string;
  sessionId: string | null;
  body: Record<string, unknown>;
  started?: boolean;
  afterAccountSwitch?: boolean;
}
interface Ownership {
  deviceToken: string;
  ownershipToken: string | null;
  userId: string;
  sessionId: string | null;
}

let storageTail: Promise<unknown> = Promise.resolve();
let ownershipTail: Promise<unknown> = Promise.resolve();
let delivery: Promise<void> | null = null;

function storage<T>(operation: () => Promise<T>): Promise<T> {
  const next = storageTail.then(operation, operation);
  storageTail = next.catch(() => {});
  return next;
}

// 소유권 회전 경계. 등록 응답이 돌려준 소유권의 «저장+승계»와, 후속 등록의 «소유권 조회+적재»를
// 같은 경계에 둔다. 둘이 겹치면 후속 명령은 이미 회전한 낡은 소유권을 읽고, 그 시점에 큐에 없어
// 승계 대상에서도 빠진다 — 소비된 bootstrap 과 낡은 소유권을 함께 실어 영구히 거절된다.
// storage() 와는 «별개의» 잠금이다: 여기 들어오는 두 구간이 안에서 다시 storage() 를 잡으므로
// 같은 tail 을 쓰면 자기 자신을 기다린다. 잠금 순서는 언제나 auth mutex → 이 경계 한 방향뿐이고,
// 이 안에서는 auth mutex 를 잡지 않는다.
function ownershipCritical<T>(operation: () => Promise<T>): Promise<T> {
  const next = ownershipTail.then(operation, operation);
  ownershipTail = next.catch(() => {});
  return next;
}

async function readQueue(): Promise<Command[]> {
  const value = await AsyncStorage.getItem(STORAGE_KEYS.notificationCommands);
  return value ? (JSON.parse(value) as Command[]) : [];
}

function key(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

async function ownership(): Promise<Ownership | null> {
  const value = await AsyncStorage.getItem(STORAGE_KEYS.deviceOwnership);
  return value ? (JSON.parse(value) as Ownership) : null;
}

async function enqueue(
  kind: Kind,
  body: Record<string, unknown>,
  token?: string,
  sessionId?: string | null,
  afterAccountSwitch = false,
) {
  const accessToken = token ?? (await AsyncStorage.getItem(STORAGE_KEYS.accessToken));
  const userId = accessToken && getUserIdFromToken(accessToken);
  if (!accessToken || !userId) throw new Error('알림 명령의 사용자 정보가 없습니다.');
  let command: Command = {
    id: key(),
    kind,
    userId,
    accessToken,
    body,
    ...(afterAccountSwitch ? { afterAccountSwitch: true } : {}),
    sessionId:
      sessionId === undefined ? await AsyncStorage.getItem(STORAGE_KEYS.authSessionId) : sessionId,
  };
  await storage(async () => {
    let queue = await readQueue();
    const previous = queue
      .slice()
      .reverse()
      .find((item) => item.kind === kind && item.userId === userId);
    if (
      previous &&
      previous.sessionId === command.sessionId &&
      JSON.stringify(previous.body) === JSON.stringify(body)
    ) {
      command = previous;
      return;
    }
    // 이미 전송한 명령은 같은 키로 결과를 확인한 뒤 다음 의도를 보낸다.
    // 타임아웃된 옛 요청이 새 설정 뒤에 커밋되는 역전을 막는다.
    if (kind === 'settings' || kind === 'language')
      queue = queue.filter((item) => item.kind !== kind || item.userId !== userId || item.started);
    if (kind === 'register')
      queue = queue.filter(
        (item) => item.kind !== kind || item.body.deviceToken !== body.deviceToken || item.started,
      );
    queue.push(command);
    await AsyncStorage.setItem(STORAGE_KEYS.notificationCommands, JSON.stringify(queue));
  });
  return command;
}

async function remove(id: string) {
  await storage(async () => {
    const queue = await readQueue();
    await AsyncStorage.setItem(
      STORAGE_KEYS.notificationCommands,
      JSON.stringify(queue.filter((item) => item.id !== id)),
    );
  });
}

// 선행 등록이 받은 소유권을 «아직 보내지 않은» 같은 세션의 후속 등록에 승계한다.
// 오프라인에 fcm-old·fcm-new 등록이 함께 쌓이면 둘 다 등록 당시의 소유권과 같은 bootstrap 을 싣는데,
// 복구 후 첫 등록이 그 bootstrap 을 소비하고 소유권을 회전시키므로 승계하지 않은 두 번째 명령은
// 영구히 DEVICE_OWNERSHIP_CONFLICT 다. 이미 전송한 명령(started)은 그 키의 본문이 계약이라 건드리지
// 않고, 다른 사용자·다른 세션의 의도에는 승계하지 않는다.
async function inheritOwnership(command: Command, ownershipToken: string | null) {
  if (!ownershipToken) return;
  await storage(async () => {
    const queue = await readQueue();
    const heirs = queue.filter(
      (item) =>
        item.id !== command.id &&
        item.kind === 'register' &&
        !item.started &&
        item.userId === command.userId &&
        item.sessionId === command.sessionId &&
        item.body.ownershipToken !== ownershipToken,
    );
    if (!heirs.length) return;
    for (const heir of heirs) heir.body.ownershipToken = ownershipToken;
    await AsyncStorage.setItem(STORAGE_KEYS.notificationCommands, JSON.stringify(queue));
  });
}

// 이 등록 의도가 «지금 세션»의 것인가. 다르면 보내지 않는다 — 이전 로그인의 자격을 새 세션으로
// 재등록하면 남의 기기 소유권을 되찾아간다.
//
// 단 하나의 예외가 구 세션 승격이다. sessionId 가 없던 로그인은 서버가 첫 RT 회전에서
// 세션 축으로 올리고(AuthService ㋪) refresh 응답의 sid 가 저장된다 — 같은 사용자·같은 로그인인데
// 저장 값만 null → sid 로 바뀐다. 이것을 불일치로 읽으면 HTTP 등록을 «한 번도» 못 한 명령이 다음
// flush 에서 삭제되고, PushGate 는 userId 가 바뀔 때만 재등록하므로 주기적 flush 로도 복구되지
// 않는다(그 기기는 영구 미등록). 그래서 승격 표식이 지금 세션을 가리킬 때만 세션을 승계한다.
// 진짜 계정·로그인 교체는 표식의 sid 와 저장된 sid 가 어긋나므로 종전대로 폐기된다.
async function sessionMatches(command: Command): Promise<boolean> {
  const stored = await AsyncStorage.getItem(STORAGE_KEYS.authSessionId);
  if (command.sessionId === stored || (sessionless(command.sessionId) && sessionless(stored)))
    return true;
  if (!sessionless(command.sessionId) || sessionless(stored)) return false;
  const marker = await AsyncStorage.getItem(STORAGE_KEYS.authSessionPromotion);
  const promotion = marker ? (JSON.parse(marker) as { userId?: string; sessionId?: string }) : null;
  if (promotion?.userId !== command.userId || promotion?.sessionId !== stored) return false;
  await adoptPromotedSession(command, stored);
  return true;
}

// 「세션 없음」은 두 모양으로 저장된다 — 키가 아예 없으면 null 이고, 세션 없는 로그인 응답을 저장한
// 자리는 빈 문자열이다(auth.ts 의 multiSet 은 키를 지우지 않는다). 둘을 다르게 보면 같은 구 세션이
// 저장 경로에 따라 「불일치」가 되어 멀쩡한 명령이 폐기된다.
function sessionless(value: string | null): boolean {
  return value === null || value === '';
}

// 승격된 세션으로 «아직 보내지 않은 것까지» 함께 옮긴다. 하나만 옮기면 형제 등록(오프라인에 쌓인
// 토큰 교체 등)이 다음 차례에 같은 불일치로 삭제된다. 여기서는 본문을 건드리지 않는다 — 이미 전송한 키의
// 본문은 계약이고(같은 키·다른 본문은 IDEMPOTENCY_KEY_CONFLICT), 승격이 바꾸는 것은 「어느 세션의
// 의도인가」뿐이다. 미전송 명령의 자격은 별도 prepareRegistration에서 같은 로그인임을 다시 확인한 뒤 붙인다.
async function adoptPromotedSession(command: Command, sessionId: string) {
  command.sessionId = sessionId;
  await storage(async () => {
    const queue = await readQueue();
    const heirs = queue.filter(
      (item) =>
        item.kind === 'register' && item.userId === command.userId && sessionless(item.sessionId),
    );
    if (!heirs.length) return;
    for (const heir of heirs) heir.sessionId = sessionId;
    await AsyncStorage.setItem(STORAGE_KEYS.notificationCommands, JSON.stringify(queue));
  });
}

// 최초 전송 전에만 현재 로그인 자격을 붙인다. 먼저 큐에 기록하므로 갱신 장애도 재시도할 수 있다.
async function prepareRegistration(command: Command): Promise<boolean> {
  return runAuthSessionTransition(async () => {
    const token = await AsyncStorage.getItem(STORAGE_KEYS.accessToken);
    if (!token || getUserIdFromToken(token) !== command.userId || !(await sessionMatches(command)))
      return false;
    const bootstrap = await AsyncStorage.getItem(STORAGE_KEYS.deviceBootstrap);
    await storage(async () => {
      const queue = await readQueue();
      const pending = queue.find((item) => item.id === command.id);
      if (!pending || pending.started) return;
      if (!pending.body.deviceBootstrap && bootstrap) pending.body.deviceBootstrap = bootstrap;
      command.body = { ...pending.body };
      await AsyncStorage.setItem(STORAGE_KEYS.notificationCommands, JSON.stringify(queue));
    });
    return true;
  });
}

async function completeLogout(command: Command) {
  await storage(async () => {
    const queue = await readQueue();
    // RT 로그아웃이 확정한 정확한 삭제만 정리한다. 새 세션·새 소유자의 의도는 보존한다.
    await AsyncStorage.setItem(
      STORAGE_KEYS.notificationCommands,
      JSON.stringify(
        queue.filter(
          (item) =>
            item.id !== command.id &&
            !(
              item.kind === 'delete' &&
              item.userId === command.userId &&
              item.sessionId === command.sessionId &&
              item.body.deviceToken === command.body.deviceToken &&
              item.body.ownershipToken === command.body.ownershipToken
            ),
        ),
      ),
    );
  });
}

async function send(command: Command): Promise<boolean> {
  if (command.afterAccountSwitch) {
    const current = await AsyncStorage.getItem(STORAGE_KEYS.accessToken);
    const currentSession = await AsyncStorage.getItem(STORAGE_KEYS.authSessionId);
    if (
      current &&
      getUserIdFromToken(current) === command.userId &&
      currentSession === command.sessionId
    )
      return false;
  }
  let token = command.accessToken;
  if (command.kind === 'settings' || command.kind === 'register' || command.kind === 'language') {
    const current = await AsyncStorage.getItem(STORAGE_KEYS.accessToken);
    if (!current || getUserIdFromToken(current) !== command.userId) return false;
    if (command.kind === 'register' && !(await sessionMatches(command))) {
      await remove(command.id);
      return true;
    }
    token =
      (await getFreshAccessToken(undefined, {
        requireSession: command.kind === 'register' && !command.started,
      })) ?? current;
    if (getUserIdFromToken(token) !== command.userId) return false;
    // 위 갱신이 구 세션을 승격시켰을 수 있다 — 그때의 불일치는 폐기가 아니라 승계다.
    if (command.kind === 'register' && !(await sessionMatches(command))) return false;
    if (command.kind === 'register' && !command.started && !(await prepareRegistration(command)))
      return false;
  }
  await storage(async () => {
    const queue = await readQueue();
    const pending = queue.find((item) => item.id === command.id);
    if (pending) {
      pending.started = true;
      await AsyncStorage.setItem(STORAGE_KEYS.notificationCommands, JSON.stringify(queue));
    }
  });
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    'Idempotency-Key': command.id,
  };
  if (command.kind === 'language') {
    await axios.patch(`${API_URL}/api/v1/users/me`, command.body, { headers, timeout: 10000 });
    await AsyncStorage.setItem(
      STORAGE_KEYS.languageReported,
      JSON.stringify({ userId: command.userId, language: command.body.language }),
    );
  } else if (command.kind === 'settings') {
    await axios.put(`${API_URL}/api/v1/users/me/notification-settings`, command.body, {
      headers,
      timeout: 10000,
    });
  } else if (command.kind === 'register') {
    const response = await axios.put<{ ownershipToken?: string }>(
      `${API_URL}/api/v1/users/me/device-token`,
      command.body,
      { headers, timeout: 10000 },
    );
    const ownershipToken = response.data?.ownershipToken ?? null;
    // 저장과 승계는 한 구간이다 — 그 사이에 적재된 후속 등록은 둘 중 어느 쪽으로도 소유권을 받지 못한다.
    await ownershipCritical(async () => {
      const current = await AsyncStorage.getItem(STORAGE_KEYS.accessToken);
      if (
        !current ||
        getUserIdFromToken(current) !== command.userId ||
        command.sessionId !== (await AsyncStorage.getItem(STORAGE_KEYS.authSessionId))
      )
        return;
      await AsyncStorage.setItem(
        STORAGE_KEYS.deviceOwnership,
        JSON.stringify({
          deviceToken: command.body.deviceToken,
          ownershipToken,
          userId: command.userId,
          sessionId: command.sessionId,
        }),
      );
      await inheritOwnership(command, ownershipToken);
    });
  } else if (command.kind === 'delete') {
    if (typeof command.body.deviceToken === 'string')
      headers['X-Device-Token'] = command.body.deviceToken;
    if (typeof command.body.ownershipToken === 'string')
      headers['X-Device-Ownership'] = command.body.ownershipToken;
    await axios.delete(`${API_URL}/api/v1/users/me/device-token`, { headers, timeout: 10000 });
  } else {
    await axios.post(`${API_URL}/api/v1/auth/logout`, command.body, {
      headers: { 'Idempotency-Key': command.id },
      timeout: 10000,
    });
    await completeLogout(command);
    return true;
  }
  await remove(command.id);
  return true;
}

export function flushNotificationCommands(): Promise<void> {
  if (delivery) return delivery;
  delivery = (async () => {
    const attempted = new Set<string>();
    const failedUsers = new Set<string>();
    while (true) {
      const command = (await storage(readQueue)).find((item) => !attempted.has(item.id));
      if (!command) break;
      attempted.add(command.id);
      if (failedUsers.has(command.userId) && command.kind !== 'delete' && command.kind !== 'logout')
        continue;
      // coalescing으로 대체된 설정은 오래된 snapshot에 있어도 보내지 않는다.
      if (!(await storage(readQueue)).some((item) => item.id === command.id)) continue;
      try {
        // 새 토큰의 부분 저장을 커밋으로 오인하지 않는다. 실패한 로그인은 이전 세션을 복원한 뒤
        // 이 잠금을 놓으므로, 준비한 로그아웃이 그 세션을 먼저 폐기할 수 없다.
        if (command.afterAccountSwitch) await runAuthSessionTransition(() => send(command));
        else await send(command);
      } catch {
        failedUsers.add(command.userId);
      }
    }
  })().finally(() => {
    delivery = null;
  });
  return delivery;
}

export async function queueNotificationSettings(body: NotificationSettingsRequest): Promise<void> {
  await enqueue('settings', {
    ...body,
    nightStartTime: body.nightStartTime ?? null,
    nightEndTime: body.nightEndTime ?? null,
  });
  await flushNotificationCommands();
}

export async function queueDeviceRegistration(deviceToken: string): Promise<void> {
  await runAuthSessionTransition(() =>
    // 조회와 적재 사이에 이전 등록의 응답이 소유권을 회전시키면, 읽은 값은 이미 낡았고 승계도
    // 지나간 뒤다. 두 구간을 같은 경계에 두면 어느 순서로 겹쳐도 — 먼저면 회전한 값을 읽고,
    // 나중이면 승계가 이 명령을 찾아 — 최신 소유권을 싣는다.
    ownershipCritical(async () => {
      const previous = await ownership();
      const bootstrap = await AsyncStorage.getItem(STORAGE_KEYS.deviceBootstrap);
      const token = await AsyncStorage.getItem(STORAGE_KEYS.accessToken);
      const userId = token && getUserIdFromToken(token);
      const sessionId = await AsyncStorage.getItem(STORAGE_KEYS.authSessionId);
      await enqueue('register', {
        deviceToken,
        ...(bootstrap ? { deviceBootstrap: bootstrap } : {}),
        ...(previous?.userId === userId &&
        previous.sessionId === sessionId &&
        previous.ownershipToken
          ? { ownershipToken: previous.ownershipToken }
          : {}),
      });
    }),
  );
  await flushNotificationCommands();
}

export async function queueDeviceDeletion(accessToken: string): Promise<void> {
  const previous = await ownership();
  const userId = getUserIdFromToken(accessToken);
  // 아직 새 등록 응답을 못 받았어도 요청에 사용한 정확한 FCM 토큰을 삭제 대상으로 보존한다.
  const pending = (await storage(readQueue))
    .slice()
    .reverse()
    .find((item) => item.kind === 'register' && item.userId === userId);
  const target = previous?.userId === userId ? previous : pending?.body;
  if (typeof target?.deviceToken !== 'string' || !target.deviceToken) return;
  await enqueue(
    'delete',
    { deviceToken: target?.deviceToken ?? null, ownershipToken: target?.ownershipToken ?? null },
    accessToken,
    previous?.userId === userId ? previous.sessionId : (pending?.sessionId ?? null),
  );
  // 인증 전환 mutex 안에서 호출되므로 refresh를 쓰는 전체 flush는 기다리지 않는다.
  const queue = await storage(readQueue);
  const deletion = queue
    .slice()
    .reverse()
    .find((item) => item.kind === 'delete' && item.userId === userId);
  if (deletion) await send(deletion).catch(() => {});
}

export async function queueSessionLogout(
  refreshToken: string,
  accessToken: string,
  options?: { prepareAccountSwitch: true; sessionId: string | null },
): Promise<void> {
  const previous = await ownership();
  const userId = getUserIdFromToken(accessToken);
  const pending = (await storage(readQueue))
    .slice()
    .reverse()
    .find((item) => item.kind === 'register' && item.userId === userId);
  const target = previous?.userId === userId ? previous : pending?.body;
  const command = await enqueue(
    'logout',
    {
      refreshToken,
      deviceToken: target?.deviceToken ?? null,
      ownershipToken: target?.ownershipToken ?? null,
    },
    accessToken,
    options
      ? options.sessionId
      : previous?.userId === userId
        ? previous.sessionId
        : (pending?.sessionId ?? null),
    options?.prepareAccountSwitch,
  );
  if (!options?.prepareAccountSwitch) await send(command).catch(() => {});
}

export async function reportNotificationLanguage(language: string): Promise<void> {
  const token = await AsyncStorage.getItem(STORAGE_KEYS.accessToken);
  const userId = token && getUserIdFromToken(token);
  if (!token || !userId) return;
  const reported = await AsyncStorage.getItem(STORAGE_KEYS.languageReported);
  if (reported === JSON.stringify({ userId, language })) return;
  await enqueue('language', { language }, token);
  await flushNotificationCommands();
}
