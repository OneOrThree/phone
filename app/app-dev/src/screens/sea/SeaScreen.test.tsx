import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SeaScreen, SeaScreenProps } from './SeaScreen';
import { SeaArrival, SeaParticipant, SeaVoyage, seaPeerPages } from './seaModel';
import { duckPreviewArt } from './seaRewardCatalog';
import { SeaRaft } from './SeaRaft';
import { applyLocalePref } from '@/i18n';

jest.mock('@/components/CatSprite', () => ({ CatSprite: () => null }));
jest.mock('./SeaRaft', () => ({ SeaRaft: jest.fn(() => null) }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: jest.fn(() => ({ top: 0, bottom: 0, left: 0, right: 0 })),
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
  onFriendRequest: jest.fn(async () => true),
});

test('유저 카드는 고양이·장착 정보·집중 시간·한마디 전체와 친구 요청을 표시한다', async () => {
  const p = props();
  const person: SeaParticipant = {
    ...people[1],
    color: 'calico',
    activeSeconds: 3661,
    message: '오늘도 내 속도로 한 걸음씩 가보자!',
    outfit: { head: 'hat', neck: null, shoes: undefined },
  };
  const screen = await render(<SeaScreen {...p} participants={[people[0], person]} />);
  await fireEvent.press(screen.getByTestId('sea-person-1'));
  expect(screen.getByText(person.message!)).toBeTruthy();
  expect(screen.getByText('집중 시간')).toBeTruthy();
  expect(screen.getByText('01:01:01')).toBeTruthy();
  expect(SeaRaft).toHaveBeenLastCalledWith(
    expect.objectContaining({ color: 'calico', focusing: true, outfit: person.outfit }),
    undefined,
  );
  expect(screen.queryByLabelText('차단하기')).toBeNull();
  await fireEvent.press(screen.getByLabelText('친구 요청'));
  expect(p.onFriendRequest).toHaveBeenCalledWith('1');
  expect(screen.getByLabelText('친구 요청 보냄')).toBeDisabled();
  await fireEvent.press(screen.getByLabelText('친구 요청 보냄'));
  expect(p.onFriendRequest).toHaveBeenCalledTimes(1);
});

test('친구 요청 중에는 중복 탭·카드 닫기를 막고 실패 후 다시 요청할 수 있다', async () => {
  let finish!: (ok: boolean) => void;
  const p = props();
  p.onFriendRequest = jest.fn(
    () =>
      new Promise<boolean>((resolve) => {
        finish = resolve;
      }),
  );
  const screen = await render(<SeaScreen {...p} />);
  await fireEvent.press(screen.getByTestId('sea-person-1'));
  await fireEvent.press(screen.getByLabelText('친구 요청'));
  await fireEvent.press(screen.getByLabelText('처리 중…'));
  await fireEvent.press(screen.getByLabelText('닫기'));
  expect(p.onFriendRequest).toHaveBeenCalledTimes(1);
  expect(screen.getByTestId('sea-participant-avatar')).toBeTruthy();
  await act(async () => finish(false));
  expect(screen.getByLabelText('친구 요청')).toBeEnabled();
  await fireEvent.press(screen.getByLabelText('친구 요청'));
  await act(async () => finish(true));
  expect(screen.getByLabelText('친구 요청 보냄')).toBeDisabled();
});

test('본인에게는 친구 요청이 없고 참가자가 떠나면 카드의 친구 요청도 없어진다', async () => {
  const p = props();
  const screen = await render(<SeaScreen {...p} />);
  await fireEvent.press(screen.getByLabelText('내 뗏목'));
  expect(screen.queryByLabelText('친구 요청')).toBeNull();
  await fireEvent.press(screen.getByLabelText('닫기'));
  await fireEvent.press(screen.getByTestId('sea-person-1'));
  await screen.rerender(
    <SeaScreen {...p} participants={people.filter((person) => person.userId !== '1')} />,
  );
  expect(screen.getByText('바다를 떠난 고양이예요')).toBeTruthy();
  expect(screen.queryByLabelText('친구 요청')).toBeNull();
});

