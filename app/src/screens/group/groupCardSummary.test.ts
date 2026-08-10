import {
  GroupCardSummaryAdapter,
  type FocusDependencyState,
  type SharedFocusDependency,
} from './groupCardSummary';

jest.mock('@/services/groupApi', () => ({
  getGroupDetail: jest.fn(),
  getAnnouncements: jest.fn(),
  getChallenges: jest.fn(),
}));

const GROUP_A = '00000000-0000-0000-0000-00000000000a';
const GROUP_B = '00000000-0000-0000-0000-00000000000b';
const USER_ID = '00000000-0000-0000-0000-000000000001';
const DATE = '2026-08-10';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function createFocus(): SharedFocusDependency<string[]> & {
  state: FocusDependencyState<string[]>;
  ensure: jest.Mock;
  retry: jest.Mock;
} {
  return {
    state: { status: 'idle' },
    getState() {
      return this.state;
    },
    ensure: jest.fn(function (this: { state: FocusDependencyState<string[]> }) {
      this.state = { status: 'loading' };
      return Promise.resolve(undefined);
    }),
    retry: jest.fn().mockResolvedValue(undefined),
  };
}

const detail = (id: string) => ({ id, members: [] }) as never;

describe('GroupCardSummaryAdapter', () => {
  test('첫 back 전에는 요청하지 않고 첫 ensure에서 네 dependency를 병렬로 한 번만 시작한다', async () => {
    const pending = deferred<never>();
    const focus = createFocus();
    const loaders = {
      detail: jest.fn(() => pending.promise),
      announcements: jest.fn(() => pending.promise),
      challenges: jest.fn(() => pending.promise),
    };
    const adapter = new GroupCardSummaryAdapter(focus, loaders);
    adapter.setScope({ userId: USER_ID, date: DATE, groupIds: [GROUP_A] });

    expect(loaders.detail).not.toHaveBeenCalled();
    const first = adapter.ensureBack(GROUP_A);
    const second = adapter.ensureBack(GROUP_A);

    expect(loaders.detail).toHaveBeenCalledTimes(1);
    expect(loaders.announcements).toHaveBeenCalledTimes(1);
    expect(loaders.challenges).toHaveBeenCalledTimes(1);
    expect(focus.ensure).toHaveBeenCalledTimes(1);
    expect(focus.ensure).toHaveBeenCalledWith(USER_ID, DATE);

    pending.resolve([] as never);
    await Promise.all([first, second]);
  });

  test('warm·error dependency는 ensure에서 재요청하지 않고 실패 영역만 명시 retry한다', async () => {
    const focus = createFocus();
    focus.state = { status: 'error', error: new Error('focus') };
    const loaders = {
      detail: jest.fn().mockResolvedValue(detail(GROUP_A)),
      announcements: jest.fn().mockRejectedValueOnce(new Error('notice')).mockResolvedValueOnce([]),
      challenges: jest.fn().mockResolvedValue([]),
    };
    const adapter = new GroupCardSummaryAdapter(focus, loaders);
    adapter.setScope({ userId: USER_ID, date: DATE, groupIds: [GROUP_A] });

    await adapter.ensureBack(GROUP_A);
    await adapter.ensureBack(GROUP_A);

    expect(loaders.detail).toHaveBeenCalledTimes(1);
    expect(loaders.announcements).toHaveBeenCalledTimes(1);
    expect(loaders.challenges).toHaveBeenCalledTimes(1);
    expect(adapter.getSnapshot(GROUP_A)?.announcements.status).toBe('error');
    expect(adapter.getSnapshot(GROUP_A)?.detail.status).toBe('ready');

    await adapter.retry(GROUP_A, 'announcements');
    expect(loaders.announcements).toHaveBeenCalledTimes(2);
    expect(loaders.detail).toHaveBeenCalledTimes(1);

    await adapter.retry(GROUP_A, 'focus');
    expect(focus.retry).toHaveBeenCalledWith(USER_ID, DATE);
  });

  test('scope에서 사라진 그룹의 늦은 응답은 폐기하고 다른 카드에 넣지 않는다', async () => {
    const a = deferred<never>();
    const focus = createFocus();
    const loaders = {
      detail: jest.fn((groupId: string) =>
        groupId === GROUP_A ? a.promise : Promise.resolve(detail(GROUP_B)),
      ),
      announcements: jest.fn().mockResolvedValue([]),
      challenges: jest.fn().mockResolvedValue([]),
    };
    const adapter = new GroupCardSummaryAdapter(focus, loaders);
    adapter.setScope({ userId: USER_ID, date: DATE, groupIds: [GROUP_A] });
    const oldRequest = adapter.ensureBack(GROUP_A);

    adapter.setScope({ userId: USER_ID, date: DATE, groupIds: [GROUP_B] });
    await adapter.ensureBack(GROUP_B);
    a.resolve(detail(GROUP_A));
    await oldRequest;

    expect(adapter.getSnapshot(GROUP_A)).toBeNull();
    const bState = adapter.getSnapshot(GROUP_B)?.detail;
    expect(bState?.status).toBe('ready');
    if (bState?.status === 'ready') expect(bState.data.id).toBe(GROUP_B);
  });

  test('KST 날짜가 바뀌면 날짜 key dependency만 새로 읽고 공지는 재사용한다', async () => {
    const focus = createFocus();
    const loaders = {
      detail: jest.fn().mockResolvedValue(detail(GROUP_A)),
      announcements: jest.fn().mockResolvedValue([]),
      challenges: jest.fn().mockResolvedValue([]),
    };
    const adapter = new GroupCardSummaryAdapter(focus, loaders);
    adapter.setScope({ userId: USER_ID, date: DATE, groupIds: [GROUP_A] });
    await adapter.ensureBack(GROUP_A);

    adapter.setScope({ userId: USER_ID, date: '2026-08-11', groupIds: [GROUP_A] });
    await adapter.ensureBack(GROUP_A);

    expect(loaders.detail).toHaveBeenCalledTimes(2);
    expect(loaders.challenges).toHaveBeenCalledTimes(2);
    expect(loaders.announcements).toHaveBeenCalledTimes(1);
  });

  test('목록 새로고침이나 그룹방 복귀 invalidate 뒤 모든 뒷면 dependency를 다시 읽는다', async () => {
    const focus = createFocus();
    const loaders = {
      detail: jest.fn().mockResolvedValue(detail(GROUP_A)),
      announcements: jest.fn().mockResolvedValue([]),
      challenges: jest.fn().mockResolvedValue([]),
    };
    const adapter = new GroupCardSummaryAdapter(focus, loaders);
    adapter.setScope({ userId: USER_ID, date: DATE, groupIds: [GROUP_A] });
    await adapter.ensureBack(GROUP_A);

    adapter.invalidateBack();
    expect(adapter.getSnapshot(GROUP_A)?.detail.status).toBe('idle');
    await adapter.ensureBack(GROUP_A);

    expect(loaders.detail).toHaveBeenCalledTimes(2);
    expect(loaders.announcements).toHaveBeenCalledTimes(2);
    expect(loaders.challenges).toHaveBeenCalledTimes(2);
  });
});
