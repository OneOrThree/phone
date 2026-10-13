// 섬 홈 잡지 배달(GROMO-2289 · B2) — 한 번만 뜸 · 뜨는 순간 받음 PUT · 구경·집중·다른 안내 중이면 안 뜸 · 우체통 있는 섬은
// [우체통 열어보기], 없는 섬은 [잡지 펼치기]/[나중에 읽기](deferred) · 우체통 없는 섬의 잡지 물건(누르기·길게 누르기·빨간 점).
// 오늘 호 캐시(useMagazineToday)도 같이 본다. 서버 API(magazine.ts)는 목이다.
import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import * as api from '@/services/api/magazine';
import { saveSession } from '@/services/api/session';
import type { MagazineToday } from '@/services/api/magazine';
import { MagazineHomeLayer } from './MagazineDelivery';
import {
  cachedMagazineToday,
  magazineUnread,
  nextMagazineCheck,
  resetMagazineToday,
  sendReceipt,
  useMagazineToday,
} from './useMagazineToday';

jest.mock('@/services/api/magazine', () => ({
  ...jest.requireActual('@/services/api/magazine'),
  getMagazineToday: jest.fn(),
  getMagazineIssues: jest.fn(),
  putMagazineReceipt: jest.fn(),
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
const getToday = api.getMagazineToday as jest.Mock;
const getIssues = api.getMagazineIssues as jest.Mock;
const putReceipt = api.putMagazineReceipt as jest.Mock;

const issue = {
  issueId: 'iss-19',
  issueNo: 19,
  issueDate: '2026-10-14',
  publishedAt: '2026-10-13T22:00:00Z',
  current: true,
};
const receipt = (over = {}) => ({
  place: 'ISLAND' as const,
  receivedAt: '2026-10-13T23:00:00Z',
  deferredAt: null,
  openedAt: null,
  ...over,
});
const fresh: MagazineToday = { issue, receipt: null };

beforeEach(() => {
  jest.clearAllMocks();
  resetMagazineToday();
  putReceipt.mockImplementation(async (_id: string, body: { deferred?: boolean }) =>
    receipt(body.deferred ? { deferredAt: 'later' } : {}),
  );
  getIssues.mockResolvedValue([]);
});

const layer = (over: Partial<React.ComponentProps<typeof MagazineHomeLayer>> = {}) => (
  <MagazineHomeLayer today={fresh} hasMailbox blocked={false} go={jest.fn()} {...over} />
);

test('오늘 호를 아직 안 받았으면 펠리컨이 한 번 뜨고, 뜨는 순간 받음(ISLAND)을 보낸다', async () => {
  const go = jest.fn();
  const screen = await render(layer({ go }));
  expect(screen.getByText('우체통에 고양이 잡지가 왔어요!')).toBeTruthy();
  expect(putReceipt).toHaveBeenCalledWith('iss-19', { place: 'ISLAND' });
  // 받음이 적혀 receipt 가 생겨도 사용자가 고를 때까지 안내는 남는다
  await screen.rerender(layer({ go, today: { issue, receipt: receipt() } }));
  expect(screen.getByText('우체통에 고양이 잡지가 왔어요!')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('magazine-delivery-open'));
  expect(go).toHaveBeenCalledWith('mail');
  expect(screen.queryByText('우체통에 고양이 잡지가 왔어요!')).toBeNull();
  expect(putReceipt).toHaveBeenCalledTimes(1);
  // 우체통이 있는 섬에는 홈 잡지 물건이 없다
  expect(screen.queryByTestId('magazine-home-object')).toBeNull();
});

test('이미 받았거나 · 지난 호뿐이거나 · 구경·집중·다른 안내 중이면 뜨지 않는다', async () => {
  for (const over of [
    { today: { issue, receipt: receipt() } },
    { today: { issue: { ...issue, current: false }, receipt: null } },
    { today: null },
    { blocked: true },
  ]) {
    const screen = await render(layer(over));
    expect(screen.queryByText('우체통에 고양이 잡지가 왔어요!')).toBeNull();
    await screen.unmount();
  }
  expect(putReceipt).not.toHaveBeenCalled();
});

test('우체통이 없는 섬 — [잡지 펼치기] 는 오늘 호를, [나중에 읽기] 는 나중에(deferred)를 적는다', async () => {
  const go = jest.fn();
  const screen = await render(layer({ go, hasMailbox: false }));
  expect(screen.getByText('고양이 잡지 왔어요!')).toBeTruthy();
  await fireEvent.press(screen.getByText('나중에 읽기'));
  expect(putReceipt).toHaveBeenLastCalledWith('iss-19', { place: 'ISLAND', deferred: true });
  // 받음 기록이 아직 화면에 안 왔어도(receipt null) 같은 호를 다시 띄우지 않는다
  expect(putReceipt).toHaveBeenCalledTimes(2);
  expect(screen.queryByText('고양이 잡지 왔어요!')).toBeNull();
  await screen.unmount();

  // 같은 세션에서 홈에 다시 와도(받음 기록이 아직 안 왔어도) 같은 호를 또 알리지 않는다
  const back = await render(layer({ go, hasMailbox: false }));
  expect(back.queryByText('고양이 잡지 왔어요!')).toBeNull();
  expect(putReceipt).toHaveBeenCalledTimes(2);
  await back.unmount();

  resetMagazineToday(); // 앱을 다시 켠 것처럼
  const again = await render(layer({ go, hasMailbox: false }));
  await fireEvent.press(again.getByTestId('magazine-delivery-open'));
  expect(go).toHaveBeenCalledWith('magazine', 'iss-19');
});

test('받음을 보내는 사이 세션이 바뀌면 그 기록을 새 세션의 오늘 호 캐시에 넣지 않는다', async () => {
  getToday.mockResolvedValue({ issue, receipt: null });
  const probe = await render(<Probe active />);
  await waitFor(() => expect(cachedMagazineToday()?.issue?.issueId).toBe('iss-19'));
  let finish: (v: unknown) => void = () => {};
  putReceipt.mockReturnValueOnce(new Promise((resolve) => (finish = resolve)));
  const sending = sendReceipt('iss-19', { place: 'ISLAND', opened: true });
  // 다른 계정으로 바뀌고, 새 세션이 같은 호를 읽어 둔다
  await act(async () => {
    await saveSession({ accessToken: 'B', refreshToken: 'B', userId: 'other' });
  });
  await probe.rerender(<Probe active={false} />);
  await probe.rerender(<Probe active />);
  await waitFor(() => expect(cachedMagazineToday()?.receipt).toBeNull());
  await act(async () => {
    finish(receipt({ openedAt: 'old-account' }));
    await sending;
  });
  expect(cachedMagazineToday()?.receipt).toBeNull();
});

test('우체통이 없는 섬의 잡지 물건 — 안 읽었으면 빨간 점, 누르면 오늘 호, 길게 누르면 꽂이', async () => {
  const go = jest.fn();
  const today = { issue, receipt: receipt() };
  const screen = await render(layer({ go, hasMailbox: false, today }));
  const object = screen.getByTestId('magazine-home-object');
  expect(object.props.accessibilityLabel).toBe('고양이 잡지 19호, 아직 안 읽음');
  // 왼쪽 아래 건설 카드와 겹치지 않게 「집중 시작」 버튼 위(오른쪽)에 둔다
  const place = StyleSheet.flatten(object.props.style);
  expect(place.left).toBeUndefined();
  expect(place.right).toBeGreaterThan(0);
  expect(screen.getByTestId('magazine-home-object-dot')).toBeTruthy();
  await fireEvent.press(object);
  expect(go).toHaveBeenCalledWith('magazine', 'iss-19');
  await fireEvent(object, 'longPress');
  await waitFor(() => expect(screen.getByTestId('magazine-rack')).toBeTruthy());
  expect(getIssues).toHaveBeenCalled();

  await screen.rerender(
    layer({ go, hasMailbox: false, today: { issue, receipt: receipt({ openedAt: 'x' }) } }),
  );
  expect(screen.queryByTestId('magazine-home-object-dot')).toBeNull();
  // 구경·집중 중에는 물건도 감춘다
  await screen.rerender(layer({ go, hasMailbox: false, today, blocked: true }));
  expect(screen.queryByTestId('magazine-home-object')).toBeNull();
});

function Probe({ active }: { active: boolean }) {
  const { today } = useMagazineToday(active);
  return <Text testID="probe">{magazineUnread(today) ? 'unread' : 'read'}</Text>;
}

test('useMagazineToday — 보일 때 읽고, 읽음을 보내면 같은 캐시를 보는 화면이 바로 바뀐다', async () => {
  getToday.mockResolvedValue({ issue, receipt: receipt() });
  const screen = await render(<Probe active={false} />);
  expect(getToday).not.toHaveBeenCalled();
  await screen.rerender(<Probe active />);
  await waitFor(() => expect(screen.getByTestId('probe').props.children).toBe('unread'));
  putReceipt.mockResolvedValueOnce(receipt({ openedAt: 'now' }));
  await act(async () => {
    await sendReceipt('iss-19', { place: 'ISLAND', opened: true });
  });
  expect(screen.getByTestId('probe').props.children).toBe('read');
  expect(cachedMagazineToday()?.receipt?.openedAt).toBe('now');
});

test('오늘 호를 못 읽으면 아무것도 띄우지 않는다(서버에 잡지가 아직 없음)', async () => {
  getToday.mockRejectedValue(new Error('404'));
  const screen = await render(<Probe active />);
  await act(async () => {});
  expect(screen.getByTestId('probe').props.children).toBe('read');
});

test('nextMagazineCheck — 오늘 호를 들고 있으면 다음 07시 조금 뒤, 07시가 지났는데 아직 없으면 10분 뒤', () => {
  const kst = (s: string) => Date.parse(`${s}+09:00`);
  const yesterday = { issue: { ...issue, issueDate: '2026-10-13' }, receipt: null };
  const todays = { issue: { ...issue, issueDate: '2026-10-14' }, receipt: null };
  // 06:50 · 어제 호 → 오늘 07:01
  expect(nextMagazineCheck(kst('2026-10-14T06:50:00'), yesterday)).toBe(kst('2026-10-14T07:01:00'));
  // 07:30 · 아직 어제 호(발행 지연) → 10분 뒤
  expect(nextMagazineCheck(kst('2026-10-14T07:30:00'), yesterday)).toBe(kst('2026-10-14T07:40:00'));
  expect(nextMagazineCheck(kst('2026-10-14T07:30:00'), null)).toBe(kst('2026-10-14T07:40:00'));
  // 07:30 · 오늘 호 → 내일 07:01
  expect(nextMagazineCheck(kst('2026-10-14T07:30:00'), todays)).toBe(kst('2026-10-15T07:01:00'));
});

test('홈을 켜 둔 채 07시를 넘기면 다시 읽어 새 호 펠리컨이 뜬다', async () => {
  jest.useFakeTimers({ now: Date.parse('2026-10-14T06:59:00+09:00') });
  try {
    getToday
      .mockResolvedValueOnce({
        issue: { ...issue, issueDate: '2026-10-13', issueId: 'iss-18', issueNo: 18 },
        receipt: receipt(),
      })
      .mockResolvedValueOnce({ issue, receipt: null });
    function Home() {
      const { today } = useMagazineToday(true);
      return <MagazineHomeLayer today={today} hasMailbox blocked={false} go={jest.fn()} />;
    }
    const screen = await render(<Home />);
    await act(async () => {});
    expect(screen.queryByText('우체통에 고양이 잡지가 왔어요!')).toBeNull();
    await act(async () => {
      jest.advanceTimersByTime(2 * 60_000 + 1000); // 07:01:01
    });
    await waitFor(() => expect(screen.getByText('우체통에 고양이 잡지가 왔어요!')).toBeTruthy());
    expect(getToday).toHaveBeenCalledTimes(2);
  } finally {
    jest.useRealTimers();
  }
});

test('우체통 없는 섬은 발행이 늦어 지난 호만 있어도 잡지 물건을 두고 길게 누르면 꽂이 — 펠리컨·점은 없다', async () => {
  const go = jest.fn();
  const stale = { issue: { ...issue, current: false }, receipt: null };
  const screen = await render(layer({ go, hasMailbox: false, today: stale }));
  expect(screen.queryByText('고양이 잡지 왔어요!')).toBeNull();
  expect(screen.queryByTestId('magazine-home-object-dot')).toBeNull();
  const object = screen.getByTestId('magazine-home-object');
  await fireEvent(object, 'longPress');
  await waitFor(() => expect(screen.getByTestId('magazine-rack')).toBeTruthy());
  await fireEvent.press(object);
  expect(go).toHaveBeenCalledWith('magazine', 'iss-19');
  expect(putReceipt).not.toHaveBeenCalled();
});
