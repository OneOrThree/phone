import type { InternalAxiosRequestConfig } from 'axios';
import { findHandler } from './handlers';
import { MOCK_GUEST_USER_ID } from './fixtures/session';

const GROUP_ID = '10000000-0000-0000-0000-000000000001';
const OVERFLOW_GROUP_ID = '10000000-0000-0000-0000-000000000002';

function config(url: string, params?: Record<string, string>): InternalAxiosRequestConfig {
  return { url, method: 'get', headers: {}, params } as InternalAxiosRequestConfig;
}

function response(url: string, params?: Record<string, string>): unknown {
  const handler = findHandler('get', url);
  expect(handler).toBeDefined();
  return handler?.respond(config(url, params));
}

function postResponse(url: string): unknown {
  const handler = findHandler('post', url);
  expect(handler).toBeDefined();
  return handler?.respond({ ...config(url), method: 'post' });
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

test('긴 카드 내부 스크롤 검증용 그룹은 챌린지 4개를 반환한다', () => {
  const challenges = response(`/api/v1/groups/${OVERFLOW_GROUP_ID}/challenges`) as Array<{
    id: string;
  }>;

  expect(challenges.map((challenge) => challenge.id)).toEqual([
    `${OVERFLOW_GROUP_ID}-focus-60`,
    `${OVERFLOW_GROUP_ID}-morning-window`,
    `${OVERFLOW_GROUP_ID}-resume-90`,
    `${OVERFLOW_GROUP_ID}-interview-45`,
  ]);
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

test('게스트 앱 부트스트랩의 재화와 장비 요청도 mock 안에서 완료한다', () => {
  const currency = response('/api/v1/currency');
  const equipment = response(`/api/v1/equipment/${MOCK_GUEST_USER_ID}`);

  expect(currency).toBe(500);
  expect(equipment).toEqual([]);
});

test('그룹 카드 초대 버튼에 서버 형식의 공유 링크를 반환한다', () => {
  expect(postResponse(`/api/v1/groups/${GROUP_ID}/invite-link`)).toEqual({
    slug: 'ab23cd45',
    url: `https://link.oneorthree.world/l/ab23cd45?g=${GROUP_ID}`,
  });
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
