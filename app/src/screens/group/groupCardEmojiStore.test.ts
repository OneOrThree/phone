import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  __resetGroupCardEmojiQueueForTest,
  DEFAULT_GROUP_CARD_EMOJI,
  GROUP_CARD_EMOJIS,
  GROUP_CARD_EMOJI_OPTIONS,
  groupCardEmojiLabel,
  normalizeGroupCardEmoji,
  parseGroupCardEmoji,
  readGroupCardEmoji,
  readGroupCardEmojiResult,
  reconcileGroupCardEmojiBucket,
  preservePendingGroupCardEmoji,
  restoreLatestPendingGroupCardEmoji,
  retryPendingGroupCardEmojis,
  hasPendingGroupCardEmojis,
  subscribeGroupCardEmoji,
  updatePendingGroupCardEmojiSelection,
  writeGroupCardEmoji,
} from './groupCardEmojiStore';

beforeEach(async () => {
  await AsyncStorage.clear();
  __resetGroupCardEmojiQueueForTest();
  jest.restoreAllMocks();
});

test('허용 목록은 정확히 12종이고 기본값은 🎯다', () => {
  expect(GROUP_CARD_EMOJIS).toHaveLength(12);
  expect(GROUP_CARD_EMOJI_OPTIONS.map((option) => option.label)).toEqual([
    '일출',
    '책',
    '노트북',
    '번개',
    '명상',
    '팔레트',
    '달리기',
    '쓰기',
    '두뇌',
    '목표',
    '잎',
    '불꽃',
  ]);
  expect(DEFAULT_GROUP_CARD_EMOJI).toBe('🎯');
  expect(normalizeGroupCardEmoji('🔥')).toBe('🔥');
  expect(normalizeGroupCardEmoji('🚀')).toBe('🎯');
  expect(normalizeGroupCardEmoji('✍')).toBe('🎯');
  expect(groupCardEmojiLabel('📚')).toBe('책');
  expect(groupCardEmojiLabel('🚀')).toBe('목표');
});

test('손상 값과 allowlist 밖 값은 읽기에서 제거한다', () => {
  expect(parseGroupCardEmoji('{broken')).toEqual({});
  expect(parseGroupCardEmoji(JSON.stringify({ u1: { g1: '📚', g2: '🚀' }, u2: 'bad' }))).toEqual({
    u1: { g1: '📚' },
  });
});

test('userId×groupId로 값을 격리하고 미설정은 🎯로 읽는다', async () => {
  await writeGroupCardEmoji('u1', 'g1', '📚');
  await writeGroupCardEmoji('u2', 'g1', '🔥');

  expect(await readGroupCardEmoji('u1', 'g1')).toBe('📚');
  expect(await readGroupCardEmoji('u2', 'g1')).toBe('🔥');
  expect(await readGroupCardEmoji('u1', 'g2')).toBe('🎯');
  expect(await readGroupCardEmoji(null, 'g1')).toBe('🎯');
});

test('읽기 실패는 실제 미설정 기본값과 구분한다', async () => {
  jest.spyOn(AsyncStorage, 'getItem').mockRejectedValueOnce(new Error('temporarily unavailable'));

  expect(await readGroupCardEmojiResult('u1', 'g1')).toEqual({ status: 'error' });
});

test('동시 RMW를 직렬화해 다른 계정·그룹과 같은 그룹의 마지막 선택을 보존한다', async () => {
  await Promise.all([
    writeGroupCardEmoji('u1', 'g1', '📚'),
    writeGroupCardEmoji('u2', 'g1', '🔥'),
    writeGroupCardEmoji('u1', 'g2', '🧠'),
    writeGroupCardEmoji('u1', 'g1', '⚡'),
  ]);

  expect(await readGroupCardEmoji('u1', 'g1')).toBe('⚡');
  expect(await readGroupCardEmoji('u1', 'g2')).toBe('🧠');
  expect(await readGroupCardEmoji('u2', 'g1')).toBe('🔥');
});

test('쓰기 실패 뒤에도 queue는 다음 저장을 수행한다', async () => {
  jest.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(new Error('disk full'));
  await expect(writeGroupCardEmoji('u1', 'g1', '📚')).rejects.toThrow('disk full');
  await writeGroupCardEmoji('u1', 'g1', '🔥');
  expect(await readGroupCardEmoji('u1', 'g1')).toBe('🔥');
});

test('읽기는 호출 시점에 대기 중인 쓰기 뒤에서 최신 아이콘을 읽는다', async () => {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  jest.spyOn(AsyncStorage, 'setItem').mockImplementationOnce(async (key, value) => {
    await gate;
    await AsyncStorage.multiSet([[key, value]]);
  });
  const write = writeGroupCardEmoji('u1', 'g1', '📚');
  const read = readGroupCardEmoji('u1', 'g1');

  release();
  await write;
  expect(await read).toBe('📚');
});

