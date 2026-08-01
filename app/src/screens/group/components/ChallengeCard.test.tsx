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
import { T } from '@/constants/theme';
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
    // 대신 왜 비어 있는지 한 줄로 알린다(그냥 비우면 '아무도 안 했다'로 읽히는 건 마찬가지다).
    expect(screen.getByText('이 챌린지는 진행률을 표시하지 않아요')).toBeOnTheScreen();
  });

  test('라벨을 못 만들면 세그먼트와 같은 카테고리 명칭으로 떨어진다', async () => {
    // durationMinutes 결손 — 라벨 자리에 카테고리명만 남는다. 고르는 자리(세그먼트)와 명칭을 맞춘다.
    await render(
      <ChallengeCard
        challenge={challenge({ durationMinutes: null })}
        isOwner={false}
        onDelete={onDelete}
      />,
    );
    expect(screen.getByText('집중 시간')).toBeOnTheScreen();
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

  test('미집계 —는 실제 값과 다른 색·무게로 그린다', async () => {
    await render(
      <ChallengeCard
        challenge={challenge({
          missionCategory: 'SCREEN_TIME',
          memberProgress: [progress({ progressMinutes: null, achieved: null })],
        })}
        isOwner={false}
        onDelete={onDelete}
      />,
    );

    expect(screen.getByText('—')).toHaveStyle({ color: T.inkFaint, fontWeight: '500' });
    // 기호만으로는 0분인지 값이 없는 건지 알 수 없다 — 카드 하단에 뜻을 적는다.
    expect(screen.getByText('— 는 아직 집계되지 않았어요')).toBeOnTheScreen();
  });

  test('미집계 카드가 아니면 미집계 캡션을 붙이지 않는다', async () => {
    await render(
      <ChallengeCard
        challenge={challenge({ missionCategory: 'SCREEN_TIME' })}
        isOwner={false}
        onDelete={onDelete}
      />,
    );
    expect(screen.queryByText('— 는 아직 집계되지 않았어요')).toBeNull();
  });

  test('achieved=true라도 progressMinutes가 null이면 달성으로 칠하지 않는다', async () => {
    // 서버가 계약을 어긴 조합 — 텍스트는 '—'인데 초록으로 칠하면 달성한 것으로 읽힌다.
    await render(
      <ChallengeCard
        challenge={challenge({
          missionCategory: 'SCREEN_TIME',
          memberProgress: [progress({ progressMinutes: null, achieved: true })],
        })}
        isOwner={false}
        onDelete={onDelete}
      />,
    );
    expect(screen.getByText('—')).not.toHaveStyle({ color: T.successInk });
  });

  test('달성은 색만이 아니라 배경 칩으로도 구분한다', async () => {
    await render(
      <ChallengeCard
        challenge={challenge({
          memberProgress: [progress({ progressMinutes: 70, achieved: true })],
        })}
        isOwner={false}
        onDelete={onDelete}
      />,
    );
    expect(screen.getByText('달성 ✓')).toHaveStyle({
      color: T.successInk,
      backgroundColor: T.successBg,
    });
  });
});

describe('내 행', () => {
  test('내 행을 맨 위로 올리고 강조한다', async () => {
    await render(
      <ChallengeCard
        challenge={challenge({
          memberProgress: [
            progress({ userId: 'u2', nickname: '수빈', progressMinutes: 10 }),
            progress({ userId: 'me', nickname: '나', progressMinutes: 20 }),
            progress({ userId: 'u3', nickname: '민지', progressMinutes: 30 }),
          ],
        })}
        isOwner={false}
        myUserId="me"
        onDelete={onDelete}
      />,
    );

    // 10명이면 닉네임을 눈으로 훑어야 내 진행률을 찾는다 — 내 행이 항상 첫 줄이어야 한다.
    const names = screen.getAllByText(/^(나|수빈|민지)$/).map((el) => el.props.children);
    expect(names).toEqual(['나', '수빈', '민지']);
    expect(screen.getByText('나')).toHaveStyle({ color: T.accentDeep });
  });

  test('myUserId가 없으면 서버 순서를 그대로 둔다', async () => {
    await render(
      <ChallengeCard
        challenge={challenge({
          memberProgress: [
            progress({ userId: 'u2', nickname: '수빈', progressMinutes: 10 }),
            progress({ userId: 'me', nickname: '나', progressMinutes: 20 }),
          ],
        })}
        isOwner={false}
        onDelete={onDelete}
      />,
    );
    const names = screen.getAllByText(/^(나|수빈)$/).map((el) => el.props.children);
    expect(names).toEqual(['수빈', '나']);
  });

  test('행 전체를 하나의 접근성 라벨로 읽는다', async () => {
    await render(
      <ChallengeCard
        challenge={challenge({
          missionCategory: 'SCREEN_TIME',
          memberProgress: [
            progress({ userId: 'u1', nickname: '재영', progressMinutes: null, achieved: null }),
            progress({ userId: 'u2', nickname: '수빈', progressMinutes: 40, achieved: true }),
          ],
        })}
        isOwner={false}
        onDelete={onDelete}
      />,
    );

    // '—'는 VoiceOver가 "대시"로 읽는다 — 뜻을 그대로 담은 라벨로 묶는다.
    expect(screen.getByLabelText('재영 아직 집계되지 않음')).toBeOnTheScreen();
    expect(screen.getByLabelText('수빈 달성')).toBeOnTheScreen();
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

  test('방장에게만 삭제 힌트를 보여준다', async () => {
    await render(<ChallengeCard challenge={challenge()} isOwner onDelete={onDelete} />);
    expect(screen.getByText('길게 눌러 삭제')).toBeOnTheScreen();

    await render(<ChallengeCard challenge={challenge()} isOwner={false} onDelete={onDelete} />);
    expect(screen.queryByText('길게 눌러 삭제')).toBeNull();
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
