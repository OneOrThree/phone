// 앱 고르기 화면(안드로이드) — 측정 대상(GROMO-1593) · 집중 허용앱(GROMO-1603) 공용.
//
// 잠그는 것의 핵심은 **두 모드에서 빈 선택의 뜻이 정반대**라는 점이다.
//   - measured: 0개 = 전체 앱 측정(미설정과 같음)
//   - allowed : 0개 = 허용앱 없음
// 이 뜻이 문구와 어긋나면 사용자는 정반대 결과를 얻는다. 측정 쪽은 특히 나쁘다 — 측정을
// 끄려고 전부 해제했다가 오히려 전체 측정이 켜지고, 화면에 되돌릴 방법이 없다.
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import AppPickerScreen from './AppPickerScreen';
import AsyncStorage from '@react-native-async-storage/async-storage';
import ScreenTimeModule from '@/services/ScreenTimeModule';
import { STORAGE_KEYS } from '@/types/storage';

const mockGoBack = jest.fn();
// jest.mock 팩토리는 외부 변수를 참조할 수 없다 — `mock` 프리픽스만 예외로 허용된다.
let mockRouteParams: { mode: 'measured' | 'allowed' } = { mode: 'measured' };

jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context'),
  useSafeAreaInsets: () => ({ top: 47, left: 0, right: 0, bottom: 34 }),
}));

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ goBack: mockGoBack }),
  useRoute: () => ({ params: mockRouteParams }),
}));

jest.mock('@/services/ScreenTimeModule', () => ({
  __esModule: true,
  default: {
    getInstalledApps: jest.fn(),
    getAppIcon: jest.fn(),
    getSelectionPackages: jest.fn(),
    setSelectionPackages: jest.fn(),
    getAllowedPackages: jest.fn(),
    setAllowedPackages: jest.fn(),
  },
}));

const m = ScreenTimeModule as jest.Mocked<typeof ScreenTimeModule>;

const APPS = [
  { packageName: 'com.kakao.talk', label: '카카오톡' },
  { packageName: 'com.google.android.youtube', label: 'YouTube' },
  { packageName: 'com.instagram.android', label: 'Instagram' },
];

async function renderScreen(mode: 'measured' | 'allowed' = 'measured') {
  mockRouteParams = { mode };
  await act(async () => {
    render(<AppPickerScreen />);
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  m.getInstalledApps.mockResolvedValue(APPS);
  m.getSelectionPackages.mockResolvedValue([]);
  m.getAllowedPackages.mockResolvedValue([]);
  m.setSelectionPackages.mockResolvedValue(undefined);
  m.setAllowedPackages.mockResolvedValue(undefined);
  m.getAppIcon.mockResolvedValue(null);
});

describe('측정 대상 모드 — 0개는 「전체 측정」', () => {
  test('CTA와 안내가 0개의 뜻을 말한다', async () => {
    await renderScreen('measured');

    expect(screen.getByText('전체 앱 측정으로 저장')).toBeOnTheScreen();
    expect(screen.getByText(/하나도 고르지 않으면 전체 앱을 집계해요/)).toBeOnTheScreen();
  });

  // 빈 배열을 그대로 넘겨야 네이티브가 키를 지워 '미설정=전체 측정'으로 되돌린다.
  test('0개 저장은 빈 배열을 측정 대상 쪽에 넘긴다', async () => {
    await renderScreen('measured');

    await act(async () => {
      fireEvent.press(screen.getByTestId('appPicker.save'));
    });

    expect(m.setSelectionPackages).toHaveBeenCalledWith([]);
    expect(m.setAllowedPackages).not.toHaveBeenCalled();
  });

  test('고른 앱만 저장하고 화면을 닫는다', async () => {
    await renderScreen('measured');

    await act(async () => {
      fireEvent.press(screen.getByTestId('appPicker.row.com.kakao.talk'));
    });
    expect(screen.getByText('1개 앱만 측정하도록 저장')).toBeOnTheScreen();

    await act(async () => {
      fireEvent.press(screen.getByTestId('appPicker.save'));
    });

    expect(m.setSelectionPackages).toHaveBeenCalledWith(['com.kakao.talk']);
    expect(mockGoBack).toHaveBeenCalled();
  });
});

describe('허용앱 모드 — 0개는 「허용앱 없음」', () => {
  // 같은 0개인데 측정 쪽 문구('전체')를 쓰면 정반대 뜻이 된다.
  test('CTA와 안내가 측정 대상과 반대 뜻을 말한다', async () => {
    await renderScreen('allowed');

    expect(screen.getByText('허용앱 없이 저장')).toBeOnTheScreen();
    expect(screen.getByText(/고르지 않으면 허용앱이 없어요/)).toBeOnTheScreen();
    expect(screen.queryByText(/전체 앱을 집계해요/)).toBeNull();
  });

  test('허용앱 쪽 저장 함수를 부른다', async () => {
    await renderScreen('allowed');

    await act(async () => {
      fireEvent.press(screen.getByTestId('appPicker.row.com.google.android.youtube'));
    });
    expect(screen.getByText('1개 앱 허용으로 저장')).toBeOnTheScreen();

    await act(async () => {
      fireEvent.press(screen.getByTestId('appPicker.save'));
    });

    expect(m.setAllowedPackages).toHaveBeenCalledWith(['com.google.android.youtube']);
    // 두 목록은 뜻이 반대라 절대 같은 키에 쓰면 안 된다.
    expect(m.setSelectionPackages).not.toHaveBeenCalled();
  });

  test('저장된 허용앱을 복원한다', async () => {
    m.getAllowedPackages.mockResolvedValue(['com.instagram.android']);

    await renderScreen('allowed');

    expect(screen.getByTestId('appPicker.row.com.instagram.android')).toBeChecked();
    expect(screen.getByTestId('appPicker.row.com.kakao.talk')).not.toBeChecked();
  });
});

describe('검색', () => {
  test('라벨과 패키지명 양쪽으로 찾는다', async () => {
    await renderScreen();

    await act(async () => {
      fireEvent.changeText(screen.getByTestId('appPicker.search'), 'kakao');
    });

    expect(screen.getByText('카카오톡')).toBeOnTheScreen();
    expect(screen.queryByText('YouTube')).toBeNull();
  });

  // 검색으로 걸러진 항목의 선택이 풀리면, 검색해서 고르는 흐름 자체가 성립하지 않는다.
  test('검색으로 가려져도 이미 한 선택은 유지된다', async () => {
    await renderScreen();

    await act(async () => {
      fireEvent.press(screen.getByTestId('appPicker.row.com.kakao.talk'));
    });
    await act(async () => {
      fireEvent.changeText(screen.getByTestId('appPicker.search'), 'youtube');
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId('appPicker.save'));
    });

    expect(m.setSelectionPackages).toHaveBeenCalledWith(['com.kakao.talk']);
  });
});

