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
  sessionTodayFocusSeconds: () => 0,
}));

// 삭제 테스트가 서버 태그 동기화를 타지 않게(fire-and-forget이라 결과엔 영향 없음)
jest.mock('@/screens/focus/tagSync', () => ({
  syncTagCreated: jest.fn(),
  syncTagRenamed: jest.fn(),
  syncTagDeleted: jest.fn(),
}));

const DAY = 24 * 3600;

let addFn: (id: string, seconds: number) => void = () => {};
let deleteFn: (id: string) => void = () => {};
let rows: { id: string; accumulatedSeconds: number }[] = [];

function Probe() {
  const { subjects, addFocusToSubject, deleteSubject } = useSubjects();
  addFn = addFocusToSubject;
  deleteFn = deleteSubject;
  rows = subjects;
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

async function seedMany(values: number[]) {
  await AsyncStorage.setItem(
    STORAGE_KEYS.subjects,
    JSON.stringify({
      subjects: values.map((accumulatedSeconds, i) => ({
        id: `s${i + 1}`,
        name: `과목${i + 1}`,
        accumulatedSeconds,
        color: '#000000',
      })),
      date: todayStr(),
    }),
  );
}

const seed = (accumulatedSeconds: number) => seedMany([accumulatedSeconds]);

const secondsOf = (id: string) => rows.find((x) => x.id === id)?.accumulatedSeconds ?? 0;

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

// 코드리뷰 2차 — 행별 클램프만으론 못 잡는 '여러 과목에 나뉜 부패'
it('부패가 여러 과목에 나뉘어도 로드 시 합이 24시간으로 정규화되고 비율은 유지된다', async () => {
  await seedMany([20 * 3600, 14 * 3600]); // 각각은 24h 미만이지만 합은 34h
  await renderProvider();

  expect(screen.getByTestId('sum')).toHaveTextContent(String(DAY));
  expect(secondsOf('s1') / DAY).toBeCloseTo(20 / 34, 4);
  expect(secondsOf('s2') / DAY).toBeCloseTo(14 / 34, 4);
});

it('적립은 행별이 아니라 과목 합 기준으로 상한에 걸린다', async () => {
  await seedMany([12 * 3600, 11 * 3600]); // 합 23h — 여유는 1h뿐
  await renderProvider();

  await act(async () => {
    addFn('s1', 5 * 3600);
  });

  expect(screen.getByTestId('sum')).toHaveTextContent(String(DAY));
  expect(secondsOf('s1')).toBe(13 * 3600);
});

it('정규화 후 과목을 지워도 전역 총합과 남은 과목 합이 어긋나지 않는다', async () => {
  await seedMany([20 * 3600, 14 * 3600]);
  await renderProvider();

  // 전역 총합(FocusContext)도 같은 상한이라 24h. 삭제 화면은 그 값에서 과목 누적을 뺀다.
  const deleted = secondsOf('s2');
  await act(async () => {
    deleteFn('s2');
  });

  expect(screen.getByTestId('sum')).toHaveTextContent(String(Math.max(0, DAY - deleted)));
});
