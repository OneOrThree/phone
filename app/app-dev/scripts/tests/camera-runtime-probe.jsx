// 로컬 전용 진단 entry. 서버 요청·촬영 없이 실제 Nitro/Worklets 큐를 실행한다.
// iOS Release + ThreadSanitizer 빌드의 ENTRY_FILE로 지정하고 전용 시뮬레이터에서 실행한다.
// 상세 실행 조건과 한계: docs/engineering/sentry/2026-11-16-camera-and-dsym.md
import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { registerRootComponent } from 'expo';
import { File, Paths } from 'expo-file-system';
import { VisionCamera } from 'react-native-vision-camera';
import {
  createRuntimeThreadProvider,
  createWorkletRuntimeForThread,
} from 'react-native-vision-camera-worklets';
import { scheduleOnRuntime, scheduleOnRN } from 'react-native-worklets';

const target = 30;
const nativeCallsPerRuntime = 10_000;
// 관찰용 런타임은 검사 종료까지 유지한다. 검사 대상 provider는 아래 함수가 반환되면 놓는다.
const observers = [];
let completed = 0;
let onFinish = () => {};
function done() {
  completed += 1;
  onFinish(completed);
  new File(Paths.document, 'sentry-repro.json').write(
    JSON.stringify({ completed, target, nativeCallsPerRuntime }),
  );
}

function runProbe() {
  const output = VisionCamera.createFrameOutput({
    targetResolution: { width: 640, height: 480 },
    pixelFormat: 'yuv',
    dropFramesWhileBusy: true,
    enableCameraMatrixDelivery: false,
    enablePhysicalBufferRotation: false,
    enablePreviewSizedOutputBuffers: false,
    allowDeferredStart: true,
  });
  const thread = output.thread;
  const threadId = thread.id;
  const observer = createWorkletRuntimeForThread(thread);
  observers.push(observer);

  const runtime = createRuntimeThreadProvider().createRuntimeForThread(thread);
  runtime.setOnFrameCallback(output, (frame) => {
    'worklet';
    frame.dispose();
  });
  runtime.setOnFrameCallback(output, undefined);
  // 같은 직렬 큐에서 등록·해제 다음에 실행한다. 이 함수가 반환된 뒤에도 정리가 완료돼야 한다.
  scheduleOnRuntime(observer, () => {
    'worklet';
    for (let i = 0; i < nativeCallsPerRuntime; i += 1) {
      if (output.thread.id !== threadId) throw Error('카메라 executor가 달라졌다');
      output.setOnFrameCallback(undefined);
    }
    scheduleOnRN(done);
  });
}

function App() {
  const [status, setStatus] = useState('starting');
  useEffect(() => {
    new File(Paths.document, 'sentry-repro.json').write(JSON.stringify({ completed: 0, target }));
    onFinish = (count) => setStatus(`completed ${count}/${target}`);
    let index = 0;
    const timer = setInterval(() => {
      if (index >= target) {
        clearInterval(timer);
        return;
      }
      index += 1;
      runProbe();
    }, 1);
    return () => clearInterval(timer);
  }, []);
  return (
    <View style={styles.screen}>
      <Text>{status}</Text>
    </View>
  );
}

const styles = StyleSheet.create({ screen: { flex: 1, paddingTop: 150 } });

registerRootComponent(App);
