// LiveFocusGrid 렌더 순서 테스트 — 핀 → 집중중 → 오늘 총 집중시간 내림차순.
// 집중중을 시간보다 위 키로 둔 게 이 그리드의 핵심 규칙이라(회색 비집중자가 위를 덮지 않게)
// 깨지면 바로 잡히게 고정해 둔다. 상한을 없앤 뒤로는 정렬이 유일한 노출 규칙이기도 하다.
import { render, screen } from '@testing-library/react-native';
import { LiveFocusGrid, type LiveGridMember } from './LiveFocusGrid';

// 진행 중 세션 없이 '오늘 누적분'만으로 시간을 고정한다 — now에 의존하지 않아 테스트가 안 흔들린다.
function member(
  userId: string,
  minutes: number,
  isFocusing: boolean,
  focusStartedAt: string | null = null,
): LiveGridMember {
  return {
    userId,
    nickname: userId,
    focusTimeMinutes: minutes,
    isFocusing,
    focusStartedAt,
    focusTagName: null,
  };
}

// 화면에 그려진 닉네임을 위→아래 순서로 뽑는다.
function renderedOrder(): string[] {
  return screen
    .getAllByTestId('live.grid.name')
    .map((n) => n.props.children)
    .filter((v): v is string => typeof v === 'string');
}

const EMPTY = { emptyTitle: '없음', emptySub: '없음' };

describe('LiveFocusGrid 정렬', () => {
  it('집중중이 시간 많은 비집중자보다 위에 온다', async () => {
    await render(
      <LiveFocusGrid
        {...EMPTY}
        members={[
          member('idle-300', 300, false), // 오늘 5시간, 지금은 안 함
          member('live-1', 1, true), // 오늘 1분, 지금 집중중
        ]}
      />,
    );
    expect(renderedOrder()).toEqual(['live-1', 'idle-300']);
  });

  it('같은 집중 상태 안에서는 시간 많은 순', async () => {
    await render(
      <LiveFocusGrid
        {...EMPTY}
        members={[
          member('live-10', 10, true),
          member('idle-50', 50, false),
          member('live-90', 90, true),
          member('idle-200', 200, false),
        ]}
      />,
    );
    expect(renderedOrder()).toEqual(['live-90', 'live-10', 'idle-200', 'idle-50']);
  });

  it('핀은 집중중·시간과 무관하게 최상단 — 핀 안에서 다시 집중중 → 시간순', async () => {
    await render(
      <LiveFocusGrid
        {...EMPTY}
        members={[
          member('live-500', 500, true),
          member('pin-idle', 3, false),
          member('pin-live', 1, true),
        ]}
        pinnedIds={new Set(['pin-idle', 'pin-live'])}
      />,
    );
    expect(renderedOrder()).toEqual(['pin-live', 'pin-idle', 'live-500']);
  });

  it('내 셀도 같은 규칙에 섞인다 — 일시정지하면 집중중 아래로', async () => {
    await render(
      <LiveFocusGrid
        {...EMPTY}
        members={[member('live-1', 1, true), member('idle-5', 5, false)]}
        me={{ nickname: '나', isFocusing: false, totalSeconds: 600, tagName: null }}
      />,
    );
    // 나는 10분(600초)으로 idle-5(5분)보다 많지만, 집중중인 live-1보다는 아래.
    expect(renderedOrder()).toEqual(['live-1', '나', 'idle-5']);
  });

  it('상한 없이 전원 렌더 — 배너 인원도 자르지 않은 수를 센다', async () => {
    const many = Array.from({ length: 40 }, (_, i) => member(`u${i}`, i, i % 2 === 0));
    await render(<LiveFocusGrid {...EMPTY} members={many} />);
    expect(screen.getByText('20명이 지금 같이 집중하고 있어요')).toBeTruthy();
  });
});
