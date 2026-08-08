// SubjectContext 하루 상한 테스트 — GROMO-1253 코드리뷰 반영분.
//
// 총합(FocusContext)만 24시간으로 막으면 과목별 누적이 부푼 채 남는다. 그러면
//  1) 과목별 카드/도넛이 총합과 어긋나고,
//  2) 그 과목을 지울 때 24시간을 넘는 값이 총합에서 빠져 0으로 떨어진다.
// 두 스토어가 같은 상한을 쓰는지 잠근다.
import { act, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SubjectProvider, useSubjects } from './SubjectContext';
import { STORAGE_KEYS } from '@/types/storage';
import { todayStr } from '@/utils/localDate';

// 저장분이 있는 경로만 본다 — 서버 복원은 저장분이 없을 때만 탄다.
jest.mock('@/screens/focus/focusRestore', () => ({
  fetchTodayFocusRestore: jest.fn().mockResolvedValue({ sessions: null, tags: null }),
  sessionFocusSeconds: () => 0,
}));

const DAY = 24 * 3600;

let addFn: (id: string, seconds: number) => void = () => {};

function Probe() {
  const { subjects, addFocusToSubject } = useSubjects();
  addFn = addFocusToSubject;
  return <Text testID="sum">{subjects.reduce((a, x) => a + x.accumulatedSeconds, 0)}</Text>;
}

async function renderProvider() {
  const result = await render(
    <SubjectProvider>
      <Probe />
    </SubjectProvider>,
  );
  await act(async () => {});
  return result;
}

async function seed(accumulatedSeconds: number) {
  await AsyncStorage.setItem(
    STORAGE_KEYS.subjects,
    JSON.stringify({
      subjects: [{ id: 's1', name: '노동법', accumulatedSeconds, color: '#000000' }],
      date: todayStr(),
    }),
  );
}

beforeEach(async () => {
  await AsyncStorage.clear();
});

it('저장된 과목 누적이 하루를 넘으면 로드 시 24시간으로 잘린다', async () => {
  await seed(34 * 3600); // 실제 신고된 값
  await renderProvider();
  expect(screen.getByTestId('sum')).toHaveTextContent(String(DAY));
});

it('과목 적립이 하루 상한을 넘지 않는다', async () => {
  await seed(23 * 3600);
  await renderProvider();

  await act(async () => {
    addFn('s1', 8 * 3600);
  });

  expect(screen.getByTestId('sum')).toHaveTextContent(String(DAY));
});

it('상한 아래에서는 그대로 더해진다', async () => {
  await seed(600);
  await renderProvider();

  await act(async () => {
    addFn('s1', 1200);
  });

  expect(screen.getByTestId('sum')).toHaveTextContent('1800');
});
