// CharacterContext 계정별 스코핑·파생값 테스트.
//
// 여기서 잠그는 것:
//  1) 저장된 선택이 계정 버킷 기준으로 하이드레이션된다(다른 계정 값이 새지 않는다).
//  2) setChoice/setCustomUri가 자기 버킷에만 저장되고, 누끼를 만들면 createdAt이 찍힌다.
//  3) activeSource 파생 규칙: custom+URI → URI, default 또는 URI 없음 → null.
//  4) transferCharacter가 게스트 버킷을 새 계정으로 옮기되, 새 계정에 이미 있으면 유지한다.
import { act, render, screen, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  CharacterProvider,
  transferCharacter,
  useCharacter,
  type CharacterChoice,
} from './CharacterContext';
import { STORAGE_KEYS } from '@/types/storage';

// userId 버킷만 쓰는 의존성 — 테스트가 계정을 바꿔 끼울 수 있게 가변으로 둔다.
let mockUserId: string | null = 'u1';
jest.mock('./UserContext', () => ({ useUser: () => ({ userId: mockUserId }) }));

// 훅을 밖으로 꺼내 테스트가 직접 setter를 부른다.
let setChoiceFn: (c: CharacterChoice) => void = () => {};
let setCustomUriFn: (uri: string | null) => void = () => {};

function Probe() {
  const { choice, customUri, setChoice, setCustomUri, activeSource } = useCharacter();
  setChoiceFn = setChoice;
  setCustomUriFn = setCustomUri;
  return (
    <>
      <Text testID="choice">{choice}</Text>
      <Text testID="customUri">{customUri ?? 'null'}</Text>
      <Text testID="activeSource">{activeSource ?? 'null'}</Text>
    </>
  );
}

// Provider는 마운트 시 AsyncStorage 읽기를 돈다 — CoinContext.test와 동일하게 흘린 뒤 반환한다.
async function renderProvider() {
  const result = await render(
    <CharacterProvider>
      <Probe />
    </CharacterProvider>,
  );
  await act(async () => {});
  return result;
}

// 저장소에서 계정 버킷 값을 읽어 온다.
async function readBucket(userId: string) {
  const raw = await AsyncStorage.getItem(STORAGE_KEYS.character);
  const map = raw ? JSON.parse(raw) : {};
  return map[userId];
}

beforeEach(async () => {
  jest.clearAllMocks();
  mockUserId = 'u1';
  await AsyncStorage.clear();
});

describe('하이드레이션', () => {
  test('저장된 선택이 없으면 기본값으로 시작한다', async () => {
    await renderProvider();
    expect(screen.getByTestId('choice')).toHaveTextContent('default');
    expect(screen.getByTestId('customUri')).toHaveTextContent('null');
    expect(screen.getByTestId('activeSource')).toHaveTextContent('null');
  });

  test('자기 버킷에 저장된 선택을 읽어 온다', async () => {
    await AsyncStorage.setItem(
      STORAGE_KEYS.character,
      JSON.stringify({
        u1: { choice: 'custom', customUri: 'file://cut.png', createdAt: 111 },
      }),
    );
    await renderProvider();
    expect(screen.getByTestId('choice')).toHaveTextContent('custom');
    expect(screen.getByTestId('customUri')).toHaveTextContent('file://cut.png');
    expect(screen.getByTestId('activeSource')).toHaveTextContent('file://cut.png');
  });

  test('다른 계정의 저장 값은 새지 않는다', async () => {
    await AsyncStorage.setItem(
      STORAGE_KEYS.character,
      JSON.stringify({
        other: { choice: 'custom', customUri: 'file://other.png', createdAt: 111 },
      }),
    );
    // 현재 계정(u1)엔 값이 없으므로 기본값이어야 한다.
    await renderProvider();
    expect(screen.getByTestId('choice')).toHaveTextContent('default');
    expect(screen.getByTestId('customUri')).toHaveTextContent('null');
  });
});

