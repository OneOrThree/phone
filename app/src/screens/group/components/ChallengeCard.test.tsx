// ChallengeCard 진행 3상 렌더 + 방장 삭제 테스트 — 명세 docs/app/group-plan-2.md §3-2.
//
// 여기서 잠그는 것:
//  1) 진행 표기 3상. `progressMinutes: 0`(집중을 아직 안 함)과 `null`(스크린타임 미집계)은
//     완전히 다른 뜻인데 falsy 하나로 뭉개면 둘 다 같은 칸으로 보인다.
//  2) 삭제는 방장만, 그리고 **확인 Alert를 거친 뒤에만** onDelete가 불린다 —
//     롱프레스 오탭으로 챌린지가 사라지면 되돌릴 방법이 없다.
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Alert } from 'react-native';
import ChallengeCard from './ChallengeCard';
import type { ChallengeMemberProgress, GroupChallengeResponse } from '@/types/dto/group';

const CHALLENGE_ID = '0197e0c3-4d1b-7a2e-9f60-3b7c1f2a8d66';
const onDelete = jest.fn();

function progress(over: Partial<ChallengeMemberProgress> = {}): ChallengeMemberProgress {
  return { userId: 'u1', nickname: '재영', progressMinutes: 32, achieved: false, ...over };
}

function challenge(over: Partial<GroupChallengeResponse> = {}): GroupChallengeResponse {
  return {
    id: CHALLENGE_ID,
    missionType: 'DURATION',
    missionCategory: 'FOCUS',
    durationMinutes: 60,
    windowStart: null,
    windowEnd: null,
    status: 'ACTIVE',
    createdAt: '2026-08-01T06:00:00',
    canParticipate: true,
    memberProgress: [progress()],
    ...over,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('미션 라벨', () => {
  test('DURATION은 카테고리에 따라 집중/스크린타임으로 갈린다', async () => {
    await render(<ChallengeCard challenge={challenge()} isOwner={false} onDelete={onDelete} />);
    expect(screen.getByText('하루 60분 집중')).toBeOnTheScreen();

    await render(
      <ChallengeCard
        challenge={challenge({ missionCategory: 'SCREEN_TIME' })}
        isOwner={false}
        onDelete={onDelete}
      />,
    );
    expect(screen.getByText('하루 60분 스크린타임')).toBeOnTheScreen();
  });

  test('TIME_WINDOW는 HH:mm 구간으로 적는다(서버 HH:mm:ss를 잘라 쓴다)', async () => {
    await render(
      <ChallengeCard
        challenge={challenge({
          missionType: 'TIME_WINDOW',
          durationMinutes: null,
          windowStart: '09:00:00',
          windowEnd: '11:00:00',
          // 서버가 TIME_WINDOW 진행률을 지원하지 않아 항상 null이다(백 명세 결정 3).
          memberProgress: null,
        })}
        isOwner={false}
        onDelete={onDelete}
      />,
    );
    expect(screen.getByText('매일 09:00~11:00 집중')).toBeOnTheScreen();
    // 진행 리스트 자체가 없다 — 빈 리스트로 그리면 '아무도 안 했다'로 읽힌다.
    expect(screen.queryByText('재영')).toBeNull();
  });
});

describe('멤버 진행 3상', () => {
  test('달성 · 진행 중 · 미집계를 각각 다르게 적는다', async () => {
    await render(
      <ChallengeCard
        challenge={challenge({
          missionCategory: 'SCREEN_TIME',
          memberProgress: [
            progress({ userId: 'u1', nickname: '재영', progressMinutes: 40, achieved: true }),
            progress({ userId: 'u2', nickname: '수빈', progressMinutes: 90, achieved: false }),
            progress({ userId: 'u3', nickname: '민지', progressMinutes: null, achieved: null }),
          ],
        })}
        isOwner={false}
        onDelete={onDelete}
      />,
    );

    expect(screen.getByText('달성 ✓')).toBeOnTheScreen();
    expect(screen.getByText('90/60분')).toBeOnTheScreen();
    expect(screen.getByText('—')).toBeOnTheScreen();
  });

  test('progressMinutes 0은 미집계(—)가 아니라 0분으로 적는다', async () => {
    await render(
      <ChallengeCard
        challenge={challenge({
          memberProgress: [progress({ progressMinutes: 0, achieved: false })],
        })}
        isOwner={false}
        onDelete={onDelete}
      />,
    );
    expect(screen.getByText('0/60분')).toBeOnTheScreen();
    expect(screen.queryByText('—')).toBeNull();
  });
});

describe('캡션', () => {
  test('SCREEN_TIME 카드는 목표의 방향(이하)을 한 줄로 알린다', async () => {
    await render(
      <ChallengeCard
        challenge={challenge({ missionCategory: 'SCREEN_TIME' })}
        isOwner={false}
        onDelete={onDelete}
      />,
    );
    expect(screen.getByText('오늘 스크린타임을 목표 이하로 유지해요')).toBeOnTheScreen();
  });

  test('FOCUS 카드에는 스크린타임 캡션을 붙이지 않는다', async () => {
    await render(<ChallengeCard challenge={challenge()} isOwner={false} onDelete={onDelete} />);
    expect(screen.queryByText('오늘 스크린타임을 목표 이하로 유지해요')).toBeNull();
  });

  test('canParticipate=false면 참여 불가 사유를 노출한다', async () => {
    await render(
      <ChallengeCard
        challenge={challenge({ missionCategory: 'SCREEN_TIME', canParticipate: false })}
        isOwner={false}
        onDelete={onDelete}
      />,
    );
    expect(screen.getByText('스크린타임 권한이 없어 참여할 수 없어요')).toBeOnTheScreen();
  });
});

describe('방장 삭제', () => {
  test('롱프레스 → 확인 Alert의 삭제를 눌러야 onDelete가 불린다', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    await render(<ChallengeCard challenge={challenge()} isOwner onDelete={onDelete} />);

    await act(async () => {
      fireEvent(screen.getByTestId(`group.challenge.card.${CHALLENGE_ID}`), 'longPress');
    });

    expect(alertSpy).toHaveBeenCalledTimes(1);
    // Alert만 뜬 시점에는 아직 아무것도 지우지 않는다.
    expect(onDelete).not.toHaveBeenCalled();

    // 확인 버튼을 직접 눌러본다.
    const buttons = alertSpy.mock.calls[0][2];
    buttons?.find((b) => b.text === '삭제')?.onPress?.();
    expect(onDelete).toHaveBeenCalledWith(CHALLENGE_ID);
  });

  test('방장이 아니면 롱프레스가 아무 일도 하지 않는다', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    await render(<ChallengeCard challenge={challenge()} isOwner={false} onDelete={onDelete} />);

    await act(async () => {
      fireEvent(screen.getByTestId(`group.challenge.card.${CHALLENGE_ID}`), 'longPress');
    });

    expect(alertSpy).not.toHaveBeenCalled();
    expect(onDelete).not.toHaveBeenCalled();
  });
});
