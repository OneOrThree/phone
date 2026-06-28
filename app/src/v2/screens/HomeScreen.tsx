import { View, Text, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { T, inkBox } from '@/constants/theme';

// v2 새 UI — 홈 화면 골격(placeholder).
// 새 기획 디자인을 여기서부터 채워나간다.
// 데이터/상태는 @/store 훅(useUser/useCoins 등)으로 기존 것을 공유한다.
// 기존 화면(@/screens/Homescreen)은 수정·삭제 없이 참고용으로 보존한다.
export default function HomeScreen() {
  return (
    <SafeAreaView style={s.container} edges={['top']}>
      <View style={s.content}>
        <Text style={s.title}>새 홈 (v2)</Text>
        <View style={[s.card, inkBox(T.paperDark)]}>
          <Text style={s.cardText}>여기에 새 기획 홈 화면을 만든다.</Text>
        </View>
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: T.paper },
  content: {
    flex: 1,
    padding: 20,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16,
  },
  title: { fontSize: 24, fontWeight: '800', color: T.ink },
  card: { paddingVertical: 20, paddingHorizontal: 24 },
  cardText: { fontSize: 14, color: T.inkMed },
});
