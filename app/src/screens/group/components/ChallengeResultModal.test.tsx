// 챌린지 결과 모달 — 헤드라인 그림 계약(GROMO-1087).
// 시스템 이모지에서 캐릭터 에셋으로 갈아탔으므로, 세 결과 상태가 각각 정해진 에셋을 쓰고
// 스크린리더가 상태를 읽을 수 있는지를 고정한다. 크기·여백 같은 시각 품질은 QA 몫이라 보지 않는다.
import { fireEvent, render, screen } from '@testing-library/react-native';
import ChallengeResultModal, { createListOverflowFlasher } from './ChallengeResultModal';
import { WINDOW_FOCUS_TOLERANCE_NOTICE } from './progressFormat';
import type { ChallengeResultCandidate } from '../challengeResult';

function candidate(myAchieved: boolean | null): ChallengeResultCandidate {
  return {
    challengeId: 'c1',
    date: '2026-08-01',
    missionType: 'TIME_WINDOW',
    missionCategory: 'FOCUS',
    label: '오전 9시까지 집중',
    goalMinutes: 60,
    achievers: [{ userId: 'u1', nickname: '재영', progressMinutes: 72 }],
    failed: [{ userId: 'u2', nickname: '수빈', progressMinutes: 23 }],
    pending: [],
    myAchieved,
    memberCount: 2,
    hadBet: false,
  };
}

const CHARACTER = 'group.challengeResult.character';

// 헤드라인은 팝인 연출의 시작 프레임(opacity 0) 안에 있어 RNTL이 기본 질의에서 숨김 처리한다.
// 연출 진행이 아니라 그림 자체가 관심사라 숨김 포함으로 집는다.
function characterImage() {
  return screen.getByTestId(CHARACTER, { includeHiddenElements: true });
}

