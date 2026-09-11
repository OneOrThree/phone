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
let delivery: Promise<void> | null = null;

function storage<T>(operation: () => Promise<T>): Promise<T> {
  const next = storageTail.then(operation, operation);
  storageTail = next.catch(() => {});
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
    if (
      command.kind === 'register' &&
      command.sessionId !== (await AsyncStorage.getItem(STORAGE_KEYS.authSessionId))
    ) {
      await remove(command.id);
      return true;
    }
    token = (await getFreshAccessToken()) ?? current;
    if (getUserIdFromToken(token) !== command.userId) return false;
    if (
      command.kind === 'register' &&
      command.sessionId !== (await AsyncStorage.getItem(STORAGE_KEYS.authSessionId))
    )
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
    const current = await AsyncStorage.getItem(STORAGE_KEYS.accessToken);
    if (
      current &&
      getUserIdFromToken(current) === command.userId &&
      command.sessionId === (await AsyncStorage.getItem(STORAGE_KEYS.authSessionId))
    ) {
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
    }
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
  await runAuthSessionTransition(async () => {
    const previous = await ownership();
    const bootstrap = await AsyncStorage.getItem(STORAGE_KEYS.deviceBootstrap);
    const token = await AsyncStorage.getItem(STORAGE_KEYS.accessToken);
    const userId = token && getUserIdFromToken(token);
    const sessionId = await AsyncStorage.getItem(STORAGE_KEYS.authSessionId);
    await enqueue('register', {
      deviceToken,
      ...(bootstrap ? { deviceBootstrap: bootstrap } : {}),
      ...(previous?.userId === userId && previous.sessionId === sessionId && previous.ownershipToken
        ? { ownershipToken: previous.ownershipToken }
        : {}),
    });
  });
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
