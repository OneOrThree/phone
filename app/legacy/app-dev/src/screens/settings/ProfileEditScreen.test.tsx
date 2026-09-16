// ProfileEditScreen(프로필 편집) 닉네임 실시간 중복확인 테스트 — GROMO-1215·GROMO-1231.
//
// 이 화면의 계약:
//  1) 형식(2~10자) 통과 + 현재값과 다른 입력만 디바운스(350ms) 후 checkNickname을 부른다.
//  2) available=true → 초록 체크 + '사용 가능해요', false → '이미 사용 중인 닉네임이에요'.
//  3) 확인 실패(네트워크·구서버 404, unknown)는 중립 안내로 분리한다 — 초록 체크·'사용
//     가능해요'로 오인시키지 않는다(GROMO-1231). 저장은 계속 허용(409가 최종 방어).
//  4) 저장 409(NICKNAME_DUPLICATE)는 계속 Alert로 정확히 안내한다(GROMO-639 무회귀) —
//     체크 응답이 stale해도 이 경로가 최종 방어다.
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { AxiosError, AxiosHeaders } from 'axios';
import ProfileEditScreen from './ProfileEditScreen';
import { checkNickname, updateProfile } from '@/services/userApi';
import { CHECK_DEBOUNCE_MS } from '@/hooks/useNicknameCheck';

// SettingsScaffold가 useSafeAreaInsets를 쓴다 — 테스트 트리엔 SafeAreaProvider가 없어 고정값으로 대체한다.
jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context'),
  useSafeAreaInsets: () => ({ top: 47, left: 0, right: 0, bottom: 34 }),
}));

const mockGoBack = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ goBack: mockGoBack }),
}));

const mockSetNickname = jest.fn();
// 원본 닉네임 홀더 — 테스트가 바꿔 끼울 수 있게 mutable로 둔다(BetSheet 패턴).
const mockUser = { nickname: '기존닉' as string | null, setNickname: mockSetNickname };
jest.mock('@/store/UserContext', () => ({
  useUser: () => mockUser,
}));

// expo-localization 네이티브 모듈 회피 — 국가코드는 전송 바디 검증에만 쓴다.
jest.mock('@/utils/deviceLocale', () => ({
  getDeviceCountryCode: () => 'KR',
}));

jest.mock('@/services/userApi', () => ({
  checkNickname: jest.fn(),
  updateProfile: jest.fn(),
}));

const mockCheckNickname = checkNickname as jest.MockedFunction<typeof checkNickname>;
const mockUpdateProfile = updateProfile as jest.MockedFunction<typeof updateProfile>;

// 디바운스 값은 useNicknameCheck에서 import — 가짜 타이머를 이만큼 감아 체크를 발화시킨다.

function axiosErrorWith(status: number): AxiosError {
  const config = { headers: new AxiosHeaders() };
  return new AxiosError('request failed', 'ERR_BAD_REQUEST', config, null, {
    status,
    statusText: '',
    headers: {},
    config,
    data: { code: 'NICKNAME_DUPLICATE', message: '...' },
  });
}

// RTL v14의 render는 async다 — 반드시 await한다.
async function renderScreen() {
  const result = await render(<ProfileEditScreen />);
  await act(async () => {});
  return result;
}

// 닉네임을 치고 디바운스가 지나 체크가 발화할 때까지 기다린다(GroupFindSheet 패턴).
async function typeAndSettle(text: string) {
  await act(async () => {
    fireEvent.changeText(screen.getByPlaceholderText('닉네임을 입력해 주세요'), text);
  });
  await act(async () => {
    jest.advanceTimersByTime(CHECK_DEBOUNCE_MS);
  });
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  mockUser.nickname = '기존닉';
});

afterEach(() => {
  jest.useRealTimers();
});

