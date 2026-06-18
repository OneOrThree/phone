import { View, Text, StyleSheet } from 'react-native';
import { T } from '../../components/theme';

export default function NoticeTab({ groupId }) {
  return (
    <View style={s.wrap}>
      <Text style={s.icon}>📢</Text>
      <Text style={s.text}>공지 준비 중이에요</Text>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  icon: { fontSize: 32, marginBottom: 12 },
  text: { fontSize: 15, fontWeight: '700', color: T.inkLight },
});
