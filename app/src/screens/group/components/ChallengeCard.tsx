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
// memberProgress 자체가 null이면 리스트를 그리지 않는다 — 서버가 TIME_WINDOW 챌린지의
// 진행률을 지원하지 않기 때문(백 명세 결정 3). 앱은 DURATION만 만들므로 평시엔 오지 않는 값이다.

// SCREEN_TIME 챌린지는 '많이 할수록 좋은' 집중과 반대 방향이라 카드에 뜻을 한 줄 적는다(§3-2).
const SCREEN_TIME_CAPTION = '오늘 스크린타임을 목표 이하로 유지해요';
// 서버가 canParticipate=false를 준 경우 — 스크린타임 권한이 없어 이 그룹에서 집계가 안 된다.
const NO_PERMISSION_CAPTION = '스크린타임 권한이 없어 참여할 수 없어요';

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

export interface ChallengeCardProps {
  challenge: GroupChallengeResponse;
  // 내가 방장인가 — 롱프레스 삭제 진입점을 여는 조건.
  isOwner: boolean;
  // 삭제 확인까지 끝난 뒤 호출 — 부모(GroupRoomScreen)가 API를 부르고 재조회한다.
  onDelete: (challengeId: string) => void;
}

export default function ChallengeCard({ challenge, isOwner, onDelete }: ChallengeCardProps) {
  const label = missionLabel(challenge);
  const progress = challenge.memberProgress;

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
      activeOpacity={isOwner ? 0.85 : 1}
      onLongPress={confirmDelete}
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
          {label ?? (challenge.missionCategory === 'SCREEN_TIME' ? '스크린타임' : '집중')}
        </Text>
      </View>

      {challenge.missionCategory === 'SCREEN_TIME' && (
        <Text style={s.caption}>{SCREEN_TIME_CAPTION}</Text>
      )}
      {!challenge.canParticipate && <Text style={s.warn}>{NO_PERMISSION_CAPTION}</Text>}

      {!!progress && progress.length > 0 && (
        <View style={s.progressList}>
          {progress.map((p) => (
            <View key={p.userId} style={s.progressRow}>
              <Text style={s.nickname} numberOfLines={1}>
                {p.nickname}
              </Text>
              <Text style={[s.progress, p.achieved === true && s.progressDone]}>
                {progressText(p, challenge.durationMinutes)}
              </Text>
            </View>
          ))}
        </View>
      )}
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
  progressRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  nickname: { ...T.text.caption, fontWeight: '600', color: T.inkSub, flexShrink: 1 },
  progress: {
    ...T.text.caption,
    fontWeight: '700',
    color: T.inkSub,
    fontVariant: ['tabular-nums'],
  },
  progressDone: { color: T.successInk },
});
