import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import ScreenTimeReportView from '@/components/ScreenTimeReportView';
import { T } from '@/constants/theme';

// 앱별/카테고리별 사용시간 상세 — 홈 "핸드폰 사용" 탭 시 탭 위로 push되는 스택 화면.
// Total Activity 리포트를 임베드. RN Modal이 아닌 일반 화면이라 DeviceActivityReport scene이
// 정상 호스팅되고, 네이티브 스택이 탭바까지 통째로 덮어 z-order 문제도 없다.
export default function UsageDetailScreen() {
  const navigation = useNavigation();
  return (
    <SafeAreaView style={s.root} edges={['top']}>
      <View style={s.header}>
        <TouchableOpacity style={s.back} onPress={() => navigation.goBack()} activeOpacity={0.7}>
          <Ionicons name="chevron-back" size={24} color={T.ink} />
        </TouchableOpacity>
        <Text style={s.title}>핸드폰 사용</Text>
        <View style={s.back} />
      </View>
      <View style={s.body}>
        {/* 리포트 콜드스타트가 느려 뒤에 스피너 → 뜨면 리포트가 덮음 */}
        <ActivityIndicator style={s.loading} size="large" color={T.accent} />
        {ScreenTimeReportView ? (
          <ScreenTimeReportView reportContext="Total Activity" style={s.report} />
        ) : (
          <Text style={s.empty}>iOS 기기에서만 볼 수 있어요</Text>
        )}
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: T.paperLight },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingTop: 4,
    paddingBottom: 8,
  },
  back: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  title: { ...T.text.subtitle, color: T.ink },
  body: { flex: 1 },
  loading: { position: 'absolute', top: 44, left: 0, right: 0 },
  report: { flex: 1 },
  empty: { ...T.text.body, color: T.inkMuted, textAlign: 'center', marginTop: 44 },
});
