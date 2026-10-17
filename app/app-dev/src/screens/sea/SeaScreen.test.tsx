import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { SeaScreen, SeaScreenProps } from './SeaScreen';
import { SeaParticipant, SeaVoyage, seaPeerPages } from './seaModel';
import { duckPreviewArt } from './seaRewardCatalog';

jest.mock('@/components/CatSprite', () => ({ CatSprite: () => null }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

const people: SeaParticipant[] = Array.from({ length: 10 }, (_, index) => ({
  userId: String(index),
  name: `고양이${index}`,
  color: 'black',
  focusing: index > 0,
  activeSeconds: 42,
}));
const voyage: SeaVoyage = {
  sessionId: 'session-1',
  destinationId: 'island-1',
  destinationName: '별고래섬',
  subject: '독서',
  activeSeconds: 1800,
  requiredSeconds: 1800,
  canDisembark: true,
};
const props = (): SeaScreenProps => ({
  self: people[0],
  participants: people,
  voyage: null,
  result: null,
  onFinish: jest.fn(async () => {}),
  onExplore: jest.fn(async () => {}),
  onTelescope: jest.fn(),
  onMessage: jest.fn(async () => {}),
  onEmote: jest.fn(async () => {}),
});

test.each([1, 5, 10])('%i명 방은 자기 자신을 제외한 모든 사람에게 도달할 수 있다', (count) => {
  const pages = seaPeerPages(people.slice(0, count), '0');
  expect(pages.flat().map((person) => person.userId)).toEqual(
    people.slice(1, count).map((person) => person.userId),
  );
  expect(pages.every((page) => page.length <= 4)).toBe(true);
});

test('시간만 도달하면 자동 종료하거나 하선 버튼으로 바꾸지 않는다', async () => {
  const p = props();
  const screen = await render(<SeaScreen {...p} voyage={{ ...voyage, canDisembark: false }} />);
  expect(screen.getByText('도착 확인 중…')).toBeTruthy();
  expect(screen.getByLabelText('항해 그만두기')).toBeTruthy();
  expect(p.onFinish).not.toHaveBeenCalled();
});

test('서버가 도착을 알려도 집중 시간이 계속 갱신되며 하선할 때만 종료를 요청한다', async () => {
  const p = props();
  const screen = await render(<SeaScreen {...p} voyage={voyage} />);
  await screen.rerender(<SeaScreen {...p} voyage={{ ...voyage, activeSeconds: 2050 }} />);
  expect(screen.getByText('00:34:10')).toBeTruthy();
  expect(p.onFinish).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByLabelText('섬에 내리기'));
  expect(p.onFinish).toHaveBeenCalledWith('session-1', 'disembark');
  // 요청 성공만으로 가짜 보상/결과를 만들지 않는다. 정산 스냅샷이 필요하다.
  expect(screen.queryByTestId('sea-arrival-result')).toBeNull();
});

test('하선 중 중복 탭을 막고 실패하면 같은 세션에서 재시도할 수 있다', async () => {
  let reject!: (error: Error) => void;
  const p = props();
  p.onFinish = jest.fn(
    () =>
      new Promise<void>((_resolve, fail) => {
        reject = fail;
      }),
  );
  const screen = await render(<SeaScreen {...p} voyage={voyage} />);
  await fireEvent.press(screen.getByLabelText('섬에 내리기'));
  await fireEvent.press(screen.getByLabelText('처리 중…'));
  expect(p.onFinish).toHaveBeenCalledTimes(1);
  await act(async () => reject(new Error('network')));
  expect(screen.getByText('연결이 원활하지 않아요. 다시 눌러 시도해 주세요.')).toBeTruthy();
  expect(screen.queryByTestId('sea-arrival-result')).toBeNull();
  await fireEvent.press(screen.getByLabelText('섬에 내리기'));
  expect(p.onFinish).toHaveBeenCalledTimes(2);
});

test('도착 전 종료는 확인 후 실행하고 취소하면 집중을 유지한다', async () => {
  const p = props();
  const screen = await render(
    <SeaScreen {...p} voyage={{ ...voyage, activeSeconds: 60, canDisembark: false }} />,
  );
  await fireEvent.press(screen.getByLabelText('항해 그만두기'));
  expect(p.onFinish).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByLabelText('계속 집중하기'));
  expect(p.onFinish).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByLabelText('항해 그만두기'));
  await fireEvent.press(screen.getByLabelText('항해 그만두기'));
  expect(p.onFinish).toHaveBeenCalledWith('session-1', 'stop');
});