describe('setChoice / setCustomUri', () => {
  test('누끼를 지정하고 custom으로 바꾸면 자기 버킷에 저장되고 createdAt이 찍힌다', async () => {
    const now = 1_700_000_000_000;
    jest.spyOn(Date, 'now').mockReturnValue(now);
    await renderProvider();

    await act(async () => {
      setCustomUriFn('file://cut.png');
      setChoiceFn('custom');
    });

    expect(screen.getByTestId('activeSource')).toHaveTextContent('file://cut.png');
    // 저장 쓰기는 모듈 전역 큐를 거쳐 몇 마이크로태스크 뒤에 끝나므로 waitFor로 폴링한다.
    await waitFor(async () => {
      expect(await readBucket('u1')).toEqual({
        choice: 'custom',
        customUri: 'file://cut.png',
        createdAt: now,
      });
    });
  });

  test('누끼를 지우면 customUri·createdAt이 null이 된다', async () => {
    await renderProvider();
    await act(async () => {
      setCustomUriFn('file://cut.png');
    });
    await act(async () => {
      setCustomUriFn(null);
    });
    await waitFor(async () => {
      const saved = await readBucket('u1');
      expect(saved?.customUri).toBeNull();
      expect(saved?.createdAt).toBeNull();
    });
  });
});

describe('activeSource 파생', () => {
  test('custom이라도 customUri가 없으면 null이다', async () => {
    await renderProvider();
    await act(async () => {
      setChoiceFn('custom');
    });
    expect(screen.getByTestId('activeSource')).toHaveTextContent('null');
  });

  test('customUri가 있어도 choice가 default면 null이다', async () => {
    await renderProvider();
    await act(async () => {
      setCustomUriFn('file://cut.png');
    });
    // 아직 choice는 default — 기본 에셋을 써야 한다.
    expect(screen.getByTestId('choice')).toHaveTextContent('default');
    expect(screen.getByTestId('activeSource')).toHaveTextContent('null');
  });
});

describe('transferCharacter', () => {
  test('게스트 버킷을 새 계정으로 옮긴다', async () => {
    await AsyncStorage.setItem(
      STORAGE_KEYS.character,
      JSON.stringify({
        guest: { choice: 'custom', customUri: 'file://g.png', createdAt: 5 },
      }),
    );
    await transferCharacter('guest', 'social');

    const raw = await AsyncStorage.getItem(STORAGE_KEYS.character);
    const map = JSON.parse(raw as string);
    expect(map.guest).toBeUndefined();
    expect(map.social).toEqual({ choice: 'custom', customUri: 'file://g.png', createdAt: 5 });
  });

  test('새 계정에 이미 선택이 있으면 유지하고 게스트 것은 버린다', async () => {
    await AsyncStorage.setItem(
      STORAGE_KEYS.character,
      JSON.stringify({
        guest: { choice: 'custom', customUri: 'file://g.png', createdAt: 5 },
        social: { choice: 'custom', customUri: 'file://s.png', createdAt: 9 },
      }),
    );
    await transferCharacter('guest', 'social');

    const raw = await AsyncStorage.getItem(STORAGE_KEYS.character);
    const map = JSON.parse(raw as string);
    expect(map.guest).toBeUndefined();
    expect(map.social).toEqual({ choice: 'custom', customUri: 'file://s.png', createdAt: 9 });
  });

  test('게스트 버킷이 없으면 어느 계정 값도 만들지 않는다', async () => {
    await transferCharacter('guest', 'social');
    const raw = await AsyncStorage.getItem(STORAGE_KEYS.character);
    // 기존 컨텍스트(Coin·Equipment)와 동일하게 쓰기 큐가 빈 맵을 저장할 수 있으므로,
    // raw 자체가 아니라 어느 버킷도 생기지 않았음을 확인한다.
    const map = raw ? JSON.parse(raw) : {};
    expect(map.guest).toBeUndefined();
    expect(map.social).toBeUndefined();
  });
});
