import { useState } from 'react';
import { Text, TouchableOpacity, ScrollView, View, StyleSheet } from 'react-native';
import { T } from '@/constants/theme';
import { t } from '@/i18n';
import { SheetShell } from '@/components/SheetShell';
import { CheckRow, SelectAllRow } from './TagCheckRows';
import type { Subject } from '@/screens/focus/types';

// GROMO-668 — [추천과목 수정하기] 단일 시트. 현재 준비 시험의 추천 과목 '전체'를 보여주고,
// 이미 보유한 과목은 체크된 상태로 시작한다. 체크 추가 = 과목 추가, 체크 해제 = 과목 삭제.
// [완료하기]를 눌러야 diff(추가/삭제)가 한 번에 반영된다 — 딤 탭은 무반영 취소.
// 추천 목록 밖의 보유 과목(직접 만든 과목 등)은 여기서 다루지 않는다(2스텝 시트의 정리 스텝 몫).
export function RecommendedTagsEditSheet({
  examLabel,
  recommendations,
  owned,
  onComplete,
  onCancel,
}: {
  examLabel: string;
  recommendations: string[]; // 추천 과목 전체 (sortOrder 정렬 완료)
  owned: Subject[]; // 현재 보유 과목 — 추천과 이름이 겹치면 체크 초기값 on
  onComplete: (adds: string[], removes: Subject[]) => void; // [완료하기] — diff 일괄 반영
  onCancel: () => void; // 딤 탭 — 아무것도 반영하지 않고 닫기
}) {
  const ownedByName = new Map(owned.map((x) => [x.name, x]));
  const [checked, setChecked] = useState<Set<string>>(
    () => new Set(recommendations.filter((n) => ownedByName.has(n))),
  );

  const allChecked = recommendations.length > 0 && recommendations.every((n) => checked.has(n));

  function toggle(name: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  // [완료하기] — 체크 상태와 보유 상태의 차이만 추려 반영
  function finish() {
    const adds = recommendations.filter((n) => checked.has(n) && !ownedByName.has(n));
    const removes = recommendations
      .filter((n) => !checked.has(n) && ownedByName.has(n))
      .map((n) => ownedByName.get(n))
      .filter((x): x is Subject => !!x);
    onComplete(adds, removes);
  }

  return (
    <SheetShell onClose={onCancel}>
      <Text style={s.title}>{t('settings.tagSheet.editTitle', { exam: examLabel })}</Text>
      {recommendations.length > 0 ? (
        <>
          <Text style={s.sub}>
            {t('settings.tagSheet.editSubLead')}
            {'\n'}
            <Text style={s.subDanger}>{t('settings.tagSheet.editSubDanger')}</Text>
          </Text>
          <SelectAllRow
            checked={allChecked}
            checkColor={T.accent}
            onToggle={() => setChecked(allChecked ? new Set() : new Set(recommendations))}
          />
        </>
      ) : (
        <Text style={s.sub}>{t('settings.tagSheet.editEmpty')}</Text>
      )}

      <ScrollView style={s.listScroll} showsVerticalScrollIndicator={false}>
        <View style={s.list}>
          {recommendations.map((name) => (
            <CheckRow
              key={name}
              name={name}
              checked={checked.has(name)}
              checkColor={T.accent}
              onToggle={() => toggle(name)}
            />
          ))}
        </View>
      </ScrollView>

      <TouchableOpacity style={s.doneBtn} activeOpacity={0.85} onPress={finish}>
        <Text style={s.doneText}>{t('settings.tagSheet.done')}</Text>
      </TouchableOpacity>
    </SheetShell>
  );
}

const s = StyleSheet.create({
  title: { ...T.text.body, fontWeight: '800', color: T.ink },
  sub: {
    ...T.text.label,
    fontWeight: '500',
    color: T.inkMuted,
    marginTop: 2,
    marginBottom: T.space.md,
    lineHeight: 19,
  },
  subDanger: { color: T.accentAlt, fontWeight: '700' },
  listScroll: { maxHeight: 320 },
  list: { gap: T.space.sm },
  doneBtn: {
    minHeight: 52,
    paddingVertical: T.space.md,
    borderRadius: 16,
    backgroundColor: T.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: T.space.lg,
  },
  doneText: { ...T.text.subtitle, color: T.white },
});
