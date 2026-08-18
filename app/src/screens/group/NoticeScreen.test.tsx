// NoticeScreen 정합성 테스트 — 명세 docs/app/group-plan.md §6-5.
//
// 이 화면은 포커스 재조회가 없다(스택 화면, 진입 시 1회 조회). 그래서 "서버에서는 이미 바뀌었는데
// 화면은 옛 목록을 그대로 보여 준다"가 곧바로 중복 조작으로 이어진다 — 사라진 공지를 다시 고치거나,
// 방금 올린 공지를 한 번 더 등록한다. 여기서 잠그는 건 그 세 갈래다.
//   1) 수정 대상이 이미 삭제됨(NOT_FOUND) → 시트를 닫고 목록을 다시 맞춘다
//   2) 저장 요청 중 스택 이탈 차단 → 취소한 줄 알았는데 공지가 생기는 일을 막는다
//   3) 빈 목록 + 재조회 실패 → '등록된 공지가 없어요'가 아니라 에러+다시 시도
//
// 네트워크만 목으로 갈아끼우고 groupErrorCode는 실제 구현을 쓴다(§3-2 code 분기까지 검증).
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { AxiosError, AxiosHeaders } from 'axios';
import NoticeScreen from './NoticeScreen';
import {
  createAnnouncement,
  deleteAnnouncement,
  getAnnouncements,
  updateAnnouncement,
} from '@/services/groupApi';
import type { GroupAnnouncementResponse } from '@/types/dto/group';

jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context'),
  useSafeAreaInsets: () => ({ top: 47, left: 0, right: 0, bottom: 34 }),
}));

// 이탈 차단 검증을 위해 beforeRemove 리스너를 테스트가 직접 붙잡는다(실제 스택 없이 굴린다).
// jest.mock 팩토리는 mock 접두 변수만 참조할 수 있어 홀더 객체에 담는다.
const mockNav = {
  goBack: jest.fn(),
  beforeRemove: null as ((e: { preventDefault: () => void }) => void) | null,
};
jest.mock('@react-navigation/native', () => ({
  // 실제 모듈을 깔고 필요한 것만 덮는다 — navigationRef가 createNavigationContainerRef를
  // 모듈 로드 시점에 부르기 때문에, 빠뜨리면 이 화면을 import하는 것만으로 스위트가 죽는다.
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({
    goBack: mockNav.goBack,
    addListener: (event: string, cb: (e: { preventDefault: () => void }) => void) => {
      if (event === 'beforeRemove') mockNav.beforeRemove = cb;
      return () => {};
    },
  }),
  useRoute: () => ({
    params: { groupId: '0197e0c3-4d1b-7a2e-9f60-3b7c1f2a8d55', canWrite: true },
  }),
}));

jest.mock('@/services/analyticsEvents', () => ({ logGroupTabViewed: jest.fn() }));

// 조치가 필요 없는 실패 통보는 tone:'error' 토스트로 나간다(GROMO-1491 / 정책 D19 —
// docs/prd/motion-v2/policy.md, 상위 정본 병합 전까지 여기가 정본) — useToast는 Provider
// 밖에서 throw하므로 훅 자체를 목으로 대체한다.
const mockToastShow = jest.fn();
jest.mock('@/store/ToastContext', () => ({ useToast: () => ({ show: mockToastShow }) }));

jest.mock('@/services/groupApi', () => ({
  ...jest.requireActual('@/services/groupApi'),
  getAnnouncements: jest.fn(),
  createAnnouncement: jest.fn(),
  updateAnnouncement: jest.fn(),
  deleteAnnouncement: jest.fn(),
}));

const mockGetAnnouncements = getAnnouncements as jest.MockedFunction<typeof getAnnouncements>;
const mockCreateAnnouncement = createAnnouncement as jest.MockedFunction<typeof createAnnouncement>;
const mockUpdateAnnouncement = updateAnnouncement as jest.MockedFunction<typeof updateAnnouncement>;
const mockDeleteAnnouncement = deleteAnnouncement as jest.MockedFunction<typeof deleteAnnouncement>;

// 서버 GlobalExceptionHandler의 { code, message } 바디를 실은 axios 에러.
function axiosErrorWith(status: number, code?: string): AxiosError {
  const config = { headers: new AxiosHeaders() };
  return new AxiosError('request failed', 'ERR_BAD_REQUEST', config, null, {
    status,
    statusText: '',
    headers: {},
    config,
    data: code ? { code, message: '...' } : undefined,
  });
}

function notice(over: Partial<GroupAnnouncementResponse> = {}): GroupAnnouncementResponse {
  return {
    id: 'a1',
    title: '오늘 6시에 모여요',
    content: '늦지 마세요',
    createdAt: '2026-08-01T06:00:00',
    ...over,
  };
}

