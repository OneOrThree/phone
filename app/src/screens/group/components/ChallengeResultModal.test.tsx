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
    achievers: ['재영'],
    failed: ['수빈'],
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