test('게스트의 친구 요청은 로그인으로 이어지고 이전 계정의 늦은 성공을 적용하지 않는다', async () => {
  const p = props();
  const signIn = jest.fn();
  const screen = await render(<SeaScreen {...p} guest onSignIn={signIn} />);
  await fireEvent.press(screen.getByTestId('sea-person-1'));
  await fireEvent.press(screen.getByLabelText('친구 요청'));
  expect(signIn).toHaveBeenCalledTimes(1);
  expect(p.onFriendRequest).not.toHaveBeenCalled();
  let finish!: (ok: boolean) => void;
  p.onFriendRequest = jest.fn(
    () =>
      new Promise<boolean>((resolve) => {
        finish = resolve;
      }),
  );
  await screen.rerender(<SeaScreen {...p} />);
  await fireEvent.press(screen.getByLabelText('친구 요청'));
  const next = { ...p, self: { ...p.self, userId: 'new-account' } };
  await screen.rerender(<SeaScreen {...next} />);
  await act(async () => finish(true));
  await fireEvent.press(screen.getByTestId('sea-person-1'));
  expect(screen.getByLabelText('친구 요청')).toBeEnabled();
});

test('친구 요청 버튼과 집중 시간은 영어 설정도 따른다', async () => {
  applyLocalePref('en');
  try {
    const screen = await render(<SeaScreen {...props()} />);
    await fireEvent.press(screen.getByTestId('sea-person-1'));
    expect(screen.getByText('Focus time')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Add friend'));
    expect(screen.getByLabelText('Request sent')).toBeDisabled();
  } finally {
    applyLocalePref('ko');
  }
});

test.each([1, 5, 10])('%i명 방은 자기 자신을 제외한 모든 사람에게 도달할 수 있다', (count) => {
  const pages = seaPeerPages(people.slice(0, count), '0');
  expect(pages.flat().map((person) => person.userId)).toEqual(
    people.slice(1, count).map((person) => person.userId),
  );
  expect(pages.every((page) => page.length <= 5)).toBe(true);
  if (count === 10) expect(pages.map((page) => page.length)).toEqual([5, 4]);
});

test('작은 가로 화면에서는 장면 최소 높이를 해제하고 페이지와 본인을 화면 안에 둔다', async () => {
  const screen = await render(<SeaScreen {...props()} voyage={voyage} />);
  const layout = { x: 0, y: 0, width: 874, height: 402 };
  await fireEvent(screen.getByTestId('sea-screen'), 'layout', { nativeEvent: { layout } });
  await fireEvent(screen.getByTestId('sea-scene'), 'layout', { nativeEvent: { layout } });
  expect(screen.getByTestId('sea-scene')).toHaveStyle({ minHeight: 0 });
  expect(screen.getByTestId('sea-paging')).toHaveStyle({ top: 8, bottom: 'auto' });
  expect(screen.getByTestId('sea-self')).toHaveStyle({ top: 193, bottom: 'auto' });
  await fireEvent.press(screen.getByLabelText('다음 참여자 보기'));
  expect(screen.getByText('2 / 2')).toBeTruthy();
  await fireEvent(screen.getByTestId('sea-screen'), 'layout', {
    nativeEvent: { layout: { ...layout, width: 402, height: 874 } },
  });
  expect(screen.getByTestId('sea-scene')).toHaveStyle({ minHeight: 660 });
});

test('하단 행동 버튼은 좌우 안전 영역 안쪽에 배치한다', async () => {
  const insets = jest.mocked(useSafeAreaInsets);
  insets.mockReturnValue({ top: 0, bottom: 21, left: 44, right: 24 });
  try {
    const screen = await render(<SeaScreen {...props()} />);
    expect(screen.getByTestId('sea-footer')).toHaveStyle({
      paddingLeft: 64,
      paddingRight: 44,
      paddingBottom: 24,
    });
  } finally {
    insets.mockReturnValue({ top: 0, bottom: 0, left: 0, right: 0 });
  }
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
  expect(screen.getByTestId('sea-focus-clock')).toHaveTextContent('00:34:10');
  expect(screen.getByTestId('sea-self-clock')).toHaveTextContent('00:34:10');
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
  await fireEvent(screen.getByTestId('sea-footer'), 'layout', {
    nativeEvent: { layout: { width: 402, height: 144 } },
  });
  expect(screen.getByTestId('sea-paging')).toHaveStyle({ bottom: 144 });
  expect(screen.getByTestId('sea-self')).toHaveStyle({ bottom: 154 });
  await fireEvent.press(screen.getByLabelText('다음 참여자 보기'));
  expect(screen.getByText('2 / 2')).toBeTruthy();
  await fireEvent(screen.getByTestId('sea-footer'), 'layout', {
    nativeEvent: { layout: { width: 402, height: 80 } },
  });
  expect(screen.getByTestId('sea-paging')).toHaveStyle({ bottom: 88 });
  expect(screen.getByTestId('sea-self')).toHaveStyle({ bottom: 98 });
  await fireEvent.press(screen.getByLabelText('섬에 내리기'));
  expect(p.onFinish).toHaveBeenCalledTimes(2);
});

test('내 상세도 참가자 정보보다 현재 항해 과목과 시간을 사용한다', async () => {
  const p = props();
  const screen = await render(
    <SeaScreen
      {...p}
      self={{ ...p.self, focusing: false, subject: '이전 과목', activeSeconds: 42 }}
      voyage={{ ...voyage, activeSeconds: 2050 }}
    />,
  );
  await fireEvent.press(screen.getByLabelText('내 뗏목, 독서, 00:34:10'));
  expect(screen.getByText('독서')).toBeTruthy();
  expect(screen.getByText('00:34:10')).toBeTruthy();
  expect(screen.queryByText('이전 과목')).toBeNull();
  expect(screen.queryByText('바다 구경 중')).toBeNull();
});

test.each(['self', 'peer'])('비집중 %s 상세에는 이전 과목을 표시하지 않는다', async (target) => {
  const p = props();
  const screen = await render(
    <SeaScreen
      {...p}
      self={{ ...p.self, subject: '내 이전 과목' }}
      participants={people.map((person) => ({
        ...person,
        focusing: false,
        subject: '이웃 이전 과목',
      }))}
    />,
  );
  await fireEvent.press(
    target === 'self' ? screen.getByLabelText('내 뗏목') : screen.getByTestId('sea-person-1'),
  );
  expect(screen.getByText('바다 구경 중')).toBeTruthy();
  expect(screen.queryByText('내 이전 과목')).toBeNull();
  expect(screen.queryByText('이웃 이전 과목')).toBeNull();
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

test('세션 변경은 이전 요청 잠금을 해제하고 이전 완료가 새 요청을 풀지 않는다', async () => {
  const finish: Array<() => void> = [];
  const p = props();
  p.onFinish = jest.fn(() => new Promise<void>((resolve) => finish.push(resolve)));
  const screen = await render(<SeaScreen {...p} voyage={voyage} />);
  await fireEvent.press(screen.getByLabelText('섬에 내리기'));
  await screen.rerender(<SeaScreen {...p} voyage={{ ...voyage, sessionId: 'session-2' }} />);
  await fireEvent.press(screen.getByLabelText('섬에 내리기'));
  expect(p.onFinish).toHaveBeenCalledTimes(2);
  await act(async () => finish[0]());
  await fireEvent.press(screen.getByLabelText('처리 중…'));
  expect(p.onFinish).toHaveBeenCalledTimes(2);
  await act(async () => finish[1]());
  expect(screen.getByLabelText('섬에 내리기')).toBeTruthy();
});

test('미확인 결과를 직접 복원하며 결과 확인 성공 전 화면과 보상을 유지한다', async () => {
  const p = props();
  p.onExplore = jest.fn(async () => {
    throw new Error('network');
  });
  const result: SeaArrival = {
    recordId: 'record-1',
    destinationId: 'island-1',
    destinationName: '별고래섬',
    activeSeconds: 2050,
    rewards: ['duck'],
    minutesToNextTier: null,
    rewardsUnknown: false,
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
  const result: SeaArrival = {
    recordId: 'record-1',
    destinationId: 'island-1',
    destinationName: '별고래섬',
    activeSeconds: 60,
    rewards: [] as string[],
    minutesToNextTier: null,
    rewardsUnknown: false,
  };
  const screen = await render(<SeaScreen {...p} result={result} />);
  expect(screen.getByText('이번 항해에서 건진 아이템은 없어요')).toBeTruthy();
  await screen.rerender(
    <SeaScreen {...p} result={{ ...result, rewards: ['unknown'], minutesToNextTier: 25 }} />,
  );
  expect(screen.getByText('unknown')).toBeTruthy();
  expect(screen.getByText('다음 단계까지 25분')).toBeTruthy();
  expect(screen.queryByText('오리 인형')).toBeNull();
  await screen.rerender(<SeaScreen {...p} result={{ ...result, rewardsUnknown: true }} />);
  expect(screen.getByText('확인 중이에요. 인벤토리에서 확인해 주세요.')).toBeTruthy();
});

test('보상 미확인 복원은 미획득과 구분하고 정본을 받으면 획득으로 갱신한다', async () => {
  const p = props();
  const result: SeaArrival = {
    recordId: 'restored-result',
    destinationId: 'island-1',
    destinationName: '별고래섬',
    activeSeconds: 1800,
    rewards: [],
    minutesToNextTier: null,
    rewardsUnknown: true,
  };
  const screen = await render(
    <SeaScreen {...p} result={result} rewardCatalog={{ duck: duckPreviewArt }} />,
  );
  expect(screen.getByText('확인 중이에요. 인벤토리에서 확인해 주세요.')).toBeTruthy();
  expect(screen.queryByText('이번 항해에서 건진 아이템은 없어요')).toBeNull();
  await screen.rerender(
    <SeaScreen
      {...p}
      result={{ ...result, rewards: ['duck'], rewardsUnknown: false }}
      rewardCatalog={{ duck: duckPreviewArt }}
    />,
  );
  expect(screen.getByText('오리 인형')).toBeTruthy();
  expect(screen.queryByText('확인 중이에요. 인벤토리에서 확인해 주세요.')).toBeNull();
  expect(p.onFinish).not.toHaveBeenCalled();
});

test('한 정산의 여러 보상은 대표 아이템과 추가 획득 이름을 모두 표시한다', async () => {
  const p = props();
  const result: SeaArrival = {
    recordId: 'multi-reward',
    destinationId: 'island-1',
    destinationName: '별고래섬',
    activeSeconds: 7200,
    rewards: ['duck', 'scarf', 'hat'],
    minutesToNextTier: null,
    rewardsUnknown: false,
  };
  const screen = await render(
    <SeaScreen
      {...p}
      result={result}
      rewardCatalog={{
        duck: duckPreviewArt,
        scarf: { ...duckPreviewArt, title: '빨간 목도리' },
        hat: { ...duckPreviewArt, title: '파란 모자' },
      }}
    />,
  );
  expect(screen.getByText('오리 인형')).toBeTruthy();
  expect(screen.getByText('빨간 목도리, 파란 모자도 함께 받았어요')).toBeTruthy();
  await fireEvent.press(screen.getByLabelText('섬 둘러보기'));
  expect(p.onExplore).toHaveBeenCalledWith(result);
});

test('스와이프로 마지막 참여자에 도달하고 드래그 직후에는 카드가 열리지 않는다', async () => {
  const screen = await render(<SeaScreen {...props()} />);
  const scroll = screen.getByTestId('sea-participants');
  await fireEvent(scroll, 'scrollBeginDrag');
  await fireEvent.scroll(scroll, { nativeEvent: { contentOffset: { x: 402, y: 0 } } });
  const last = screen.getByTestId('sea-person-9');
  await fireEvent.press(last);
  expect(screen.queryByLabelText('닫기')).toBeNull();
  expect(screen.getByText('2 / 2')).toBeTruthy();
});

test('스냅샷 순서 갱신은 선택한 페이지를 초기화하지 않는다', async () => {
  const p = props();
  const screen = await render(<SeaScreen {...p} />);
  await fireEvent.press(screen.getByLabelText('다음 참여자 보기'));
  await screen.rerender(<SeaScreen {...p} participants={[...people].reverse()} />);
  expect(screen.getByText('2 / 2')).toBeTruthy();
  expect(screen.getByTestId('sea-person-6')).toBeTruthy();
});

test('드래그가 취소돼도 잠시 후 참여자를 다시 누를 수 있다', async () => {
  const now = jest.spyOn(Date, 'now').mockReturnValue(1000);
  try {
    const screen = await render(<SeaScreen {...props()} />);
    const scroll = screen.getByTestId('sea-participants');
    await fireEvent(scroll, 'scrollBeginDrag');
    await fireEvent(scroll, 'touchCancel');
    now.mockReturnValue(1400);
    await fireEvent.press(screen.getByTestId('sea-person-1'));
    expect(screen.getByLabelText('닫기')).toBeTruthy();
  } finally {
    now.mockRestore();
  }
});

test('드래그 없이 터치를 마친 참여자는 바로 누를 수 있다', async () => {
  const screen = await render(<SeaScreen {...props()} />);
  await fireEvent(screen.getByTestId('sea-participants'), 'touchEnd');
  await fireEvent.press(screen.getByTestId('sea-person-1'));
  expect(screen.getByLabelText('닫기')).toBeTruthy();
});

test('다음 페이지 이동은 중간 스크롤 이벤트 때문에 이전 페이지로 되돌아가지 않는다', async () => {
  const screen = await render(<SeaScreen {...props()} />);
  await fireEvent.press(screen.getByLabelText('다음 참여자 보기'));
  await fireEvent.scroll(screen.getByTestId('sea-participants'), {
    nativeEvent: { contentOffset: { x: 80, y: 0 } },
  });
  expect(screen.getByText('2 / 2')).toBeTruthy();
  await fireEvent.press(screen.getByLabelText('다음 참여자 보기'));
  await fireEvent.scroll(screen.getByTestId('sea-participants'), {
    nativeEvent: { contentOffset: { x: 402, y: 0 } },
  });
  expect(screen.getByText('2 / 2')).toBeTruthy();
});

test('본인과 참가자 이모트는 접근성 이름에 포함되고 사라지면 제거된다', async () => {
  const p = props();
  const screen = await render(
    <SeaScreen
      {...p}
      self={{ ...p.self, emote: 'cheer' }}
      participants={people.map((person) => ({ ...person, emote: 'hello' }))}
    />,
  );
  expect(screen.getByLabelText('내 뗏목, 응원')).toBeTruthy();
  expect(screen.getByLabelText('고양이1, 집중 중, 00:00:42, 안녕')).toBeTruthy();
  await screen.rerender(<SeaScreen {...p} />);
  expect(screen.queryByLabelText('내 뗏목, 응원')).toBeNull();
  expect(screen.queryByLabelText('고양이1, 집중 중, 00:00:42, 안녕')).toBeNull();
  expect(screen.getByLabelText('내 뗏목')).toBeTruthy();
  expect(screen.getByLabelText('고양이1, 집중 중, 00:00:42')).toBeTruthy();
});

test('기존 한마디를 비우면 빈 문자열로 삭제를 요청할 수 있다', async () => {
  const p = props();
  const screen = await render(<SeaScreen {...p} self={{ ...p.self, message: '집중할게요' }} />);
  await fireEvent.press(screen.getByLabelText('＋ 한마디 쓰기'));
  await fireEvent.changeText(screen.getByLabelText('한마디 쓰기'), '   ');
  expect(screen.getByLabelText('한마디 지우기')).toBeEnabled();
  await fireEvent.press(screen.getByLabelText('한마디 지우기'));
  expect(p.onMessage).toHaveBeenCalledWith('');
});

test('기존 한마디가 없으면 빈 내용은 저장하지 않는다', async () => {
  const p = props();
  const screen = await render(<SeaScreen {...p} />);
  await fireEvent.press(screen.getByLabelText('＋ 한마디 쓰기'));
  expect(screen.getByLabelText('한마디 띄우기')).toBeDisabled();
  await fireEvent.press(screen.getByLabelText('한마디 띄우기'));
  expect(p.onMessage).not.toHaveBeenCalled();
});

test('게스트와 한마디 쿨다운 상태에서는 저장 요청을 보낼 수 없다', async () => {
  const p = props();
  const onSignIn = jest.fn();
  const screen = await render(<SeaScreen {...p} guest onSignIn={onSignIn} />);
  await fireEvent.press(screen.getByLabelText('＋ 한마디 쓰기'));
  expect(screen.getByText('로그인하면 다른 고양이에게 한마디를 남길 수 있어요.')).toBeTruthy();
  expect(screen.queryByLabelText('한마디 띄우기')).toBeNull();
  expect(screen.getByLabelText('로그인하기')).toBeEnabled();
  await fireEvent.press(screen.getByLabelText('로그인하기'));
  expect(onSignIn).toHaveBeenCalledTimes(1);
  await screen.rerender(<SeaScreen {...p} messageCooldownSeconds={299} />);
  expect(screen.getByText('5분 뒤에 다시 쓸 수 있어요')).toBeTruthy();
  expect(p.onMessage).not.toHaveBeenCalled();
});
