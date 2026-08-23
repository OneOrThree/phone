// 정산 저널의 계약 — 마커 인계와 소거 봉인(GROMO-1600 codex 리뷰 #694 8차).
import AsyncStorage from '@react-native-async-storage/async-storage';
import { STORAGE_KEYS } from '@/types/storage';
import { journalStartIntent, recordSettleIntent, clearJournal, readJournal } from './journal';

const BODY = {
  subject: '수학',
  startedAt: 'block-1',
  endedAt: 'b',
  focusTagId: null,
} as never;

beforeEach(async () => {
  await AsyncStorage.clear();
});

test('새 시작이 이전 세션을 덮기 전에 마커를 대응 intent에 인계한다', async () => {
  // 예비 intent(마커 미정)만 남기고 죽은 뒤 유예가 끝나기 전에 새 집중을 시작하면, 이 대입이
  // 마커를 가진 유일한 기록을 통째로 덮는다 — 재생이 마커를 못 닫아 서버 스윕까지 남는다.
  await AsyncStorage.setItem(
    STORAGE_KEYS.focusJournalV1,
    JSON.stringify({
      version: 1,
      session: {
        sessionKey: 'fs-old',
        state: 'active',
        shieldRequested: true,
        serverSessionId: 'marker-old',
        markerBlockStartedAt: 'block-1',
        createdAt: 'x',
        updatedAt: 'x',
      },
      settles: [
        {
          intentId: 'i1',
          sessionKey: 'fs-old',
          serverSessionId: null,
          body: BODY,
          userId: 'user-1',
          createdAt: 'x',
        },
      ],
    }),
  );

  await journalStartIntent('fs-new');

  const journal = await readJournal();
  expect(journal.session?.sessionKey).toBe('fs-new');
  expect(journal.settles[0].serverSessionId).toBe('marker-old'); // 인계됐다
});

test('블록이 다른 intent에는 인계하지 않는다 — 남의 블록 마커다', async () => {
  await AsyncStorage.setItem(
    STORAGE_KEYS.focusJournalV1,
    JSON.stringify({
      version: 1,
      session: {
        sessionKey: 'fs-old',
        state: 'active',
        shieldRequested: true,
        serverSessionId: 'marker-2',
        markerBlockStartedAt: 'block-2',
        createdAt: 'x',
        updatedAt: 'x',
      },
      settles: [
        {
          intentId: 'i1',
          sessionKey: 'fs-old',
          serverSessionId: null,
          body: BODY, // block-1
          userId: 'user-1',
          createdAt: 'x',
        },
      ],
    }),
  );

  await journalStartIntent('fs-new');
  expect((await readJournal()).settles[0].serverSessionId).toBeNull();
});

test('소거 후 늦게 도착한 쓰기는 저널을 되살리지 않는다', async () => {
  await journalStartIntent('fs-1');
  await clearJournal();

  const wrote = await recordSettleIntent({
    intentId: 'late',
    sessionKey: 'fs-1',
    serverSessionId: 'marker-1',
    body: BODY,
    userId: 'user-1',
    createdAt: 'x',
  });

  expect(wrote).toBe(false);
  expect(await AsyncStorage.getItem(STORAGE_KEYS.focusJournalV1)).toBeNull();
});

test('새 계정의 시작이 이전 세대의 쓰기까지 되살리지 않는다', async () => {
  // 「소거 후 새 시작 전까지 막는다」로는 부족하다 — 로그아웃 직후 새 계정이 집중을 시작하면
  // 전역 봉인이 풀려, 그때 도착한 이전 계정 체인의 쓰기가 다시 허용된다. 그 intent는 업로드
  // 에서 계정 불일치로 큐에 갔다가 현재 계정의 flush에 폐기돼 영구 유실된다(리뷰 #694 9차).
  await journalStartIntent('fs-old');
  await clearJournal();
  await journalStartIntent('fs-new'); // 새 계정의 세션

  const stale = await recordSettleIntent({
    intentId: 'stale',
    sessionKey: 'fs-old',
    serverSessionId: 'marker-old',
    body: BODY,
    userId: 'user-1',
    createdAt: 'x',
  });

  expect(stale).toBe(false);
  expect((await readJournal()).settles).toHaveLength(0);
});

test('같은 세대 안에서는 이전 세션의 늦은 쓰기도 허용한다 — 유실 대비 안전망이다', async () => {
  // finish 직후 새 세션을 시작해도 앞 세션의 완성 intent는 남아야 한다(소거가 없었으므로).
  await journalStartIntent('fs-a');
  await journalStartIntent('fs-b');

  const wrote = await recordSettleIntent({
    intentId: 'a-final',
    sessionKey: 'fs-a',
    serverSessionId: 'marker-a',
    body: BODY,
    userId: 'user-1',
    createdAt: 'x',
  });

  expect(wrote).toBe(true);
  expect((await readJournal()).settles).toHaveLength(1);
});

test('복구가 이어 쓰는 세션은 막지 않는다 — 이전 프로세스가 시작해 맵에 없다', async () => {
  // 「등록되지 않았으면 거부」로 만들면 부팅 복구가 저널을 완결하지 못한다.
  const wrote = await recordSettleIntent({
    intentId: 'from-disk',
    sessionKey: 'fs-previous-process',
    serverSessionId: null,
    body: BODY,
    userId: 'user-1',
    createdAt: 'x',
  });

  expect(wrote).toBe(true);
});

test('새 세션이 시작되면 그 세션의 쓰기는 정상 기록된다', async () => {
  await clearJournal();
  await journalStartIntent('fs-next');

  const wrote = await recordSettleIntent({
    intentId: 'ok',
    sessionKey: 'fs-next',
    serverSessionId: null,
    body: BODY,
    userId: 'user-2',
    createdAt: 'x',
  });

  expect(wrote).toBe(true);
  expect((await readJournal()).settles).toHaveLength(1);
});
