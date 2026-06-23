import { View, Text, StyleSheet } from 'react-native';
import { T } from '../../components/theme';

export default function RankingTab() {
  return (
    <View style={s.container}>
      <Text style={s.text}>랭킹 준비 중</Text>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  text: { fontSize: 14, fontWeight: '700', color: T.inkLight },
});
