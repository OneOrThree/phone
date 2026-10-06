import assert from 'node:assert/strict';
import React from 'react';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Platform } from 'react-native';
import { currentIsland, initialState, joinRequests, viewIsland } from '@/services/model';
import { Hall } from '@/screens/island/Hall';
import { ApiError } from '@/services/api/client';
import { useIslandManagement } from '@/screens/interiors/useIslandManagement';

jest.mock('@/screens/interiors/useIslandManagement', () => ({
  ...jest.requireActual('@/screens/interiors/useIslandManagement'),
  useIslandManagement: jest.fn(),
}));
let mockSessionGeneration = 0;
jest.mock('@/services/api/session', () => ({ sessionGeneration: () => mockSessionGeneration }));
jest.mock('@/screens/island/useLedgerScreen', () => ({
  shiftMonth: (month: string) => month,
  useLedgerScreen: () => ({
    month: '2026-09',
    offset: 0,
    canNext: false,
    prevMonth: jest.fn(),
    nextMonth: jest.fn(),
    tab: 'balance',
    setTab: jest.fn(),
    status: 'ready',
    error: null,
    items: [],
    villagePoints: null,
    earnedTotal: 0,
    spentTotal: 0,
    nextCursor: null,
    loadingMore: false,
    moreError: null,
    loadMore: jest.fn(),
    retry: jest.fn(),
    refresh: jest.fn(),
  }),
}));
jest.mock('@/utils/layout', () => ({
  useAppLayout: () => ({
    width: 402,
    height: 874,
    insets: { top: 52, bottom: 32, left: 0, right: 0 },
    landscape: false,
  }),
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 52, bottom: 32, left: 0, right: 0 }),
}));

const managementMock = useIslandManagement as jest.Mock;
const asyncCommand = () => jest.fn<Promise<void>, any[]>(async () => {});
const management = (over: object = {}) => ({
  detail: {
    id: 'island-1',
    name: '서버 섬',
    intro: '서버 소개',
    approvalRequired: true,
    maxMembers: 10,
    role: 'host',
    version: 3,
  },
  role: 'host',
  members: [
    { id: 'host', name: '방장', catColor: 'orange', role: 'host', appearance: {} },
    { id: 'u2', name: '주민', catColor: 'gray', role: 'member', appearance: {} },
  ],
  requests: [{ id: 'r1', applicantId: 'applicant', name: '신청자', status: 'pending', version: 1 }],
  loading: false,
  error: null,
  accessLost: false,
  reload: asyncCommand(),
  saveSettings: asyncCommand(),
  answerRequest: asyncCommand(),
  kickMember: asyncCommand(),
  transferHost: asyncCommand(),
  ...over,
});

const e = (route = 'manage', state = initialState(true)) => ({
  state,
  route,
  now: Date.now(),
  go: jest.fn(),
  back: jest.fn(),
  home: jest.fn(),
  dispatch: jest.fn(),
  notify: jest.fn(),
  reset: jest.fn(),
});

beforeEach(() => {
  jest.clearAllMocks();
  mockSessionGeneration = 0;
  managementMock.mockReturnValue(management());
});
afterEach(cleanup);

test('실제 Hall manage는 서버 DTO를 그리고 저장·승인·강퇴 명령을 hook으로 보낸다', async () => {
  const api = management();
  managementMock.mockReturnValue(api);
  const screen = await render(<Hall e={e()} />);

  assert.ok(screen.getByText('서버 섬'));
  await fireEvent.press(screen.getByTestId('hall-edit'));
  await waitFor(() => assert.ok(screen.getByTestId('hall-name')));
  await fireEvent.changeText(screen.getByTestId('hall-name'), '수정 섬');
  await fireEvent.press(screen.getByTestId('hall-save'));
  await waitFor(() =>
    assert.deepEqual(api.saveSettings.mock.calls[0][0], {
      name: '수정 섬',
      intro: '서버 소개',
      approvalRequired: true,
      maxMembers: 10,
    }),
  );
  await waitFor(() => assert.ok(screen.getByText('섬 정보를 저장했어요.')));

  await fireEvent.press(screen.getByTestId('hall-approve-r1'));
  await waitFor(() => {
    assert.equal(api.answerRequest.mock.calls[0][0], 'r1');
    assert.equal(api.answerRequest.mock.calls[0][1], 'approve');
  });
  await waitFor(() => assert.ok(screen.getByText('신청자님의 가입을 승인했어요.')));
  await fireEvent.press(screen.getByTestId('hall-member-u2'));
  await fireEvent.press(screen.getByTestId('hall-member-kick'));
  await fireEvent.press(screen.getByTestId('hall-dialog-ok'));
  await waitFor(() => assert.equal(api.kickMember.mock.calls[0][0], 'u2'));
  await waitFor(() => assert.ok(screen.getByText('주민님을 섬에서 내보냈어요.')));
});

