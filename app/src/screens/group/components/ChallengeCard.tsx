import { Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { T } from '@/constants/theme';
import type { ChallengeMemberProgress, GroupChallengeResponse } from '@/types/dto/group';

// 챌린지 카드(그룹방 챌린지 섹션 1장) — 명세 docs/app/group-plan-2.md §3-2.
//
// 미션 라벨 + 멤버별 진행 리스트. 방장은 롱프레스로 삭제한다(행 안에 버튼을 두면
// 진행 리스트의 시선을 뺏고, 오탭 시 되돌릴 방법이 없다 — 확인 Alert를 한 겹 둔다).
//
// ⚠️ 진행 표기 3상(§3-2) — 0과 null을 뭉개지 않는다:
//     achieved === true   → '달성 ✓'
//     progressMinutes 값  → '32/60분'  (FOCUS는 목표까지 얼마나 채웠나, SCREEN_TIME은 예산을 얼마나 썼나)
//     progressMinutes null→ '—'        (SCREEN_TIME 미집계 — '0분 썼다'와 완전히 다른 뜻이다)
//
// memberProgress 자체가 null이면 리스트 대신 한 줄 캡션을 둔다 — 서버가 TIME_WINDOW 챌린지의
// 진행률을 지원하지 않기 때문(백 명세 결정 3). 앱은 DURATION만 만들지만 1차·수기 데이터로
// 서버에 존재할 수 있고, 아무 설명 없이 비우면 '아무도 안 했다'로 읽힌다.

// SCREEN_TIME 챌린지는 '많이 할수록 좋은' 집중과 반대 방향이라 카드에 뜻을 한 줄 적는다(§3-2).
const SCREEN_TIME_CAPTION = '오늘 스크린타임을 목표 이하로 유지해요';
// 서버가 canParticipate=false를 준 경우 — 스크린타임 권한이 없어 이 그룹에서 집계가 안 된다.
const NO_PERMISSION_CAPTION = '스크린타임 권한이 없어 참여할 수 없어요';
// '—'가 실제로 뜬 SCREEN_TIME 카드에만 — 기호만 봐서는 0분인지 값이 없는 건지 알 수 없다.
const UNMEASURED_CAPTION = '— 는 아직 집계되지 않았어요';
// memberProgress 자체가 null인 챌린지(TIME_WINDOW) — 리스트를 그냥 비우면 '아무도 안 했다'로 읽힌다.
const NO_PROGRESS_CAPTION = '이 챌린지는 진행률을 표시하지 않아요';
// 롱프레스 삭제는 발견 가능성이 0이다 — 방장에게만 한 줄로 알린다.
const DELETE_HINT_CAPTION = '길게 눌러 삭제';

// 'HH:mm:ss' · ISO 등 서버 시각 문자열에서 HH:mm만 뽑는다. 형식이 다르면 원문 유지.
// (GroupInviteSheet의 같은 헬퍼를 파일 내 복사 — 공용 유틸로 추출하지 않는다, §3-2)
function hhmm(v: string): string {
  return /(\d{2}:\d{2})/.exec(v)?.[1] ?? v;
}

// 미션 한 줄 요약 — 값이 모자라면 null(라벨 자리에 미션 종류만 남긴다).
// GroupInviteSheet.missionLabel의 분기 로직을 챌린지 DTO에 맞춰 복사한 것이다.
function missionLabel(c: GroupChallengeResponse): string | null {
  const what = c.missionCategory === 'SCREEN_TIME' ? '스크린타임' : '집중';
  if (c.missionType === 'DURATION' && c.durationMinutes) {
    return `하루 ${c.durationMinutes}분 ${what}`;
  }
  if (c.missionType === 'TIME_WINDOW' && c.windowStart && c.windowEnd) {
    return `매일 ${hhmm(c.windowStart)}~${hhmm(c.windowEnd)} ${what}`;
  }
  return null;
}

// 멤버 한 명의 진행 표기 — 위 3상 규칙 그대로.
function progressText(p: ChallengeMemberProgress, durationMinutes: number | null): string {
  if (p.progressMinutes === null) return '—';
  if (p.achieved) return '달성 ✓';
  return durationMinutes ? `${p.progressMinutes}/${durationMinutes}분` : `${p.progressMinutes}분`;
}

// 행 전체를 한 덩어리로 읽히게 한다 — 안 묶으면 VoiceOver가 닉네임과 진행을 따로 읽고
// '—'를 "대시"로 발음해 미집계라는 뜻이 전달되지 않는다.
function progressA11y(p: ChallengeMemberProgress, durationMinutes: number | null): string {
  if (p.progressMinutes === null) return `${p.nickname} 아직 집계되지 않음`;
  if (p.achieved) return `${p.nickname} 달성`;
  return durationMinutes
    ? `${p.nickname} ${durationMinutes}분 중 ${p.progressMinutes}분`
    : `${p.nickname} ${p.progressMinutes}분`;
}

export interface ChallengeCardProps {
  challenge: GroupChallengeResponse;
  // 내가 방장인가 — 롱프레스 삭제 진입점을 여는 조건.
  isOwner: boolean;
  // 내 userId — 진행 리스트에서 내 행을 맨 위로 올리고 강조하는 데만 쓴다.
  // 카드를 순수 표현 컴포넌트로 두려고 Context 대신 부모(GroupRoomScreen)가 내려준다.
  myUserId?: string | null;
  // 삭제 확인까지 끝난 뒤 호출 — 부모(GroupRoomScreen)가 API를 부르고 재조회한다.
  onDelete: (challengeId: string) => void;
}

export default function ChallengeCard({
  challenge,
  isOwner,
  myUserId,
  onDelete,
}: ChallengeCardProps) {
  const label = missionLabel(challenge);
  const progress = challenge.memberProgress;
  // 내 행을 맨 위로 — 10명이면 닉네임을 눈으로 훑어야 내 진행률을 찾는다(리그 화면의 isMe 관행).
  // 나머지는 서버가 준 순서를 그대로 둔다.
  const rows = progress
    ? [
        ...progress.filter((p) => !!myUserId && p.userId === myUserId),
        ...progress.filter((p) => !myUserId || p.userId !== myUserId),
      ]
    : null;
  // 미집계 캡션은 '—'가 실제로 뜬 카드에만 — 없는 기호를 설명하면 노이즈다.
  const hasUnmeasured =
    challenge.missionCategory === 'SCREEN_TIME' &&
    !!rows &&
    rows.some((p) => p.progressMinutes === null);

  // 확인 Alert 형식은 앱 관행대로 (동작명, 질문) — 대상에 인용부호를 쓰지 않는다.
  function confirmDelete() {
    if (!isOwner) return;
    Alert.alert('챌린지 삭제', '이 챌린지를 삭제할까요?', [
      { text: '취소', style: 'cancel' },
      { text: '삭제', style: 'destructive', onPress: () => onDelete(challenge.id) },
    ]);
  }

  return (
    <TouchableOpacity
      style={s.card}
      // 탭에는 아무 동작이 없다 — 방장에게만 눌림 피드백을 주면 뭔가 열릴 것처럼 보인다(false affordance).
      activeOpacity={1}
      onLongPress={confirmDelete}
      // 공지 카드와 같은 임계값 — 같은 화면 안에서 같은 제스처가 다른 시간을 요구하면 안 된다.
      delayLongPress={300}
      // 방장이 아니면 롱프레스가 아무것도 하지 않으므로 접근성 트리에서도 버튼으로 보이지 않게 한다.
      accessibilityRole={isOwner ? 'button' : undefined}
      testID={`group.challenge.card.${challenge.id}`}
    >
      <View style={s.head}>
        <View style={s.icon}>
          <Ionicons
            name={challenge.missionCategory === 'SCREEN_TIME' ? 'phone-portrait' : 'flag'}
            size={15}
            color={T.accent}
          />
        </View>
        <Text style={s.label} numberOfLines={1}>
          {/* 폴백은 문장이 아니라 세그먼트와 같은 '카테고리 명사' 자리다 — 고르는 자리의 명칭과 맞춘다.
              (문장 안에서는 `하루 60분 집중`처럼 짧은 쪽을 쓴다) */}
          {label ?? (challenge.missionCategory === 'SCREEN_TIME' ? '스크린타임' : '집중 시간')}
        </Text>
      </View>

      {challenge.missionCategory === 'SCREEN_TIME' && (
        <Text style={s.caption}>{SCREEN_TIME_CAPTION}</Text>
      )}
      {!challenge.canParticipate && <Text style={s.warn}>{NO_PERMISSION_CAPTION}</Text>}

      {rows === null && <Text style={s.caption}>{NO_PROGRESS_CAPTION}</Text>}

      {!!rows && rows.length > 0 && (
        <View style={s.progressList}>
          {rows.map((p) => {
            const isMe = !!myUserId && p.userId === myUserId;
            // 미집계는 '달성'으로 칠하지 않는다 — 서버가 계약을 어겨 achieved:true +
            // progressMinutes:null을 주면 '—'가 초록으로 칠해진다.
            const done = p.achieved === true && p.progressMinutes !== null;
            return (
              <View
                key={p.userId}
                style={[s.progressRow, isMe && s.progressRowMe]}
                accessible
                accessibilityLabel={progressA11y(p, challenge.durationMinutes)}
              >
                <Text style={[s.nickname, isMe && s.nicknameMe]} numberOfLines={1}>
                  {p.nickname}
                </Text>
                <Text
                  style={[
                    s.progress,
                    isMe && s.progressMe,
                    p.progressMinutes === null && s.progressNone,
                    done && s.progressDone,
                  ]}
                >
                  {progressText(p, challenge.durationMinutes)}
                </Text>
              </View>
            );
          })}
        </View>
      )}

      {hasUnmeasured && <Text style={s.caption}>{UNMEASURED_CAPTION}</Text>}
      {isOwner && <Text style={s.hint}>{DELETE_HINT_CAPTION}</Text>}
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  // 카드 표면은 그룹방의 공지 카드와 같은 T.paperAlt — 같은 섹션 위계라 규격을 맞춘다.
  card: {
    backgroundColor: T.paperAlt,
    borderWidth: 1,
    borderColor: T.border,
    borderRadius: 14,
    paddingVertical: T.space.md,
    paddingHorizontal: T.space.lg,
    gap: T.space.xs,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: T.space.sm },
  icon: {
    width: 26,
    height: 26,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: T.accentBg,
  },
  label: { ...T.text.label, color: T.ink, flexShrink: 1 },
  caption: { ...T.text.caption, fontWeight: '500', color: T.inkMuted },
  warn: { ...T.text.caption, color: T.dangerInk },

  // 진행 리스트 — 카드 안쪽이라 구분선 하나로 미션 라벨과 갈라 놓는다.
  progressList: {
    marginTop: T.space.xs,
    paddingTop: T.space.sm,
    borderTopWidth: 1,
    borderTopColor: T.divider,
    gap: T.space.xs,
  },
  // gap이 없으면 긴 닉네임의 줄임표와 진행 텍스트가 0px 간격으로 붙는다(nickname이 flexShrink).
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: T.space.sm,
  },
  // 내 행 — 배경 칩으로 띄운다. 카드 안쪽 여백을 파고들어야 행 폭이 리스트와 같아 보인다.
  progressRowMe: {
    backgroundColor: T.accentBg,
    borderRadius: 8,
    paddingVertical: 3,
    paddingHorizontal: T.space.sm,
    marginHorizontal: -T.space.sm,
  },
  nickname: { ...T.text.caption, fontWeight: '600', color: T.inkSub, flexShrink: 1 },
  nicknameMe: { color: T.accentDeep, fontWeight: '700' },
  progress: {
    ...T.text.caption,
    fontWeight: '700',
    color: T.inkSub,
    fontVariant: ['tabular-nums'],
  },
  progressMe: { color: T.accentDeep },
  // 미집계 '—' — 실제 값과 같은 무게로 두면 0분과 구분되지 않는다.
  progressNone: { color: T.inkFaint, fontWeight: '500' },
  // 달성 — 색만으로는 미달성과 명도가 거의 같아(1.01:1) 색각 사용자에게 구분되지 않는다.
  // 배경 칩으로 형태 차이를 준다.
  progressDone: {
    color: T.successInk,
    backgroundColor: T.successBg,
    borderRadius: 8,
    paddingHorizontal: T.space.sm,
    paddingVertical: 1,
    overflow: 'hidden',
  },
  // 방장 전용 삭제 힌트 — 카드 하단 한 줄. 캡션보다 더 옅게 둬 내용과 섞이지 않게 한다.
  hint: { ...T.text.caption, fontWeight: '500', color: T.inkFaint },
});
