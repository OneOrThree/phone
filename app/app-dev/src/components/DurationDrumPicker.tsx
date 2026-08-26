import { View, StyleSheet } from 'react-native';
import { DrumPicker } from '@/components/DrumPicker';

// 시간·분(5분 단위) 두 휠로 목표 시간을 고르는 드럼 피커 (GROMO-969).
// 컨트롤드: 휠 선택으로 계산한 총 분을 [minMinutes, maxMinutes]로 클램프해 onChange로 올린다.
// 클램프 결과가 현재 value와 같으면(하한/상한 밖 선택) onChange를 생략 — 부모 value가
// 그대로이므로 휠이 원래 위치로 되돌아간다(DrumPicker의 값 거부 동작).
// minMinutes·maxMinutes는 5분 배수를 전제로 한다(아니면 휠에 없는 값으로 클램프될 수 있음).

const MINUTE_STEP = 5;
const MINUTE_ITEMS = Array.from({ length: 60 / MINUTE_STEP }, (_, i) => `${i * MINUTE_STEP}분`);

export function DurationDrumPicker({
  minMinutes,
  maxMinutes,
  value,
  onChange,
}: {
  minMinutes: number;
  maxMinutes: number;
  value: number; // 총 분
  onChange: (minutes: number) => void;
}) {
  const maxHours = Math.floor(maxMinutes / 60);
  const hourItems = Array.from({ length: maxHours + 1 }, (_, h) => `${h}시간`);

  const hours = Math.floor(value / 60);
  const minutes = value % 60;

  function commit(h: number, m: number) {
    const total = Math.min(maxMinutes, Math.max(minMinutes, h * 60 + m));
    if (total !== value) onChange(total);
  }

  return (
    <View style={s.row}>
      <View style={s.col}>
        <DrumPicker items={hourItems} selectedIndex={hours} onChange={(i) => commit(i, minutes)} />
      </View>
      <View style={s.col}>
        <DrumPicker
          items={MINUTE_ITEMS}
          selectedIndex={minutes / MINUTE_STEP}
          onChange={(i) => commit(hours, i * MINUTE_STEP)}
        />
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row' },
  col: { flex: 1 },
});
