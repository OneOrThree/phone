// GroupListScreen 렌더·콜백 테스트 — 명세 docs/app/group-plan-2.md §3-1.
//
// 여기서 잠그는 것 두 가지:
//  1) 카드가 그룹방 헤더와 같은 정보(이름·비공개·인원)를 잃지 않고, 방장 배지는 **내가 OWNER인
//     그룹에만** 붙는다. role을 뭉개면 남의 그룹에 방장 표시가 붙어 잘못된 권한을 기대하게 된다.
//  2) 이 화면은 **스스로 navigate 하지 않는다** — 탭·만들기·찾기 모두 prop 콜백으로만 나간다.
//     (1건이면 목록을 접고 2건 이상이면 push 하는 분기는 GroupScreen이 쥔다.)
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import GroupListScreen from './GroupListScreen';
import type { GroupSummaryResponse } from '@/types/dto/group';

jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context'),
  useSafeAreaInsets: () => ({ top: 47, left: 0, right: 0, bottom: 34 }),
}));

const GROUP_ID = '0197e0c3-4d1b-7a2e-9f60-3b7c1f2a8d55';
const GROUP_ID_2 = '0197e0c3-4d1b-7a2e-9f60-3b7c1f2a8d66';

function group(over: Partial<GroupSummaryResponse> = {}): GroupSummaryResponse {
  return {
    groupId: GROUP_ID,
    name: '아침 6시 집중방',
    code: null,
    currentMembers: 2,
    maxMembers: 5,
    role: 'MEMBER',
    status: 'WAITING',
    ...over,
  };
}

const onSelect = jest.fn();
const onCreate = jest.fn();
const onFind = jest.fn();
const onRefresh = jest.fn<Promise<void>, []>();
const onBack = jest.fn();

// render는 반드시 await 한다 — React 19 + RNTL 14에서는 렌더가 비동기라
// 동기 호출만 하면 screen이 채워지지 않는다(그룹 테스트 3종 공통 관행).
async function renderList(groups: GroupSummaryResponse[], back?: () => void) {
  return await render(
    <GroupListScreen
      groups={groups}
      onSelect={onSelect}
      onCreate={onCreate}
      onFind={onFind}
      onRefresh={onRefresh}
      onBack={back}
    />,
  );
}

// 탭은 act로 감싼다 — 감싸지 않으면 fireEvent가 여는 act 스코프가 렌더 스코프와 겹쳐
// ("overlapping act() calls") 다음 테스트의 렌더가 통째로 비는 일이 생긴다.
async function press(testID: string) {
  await act(async () => {
    fireEvent.press(screen.getByTestId(testID));
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  onRefresh.mockResolvedValue(undefined);
});

describe('카드 렌더', () => {
  test('이름과 n/m 인원을 서버가 준 순서 그대로 그린다', async () => {
    await renderList([
      group(),
      group({ groupId: GROUP_ID_2, name: '저녁 스터디', currentMembers: 4 }),
    ]);

    expect(screen.getByText('아침 6시 집중방')).toBeOnTheScreen();
    expect(screen.getByText('2/5')).toBeOnTheScreen();
    expect(screen.getByText('저녁 스터디')).toBeOnTheScreen();
    expect(screen.getByText('4/5')).toBeOnTheScreen();
    expect(screen.getByTestId('group.deck.findMore')).toBeOnTheScreen();
  });

  test('그룹 수와 무관하게 찾기 카드는 정확히 한 장이고 서버 data에는 섞이지 않는다', async () => {
    const groups = Array.from({ length: 11 }, (_, index) =>
      group({ groupId: `${GROUP_ID}-${index}`, name: `그룹 ${index + 1}` }),
    );
    await renderList(groups);

    expect(screen.getAllByTestId('group.deck.findMore')).toHaveLength(1);
    expect(screen.getByTestId('group.list.items').props.data).toEqual(groups);
    expect(screen.getByTestId('group.list.items').props.horizontal).toBe(true);
    expect(screen.getByTestId('group.list.items').props.disableIntervalMomentum).toBe(true);
    expect(screen.getByTestId('group.deck.indicator.counter')).toHaveTextContent('1 / 12');
  });

  test('자물쇠는 비공개 그룹에만, 방장 배지는 내가 OWNER인 그룹에만 붙는다', async () => {
    await renderList([
      group({ isPrivate: true, role: 'OWNER' }),
      group({ groupId: GROUP_ID_2, name: '저녁 스터디', isPrivate: false, role: 'MEMBER' }),
    ]);

    expect(screen.getAllByLabelText('비공개 그룹')).toHaveLength(1);
    expect(screen.getAllByLabelText('내가 방장')).toHaveLength(1);
  });

  test('공개·일반 멤버 그룹뿐이면 자물쇠도 방장 배지도 없다', async () => {
    await renderList([group({ isPrivate: false, role: 'MEMBER' })]);

    expect(screen.queryByLabelText('비공개 그룹')).toBeNull();
    expect(screen.queryByLabelText('내가 방장')).toBeNull();
  });
});

describe('콜백', () => {
  test('카드 탭 — onSelect에 groupId를 넘기고 스스로 이동하지 않는다', async () => {
    await renderList([group(), group({ groupId: GROUP_ID_2, name: '저녁 스터디' })]);

    await press(`group.list.card.${GROUP_ID_2}`);

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(GROUP_ID_2);
  });

  test('하단 CTA 2개는 각각 onCreate·onFind로만 나간다', async () => {
    await renderList([group()]);

    await press('group.list.create');
    expect(onCreate).toHaveBeenCalledTimes(1);
    expect(onFind).not.toHaveBeenCalled();

    await press('group.list.find');
    expect(onFind).toHaveBeenCalledTimes(1);
  });

  // 그룹 1건에서 ⋯ 메뉴로 '잠깐 열어 본' 목록은 되돌아갈 길이 카드 탭뿐이었다 —
  // 백버튼이 없으면 목록이 그룹 탭에 눌러앉는다(탭을 옮겼다 와도 안 풀린다).
  // 반대로 2건 이상의 기본 목록에 백버튼이 생기면 갈 곳 없는 버튼이 된다.
  test('onBack을 받았을 때만 헤더 백버튼을 그린다', async () => {
    await renderList([group()], onBack);

    await press('group.list.back');
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  test('onBack이 없으면 백버튼 자체가 없다(기본 목록)', async () => {
    await renderList([group(), group({ groupId: GROUP_ID_2, name: '저녁 스터디' })]);

    expect(screen.queryByTestId('group.list.back')).toBeNull();
  });

  test('당겨서 새로고침 — 조회가 끝날 때까지만 인디케이터를 세운다', async () => {
    // 조회가 끝나는 시점을 테스트가 쥔다 — 인디케이터가 '도는 동안'과 '끝난 뒤'를 나눠 본다.
    let finish!: () => void;
    onRefresh.mockImplementation(() => new Promise<void>((resolve) => (finish = resolve)));
    await renderList([group()]);

    // RefreshControl은 리스트의 자식이라 fireEvent가 위로 훑어 찾지 못한다(RNTL 14는 UNSAFE_*
    // 쿼리도 없다) — FlatList에 넘긴 요소를 리스트 props에서 직접 집는다.
    const control = () => screen.getByTestId('group.list.items').props.refreshControl.props;
    expect(control().refreshing).toBe(false);

    await act(async () => {
      control().onRefresh();
    });
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(control().refreshing).toBe(true);

    // 끝나면 반드시 내린다 — 안 내리면 스피너가 영구히 남는다.
    await act(async () => {
      finish();
    });
    expect(control().refreshing).toBe(false);
  });
});
