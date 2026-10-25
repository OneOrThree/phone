/**
 * GROMO-2253 — 언어 전환과 검토 모드 언어 부팅의 App 단 회귀 방지.
 *
 * ① 언어 화면에서 English 를 탭하면 App 의 localePref state 가 바뀌어 화면 문구가 영문으로 다시 그려지고,
 *    `React.memo` 자식은 localePref 를 prop 으로 받을 때만 따라 바뀐다(app/app-dev/README.md 「memo 면 localePref 를
 *    prop 으로」 계약). 이 과정에서 CurrentScreens 서브트리가 리마운트되면 안 된다(언마운트 0).
 *    지금 i18n 문구를 그리는 memo 자식은 없어서, localePref prop 을 받는 memo probe 로 계약을 대신 지킨다.
 * ② `?review=1&lang=en` 부팅은 저장된 gromo.locale 을 읽지 않고 파라미터로만 정한다(없으면 한국어).
 *    REVIEW_LANG·REVIEW 는 App 모듈 상수라 jest.isolateModules 로 새로 읽는다.
 */
import assert from 'node:assert/strict';
import React from 'react';
import { Platform } from 'react-native';
import { act, fireEvent, render, waitFor, within } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import App from '@/App';
import { applyLocalePref } from '@/i18n';
import { clearSession } from '@/services/api/session';

// 첫 마운트는 App 과 화면 모듈을 처음 읽어 느리다 — 바쁜 머신에서도 기본 5초에 걸리지 않게 넉넉히 둔다
jest.setTimeout(30_000);

let captured: any;
// 마운트·언마운트 횟수 — tree 는 CurrentScreens 서브트리 전체, probe 는 언어 화면 옆의 memo probe.
const mockLifecycle = {
  tree: { mounts: 0, unmounts: 0 },
  probe: { mounts: 0, unmounts: 0 },
};

jest.mock('@/screens/island/CurrentScreens', () => {
  const ReactActual = require('react');
  const { Text } = require('react-native');
  const { t } = require('@/i18n');
  const useLifecycleCount = (kind: 'tree' | 'probe') => {
    ReactActual.useEffect(() => {
      mockLifecycle[kind].mounts += 1;
      return () => {
        mockLifecycle[kind].unmounts += 1;
      };
    }, [kind]);
  };
  // localePref 를 prop 으로 받는 memo 자식 — 부모가 prop 을 넘기지 않으면 언어를 바꿔도 다시 그려지지 않는다
  const Probe = ReactActual.memo(function LocaleProbe({ localePref }: { localePref: string }) {
    useLifecycleCount('probe');
    return (
      <Text testID="locale-probe" accessibilityLabel={`locale-probe-${localePref}`}>
        {t('settings.language.title')}
      </Text>
    );
  });
  return {
    CurrentScreens: (props: any) => {
      useLifecycleCount('tree');
      captured = props.e;
      if (props.e.route !== 'language') return null;
      const actual = jest.requireActual('@/screens/island/CurrentScreens');
      return (
        <>
          <actual.CurrentScreens e={props.e} />
          <Probe localePref={props.e.localePref} />
        </>
      );
    },
  };
});

// CurrentScreens 가 라우트와 무관하게 부르는 화면 훅 — CurrentScreens.routing.test.tsx 와 같은 가짜로 바꾼다
jest.mock('@/screens/island/useFriendsScreen', () => ({
  useFriendsScreen: () => ({ data: null }),
}));
jest.mock('@/screens/island/useBoardHomeIndicator', () => ({
  useBoardHomeIndicator: () => ({ hasNew: false }),
}));

jest.mock('@/services/api/auth', () => ({
  checkSession: async () => ({ status: 'offline' }),
  logout: async () => {},
}));

jest.mock('@/services/islandBoot', () => ({
  decideBootRoute: async () => 'login',
}));

jest.mock('@/services/api/session', () => {
  const actual = jest.requireActual('@/services/api/session');
  return { ...actual, restoreSession: async () => null };
});

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaProvider: ({ children }: any) => children,
  SafeAreaView: 'SafeAreaView',
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

const LOCALE_KEYS = ['gromo.locale', 'gromo:settings:locale'];

beforeEach(async () => {
  captured = undefined;
  mockLifecycle.tree = { mounts: 0, unmounts: 0 };
  mockLifecycle.probe = { mounts: 0, unmounts: 0 };
  await clearSession();
  await AsyncStorage.multiRemove(LOCALE_KEYS);
});
afterEach(async () => {
  // 언어 키는 기기 전역 값이라 앱이 안 지운다 — 다음 테스트의 부팅이 읽지 않게 여기서 비운다
  await AsyncStorage.multiRemove(LOCALE_KEYS);
  applyLocalePref(null);
});

