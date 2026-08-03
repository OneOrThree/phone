// 지난 내기 결과 시트 테스트 — GROMO-1099 (Alert 나열 → 앱 컨셉 바텀시트).
//
// 여기서 잠그는 것(전부 Alert 시절부터 물려받은 '돈 표기' 규칙이다):
//  1) payout은 받은 금액이지 손익이 아니다 — 그대로 적으면 판돈 낸 사실이 지워진다(payout - stake).
//  2) 미판정(null)을 0으로 뭉개지 않는다 — '미달성 · -30'으로 보이면 거짓말이 된다(F7).
//  3) 승자 0명의 결말은 상태로 갈린다(REFUNDED 전원 환불 / FORFEITED 소멸) — 인별 행만으론
//     구분이 안 돼 배너가 첫 줄에 못 박는다(F8). 모르는 상태는 배너 없이 행만 그린다.
//  4) 캐릭터는 내 결과를 따라간다 — ChallengeResultModal과 같은 에셋·같은 매핑(화풍 통일).
import { fireEvent, render, screen } from '@testing-library/react-native';
import LastBetResultSheet from './LastBetResultSheet';
import { T } from '@/constants/theme';
import type { LastSettledBet } from '@/types/dto/group';

jest.setTimeout(20000);

// SheetShell이 useSafeAreaInsets를 쓴다 — 테스트 트리엔 SafeAreaProvider가 없어 고정값으로 대체한다.
jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context'),
  useSafeAreaInsets: () => ({ top: 47, left: 0, right: 0, bottom: 34 }),
}));

const onClose = jest.fn();

function lastBet(over: Partial<LastSettledBet> = {}): LastSettledBet {
  return {
    betDate: '2026-07-31',
    stake: 30,
    pot: 90,
    status: 'SETTLED',
    results: [
      { userId: 'u1', nickname: '재영', achieved: true, payout: 45 },
      { userId: 'u2', nickname: '수빈', achieved: true, payout: 45 },
      { userId: 'u3', nickname: '민지', achieved: false, payout: 0 },
    ],
    ...over,
  };
}