test('실서버 member는 로컬 host 신청이 남아도 관리 CTA를 보지 않는다', async () => {
  managementMock.mockReturnValue(management({ role: 'member', requests: null }));
  const localHostWithRequest = initialState(true);
  const request = joinRequests(currentIsland(localHostWithRequest))[0];
  assert.ok(request);
  const member = await render(<Hall e={e('members', localHostWithRequest)} />);
  assert.equal(member.queryByTestId('hall-edit'), null);
  assert.equal(member.queryByTestId(`hall-approve-${request.id}`), null);
  assert.equal(member.queryByTestId(`hall-reject-${request.id}`), null);
});

test('실제 오류 shape(role:null + error)는 권한 상실이 아니라 재시도를 표시한다', async () => {
  const retry = jest.fn(async () => {});
  managementMock.mockReturnValue(
    management({ detail: null, role: null, error: new Error('네트워크 오류'), reload: retry }),
  );
  const failed = await render(<Hall e={e()} />);
  assert.ok(failed.getByTestId('hall-management-error'));
  assert.equal(failed.queryByTestId('hall-management-forbidden'), null);
  await fireEvent.press(failed.getByTestId('hall-management-retry'));
  assert.equal(retry.mock.calls.length, 1);
});

test('방문자 관리 카드는 비활성 management snapshot 대신 기존 정보를 보존한다', async () => {
  managementMock.mockReturnValue(
    management({ detail: null, role: null, members: null, requests: null }),
  );
  const visitorState = initialState(true);
  visitorState.visitingIslandId = visitorState.islands.find((island) => !island.joined)?.id;
  const visiting = viewIsland(visitorState);
  const visitor = await render(<Hall e={e('manage', visitorState)} />);
  await waitFor(() => assert.ok(visitor.getByText(visiting.name)));
  assert.ok(visitor.getByText(visiting.intro));
  assert.equal(managementMock.mock.calls.at(-1)?.[0].active, false);
});

test('review/demo 로컬 관리는 hook을 비활성화하고 기존 reducer 저장·위임·승인을 사용한다', async () => {
  const os = Object.getOwnPropertyDescriptor(Platform, 'OS');
  const target: any = globalThis;
  const previousWindow = target.window;
  Object.defineProperty(Platform, 'OS', { configurable: true, value: 'web' });
  target.window = { location: { search: '?demo' } };
  try {
    const state = initialState(true);
    const island = currentIsland(state);
    const request = joinRequests(island)[0];
    assert.ok(island.members[0]);
    assert.ok(request);
    const local = e('manage', state);
    const screen = await render(<Hall e={local} />);

    assert.equal(managementMock.mock.calls.at(-1)?.[0].active, false);
    await fireEvent.press(screen.getByTestId('hall-edit'));
    await fireEvent.changeText(screen.getByTestId('hall-name'), '데모 변경 섬');
    await fireEvent.press(screen.getByTestId('hall-save'));
    await waitFor(() => assert.equal(local.dispatch.mock.calls[0][0].type, 'MANAGE'));
    assert.equal(local.dispatch.mock.calls[0][0].name, '데모 변경 섬');

    await fireEvent.press(screen.getByTestId('hall-edit'));
    assert.equal(screen.getByTestId('hall-transfer').props.accessibilityState.disabled, false);
    await fireEvent.press(screen.getByTestId('hall-transfer'));
    await fireEvent.press(screen.getByTestId(`hall-transfer-${island.members[0].id}`));
    await fireEvent.press(screen.getByTestId('hall-dialog-ok'));
    await waitFor(() =>
      assert.ok(local.dispatch.mock.calls.some(([action]: any[]) => action.type === 'TRANSFER')),
    );

    await fireEvent.press(screen.getByTestId(`hall-approve-${request.id}`));
    await waitFor(() =>
      assert.ok(local.dispatch.mock.calls.some(([action]: any[]) => action.type === 'ADD_MEMBER')),
    );
    assert.equal(managementMock.mock.results.at(-1)?.value.saveSettings.mock.calls.length, 0);
    assert.equal(managementMock.mock.results.at(-1)?.value.transferHost.mock.calls.length, 0);
    assert.equal(managementMock.mock.results.at(-1)?.value.answerRequest.mock.calls.length, 0);
  } finally {
    target.window = previousWindow;
    if (os) Object.defineProperty(Platform, 'OS', os);
  }
});

