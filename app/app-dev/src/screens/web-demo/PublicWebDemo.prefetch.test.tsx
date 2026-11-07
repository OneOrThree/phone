import { renderHook } from '@testing-library/react-native';
import { usePrefetchAppBundle } from './PublicWebDemo';

// 빌드가 넣은 meta 주소를 load 뒤에 prefetch 링크로 붙이는지 본다. DOM이 없는 jest라 문서·창을 흉내 낸다.
function fakeDom(
  readyState: string,
  href: string | null,
  connection?: { saveData?: boolean; effectiveType?: string },
) {
  const appended: Record<string, string>[] = [];
  const listeners: Record<string, () => void> = {};
  const doc = {
    readyState,
    querySelector: jest.fn(() => (href === null ? null : { content: href })),
    createElement: jest.fn(() => ({}) as Record<string, string>),
    head: {
      appendChild: jest.fn((node: Record<string, string>) => appended.push(node)),
      querySelector: jest.fn(() =>
        appended.some((node) => node.rel === 'prefetch' && node.href === href) ? {} : null,
      ),
    },
  } as unknown as Document;
  const win = {
    navigator: { connection },
    addEventListener: jest.fn((event: string, listener: () => void) => {
      listeners[event] = listener;
    }),
    removeEventListener: jest.fn(),
  } as unknown as Window;
  return { doc, win, appended, listeners };
}

const HREF = '/_expo/static/js/web/App-abc.js';

it('소개 화면이 다 뜬 뒤(load) 체험 앱 번들을 prefetch 한다', async () => {
  const dom = fakeDom('loading', HREF);
  await renderHook(() => usePrefetchAppBundle(dom.doc, dom.win));
  expect(dom.appended).toEqual([]);
  dom.listeners.load();
  expect(dom.appended).toEqual([{ rel: 'prefetch', as: 'script', href: HREF }]);
});

it('이미 load가 끝났으면 바로 prefetch 하고, 다시 마운트돼도 링크를 쌓지 않는다', async () => {
  const dom = fakeDom('complete', HREF);
  const first = await renderHook(() => usePrefetchAppBundle(dom.doc, dom.win));
  await first.unmount();
  await renderHook(() => usePrefetchAppBundle(dom.doc, dom.win));
  expect(dom.appended).toHaveLength(1);
  expect(dom.win.addEventListener).not.toHaveBeenCalled();
});

it('load 전에 화면이 사라지면 붙이지 않는다', async () => {
  const dom = fakeDom('loading', HREF);
  const hook = await renderHook(() => usePrefetchAppBundle(dom.doc, dom.win));
  await hook.unmount();
  expect(dom.win.removeEventListener).toHaveBeenCalledWith('load', dom.listeners.load);
  expect(dom.appended).toEqual([]);
});

it('데이터 절약 모드나 2G 회선에서는 미리 받지 않는다', async () => {
  for (const connection of [
    { saveData: true },
    { effectiveType: '2g' },
    { effectiveType: 'slow-2g' },
  ]) {
    const dom = fakeDom('complete', HREF, connection);
    await renderHook(() => usePrefetchAppBundle(dom.doc, dom.win));
    expect(dom.appended).toEqual([]);
  }
  const fast = fakeDom('complete', HREF, { effectiveType: '4g' });
  await renderHook(() => usePrefetchAppBundle(fast.doc, fast.win));
  expect(fast.appended).toHaveLength(1);
});

it('빌드가 넣은 주소가 없으면(개발용 웹) 아무것도 받지 않는다', async () => {
  const dom = fakeDom('complete', null);
  await renderHook(() => usePrefetchAppBundle(dom.doc, dom.win));
  expect(dom.appended).toEqual([]);
});
