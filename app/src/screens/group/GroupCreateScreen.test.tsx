// GroupCreateScreen 전송 계약 + 생성 요청 구간 테스트 — 명세 docs/app/group-plan.md §6-2 + 3차 §D18.
//
// 이 화면이 서버로 보내는 바디는 그룹의 성격을 정한다(이름·소개·정원·공개 여부).
// 3차 §D18에서 챌린지를 그룹 생성과 분리했다 — 생성 시 챌린지를 정하지 않으므로 바디에
// missionType·missionCategory·durationMinutes가 실려선 안 되고, password가 실리면 아무도
// 못 들어오는 그룹이 만들어진다(§3-1-3). 소개(description)는 선택이라 입력이 있을 때만 실린다.
//
// 바디와 별개로, 이 화면의 위험 구간은 "요청은 떠 있는데 화면은 계속 열려 있는" 몇 초다.
//   1) 그 사이 이름을 고치면 초대 문구가 실제 그룹 이름과 갈린다 → 요청에 실어 보낸 이름을 굳힌다
//   2) 그 사이 이탈하면 취소한 줄 아는 그룹에 OWNER로 갇힌다(§14 — 삭제·위임 UI가 없다)
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Alert, Share } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AxiosError, AxiosHeaders } from 'axios';
import GroupCreateScreen from './GroupCreateScreen';
import { buildInviteShareMessage } from './inviteShare';
import { createGroup } from '@/services/groupApi';
import { issueInviteLink } from '@/services/inviteLinkApi';
import type { CreateGroupResponse } from '@/types/dto/group';
import { __resetGroupCardEmojiQueueForTest, readGroupCardEmoji } from './groupCardEmojiStore';

jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context'),
  useSafeAreaInsets: () => ({ top: 47, left: 0, right: 0, bottom: 34 }),
}));

// 화면이 'beforeRemove'로 생성 중 이탈을 막는다 — 스텁이 등록만 삼키면 그 방어가 통째로
// 검증 밖으로 나가므로, 붙은 핸들러를 잡아 두고 테스트에서 직접 이벤트를 흘려보낸다.
// jest.mock 팩토리는 mock 접두 변수만 참조할 수 있어 홀더 객체에 담는다.
const mockNav = {
  goBack: jest.fn(),
  navigate: jest.fn(),
  beforeRemove: null as ((e: { preventDefault: () => void }) => void) | null,
};
// 해제 함수는 잡아 둔 핸들러를 비운다 — 언마운트된 화면의 리스너가 살아남으면
// 다음 테스트가 이미 사라진 화면의 이탈 차단을 검증하게 된다.
const mockAddListener = jest.fn(
  (event: string, cb: (e: { preventDefault: () => void }) => void) => {
    if (event === 'beforeRemove') mockNav.beforeRemove = cb;
    return () => {
      if (event === 'beforeRemove') mockNav.beforeRemove = null;
    };
  },
);
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
    goBack: mockNav.goBack,
    navigate: mockNav.navigate,
    addListener: mockAddListener,
  }),
}));

jest.mock('@/store/UserContext', () => ({ useUser: () => ({ userId: 'user-1' }) }));

jest.mock('@/services/analyticsEvents', () => ({
  logGroupCreateStarted: jest.fn(),
  logGroupInviteShared: jest.fn(),
}));
const { logGroupInviteShared } = jest.requireMock('@/services/analyticsEvents');

// groupErrorCode는 실제 구현을 남긴다(§3-2 code 분기까지 검증).
jest.mock('@/services/groupApi', () => ({
  ...jest.requireActual('@/services/groupApi'),
  createGroup: jest.fn(),
}));

// NOT_FOUND(유저 부재) 분기가 부르는 재로그인 탈출구 — 실제 모듈은 App이 등록한 핸들러로
// 온보딩 트리를 리셋하므로, 여기선 호출 여부만 본다. groupApi(requireActual)가 같은 모듈의
// api 인스턴스를 import하므로 형태만 유지해 끼워 준다(createGroup은 어차피 위에서 목).
jest.mock('@/services/api', () => ({
  api: { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() },
  triggerLogout: jest.fn(),
}));
const { triggerLogout } = jest.requireMock('@/services/api');

// 초대 링크는 서버 발급분만 쓴다(초대 링크 스펙 §4-2 ①) — 앱은 링크를 조립하지 않는다.
jest.mock('@/services/inviteLinkApi', () => ({ issueInviteLink: jest.fn() }));

