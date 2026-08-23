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
  // 이전 계정의 정산이 livePromise를 기다리는 사이 로그아웃이 저널을 지우면, 그 완성 intent가
  // 뒤늦게 도착해 지운 저널을 되살린다 — 다음 계정에선 소유자 불일치로 재생되지 않는다.
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

test('새 세션이 시작되면 봉인이 풀린다 — 다음 계정의 정상 흐름을 막지 않는다', async () => {
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
