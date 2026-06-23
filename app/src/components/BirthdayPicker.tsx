import { useState } from 'react';
import { View, Text, TouchableOpacity, Platform, StyleSheet } from 'react-native';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { T } from '@/constants/theme';

const MIN_DATE = new Date('1900-01-01');
const MAX_DATE = new Date();

function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}년 ${m}월 ${d}일`;
}

interface BirthdayPickerProps {
  value: Date | null;
  onChange: (date: Date) => void;
}

export default function BirthdayPicker({ value, onChange }: BirthdayPickerProps) {
  const [showPicker, setShowPicker] = useState(false);

  function handleChange(event: DateTimePickerEvent, selectedDate?: Date) {
    if (Platform.OS === 'android') {
      setShowPicker(false);
      if (event.type === 'set' && selectedDate) onChange(selectedDate);
    } else {
      if (selectedDate) onChange(selectedDate);
    }
  }

  return (
    <View>
      <TouchableOpacity style={s.btn} onPress={() => setShowPicker((v) => !v)} activeOpacity={0.7}>
        <Text style={[s.btnText, !value && s.placeholder]}>
          {value ? formatDate(value) : '날짜를 선택하세요'}
        </Text>
      </TouchableOpacity>
      {showPicker && (
        <DateTimePicker
          value={value ?? new Date(2000, 0, 1)}
          mode="date"
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          onChange={handleChange}
          maximumDate={MAX_DATE}
          minimumDate={MIN_DATE}
          locale="ko-KR"
        />
      )}
    </View>
  );
}

const s = StyleSheet.create({
  btn: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderWidth: 1.5,
    borderColor: T.inkLight,
    borderRadius: 6,
  },
  btnText: {
    fontSize: 16,
    fontWeight: '600',
    color: T.ink,
  },
  placeholder: {
    color: T.inkLight,
  },
});
