import { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Platform,
  Image,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import ScreenTimeReportView from '@/components/ScreenTimeReportView';
import ScreenTimeModule, { type AppUsage } from '@/services/ScreenTimeModule';
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
        ) : Platform.OS === 'android' ? (
          // 안드로이드 — UsageStats 수치를 받아 RN이 직접 그린다(GROMO-1602).
          <AndroidUsageList />
        ) : (
          <Text style={s.empty}>지금은 볼 수 없어요</Text>
        )}
      </View>
    </SafeAreaView>
  );
}

// 안드로이드 앱별 사용시간 — iOS 익스텐션의 TotalActivityView(ios/screentimereport)와
// **같은 화면 구성**을 RN으로 옮긴 것이다: 총 사용시간 카드 → '앱별 사용시간' 섹션 헤더 →
// 행을 구분선으로 잇는 흰 카드. 치수도 그쪽 값을 그대로 따른다(카드 radius 18/16, 행 패딩
// 16×13, 이름 16 medium, 수치 15 semibold).
//
// iOS와 **다른 점은 아이콘 하나**다. iOS는 앱이 opaque 토큰이라 이름조차 시스템이 그려주지만,
// 안드로이드는 패키지명을 알아 아이콘을 직접 붙일 수 있다.
function AndroidUsageList() {
  const [rows, setRows] = useState<AppUsage[] | null>(null); // null = 로딩 중
  const [totalMinutes, setTotalMinutes] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // 총 사용시간은 홈 카드와 **같은 함수**로 받는다 — 목록 합으로 따로 계산하면 폴백 경로에서
    // "홈은 21분, 상세는 22분"처럼 갈린다.
    Promise.all([ScreenTimeModule.getUsageByApp(0), ScreenTimeModule.getTodayUsageBucketMinutes()])
      .then(([list, minutes]) => {
        if (cancelled) return;
        setRows(list);
        setTotalMinutes(minutes);
      })
      // 실패를 빈 목록으로 뭉개지 않는다 — '오늘 아무 앱도 안 씀'과 구분되어야 한다.
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, []);

  if (failed) return <Text style={s.empty}>사용 기록을 불러오지 못했어요</Text>;
  if (rows === null) {
    return (
      <View style={s.loading}>
        <ActivityIndicator color={T.accent} />
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={s.usageScroll}>
      {/* 총 사용시간 카드 — iOS와 같은 문구·위계 */}
      <View style={s.totalCard}>
        <Text style={s.totalLabel}>오늘 총 사용시간</Text>
        <Text style={s.totalValue}>{formatMinutes(totalMinutes ?? 0)}</Text>
      </View>

      <Text style={s.sectionHeader}>앱별 사용시간</Text>
      {rows.length === 0 ? (
        <Text style={s.emptyInline}>사용 기록이 없어요</Text>
      ) : (
        <View style={s.usageCard}>
          {rows.map((item, idx) => (
            <View key={item.packageName}>
              <View style={s.usageRow}>
                <AppIcon packageName={item.packageName} />
                <Text style={s.usageLabel} numberOfLines={1}>
                  {item.label}
                </Text>
                <Text style={s.usageValue}>{formatUsage(item.seconds)}</Text>
              </View>
              {idx < rows.length - 1 ? <View style={s.rowDivider} /> : null}
            </View>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

// 아이콘 캐시 — 화면을 드나들 때마다 네이티브에서 다시 인코딩하지 않게 모듈 수명 동안 유지한다.
const iconCache = new Map<string, string | null>();

function AppIcon({ packageName }: { packageName: string }) {
  const [icon, setIcon] = useState<string | null>(() => iconCache.get(packageName) ?? null);

  useEffect(() => {
    if (iconCache.has(packageName)) return;
    let cancelled = false;
    ScreenTimeModule.getAppIcon(packageName)
      .then((data) => {
        iconCache.set(packageName, data);
        if (!cancelled) setIcon(data);
      })
      .catch(() => iconCache.set(packageName, null));
    return () => {
      cancelled = true;
    };
  }, [packageName]);

  // 아이콘이 늦게 와도 행 높이·정렬이 흔들리지 않게 같은 크기의 자리를 먼저 잡는다.
  return icon ? (
    <Image source={{ uri: `data:image/png;base64,${icon}` }} style={s.appIcon} />
  ) : (
    <View style={[s.appIcon, s.appIconPlaceholder]} />
  );
}

// iOS formatDuration과 같은 규칙 — 1시간 이상이면 '3시간 5분', 아니면 '45분'.
function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}시간 ${m}분` : `${m}분`;
}

// 앱별 행만 초 단위를 살린다 — 1분 미만을 분으로 반올림하면 목록 하단이 전부 '0분'이 되어
// 정렬이 의미를 잃는다(iOS는 애초에 앱별 초 단위를 못 받아 이 문제가 없다).
function formatUsage(seconds: number): string {
  if (seconds < 60) return `${seconds}초`;
  return formatMinutes(Math.round(seconds / 60));
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
  loading: { paddingVertical: 48, alignItems: 'center' },

  // 아래 치수는 iOS TotalActivityView.swift 값을 그대로 옮긴 것이다 — 한쪽만 고치면 두 플랫폼
  // 화면이 조용히 갈라진다. 바꿀 땐 Swift 쪽도 같이 볼 것.
  usageScroll: { padding: 16, gap: 18 },
  totalCard: {
    backgroundColor: T.white,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: T.border,
    padding: 18,
  },
  totalLabel: { fontSize: 14, fontWeight: '600', color: T.inkSub },
  totalValue: { fontSize: 30, fontWeight: '800', color: T.ink, marginTop: 6 },
  sectionHeader: { fontSize: 15, fontWeight: '600', color: T.inkSub },
  usageCard: {
    backgroundColor: T.white,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: T.border,
    overflow: 'hidden',
  },
  usageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 13,
  },
  appIcon: { width: 28, height: 28, borderRadius: 7 },
  appIconPlaceholder: { backgroundColor: T.paperAlt },
  // 이름은 줄어들고 수치는 안 줄어야 한다 — 반대로 두면 긴 앱 이름이 '1시간 20분'을 밀어낸다.
  usageLabel: { fontSize: 16, fontWeight: '500', color: T.ink, flex: 1, flexShrink: 1 },
  usageValue: { fontSize: 15, fontWeight: '600', color: T.inkMuted, flexShrink: 0 },
  // 구분선은 아이콘 자리를 비켜 이름 왼쪽에서 시작한다(iOS와 동일하게 leading 16).
  rowDivider: { height: 1, backgroundColor: T.divider, marginLeft: 16 },
  emptyInline: { fontSize: 15, color: T.inkMuted, paddingVertical: 8 },
});
