// FocusContext 하루 상한 테스트 — GROMO-1253(일 탭 34시간)의 최종 방어선.
//
// 여기서 잠그는 것:
//  1) 적립 총합은 24시간을 넘지 않는다. 하루에 24시간을 넘게 집중할 수는 없으므로,
//     그런 값이 들어오면 경로가 무엇이든 버그다. 적립 경로가 늘어도 여기 한 곳에서 막힌다.
//  2) 이미 부푼 값이 저장된 기기도 로드 시점에 잘린다. 이게 없으면 34시간이 찍힌 기기는
//     앱을 지웠다 깔거나 자정을 넘길 때까지 계속 34시간을 본다.
import { act, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { FocusProvider, useFocus } from './FocusContext';
import { STORAGE_KEYS } from '@/types/storage';
import { todayStr } from '@/utils/localDate';

// 로컬 저장분이 있는 경로만 본다 — 서버 복원(fetchTodayFocusRestore)은 저장분이 없을 때만 탄다.
jest.mock('@/screens/focus/focusRestore', () => ({
  fetchTodayFocusRestore: jest.fn().mockResolvedValue({ sessions: null, tags: null }),
  sessionFocusSeconds: () => 0,
  sessionTodayFocusSeconds: () => 0,
}));

const DAY = 24 * 3600;

let addFn: (seconds: number) => void = () => {};

function Probe() {
  const { todayFocusSeconds, addFocusSeconds } = useFocus();
  addFn = addFocusSeconds;
  return <Text testID="seconds">{todayFocusSeconds}</Text>;
}

// Provider는 마운트 시 AsyncStorage 읽기(+복원 조회)를 돈다 — 흘린 뒤 반환한다.
async function renderProvider() {
  const result = await render(
    <FocusProvider>
      <Probe />
    </FocusProvider>,
  );
  await act(async () => {});
  return result;
}

beforeEach(async () => {
  await AsyncStorage.clear();
});

it('저장된 값이 하루를 넘으면 로드 시 24시간으로 잘린다', async () => {
  // 34시간 — 실제 신고된 값
  await AsyncStorage.setItem(
    STORAGE_KEYS.focus,
    JSON.stringify({ todayFocusSeconds: 34 * 3600, date: todayStr() }),
  );

  await renderProvider();

  expect(screen.getByTestId('seconds')).toHaveTextContent(String(DAY));
});

it('적립이 하루 상한을 넘지 않는다', async () => {
  await AsyncStorage.setItem(
    STORAGE_KEYS.focus,
    JSON.stringify({ todayFocusSeconds: 23 * 3600, date: todayStr() }),
  );

  await renderProvider();

  // 이탈 크레딧이 8시간 붙는 상황 — 23h + 8h = 31h 가 되면 안 된다.
  await act(async () => {
    addFn(8 * 3600);
  });

  expect(screen.getByTestId('seconds')).toHaveTextContent(String(DAY));
});

it('상한 아래에서는 그대로 더해진다', async () => {
  await renderProvider();

  await act(async () => {
    addFn(1800);
  });

  expect(screen.getByTestId('seconds')).toHaveTextContent('1800');
});
