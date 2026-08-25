// 라이브 세션 레코드의 직렬화 경로 — GROMO-1604 코드리뷰 7차.
//
// 여기서 잠그는 건 하나다: **읽기와 쓰기 사이에 남이 끼어들지 못한다.**
//
// 이 키는 쓰는 곳이 여럿이라(세션 화면의 주기 저장 · 정상 종료의 삭제 · 화면 이탈 표식 ·
// 다음 실행의 고아 정산), "읽은 값과 같으면 쓴다"로는 못 막는다 — getItem 과 setItem 이
// 별개의 비동기 호출이라 그 사이가 열려 있다. 실제로 그 창에서 옛 고아 레코드가 새 세션의
// 복구 레코드를 덮은 뒤 지워 버리는 경로가 있었다.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { STORAGE_KEYS } from '@/types/storage';
import {
  readLiveSession,
  removeLiveSession,
  updateLiveSession,
  writeLiveSession,
} from './liveSessionStore';
import type { LiveFocusSession } from './types';

const base: LiveFocusSession = {
  subjectId: 's1',
  subjectName: '수학',
  elapsed: 10,
  startedAt: '2026-08-09T10:00:00+09:00',
  updatedAt: '2026-08-09T10:00:10+09:00',
  userId: 'me',
};

beforeEach(async () => {
  await AsyncStorage.clear();
});

test('update 도중 들어온 write 가 끼어들지 않는다', async () => {
  await writeLiveSession(base);

  // update 의 읽기와 쓰기 사이에 다른 쓰기를 밀어 넣는다.
  const updating = updateLiveSession((rec) => ({ ...rec!, shieldActive: true }));
  const writing = writeLiveSession({ ...base, subjectId: 's2', elapsed: 99 });
  await Promise.all([updating, writing]);

  // 나중에 큐에 들어간 write 가 최종값이어야 한다 — update 가 그 뒤에 덮으면 s2 가 사라진다.
  const final = await readLiveSession();
  expect(final).toMatchObject({ subjectId: 's2', elapsed: 99 });
});

test('update 는 자기가 읽은 값 위에서 고친다', async () => {
  await writeLiveSession(base);

  // 앞선 write 가 먼저 큐에 들어가면, update 는 **그 결과**를 읽어야 한다.
  const writing = writeLiveSession({ ...base, elapsed: 50 });
  const updating = updateLiveSession((rec) => ({ ...rec!, shieldActive: true }));
  await Promise.all([writing, updating]);

  const final = await readLiveSession();
  expect(final).toMatchObject({ elapsed: 50, shieldActive: true });
});

test('update 가 null 을 주면 아무것도 쓰지 않는다', async () => {
  await writeLiveSession(base);

  await updateLiveSession(() => null);

  expect(await readLiveSession()).toMatchObject({ elapsed: 10 });
});

describe('삭제는 그 레코드일 때만', () => {
  test('조건이 맞으면 지운다', async () => {
    await writeLiveSession(base);

    await removeLiveSession((rec) => rec.startedAt === base.startedAt);

    expect(await AsyncStorage.getItem(STORAGE_KEYS.focusLiveSession)).toBeNull();
  });

  // 정산이 끝난 사이 새 세션이 자기 레코드를 썼다면 건드리면 안 된다 —
  // 그 세션이 강제 종료될 때 복구할 기록이 사라진다.
  test('다른 세션의 레코드는 남긴다', async () => {
    await writeLiveSession({ ...base, startedAt: '2026-08-09T11:00:00+09:00' });

    await removeLiveSession((rec) => rec.startedAt === base.startedAt);

    expect(await readLiveSession()).toMatchObject({ startedAt: '2026-08-09T11:00:00+09:00' });
  });
});

// 앞선 작업이 실패해도 뒤가 막히면 안 된다 — 한 번의 저장 실패로 세션이 통째로 멈춘다.
test('앞선 작업이 실패해도 다음 작업은 돈다', async () => {
  // AsyncStorage 목은 이미 jest.fn 이라 spyOn+restore 로는 원래 구현이 안 돌아온다.
  // 한 번만 실패시키는 mockImplementationOnce 로 그 다음 호출은 자동으로 원래 구현이 된다.
  (AsyncStorage.setItem as jest.Mock).mockImplementationOnce(() =>
    Promise.reject(new Error('disk')),
  );

  await expect(writeLiveSession(base)).rejects.toThrow('disk');
  await writeLiveSession({ ...base, elapsed: 77 });

  expect(await readLiveSession()).toMatchObject({ elapsed: 77 });
});
