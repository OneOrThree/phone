// 캐릭터 생성기 연출 계약 (GROMO-1494 · 정책 D21 — 누끼 완성은 축하 표면 등급 3).
//
// 이 화면의 비동기 대기는 **연속된 3단계가 아니다.** 누끼(`working`)가 끝나면 곧바로 `ready`로
// 돌아오고, 확인·저장은 사용자가 저장 버튼을 누른 뒤에야 시작한다. 그래서 아래 테스트도
// **두 구간을 나눠** 잠근다:
//
//   ① 누끼 구간 — 진행 링 → 완성 리빌 + hapticSuccess(**한 번**). 여기가 축하다.
//   ② 저장 구간 — 진행 표시일 뿐이다. **저장 성공에 hapticSuccess가 붙으면 안 된다**(축하 표면을
//      늘리지 않는다는 계약). 실패 3경로에서 연출이 중간 상태로 굳지 않아야 한다.
//
// ⚠️ 중간 프레임·이징 곡선은 단언하지 않는다(정책 D14). 보는 것은 "무엇이 시작/정리됐는가"뿐이다.
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import CharacterCreator from './CharacterCreator';
import { M } from '@/constants/motion';
import { hapticSuccess } from '@/utils/haptics';
import { cutoutSubject, saveCustomCharacter } from '@/services/subjectMask';
import { moderateImage } from '@/services/characterApi';
import * as ImagePicker from 'expo-image-picker';

let mockReduce = false;
jest.mock('@/hooks/useReduceMotion', () => ({
  useReduceMotion: () => mockReduce,
  useReduceMotionReady: () => true,
  whenReduceMotionReady: () => Promise.resolve(),
}));

jest.mock('@/utils/haptics', () => ({ hapticSuccess: jest.fn() }));

jest.mock('expo-image-picker', () => ({
  launchImageLibraryAsync: jest.fn(),
  launchCameraAsync: jest.fn(),
  requestCameraPermissionsAsync: jest.fn(() => Promise.resolve({ granted: true })),
}));

// 회전(rotate)은 이 테스트의 관심사가 아니지만 모듈이 임포트 시점에 네이티브를 붙잡는다.
jest.mock('expo-image-manipulator', () => ({
  ImageManipulator: { manipulate: jest.fn() },
  SaveFormat: { PNG: 'png' },
}));

jest.mock('react-native-view-shot', () => ({
  captureRef: jest.fn(() => Promise.resolve('BASE64')),
}));

jest.mock('@/services/subjectMask', () => ({
  cutoutSubject: jest.fn(),
  isSubjectMaskSupported: () => true,
  saveCustomCharacter: jest.fn(() => Promise.resolve('file:///custom.png')),
  subjectMaskReasonLabel: (reason: string) => `누끼 실패(${reason})`,
}));

jest.mock('@/services/characterApi', () => ({
  getCharacterQuota: jest.fn(() =>
    Promise.resolve({ unlimited: true, remaining: null, resetAt: null }),
  ),
  moderateImage: jest.fn(),
  recordCharacterGeneration: jest.fn(() => Promise.resolve()),
}));

jest.mock('react-native-svg', () => {
  const { View: RNView } = require('react-native');
  return {
    __esModule: true,
    default: RNView,
    Svg: RNView,
    Circle: RNView,
    Ellipse: RNView,
    Path: RNView,
  };
});

const cutoutMock = cutoutSubject as jest.Mock;
const saveMock = saveCustomCharacter as jest.Mock;
const moderateMock = moderateImage as jest.Mock;
const hapticMock = hapticSuccess as jest.Mock;
const pickMock = ImagePicker.launchImageLibraryAsync as jest.Mock;

const RING = 'character.progress';
const MASK = 'character.reveal.mask';
const DONE = '나만의 그로몬이 완성됐어요';

