// 챌린지 결과 모달 — 정산 결과 통지(GROMO-1279 · IA §4.3).
// 잠그는 것: ① 헤드라인 그림 계약(GROMO-1087 — 상태별 정해진 에셋) ② 판정 근거 표기(GROMO-1191
// — 3상을 뭉개지 않는다) ③ 손익 표기(정산 통지 — payout−stake) ④ 무산·환불 결말 문구(IA §4.3
// "무산·환불도 결과다") ⑤ 명단 넘침 단서(코덱스 P2). 크기·여백 같은 시각 품질은 QA 몫이라 보지 않는다.
import { ScrollView } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';
import ChallengeResultModal, {
  createListOverflowFlasher,
  resultDeltaText,
  settlementNotice,
} from './ChallengeResultModal';
import type { ChallengeResultCandidate } from '../challengeResult';

// jest 프리셋의 ScrollView 목은 flashScrollIndicators를 **프로토타입 공유 jest.fn**으로
// 둔다(@react-native/jest-preset mockComponent.instanceMethods) — ref 인스턴스를 밖에서
// 잡을 수 없어도, 이 공유 목으로 컴포넌트 배선의 실제 호출을 관찰할 수 있다.
const flashScrollIndicators = ScrollView.prototype.flashScrollIndicators as unknown as jest.Mock;

function candidate(
  myAchieved: boolean | null,
  over: Partial<ChallengeResultCandidate> = {},
): ChallengeResultCandidate {
  return {
    sessionId: 's1',
    challengeId: 'c1',
    groupId: 'g1',
    groupName: '아침 6시 집중방',
    date: '2026-08-01',
    status: 'SETTLED',
    voidReason: null,
    stake: 30,
    pot: 60,
    goalMinutes: 60,
    achievers: [{ userId: 'u1', nickname: '재영', progressMinutes: 72, payout: 60 }],
    failed: [{ userId: 'u2', nickname: '수빈', progressMinutes: 23, payout: 0 }],
    pending: [],
    myAchieved,
    myPayout: myAchieved === null ? null : myAchieved ? 60 : 0,
    memberCount: 2,
    ...over,
  };
}

const CHARACTER = 'group.challengeResult.character';

// 헤드라인은 팝인 연출의 시작 프레임(opacity 0) 안에 있어 RNTL이 기본 질의에서 숨김 처리한다.
// 연출 진행이 아니라 그림 자체가 관심사라 숨김 포함으로 집는다.
function characterImage() {
  return screen.getByTestId(CHARACTER, { includeHiddenElements: true });
}

const shown = (text: string) => screen.getByText(text, { includeHiddenElements: true });

describe('ChallengeResultModal 헤드라인 그림', () => {
  // 결과 상태 → 에셋 매핑을 못으로 박는다. 상태가 같은 그림으로 뭉개지면(예: 복붙 실수)
  // 화면상으로는 멀쩡해 보이므로 여기서 잡는다.
  test.each([
    [true, require('@/assets/character_happy.png'), '달성'],
    [false, require('@/assets/character_sensitive.png'), '놓쳐'],
    [null, require('@/assets/character_study.png'), '판정'],
  ])(
    'myAchieved=%s면 정해진 캐릭터 에셋과 상태 레이블이 붙는다',
    async (myAchieved, source, word) => {
      await render(
        <ChallengeResultModal
          result={candidate(myAchieved as boolean | null)}
          onClose={jest.fn()}
        />,
      );
      const image = characterImage();
      expect(image.props.source).toBe(source);
      expect(image.props.accessibilityRole).toBe('image');
      expect(image.props.accessibilityLabel).toContain(word);
    },
  );

  // 무산·환불은 승패 축이 아니다 — myAchieved가 무엇이든 승패 캐릭터·문구를 세우면 거짓말이 된다.
  test('VOIDED는 승패 대신 무산 헤드라인을 세운다', async () => {
    await render(
      <ChallengeResultModal
        result={candidate(null, { status: 'VOIDED', voidReason: 'SHORT_PARTICIPANTS' })}
        onClose={jest.fn()}
      />,
    );
    expect(shown('내기가 무산됐어요')).toBeOnTheScreen();
  });

  test('REFUNDED는 환불 헤드라인을 세운다', async () => {
    await render(
      <ChallengeResultModal result={candidate(null, { status: 'REFUNDED' })} onClose={jest.fn()} />,
    );
    expect(shown('참가비를 돌려드렸어요')).toBeOnTheScreen();
  });

  // 이모지로 되돌아가는 회귀를 막는다 — 헤드라인 자리에 문자 그림이 다시 들어오면 실패.
  test('헤드라인에 시스템 이모지가 남아 있지 않다', async () => {
    await render(<ChallengeResultModal result={candidate(true)} onClose={jest.fn()} />);
    for (const emoji of ['🏆', '😢', '⏳']) {
      expect(screen.queryByText(emoji, { includeHiddenElements: true })).toBeNull();
    }
  });
});

