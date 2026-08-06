// 챌린지 결과 모달 — 헤드라인 그림 계약(GROMO-1087).
// 시스템 이모지에서 캐릭터 에셋으로 갈아탔으므로, 세 결과 상태가 각각 정해진 에셋을 쓰고
// 스크린리더가 상태를 읽을 수 있는지를 고정한다. 크기·여백 같은 시각 품질은 QA 몫이라 보지 않는다.
import { render, screen } from '@testing-library/react-native';
import ChallengeResultModal from './ChallengeResultModal';
import type { ChallengeResultCandidate } from '../challengeResult';

function candidate(myAchieved: boolean | null): ChallengeResultCandidate {
  return {
    challengeId: 'c1',
    date: '2026-08-01',
    missionType: 'TIME_WINDOW',
    missionCategory: 'FOCUS',
    label: '오전 9시까지 집중',
    goalMinutes: 60,
    achievers: [{ nickname: '재영', progressMinutes: 72 }],
    failed: [{ nickname: '수빈', progressMinutes: 23 }],
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
      pending: [{ nickname: '민지', progressMinutes: null }],
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
      achievers: [{ nickname: '재영', progressMinutes: 72 }],
      failed: [],
    };
    await render(<ChallengeResultModal result={result} onClose={jest.fn()} />);
    expect(shown('72분')).toBeOnTheScreen();
    expect(screen.queryByText(/\//, { includeHiddenElements: true })).toBeNull();
  });

  // 이름과 분이 따로 읽히면 누구 기록인지 잃는다 — 행 전체를 한 덩어리로 읽어야 한다.
  test('스크린리더는 행을 한 덩어리로 읽는다', async () => {
    await render(<ChallengeResultModal result={candidate(true)} onClose={jest.fn()} />);
    expect(
      screen.getByLabelText('재영, 60분 중 72분', { includeHiddenElements: true }),
    ).toBeOnTheScreen();
  });
});
