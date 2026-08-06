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
const mockPost = api.post as jest.MockedFunction<typeof api.post>;

// refresh를 테스트가 직접 부르기 위해 훅을 밖으로 꺼내 둔다.
let refreshFn: () => Promise<boolean> = async () => false;
// 렌더를 거치지 않고 읽는 '지금 이 순간의 버전' — 비동기 콜백(BetSheet의 400 처리)이 쓰는 값이다.
let latestVersionFn: () => number = () => 0;
let addCoinsFn: (amount: number) => void = () => {};
let reconcileFn: (optimisticAmount: number, awardedCoins: number | undefined) => void = () => {};
let buyItemFn: (itemId: string, price: number) => Promise<boolean> = async () => false;

function Probe() {
  const {
    coins,
    coinsLoaded,
    coinsVersion,
    latestCoinsVersion,
    refresh,
    addCoins,
    reconcileSessionAward,
    buyItem,
  } = useCoins();
  refreshFn = refresh;
  latestVersionFn = latestCoinsVersion;
  addCoinsFn = addCoins;
  reconcileFn = reconcileSessionAward;
  buyItemFn = buyItem;
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

    // 호출처가 try/catch 없이 부른다 — 여기서 새면 안 되고, 실패는 반환값 false로 말한다.
    mockGet.mockRejectedValueOnce(new Error('network'));
    await act(async () => {
      await expect(refreshFn()).resolves.toBe(false);
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

  // 버전을 읽는 쪽(BetSheet의 INSUFFICIENT_CURRENCY 처리)은 렌더 사이에 끼어드는 비동기
  // 콜백이다 — state를 미러링해 읽으면 응답 적용 직후~다음 렌더 사이에 한 틱 낡은 값을 쥔다.
  // 그래서 버전의 정본은 응답을 적용하는 그 자리에서 오르고, latestCoinsVersion()이 그걸 준다.
  test('최신 잔액 버전은 응답을 적용하는 순간 오른다', async () => {
    mockGet.mockResolvedValue({ data: 500 } as never);
    await renderProvider();
    expect(latestVersionFn()).toBe(1);

    mockGet.mockResolvedValueOnce({ data: 470 } as never);
    let versionAtResponse = 0;
    await act(async () => {
      await refreshFn();
      versionAtResponse = latestVersionFn();
    });
    expect(versionAtResponse).toBe(2);
    expect(screen.getByTestId('version')).toHaveTextContent('2');

    // 실패는 새 잔액이 아니다 — state와 같은 규칙으로 멈춰 있어야 한다.
    mockGet.mockRejectedValueOnce(new Error('network'));
    await act(async () => {
      await refreshFn();
    });
    expect(latestVersionFn()).toBe(2);
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
    let pendingA: Promise<boolean> = Promise.resolve(false);
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
    // HTTP는 성공했어도 반영되지 않았으므로 반환은 false다(GROMO-1024) — true로 치면
    // 'B가 실패했는데 A 덕에 동기화됐다'는 거짓 확정의 근거가 될 수 있다.
    await act(async () => {
      finishA({ data: 500 });
      await expect(pendingA).resolves.toBe(false);
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
    let pendingA: Promise<boolean> = Promise.resolve(false);
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

  // 반환값 계약(GROMO-1024) — 소비자(GroupRoomScreen)는 '잔액 동기화 성공'을 확인한 뒤에만
  // 정산 서명을 확정한다. 반환이 거짓말하면(실패·미반영을 true로) 서명이 확정돼 이후 조회가
  // 같은 서명으로 판단하고, 잔액 재동기화 재시도가 영구히 소멸한다.
  test('반영에 성공하면 true, 실패하면 false를 반환한다', async () => {
    mockGet.mockResolvedValueOnce({ data: 500 } as never);
    await renderProvider();

    mockGet.mockResolvedValueOnce({ data: 470 } as never);
    let result = false;
    await act(async () => {
      result = await refreshFn();
    });
    expect(result).toBe(true);

    mockGet.mockRejectedValueOnce(new Error('network'));
    await act(async () => {
      result = await refreshFn();
    });
    expect(result).toBe(false);
  });
});

// 세션 보상 지급의 서버 전환(B5a) — 클라가 금액을 정해 적립하는 /currency/earn은 내기 코인
// 민팅 악용 벡터라 서버가 no-op으로 폐쇄했고, 지급은 세션 저장 트랜잭션이 수행한다.
// 여기서 잠그는 것: ① addCoins가 서버를 다시 부르기 시작하지 않는다(낙관 가산만),
// ② 저장 응답의 awardedCoins(서버 정본) 유/무 분기 — 있으면 그 값으로 정정, 없으면 낙관 유지.
describe('세션 보상 — 서버 지급 전환', () => {
  test('addCoins는 낙관 가산만 하고 /currency/earn을 호출하지 않는다', async () => {
    mockGet.mockResolvedValue({ data: 100 } as never);
    await renderProvider();

    await act(async () => {
      addCoinsFn(7);
    });
    expect(screen.getByTestId('coins')).toHaveTextContent('107');
    expect(mockPost).not.toHaveBeenCalled();
  });

  test('awardedCoins가 있으면 낙관 가산을 서버 지급액으로 정정한다', async () => {
    mockGet.mockResolvedValue({ data: 100 } as never);
    await renderProvider();

    // 낙관 +7 → 서버는 이 세션에 9를 지급했다(공식 어긋남) — 최종 반영은 서버 값 9여야 한다.
    await act(async () => {
      addCoinsFn(7);
      reconcileFn(7, 9);
    });
    expect(screen.getByTestId('coins')).toHaveTextContent('109');
  });

  test('awardedCoins가 없으면(구서버) 낙관 계산을 유지한다', async () => {
    mockGet.mockResolvedValue({ data: 100 } as never);
    await renderProvider();

    await act(async () => {
      addCoinsFn(7);
      reconcileFn(7, undefined);
    });
    expect(screen.getByTestId('coins')).toHaveTextContent('107');
  });

  test('낙관 가산 없이 저장된 세션(고아 재시도)은 지급액이 통째로 반영된다', async () => {
    mockGet.mockResolvedValue({ data: 100 } as never);
    await renderProvider();

    await act(async () => {
      reconcileFn(0, 9);
    });
    expect(screen.getByTestId('coins')).toHaveTextContent('109');
  });

  // 콜드 스타트 경합(코덱스 리뷰 P1) — 마운트 refresh가 떠 있는 채 고아 정산이 서버 지급을
  // 정정하면, 그 조회의 스냅샷은 지급 전/후가 모호하다. 지급 전 잔액이면 방금 정정한 보상을
  // 지우고(증발), 지급 후 잔액이면 정정과 겹쳐 이중 표시된다. 정정 이전에 시작된 조회는 버린다.
  test('정정 전에 시작된 조회의 응답은 정정을 덮지 않는다', async () => {
    mockGet.mockResolvedValueOnce({ data: 100 } as never);
    await renderProvider();

    // 지급 전 잔액(100)을 물고 늘어지는 조회 A — 응답 전에 고아 정산의 지급 정정이 끼어든다.
    let finishA: (v: { data: number }) => void = () => {};
    mockGet.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishA = resolve as (v: { data: number }) => void;
        }) as never,
    );
    let pendingA: Promise<boolean> = Promise.resolve(false);
    await act(async () => {
      pendingA = refreshFn();
    });

    // 고아 재시도 런의 지급 반영 — 낙관분 없이 +7 (서버 잔액은 이제 107).
    await act(async () => {
      reconcileFn(0, 7);
    });
    expect(screen.getByTestId('coins')).toHaveTextContent('107');

    // A가 이제야 지급 전 스냅샷(100)을 들고 도착 — 반영하면 보상이 증발한다. 버려야 한다.
    await act(async () => {
      finishA({ data: 100 });
      await expect(pendingA).resolves.toBe(false);
    });
    expect(screen.getByTestId('coins')).toHaveTextContent('107');
  });

  test('정정 전에 시작된 조회가 지급 후 잔액을 들고 와도 이중 표시되지 않는다', async () => {
    mockGet.mockResolvedValueOnce({ data: 100 } as never);
    await renderProvider();

    let finishA: (v: { data: number }) => void = () => {};
    mockGet.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishA = resolve as (v: { data: number }) => void;
        }) as never,
    );
    await act(async () => {
      refreshFn();
    });

    await act(async () => {
      reconcileFn(0, 7); // 화면 107
    });

    // A의 스냅샷이 하필 지급 후(107)였다면 — 반영해도 같은 값이지만, 반영을 허용하는 순간
    // '정정 +7'과 '조회 107'의 순서 조합에 따라 114가 될 수 있는 구조가 된다. 일괄 폐기가 안전.
    await act(async () => {
      finishA({ data: 107 });
    });
    expect(screen.getByTestId('coins')).toHaveTextContent('107');
  });

  // 같은 경합의 나머지 절반(GROMO-1049) — 정정(reconcile)이 아니라 **낙관 가산(addCoins)** 이
  // 조회 중에 끼어드는 구간. 세션 저장 응답이 오기 전에 화면부터 올려두는 게 낙관 가산인데,
  // 그동안 떠 있던 조회가 가산 전 잔액을 들고 도착하면 지급액이 화면에서 사라진다.
  //
  // 정정과 달리 응답을 **버리면 안 된다** — 낙관 가산은 순수 로컬이라 서버 스냅샷과 배타적이지
  // 않고, 버리면 아직 반영 못 한 기저 잔액까지 통째로 잃는다(아래 콜드 스타트 케이스).
  // 서버 잔액 위에 '조회 시작 이후의 가산분'을 얹는 게 정답이다.
  test('낙관 가산 전에 시작된 조회는 서버 잔액 위에 가산분을 얹어 반영한다', async () => {
    mockGet.mockResolvedValueOnce({ data: 100 } as never);
    await renderProvider();

    // 가산 전 잔액(100)을 물고 있는 조회 A — 응답 전에 고아 정산이 낙관 가산을 넣는다.
    let finishA: (v: { data: number }) => void = () => {};
    mockGet.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishA = resolve as (v: { data: number }) => void;
        }) as never,
    );
    let pendingA: Promise<boolean> = Promise.resolve(false);
    await act(async () => {
      pendingA = refreshFn();
    });

    await act(async () => {
      addCoinsFn(7);
    });
    expect(screen.getByTestId('coins')).toHaveTextContent('107');

    // A가 이제야 가산 전 스냅샷(100)을 들고 도착 — 100 + 7 로 적용해야 +7이 살아남는다.
    await act(async () => {
      finishA({ data: 100 });
      await expect(pendingA).resolves.toBe(true);
    });
    expect(screen.getByTestId('coins')).toHaveTextContent('107');
  });

  // 코덱스 리뷰 P1의 실제 시나리오 — 위 테스트는 renderProvider()가 마운트 refresh를 먼저
  // 흘려보내 기저 잔액이 이미 화면에 있는 상태였다. 진짜 콜드 스타트는 **마운트 refresh가 끝나기
  // 전에** 고아 정산이 도는 순서다. 이때 응답을 버리면 coins가 초기값 0에서 출발해 0+7=7이 되고,
  // 서버 잔액 100이 통째로 사라진다(reconcile 차액도 0이라 복구 안 됨).
  test('콜드 스타트 — 마운트 조회가 끝나기 전 낙관 가산이 와도 기저 잔액을 잃지 않는다', async () => {
    let finishMount: (v: { data: number }) => void = () => {};
    mockGet.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishMount = resolve as (v: { data: number }) => void;
        }) as never,
    );
    // 마운트 refresh를 **미해결 상태로** 두고 렌더한다(renderProvider와 달리 흘리지 않는다).
    await render(
      <CoinProvider>
        <Probe />
      </CoinProvider>,
    );

    // 아직 서버 잔액이 안 왔다 — 화면은 0(미상).
    await act(async () => {
      addCoinsFn(7);
    });
    expect(screen.getByTestId('coins')).toHaveTextContent('7');

    // 이제 마운트 조회가 서버 잔액 100을 들고 도착 — 100 + 7 = 107 이어야 한다.
    await act(async () => {
      finishMount({ data: 100 });
    });
    expect(screen.getByTestId('coins')).toHaveTextContent('107');

    // 뒤이은 저장 응답 정정(낙관 7 = 서버 지급 7)은 차액 0이라 잔액을 건드리지 않는다.
    await act(async () => {
      reconcileFn(7, 7);
    });
    expect(screen.getByTestId('coins')).toHaveTextContent('107');
  });

  test('낙관 가산 이후에 시작된 조회는 정상 반영된다', async () => {
    mockGet.mockResolvedValueOnce({ data: 100 } as never);
    await renderProvider();

    await act(async () => {
      addCoinsFn(7);
    });

    // 가산 뒤 새로 시작한 조회 — 서버 정본(107)이 그대로 실려야 한다(영구 폐기 아님).
    mockGet.mockResolvedValueOnce({ data: 107 } as never);
    let result = false;
    await act(async () => {
      result = await refreshFn();
    });
    expect(result).toBe(true);
    expect(screen.getByTestId('coins')).toHaveTextContent('107');
  });

  test('정정 이후에 시작된 조회는 정상 반영된다', async () => {
    mockGet.mockResolvedValueOnce({ data: 100 } as never);
    await renderProvider();

    await act(async () => {
      reconcileFn(0, 7);
    });

    // 정정 뒤 새로 시작한 조회 — 서버 정본(107)이 그대로 실려야 한다(영구 폐기 아님).
    mockGet.mockResolvedValueOnce({ data: 107 } as never);
    let result = false;
    await act(async () => {
      result = await refreshFn();
    });
    expect(result).toBe(true);
    expect(screen.getByTestId('coins')).toHaveTextContent('107');
  });

  // 정정은 차액 방식이다 — 뽀모도로처럼 블록 저장이 겹칠 때 전체 잔액을 덮어쓰면 아직 저장
  // 안 된 다른 블록의 낙관 가산이 지워진다. 블록별 정정이 서로를 건드리지 않아야 한다.
  test('겹친 블록들의 정정은 서로의 낙관 가산을 지우지 않는다', async () => {
    mockGet.mockResolvedValue({ data: 100 } as never);
    await renderProvider();

    await act(async () => {
      addCoinsFn(7); // 블록1 낙관
      addCoinsFn(5); // 블록2 낙관 (저장 진행 중)
      reconcileFn(7, 8); // 블록1 저장 응답 — 블록2의 +5는 그대로여야 한다
    });
    expect(screen.getByTestId('coins')).toHaveTextContent('113'); // 100 + 8 + 5
  });
});

describe('buyItem', () => {
  test('spend 페이로드는 정식 필드 type으로 보낸다(구 reason 아님)', async () => {
    mockGet.mockResolvedValue({ data: 500 } as never);
    mockPost.mockResolvedValue({} as never);
    await renderProvider();

    let bought = false;
    await act(async () => {
      bought = await buyItemFn('hat-1', 30);
    });
    expect(bought).toBe(true);
    expect(mockPost).toHaveBeenCalledWith('/api/v1/currency/spend', {
      amount: 30,
      type: 'PURCHASE',
    });
    expect(screen.getByTestId('coins')).toHaveTextContent('470');
  });
});