const CUTOUT_OK = {
  uri: 'file:///cutout.png',
  width: 400,
  height: 500,
  cutout: true,
  reason: '',
};

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  mockReduce = false;
  pickMock.mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///photo.jpg' }] });
  cutoutMock.mockResolvedValue(CUTOUT_OK);
  saveMock.mockResolvedValue('file:///custom.png');
  moderateMock.mockResolvedValue({ allowed: true, flaggedCategories: [], unavailable: false });
});

afterEach(() => {
  jest.useRealTimers();
});

/** 대기 중인 프라미스(쿼터 조회·누끼 등)를 흘려보낸다. */
async function flush(): Promise<void> {
  await act(async () => {});
}

async function advance(ms: number): Promise<void> {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
}

async function mount(onSaved = jest.fn()): Promise<jest.Mock> {
  await render(<CharacterCreator onSaved={onSaved} />);
  await flush(); // 쿼터 조회
  return onSaved;
}

/** 앨범에서 고르기 → 누끼 실행. */
async function pick(): Promise<void> {
  await fireEvent.press(screen.getByText('사진 고르기'));
  await flush();
}

type Node = ReturnType<typeof screen.getByText>;

// RTL v14엔 UNSAFE_* 탐색기가 없어, 트리를 내려가며 해당 prop을 가진 노드를 찾는다.
function findWithProp(node: Node, prop: string): Node | null {
  if (typeof node.props?.[prop] === 'function') return node;
  for (const child of node.children) {
    if (typeof child === 'string') continue;
    const found = findWithProp(child as Node, prop);
    if (found) return found;
  }
  return null;
}

/**
 * 눌러 놓고 **기다리지 않는다.**
 *
 * ⚠️ RTL의 `fireEvent.press`는 async 함수라 **핸들러가 돌려준 프라미스까지 await한다.** 아직
 *    끝나지 않은 비동기 작업(누끼·모더레이션)을 대기 상태로 붙잡은 채 화면을 보려면 그대로
 *    교착한다. 그래서 onPress를 직접 찾아 act 안에서 발사만 하고 상태 갱신만 흘려보낸다.
 */
async function pressWithoutWaiting(label: string): Promise<void> {
  const pressed = fireEvent.press(screen.getByText(label));
  // 반환 프라미스는 버리되 미처리 거부로 남지 않게 흡수한다.
  pressed.catch(() => {});
  // fireEvent가 내부에서 연 act 스코프가 닫힐 때까지 **act 밖에서** 마이크로태스크만 흘린다.
  // (여기서 act를 열면 "overlapping act() calls"로 이후 렌더가 통째로 어긋난다.)
  for (let i = 0; i < 50; i += 1) await Promise.resolve();
}

/**
 * 오브젝트 이미지 디코드 완료를 알린다 — 프로덕션에서는 ObjectCharacter의 <Image onLoad>가
 * 이 신호를 만든다. 리빌 시작과 저장 잠금 해제가 **둘 다** 이 신호에 걸려 있으므로,
 * 테스트도 그 실제 배선을 통과시킨다(스텁으로 대체하지 않는다).
 */
