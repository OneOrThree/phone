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
