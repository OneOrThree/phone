// 전면 오버레이 조정자(GROMO-1576) — slot 판정 규칙 자체를 잠근다.
//
// 화면 배선(누가 등록하고 누가 승인받아 마운트하는가)은 screens/group 쪽 테스트가 실물 트리로
// 잠근다. 여기서는 조정자의 **판정 규칙**만 본다:
//   · 동시에 요청하면 우선순위가 높은 쪽이 받는다
//   · 같은 우선순위면 먼저 등록한 쪽이 받는다
//   · 이미 받은 쪽은 더 높은 우선순위가 와도 **뺏기지 않는다**
//   · 보유자가 놓으면 대기하던 쪽이 그때 받는다
import { act, render } from '@testing-library/react-native';
import {
  OVERLAY_PRIORITY,
  OverlaySlotProvider,
  useOverlayMaxPriority,
  useOverlaySlot,
  type OverlaySlotStatus,
} from './OverlaySlotContext';

// 소비자 한 명 — 매 렌더의 status를 기록만 한다(실제 소비자는 'granted'일 때만 Modal을 마운트한다).
function Probe({
  id,
  priority,
  active,
  log,
}: {
  id: string;
  priority: number;
  active: boolean;
  log: Record<string, OverlaySlotStatus[]>;
}) {
  const status = useOverlaySlot(id, { priority, active });
  (log[id] ??= []).push(status);
  return null;
}

function MaxPriorityProbe({ onValue }: { onValue: (value: number) => void }) {
  onValue(useOverlayMaxPriority());
  return null;
}

function last(log: Record<string, OverlaySlotStatus[]>, id: string): OverlaySlotStatus | undefined {
  const entries = log[id];
  return entries === undefined ? undefined : entries[entries.length - 1];
}

describe('slot 판정', () => {
  test('동시에 요청하면 우선순위가 높은 쪽이 받는다 — 결과 모달 > 그룹 덱 코치마크', async () => {
    const log: Record<string, OverlaySlotStatus[]> = {};
    // 등록 **순서는 코치마크가 먼저**다(트리에서 위에 있다). 그래도 우선순위가 이겨야 한다.
    await render(
      <OverlaySlotProvider>
        <Probe id="guide" priority={OVERLAY_PRIORITY.groupDeckGuide} active log={log} />
        <Probe id="result" priority={OVERLAY_PRIORITY.challengeResult} active log={log} />
      </OverlaySlotProvider>,
    );
    await act(async () => {});

    expect(last(log, 'result')).toBe('granted');
    expect(last(log, 'guide')).toBe('pending');
  });

  test('같은 우선순위면 먼저 등록한 쪽이 받는다', async () => {
    const log: Record<string, OverlaySlotStatus[]> = {};
    await render(
      <OverlaySlotProvider>
        <Probe id="first" priority={OVERLAY_PRIORITY.sheet} active log={log} />
        <Probe id="second" priority={OVERLAY_PRIORITY.sheet} active log={log} />
      </OverlaySlotProvider>,
    );
    await act(async () => {});

    expect(last(log, 'first')).toBe('granted');
    expect(last(log, 'second')).toBe('pending');
  });

  test('이미 granted인 요청은 더 높은 우선순위가 와도 뺏기지 않는다', async () => {
    const log: Record<string, OverlaySlotStatus[]> = {};
    const tree = (resultActive: boolean) => (
      <OverlaySlotProvider>
        <Probe id="guide" priority={OVERLAY_PRIORITY.groupDeckGuide} active log={log} />
        <Probe
          id="result"
          priority={OVERLAY_PRIORITY.challengeResult}
          active={resultActive}
          log={log}
        />
      </OverlaySlotProvider>
    );
    const view = await render(tree(false));
    await act(async () => {});
    expect(last(log, 'guide')).toBe('granted');

    // 더 높은 우선순위가 **나중에** 도착했다 — 사용자가 보고 있는 것을 걷어내지 않는다.
    await act(async () => {
      view.rerender(tree(true));
    });
    expect(last(log, 'guide')).toBe('granted');
    expect(last(log, 'result')).toBe('pending');
  });

  test('보유자가 놓으면 대기하던 쪽이 그때 받는다', async () => {
    const log: Record<string, OverlaySlotStatus[]> = {};
    const tree = (guideActive: boolean) => (
      <OverlaySlotProvider>
        <Probe
          id="guide"
          priority={OVERLAY_PRIORITY.groupDeckGuide}
          active={guideActive}
          log={log}
        />
        <Probe id="result" priority={OVERLAY_PRIORITY.challengeResult} active={false} log={log} />
      </OverlaySlotProvider>
    );
    const view = await render(tree(true));
    await act(async () => {});
    expect(last(log, 'guide')).toBe('granted');

    // 결과가 대기에 붙고(뺏지 못함), 코치마크가 끝나면 그때 승인받는다.
    const withResult = (guideActive: boolean) => (
      <OverlaySlotProvider>
        <Probe
          id="guide"
          priority={OVERLAY_PRIORITY.groupDeckGuide}
          active={guideActive}
          log={log}
        />
        <Probe id="result" priority={OVERLAY_PRIORITY.challengeResult} active log={log} />
      </OverlaySlotProvider>
    );
    await act(async () => {
      view.rerender(withResult(true));
    });
    expect(last(log, 'result')).toBe('pending');

    await act(async () => {
      view.rerender(withResult(false));
    });
    expect(last(log, 'guide')).toBe('idle');
    expect(last(log, 'result')).toBe('granted');
  });

  test('요청하지 않으면 idle이고, 조정자가 없으면 단독 오버레이로 본다', async () => {
    const log: Record<string, OverlaySlotStatus[]> = {};
    await render(
      <OverlaySlotProvider>
        <Probe id="idle" priority={OVERLAY_PRIORITY.sheet} active={false} log={log} />
      </OverlaySlotProvider>,
    );
    await act(async () => {});
    expect(last(log, 'idle')).toBe('idle');

    // Provider 밖 — 경쟁 상대가 존재할 수 없으므로 그대로 승인한다.
    const bare: Record<string, OverlaySlotStatus[]> = {};
    await render(<Probe id="alone" priority={OVERLAY_PRIORITY.sheet} active log={bare} />);
    await act(async () => {});
    expect(last(bare, 'alone')).toBe('granted');
  });

  test('등록된 최고 우선순위를 알려 준다 — 소비자가 스스로 양보할 때의 재료', async () => {
    const values: number[] = [];
    const tree = (sheetActive: boolean) => (
      <OverlaySlotProvider>
        <MaxPriorityProbe onValue={(v) => values.push(v)} />
        <Probe
          id="sheet"
          priority={OVERLAY_PRIORITY.sheet}
          active={sheetActive}
          log={{} as Record<string, OverlaySlotStatus[]>}
        />
      </OverlaySlotProvider>
    );
    const view = await render(tree(false));
    await act(async () => {});
    expect(values[values.length - 1]).toBe(-1);

    await act(async () => {
      view.rerender(tree(true));
    });
    expect(values[values.length - 1]).toBe(OVERLAY_PRIORITY.sheet);
  });
});
