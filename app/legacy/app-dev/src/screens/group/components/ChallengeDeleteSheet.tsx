import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { T } from '@/constants/theme';
import { t } from '@/i18n';
import { SheetShell } from '@/components/SheetShell';
import type { ChallengeDeletionPreviewResponse } from '@/types/dto/group';
import { fmtMonthDayDow } from '../challengeSchedule';

// 진행 중 삭제의 2단계 경고 시트(GROMO-1425 — N29·N49·FR-12-1).
//
// **수치가 본체다.** "정말 삭제할까요?"만 띄우면 읽지 않는다 — 사라지는 날짜·참여 인원·
// 돌아가는 적립금을 숫자로 적는다. 수치는 반드시 deletion-preview 프리플라이트(N49)에서 온다 —
// 카드의 bet.session은 오늘 1건뿐이라 주간 예약분(뒤에 걸린 남의 돈)이 빠진다(K11).
// 프리플라이트가 실패하면 카드가 이 시트를 **열지 않는다** — 수치 없는 경고는 경고가 아니다.
//
// 진행 중이 아닐 때는 이 시트가 뜨지 않는다(기존 1단계 Alert 유지) — 안 위험할 때도 두 번
// 물으면 경고가 의미를 잃는다(N29).
//
// 버튼은 `삭제` / `그만두기`다 — `확인`은 무엇을 확인하는지 말해주지 않고, `취소`는 참여
// 취소(N27)와 겹친다. 카피에 「회차」 금지(N28) — 날짜·요일로만 말한다.

export interface ChallengeDeleteSheetProps {
  // 미션 요약 라벨(카드와 같은 문장).
  label: string;
  // deletion-preview 응답 — openSessions는 예약된 미래 날짜까지 전부다.
  preview: ChallengeDeletionPreviewResponse;
  // 최종 확인 — 카드가 onDelete(부모 API 호출·재조회)로 잇는다.
  onConfirm: () => void;
  onClose: () => void;
}

export default function ChallengeDeleteSheet({
  label,
  preview,
  onConfirm,
  onClose,
}: ChallengeDeleteSheetProps) {
  const dayLabels = preview.openSessions.map((os) => fmtMonthDayDow(os.sessionDate));
  return (
    <SheetShell onClose={onClose} asModal>
      <Text style={s.title}>{t('group.challengeDeleteSheet.title')}</Text>
      <Text style={s.sub}>{label}</Text>

      <Text style={s.fieldLabel}>{t('group.challengeDeleteSheet.daysLabel')}</Text>
      <View style={s.dayList} testID="group.challenge.delete.days">
        {preview.openSessions.map((os) => (
          <View
            key={os.sessionDate}
            style={s.dayRow}
            accessible
            accessibilityLabel={t('group.challengeDeleteSheet.dayA11y', {
              day: fmtMonthDayDow(os.sessionDate),
              count: os.participantCount,
              pot: os.pot,
            })}
          >
            <Text style={s.dayText}>{fmtMonthDayDow(os.sessionDate)}</Text>
            <Text style={s.dayValue}>
              {t('group.challengeDeleteSheet.dayValue', {
                count: os.participantCount,
                pot: os.pot,
              })}
            </Text>
          </View>
        ))}
      </View>

      {/* 무엇이 사라지고 돈이 어디로 가는지 — 시안(ux §07) 문장 그대로. */}
      <View style={s.warnBox}>
        <Text style={s.warnText}>
          {t('group.challengeDeleteSheet.warn', {
            days: dayLabels.join('·'),
            refund: preview.totalRefund,
          })}
        </Text>
      </View>
      <View style={s.note}>
        <Text style={s.noteText}>{t('group.challengeDeleteSheet.note')}</Text>
      </View>

      <TouchableOpacity
        style={s.deleteBtn}
        activeOpacity={0.85}
        onPress={onConfirm}
        accessibilityRole="button"
        testID="group.challenge.delete.confirm"
      >
        <Text style={s.deleteText}>{t('common.delete')}</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={s.ghostBtn}
        activeOpacity={0.7}
        onPress={onClose}
        accessibilityRole="button"
        testID="group.challenge.delete.dismiss"
      >
        <Text style={s.ghostText}>{t('group.common.dismiss')}</Text>
      </TouchableOpacity>
    </SheetShell>
  );
}

const s = StyleSheet.create({
  title: { ...T.text.body, fontWeight: '800', color: T.ink },
  sub: { ...T.text.label, fontWeight: '500', color: T.inkMuted, marginTop: 2 },
  fieldLabel: {
    ...T.text.caption,
    fontWeight: '700',
    color: T.inkSub,
    marginTop: T.space.lg,
    marginBottom: T.space.sm,
  },
  dayList: { gap: T.space.xs },
  dayRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: T.space.sm,
  },
  dayText: { ...T.text.caption, fontWeight: '600', color: T.inkSub },
  dayValue: {
    ...T.text.caption,
    fontWeight: '700',
    color: T.inkSub,
    fontVariant: ['tabular-nums'],
  },
  // 경고 본문 — 돈이 되돌아가는 사실이라 danger 결(노트보다 강하게).
  warnBox: {
    backgroundColor: T.dangerBg,
    borderWidth: 1,
    borderColor: T.dangerInk,
    borderRadius: 14,
    paddingVertical: T.space.md,
    paddingHorizontal: T.space.lg,
    marginTop: T.space.md,
  },
  warnText: { ...T.text.caption, fontWeight: '600', color: T.dangerInk, lineHeight: 19 },
  note: {
    backgroundColor: T.noteBg,
    borderWidth: 1,
    borderColor: T.noteBorder,
    borderRadius: 14,
    paddingVertical: T.space.md,
    paddingHorizontal: T.space.lg,
    marginTop: T.space.sm,
  },
  noteText: { ...T.text.caption, fontWeight: '500', color: T.inkSub, lineHeight: 19 },
  deleteBtn: {
    minHeight: 52,
    paddingVertical: T.space.md,
    borderRadius: 16,
    backgroundColor: T.dangerInk,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: T.space.lg,
  },
  deleteText: { ...T.text.subtitle, color: T.white },
  ghostBtn: {
    minHeight: 44,
    paddingVertical: T.space.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: T.space.xs,
  },
  ghostText: { ...T.text.label, color: T.inkSub },
});