describe('실시간 중복확인', () => {
  test('디바운스가 지나야 체크를 부르고, available이면 사용 가능해요를 띄운다', async () => {
    mockCheckNickname.mockResolvedValue({ available: true });
    await renderScreen();

    await act(async () => {
      fireEvent.changeText(screen.getByPlaceholderText('닉네임을 입력해 주세요'), '새닉네임');
    });
    // 디바운스 전 — 아직 부르지 않고 '확인 중…'만 보인다.
    await act(async () => {
      jest.advanceTimersByTime(CHECK_DEBOUNCE_MS - 1);
    });
    expect(mockCheckNickname).not.toHaveBeenCalled();
    expect(screen.getByText('확인 중…')).toBeOnTheScreen();

    await act(async () => {
      jest.advanceTimersByTime(1);
    });
    expect(mockCheckNickname).toHaveBeenCalledWith('새닉네임');
    expect(await screen.findByText('사용 가능해요')).toBeOnTheScreen();
  });

  test('available=false면 이미 사용 중 문구를 띄운다', async () => {
    mockCheckNickname.mockResolvedValue({ available: false });
    await renderScreen();

    await typeAndSettle('중복닉');
    expect(await screen.findByText('이미 사용 중인 닉네임이에요')).toBeOnTheScreen();
  });

  test('형식 위반(2자 미만)은 서버 호출 없이 로컬 문구가 뜬다', async () => {
    await renderScreen();

    await typeAndSettle('새');
    expect(mockCheckNickname).not.toHaveBeenCalled();
    expect(screen.getByText('2~10자로 입력해 주세요')).toBeOnTheScreen();
  });

  test('현재값과 같은 입력은 체크하지 않는다', async () => {
    await renderScreen();

    await typeAndSettle('기존닉');
    expect(mockCheckNickname).not.toHaveBeenCalled();
    expect(screen.getByText('2~10자로 정할 수 있어요')).toBeOnTheScreen();
  });

  test('먼저 보낸 요청이 늦게 도착해도 최신 입력의 판정을 덮지 못한다 — 세대 무효화 회귀', async () => {
    // 요청 1('첫째닉')은 응답을 붙잡아 두고, 요청 2('둘째닉')는 즉시 available로 응답시킨다.
    // 네트워크가 순서를 뒤집는 실전 시나리오 — 세대(seq) 무효화가 깨지면 뒤늦게 도착한
    // 요청 1의 taken이 최신 입력의 '사용 가능해요'를 덮는다(claude 리뷰 제안 회귀 고정).
    let resolveFirst!: (v: { available: boolean }) => void;
    mockCheckNickname
      .mockImplementationOnce(
        () =>
          new Promise((res) => {
            resolveFirst = res;
          }),
      )
      .mockResolvedValueOnce({ available: true });
    await renderScreen();

    await typeAndSettle('첫째닉'); // 요청 1 발사 — 응답 보류
    await typeAndSettle('둘째닉'); // 요청 2 발사 — 즉시 available
    expect(mockCheckNickname).toHaveBeenNthCalledWith(1, '첫째닉');
    expect(mockCheckNickname).toHaveBeenNthCalledWith(2, '둘째닉');
    expect(await screen.findByText('사용 가능해요')).toBeOnTheScreen();

    // 뒤늦게 요청 1이 taken으로 도착 — 최신 판정('둘째닉' 사용 가능)을 덮으면 안 된다.
    await act(async () => {
      resolveFirst({ available: false });
    });
    expect(screen.getByText('사용 가능해요')).toBeOnTheScreen();
    expect(screen.queryByText('이미 사용 중인 닉네임이에요')).toBeNull();
  });

  test('체크 실패(네트워크·구서버)는 중립 안내로 분리한다 — available 오인 금지(GROMO-1231)', async () => {
    mockCheckNickname.mockRejectedValue(new Error('network down'));
    await renderScreen();

    await typeAndSettle('새닉네임');
    expect(mockCheckNickname).toHaveBeenCalled();
    expect(
      await screen.findByText('지금은 중복을 확인할 수 없어요 · 저장할 때 확인돼요'),
    ).toBeOnTheScreen();
    // 종전 낙관 폴백(초록 체크 + '사용 가능해요')로 확인 완료처럼 보이면 안 된다.
    expect(screen.queryByText('사용 가능해요')).toBeNull();
    expect(screen.queryByTestId('profileEdit.nickname.availableIcon')).toBeNull();
    // 저장 가드는 무변경 — unknown이어도 CTA는 살아 있다(저장 409가 최종 방어).
    expect(screen.getByText('검사 및 저장')).toBeOnTheScreen();
  });

  test('초록 체크는 available 판정 후에만 붙는다 — idle·입력 직후엔 없다(GROMO-1231)', async () => {
    mockCheckNickname.mockResolvedValue({ available: true });
    await renderScreen();

    // 초기 렌더(미변경·idle) — 초록 체크도 '사용 가능해요'도 없다.
    expect(screen.queryByText('사용 가능해요')).toBeNull();
    expect(screen.queryByTestId('profileEdit.nickname.availableIcon')).toBeNull();

    // 유효 입력 직후(디바운스 경과 전) — '확인 중…'만 보이고 초록은 아직 없다.
    // available·unknown·idle이 한 분기에 뭉쳐 있던 시절의 '첫 프레임 초록 스침' 회귀 고정.
    await act(async () => {
      fireEvent.changeText(screen.getByPlaceholderText('닉네임을 입력해 주세요'), '새닉네임');
    });
    expect(screen.queryByText('사용 가능해요')).toBeNull();
    expect(screen.queryByTestId('profileEdit.nickname.availableIcon')).toBeNull();

    // available 판정이 도착해야 비로소 초록 체크 + 문구가 붙는다.
    await act(async () => {
      jest.advanceTimersByTime(CHECK_DEBOUNCE_MS);
    });
    expect(await screen.findByText('사용 가능해요')).toBeOnTheScreen();
    expect(screen.getByTestId('profileEdit.nickname.availableIcon')).toBeOnTheScreen();
  });
});

describe('저장 409 경로(무회귀)', () => {
  test('저장이 409로 실패하면 이미 사용 중 Alert를 띄운다 — 체크가 stale해도 최종 방어', async () => {
    // 체크는 통과(available)했지만 저장 시점엔 이미 선점된 경우.
    mockCheckNickname.mockResolvedValue({ available: true });
    mockUpdateProfile.mockRejectedValue(axiosErrorWith(409));
    await renderScreen();

    await typeAndSettle('새닉네임');
    await act(async () => {
      fireEvent.press(screen.getByText('검사 및 저장'));
    });

    expect(mockUpdateProfile).toHaveBeenCalledWith({ nickname: '새닉네임', countryCode: 'KR' });
    expect(Alert.alert).toHaveBeenCalledWith('저장 실패', '이미 사용 중인 닉네임이에요');
    expect(mockGoBack).not.toHaveBeenCalled();
    expect(mockSetNickname).not.toHaveBeenCalled();
  });

  test('저장 성공이면 컨텍스트 반영 후 뒤로 간다', async () => {
    mockCheckNickname.mockResolvedValue({ available: true });
    mockUpdateProfile.mockResolvedValue(undefined);
    await renderScreen();

    await typeAndSettle('새닉네임');
    await act(async () => {
      fireEvent.press(screen.getByText('검사 및 저장'));
    });

    expect(mockSetNickname).toHaveBeenCalledWith('새닉네임');
    expect(mockGoBack).toHaveBeenCalled();
  });
});
