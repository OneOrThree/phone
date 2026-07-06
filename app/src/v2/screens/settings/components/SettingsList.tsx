import { Children, cloneElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Switch } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { T } from '@/constants/theme';

// 설정 리스트 공통 부품 — 카드(Section) + 행(Row) + 토글 행(ToggleRow).
// MenuScreen의 인라인 Row를 일반화해 하위 화면 전체가 공유한다. 색·박스는 T 토큰만 사용.

type IconName = keyof typeof Ionicons.glyphMap;

// ── 카드 섹션 ─────────────────────────────────────────────
// 선택적 섹션 제목 + 카드로 자식 행을 감싼다. 마지막을 뺀 모든 자식에 divider를 자동 주입.
export function SettingsSection({ title, children }: { title?: string; children: ReactNode }) {
  const items = Children.toArray(children).filter(isValidElement) as ReactElement<{
    divider?: boolean;
  }>[];
  return (
    <View style={s.sectionWrap}>
      {title ? <Text style={s.sectionTitle}>{title}</Text> : null}
      <View style={s.card}>
        {items.map((child, i) =>
          i < items.length - 1 ? cloneElement(child, { divider: true }) : child,
        )}
      </View>
    </View>
  );
}

// ── 네비/액션 행 ──────────────────────────────────────────
interface RowProps {
  icon?: IconName;
  iconColor?: string;
  iconBg?: string;
  label: string;
  sub?: string;
  value?: string; // 우측 값 텍스트(예: '허용됨')
  valueColor?: string;
  onPress?: () => void;
  danger?: boolean;
  chevron?: boolean; // 기본: onPress 있으면 표시
  right?: ReactNode; // 우측 커스텀(배지·스위치 등) — value/chevron 대체
  divider?: boolean;
}

export function SettingsRow({
  icon,
  iconColor = T.accentDeep,
  iconBg = T.sandLight,
  label,
  sub,
  value,
  valueColor,
  onPress,
  danger,
  chevron,
  right,
  divider,
}: RowProps) {
  const showChevron = chevron ?? (!!onPress && !danger);
  const Wrapper = onPress ? TouchableOpacity : View;
  return (
    <Wrapper style={[s.row, divider ? s.rowDivider : null]} onPress={onPress} activeOpacity={0.7}>
      {icon ? (
        <View style={[s.rowIcon, { backgroundColor: iconBg }]}>
          <Ionicons name={icon} size={18} color={iconColor} />
        </View>
      ) : null}
      <View style={s.flex1}>
        <Text style={[s.rowLabel, danger ? { color: T.accentAlt } : null]}>{label}</Text>
        {sub ? <Text style={s.rowSub}>{sub}</Text> : null}
      </View>
      {right ?? (
        <>
          {value ? (
            <Text style={[s.rowValue, valueColor ? { color: valueColor } : null]}>{value}</Text>
          ) : null}
          {showChevron ? <Ionicons name="chevron-forward" size={17} color={T.inkMuted} /> : null}
        </>
      )}
    </Wrapper>
  );
}

// ── 토글 행 ───────────────────────────────────────────────
interface ToggleRowProps {
  icon?: IconName;
  iconColor?: string;
  iconBg?: string;
  label: string;
  sub?: string;
  value: boolean;
  onValueChange: (v: boolean) => void;
  disabled?: boolean;
  divider?: boolean;
}

export function SettingsToggleRow({
  icon,
  iconColor = T.accentDeep,
  iconBg = T.sandLight,
  label,
  sub,
  value,
  onValueChange,
  disabled,
  divider,
}: ToggleRowProps) {
  return (
    <View style={[s.row, divider ? s.rowDivider : null, disabled ? s.rowDisabled : null]}>
      {icon ? (
        <View style={[s.rowIcon, { backgroundColor: iconBg }]}>
          <Ionicons name={icon} size={18} color={iconColor} />
        </View>
      ) : null}
      <View style={s.flex1}>
        <Text style={s.rowLabel}>{label}</Text>
        {sub ? <Text style={s.rowSub}>{sub}</Text> : null}
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        disabled={disabled}
        trackColor={{ false: T.chipBorder, true: T.accent }}
        thumbColor={T.white}
        ios_backgroundColor={T.chipBorder}
      />
    </View>
  );
}

const s = StyleSheet.create({
  sectionWrap: { marginTop: 16 },
  sectionTitle: { ...T.text.caption, color: T.inkMuted, marginBottom: 8, marginLeft: 6 },
  card: {
    backgroundColor: T.white,
    borderWidth: 1,
    borderColor: T.paperAlt,
    borderRadius: 16,
    paddingHorizontal: 14,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14 },
  rowDivider: { borderBottomWidth: 1, borderBottomColor: T.divider },
  rowDisabled: { opacity: 0.45 },
  rowIcon: {
    width: 36,
    height: 36,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  flex1: { flex: 1 },
  rowLabel: { ...T.text.label, color: T.ink },
  rowSub: { ...T.text.caption, color: T.inkMuted, marginTop: 2 },
  rowValue: { ...T.text.caption, color: T.inkSub },
});