async function decodeImage(): Promise<void> {
  const root = screen.root;
  if (!root) throw new Error('렌더 루트를 찾지 못했다');
  const image = findWithProp(root, 'onLoad');
  if (!image) throw new Error('onLoad를 가진 오브젝트 이미지를 찾지 못했다');
  await act(async () => {
    fireEvent(image, 'load');
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// ① 누끼 구간
// ─────────────────────────────────────────────────────────────────────────────

describe('누끼 구간 — 진행 링과 완성 리빌', () => {
  test('누끼가 도는 동안 진행 링이 뜨고, 끝나면 걷힌다', async () => {
    let finishCutout: (v: typeof CUTOUT_OK) => void = () => {};
    cutoutMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishCutout = resolve;
        }),
    );

    await mount();
    await pressWithoutWaiting('사진 고르기');
    expect(screen.getByTestId(RING)).toBeTruthy();
    expect(screen.getByText('물건만 오려내는 중…')).toBeTruthy();

    await act(async () => {
      finishCutout(CUTOUT_OK);
    });
    expect(screen.queryByTestId(RING)).toBeNull();
  });

  test('완성 순간 hapticSuccess가 한 번 불린다', async () => {
    await mount();
    await pick();
    // 디코드 전에는 마스크가 덮은 채 기다린다 — 아직 축하하지 않는다.
    expect(hapticMock).not.toHaveBeenCalled();
    await decodeImage();
    expect(hapticMock).not.toHaveBeenCalled();

    // 리빌 50% 지점에서 완성을 통보한다.
    await advance(M.dur.celebrate / 2);
    expect(hapticMock).toHaveBeenCalledTimes(1);
    expect(screen.getByText(DONE)).toBeTruthy();

    // 리빌이 끝나고도 다시 울리지 않는다.
    await advance(M.dur.celebrate * 3);
    expect(hapticMock).toHaveBeenCalledTimes(1);
  });

  test('리빌이 끝나면 마스크를 걷는다', async () => {
    await mount();
    await pick();
    await decodeImage();
    expect(screen.getByTestId(MASK)).toBeTruthy();

    await advance(M.dur.celebrate);
    expect(screen.queryByTestId(MASK)).toBeNull();
  });

  test('누끼 실패(폴백)면 리빌도 완성 통보도 없다', async () => {
    cutoutMock.mockResolvedValue({ ...CUTOUT_OK, cutout: false, reason: 'no_subject' });

    await mount();
    await pick();
    await decodeImage();
    await advance(M.dur.celebrate * 2);

    expect(hapticMock).not.toHaveBeenCalled();
    expect(screen.queryByTestId(MASK)).toBeNull();
    expect(screen.queryByText(DONE)).toBeNull();
    // 링도 함께 정리된다 — 사유 안내와 함께 편집 가능한 상태로 돌아온다.
    expect(screen.queryByTestId(RING)).toBeNull();
    expect(screen.getByText('누끼 실패(no_subject)')).toBeTruthy();
  });

  test('누끼가 던져도 링이 처리 중에 굳지 않는다', async () => {
    cutoutMock.mockRejectedValue(new Error('vision boom'));

    await mount();
    await pick();
    await advance(M.dur.celebrate);

    expect(screen.queryByTestId(RING)).toBeNull();
    expect(screen.getByText('사진에서 물건을 오려내지 못했어요. 다시 시도해 주세요.')).toBeTruthy();
    // 다시 고를 수 있는 상태로 돌아온다.
    expect(screen.getByText('사진 고르기')).toBeTruthy();
  });
});

