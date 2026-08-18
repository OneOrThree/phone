// 축하 3종이 공통 껍데기(CelebrationModal) 위에서 **각자의 구성**을 잃지 않았는지 잠근다.
//
// 세 모달을 하나로 합치면서 잃기 쉬운 것은 연출이 아니라 **조립**이다 — 배지가 있는 모달/없는
// 모달, 문구 아래 pill의 유무, CTA 문구가 파일마다 다르다. 팝·색종이 타이밍은 껍데기의 관심사라
// GoalCelebrationModal.test.tsx가 이미 잠그고 있고, 여기서는 조립만 본다.
import { fireEvent, render, screen } from '@testing-library/react-native';
import { GoalCelebrationModal } from './GoalCelebrationModal';
import { ScreenTimeCelebrationModal } from './ScreenTimeCelebrationModal';
import { WeekStreakModal } from '@/screens/focus/components/WeekStreakModal';

// 화면 모듈을 그대로 import 하면 CharacterContext → UserContext → Firebase analytics 까지 딸려와
// 네이티브 모듈이 없는 jest 환경에서 터진다(GoalCelebrationModal.test.tsx와 같은 이유).
jest.mock('@/store/CharacterContext', () => ({
  useCharacter: () => ({ activeSource: null }),
}));
jest.mock('@/hooks/useReduceMotion', () => ({
  useReduceMotion: () => false,
  useReduceMotionReady: () => true,
  whenReduceMotionReady: () => Promise.resolve(),
}));

describe('축하 모달 3종 조립', () => {
  test('집중 목표 — 배지·제목·보상 pill·CTA', async () => {
    const onClose = jest.fn();
    await render(
      <GoalCelebrationModal
        visible
        goalStreakDays={3}
        goalMinutes={120}
        rewardCoins={30}
        onClose={onClose}
      />,
    );

    expect(screen.getByText(/연속 목표달성/)).toBeTruthy();
    expect(screen.getByText('2시간 집중 목표 달성!')).toBeTruthy();
    expect(screen.getByText(/획득!/)).toBeTruthy();

    await fireEvent.press(screen.getByText('좋아요!'));
    expect(onClose).toHaveBeenCalled();
  });

  test('집중 목표 — 보상이 없으면 pill을 그리지 않는다', async () => {
    await render(<GoalCelebrationModal visible goalStreakDays={1} onClose={() => {}} />);

    expect(screen.queryByText(/획득!/)).toBeNull();
    // 목표 분을 모르면 제목이 일반 문구로 내려간다.
    expect(screen.getByText('오늘 목표 달성!')).toBeTruthy();
  });

  test('스크린타임 목표 — 목표 시간이 문구에 들어간다', async () => {
    await render(
      <ScreenTimeCelebrationModal visible streakDays={5} goalMinutes={180} onClose={() => {}} />,
    );

    expect(screen.getByText(/연속 목표달성/)).toBeTruthy();
    expect(screen.getByText(/3시간 이내로 사용하기 성공했어요/)).toBeTruthy();
    expect(screen.getByText('좋아요!')).toBeTruthy();
  });

  test('주간 스트릭 — 배지 없이 완주 pill과 전용 CTA', async () => {
    await render(<WeekStreakModal visible onClose={() => {}} />);

    expect(screen.queryByText(/연속 목표달성/)).toBeNull(); // 이 모달만 상단 배지가 없다
    expect(screen.getByText('7일 연속 집중 완주')).toBeTruthy();
    expect(screen.getByText('다음 주도 함께해요!')).toBeTruthy();
  });
});