const mockCreateGroup = createGroup as jest.MockedFunction<typeof createGroup>;
const mockIssueInviteLink = issueInviteLink as jest.MockedFunction<typeof issueInviteLink>;

const GROUP_ID = '0197e0c3-4d1b-7a2e-9f60-3b7c1f2a8d55';
const SLUG = 'ab23cd45';
const INVITE_URL = `https://link.oneorthree.world/l/${SLUG}?g=${GROUP_ID}`;

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

async function renderScreen() {
  const result = await render(<GroupCreateScreen />);
  await act(async () => {});
  return result;
}

// 비동기 핸들러(생성)를 부르는 탭 — fireEvent만으론 이어지는 setState가 act 밖으로 샌다.
async function press(label: string) {
  const el = await screen.findByText(label);
  await act(async () => {
    fireEvent.press(el);
  });
}

async function typeName(name: string) {
  await act(async () => {
    fireEvent.changeText(screen.getByPlaceholderText('예) 아침 6시 집중방'), name);
  });
}

async function typeDescription(text: string) {
  await act(async () => {
    fireEvent.changeText(
      screen.getByPlaceholderText('예) 매일 아침 함께 집중하는 그룹이에요 (선택)'),
      text,
    );
  });
}

beforeEach(async () => {
  await AsyncStorage.clear();
  __resetGroupCardEmojiQueueForTest();
  jest.clearAllMocks();
  mockNav.beforeRemove = null;
  jest.spyOn(Share, 'share').mockResolvedValue({ action: Share.sharedAction });
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  mockCreateGroup.mockResolvedValue({ groupId: GROUP_ID, code: 'ignored' });
  mockIssueInviteLink.mockResolvedValue({ slug: SLUG, url: INVITE_URL });
});

describe('내 카드 아이콘 로컬 draft', () => {
  test('선택값은 create body에 넣지 않고 성공 응답 groupId에만 저장한다', async () => {
    await renderScreen();
    await typeName('아침 6시 집중방');
    await act(async () => {
      fireEvent.press(screen.getByTestId('group.create.cardEmoji.📚'));
    });

    await press('만들기');

    expect(mockCreateGroup.mock.calls[0][0]).not.toHaveProperty('emoji');
    await waitFor(async () => expect(await readGroupCardEmoji('user-1', GROUP_ID)).toBe('📚'));
  });

  test('생성 실패에는 로컬 아이콘을 저장하지 않는다', async () => {
    mockCreateGroup.mockRejectedValueOnce(new Error('network'));
    await renderScreen();
    await typeName('실패할 그룹');
    await act(async () => {
      fireEvent.press(screen.getByTestId('group.create.cardEmoji.🔥'));
    });

    await press('만들기');

    expect(await AsyncStorage.getItem('gromo:groups:cardEmoji:v1')).toBeNull();
  });

  test('고르지 않으면 성공 groupId에 기본 🎯를 저장한다', async () => {
    await renderScreen();
    await typeName('기본 아이콘 그룹');
    await press('만들기');

    await waitFor(async () => expect(await readGroupCardEmoji('user-1', GROUP_ID)).toBe('🎯'));
  });
});