describe("누끼 구간 — '동작 줄이기'", () => {
  test('리빌은 생략하고 완성 통보·햅틱은 그대로 낸다', async () => {
    mockReduce = true;

    await mount();
    await pick();
    await decodeImage();

    // 마스크가 아예 렌더되지 않는다 = 리빌 생략.
    expect(screen.queryByTestId(MASK)).toBeNull();
    // 그래도 축하는 사라지지 않는다 (정책 D21 · 정본 D7).
    expect(hapticMock).toHaveBeenCalledTimes(1);
    expect(screen.getByText(DONE)).toBeTruthy();
  });

  test('대조군 — 설정이 꺼져 있으면 마스크가 실제로 덮인다', async () => {
    mockReduce = false;

    await mount();
    await pick();
    await decodeImage();

    expect(screen.getByTestId(MASK)).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ② 저장 구간 — 축하가 아니라 진행 표시다
// ─────────────────────────────────────────────────────────────────────────────

/** 누끼를 끝내고 리빌까지 재생한 뒤, 저장 버튼을 누를 수 있는 상태로 만든다. */
async function readyToSave(onSaved = jest.fn()): Promise<jest.Mock> {
  const saved = await mount(onSaved);
  await pick();
  await decodeImage();
  await advance(M.dur.celebrate);
  hapticMock.mockClear(); // 누끼 구간의 축하는 여기서 잊는다 — 이제 저장 구간만 본다
  return saved;
}

describe('저장 구간 — 진행 표시', () => {
  test('검사 중에는 진행 링이 뜬다', async () => {
    await readyToSave();

    let finishModeration: (v: {
      allowed: boolean;
      flaggedCategories: string[];
      unavailable: boolean;
    }) => void = () => {};
    moderateMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishModeration = resolve;
        }),
    );

    await pressWithoutWaiting('저장');
    expect(screen.getByTestId(RING)).toBeTruthy();
    expect(screen.getByText('이미지를 확인하는 중…')).toBeTruthy();

    // 통과하면 저장 단계로 넘어간다 — 링은 그대로 남고 문구만 바뀐다.
    // (저장 성공 뒤에는 감싸는 화면이 onSaved로 이 화면을 걷으므로 여기서 링을 끄지 않는다.)
    await act(async () => {
      finishModeration({ allowed: true, flaggedCategories: [], unavailable: false });
    });
    expect(screen.getByTestId(RING)).toBeTruthy();
  });

  test('저장 성공에는 hapticSuccess가 붙지 않는다', async () => {
    const onSaved = await readyToSave();

    await fireEvent.press(screen.getByText('저장'));
    await flush();
    await advance(M.dur.celebrate * 2);

    expect(onSaved).toHaveBeenCalledWith('file:///custom.png');
    // 축하 표면은 누끼 완성 하나뿐이다 — 저장 성공까지 등급 3으로 올리지 않는다.
    expect(hapticMock).not.toHaveBeenCalled();
  });
});

describe('저장 구간 — 실패 3경로에서 연출이 굳지 않는다', () => {
  // 세 경로 모두 phase가 ready로 되돌아온다: 검사 불가 / 차단 / 예외.
  test.each([
    [
      '모더레이션 검사 불가',
      () =>
        moderateMock.mockResolvedValue({
          allowed: false,
          flaggedCategories: [],
          unavailable: true,
        }),
      '지금은 확인이 어려워요. 잠시 후 다시 시도해 주세요.',
    ],
    [
      '모더레이션 차단',
      () =>
        moderateMock.mockResolvedValue({
          allowed: false,
          flaggedCategories: ['nsfw'],
          unavailable: false,
        }),
      '이 사진으로는 캐릭터를 만들 수 없어요.',
    ],
    [
      '저장 예외',
      () => saveMock.mockRejectedValue(new Error('disk full')),
      '캐릭터를 저장하지 못했어요. 다시 시도해 주세요.',
    ],
  ])('%s — 링이 걷히고 다시 저장할 수 있다', async (_label, arrange, notice) => {
    await readyToSave();
    arrange();

    await fireEvent.press(screen.getByText('저장'));
    await flush();
    await advance(M.dur.celebrate * 2);

    expect(screen.getByText(notice)).toBeTruthy();
    // 진행 링이 검사·저장 상태로 굳지 않는다.
    expect(screen.queryByTestId(RING)).toBeNull();
    // 마스크도 다시 나타나지 않는다(리빌은 이미 끝났다).
    expect(screen.queryByTestId(MASK)).toBeNull();
    // 저장 버튼이 다시 눌리는 상태로 돌아온다.
    expect(screen.getByText('저장')).toBeTruthy();
    // 실패는 축하가 아니다.
    expect(hapticMock).not.toHaveBeenCalled();
  });

  test('검사 불가는 onUnavailable로 따로 알린다', async () => {
    const onUnavailable = jest.fn();
    await render(<CharacterCreator onSaved={jest.fn()} onUnavailable={onUnavailable} />);
    await flush();
    await pick();
    await decodeImage();
    await advance(M.dur.celebrate);

    moderateMock.mockResolvedValue({ allowed: false, flaggedCategories: [], unavailable: true });
    await fireEvent.press(screen.getByText('저장'));
    await flush();

    expect(onUnavailable).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId(RING)).toBeNull();
  });
});