// 판정 근거 표기(GROMO-1191) — "달성/미달성"만 알려주고 몇 분을 해서 그렇게 됐는지
// 말하지 않던 문제를 막는다. 명단이 다시 이름만 남으면 여기서 실패한다.
describe('ChallengeResultModal 판정 근거·손익', () => {
  test('사람마다 기록 분을 목표와 함께 적고, 손익(payout−stake)을 붙인다', async () => {
    await render(<ChallengeResultModal result={candidate(true)} onClose={jest.fn()} />);
    expect(shown('72/60분')).toBeOnTheScreen();
    expect(shown('23/60분')).toBeOnTheScreen();
    expect(shown('+30')).toBeOnTheScreen(); // 재영: 60 받음 − 30 판돈
    expect(shown('-30')).toBeOnTheScreen(); // 수빈: 0 받음 − 30 판돈
  });

  test('미집계는 0분으로 뭉개지 않고 —로 비운다(미판정 payout도 — 숫자를 지어내지 않는다)', async () => {
    const result = candidate(null, {
      achievers: [],
      failed: [],
      pending: [{ userId: 'u3', nickname: '민지', progressMinutes: null, payout: null }],
    });
    await render(<ChallengeResultModal result={result} onClose={jest.fn()} />);
    // 근거 '—'와 손익 '—' 두 칸 — 미판정 행은 숫자를 만들지 않는다.
    expect(screen.getAllByText('—', { includeHiddenElements: true })).toHaveLength(2);
    expect(screen.queryByText('0/60분', { includeHiddenElements: true })).toBeNull();
    expect(shown('미판정 1')).toBeOnTheScreen();
  });

  test('목표를 모르는 회차는 분모를 지어내지 않는다', async () => {
    const result = candidate(true, {
      goalMinutes: null,
      achievers: [{ userId: 'u1', nickname: '재영', progressMinutes: 72, payout: 60 }],
      failed: [],
    });
    await render(<ChallengeResultModal result={result} onClose={jest.fn()} />);
    expect(shown('72분')).toBeOnTheScreen();
    expect(screen.queryByText(/\d\/\d/, { includeHiddenElements: true })).toBeNull();
  });

  // 이름·분·손익이 따로 읽히면 누구 기록인지 잃는다 — 행 전체를 한 덩어리로 읽어야 한다.
  // 문구는 카드 진행 리스트와 **같은 조각**을 쓴다(progressFormat) — PR #493 리뷰의 규칙 유지.
  test('스크린리더는 행을 한 덩어리로 읽는다(근거 + 손익)', async () => {
    await render(<ChallengeResultModal result={candidate(true)} onClose={jest.fn()} />);
    expect(
      screen.getByLabelText('재영 60분 중 72분, 30코인', { includeHiddenElements: true }),
    ).toBeOnTheScreen();
    expect(
      screen.getByLabelText('수빈 60분 중 23분, 마이너스 30코인', { includeHiddenElements: true }),
    ).toBeOnTheScreen();
  });

  test('미집계 행은 뜻을 말로 옮겨 읽는다 — VoiceOver는 —를 "대시"로 발음한다', async () => {
    const result = candidate(null, {
      achievers: [],
      failed: [],
      pending: [{ userId: 'u3', nickname: '민지', progressMinutes: null, payout: null }],
    });
    await render(<ChallengeResultModal result={result} onClose={jest.fn()} />);
    expect(
      screen.getByLabelText('민지 아직 집계되지 않음', { includeHiddenElements: true }),
    ).toBeOnTheScreen();
  });
});