test('서버 주민 후보는 로컬 목록과 달라도 위임 CTA와 transferHost 명령의 정본이다', async () => {
  const api = management();
  managementMock.mockReturnValue(api);
  const staleLocal = initialState(true);
  currentIsland(staleLocal).members = [];
  const screen = await render(<Hall e={e('manage', staleLocal)} />);

  assert.ok(screen.getByText('서버 섬'));
  await waitFor(() => assert.ok(screen.getByTestId('hall-edit')));
  await fireEvent.press(screen.getByTestId('hall-edit'));
  assert.equal(screen.getByTestId('hall-transfer').props.accessibilityState.disabled, false);
  await fireEvent.press(screen.getByTestId('hall-transfer'));
  await waitFor(() => assert.ok(screen.getByTestId('hall-transfer-u2')));
  await fireEvent.press(screen.getByTestId('hall-transfer-u2'));
  await waitFor(() => assert.ok(screen.getByTestId('hall-dialog-ok')));
  await fireEvent.press(screen.getByTestId('hall-dialog-ok'));
  await waitFor(() => assert.equal(api.transferHost.mock.calls[0][0], 'u2'));
});

test('관리 명령 완료가 같은 활성 관리 route·세션 세대 전환 뒤 이전 UI를 갱신하지 않는다', async () => {
  const releases: (() => void)[] = [];
  const api = management({
    saveSettings: jest.fn(
      () =>
        new Promise<void>((resolve) => {
          releases.push(resolve);
        }),
    ),
  });
  managementMock.mockReturnValue(api);
  const state = initialState(true);
  const screen = await render(<Hall e={e('manage', state)} />);

  await fireEvent.press(screen.getByTestId('hall-edit'));
  await fireEvent.press(screen.getByTestId('hall-save'));
  await waitFor(() => assert.equal(api.saveSettings.mock.calls.length, 1));
  await screen.rerender(<Hall e={e('members', state)} />);
  await act(async () => {
    releases[0]();
    await Promise.resolve();
  });
  assert.equal(screen.queryByText('섬 정보를 저장했어요.'), null);
  assert.equal(screen.queryByTestId('hall-management-action-error'), null);

  await fireEvent.press(screen.getByTestId('hall-save'));
  await waitFor(() => assert.equal(api.saveSettings.mock.calls.length, 2));
  mockSessionGeneration = 1;
  await screen.rerender(<Hall e={e('members', state)} />);
  await act(async () => {
    releases[1]();
    await Promise.resolve();
  });
  assert.equal(screen.queryByText('섬 정보를 저장했어요.'), null);
  assert.equal(screen.queryByTestId('hall-management-action-error'), null);
});

test('서버 current 섬이 있으면 관리 hook 에 로컬 목업 섬 대신 그 id 를 넘긴다(GROMO-2138)', async () => {
  const state = { ...initialState(true), serverIslands: { currentIslandId: 'srv-1' } } as any;
  await render(<Hall e={e('manage', state)} />);
  assert.equal(managementMock.mock.calls.at(-1)[0].islandId, 'srv-1');
});

test('서버 주민 탈퇴는 서버 섬 이름으로 확인하고 islands.leave 를 보낸다(4-06)', async () => {
  managementMock.mockReturnValue(management({ role: 'member', requests: null }));
  const state = { ...initialState(true), serverIslands: { currentIslandId: 'srv-1' } } as any;
  const leave = jest.fn(async (_islandId: string) => ({ currentIslandId: null }));
  const env = { ...e('manage', state), islands: { leave } };
  const screen = await render(<Hall e={env} />);

  await fireEvent.press(screen.getByTestId('hall-leave'));
  // 목업 '소다 섬'이 아니라 서버 섬 이름으로 묻는다(H2)
  assert.ok(screen.getByText('서버 섬을 떠날까요?'));
  await fireEvent.press(screen.getByTestId('hall-dialog-ok'));
  await waitFor(() => assert.equal(leave.mock.calls[0]?.[0], 'srv-1'));
  // 로컬 reducer LEAVE 로 끝내지 않는다(H1)
  assert.ok(!env.dispatch.mock.calls.some(([a]: any) => a.type === 'LEAVE'));
  await waitFor(() => assert.ok(screen.getByText('섬을 떠났어요.')));
  assert.equal(env.home.mock.calls.length, 0); // current 가 비면 App 이 섬 선택으로 보낸다
});

test('정보 수정 실패는 수정 패널 안에 사용자 문구 토스트로 보인다(H5·H18)', async () => {
  const api = management({
    saveSettings: jest.fn(async () => {
      throw new ApiError(
        'ISLAND_MANAGEMENT_NOT_READY',
        '섬 관리 기능을 아직 사용할 수 없습니다.',
        503,
      );
    }),
  });
  managementMock.mockReturnValue(api);
  const screen = await render(<Hall e={e()} />);
  await fireEvent.press(screen.getByTestId('hall-edit'));
  await fireEvent.press(screen.getByTestId('hall-save'));
  await waitFor(() =>
    assert.ok(
      screen.getByText('섬 관리 기능을 아직 사용할 수 없어요.\n잠시 후 다시 시도해 주세요.'),
    ),
  );
  assert.ok(screen.getByTestId('hall-name')); // 패널은 그대로 열려 있다
});