test('성공한 전체 목록에서만 현재 계정의 stale 그룹 아이콘을 제거한다', async () => {
  await writeGroupCardEmoji('u1', 'g1', '📚');
  await writeGroupCardEmoji('u1', 'gone', '🔥');
  await writeGroupCardEmoji('u2', 'other', '🧠');

  expect(await reconcileGroupCardEmojiBucket('u1', ['g1'])).toEqual({ g1: '📚' });
  expect(parseGroupCardEmoji(await AsyncStorage.getItem('gromo:groups:cardEmoji:v1'))).toEqual({
    u1: { g1: '📚' },
    u2: { other: '🧠' },
  });
});

test('진행 중 prune이 새 목록으로 무효화되면 원본 bucket을 복원한 뒤 최신 목록을 적용한다', async () => {
  await writeGroupCardEmoji('u1', 'a', '📚');
  await writeGroupCardEmoji('u1', 'b', '🔥');
  let started: () => void = () => undefined;
  let release: () => void = () => undefined;
  const startedGate = new Promise<void>((resolve) => (started = resolve));
  const writeGate = new Promise<void>((resolve) => (release = resolve));
  jest.spyOn(AsyncStorage, 'setItem').mockImplementationOnce(async (key, value) => {
    started();
    await writeGate;
    await AsyncStorage.multiSet([[key, value]]);
  });

  const stale = reconcileGroupCardEmojiBucket('u1', ['a']);
  await startedGate;
  const latest = reconcileGroupCardEmojiBucket('u1', ['a', 'b']);
  release();

  await Promise.all([stale, latest]);
  expect(await readGroupCardEmoji('u1', 'b')).toBe('🔥');
});

test('실패한 최신 pending 아이콘은 다음 그룹 화면 활성화에서 재시도한다', async () => {
  const onResult = jest.fn();
  preservePendingGroupCardEmoji('u1', 'g1', '🔥', 'create');
  await retryPendingGroupCardEmojis('u1', ['g1'], () => true, onResult);
  expect(await readGroupCardEmoji('u1', 'g1')).toBe('🔥');
  expect(onResult).toHaveBeenCalledWith('create', 'success');
});

test('pending 재시도가 실패해도 최신 아이콘을 화면 합성값으로 반환한다', async () => {
  const onResult = jest.fn();
  preservePendingGroupCardEmoji('u1', 'g1', '🔥');
  jest.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(new Error('still full'));

  await expect(retryPendingGroupCardEmojis('u1', ['g1'], () => true, onResult)).resolves.toEqual({
    g1: '🔥',
  });
  expect(await readGroupCardEmoji('u1', 'g1')).toBe('🔥');
  expect(onResult).toHaveBeenCalledWith('settings', 'failed');
});

test('여러 pending의 혼합 결과는 마지막 결과가 아니라 남은 항목 전체로 판정한다', async () => {
  preservePendingGroupCardEmoji('u1', 'g1', '🔥');
  preservePendingGroupCardEmoji('u1', 'g2', '📚');
  jest.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(new Error('g1 failed'));

  await retryPendingGroupCardEmojis('u1', ['g1', 'g2']);

  expect(hasPendingGroupCardEmojis('u1', ['g1', 'g2'])).toBe(true);
  expect(hasPendingGroupCardEmojis('u1', ['g2'])).toBe(false);
});

test('오래된 자동 쓰기 뒤에는 메모리의 최신 pending 선택을 다시 알린다', () => {
  const emitted: string[] = [];
  preservePendingGroupCardEmoji('u1', 'g1', '📚');
  updatePendingGroupCardEmojiSelection('u1', 'g1', '🔥', '🎯');
  const unsubscribe = subscribeGroupCardEmoji('u1', (_groupId, emoji) => emitted.push(emoji));

  restoreLatestPendingGroupCardEmoji('u1', 'g1');

  expect(emitted).toEqual(['🔥']);
  unsubscribe();
});

test('진행 중인 pending 재시도보다 새 선택이 늦게 들어오면 최신 아이콘을 다시 알린다', async () => {
  preservePendingGroupCardEmoji('u1', 'g1', '📚');
  const emitted: string[] = [];
  const unsubscribe = subscribeGroupCardEmoji('u1', (_groupId, emoji) => emitted.push(emoji));
  let started: () => void = () => undefined;
  let release: () => void = () => undefined;
  const startedGate = new Promise<void>((resolve) => (started = resolve));
  const writeGate = new Promise<void>((resolve) => (release = resolve));
  jest.spyOn(AsyncStorage, 'setItem').mockImplementationOnce(async (key, value) => {
    started();
    await writeGate;
    await AsyncStorage.multiSet([[key, value]]);
  });

  const retry = retryPendingGroupCardEmojis('u1', ['g1']);
  await startedGate;
  updatePendingGroupCardEmojiSelection('u1', 'g1', '🔥', '🎯');
  release();
  await retry;

  expect(emitted.at(-1)).toBe('🔥');
  expect(await readGroupCardEmoji('u1', 'g1')).toBe('🔥');
  unsubscribe();
});