async function renderScreen() {
  const result = await render(<NoticeScreen />);
  await act(async () => {});
  return result;
}

// 비동기 핸들러(저장 등)를 부르는 탭 — fireEvent만으론 이어지는 setState가 act 밖으로 샌다
// (GroupInviteSheet.test.tsx와 같은 관행).
async function press(label: string) {
  const el = await screen.findByText(label);
  await act(async () => {
    fireEvent.press(el);
  });
}

// 카드 롱프레스 → 액션 Alert의 버튼을 눌러 준다.
async function pressCardMenu(action: '수정' | '삭제') {
  await act(async () => {
    fireEvent(screen.getByText('오늘 6시에 모여요'), 'longPress');
  });
  const buttons = (Alert.alert as jest.MockedFunction<typeof Alert.alert>).mock.calls.at(-1)?.[2];
  await act(async () => {
    await buttons?.find((b) => b.text === action)?.onPress?.();
  });
}

// 시트 열기·입력도 async act로 감싼다 — 동기 act나 맨 fireEvent로는 이어지는 조회 프라미스가
// 흘러가지 않아 뒤 단계가 옛 트리를 본다(React 19 + RTL v14). 대신 fireEvent 내부 act와 겹쳐
// 'overlapping act' 경고가 콘솔에 남는데, 동작에는 영향이 없어 그대로 둔다.
async function openCompose() {
  await act(async () => {
    fireEvent.press(screen.getByTestId('group.notice.compose'));
  });
}

async function fillCompose(title: string, content: string) {
  await act(async () => {
    fireEvent.changeText(screen.getByPlaceholderText('공지 제목'), title);
    fireEvent.changeText(screen.getByPlaceholderText('공지 내용을 적어 주세요'), content);
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockNav.beforeRemove = null;
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});

describe('수정 대상이 사라진 경우', () => {
  test('수정 404면 시트를 닫고 목록을 다시 맞춘다', async () => {
    mockGetAnnouncements.mockResolvedValueOnce([notice()]).mockResolvedValueOnce([]);
    mockUpdateAnnouncement.mockRejectedValueOnce(axiosErrorWith(404, 'NOT_FOUND'));
    await renderScreen();

    await pressCardMenu('수정');
    expect(screen.getByText('공지 수정')).toBeOnTheScreen();

    await press('수정하기');

    // 시트에 문구만 남기고 끝내면 사라진 카드가 목록에 그대로 남는다 — 닫고 재조회한다.
    await waitFor(() => expect(mockGetAnnouncements).toHaveBeenCalledTimes(2));
    expect(screen.queryByText('공지 수정')).toBeNull();
    // 종결 통보(조치 없음)라 확인 Alert가 아니라 tone:'error' 토스트다(GROMO-1491 / D19).
    expect(mockToastShow).toHaveBeenCalledWith({
      message: '이미 삭제된 공지라 수정할 수 없어요',
      tone: 'error',
    });
    // 이 흐름의 유일한 Alert는 카드 롱프레스 메뉴다 — 실패 통보 Alert가 추가로 뜨지 않는다.
    expect(Alert.alert).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('등록된 공지가 없어요')).toBeOnTheScreen();
  });

  test('그 밖의 수정 실패는 시트를 열어 둔 채 인라인 문구만 띄운다', async () => {
    mockGetAnnouncements.mockResolvedValue([notice()]);
    mockUpdateAnnouncement.mockRejectedValueOnce(axiosErrorWith(500));
    await renderScreen();

    await pressCardMenu('수정');
    await press('수정하기');

    expect(
      await screen.findByText('공지 수정에 실패했어요. 잠시 후 다시 시도해 주세요.'),
    ).toBeOnTheScreen();
    expect(screen.getByText('공지 수정')).toBeOnTheScreen(); // 시트 유지
    expect(mockGetAnnouncements).toHaveBeenCalledTimes(1);
  });
});

describe('저장 중 스택 이탈', () => {
  test('요청이 떠 있는 동안에는 뒤로 가기를 막는다', async () => {
    mockGetAnnouncements.mockResolvedValue([]);
    let resolveCreate: () => void = () => {};
    mockCreateAnnouncement.mockImplementation(
      () => new Promise<void>((res) => (resolveCreate = () => res())),
    );
    await renderScreen();

    await openCompose();
    await fillCompose('공지 제목', '공지 본문');
    await press('등록하기');

    // 시트는 SheetShell 기본형이라 딤 탭만 막아서는 하드웨어 백·스택 제스처가 화면째 pop한다.
    const blocked = { preventDefault: jest.fn() };
    mockNav.beforeRemove?.(blocked);
    expect(blocked.preventDefault).toHaveBeenCalled();

    // 응답이 오면 곧바로 풀린다 — 성공 경로의 정상 이탈까지 막으면 안 된다.
    await act(async () => {
      resolveCreate();
    });
    const after = { preventDefault: jest.fn() };
    mockNav.beforeRemove?.(after);
    expect(after.preventDefault).not.toHaveBeenCalled();
  });
});

