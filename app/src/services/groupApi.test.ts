// groupApi 계약 + groupErrorCode 유닛 테스트 — 명세 docs/app/group-plan.md §3·§8·§11.
// HTTP status가 아니라 서버 에러 바디의 code로 분기하는 게 계약이라(ROOM_FULL·ALREADY_MEMBER 둘 다 409)
// groupErrorCode가 조용히 null을 뱉기 시작하면 화면 분기가 전부 공통 문구로 무너진다.
// method/path도 함께 잠근다 — 오타 하나가 런타임 404로만 드러나고 타입 검사에는 걸리지 않는다.
import { AxiosError, AxiosHeaders } from 'axios';
import {
  createAnnouncement,
  createGroup,
  deleteAnnouncement,
  getAnnouncements,
  getGroupDetail,
  getGroupOverview,
  getMyGroups,
  groupErrorCode,
  joinGroup,
  searchGroups,
  updateAnnouncement,
  withdrawGroup,
} from './groupApi';
import { api } from '@/services/api';
import { todayStr } from '@/utils/localDate';

jest.mock('@/services/api', () => ({
  api: { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() },
}));

const mockApi = api as unknown as {
  get: jest.Mock;
  post: jest.Mock;
  put: jest.Mock;
  delete: jest.Mock;
};

const GROUP_ID = '0197e0c3-4d1b-7a2e-9f60-3b7c1f2a8d55';
const NOTICE_ID = 'a1';

// 서버 GlobalExceptionHandler가 내려주는 { code, message } 바디를 실은 axios 에러를 만든다.
function axiosErrorWith(status: number, data: unknown): AxiosError {
  const config = { headers: new AxiosHeaders() };
  return new AxiosError('request failed', 'ERR_BAD_REQUEST', config, null, {
    status,
    statusText: '',
    headers: {},
    config,
    data,
  });
}

describe('엔드포인트 계약(§3-1·§8)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockApi.get.mockResolvedValue({ data: [] });
    mockApi.post.mockResolvedValue({ data: { groupId: GROUP_ID } });
    mockApi.put.mockResolvedValue({ data: undefined });
    mockApi.delete.mockResolvedValue({ data: undefined });
  });

  test('POST /api/v1/groups — 생성 바디를 그대로 보낸다(비밀번호 없음)', async () => {
    const body = {
      name: '아침 6시 집중방',
      maxMembers: 5,
      missionType: 'DURATION' as const,
      missionCategory: 'FOCUS' as const,
      durationMinutes: 60,
      isPrivate: true,
    };
    await createGroup(body);
    expect(mockApi.post).toHaveBeenCalledWith('/api/v1/groups', body);
  });

  test('GET /api/v1/groups — 내 그룹 목록', async () => {
    await getMyGroups();
    expect(mockApi.get).toHaveBeenCalledWith('/api/v1/groups');
  });

  test('GET /api/v1/groups/search — query 파라미터', async () => {
    await searchGroups('집중');
    expect(mockApi.get).toHaveBeenCalledWith('/api/v1/groups/search', {
      params: { query: '집중' },
    });
  });

  // 코드·비밀번호를 폐기했으므로 바디는 항상 {} 다 — 생략하면 서버가 415를 준다.
  test('POST /{groupId}/join — 빈 바디를 반드시 싣는다', async () => {
    await joinGroup(GROUP_ID);
    expect(mockApi.post).toHaveBeenCalledWith(`/api/v1/groups/${GROUP_ID}/join`, {});
  });

  test('GET /{groupId}/overview — 무권한 프리뷰', async () => {
    await getGroupOverview(GROUP_ID);
    expect(mockApi.get).toHaveBeenCalledWith(`/api/v1/groups/${GROUP_ID}/overview`);
  });

  // date는 서버 필수 파라미터라 누락 시 400 — 기본값은 클라 로컬 날짜다(§3-1-1).
  test('GET /{groupId} — date 기본값은 오늘(로컬)', async () => {
    await getGroupDetail(GROUP_ID);
    expect(mockApi.get).toHaveBeenCalledWith(`/api/v1/groups/${GROUP_ID}`, {
      params: { date: todayStr() },
    });
  });

  test('GET /{groupId} — date를 주면 그대로 보낸다', async () => {
    await getGroupDetail(GROUP_ID, '2026-08-02');
    expect(mockApi.get).toHaveBeenCalledWith(`/api/v1/groups/${GROUP_ID}`, {
      params: { date: '2026-08-02' },
    });
  });

  test('DELETE /{groupId}/members/me — 그룹 나가기', async () => {
    await withdrawGroup(GROUP_ID);
    expect(mockApi.delete).toHaveBeenCalledWith(`/api/v1/groups/${GROUP_ID}/members/me`);
  });

  test('공지 4종 — 목록·작성·수정·삭제', async () => {
    const body = { title: '제목', content: '본문' };
    await getAnnouncements(GROUP_ID);
    await createAnnouncement(GROUP_ID, body);
    await updateAnnouncement(GROUP_ID, NOTICE_ID, body);
    await deleteAnnouncement(GROUP_ID, NOTICE_ID);

    const base = `/api/v1/groups/${GROUP_ID}/announcements`;
    expect(mockApi.get).toHaveBeenCalledWith(base);
    expect(mockApi.post).toHaveBeenCalledWith(base, body);
    expect(mockApi.put).toHaveBeenCalledWith(`${base}/${NOTICE_ID}`, body);
    expect(mockApi.delete).toHaveBeenCalledWith(`${base}/${NOTICE_ID}`);
  });
});

describe('groupErrorCode', () => {
  test.each([
    ['GUEST_FORBIDDEN', 403],
    ['ALREADY_MEMBER', 409],
    ['ROOM_FULL', 409],
    ['NOT_FOUND', 404],
    ['MEMBER_ONLY', 403],
    ['HOST_WITHDRAW', 400],
  ])('서버 enum 이름 %s 를 그대로 돌려준다', (code, status) => {
    expect(groupErrorCode(axiosErrorWith(status, { code, message: '...' }))).toBe(code);
  });

  test('같은 409라도 code로 구분된다 — status만으론 불가능한 분기', () => {
    const already = groupErrorCode(axiosErrorWith(409, { code: 'ALREADY_MEMBER', message: '' }));
    const full = groupErrorCode(axiosErrorWith(409, { code: 'ROOM_FULL', message: '' }));
    expect(already).not.toBe(full);
  });

  test('바디에 code가 없으면 null', () => {
    expect(groupErrorCode(axiosErrorWith(500, { message: 'oops' }))).toBeNull();
  });

  test('응답 자체가 없으면(네트워크 오류) null', () => {
    expect(groupErrorCode(new AxiosError('Network Error'))).toBeNull();
  });

  test('axios 에러가 아니면 null', () => {
    expect(groupErrorCode(new Error('boom'))).toBeNull();
    expect(groupErrorCode(null)).toBeNull();
  });
});
