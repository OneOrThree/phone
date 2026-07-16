import { useRef, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { T } from '@/constants/theme';
import { SheetShell } from '@/components/SheetShell';
import type { Subject } from '@/screens/focus/types';

// GROMO-632/668 — 준비 시험 변경 직후 과목 정리 2스텝 시트.
// 스텝1(추가): 새 시험 추천 과목을 체크로 고른다. 버튼은 하나 — 선택 0개면 [건너뛰기],
//   선택하면 [추가하기]+'n개 선택됨'으로 바뀌며, 누르면 선택을 보관한 채 스텝2로 이동.
//   각 스텝에 전체 선택 체크 제공. 시트 취소는 딤 탭(전부 무반영).
// 스텝2(삭제): 보유 과목 전체를 대상으로 삭제할 것을 체크로 고른다(직군 무관 — 전전 시험
//   과목도 정리 가능). 삭제하면 기록이 사라진다는 안내는 스텝2 머리글에 명시한다.
//   [뒤돌아가기]는 선택을 유지한 채 스텝1로 복귀.
// 체크만으로는 아무것도 바뀌지 않는다 — 시트는 선택만 모으고, 실제 반영(시험 변경 포함)은
// onComplete를 받은 호출부가 일괄 수행한다. [취소하기]·딤 탭은 onCancel — 전부 무반영.
// 추가/삭제할 과목이 없어도 스텝을 건너뛰지 않는다 — 해당 스텝의 안내 문구가 '없어요'로 바뀐다.
// 이미 보유한 과목은 호출부(OccupationScreen)에서 사전 제외돼 들어온다.
export function TagSuggestionSheet({
  examLabel,
  suggestions,
  removals = [],
  onComplete,
  onCancel,
}: {
  examLabel: string;
  suggestions: string[]; // 미보유 추천 과목명 (sortOrder 정렬 완료)
  removals?: Subject[]; // 보유 과목 전체 — 삭제 제안 (없으면 스텝2 생략)
  onComplete: (adds: string[], removes: Subject[]) => void; // [완료하기] — 최종 선택 일괄 반영
  onCancel: () => void; // [취소하기]·딤 탭 — 아무것도 반영하지 않고 닫기
}) {
  const [step, setStep] = useState<1 | 2>(1);
  const [checkedAdd, setCheckedAdd] = useState<Set<string>>(new Set());
  const [checkedRemove, setCheckedRemove] = useState<Set<string>>(new Set());
  // 스텝1에서 고른 추가 목록 — 완료하기까지 보류
  const pendingAdd = useRef<string[]>([]);

  const allAddChecked = suggestions.length > 0 && suggestions.every((n) => checkedAdd.has(n));
  const allRemoveChecked = removals.length > 0 && removals.every((x) => checkedRemove.has(x.id));

  function toggle(set: Set<string>, key: string): Set<string> {
    const next = new Set(set);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  }

  // 스텝1 [추가하기] — 선택을 보관하고 스텝2로 이동
  function finishStep1() {
    pendingAdd.current = suggestions.filter((n) => checkedAdd.has(n));
    setStep(2);
  }

  // 스텝2 [완료하기] — 보류한 추가 + 체크된 삭제를 한 번에 넘긴다
  function finishStep2() {
    onComplete(
      pendingAdd.current,
      removals.filter((x) => checkedRemove.has(x.id)),
    );
  }

  return (
    <SheetShell onClose={onCancel}>
      {step === 1 ? (
        <>
          <Text style={s.title}>{examLabel} 준비에 필요한 과목을 추천해요</Text>
          {suggestions.length > 0 ? (
            <>
              <Text style={s.sub}>
                추가하면 같은 시험을 준비하는 사람들과 과목별 공부시간을 비교할 수 있어요.
              </Text>
              <SelectAllRow
                checked={allAddChecked}
                checkColor={T.accent}
                onToggle={() => setCheckedAdd(allAddChecked ? new Set() : new Set(suggestions))}
              />
            </>
          ) : (
            <Text style={s.sub}>추가할 추천 과목이 없어요.</Text>
          )}
          <ScrollView style={s.listScroll} showsVerticalScrollIndicator={false}>
            <View style={s.list}>
              {suggestions.map((name) => {
                const on = checkedAdd.has(name);
                return (
                  <CheckRow
                    key={name}
                    name={name}
                    checked={on}
                    checkColor={T.accent}
                    onToggle={() => setCheckedAdd((prev) => toggle(prev, name))}
                  />
                );
              })}
            </View>
          </ScrollView>

          {/* 단일 버튼 — 선택 없으면 건너뛰기(검정), 선택하면 추가하기(주황)+선택 개수 */}
          <TouchableOpacity
            style={[s.primaryBtn, checkedAdd.size === 0 && s.primaryBtnIdle]}
            activeOpacity={0.85}
            onPress={finishStep1}
          >
            {checkedAdd.size > 0 ? (
              <>
                <Text style={s.primaryText}>추가하기</Text>
                <Text style={s.btnCount}>{checkedAdd.size}개 선택됨</Text>
              </>
            ) : (
              <Text style={s.primaryText}>건너뛰기</Text>
            )}
          </TouchableOpacity>
        </>
      ) : (
        <>
          <Text style={s.title}>기존 과목을 정리할까요?</Text>
          {removals.length > 0 ? (
            <>
              <Text style={s.sub}>
                삭제할 과목을 선택하세요.{'\n'}
                <Text style={s.subDanger}>삭제한 과목의 집중 기록은 사라져요.</Text>
              </Text>
              <SelectAllRow
                checked={allRemoveChecked}
                checkColor={T.accentAlt}
                onToggle={() =>
                  setCheckedRemove(
                    allRemoveChecked ? new Set() : new Set(removals.map((x) => x.id)),
                  )
                }
              />
            </>
          ) : (
            <Text style={s.sub}>삭제할 과목이 없어요.</Text>
          )}
          <ScrollView style={s.listScroll} showsVerticalScrollIndicator={false}>
            <View style={s.list}>
              {removals.map((sub) => {
                const on = checkedRemove.has(sub.id);
                return (
                  <CheckRow
                    key={sub.id}
                    name={sub.name}
                    checked={on}
                    checkColor={T.accentAlt}
                    muted
                    onToggle={() => setCheckedRemove((prev) => toggle(prev, sub.id))}
                  />
                );
              })}
            </View>
          </ScrollView>

          <TouchableOpacity style={s.primaryBtn} activeOpacity={0.85} onPress={finishStep2}>
            <Text style={s.primaryText}>완료하기</Text>
          </TouchableOpacity>
          {/* 뒤돌아가기 — 체크 선택을 유지한 채 스텝1로 복귀 */}
          <TouchableOpacity style={s.darkBtn} activeOpacity={0.85} onPress={() => setStep(1)}>
            <Text style={s.darkText}>뒤돌아가기</Text>
          </TouchableOpacity>
        </>
      )}
    </SheetShell>
  );
}

// 전체 선택 행 — 리스트 위 오른쪽 정렬, 탭하면 전 항목 체크/해제
function SelectAllRow({
  checked,
  checkColor,
  onToggle,
}: {
  checked: boolean;
  checkColor: string;
  onToggle: () => void;
}) {
  return (
    <TouchableOpacity style={s.selectAll} activeOpacity={0.7} onPress={onToggle}>
      <Text style={s.selectAllText}>전체 선택</Text>
      <View style={[s.check, checked && { backgroundColor: checkColor, borderColor: checkColor }]}>
        {checked ? <Ionicons name="checkmark" size={15} color={T.white} /> : null}
      </View>
    </TouchableOpacity>
  );
}

// 체크 선택 행 — 행 전체 탭으로 토글, 오른쪽 동그라미에 체크 표시
function CheckRow({
  name,
  checked,
  checkColor,
  muted,
  onToggle,
}: {
  name: string;
  checked: boolean;
  checkColor: string;
  muted?: boolean;
  onToggle: () => void;
}) {
  return (
    <TouchableOpacity style={s.row} activeOpacity={0.7} onPress={onToggle}>
      <View style={[s.iconBox, muted && s.iconBoxMuted]}>
        <Ionicons name="book-outline" size={20} color={muted ? T.inkMuted : T.accent} />
      </View>
      <Text style={s.rowName} numberOfLines={1}>
        {name}
      </Text>
      <View style={[s.check, checked && { backgroundColor: checkColor, borderColor: checkColor }]}>
        {checked ? <Ionicons name="checkmark" size={15} color={T.white} /> : null}
      </View>
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  title: { ...T.text.body, fontWeight: '800', color: T.ink },
  sub: {
    ...T.text.label,
    fontWeight: '500',
    color: T.inkMuted,
    marginTop: 2,
    marginBottom: 13,
    lineHeight: 19,
  },
  subDanger: { color: T.accentAlt, fontWeight: '700' },
  listScroll: { maxHeight: 320 },
  list: { gap: 9 },
  // 전체 선택 — 리스트 오른쪽 위, 행과 체크 위치를 맞춘다
  selectAll: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 8,
    paddingVertical: 6,
    paddingHorizontal: 14,
  },
  selectAllText: { ...T.text.caption, fontWeight: '600', color: T.inkMuted },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: T.white,
    borderWidth: 1,
    borderColor: T.paperAlt,
    borderRadius: 15,
    paddingVertical: 11,
    paddingHorizontal: 14,
  },
  iconBox: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: T.caramel,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconBoxMuted: { backgroundColor: T.paperAlt },
  rowName: { ...T.text.label, fontWeight: '700', color: T.ink, flex: 1 },
  // 선택 동그라미 — 체크 시 checkColor로 채움
  check: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: T.borderDark,
    alignItems: 'center',
    justifyContent: 'center',
  },

  primaryBtn: {
    height: 52,
    borderRadius: 16,
    backgroundColor: T.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 14,
  },
  primaryBtnIdle: { backgroundColor: T.ink },
  primaryText: { ...T.text.subtitle, color: T.white },
  btnCount: { ...T.text.caption, color: T.white, opacity: 0.75, marginTop: 1 },
  // 건너뛰기/완료하기 — 위 버튼과 같은 모양, 검은색으로 매칭
  darkBtn: {
    height: 52,
    borderRadius: 16,
    backgroundColor: T.ink,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
  },
  darkText: { ...T.text.subtitle, color: T.white },
});