// 실패를 빈 목록으로 뭉개면 '앱이 없음'과 구분이 안 된다 — 실제로 네이티브가 빠진 빌드에서
// 목록이 비어 보였고 원인을 화면만 보고는 알 수 없었다.
describe('목록 조회 실패', () => {
  test('실패는 「검색 결과 없음」이 아니라 실패로 알린다', async () => {
    m.getInstalledApps.mockRejectedValue(new Error('native missing'));

    await renderScreen();

    expect(screen.getByTestId('appPicker.error')).toBeOnTheScreen();
    expect(screen.queryByText('검색 결과가 없어요')).toBeNull();
  });

  test('아이콘 조회가 실패해도 행은 그려진다', async () => {
    m.getAppIcon.mockRejectedValue(new Error('no icon'));

    await renderScreen();

    expect(screen.getByText('카카오톡')).toBeOnTheScreen();
  });
});

// 저장이 **기존 값을 지우는** 경로 — GROMO-1593 코드리뷰.
describe('준비되기 전에는 저장하지 않는다', () => {
  // 빈 배열은 '0개 측정'이 아니라 '미설정 = 전체 앱 측정'이라, 눌린 줄도 모르고 대상이 날아간다.
  test('목록 조회가 실패하면 저장 버튼이 막힌다', async () => {
    m.getInstalledApps.mockRejectedValue(new Error('native missing'));

    await renderScreen();
    await act(async () => {
      fireEvent.press(screen.getByTestId('appPicker.save'));
    });

    expect(m.setSelectionPackages).not.toHaveBeenCalled();
    expect(mockGoBack).not.toHaveBeenCalled();
  });
});

// 지웠거나 런처 항목이 사라진 앱 — 행이 없는데 선택값에만 남아 있으면 화면에서 풀 수 없다.
describe('설치 목록에 없는 저장값은 복원하지 않는다', () => {
  test('사라진 패키지는 선택 개수에 포함되지 않는다', async () => {
    m.getSelectionPackages.mockResolvedValue(['com.kakao.talk', 'com.deleted.app']);

    await renderScreen();

    // 살아 있는 1개만 남는다 — 사라진 것까지 세면 '2개 앱만 측정하도록 저장'이 된다.
    expect(screen.getByText('1개 앱만 측정하도록 저장')).toBeOnTheScreen();
  });

  test('저장할 때도 사라진 패키지는 빠진다', async () => {
    m.getSelectionPackages.mockResolvedValue(['com.kakao.talk', 'com.deleted.app']);

    await renderScreen();
    await act(async () => {
      fireEvent.press(screen.getByTestId('appPicker.save'));
    });

    expect(m.setSelectionPackages).toHaveBeenCalledWith(['com.kakao.talk']);
  });
});

// 측정 대상을 바꾸면 오늘 동기화 캐시를 버려야 한다 — GROMO-1593 코드리뷰 8차.
//
// 그 캐시엔 바꾸기 **전** 기준으로 올린 큰 분값이 남는다. 다음날 마감이 새 대상으로
// 재계산한 값과 Math.max 로 합치므로, 바꾸기 전 사용량이 최종 서버 기록과 목표 판정에 박힌다.
describe('대상을 바꾸면 오늘 동기화 캐시를 버린다', () => {
  test('측정 대상 저장 시 캐시를 지운다', async () => {
    await AsyncStorage.setItem(STORAGE_KEYS.screentimeSyncState, '{"minutes":120}');

    await renderScreen('measured');
    await act(async () => {
      fireEvent.press(screen.getByTestId('appPicker.save'));
    });

    expect(await AsyncStorage.getItem(STORAGE_KEYS.screentimeSyncState)).toBeNull();
  });

  // 허용앱은 사용량 계산과 무관하다 — 지우면 멀쩡한 동기화 상태를 잃는다.
  test('허용앱 저장은 캐시를 건드리지 않는다', async () => {
    await AsyncStorage.setItem(STORAGE_KEYS.screentimeSyncState, '{"minutes":120}');

    await renderScreen('allowed');
    await act(async () => {
      fireEvent.press(screen.getByTestId('appPicker.save'));
    });

    expect(await AsyncStorage.getItem(STORAGE_KEYS.screentimeSyncState)).toBe('{"minutes":120}');
  });
});
