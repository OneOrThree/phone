// LeagueDeadline — 탭 전환으로 재마운트돼도 카운트다운이 되감기지 않아야 한다(코덱스 리뷰).
// 이 라벨은 `tab === 'league'` 안에 있어 친구 탭에 다녀오면 언마운트/재마운트된다. '남은 초'를
// 받아 세면 재마운트가 그 값을 처음부터 다시 세어 체류 시간만큼 마감이 뒤로 감긴다 —
// 그래서 절대 마감 시각(epoch ms)을 받는다.
import { act, render, screen } from '@testing-library/react-native';
import { LeagueDeadline } from './LeagueDeadline';

describe('LeagueDeadline', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('재마운트돼도 흐른 시간이 반영된다 — 되감기지 않는다', async () => {
    const deadlineAt = Date.now() + 3600 * 1000; // 1시간 뒤 마감

    const first = await render(<LeagueDeadline deadlineAt={deadlineAt} />);
    expect(screen.getByText('마감 01:00')).toBeTruthy();
    await first.unmount(); // 친구 탭으로 이동

    await act(async () => jest.advanceTimersByTime(10 * 60 * 1000)); // 친구 탭에 10분 체류

    await render(<LeagueDeadline deadlineAt={deadlineAt} />); // 리그 탭 복귀
    expect(screen.getByText('마감 00:50')).toBeTruthy();
  });

  it('머무는 동안 1초 시계로 줄어든다', async () => {
    await render(<LeagueDeadline deadlineAt={Date.now() + 3600 * 1000} />);
    expect(screen.getByText('마감 01:00')).toBeTruthy();

    await act(async () => jest.advanceTimersByTime(60 * 1000));
    expect(screen.getByText('마감 00:59')).toBeTruthy();
  });

  it('마감 정보가 없으면 빈 라벨', async () => {
    await render(<LeagueDeadline deadlineAt={null} />);
    expect(screen.queryByText(/마감/)).toBeNull();
  });
});