// 정산 결말 문구(IA §4.3) — 돈이 움직였거나 움직이지 않기로 확정된 사건은 전부 알린다.
// 침묵하면 "내 코인 어디 갔지"가 된다.
describe('ChallengeResultModal 정산 결말', () => {
  const notice = () =>
    screen.queryByTestId('group.challengeResult.notice', { includeHiddenElements: true });

  test('SETTLED는 내 손익을 말한다', async () => {
    await render(<ChallengeResultModal result={candidate(true)} onClose={jest.fn()} />);
    expect(shown('내 정산 +30코인')).toBeOnTheScreen();
  });

  test('SETTLED인데 내 payout이 미판정(null)이면 숫자를 지어내지 않는다', async () => {
    await render(
      <ChallengeResultModal result={candidate(true, { myPayout: null })} onClose={jest.fn()} />,
    );
    expect(notice()).toBeNull();
  });

  test('FORFEITED는 적립금 소멸을 말하고 명단은 남긴다', async () => {
    await render(
      <ChallengeResultModal
        result={candidate(false, { status: 'FORFEITED', myPayout: 0 })}
        onClose={jest.fn()}
      />,
    );
    expect(shown('아무도 달성하지 못해 적립금 60코인이 사라졌어요')).toBeOnTheScreen();
    expect(
      screen.getByTestId('group.challengeResult.lists', { includeHiddenElements: true }),
    ).toBeOnTheScreen();
  });

  test('VOIDED(SHORT_PARTICIPANTS)는 인원 부족 문구를 쓰고 명단은 그리지 않는다', async () => {
    await render(
      <ChallengeResultModal
        result={candidate(null, { status: 'VOIDED', voidReason: 'SHORT_PARTICIPANTS' })}
        onClose={jest.fn()}
      />,
    );
    expect(shown('참가자가 부족해 무산됐어요 · 참가비는 돌려드렸어요')).toBeOnTheScreen();
    expect(
      screen.queryByTestId('group.challengeResult.lists', { includeHiddenElements: true }),
    ).toBeNull();
  });

  test('사유를 모르는 VOIDED는 인원 부족이라고 지어내지 않는다', () => {
    expect(settlementNotice(candidate(null, { status: 'VOIDED', voidReason: null }))).toBe(
      '내기가 무산돼 참가비를 돌려드렸어요',
    );
  });

  test('REFUNDED는 정산 지연 환불 문구를 쓴다', async () => {
    await render(
      <ChallengeResultModal result={candidate(null, { status: 'REFUNDED' })} onClose={jest.fn()} />,
    );
    expect(shown('정산이 지연돼 참가비를 돌려드렸어요')).toBeOnTheScreen();
  });

  // 그룹 무관 큐(참가자 스코프)라 모달이 어느 그룹의 결과인지 직접 말해야 한다.
  test('그룹 이름과 날짜를 함께 말한다', async () => {
    await render(<ChallengeResultModal result={candidate(true)} onClose={jest.fn()} />);
    expect(shown('아침 6시 집중방')).toBeOnTheScreen();
    expect(shown('8월 1일 결과')).toBeOnTheScreen();
  });
});

// 손익 표기 단위 규칙 — payout은 '받은 금액'이라 그대로 쓰면 판돈 낸 사실이 지워진다.
describe('resultDeltaText', () => {
  test('payout−stake, +는 붙이고 0·음수는 그대로, null은 —', () => {
    expect(resultDeltaText(60, 30)).toBe('+30');
    expect(resultDeltaText(30, 30)).toBe('0');
    expect(resultDeltaText(0, 30)).toBe('-30');
    expect(resultDeltaText(null, 30)).toBe('—');
  });
});

// 명단 넘침 신호(GROMO-1217) — 1191부터 행이 인원수만큼 늘어나는데 maxHeight에 잘려도
// 인디케이터가 꺼져 있어 더 있는지 보이지 않았다. 인디케이터 프롭 3종을 잠근다.
describe('ChallengeResultModal 명단 스크롤 인디케이터', () => {
  const lists = () =>
    screen.getByTestId('group.challengeResult.lists', { includeHiddenElements: true });

  test('세로 인디케이터를 켠다(iOS white·Android persistent)', async () => {
    await render(<ChallengeResultModal result={candidate(true)} onClose={jest.fn()} />);
    expect(lists().props.showsVerticalScrollIndicator).toBe(true);
    expect(lists().props.indicatorStyle).toBe('white');
    expect(lists().props.persistentScrollbar).toBe(true);
  });

  const flashCalls = () => flashScrollIndicators.mock.calls.length;

  beforeEach(() => {
    flashScrollIndicators.mockClear();
  });

  // iOS는 유휴 상태에선 인디케이터가 안 보인다 — 넘침 확정 시 깜빡임이 실제 네이티브
  // 커맨드까지 나가는지를 잠근다. 호출 조건의 경계는 아래 팩토리 단위 테스트가 잠근다
  // (ref 인스턴스는 밖에서 관찰할 수 없어 로직을 분리했다 — 코덱스 리뷰 P2).
  test('넘침이 확정되면 flashScrollIndicators가 실제로 호출된다', async () => {
    await render(<ChallengeResultModal result={candidate(true)} onClose={jest.fn()} />);
    await fireEvent(lists(), 'layout', { nativeEvent: { layout: { height: 220 } } });
    expect(flashCalls()).toBe(0); // 컨텐츠 미확정 — 아직 판단하지 않는다
    await fireEvent(lists(), 'contentSizeChange', 260, 400); // 넘침 확정
    expect(flashCalls()).toBe(1);
  });

  // 결과 큐가 같은 모달 인스턴스로 진행된다(GroupRoomScreen) — 멤버 수가 같아 렌더 높이가
  // 그대로면 onContentSizeChange가 다시 오지 않으므로, 결과 키(세션) 변경이 리셋 경로를 타서
  // 두 번째 결과에도 넘침 단서가 나가야 한다(코덱스 리뷰 P2 2차).
  test('높이가 같은 다음 결과로 갈리면 사이즈 이벤트 없이도 다시 깜빡인다', async () => {
    const view = await render(
      <ChallengeResultModal result={candidate(true)} onClose={jest.fn()} />,
    );
    const listsInView = () =>
      view.getByTestId('group.challengeResult.lists', { includeHiddenElements: true });
    await fireEvent(listsInView(), 'layout', { nativeEvent: { layout: { height: 220 } } });
    await fireEvent(listsInView(), 'contentSizeChange', 260, 400);
    expect(flashCalls()).toBe(1);
    // 같은 높이의 다른 결과 — 사이즈 이벤트를 다시 쏘지 않는다(실기기에서 안 오는 상황 재현).
    await view.rerender(
      <ChallengeResultModal result={candidate(true, { sessionId: 's2' })} onClose={jest.fn()} />,
    );
    expect(flashCalls()).toBe(2);
  });
});