test('무효화된 prune의 원본 복원이 실패해도 최신 reconcile은 원본에서 다시 계산한다', async () => {
  await writeGroupCardEmoji('u1', 'a', '📚');
  await writeGroupCardEmoji('u1', 'b', '🔥');
  let started: () => void = () => undefined;
  let release: () => void = () => undefined;
  const startedGate = new Promise<void>((resolve) => (started = resolve));
  const writeGate = new Promise<void>((resolve) => (release = resolve));
  let call = 0;
  jest.spyOn(AsyncStorage, 'setItem').mockImplementation(async (key, value) => {
    call++;
    if (call === 1) {
      started();
      await writeGate;
      return AsyncStorage.multiSet([[key, value]]);
    }
    if (call === 2) throw new Error('restore unavailable');
    return AsyncStorage.multiSet([[key, value]]);
  });

  const stale = reconcileGroupCardEmojiBucket('u1', ['a']);
  await startedGate;
  const latest = reconcileGroupCardEmojiBucket('u1', ['a', 'b']);
  release();

  await Promise.all([stale, latest]);
  expect(await readGroupCardEmoji('u1', 'b')).toBe('🔥');
});

test('다른 계정의 후속 저장도 모든 복구 대기 bucket을 앱 재시작 전에 영속화한다', async () => {
  await writeGroupCardEmoji('u1', 'a', '📚');
  await writeGroupCardEmoji('u1', 'b', '🔥');
  let started: () => void = () => undefined;
  let release: () => void = () => undefined;
  const startedGate = new Promise<void>((resolve) => (started = resolve));
  const writeGate = new Promise<void>((resolve) => (release = resolve));
  let call = 0;
  jest.spyOn(AsyncStorage, 'setItem').mockImplementation(async (key, value) => {
    call++;
    if (call === 1) {
      started();
      await writeGate;
      return AsyncStorage.multiSet([[key, value]]);
    }
    if (call === 2) throw new Error('restore unavailable');
    return AsyncStorage.multiSet([[key, value]]);
  });

  const stale = reconcileGroupCardEmojiBucket('u1', ['a']);
  await startedGate;
  const invalidator = reconcileGroupCardEmojiBucket('u1', ['a', 'b'], () => false);
  release();
  await Promise.all([stale, invalidator]);

  await writeGroupCardEmoji('u2', 'other', '🧠');

  expect(parseGroupCardEmoji(await AsyncStorage.getItem('gromo:groups:cardEmoji:v1'))).toEqual({
    u1: { a: '📚', b: '🔥' },
    u2: { other: '🧠' },
  });

  // 프로세스 메모리의 recovery bucket 없이도 영속 저장만으로 복구되어야 한다.
  __resetGroupCardEmojiQueueForTest();

  expect(await readGroupCardEmoji('u1', 'a')).toBe('📚');
  expect(await readGroupCardEmoji('u1', 'b')).toBe('🔥');
  expect(await readGroupCardEmoji('u2', 'other')).toBe('🧠');
});

test('다른 계정의 reconcile도 모든 복구 bucket을 보존하며 자신의 stale 값만 정리한다', async () => {
  await writeGroupCardEmoji('u1', 'a', '📚');
  await writeGroupCardEmoji('u1', 'b', '🔥');
  await writeGroupCardEmoji('u2', 'keep', '🧠');
  await writeGroupCardEmoji('u2', 'gone', '⚡');
  let started: () => void = () => undefined;
  let release: () => void = () => undefined;
  const startedGate = new Promise<void>((resolve) => (started = resolve));
  const writeGate = new Promise<void>((resolve) => (release = resolve));
  let call = 0;
  jest.spyOn(AsyncStorage, 'setItem').mockImplementation(async (key, value) => {
    call++;
    if (call === 1) {
      started();
      await writeGate;
      return AsyncStorage.multiSet([[key, value]]);
    }
    if (call === 2) throw new Error('restore unavailable');
    return AsyncStorage.multiSet([[key, value]]);
  });

  const stale = reconcileGroupCardEmojiBucket('u1', ['a']);
  await startedGate;
  const invalidator = reconcileGroupCardEmojiBucket('u1', ['a', 'b'], () => false);
  release();
  await Promise.all([stale, invalidator]);

  await reconcileGroupCardEmojiBucket('u2', ['keep']);
  expect(parseGroupCardEmoji(await AsyncStorage.getItem('gromo:groups:cardEmoji:v1'))).toEqual({
    u1: { a: '📚', b: '🔥' },
    u2: { keep: '🧠' },
  });

  __resetGroupCardEmojiQueueForTest();
  expect(await readGroupCardEmoji('u1', 'b')).toBe('🔥');
  expect(await readGroupCardEmoji('u2', 'gone')).toBe('🎯');
});

test('성공한 전체 목록에서 사라진 그룹의 pending 값도 폐기한다', async () => {
  preservePendingGroupCardEmoji('u1', 'gone', '🔥');
  expect(await retryPendingGroupCardEmojis('u1', ['g1'])).toEqual({});

  expect(await retryPendingGroupCardEmojis('u1', ['gone'])).toEqual({});
  expect(await readGroupCardEmoji('u1', 'gone')).toBe('🎯');
});
