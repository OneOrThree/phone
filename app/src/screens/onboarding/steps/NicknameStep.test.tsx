// NicknameStep(온보딩 닉네임) 실시간 중복확인 테스트 — GROMO-1215.
//
// 이 화면의 계약:
//  1) 형식(2~10자) 통과분만 디바운스(350ms) 후 checkNickname을 부른다 — 형식 위반은
//     서버 호출 없이 로컬 문구가 선행한다.
//  2) available=true → '사용 가능해요', false → '이미 사용 중인 닉네임이에요'.
//  3) 확인 실패(네트워크·구서버 404)는 기존 힌트('가입 완료 시 확인')로 폴백한다 —
//     최종 판정은 가입 확정 409가 맡는다.
//  4) 가입 확정 실패(serverError, 409 경로)는 체크 결과보다 우선 표시된다 — 무회귀.
import { useState } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import NicknameStep from './NicknameStep';
import { checkNickname } from '@/services/userApi';
import { CHECK_DEBOUNCE_MS } from '@/hooks/useNicknameCheck';
import { INITIAL_ONBOARDING_DATA } from '@/screens/onboarding/types';
import type { V2OnboardingData } from '@/screens/onboarding/types';

// StepScaffold가 useSafeAreaInsets를 쓴다 — 테스트 트리엔 SafeAreaProvider가 없어 고정값으로 대체한다.
jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context'),
  useSafeAreaInsets: () => ({ top: 47, left: 0, right: 0, bottom: 34 }),
}));

jest.mock('@/services/analyticsEvents', () => ({
  logOnboardingNicknameSubmitted: jest.fn(),
}));

// userApi 전체를 목으로 — 이 화면(useNicknameCheck 경유)은 checkNickname만 쓴다.
jest.mock('@/services/userApi', () => ({
  checkNickname: jest.fn(),
}));

const mockCheckNickname = checkNickname as jest.MockedFunction<typeof checkNickname>;

// 디바운스 값은 useNicknameCheck에서 import — 가짜 타이머를 이만큼 감아 체크를 발화시킨다.

const onNext = jest.fn();

// data.nickname은 부모(OnboardingFlow) 상태다 — 입력이 실제로 반영되도록 상태 홀더로 감싼다.
function Harness({ serverError }: { serverError?: string | null }) {
  const [data, setData] = useState<V2OnboardingData>(INITIAL_ONBOARDING_DATA);
  return (
    <NicknameStep
      data={data}
      update={(patch) => setData((d) => ({ ...d, ...patch }))}
      onNext={onNext}
      serverError={serverError}
    />
  );
}

// RTL v14의 render는 async다 — 반드시 await한다.
async function renderStep(serverError?: string | null) {
  const result = await render(<Harness serverError={serverError} />);
  await act(async () => {});
  return result;
}

// 닉네임을 치고 디바운스가 지나 체크가 발화할 때까지 기다린다(GroupFindSheet 패턴).
async function typeAndSettle(text: string) {
  await act(async () => {
    fireEvent.changeText(screen.getByTestId('onboarding.nickname.input'), text);
  });
  await act(async () => {
    jest.advanceTimersByTime(CHECK_DEBOUNCE_MS);
  });
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('실시간 중복확인', () => {
  test('디바운스가 지나야 체크를 부르고, available이면 사용 가능해요를 띄운다', async () => {
    mockCheckNickname.mockResolvedValue({ available: true });
    await renderStep();

    await act(async () => {
      fireEvent.changeText(screen.getByTestId('onboarding.nickname.input'), '재영');
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
    expect(mockCheckNickname).toHaveBeenCalledWith('재영');
    expect(await screen.findByText('사용 가능해요')).toBeOnTheScreen();
  });

  test('available=false면 이미 사용 중 문구를 띄운다', async () => {
    mockCheckNickname.mockResolvedValue({ available: false });
    await renderStep();

    await typeAndSettle('중복닉');
    expect(await screen.findByText('이미 사용 중인 닉네임이에요')).toBeOnTheScreen();
  });

  test('형식 위반(2자 미만)은 서버 호출 없이 로컬 문구가 뜬다', async () => {
    await renderStep();

    await typeAndSettle('재');
    expect(mockCheckNickname).not.toHaveBeenCalled();
    expect(screen.getByText('닉네임은 2~10자로 입력해 주세요')).toBeOnTheScreen();
  });

  test('체크 실패(네트워크·구서버)는 기존 힌트로 폴백한다 — 가입 확정 409가 최종 방어', async () => {
    mockCheckNickname.mockRejectedValue(new Error('network down'));
    await renderStep();

    await typeAndSettle('재영');
    expect(mockCheckNickname).toHaveBeenCalled();
    // 낙관 폴백 — 판정 문구 없이 기본 힌트(가입 완료 시 확인)로 돌아간다.
    expect(await screen.findByText('2~10자 · 중복 여부는 가입 완료 시 확인돼요')).toBeOnTheScreen();
    expect(screen.queryByText('사용 가능해요')).not.toBeOnTheScreen();
    expect(screen.queryByText('이미 사용 중인 닉네임이에요')).not.toBeOnTheScreen();
  });

  test('가입 확정 실패(serverError, 409 경로)는 체크 결과보다 우선 표시된다', async () => {
    mockCheckNickname.mockResolvedValue({ available: true });
    const duplicated = '이미 사용 중인 닉네임이에요. 다른 닉네임을 입력해 주세요.';
    await renderStep(duplicated);

    await typeAndSettle('재영');
    // 체크는 available이어도 가입 확정이 돌려준 실패 메시지가 우선이다.
    expect(screen.getByText(duplicated)).toBeOnTheScreen();
    expect(screen.queryByText('사용 가능해요')).not.toBeOnTheScreen();
  });
});