test('미확인 결과를 직접 복원하며 결과 확인 성공 전 화면과 보상을 유지한다', async () => {
  const p = props();
  p.onExplore = jest.fn(async () => {
    throw new Error('network');
  });
  const result = {
    recordId: 'record-1',
    destinationId: 'island-1',
    destinationName: '별고래섬',
    activeSeconds: 2050,
    reward: { itemId: 'duck', name: '오리 인형' },
  };
  const screen = await render(
    <SeaScreen {...p} result={result} rewardCatalog={{ duck: duckPreviewArt }} />,
  );
  expect(screen.getByText('34분 10초')).toBeTruthy();
  expect(screen.getByText('오리 인형')).toBeTruthy();
  expect(screen.queryByLabelText('망원경')).toBeNull();
  await fireEvent.press(screen.getByLabelText('섬 둘러보기'));
  expect(p.onExplore).toHaveBeenCalledWith(result);
  expect(screen.getByTestId('sea-arrival-result')).toBeTruthy();
  expect(p.onFinish).not.toHaveBeenCalled();
});

test('보상이 없거나 모르는 ID이면 예시 오리를 지급한 것처럼 표시하지 않는다', async () => {
  const p = props();
  const result = {
    recordId: 'record-1',
    destinationId: 'island-1',
    destinationName: '별고래섬',
    activeSeconds: 60,
    reward: null,
  };
  const screen = await render(<SeaScreen {...p} result={result} />);
  expect(screen.getByText('이번 항해에서 건진 아이템은 없어요')).toBeTruthy();
  await screen.rerender(
    <SeaScreen
      {...p}
      result={{ ...result, reward: { itemId: 'unknown', name: '서버가 준 모자' } }}
    />,
  );
  expect(screen.getByText('서버가 준 모자')).toBeTruthy();
  expect(screen.queryByText('오리 인형')).toBeNull();
});

test('스와이프로 마지막 참여자에 도달하고 드래그 직후에는 카드가 열리지 않는다', async () => {
  const screen = await render(<SeaScreen {...props()} />);
  const scroll = screen.getByTestId('sea-participants');
  await fireEvent(scroll, 'scrollBeginDrag');
  await fireEvent.scroll(scroll, { nativeEvent: { contentOffset: { x: 804, y: 0 } } });
  const last = screen.getByTestId('sea-person-9');
  await fireEvent.press(last);
  expect(screen.queryByLabelText('닫기')).toBeNull();
  expect(screen.getByText('3 / 3')).toBeTruthy();
});

test('스냅샷 순서 갱신은 선택한 페이지를 초기화하지 않는다', async () => {
  const p = props();
  const screen = await render(<SeaScreen {...p} />);
  await fireEvent.press(screen.getByLabelText('다음 참여자 보기'));
  await screen.rerender(<SeaScreen {...p} participants={[...people].reverse()} />);
  expect(screen.getByText('2 / 3')).toBeTruthy();
  expect(screen.getByTestId('sea-person-5')).toBeTruthy();
});

test('연속 다음 버튼은 스크롤 중간 이벤트 때문에 이전 페이지로 되돌아가지 않는다', async () => {
  const screen = await render(<SeaScreen {...props()} />);
  await fireEvent.press(screen.getByLabelText('다음 참여자 보기'));
  await fireEvent.scroll(screen.getByTestId('sea-participants'), {
    nativeEvent: { contentOffset: { x: 80, y: 0 } },
  });
  expect(screen.getByText('2 / 3')).toBeTruthy();
  await fireEvent.press(screen.getByLabelText('다음 참여자 보기'));
  await fireEvent.scroll(screen.getByTestId('sea-participants'), {
    nativeEvent: { contentOffset: { x: 804, y: 0 } },
  });
  expect(screen.getByText('3 / 3')).toBeTruthy();
});

test('게스트와 한마디 쿨다운 상태에서는 저장 요청을 보낼 수 없다', async () => {
  const p = props();
  const screen = await render(<SeaScreen {...p} guest />);
  await fireEvent.press(screen.getByLabelText('＋ 한마디 쓰기'));
  expect(screen.getByText('로그인하면 다른 고양이에게 한마디를 남길 수 있어요.')).toBeTruthy();
  expect(screen.queryByLabelText('한마디 띄우기')).toBeNull();
  await screen.rerender(<SeaScreen {...p} messageCooldownSeconds={299} />);
  expect(screen.getByText('5분 뒤에 다시 쓸 수 있어요')).toBeTruthy();
  expect(p.onMessage).not.toHaveBeenCalled();
});