/** 웹 ?review 쿼리를 흉내 낸다 — 격리 레지스트리의 Platform 과 window.location 을 바꾸고 되돌리는 함수를 준다. */
const webSearch = (search: string) => {
  const g = globalThis as any;
  const prevLocation = g.window?.location;
  Object.defineProperty(g.window, 'location', {
    value: { search },
    configurable: true,
    writable: true,
  });
  return () => {
    Object.defineProperty(g.window, 'location', { value: prevLocation, configurable: true });
  };
};

test('언어 화면에서 English 를 탭하면 화면·memo 자식 문구가 영문으로 바뀌고 리마운트(언마운트)가 없다', async () => {
  try {
    const screen = await render(<App />);
    await waitFor(() => assert.ok(captured));
    await act(async () => captured.go('language', 'settings'));

    // 한국어 기준선 — 화면 제목과 memo probe 가 같은 문구를 그린다
    assert.equal(captured.route, 'language');
    assert.equal(screen.getAllByText('언어').length, 2);
    assert.equal(
      screen.getByTestId('locale-probe').props.accessibilityLabel,
      'locale-probe-system',
    );
    assert.deepEqual(mockLifecycle.tree, { mounts: 1, unmounts: 0 });
    assert.deepEqual(mockLifecycle.probe, { mounts: 1, unmounts: 0 });

    await fireEvent.press(screen.getByLabelText('English'));
    await waitFor(() => assert.equal(captured.localePref, 'en'));

    // 화면 제목·행 문구 + memo probe 전부 영문. 한국어 제목은 남지 않는다
    assert.equal(screen.getAllByText('Language').length, 2);
    assert.ok(screen.getByText('Follow device language'));
    assert.equal(screen.queryByText('언어'), null);
    assert.equal(screen.getByTestId('locale-probe').props.accessibilityLabel, 'locale-probe-en');
    assert.ok(within(screen.getByTestId('global-toast')).getByText('Language changed'));
    assert.equal(await AsyncStorage.getItem('gromo.locale'), 'en');

    // 리마운트 없이 같은 인스턴스가 다시 그려졌다
    assert.deepEqual(mockLifecycle.tree, { mounts: 1, unmounts: 0 });
    assert.deepEqual(mockLifecycle.probe, { mounts: 1, unmounts: 0 });
  } finally {
    await AsyncStorage.multiRemove(LOCALE_KEYS);
    applyLocalePref(null);
  }
});

// REVIEW·REVIEW_LANG 는 App 모듈 로드 때 굳으므로 격리 로드한다. 격리 레지스트리는 React·AsyncStorage·Platform 을
// 새로 만드니 React 와 AsyncStorage 는 바깥 인스턴스를 물려주고(안 그러면 훅이 깨지고 «저장값 무시» 단언이 빈 저장소를
// 보게 된다), Platform 은 격리 쪽을 웹으로 바꾼 뒤 App 을 읽는다.
test.each([
  ['?review=1&lang=en', 'ko', 'en'],
  ['?review=1', 'en', 'ko'],
])('검토 부팅 %s — 저장된 언어(%s)를 무시하고 %s 로 뜬다', async (search, stored, expected) => {
  await AsyncStorage.setItem('gromo.locale', stored);
  (AsyncStorage.getItem as jest.Mock).mockClear();
  const restoreLocation = webSearch(search);
  let ReviewApp!: typeof App;
  let restoreOS!: () => void;
  try {
    jest.isolateModules(() => {
      jest.doMock('react', () => React);
      jest.doMock('@react-native-async-storage/async-storage', () => AsyncStorage);
      const isolated = require('react-native').Platform as { OS: string };
      const prevOS = isolated.OS;
      isolated.OS = 'web';
      restoreOS = () => {
        isolated.OS = prevOS;
      };
      ReviewApp = (require('@/App') as { default: typeof App }).default;
    });
    assert.equal(Platform.OS, 'ios'); // 바깥 Platform 은 그대로다
    await render(<ReviewApp />);
    await waitFor(() => assert.equal(captured?.localePref, expected));
    const reads = (AsyncStorage.getItem as jest.Mock).mock.calls.map((call) => call[0]);
    assert.ok(!reads.includes('gromo.locale'), `저장된 언어를 읽었다: ${reads.join(',')}`);
    assert.ok(!reads.includes('gromo:settings:locale'), `1.x 언어 키를 읽었다: ${reads.join(',')}`);
  } finally {
    restoreOS?.();
    restoreLocation();
    delete (globalThis as any).window.__gromoReview;
    await AsyncStorage.multiRemove(LOCALE_KEYS);
    applyLocalePref(null);
  }
});