test('정원이 찬 뒤 승인하면 정원을 늘리라고 안내한다(H7)', async () => {
  const api = management({
    answerRequest: jest.fn(async () => {
      throw new ApiError('ROOM_FULL', '그룹 정원이 가득 찼습니다.', 409);
    }),
  });
  managementMock.mockReturnValue(api);
  const screen = await render(<Hall e={e()} />);
  await fireEvent.press(screen.getByTestId('hall-approve-r1'));
  await waitFor(() =>
    assert.ok(screen.getByText('정원이 가득 찼어요.\n정원을 늘린 뒤 승인해 주세요.')),
  );
  assert.equal(screen.queryByText('그룹 정원이 가득 찼습니다.'), null);
});

test('재조회 중에도 확정된 관리 카드를 유지하고 이름 없는 신청자는 "신청자"로 읽는다(H6·H19)', async () => {
  managementMock.mockReturnValue(
    management({
      loading: true,
      requests: [{ id: 'r2', applicantId: 'a2', name: null, status: 'pending', version: 1 }],
    }),
  );
  const screen = await render(<Hall e={e()} />);
  assert.equal(screen.queryByTestId('hall-management-loading'), null);
  assert.ok(screen.getByText('서버 섬'));
  assert.ok(screen.getByLabelText('신청자 가입 승인'));
  assert.ok(screen.getByLabelText('신청자 가입 거절'));
});

test('승인 처리 중에는 승인·거절을 다시 누를 수 없다(H20)', async () => {
  let finish: () => void = () => {};
  const api = management({
    answerRequest: jest.fn(() => new Promise<void>((resolve) => (finish = resolve))),
  });
  managementMock.mockReturnValue(api);
  const screen = await render(<Hall e={e()} />);
  await fireEvent.press(screen.getByTestId('hall-approve-r1'));
  await fireEvent.press(screen.getByTestId('hall-approve-r1'));
  await fireEvent.press(screen.getByTestId('hall-reject-r1'));
  assert.equal(api.answerRequest.mock.calls.length, 1);
  await act(async () => finish());
});

test('확인 버튼 위험색은 강퇴·탈퇴에만 쓴다(H23)', async () => {
  const screen = await render(<Hall e={e()} />);
  await fireEvent.press(screen.getByTestId('hall-member-u2'));
  await fireEvent.press(screen.getByTestId('hall-member-transfer'));
  const transferOk = screen.getByTestId('hall-dialog-ok');
  assert.notEqual(transferOk.props.style.backgroundColor, '#e9a49d');
  await fireEvent.press(screen.getByTestId('hall-dialog-cancel'));
  await fireEvent.press(screen.getByTestId('hall-member-u2'));
  await fireEvent.press(screen.getByTestId('hall-member-kick'));
  assert.equal(screen.getByTestId('hall-dialog-ok').props.style.backgroundColor, '#e9a49d');
});

test('신청자·주민 아바타는 각자의 고양이 색이고 색이 없으면 내 색을 빌리지 않는다(H21)', async () => {
  const state = initialState(true);
  managementMock.mockReturnValue(
    management({
      members: [
        { id: 'host', name: '방장', catColor: 'cream', role: 'host', appearance: {} },
        { id: 'u2', name: '주민', catColor: null, role: 'member', appearance: {} },
      ],
      requests: [
        {
          id: 'r1',
          applicantId: 'a1',
          name: '신청자',
          catColor: 'calico',
          status: 'pending',
          version: 1,
        },
      ],
    }),
  );
  const screen = await render(<Hall e={e('manage', state)} />);
  // RNTL 14 에는 UNSAFE 쿼리가 없다 — 렌더 트리를 훑어 Image source 를 모은다
  const all: unknown[] = [];
  const walk = (node: any) => {
    if (!node) return;
    if (Array.isArray(node)) return node.forEach(walk);
    if (node.type === 'Image') all.push(node.props.source);
    walk(node.children);
  };
  walk(screen.toJSON());
  const { art } = require('@/design-system/patterns');
  assert.ok(all.includes(art['avatar/calico'])); // 신청자 본인 색
  assert.ok(all.includes(art['avatar/cream'])); // 방장 색
  // 색 없는 주민 칸이 내 색(state.color)으로 칠해지지 않는다 — 내 색 그림은 어디에도 없다
  if (state.color !== 'cream' && state.color !== 'calico')
    assert.ok(!all.includes(art[`avatar/${state.color}`]));
});
