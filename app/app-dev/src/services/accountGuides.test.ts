import AsyncStorage from '@react-native-async-storage/async-storage';
import { readAccountGuides, saveAccountGuides } from './accountGuides';

beforeEach(async () => {
  await AsyncStorage.clear();
});

test('계정별 이력은 일반 앱 저장본 삭제·재로그인과 섬 변경에 영향받지 않는다', async () => {
  await saveAccountGuides('alice', { focusDone: true, buildings: ['mail'] });
  await AsyncStorage.removeItem('gromo-r61-user-v2');
  expect(await readAccountGuides('alice')).toEqual({
    focusDone: true,
    buildings: ['mail'],
    completions: [],
  });
  expect(await readAccountGuides('bob')).toEqual({
    focusDone: false,
    buildings: [],
    completions: [],
  });
  await saveAccountGuides('bob', { buildings: ['hall'] });
  expect((await readAccountGuides('alice')).buildings).toEqual(['mail']);
});

test('동시에 마친 건물·집중 체험·완공 안내 이력이 서로 덮어쓰지 않는다', async () => {
  await Promise.all([
    saveAccountGuides('alice', { buildings: ['mail'] }),
    saveAccountGuides('alice', { focusDone: true }),
    saveAccountGuides('alice', { buildings: ['shop'], completions: ['island-a:mail'] }),
  ]);
  await saveAccountGuides('alice', { buildings: ['mail'], focusDone: false });
  expect(await readAccountGuides('alice')).toEqual({
    focusDone: true,
    buildings: ['mail', 'shop'],
    completions: ['island-a:mail'],
  });
});

test('읽기 실패나 손상된 이력을 미열람으로 간주하거나 덮어쓰지 않는다', async () => {
  await AsyncStorage.setItem('gromo:account-guides:v1:alice', '{broken');
  await expect(readAccountGuides('alice')).rejects.toThrow();
  await expect(saveAccountGuides('alice', { buildings: ['mail'] })).rejects.toThrow();
  expect(await AsyncStorage.getItem('gromo:account-guides:v1:alice')).toBe('{broken');
});

test('앱 차단 안내 예약·소비는 계정별로 보관하고 늦은 예약으로 열람 이력을 되돌리지 않는다', async () => {
  await saveAccountGuides('alice', { focusDone: true, focusBlockingIntro: 'pending' });
  await AsyncStorage.removeItem('gromo-r61-user-v2');
  expect((await readAccountGuides('bob')).focusBlockingIntro).toBeUndefined();
  expect((await readAccountGuides('alice')).focusBlockingIntro).toBe('pending');
  await Promise.all([
    saveAccountGuides('alice', { focusBlockingIntro: 'seen' }),
    saveAccountGuides('alice', { buildings: ['mail'] }),
    saveAccountGuides('alice', { focusBlockingIntro: 'pending' }),
  ]);
  expect(await readAccountGuides('alice')).toMatchObject({
    focusDone: true,
    focusBlockingIntro: 'seen',
    buildings: ['mail'],
  });
  expect((await readAccountGuides('bob')).focusBlockingIntro).toBeUndefined();
});

test('구버전 완료·건너뛰기 이력에는 앱 차단 안내를 새로 예약하지 않는다', async () => {
  await AsyncStorage.setItem(
    'gromo:account-guides:v1:alice',
    JSON.stringify({ focusDone: true, buildings: [], completions: [] }),
  );
  expect((await readAccountGuides('alice')).focusBlockingIntro).toBeUndefined();
});

test('카메라 안내 확인 이력은 계정별로 보존하고 늦은 저장이 다시 되돌리지 않는다', async () => {
  await Promise.all([
    saveAccountGuides('alice', { verificationIntroSeen: true }),
    saveAccountGuides('alice', { focusDone: true }),
    saveAccountGuides('alice', { verificationIntroSeen: false }),
  ]);
  expect((await readAccountGuides('alice')).verificationIntroSeen).toBe(true);
  expect((await readAccountGuides('bob')).verificationIntroSeen).toBeUndefined();
});