describe('빈 목록 + 재조회 실패', () => {
  test('등록 성공 뒤 조회가 실패하면 빈 상태 안내 대신 다시 시도를 띄운다', async () => {
    mockGetAnnouncements.mockResolvedValueOnce([]).mockRejectedValueOnce(axiosErrorWith(500));
    mockCreateAnnouncement.mockResolvedValueOnce(undefined);
    await renderScreen();

    expect(screen.getByText('등록된 공지가 없어요')).toBeOnTheScreen();

    await openCompose();
    await fillCompose('공지 제목', '공지 본문');
    await press('등록하기');

    // 서버에는 이미 공지가 있다 — '없어요 / 첫 공지를 남겨 보세요'를 그대로 두면 같은 공지를 또 쓴다.
    await waitFor(() => expect(screen.queryByText('등록된 공지가 없어요')).toBeNull());
    expect(screen.getByText('공지를 불러오지 못했어요.')).toBeOnTheScreen();
    expect(screen.getByText('다시 시도')).toBeOnTheScreen();
  });
});

// 위 테스트는 GET이 **실패로 끝난 뒤**만 잠근다 — 등록 성공 후 조회가 도는 **동안**에는
// notices가 아직 []이고 errorMsg도 없어 빈 상태가 그대로 다시 떴다. 느린 GET에서 방금 올린
// 공지가 사라진 줄 알고 같은 공지를 한 번 더 등록하게 되는 창이다.
describe('등록 직후 재조회 중', () => {
  test('조회가 끝날 때까지 빈 상태 안내를 세우지 않는다', async () => {
    let resolveRefetch: (rows: GroupAnnouncementResponse[]) => void = () => {};
    mockGetAnnouncements.mockResolvedValueOnce([]).mockImplementationOnce(
      () =>
        new Promise<GroupAnnouncementResponse[]>((resolve) => {
          resolveRefetch = resolve; // 등록 후 재조회 응답을 붙잡아 둔다
        }),
    );
    mockCreateAnnouncement.mockResolvedValueOnce(undefined);
    await renderScreen();

    expect(screen.getByText('등록된 공지가 없어요')).toBeOnTheScreen();

    await openCompose();
    await fillCompose('공지 제목', '공지 본문');
    await press('등록하기');

    // 재조회가 도는 동안 — '없어요 / 첫 공지를 남겨 보세요'가 다시 뜨면 안 된다.
    await waitFor(() => expect(mockGetAnnouncements).toHaveBeenCalledTimes(2));
    expect(screen.queryByText('등록된 공지가 없어요')).toBeNull();
    expect(screen.queryByText('+ 버튼으로 첫 공지를 남겨 보세요')).toBeNull();

    await act(async () => {
      resolveRefetch([notice()]);
    });
    expect(await screen.findByText('오늘 6시에 모여요')).toBeOnTheScreen();
  });

  test('조회 결과가 정말 비어 있으면 그때 빈 상태로 돌아온다', async () => {
    mockGetAnnouncements.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    mockCreateAnnouncement.mockResolvedValueOnce(undefined);
    await renderScreen();

    await openCompose();
    await fillCompose('공지 제목', '공지 본문');
    await press('등록하기');

    expect(await screen.findByText('등록된 공지가 없어요')).toBeOnTheScreen();
  });
});

describe('삭제', () => {
  test('삭제 404도 목록을 다시 맞춘다(r3에서 잠근 규칙)', async () => {
    mockGetAnnouncements.mockResolvedValueOnce([notice()]).mockResolvedValueOnce([]);
    mockDeleteAnnouncement.mockRejectedValueOnce(axiosErrorWith(404, 'NOT_FOUND'));
    await renderScreen();

    await pressCardMenu('삭제'); // 액션 메뉴의 '삭제' → 확인 Alert
    const confirm = (Alert.alert as jest.MockedFunction<typeof Alert.alert>).mock.calls.at(-1)?.[2];
    await act(async () => {
      await confirm?.find((b) => b.text === '삭제')?.onPress?.();
    });

    await waitFor(() => expect(mockGetAnnouncements).toHaveBeenCalledTimes(2));
    expect(Alert.alert).toHaveBeenLastCalledWith(
      '삭제 실패',
      '이미 삭제된 공지예요.',
      expect.anything(),
      expect.anything(),
    );
  });
});
