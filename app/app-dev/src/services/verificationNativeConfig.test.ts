/** @jest-environment node */
import fs from 'node:fs';
import path from 'node:path';

const appRoot = path.resolve(__dirname, '../..');
const expo = require('../../app.config').expo;
const read = (file: string) => fs.readFileSync(path.join(appRoot, file), 'utf8');

test('AI 네이티브 의존성이 없는 이전 앱과 OTA 런타임을 공유하지 않는다', () => {
  expect(expo.ios.runtimeVersion).not.toBe('2.0.0-push-meta-assets-v1');
  expect(expo.android.runtimeVersion).not.toBe('2.0.1-android-push-assets-v1');
  const ios = read('ios/Cattus/Supporting/Expo.plist').match(
    /<key>EXUpdatesRuntimeVersion<\/key>\s*<string>([^<]+)<\/string>/,
  )?.[1];
  const android = read('android/app/src/main/res/values/strings.xml').match(
    /<string name="expo_runtime_version">([^<]+)<\/string>/,
  )?.[1];
  expect(ios).toBe(expo.ios.runtimeVersion);
  expect(android).toBe(expo.android.runtimeVersion);
});

test('카메라 라이브러리가 추가해도 마이크 권한을 앱에서 제거한다', () => {
  expect(expo.android.blockedPermissions).toContain('android.permission.RECORD_AUDIO');
  expect(read('android/app/src/main/AndroidManifest.xml')).toMatch(
    /<uses-permission[^>]+android:name="android.permission.RECORD_AUDIO"[^>]+tools:node="remove"/,
  );
  const camera = expo.plugins.find((plugin: unknown) =>
    Array.isArray(plugin) ? plugin[0] === 'expo-camera' : false,
  );
  expect(camera?.[1]).toMatchObject({ microphonePermission: false, recordAudioAndroid: false });
  expect(read('ios/Cattus/Info.plist')).not.toContain('NSMicrophoneUsageDescription');
});
