import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import ScreenTimeReportView from '@/components/ScreenTimeReportView';
import ScreenTimeAnalyzingOverlay, { ANALYZE_MS } from '@/components/ScreenTimeAnalyzingOverlay';
import { T } from '@/constants/theme';

// 앱별/카테고리별 사용시간 상세 — 홈 "핸드폰 사용" 탭 시 탭 위로 push되는 스택 화면.
// Total Activity 리포트를 임베드. RN Modal이 아닌 일반 화면이라 DeviceActivityReport scene이
// 정상 호스팅되고, 네이티브 스택이 탭바까지 통째로 덮어 z-order 문제도 없다.
export default function UsageDetailScreen() {
  const navigation = useNavigation();
  // 리포트가 다 그려지면 분석 연출은 시각적으로 덮이지만 레이어는 계속 마운트된 채다(느린
  // 리포트에서도 빈 화면이 안 보이게). 로드 완료 신호가 없어 ANALYZE_MS를 프록시로, 그 뒤엔
  // 접근성 트리에서만 숨겨 스크린리더가 완료된 리포트 위에서 "분석 중"을 계속 읽지 않게 한다.
  const [covered, setCovered] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setCovered(true), ANALYZE_MS);
    return () => clearTimeout(timer);
  }, []);
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
        {ScreenTimeReportView ? (
          <>
            {/* 캐릭터 분석 연출을 리포트 뒤에 깔아둔다. 콜드스타트 동안엔 네이티브 리포트
                배경이 투명(호스팅 뷰 .clear)이라 뒤로 캐릭터가 비쳐 보이고, 리포트가 다
                그려지면 불투명 배경(#F4F5F8)이 캐릭터를 덮는다. 로드 완료 신호가 JS로 오지
                않으므로 타이머로 걷는 대신 이 레이어링으로 정확한 시점에 전환한다. */}
            <ScreenTimeAnalyzingOverlay covered={covered} />
            <ScreenTimeReportView reportContext="Total Activity" style={s.report} />
          </>
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
    paddingHorizontal: T.space.md,
    paddingTop: T.space.xs,
    paddingBottom: T.space.sm,
  },
  back: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  title: { ...T.text.subtitle, color: T.ink },
  body: { flex: 1 },
  report: { flex: 1 },
  empty: { ...T.text.body, color: T.inkMuted, textAlign: 'center', marginTop: 44 },
});
