import { renderHook } from '@testing-library/react-native';
import { usePrefetchAppBundle } from './PublicWebDemo';

// 빌드가 넣은 meta 주소를 load 뒤에 prefetch 링크로 붙이는지 본다. DOM이 없는 jest라 문서·창을 흉내 낸다.
function fakeDom(readyState: string, href: string | null) {
  const appended: Record<string, string>[] = [];
  const listeners: Record<string, () => void> = {};
  const doc = {
    readyState,
    querySelector: jest.fn(() => (href === null ? null : { content: href })),
    createElement: jest.fn(() => ({}) as Record<string, string>),
    head: { appendChild: jest.fn((node: Record<string, string>) => appended.push(node)) },
  } as unknown as Document;
  const win = {
    addEventListener: jest.fn((event: string, listener: () => void) => {
      listeners[event] = listener;
    }),
    removeEventListener: jest.fn(),
  } as unknown as Window;
  return { doc, win, appended, listeners };
}

it('소개 화면이 다 뜬 뒤(load) 체험 앱 번들을 prefetch 한다', async () => {
  const dom = fakeDom('loading', '/_expo/static/js/web/App-abc.js');
  await renderHook(() => usePrefetchAppBundle(dom.doc, dom.win));
  expect(dom.appended).toEqual([]);
  dom.listeners.load();
  expect(dom.appended).toEqual([
    { rel: 'prefetch', as: 'script', href: '/_expo/static/js/web/App-abc.js' },
  ]);
});

it('이미 load가 끝났으면 바로 prefetch 한다', async () => {
  const dom = fakeDom('complete', '/_expo/static/js/web/App-abc.js');
  await renderHook(() => usePrefetchAppBundle(dom.doc, dom.win));
  expect(dom.appended).toHaveLength(1);
  expect(dom.win.addEventListener).not.toHaveBeenCalled();
});

it('빌드가 넣은 주소가 없으면(개발용 웹) 아무것도 받지 않는다', async () => {
  const dom = fakeDom('complete', null);
  await renderHook(() => usePrefetchAppBundle(dom.doc, dom.win));
  expect(dom.appended).toEqual([]);
});