function renderSheet(over: Partial<LastSettledBet> = {}, myUserId: string | null = 'u1') {
  return render(<LastBetResultSheet lastBet={lastBet(over)} myUserId={myUserId} onClose={onClose} />);
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('기본 정보', () => {
  test('날짜·참가 인원·참가비·적립금을 전부 적는다(Alert가 담던 정보 유지)', async () => {
    await renderSheet();

    expect(screen.getByText('지난 내기 결과')).toBeOnTheScreen();
    expect(screen.getByText('7월 31일 · 3명 참가')).toBeOnTheScreen();
    expect(screen.getByText('참가비')).toBeOnTheScreen();
    expect(screen.getByText('적립금')).toBeOnTheScreen();
    expect(screen.getByText('30')).toBeOnTheScreen();
    expect(screen.getByText('90')).toBeOnTheScreen();
  });

  test('형식이 다른 날짜는 원문을 그대로 둔다(깨진 날짜보다 원문이 낫다)', async () => {
    await renderSheet({ betDate: '어제' });
    expect(screen.getByText('어제 · 3명 참가')).toBeOnTheScreen();
  });

  test('확인 버튼이 onClose를 부른다', async () => {
    await renderSheet();
    fireEvent.press(screen.getByTestId('group.bet.result.close'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('인별 결과 행', () => {
  test('payout을 손익(payout - stake)으로 환산하고 방향을 색으로도 가른다', async () => {
    await renderSheet();

    // 45 - 판돈 30 = +15. 받은 금액(45)을 그대로 적으면 판돈 낸 사실이 지워진다.
    expect(screen.getAllByText('+15')).toHaveLength(2);
    expect(screen.getAllByText('+15')[0]).toHaveStyle({ color: T.successInk });
    expect(screen.getByText('-30')).toHaveStyle({ color: T.dangerInk });
    expect(screen.getAllByText('달성')).toHaveLength(2);
    expect(screen.getByText('미달성')).toBeOnTheScreen();
  });

  test('미판정(null)은 손익 대신 미판정·—로 적는다(0으로 뭉개지 않는다)', async () => {
    await renderSheet({
      results: [
        { userId: 'u1', nickname: '재영', achieved: true, payout: 60 },
        { userId: 'u2', nickname: '수빈', achieved: null, payout: null },
      ],
    });

    expect(screen.getByText('미판정')).toBeOnTheScreen();
    expect(screen.getByText('—')).toBeOnTheScreen();
    expect(screen.queryByText('-30')).toBeNull();
  });

  test('내 행을 강조한다(카드 진행 리스트의 isMe 관행)', async () => {
    await renderSheet();
    expect(screen.getByText('재영')).toHaveStyle({ color: T.accentDeep });
    expect(screen.getByText('수빈')).not.toHaveStyle({ color: T.accentDeep });
  });

  test('행 전체를 하나의 접근성 라벨로 읽는다 — —는 "대시"로 읽히면 뜻이 사라진다', async () => {
    await renderSheet({
      results: [
        { userId: 'u1', nickname: '재영', achieved: false, payout: 0 },
        { userId: 'u2', nickname: '수빈', achieved: null, payout: null },
      ],
    });
    expect(screen.getByLabelText('재영 미달성, 마이너스 30코인')).toBeOnTheScreen();
    expect(screen.getByLabelText('수빈 미판정')).toBeOnTheScreen();
  });
});

describe('상태 배너(승자 0명의 결말)', () => {
  test('REFUNDED면 전원 환불을 못 박는다 — 손익 0이 "잃었다"로 읽히지 않게', async () => {
    await renderSheet({
      status: 'REFUNDED',
      results: [
        { userId: 'u1', nickname: '재영', achieved: false, payout: 30 },
        { userId: 'u2', nickname: '수빈', achieved: false, payout: 30 },
      ],
    });
    expect(screen.getByText('달성한 사람이 없어 전원 환불됐어요')).toBeOnTheScreen();
    // 환불이라 손익은 0이다 — 배너가 그 0의 뜻을 말한다.
    expect(screen.getAllByText('0')).toHaveLength(2);
  });

  test('FORFEITED면 참가비 소멸을 못 박는다(현 룰의 승자 0명 결말)', async () => {
    await renderSheet({
      status: 'FORFEITED',
      results: [
        { userId: 'u1', nickname: '재영', achieved: false, payout: 0 },
        { userId: 'u2', nickname: '수빈', achieved: false, payout: 0 },
      ],
    });
    expect(screen.getByText('아무도 달성하지 못해 참가비가 소멸됐어요')).toBeOnTheScreen();
    expect(screen.getAllByText('-30')).toHaveLength(2);
  });

  test('SETTLED(모르는 상태 포함)에는 배너를 붙이지 않는다', async () => {
    await renderSheet();
    expect(screen.queryByText('달성한 사람이 없어 전원 환불됐어요')).toBeNull();
    expect(screen.queryByText('아무도 달성하지 못해 참가비가 소멸됐어요')).toBeNull();
  });
});

// 캐릭터는 내 결과를 따라간다 — 신규 그림 없이 ChallengeResultModal의 공용 에셋 3종 재사용.
describe('캐릭터', () => {
  test.each([
    ['u1', require('@/assets/character_happy.png'), '달성해 기뻐하는'],
    ['u3', require('@/assets/character_sensitive.png'), '놓쳐 아쉬워하는'],
    // 명단에 없는 나(관전) — 판정할 내 결과가 없다.
    ['u9', require('@/assets/character_study.png'), '기다리는'],
  ])('내 결과(%s)에 맞는 에셋을 고른다', async (myUserId, asset, labelPart) => {
    await renderSheet({}, myUserId);
    const img = screen.getByTestId('group.bet.result.character');
    expect(img.props.source).toBe(asset);
    expect(img.props.accessibilityLabel).toContain(labelPart);
  });

  test('내 결과가 미판정(null)이어도 기다리는 캐릭터다', async () => {
    await renderSheet(
      { results: [{ userId: 'u1', nickname: '재영', achieved: null, payout: null }] },
      'u1',
    );
    expect(screen.getByTestId('group.bet.result.character').props.source).toBe(
      require('@/assets/character_study.png'),
    );
  });
});