describe('전송 계약 — 챌린지 없이 만든다(3차 §D18)', () => {
  // §D18: 그룹 생성 시 챌린지를 정하지 않는다 — createGroup은 대표 챌린지를 만들지 않으므로
  // mission 필드(missionType·missionCategory·durationMinutes)가 바디에 실려선 안 된다.
  test('생성 성공 시 createGroup이 mission 없이 이름·정원·공개설정만으로 호출된다', async () => {
    await renderScreen();
    await typeName('아침 6시 집중방');

    await press('만들기');

    expect(mockCreateGroup).toHaveBeenCalledWith({
      name: '아침 6시 집중방',
      maxMembers: 5,
      isPrivate: false,
    });
  });

  // 소개는 §D18에서 새로 들어온 선택 필드 — 입력하면 그대로 실려 나간다.
  test('소개를 입력하면 description을 실어 보낸다', async () => {
    await renderScreen();
    await typeName('저녁 스터디');
    await typeDescription('매일 밤 10시에 함께 집중해요');

    await press('만들기');

    expect(mockCreateGroup).toHaveBeenCalledWith(
      expect.objectContaining({ description: '매일 밤 10시에 함께 집중해요' }),
    );
  });

  // 소개는 선택(빈 값 허용) — 비어 있으면 키 자체를 보내지 않는다.
  test('소개가 비면 description 키를 보내지 않는다', async () => {
    await renderScreen();
    await typeName('아침 6시 집중방');

    await press('만들기');

    const body = mockCreateGroup.mock.calls[0][0];
    expect(body).not.toHaveProperty('description');
  });

  test('공개 설정 선택이 그대로 실린다', async () => {
    await renderScreen();
    await typeName('저녁 스터디');
    await press('비공개');

    await press('만들기');

    expect(mockCreateGroup).toHaveBeenCalledWith(expect.objectContaining({ isPrivate: true }));
  });

  // 폐기된 개념(§0)과 §D18로 빠진 mission — 바디 키는 정확히 세 개뿐이다.
  // password·code·missionType·missionCategory·durationMinutes가 하나라도 끼면 실패한다
  // (Object.keys는 값이 undefined인 키도 잡아내므로 mission 누락을 엄격히 검증한다).
  test('바디 키는 name·maxMembers·isPrivate뿐이다(password·code·mission 없음)', async () => {
    await renderScreen();
    await typeName('아침 6시 집중방');

    await press('만들기');

    const body = mockCreateGroup.mock.calls[0][0];
    expect(Object.keys(body).sort()).toEqual(['isPrivate', 'maxMembers', 'name']);
  });

  test('이름이 비면 만들기가 눌리지 않는다', async () => {
    await renderScreen();

    await press('만들기');

    expect(mockCreateGroup).not.toHaveBeenCalled();
  });
});

describe('요청이 떠 있는 구간(§6-2)', () => {
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
    expect(Share.share).toHaveBeenCalledWith({
      message: buildInviteShareMessage('아침 6시 집중방', INVITE_URL),
    });
    expect(Share.share).not.toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('저녁 10시') }),
    );
  });

  // 같은 '초대하기'인데 진입점마다 말이 다르면 안 된다 — 그룹방 초대 타일과 이 다이얼로그는
  // buildInviteShareMessage 하나만 쓴다(GroupRoomScreen.test.tsx의 같은 이름 테스트가 짝).
  // 여기서 문구 원문을 박아 두는 이유: 화면이 몰래 자기 문구를 다시 짜면 잡아야 한다.
  test('공유 문구는 그룹방 초대 타일과 같은 공용 문구다', async () => {
    await renderScreen();
    await typeName('아침 6시 집중방');
    await press('비공개');
    await press('만들기');

    await press('공유하기');

    expect(Share.share).toHaveBeenCalledWith({
      message: `아침 6시 집중방 그룹에 초대했어요! 같이 집중해요 ⭐️\n${INVITE_URL}`,
    });
  });

  // 링크는 서버 발급분만 나간다(초대 링크 스펙 §7-4). 앱이 조립하던 구 링크는 실제로 404였고,
  // slug 가 없으면 클릭·설치·가입이 어느 초대에서 왔는지 서버가 영영 알 수 없다.
  test('공유 링크는 서버가 발급한 url 을 그대로 쓴다', async () => {
    await renderScreen();
    await typeName('아침 6시 집중방');
    await press('비공개');
    await press('만들기');

    await press('공유하기');

    expect(mockIssueInviteLink).toHaveBeenCalledWith(GROUP_ID);
    expect(Share.share).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining(INVITE_URL) }),
    );
    expect(logGroupInviteShared).toHaveBeenCalledWith({
      share_method: 'share_sheet',
      confirmed: expect.any(Boolean),
      slug: SLUG,
      group_id: GROUP_ID,
    });
  });

  // 발급은 서버에서 멱등이지만, 같은 다이얼로그에서 복사·공유를 오갈 때 왕복을 반복할 이유가 없다.
  test('복사와 공유는 발급을 한 번만 하고 같은 링크를 쓴다', async () => {
    await renderScreen();
    await typeName('아침 6시 집중방');
    await press('비공개');
    await press('만들기');

    await press('링크 복사');
    await press('공유하기');

    expect(mockIssueInviteLink).toHaveBeenCalledTimes(1);
    expect(logGroupInviteShared).toHaveBeenCalledWith({
      share_method: 'copy',
      confirmed: true,
      slug: SLUG,
      group_id: GROUP_ID,
    });
  });

  // 폴백 링크는 없다 — 발급이 실패하면 공유할 주소 자체가 없으므로 시트를 띄우지 않고 알린다.
  test('발급 실패면 공유 시트를 띄우지 않고 안내한다(폴백 링크 없음)', async () => {
    mockIssueInviteLink.mockRejectedValueOnce(new Error('network'));
    await renderScreen();
    await typeName('아침 6시 집중방');
    await press('비공개');
    await press('만들기');

    await press('공유하기');

    expect(Share.share).not.toHaveBeenCalled();
    expect(Alert.alert).toHaveBeenCalledWith('초대 링크를 만들지 못했어요', expect.any(String));
    expect(logGroupInviteShared).not.toHaveBeenCalled();
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
});

