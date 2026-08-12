import type { InternalAxiosRequestConfig } from 'axios';
import { findHandler } from './handlers';

const GROUP_ID = '10000000-0000-0000-0000-000000000001';

function config(url: string, params?: Record<string, string>): InternalAxiosRequestConfig {
  return { url, method: 'get', headers: {}, params } as InternalAxiosRequestConfig;
}

function response(url: string, params?: Record<string, string>): unknown {
  const handler = findHandler('get', url);
  expect(handler).toBeDefined();
  return handler?.respond(config(url, params));
}

test('그룹 목록은 가로 덱 검증용 6개 그룹을 반환한다', () => {
  const groups = response('/api/v1/groups') as Array<{ groupId: string; currentMembers: number }>;

  expect(groups).toHaveLength(6);
  expect(groups[0]).toMatchObject({ groupId: GROUP_ID, currentMembers: 7 });
});

test('그룹 카드 뒷면의 세 read API를 모두 mock으로 처리한다', () => {
  const detail = response(`/api/v1/groups/${GROUP_ID}`) as {
    members: Array<{ nickname: string }>;
    maxMembers: number;
  };
  const announcements = response(`/api/v1/groups/${GROUP_ID}/announcements`) as Array<{
    content: string;
  }>;
  const challenges = response(`/api/v1/groups/${GROUP_ID}/challenges`) as Array<{
    durationMinutes: number;
    windowStart: string | null;
    windowEnd: string | null;
    memberProgress: Array<{ progressMinutes: number }> | null;
  }>;

  expect(detail.members).toHaveLength(7);
  expect(detail.maxMembers).toBe(10);
  expect(detail.members.slice(0, 5).map((member) => member.nickname)).toEqual([
    '나',
    '아침루틴',
    '꾸준한사람',
    '수학러',
    '쉬는중',
  ]);
  expect(announcements).toEqual([
    expect.objectContaining({ content: '이번 주 인증은 일요일 자정까지예요.' }),
  ]);
  expect(challenges).toHaveLength(2);
  expect(challenges).toEqual([
    expect.objectContaining({
      durationMinutes: 60,
      memberProgress: [expect.objectContaining({ progressMinutes: 42 }), expect.any(Object)],
    }),
    expect.objectContaining({
      durationMinutes: 30,
      windowStart: '06:00:00',
      windowEnd: '08:00:00',
      memberProgress: [expect.objectContaining({ progressMinutes: 18 })],
    }),
  ]);
});

test('그룹 카드 기준 그룹의 멤버 7명 중 5명을 집중 중으로 반환한다', () => {
  const ranking = response('/api/v1/league/me/ranking') as Array<{
    userId: string;
    isFocusing?: boolean;
  }>;
  const detail = response(`/api/v1/groups/${GROUP_ID}`) as {
    members: Array<{ userId: string }>;
  };
  const memberIds = new Set(detail.members.map((member) => member.userId));

  expect(
    ranking.filter((member) => memberIds.has(member.userId) && member.isFocusing),
  ).toHaveLength(5);
});

test('그룹 챌린지 내역도 실서버로 빠지지 않고 mock 기록을 반환한다', () => {
  const history = response(`/api/v1/groups/${GROUP_ID}/challenge-history`) as {
    content: Array<{ sessionDate: string }>;
    hasNext: boolean;
  };

  expect(history.content.map((item) => item.sessionDate)).toEqual(['2026-08-11', '2026-08-10']);
  expect(history.hasNext).toBe(false);
});

test('게스트 온보딩에 필요한 사용자 read API를 mock으로 반환한다', () => {
  const profile = response('/api/v1/users/me') as { nickname: string };
  const occupations = response('/api/v1/occupations') as Array<{ code: string }>;

  expect(profile.nickname).toBe('QA 게스트');
  expect(occupations.map((item) => item.code)).toContain('FOCUS_BUILDING');
});

test('그룹 검색은 공개방만 이름으로 필터링한다', () => {
  const groups = response('/api/v1/groups/search', { query: '주말' }) as unknown[];
  const publicGroups = response('/api/v1/groups/search', { query: '집중' }) as Array<{
    name: string;
  }>;

  expect(groups).toEqual([]);
  expect(publicGroups.map((group) => group.name)).toContain('새벽 6시 기상 집중단');
});

test('집중 과목과 직군별 추천 과목을 mock으로 반환한다', () => {
  const tags = response('/api/v1/tag') as Array<{ name: string }>;
  const defaults = response('/api/v1/tag/defaults', { occupation: 'CODING' }) as {
    occupation: string;
    tags: Array<{ name: string }>;
  };

  expect(tags.map((tag) => tag.name)).toEqual([
    '노동법',
    '행정쟁송법',
    '사회보험법',
    '민법',
    '영어',
  ]);
  expect(defaults.occupation).toBe('CODING');
  expect(defaults.tags.map((tag) => tag.name)).toEqual(['알고리즘', '프로젝트', 'CS 공부']);
});
