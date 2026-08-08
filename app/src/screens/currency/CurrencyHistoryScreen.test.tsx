// CurrencyHistoryScreen 테스트 — GROMO-1073 (내역 로드 실패의 복구 수단).
//
// 여기서 잠그는 것:
//  1) 실패 화면의 '다시 시도'가 실제로 재조회를 트리거하고, 성공하면 목록으로 바뀐다 —
//     이 버튼이 없으면 화면을 나갔다 다시 들어오는 것 말고는 복구할 방법이 없다.
//  2) 실패 문구가 연결 끊김(응답 없음)과 서버 실패(4xx/5xx)로 갈린다. status 숫자는 노출하지 않는다.
//  3) 잔액은 미로드여도 '0개'로 표기한다(지갑은 가입 시 함께 생겨 신규 유저의 정답도 0).
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { AxiosError, AxiosHeaders } from 'axios';
import CurrencyHistoryScreen from './CurrencyHistoryScreen';
import { getCurrencyTransactions } from '@/services/currencyApi';
import type { CurrencyTransaction } from '@/types/dto/currency';

jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context'),
  useSafeAreaInsets: () => ({ top: 47, left: 0, right: 0, bottom: 34 }),
}));

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ goBack: jest.fn() }),
  // 포커스 effect는 마운트 effect로 대체한다(GroupSettingsScreen.test 관행).
  useFocusEffect: (cb: () => void | (() => void)) => {
    const { useEffect } = require('react');
    useEffect(() => {
      const cleanup = cb();
      return typeof cleanup === 'function' ? cleanup : undefined;
    }, [cb]);
  },
}));

// 잔액은 CoinContext 몫이라 여기선 값만 준다 — coinsLoaded는 이 화면이 더 이상 읽지 않는다.
jest.mock('@/store/CoinContext', () => ({
  useCoins: () => ({ coins: 0 }),
  useRefreshCoinsOnFocus: jest.fn(),
}));

jest.mock('@/services/currencyApi', () => ({ getCurrencyTransactions: jest.fn() }));
const mockGet = getCurrencyTransactions as jest.MockedFunction<typeof getCurrencyTransactions>;

const TX: CurrencyTransaction = {
  type: 'SESSION_COMPLETE',
  amount: 100,
  createdAt: '2026-08-08T01:23:00Z',
};

// 응답이 온 실패(서버) — GlobalExceptionHandler 바디까지 실어 준다.
function serverError(status: number): AxiosError {
  const config = { headers: new AxiosHeaders() };
  return new AxiosError('request failed', 'ERR_BAD_RESPONSE', config, null, {
    status,
    statusText: '',
    headers: {},
    config,
    data: { code: 'INTERNAL_ERROR', message: '서버 오류' },
  });
}

// 응답이 없는 실패(연결 끊김·타임아웃) — response 없이 code만 온다.
function networkError(): AxiosError {
  return new AxiosError('Network Error', 'ERR_NETWORK', { headers: new AxiosHeaders() });
}

async function renderScreen() {
  // RNTL 14의 render는 비동기다 — await하지 않으면 screen이 붙지 않는다(GroupSettingsScreen.test 관행).
  await render(<CurrencyHistoryScreen />);
  await act(async () => {});
}

// 화면이 실패 원인을 __DEV__ 로그로 남긴다(status·code) — 테스트 출력만 조용히 시킨다.
jest.spyOn(console, 'warn').mockImplementation(() => {});

beforeEach(() => {
  jest.clearAllMocks();
});

test("실패 뒤 '다시 시도'가 재조회를 트리거하고 성공하면 목록이 뜬다", async () => {
  mockGet.mockRejectedValueOnce(serverError(500));
  await renderScreen();

  expect(screen.getByText(/내역을 불러오지 못했어요/)).toBeTruthy();

  mockGet.mockResolvedValueOnce([TX]);
  await act(async () => {
    fireEvent.press(screen.getByText('다시 시도'));
  });

  expect(mockGet).toHaveBeenCalledTimes(2);
  expect(screen.getByText('집중 완료')).toBeTruthy();
  expect(screen.queryByText('다시 시도')).toBeNull();
});

test('실패 문구는 연결 끊김과 서버 실패로 갈리고, status 숫자는 노출하지 않는다', async () => {
  mockGet.mockRejectedValueOnce(networkError());
  await renderScreen();
  expect(screen.getByText(/인터넷 연결을 확인해 주세요/)).toBeTruthy();

  mockGet.mockRejectedValueOnce(serverError(500));
  await act(async () => {
    fireEvent.press(screen.getByText('다시 시도'));
  });
  expect(screen.getByText(/잠시 후 다시 시도해 주세요/)).toBeTruthy();
  expect(screen.queryByText(/500/)).toBeNull();
});

test("잔액은 미로드여도 '0개'로 표기한다(GROMO-1073)", async () => {
  mockGet.mockResolvedValueOnce([]);
  await renderScreen();
  expect(screen.getByText('0개')).toBeTruthy();
});
