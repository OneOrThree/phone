// GroupCreateScreen 생성 요청 구간 테스트 — 명세 docs/app/group-plan.md §6-2.
//
// 이 화면의 위험 구간은 "요청은 떠 있는데 화면은 계속 열려 있는" 몇 초다.
//   1) 그 사이 이름을 고치면 초대 문구가 실제 그룹 이름과 갈린다 → 요청에 실어 보낸 이름을 굳힌다
//   2) 그 사이 이탈하면 취소한 줄 아는 그룹에 OWNER로 갇힌다(§14 — 삭제·위임 UI가 없다)
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Share } from 'react-native';
import GroupCreateScreen from './GroupCreateScreen';
import { createGroup } from '@/services/groupApi';
import type { CreateGroupResponse } from '@/types/dto/group';

jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context'),
  useSafeAreaInsets: () => ({ top: 47, left: 0, right: 0, bottom: 34 }),
}));

// 이탈 차단 리스너를 테스트가 직접 굴린다(실제 스택 없이).
// jest.mock 팩토리는 mock 접두 변수만 참조할 수 있어 홀더 객체에 담는다.
const mockNav = {
  goBack: jest.fn(),
  navigate: jest.fn(),
  beforeRemove: null as ((e: { preventDefault: () => void }) => void) | null,
};
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
    goBack: mockNav.goBack,
    navigate: mockNav.navigate,
    addListener: (event: string, cb: (e: { preventDefault: () => void }) => void) => {
      if (event === 'beforeRemove') mockNav.beforeRemove = cb;
      return () => {};
    },
  }),
}));

jest.mock('@/services/analyticsEvents', () => ({
  logGroupCreateStarted: jest.fn(),
  logGroupInviteShared: jest.fn(),
}));

jest.mock('@/services/groupApi', () => ({
  ...jest.requireActual('@/services/groupApi'),
  createGroup: jest.fn(),
}));

const mockCreateGroup = createGroup as jest.MockedFunction<typeof createGroup>;

const GROUP_ID = '0197e0c3-4d1b-7a2e-9f60-3b7c1f2a8d55';

async function renderScreen() {
  const result = await render(<GroupCreateScreen />);
  await act(async () => {});
  return result;
}

async function press(label: string) {
  const el = await screen.findByText(label);
  await act(async () => {
    fireEvent.press(el);
  });
}

async function typeName(v: string) {
  await act(async () => {
    fireEvent.changeText(screen.getByPlaceholderText('예) 아침 6시 집중방'), v);
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockNav.beforeRemove = null;
  jest.spyOn(Share, 'share').mockResolvedValue({ action: Share.sharedAction });
});

test('공유 문구는 생성 요청에 실어 보낸 이름을 쓴다(요청 중 이름을 고쳐도)', async () => {
  let resolveCreate: (v: CreateGroupResponse) => void = () => {};
  mockCreateGroup.mockImplementation(
    () => new Promise((res) => (resolveCreate = res)) as Promise<CreateGroupResponse>,
  );
  await renderScreen();

  await typeName('아침 6시 집중방');
  await press('비공개'); // 비공개여야 초대 링크 다이얼로그가 뜬다
  await press('만들기');

  // 요청이 떠 있는 동안 입력은 살아 있다 — 여기서 고친 이름은 서버에 가지 않는다.
  await typeName('저녁 10시 집중방');
  await act(async () => {
    resolveCreate({ groupId: GROUP_ID } as CreateGroupResponse);
  });

  expect(mockCreateGroup).toHaveBeenCalledWith(
    expect.objectContaining({ name: '아침 6시 집중방' }),
  );

  await press('공유하기');
  expect(Share.share).toHaveBeenCalledWith(
    expect.objectContaining({ message: expect.stringContaining('아침 6시 집중방') }),
  );
  expect(Share.share).not.toHaveBeenCalledWith(
    expect.objectContaining({ message: expect.stringContaining('저녁 10시') }),
  );
});

test('생성 요청이 떠 있는 동안에는 이탈을 막는다', async () => {
  let resolveCreate: (v: CreateGroupResponse) => void = () => {};
  mockCreateGroup.mockImplementation(
    () => new Promise((res) => (resolveCreate = res)) as Promise<CreateGroupResponse>,
  );
  await renderScreen();

  await typeName('아침 6시 집중방');
  await press('만들기');

  const blocked = { preventDefault: jest.fn() };
  mockNav.beforeRemove?.(blocked);
  expect(blocked.preventDefault).toHaveBeenCalled();

  // 응답 직후 풀린다 — 공개 그룹의 성공 경로는 goBack()으로 나가야 한다.
  await act(async () => {
    resolveCreate({ groupId: GROUP_ID } as CreateGroupResponse);
  });
  const after = { preventDefault: jest.fn() };
  mockNav.beforeRemove?.(after);
  expect(after.preventDefault).not.toHaveBeenCalled();
  expect(mockNav.goBack).toHaveBeenCalled();
});
