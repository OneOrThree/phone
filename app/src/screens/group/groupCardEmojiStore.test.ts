import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  __resetGroupCardEmojiQueueForTest,
  DEFAULT_GROUP_CARD_EMOJI,
  GROUP_CARD_EMOJIS,
  normalizeGroupCardEmoji,
  parseGroupCardEmoji,
  readGroupCardEmoji,
  reconcileGroupCardEmojis,
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
  expect(DEFAULT_GROUP_CARD_EMOJI).toBe('🎯');
  expect(normalizeGroupCardEmoji('🔥')).toBe('🔥');
  expect(normalizeGroupCardEmoji('🚀')).toBe('🎯');
  expect(normalizeGroupCardEmoji('✍')).toBe('🎯');
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

test('실패한 선택을 현재 실행에서 읽고 다음 활성화에서 다시 저장한다', async () => {
  jest.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(new Error('disk full'));
  await expect(writeGroupCardEmoji('u1', 'g1', '🧠')).rejects.toThrow('disk full');

  expect(await readGroupCardEmoji('u1', 'g1')).toBe('🧠');

  await retryPendingGroupCardEmojis('u1', ['g1']);
  expect(await readGroupCardEmoji('u1', 'g1')).toBe('🧠');
  expect(parseGroupCardEmoji(await AsyncStorage.getItem('gromo:groups:cardEmoji:v1')).u1.g1).toBe(
    '🧠',
  );
});

test('현재 소속 밖의 아이콘만 제거하고 다른 계정 bucket은 보존한다', async () => {
  await writeGroupCardEmoji('u1', 'g1', '📚');
  await writeGroupCardEmoji('u1', 'g2', '🔥');
  await writeGroupCardEmoji('u2', 'g2', '🧠');

  await reconcileGroupCardEmojis('u1', ['g1']);

  expect(await readGroupCardEmoji('u1', 'g1')).toBe('📚');
  expect(await readGroupCardEmoji('u1', 'g2')).toBe(DEFAULT_GROUP_CARD_EMOJI);
  expect(await readGroupCardEmoji('u2', 'g2')).toBe('🧠');
});

test('아이콘 쓰기와 reconcile을 같은 queue에서 직렬화한다', async () => {
  await writeGroupCardEmoji('u1', 'old', '📚');

  await Promise.all([
    writeGroupCardEmoji('u1', 'current', '🔥'),
    reconcileGroupCardEmojis('u1', ['current']),
  ]);

  expect(await readGroupCardEmoji('u1', 'old')).toBe(DEFAULT_GROUP_CARD_EMOJI);
  expect(await readGroupCardEmoji('u1', 'current')).toBe('🔥');
});