// iOS 유휴 넘침 단서의 호출 조건(코덱스 리뷰 P2) — 넘칠 때만, 확정된 뒤에만, 같은 컨텐츠엔
// 한 번만 깜빡인다. 넘치지 않는데 깜빡이면 그 자체가 오신호다.
describe('createListOverflowFlasher — flash 호출 조건', () => {
  test('레이아웃·컨텐츠 높이가 둘 다 확정되고 넘칠 때만 깜빡인다', () => {
    const flash = jest.fn();
    const flasher = createListOverflowFlasher(flash);
    flasher.onLayout(220); // 컨텐츠 미확정 — 아직 판단하지 않는다
    expect(flash).not.toHaveBeenCalled();
    flasher.onContentSizeChange(400); // 넘침 확정
    expect(flash).toHaveBeenCalledTimes(1);
  });

  test('도착 순서가 반대여도(컨텐츠 → 레이아웃) 확정 시점에 깜빡인다', () => {
    const flash = jest.fn();
    const flasher = createListOverflowFlasher(flash);
    flasher.onContentSizeChange(400); // 레이아웃 미확정
    expect(flash).not.toHaveBeenCalled();
    flasher.onLayout(220);
    expect(flash).toHaveBeenCalledTimes(1);
  });

  test('넘치지 않으면(딱 맞음 포함) 깜빡이지 않는다', () => {
    const flash = jest.fn();
    const flasher = createListOverflowFlasher(flash);
    flasher.onLayout(220);
    flasher.onContentSizeChange(220); // 딱 맞음 — 넘침 아님
    flasher.onContentSizeChange(180); // 여유
    expect(flash).not.toHaveBeenCalled();
  });

  test('같은 컨텐츠엔 한 번만 — 레이아웃 재통지(회전 등)로 반복 깜빡이지 않는다', () => {
    const flash = jest.fn();
    const flasher = createListOverflowFlasher(flash);
    flasher.onLayout(220);
    flasher.onContentSizeChange(400);
    flasher.onLayout(220); // 같은 컨텐츠, 레이아웃 재통지
    expect(flash).toHaveBeenCalledTimes(1);
    flasher.onContentSizeChange(500); // 결과 큐 진행 — 컨텐츠가 바뀌면 새 단서
    expect(flash).toHaveBeenCalledTimes(2);
  });

  // 높이 기준 dedup의 사각지대(코덱스 P2 2차) — 멤버 수가 같은 결과가 연속되면 높이가
  // 그대로라 사이즈 이벤트가 다시 오지 않는다. reset이 아는 높이로 즉시 재판정해야 한다.
  test('reset은 중복 가드만 풀고 아는 높이로 즉시 재판정한다 — 같은 높이의 결과 교체', () => {
    const flash = jest.fn();
    const flasher = createListOverflowFlasher(flash);
    flasher.onLayout(220);
    flasher.onContentSizeChange(400);
    expect(flash).toHaveBeenCalledTimes(1);
    flasher.reset(); // 결과 교체 — 사이즈 이벤트 없이도 다시 깜빡인다
    expect(flash).toHaveBeenCalledTimes(2);
  });

  test('reset 시점에 넘치지 않거나 높이 미확정이면 깜빡이지 않는다', () => {
    const flash = jest.fn();
    const flasher = createListOverflowFlasher(flash);
    flasher.reset(); // 첫 마운트 — 높이 미확정, no-op
    expect(flash).not.toHaveBeenCalled();
    flasher.onLayout(220);
    flasher.onContentSizeChange(180); // 넘치지 않는 명단
    flasher.reset(); // 결과가 갈려도 넘침이 없으면 오신호를 만들지 않는다
    expect(flash).not.toHaveBeenCalled();
  });
});