// 백 계약은 **생성·참가 양쪽 모두** 상한 10을 검사한다(GroupService.ensureJoinedGroupLimit).
// 초대·찾기 시트는 이미 분기를 갖고 있었지만 생성 경로만 빠져 있었다 — 409는 status 400도 아니라
// 공통 문구 '잠시 후 다시 시도'로 떨어졌고, 시간이 지나도 절대 풀리지 않는 조건이라
// 사용자는 서버 장애로 이해하고 재시도만 반복했다.
describe('에러 분기(§3-2 — status가 아니라 code로 본다)', () => {
  test('GROUP_LIMIT_EXCEEDED — 상한 안내 Alert(공통 실패 문구가 아니다)', async () => {
    mockCreateGroup.mockRejectedValue(axiosErrorWith(409, 'GROUP_LIMIT_EXCEEDED'));
    await renderScreen();
    await typeName('아침 6시 집중방');

    await press('만들기');

    expect(Alert.alert).toHaveBeenCalledWith(
      '더 이상 만들 수 없어요',
      '참여할 수 있는 그룹 수를 초과했어요(최대 10개)',
    );
    expect(Alert.alert).not.toHaveBeenCalledWith('그룹을 만들지 못했어요', expect.any(String));
  });

  // 유저 행 부재(탈퇴 후 토큰 잔존 등) — #516이 403→404 NOT_FOUND로 정정한 판정(GROMO-1241).
  // 유효 JWT라 401 인터셉터를 안 타므로 공통 문구로 뭉개면 재시도 막다른 골목이 된다 —
  // 취소 없는 단일 확인으로 재로그인(triggerLogout)까지 이어져야 한다.
  test('NOT_FOUND — 재로그인 안내 Alert, 확인 시 triggerLogout(공통 실패 문구가 아니다)', async () => {
    mockCreateGroup.mockRejectedValue(axiosErrorWith(404, 'NOT_FOUND'));
    await renderScreen();
    await typeName('아침 6시 집중방');

    await press('만들기');

    expect(Alert.alert).toHaveBeenCalledWith(
      '로그인이 필요해요',
      '로그인 정보가 만료됐어요. 다시 로그인해주세요.',
      [expect.objectContaining({ text: '확인', onPress: expect.any(Function) })],
      // 취소 불가 — 무콜백 닫힘(로그아웃 미실행 잔류) 방지 의도를 계약으로 고정(#530 codex).
      { cancelable: false },
    );
    expect(Alert.alert).not.toHaveBeenCalledWith('그룹을 만들지 못했어요', expect.any(String));

    // 로그아웃은 Alert 확인 버튼에서만 — 알럿이 뜬 것만으론 아직 불리지 않는다.
    expect(triggerLogout).not.toHaveBeenCalled();
    const [, , buttons] = (Alert.alert as jest.Mock).mock.calls[0];
    await act(async () => {
      buttons[0].onPress();
    });
    expect(triggerLogout).toHaveBeenCalledTimes(1);
  });

  test('모르는 code는 공통 문구로 떨어진다', async () => {
    mockCreateGroup.mockRejectedValue(axiosErrorWith(500, 'SOMETHING_NEW'));
    await renderScreen();
    await typeName('아침 6시 집중방');

    await press('만들기');

    expect(Alert.alert).toHaveBeenCalledWith(
      '그룹을 만들지 못했어요',
      '잠시 후 다시 시도해주세요.',
    );
  });

  test('400은 이름 필드를 짚어준다(Alert 아님)', async () => {
    mockCreateGroup.mockRejectedValue(axiosErrorWith(400));
    await renderScreen();
    await typeName('아침 6시 집중방');

    await press('만들기');

    expect(screen.getByText('그룹 이름을 다시 확인해주세요')).toBeOnTheScreen();
    expect(Alert.alert).not.toHaveBeenCalled();
  });
});
