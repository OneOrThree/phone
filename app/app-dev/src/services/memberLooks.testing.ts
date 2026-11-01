/* eslint-env jest */
import { act } from '@testing-library/react-native';
import { clearSession, saveSession } from './api/session';
import { memberLooks } from './memberLooks';

type FakeLook = { catColor: string | null; appearance?: { head?: string | null } };

/**
 * 테스트 전용. 아바타가 실제 경로(세션 → memberLooks → request → fetch)로 털색·착용을 읽게 하고 서버 자리의 fetch 만
 * 대신한다. 서버(MemberAppearanceQuery)처럼 `users` 에 있는 id 만 members 로, 나머지는 — 사용자 id 가 아닌 신청 id 같은
 * 값도 — hiddenUserIds 로 돌려준다. `failing` 이면 모든 조회가 500 이다. `asked` 는 조회된 id 를 순서대로 모은다.
 */
export function fakeMemberLooksServer() {
  const realFetch = global.fetch;
  const asked: string[] = [];
  const reply = (status: number, body: unknown) =>
    ({
      ok: status < 400,
      status,
      headers: { get: () => null },
      text: async () => JSON.stringify(body),
    }) as unknown as Response;
  return {
    asked,
    async start(users: Record<string, FakeLook>, failing = false) {
      asked.length = 0;
      memberLooks.clear();
      await clearSession();
      await saveSession({ accessToken: 'AT', refreshToken: 'RT', userId: 'viewer' });
      global.fetch = jest.fn(async (url: string) => {
        if (!url.includes('/me/member-appearances?userIds=')) return reply(404, null);
        const ids = decodeURIComponent(url.split('userIds=')[1]).split(',');
        asked.push(...ids);
        if (failing) return reply(500, null);
        const data = {
          members: ids
            .filter((id) => users[id])
            .map((userId) => ({
              userId,
              catColor: users[userId].catColor,
              appearance: {
                head: null,
                neck: null,
                shoes: null,
                version: 1,
                ...users[userId].appearance,
              },
            })),
          hiddenUserIds: ids.filter((id) => !users[id]),
        };
        return reply(200, { data });
      }) as typeof global.fetch;
    },
    async stop() {
      global.fetch = realFetch;
      // 아직 그려진 아바타가 있어도 캐시·세션을 비우는 갱신이 act 밖으로 새지 않게 한다
      await act(async () => {
        memberLooks.clear();
        await clearSession();
      });
    },
  };
}
