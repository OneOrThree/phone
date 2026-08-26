// 탭 효과음 재생 계층 테스트 — 정책을 문장이 아니라 테스트로 고정한다.
// (PressableScale.test.tsx는 이 모듈을 통째로 목킹하므로 재생 계층 자체는 여기서만 검증된다)
//
// sound.ts는 모듈 스코프 상태(플레이어·ready·재시도 횟수)를 들고 있어 케이스마다
// jest.resetModules()로 새로 로드한다. expo-audio는 jest.setup.js의 전역 목 대신
// 케이스별로 제어 가능한 로컬 목으로 덮어쓴다.

const mockPlay = jest.fn();
const mockSeekTo = jest.fn(() => Promise.resolve());
const mockCreateAudioPlayer = jest.fn(() => ({ volume: 1, play: mockPlay, seekTo: mockSeekTo }));
const mockSetAudioModeAsync = jest.fn((_mode: unknown) => Promise.resolve());

jest.mock('expo-audio', () => ({
  createAudioPlayer: () => mockCreateAudioPlayer(),
  setAudioModeAsync: (mode: unknown) => mockSetAudioModeAsync(mode),
}));

/** 모듈 상태를 초기화한 sound 모듈을 새로 로드한다. */
function loadSound(): typeof import('./sound') {
  jest.resetModules();
  return require('./sound');
}

/** 프리로드 체인(setAudioModeAsync → createAudioPlayer)이 끝날 때까지 마이크로태스크를 비운다. */
function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSeekTo.mockImplementation(() => Promise.resolve());
  mockSetAudioModeAsync.mockImplementation(() => Promise.resolve());
  mockCreateAudioPlayer.mockImplementation(() => ({
    volume: 1,
    play: mockPlay,
    seekTo: mockSeekTo,
  }));
});

describe('preloadTapSound', () => {
  test('두 번 호출해도 플레이어는 하나만 만든다(멱등)', async () => {
    const sound = loadSound();
    sound.preloadTapSound();
    await flush();
    sound.preloadTapSound();
    await flush();
    expect(mockCreateAudioPlayer).toHaveBeenCalledTimes(1);
  });

  test('오디오 모드 설정이 성공한 뒤에만 플레이어를 만든다', async () => {
    const sound = loadSound();
    sound.preloadTapSound();
    // 아직 setAudioModeAsync가 resolve되기 전 — 플레이어 생성 전이어야 한다
    expect(mockSetAudioModeAsync).toHaveBeenCalledTimes(1);
    expect(mockCreateAudioPlayer).not.toHaveBeenCalled();
    await flush();
    expect(mockCreateAudioPlayer).toHaveBeenCalledTimes(1);
  });

  test('무음 스위치 존중·믹싱 옵션으로 오디오 모드를 잡는다', async () => {
    const sound = loadSound();
    sound.preloadTapSound();
    await flush();
    expect(mockSetAudioModeAsync).toHaveBeenCalledWith({
      playsInSilentMode: false,
      shouldPlayInBackground: false,
      interruptionMode: 'mixWithOthers',
    });
  });

  test('createAudioPlayer가 던져도 크래시하지 않고 무음으로 격하된다', async () => {
    mockCreateAudioPlayer.mockImplementation(() => {
      throw new Error('native missing');
    });
    const sound = loadSound();
    expect(() => sound.preloadTapSound()).not.toThrow();
    await flush();
    expect(() => sound.playTapSound()).not.toThrow();
    expect(mockPlay).not.toHaveBeenCalled();
  });
});

describe('playTapSound', () => {
  test('되감기(seekTo 0) 후에 재생한다 — 연타 시 겹치지 않게', async () => {
    const sound = loadSound();
    sound.preloadTapSound();
    await flush();

    sound.playTapSound();
    // seekTo가 resolve되기 전에는 play가 불리면 안 된다(순서 보장이 연타 정책의 핵심)
    expect(mockSeekTo).toHaveBeenCalledWith(0);
    expect(mockPlay).not.toHaveBeenCalled();
    await flush();
    expect(mockPlay).toHaveBeenCalledTimes(1);
  });

  test('프리로드 없이 먼저 호출하면 지연 초기화된다(이번 탭은 무음, 다음 탭부터 소리)', async () => {
    const sound = loadSound();
    sound.playTapSound();
    expect(mockSetAudioModeAsync).toHaveBeenCalledTimes(1);
    expect(mockPlay).not.toHaveBeenCalled();
    await flush();

    sound.playTapSound();
    await flush();
    expect(mockPlay).toHaveBeenCalledTimes(1);
  });

  test('오디오 모드 설정이 실패하면 재생하지 않는다(남의 음악을 끊느니 무음)', async () => {
    mockSetAudioModeAsync.mockImplementation(() => Promise.reject(new Error('session busy')));
    const sound = loadSound();
    sound.preloadTapSound();
    await flush();

    sound.playTapSound();
    await flush();
    expect(mockCreateAudioPlayer).not.toHaveBeenCalled();
    expect(mockPlay).not.toHaveBeenCalled();
  });

  test('프리로드 실패는 재시도하되 3회로 막는다(매 탭 재시도 폭주 방지)', async () => {
    mockSetAudioModeAsync.mockImplementation(() => Promise.reject(new Error('session busy')));
    const sound = loadSound();

    // 최초 1회 + 탭마다 재시도 → 상한 3회에서 멈춘다
    for (let i = 0; i < 6; i += 1) {
      sound.playTapSound();
      await flush();
    }
    expect(mockSetAudioModeAsync).toHaveBeenCalledTimes(3);

    // 일시적 실패에서 회복되면 소리가 돌아와야 하지만, 상한을 넘긴 뒤엔 재시도하지 않는다
    mockSetAudioModeAsync.mockImplementation(() => Promise.resolve());
    sound.playTapSound();
    await flush();
    expect(mockSetAudioModeAsync).toHaveBeenCalledTimes(3);
  });

  test('상한 안에서는 일시적 실패 후 다음 탭에 복구된다', async () => {
    mockSetAudioModeAsync.mockImplementationOnce(() => Promise.reject(new Error('session busy')));
    const sound = loadSound();

    sound.playTapSound(); // 1회차 실패
    await flush();
    expect(mockPlay).not.toHaveBeenCalled();

    sound.playTapSound(); // 2회차 성공 — 준비만 하고 이번 탭은 무음
    await flush();
    sound.playTapSound();
    await flush();
    expect(mockPlay).toHaveBeenCalledTimes(1);
  });
});
