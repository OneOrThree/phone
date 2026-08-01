// CoinContext 잔액 3상 테스트 — 3차 리뷰 F1·F3의 진원지.
//
// 여기서 잠그는 것:
//  1) refresh는 **실패해도 던지지 않는다**. 호출처(BetSheet)가 try/catch 없이 부르고 있어,
//     여기서 새면 시트가 통째로 터진다.
//  2) 실패를 조용히 삼키지도 않는다 — coinsLoaded가 false로 돌아가야 '지금 쥔 값은 못 믿는다'를
//     화면이 알 수 있다. 이게 없으면 '못 받은 잔액 0'과 '진짜 0코인'이 같은 값이 되고,
//     코인을 가진 사용자가 `코인이 부족해요`를 보며 내기를 못 건다.
//  3) 성공하면 서버 값이 그대로 실리고 coinsLoaded가 켜진다.
//  4) 겹쳐 부른 조회는 **마지막 것만** 반영한다. 시트 오픈 refresh가 떠 있는 채 내기가 성립해
//     두 번째 refresh가 돌면, 늦게 도착한 차감 전 잔액이 차감 후 잔액을 덮어써 화면이 재산을
//     과대 표시하고 부족 검사를 잘못 통과시킨다(코덱스 리뷰).
import { act, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';
import { CoinProvider, useCoins } from './CoinContext';
import { api } from '@/services/api';

jest.mock('@/services/api', () => ({ api: { get: jest.fn(), post: jest.fn() } }));

// userId 버킷(보유 아이템)만 쓰는 의존성 — 잔액과 무관하다.
jest.mock('./UserContext', () => ({ useUser: () => ({ userId: 'u1' }) }));

const mockGet = api.get as jest.MockedFunction<typeof api.get>;

// refresh를 테스트가 직접 부르기 위해 훅을 밖으로 꺼내 둔다.
let refreshFn: () => Promise<void> = async () => {};

function Probe() {
  const { coins, coinsLoaded, coinsVersion, refresh } = useCoins();
  refreshFn = refresh;
  return (
    <>
      <Text testID="coins">{coins}</Text>
      <Text testID="loaded">{coinsLoaded ? 'yes' : 'no'}</Text>
      <Text testID="version">{coinsVersion}</Text>
    </>
  );
}

// Provider는 마운트 시 1회 refresh + AsyncStorage 읽기를 돈다 — 둘 다 흘린 뒤 반환한다.
async function renderProvider() {
  const result = await render(
    <CoinProvider>
      <Probe />
    </CoinProvider>,
  );
  await act(async () => {});
  return result;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('refresh', () => {
  test('성공하면 서버 잔액이 실리고 미상 상태가 풀린다', async () => {
    mockGet.mockResolvedValue({ data: 500 } as never);
    await renderProvider();

    expect(screen.getByTestId('coins')).toHaveTextContent('500');
    expect(screen.getByTestId('loaded')).toHaveTextContent('yes');
  });

  test('여러 번 불러도 마지막 서버 값으로 갱신된다', async () => {
    mockGet.mockResolvedValueOnce({ data: 500 } as never);
    await renderProvider();
    expect(screen.getByTestId('coins')).toHaveTextContent('500');

    // 서버가 판돈을 깎았다 — 앱이 다시 받아야만 알 수 있는 변화다(내기 시트가 여는 이유).
    mockGet.mockResolvedValueOnce({ data: 470 } as never);
    await act(async () => {
      await refreshFn();
    });
    expect(screen.getByTestId('coins')).toHaveTextContent('470');
    expect(screen.getByTestId('loaded')).toHaveTextContent('yes');
  });

  test('실패해도 던지지 않고, 잔액을 미상으로 되돌린다', async () => {
    mockGet.mockRejectedValueOnce(new Error('network'));
    await renderProvider();

    // 초기값 0이 화면에 남지만 loaded가 false라 '0코인'으로 읽히지 않는다.
    expect(screen.getByTestId('loaded')).toHaveTextContent('no');

    // 호출처가 try/catch 없이 부른다 — 여기서 새면 안 된다.
    await act(async () => {
      await expect(refreshFn()).resolves.toBeUndefined();
    });
  });

  test('받아 둔 잔액이 있어도 이후 실패하면 다시 미상이 된다', async () => {
    mockGet.mockResolvedValueOnce({ data: 500 } as never);
    await renderProvider();
    expect(screen.getByTestId('loaded')).toHaveTextContent('yes');

    mockGet.mockRejectedValueOnce(new Error('network'));
    await act(async () => {
      await refreshFn();
    });

    // 값 자체는 남겨 두되(마지막으로 알던 잔액), 믿을 수 없다는 사실을 표시한다.
    expect(screen.getByTestId('coins')).toHaveTextContent('500');
    expect(screen.getByTestId('loaded')).toHaveTextContent('no');
  });

  test('성공한 조회마다 잔액 버전이 오른다', async () => {
    mockGet.mockResolvedValue({ data: 500 } as never);
    await renderProvider();
    expect(screen.getByTestId('version')).toHaveTextContent('1');

    await act(async () => {
      await refreshFn();
    });
    expect(screen.getByTestId('version')).toHaveTextContent('2');

    // 실패는 새 잔액이 아니다 — 버전은 그대로여야 '이 판정 이후에 받은 값인가'를 물을 수 있다.
    mockGet.mockRejectedValueOnce(new Error('network'));
    await act(async () => {
      await refreshFn();
    });
    expect(screen.getByTestId('version')).toHaveTextContent('2');
  });

  // 시트 오픈 refresh(A)가 떠 있는 채 내기가 성립해 refresh(B)가 돈다 — B(차감 후 470)가 먼저
  // 도착해도 A(차감 전 500)가 늦게 도착하면 잔액이 500으로 되살아난다. 최신 호출만 반영한다.
  test('늦게 도착한 이전 조회는 최신 잔액을 덮지 않는다', async () => {
    mockGet.mockResolvedValueOnce({ data: 0 } as never);
    await renderProvider();

    let finishA: (v: { data: number }) => void = () => {};
    mockGet.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishA = resolve as (v: { data: number }) => void;
        }) as never,
    );
    let pendingA: Promise<void> = Promise.resolve();
    await act(async () => {
      pendingA = refreshFn();
    });

    // 판돈이 빠진 뒤의 잔액 — 나중에 시작한 B가 먼저 도착한다.
    mockGet.mockResolvedValueOnce({ data: 470 } as never);
    await act(async () => {
      await refreshFn();
    });
    expect(screen.getByTestId('coins')).toHaveTextContent('470');

    // 이제야 도착한 A의 차감 전 잔액 — 버려야 한다.
    await act(async () => {
      finishA({ data: 500 });
      await pendingA;
    });
    expect(screen.getByTestId('coins')).toHaveTextContent('470');
    expect(screen.getByTestId('version')).toHaveTextContent('2');
  });

  // 실패도 마찬가지다 — 늦게 실패한 A가 coinsLoaded를 false로 되돌리면, 방금 받은 B의 잔액이
  // 멀쩡한데도 화면이 '미상'으로 떨어져 부족 판정을 못 하게 된다.
  test('늦게 실패한 이전 조회는 최신 잔액을 미상으로 되돌리지 않는다', async () => {
    mockGet.mockResolvedValueOnce({ data: 0 } as never);
    await renderProvider();

    let failA: (e: Error) => void = () => {};
    mockGet.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          failA = reject;
        }) as never,
    );
    let pendingA: Promise<void> = Promise.resolve();
    await act(async () => {
      pendingA = refreshFn();
    });

    mockGet.mockResolvedValueOnce({ data: 470 } as never);
    await act(async () => {
      await refreshFn();
    });

    await act(async () => {
      failA(new Error('network'));
      await pendingA;
    });
    expect(screen.getByTestId('coins')).toHaveTextContent('470');
    expect(screen.getByTestId('loaded')).toHaveTextContent('yes');
  });
});