describe('ChallengeResultModal 헤드라인 그림', () => {
  // 결과 상태 → 에셋 매핑을 못으로 박는다. 세 상태가 같은 그림으로 뭉개지면(예: 복붙 실수)
  // 화면상으로는 멀쩡해 보이므로 여기서 잡는다.
  test.each([
    [true, require('@/assets/character_happy.png'), '달성'],
    [false, require('@/assets/character_sensitive.png'), '놓쳐'],
    [null, require('@/assets/character_study.png'), '집계'],
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
describe('ChallengeResultModal 판정 근거', () => {
  const shown = (text: string) => screen.getByText(text, { includeHiddenElements: true });

  test('사람마다 기록 분을 목표와 함께 적는다', async () => {
    await render(<ChallengeResultModal result={candidate(true)} onClose={jest.fn()} />);
    expect(shown('72/60분')).toBeOnTheScreen();
    expect(shown('23/60분')).toBeOnTheScreen();
  });

  test('미집계는 0분으로 뭉개지 않고 —로 비운다', async () => {
    const result = {
      ...candidate(null),
      achievers: [],
      failed: [],
      pending: [{ userId: 'u3', nickname: '민지', progressMinutes: null }],
    };
    await render(<ChallengeResultModal result={result} onClose={jest.fn()} />);
    expect(shown('—')).toBeOnTheScreen();
    expect(screen.queryByText('0/60분', { includeHiddenElements: true })).toBeNull();
  });

  test('목표를 모르는 챌린지는 분모를 지어내지 않는다', async () => {
    // 구 창 챌린지 — durationMinutes가 없어 판정 기준을 앱이 알 수 없다.
    const result = {
      ...candidate(true),
      goalMinutes: null,
      achievers: [{ userId: 'u1', nickname: '재영', progressMinutes: 72 }],
      failed: [],
    };
    await render(<ChallengeResultModal result={result} onClose={jest.fn()} />);
    expect(shown('72분')).toBeOnTheScreen();
    expect(screen.queryByText(/\//, { includeHiddenElements: true })).toBeNull();
  });

  // 이름과 분이 따로 읽히면 누구 기록인지 잃는다 — 행 전체를 한 덩어리로 읽어야 한다.
  // 문구는 카드 진행 리스트와 **같은 조각**을 쓴다(progressFormat) — 같은 상태를 두 화면이
  // 다른 문장으로 읽어 주던 것을 통일했다(PR #493 리뷰).
  test('스크린리더는 행을 한 덩어리로 읽는다', async () => {
    await render(<ChallengeResultModal result={candidate(true)} onClose={jest.fn()} />);
    expect(
      screen.getByLabelText('재영 60분 중 72분', { includeHiddenElements: true }),
    ).toBeOnTheScreen();
  });

  test('미집계 행은 뜻을 말로 옮겨 읽는다 — VoiceOver는 —를 "대시"로 발음한다', async () => {
    const result = {
      ...candidate(null),
      achievers: [],
      failed: [],
      pending: [{ userId: 'u3', nickname: '민지', progressMinutes: null }],
    };
    await render(<ChallengeResultModal result={result} onClose={jest.fn()} />);
    expect(
      screen.getByLabelText('민지 아직 집계되지 않음', { includeHiddenElements: true }),
    ).toBeOnTheScreen();
  });
});

// 5분 관용치 고지(GROMO-1217) — 창형 집중은 목표에서 5분 모자라도 달성인데(서버
// WindowFocusAggregator, 관용치 5분) 근거 분은 원값 그대로라, 고지가 없으면 달성 명단의
// '55/60분'이 모순으로 읽힌다. 문구는 progressFormat의 공용 상수를 그대로 잠근다.
describe('ChallengeResultModal 5분 관용치 고지', () => {
  const NOTICE = WINDOW_FOCUS_TOLERANCE_NOTICE;
  const notice = () =>
    screen.queryByTestId('group.challengeResult.toleranceNotice', {
      includeHiddenElements: true,
    });

  test('창형 집중(FOCUS×TIME_WINDOW)은 55/60 달성자가 모순으로 읽히지 않게 고지를 세운다', async () => {
    // 정확한 회귀 재현 — 목표 60분에 55분 기록으로 달성 판정된 멤버.
    const result = {
      ...candidate(true),
      achievers: [{ userId: 'u1', nickname: '재영', progressMinutes: 55 }],
      failed: [],
    };
    await render(<ChallengeResultModal result={result} onClose={jest.fn()} />);
    // 고지가 뜨고, 1191의 근거 분 행은 그대로 남는다(고지가 표기를 바꾸지 않는다).
    expect(screen.getByText(NOTICE, { includeHiddenElements: true })).toBeOnTheScreen();
    expect(screen.getByText('55/60분', { includeHiddenElements: true })).toBeOnTheScreen();
  });

  // 구 창 챌린지(durationMinutes 없음)도 서버는 자기 목표에 관용치를 그대로 적용한다 —
  // 앱이 분모를 몰라도 고지는 여전히 참이라 **의도적으로** 세운다(PR #494 리뷰로 고정).
  test('목표를 모르는 창형 집중에도 고지를 세운다 — 분모 없는 표기와 함께', async () => {
    const result = {
      ...candidate(true),
      goalMinutes: null,
      achievers: [{ userId: 'u1', nickname: '재영', progressMinutes: 55 }],
      failed: [],
    };
    await render(<ChallengeResultModal result={result} onClose={jest.fn()} />);
    expect(screen.getByText(NOTICE, { includeHiddenElements: true })).toBeOnTheScreen();
    // 분모는 지어내지 않는다(1191 규칙 그대로) — 고지가 표기 규칙을 바꾸지 않는다.
    expect(screen.getByText('55분', { includeHiddenElements: true })).toBeOnTheScreen();
    expect(screen.queryByText('55/60분', { includeHiddenElements: true })).toBeNull();
  });

  test('DURATION 결과에는 고지가 없다(정확 임계 — 관용치가 없다)', async () => {
    await render(
      <ChallengeResultModal
        result={{ ...candidate(true), missionType: 'DURATION' }}
        onClose={jest.fn()}
      />,
    );
    expect(notice()).toBeNull();
  });

  test('SCREEN_TIME 창형 결과에는 고지가 없다(이하 판정 — 관용치가 없다)', async () => {
    await render(
      <ChallengeResultModal
        result={{ ...candidate(true), missionCategory: 'SCREEN_TIME' as const }}
        onClose={jest.fn()}
      />,
    );
    expect(notice()).toBeNull();
  });

  // 고지는 시각 전용 장식이 아니다 — 스크린리더도 같은 규칙을 들어야 "60분 중 55분"이
  // 달성 섹션에서 모순으로 들리지 않는다. Text의 접근 가능한 본문으로 노출됨을 잠근다.
  test('고지는 접근 가능한 텍스트로 읽히고, 기존 행 음성 안내는 그대로다', async () => {
    const result = {
      ...candidate(true),
      achievers: [{ userId: 'u1', nickname: '재영', progressMinutes: 55 }],
      failed: [],
    };
    await render(<ChallengeResultModal result={result} onClose={jest.fn()} />);
    expect(screen.getByText(NOTICE, { includeHiddenElements: true })).toBeOnTheScreen();
    expect(
      screen.getByLabelText('재영 60분 중 55분', { includeHiddenElements: true }),
    ).toBeOnTheScreen();
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

  // iOS는 유휴 상태에선 인디케이터가 안 보인다 — 넘침 확정 시 깜빡임 핸들러가 배선되어
  // 있어야 한다. 호출 조건 자체는 아래 팩토리 단위 테스트가 잠근다(ref 인스턴스는 밖에서
  // 관찰할 수 없어 로직을 분리했다 — 코덱스 리뷰 P2).
  test('넘침 판정 핸들러(onLayout·onContentSizeChange)가 배선되어 크래시 없이 동작한다', async () => {
    await render(<ChallengeResultModal result={candidate(true)} onClose={jest.fn()} />);
    expect(typeof lists().props.onLayout).toBe('function');
    expect(typeof lists().props.onContentSizeChange).toBe('function');
    fireEvent(lists(), 'layout', { nativeEvent: { layout: { height: 220 } } });
    fireEvent(lists(), 'contentSizeChange', 260, 400); // 넘침 — flash 경로까지 통과해야 한다
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
});
