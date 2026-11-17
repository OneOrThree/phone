// 설치된 라이브러리 소스를 실행한다. 네이티브 큐만 대체하고 실제 React 정리와 Worklets 직렬화를 검사한다.
/* global WeakRef */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { setImmediate: tick } = require('node:timers/promises');
const babel = require('@babel/core');
const React = require('react');
const { create, act } = require('react-test-renderer');

global.IS_REACT_ACT_ENVIRONMENT = true;
const modules = process.env.CAMERA_TEST_MODULES || path.resolve(__dirname, '../../node_modules');
function loadSource(relative, mocks, worklets = false) {
  const filename = path.join(modules, relative);
  const { code } = babel.transformSync(fs.readFileSync(filename, 'utf8'), {
    filename,
    configFile: false,
    babelrc: false,
    presets: [require.resolve('@babel/preset-typescript')],
    plugins: [
      ...(worklets ? [require.resolve('react-native-worklets/plugin')] : []),
      require.resolve('@babel/plugin-transform-modules-commonjs'),
    ],
  });
  const exports = {};
  const localRequire = (name) => {
    assert.ok(Object.hasOwn(mocks, name), `예상하지 못한 의존성: ${name}`);
    return mocks[name];
  };
  vm.compileFunction(code, ['exports', 'require'], { filename })(exports, localRequire);
  return exports;
}

// 실제 플러그인이 만든 코드와 명시적 캡처만 새 함수로 복원한다.
// 원래 JS 함수의 숨은 렉시컬 환경이 런타임을 붙잡아 거짓 통과하는 것을 막는다.
function hydrate(value) {
  if (typeof value !== 'function' || !value.__initData) return value;
  const closure = Object.fromEntries(
    Object.entries(value.__closure).map(([key, captured]) => [key, hydrate(captured)]),
  );
  const fn = vm.runInThisContext(`(${value.__initData.code})`);
  return fn.bind({ __closure: closure });
}

function drain(queue, expectError) {
  while (queue.length) {
    const job = queue.shift();
    if (expectError) assert.throws(job, /callback/);
    else job();
  }
}

async function collect() {
  for (let i = 0; i < 5; i += 1) {
    await tick();
    global.gc();
  }
}

async function testHookCleanup() {
  const outputs = [];
  const resolution = { width: 640, height: 480 };
  const { useFrameOutput } = loadSource('react-native-vision-camera/src/hooks/useFrameOutput.ts', {
    react: React,
    '../VisionCamera': {
      VisionCamera: {
        createFrameOutput() {
          const output = {
            thread: {},
            callback: undefined,
            dropped: undefined,
            setOnFrameDroppedCallback(callback) {
              this.dropped = callback;
            },
          };
          outputs.push(output);
          return output;
        },
      },
    },
    '../third-party/VisionCameraWorkletsProxy': {
      VisionCameraWorkletsProxy: {
        createRuntimeForThread: () => ({
          setOnFrameCallback(output, callback) {
            output.callback = callback;
          },
        }),
      },
    },
    '../utils/CommonResolutions': { CommonResolutions: { HD_16_9: resolution } },
  });
  function Camera(props) {
    useFrameOutput(props);
    return null;
  }
  const first = () => {};
  const second = () => {};
  let view;
  await act(() => {
    view = create(React.createElement(Camera, { onFrame: first }));
  });
  assert.equal(outputs[0].callback, first);
  await act(() => view.update(React.createElement(Camera, { onFrame: second })));
  assert.equal(outputs.length, 1);
  assert.equal(outputs[0].callback, second);
  await act(() =>
    view.update(React.createElement(Camera, { onFrame: second, pixelFormat: 'yuv' })),
  );
  assert.equal(outputs.length, 2);
  assert.equal(outputs[0].callback, undefined, '교체된 출력의 콜백 해제');
  assert.equal(outputs[0].dropped, undefined, '교체된 출력의 dropped 콜백 해제');
  assert.equal(outputs[1].callback, second);
  await act(() => view.unmount());
  assert.equal(outputs[1].callback, undefined, '화면 종료 시 프레임 콜백 해제');
  assert.equal(outputs[1].dropped, undefined, '화면 종료 시 dropped 콜백 해제');
  console.log('PASS 출력 교체·콜백 갱신·화면 종료');
}

async function testRetention(mode) {
  const nativeQueue = [];
  const rnQueue = [];
  let weakRuntime;
  let callback;
  const { createRuntimeThreadProvider } = loadSource(
    'react-native-vision-camera-worklets/src/createRuntimeThreadProvider.ts',
    {
      'react-native-worklets': {
        scheduleOnRuntime(runtime, job) {
          if (mode === 'enqueue-error') throw Error('enqueue');
          nativeQueue.push(hydrate(job));
        },
        scheduleOnRN(fn, ...args) {
          rnQueue.push(() => fn(...args));
        },
        scheduleOnUI() {},
      },
      './createAsyncRunner': { createAsyncRunner() {} },
      './createWorkletRuntimeForThread': {
        createWorkletRuntimeForThread() {
          const runtime = {};
          weakRuntime = new WeakRef(runtime);
          return runtime;
        },
      },
    },
    true,
  );
  const output = {
    setOnFrameCallback(value) {
      if (mode === 'callback-error') throw Error('callback');
      callback = value;
    },
  };
  const onFrame = () => {};
  (() => {
    const provider = createRuntimeThreadProvider().createRuntimeForThread({});
    if (mode === 'enqueue-error') {
      assert.throws(() => provider.setOnFrameCallback(output, undefined), /enqueue/);
    } else {
      provider.setOnFrameCallback(output, onFrame);
      provider.setOnFrameCallback(output, undefined);
    }
  })();
  await collect();
  if (mode !== 'enqueue-error') {
    assert.ok(weakRuntime.deref(), '네이티브 정리가 끝나기 전에는 런타임 유지');
    drain(nativeQueue, mode === 'callback-error');
    assert.equal(callback, undefined);
    await collect();
    assert.ok(weakRuntime.deref(), '정리 완료를 RN에 돌려줄 때까지 유지');
    drain(rnQueue, false);
  }
  await collect();
  assert.equal(weakRuntime.deref(), undefined, '완료·예외 후 런타임 누수 없음');
  console.log(`PASS 런타임 수명 ${mode}`);
}

(async () => {
  assert.ok(global.gc, 'node --expose-gc 로 실행해야 한다');
  const selected = process.argv[2];
  if (!selected || selected === 'hook') await testHookCleanup();
  if (!selected || selected === 'retention') {
    for (const mode of ['normal', 'callback-error', 'enqueue-error']) await testRetention(mode);
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
