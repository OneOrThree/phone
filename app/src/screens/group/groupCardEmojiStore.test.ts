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
  readGroupCardEmojiForEdit,
  reconcileGroupCardEmojiBucket,
  preservePendingGroupCardEmoji,
  retryPendingGroupCardEmojis,
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

test('편집용 읽기는 저장소 오류를 기본값으로 확정하지 않고 호출자에게 전달한다', async () => {
  jest.spyOn(AsyncStorage, 'getItem').mockRejectedValueOnce(new Error('temporary read failure'));

  await expect(readGroupCardEmojiForEdit('u1', 'g1')).rejects.toThrow('temporary read failure');
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
  const originalSetItem = AsyncStorage.setItem.bind(AsyncStorage);
  jest.spyOn(AsyncStorage, 'setItem').mockImplementationOnce(async (key, value) => {
    await gate;
    await originalSetItem(key, value);
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

test('stale repair 쓰기가 실패해도 검증해 읽은 현재 그룹 아이콘은 hydrate에 유지한다', async () => {
  await AsyncStorage.setItem(
    'gromo:groups:cardEmoji:v1',
    JSON.stringify({ u1: { g1: '📚', gone: '🔥' } }),
  );
  jest.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(new Error('disk full'));

  await expect(reconcileGroupCardEmojiBucket('u1', ['g1'])).resolves.toEqual({ g1: '📚' });
});

test('실패한 최신 pending 아이콘은 다음 그룹 화면 활성화에서 재시도한다', async () => {
  preservePendingGroupCardEmoji('u1', 'g1', '🔥');
  await retryPendingGroupCardEmojis('u1', ['g1']);
  expect(await readGroupCardEmoji('u1', 'g1')).toBe('🔥');
});

test('pending 재시도가 실패해도 최신 아이콘을 화면 합성값으로 반환한다', async () => {
  preservePendingGroupCardEmoji('u1', 'g1', '🔥');
  jest.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(new Error('still full'));

  await expect(retryPendingGroupCardEmojis('u1', ['g1'])).resolves.toEqual({ g1: '🔥' });
  expect(await readGroupCardEmoji('u1', 'g1')).toBe('🎯');
});

test('성공한 전체 목록에서 사라진 그룹의 pending 값도 폐기한다', async () => {
  preservePendingGroupCardEmoji('u1', 'gone', '🔥');
  expect(await retryPendingGroupCardEmojis('u1', ['g1'])).toEqual({});

  expect(await retryPendingGroupCardEmojis('u1', ['gone'])).toEqual({});
  expect(await readGroupCardEmoji('u1', 'gone')).toBe('🎯');
});
