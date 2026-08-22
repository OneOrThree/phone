import { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Platform,
  Image,
  FlatList,
  AppState,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
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
  // 권한이 사라진 상태 — '기록이 없음'과 반드시 구분해야 한다(아래 주석 참고).
  const [permissionLost, setPermissionLost] = useState(false);
  const insets = useSafeAreaInsets();

  const load = useCallback(async () => {
    // ⚠️ 권한 상태를 **함께** 확인한다(코드리뷰 반영). 사용 정보 접근을 끄면 네이티브가
    //    예외를 던지는 게 아니라 빈 배열과 0 을 돌려준다 — Promise 는 성공하고 catch 는 안
    //    돌아서, 화면이 '0분 · 사용 기록이 없어요'로 바뀐다. 사용자는 오늘 아무 앱도 안 쓴
    //    걸로 읽는다. 이 화면을 열어 둔 채 설정에서 권한을 끄고 돌아오면 바로 재현된다.
    //
    // 총 사용시간은 홈 카드와 **같은 함수**로 받는다 — 목록 합으로 따로 계산하면 폴백 경로에서
    // "홈은 21분, 상세는 22분"처럼 갈린다. 대신 목록과의 차이는 아래 '그 외' 행이 메운다.
    const [status, list, minutes] = await Promise.all([
      ScreenTimeModule.getAuthorizationStatus(),
      ScreenTimeModule.getUsageByApp(0),
      ScreenTimeModule.getTodayUsageBucketMinutes(),
    ]);
    return { status, list, minutes };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const run = () =>
      load()
        .then(({ status, list, minutes }) => {
          if (cancelled) return;
          setPermissionLost(status !== 'approved');
          setRows(list);
          setTotalMinutes(minutes);
          setFailed(false);
        })
        // 실패를 빈 목록으로 뭉개지 않는다 — '오늘 아무 앱도 안 씀'과 구분되어야 한다.
        .catch(() => !cancelled && setFailed(true));

    run();

    // 앱 복귀 시 재조회(코드리뷰 반영) — 이 화면을 열어 둔 채 나가서 다른 앱을 쓰고 돌아오면
    // 컴포넌트는 계속 마운트돼 있어 위 effect 가 다시 돌지 않는다. 그러면 **화면을 처음 열
    // 때의 숫자가 그대로 남아**, 방금 쓴 앱이 목록에 없거나 시간이 안 늘어난 것처럼 보인다.
    // useFocusEffect 로는 안 된다 — 포그라운드 복귀는 내비게이션 포커스를 바꾸지 않는다
    // (HomeScreen 이 AppState 를 구독하는 것과 같은 이유).
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') run();
    });
    return () => {
      cancelled = true;
      sub.remove();
    };
  }, [load]);

  if (failed) return <Text style={s.empty}>사용 기록을 불러오지 못했어요</Text>;
  // 권한이 빠진 상태를 '기록 없음'으로 그리면 화면이 거짓말을 한다 — 원인과 할 일을 알린다.
  if (permissionLost) {
    return (
      <Text style={s.empty}>
        사용 정보 접근 권한이 꺼져 있어요.{'\n'}설정에서 다시 켜면 사용 기록이 보여요.
      </Text>
    );
  }
  if (rows === null) {
    return (
      <View style={s.loading}>
        <ActivityIndicator color={T.accent} />
      </View>
    );
  }

  // 총계와 목록의 **집계 범위가 다르다**(코드리뷰 반영). 총계는 모든 패키지를 더하는데
  // 목록은 런처에서 열 수 있는 앱만 남긴다 — 홈 런처·시스템 UI 에 머문 시간이 총계에는
  // 들어가고 목록에는 대응 행이 없다. 그대로 두면 한 화면 안에서 "총 21분인데 더하면 18분"이
  // 된다. 차이를 '그 외' 한 행으로 드러내 합이 맞게 한다.
  //
  // ⚠️ 차이는 **화면에 찍히는 단위**로 계산한다(코드리뷰 반영). 초 단위 합을 이미 내림된
  //    총계에서 빼면 실제 차이가 1분을 넘어도 행이 안 생긴다:
  //      보이는 앱 601초(→10분) + 안 보이는 앱 118초 = 719초 → 총계 11분(660초)
  //      초로 빼면 660 - 601 = 59초 → 행 없음. 화면엔 총계 11분, 행 합 10분만 남는다.
  //    행이 내림해 찍히므로 '내림한 분의 합'과 총계 분을 비교해야 눈에 보이는 숫자가 맞는다.
  const listedMinutes = rows.reduce((sum, r) => sum + Math.floor(r.seconds / 60), 0);
  const otherMinutes = Math.max(0, (totalMinutes ?? 0) - listedMinutes);
  const items: AppUsage[] =
    otherMinutes >= 1
      ? [...rows, { packageName: OTHER_ROW_KEY, label: '그 외', seconds: otherMinutes * 60 }]
      : rows;

  return (
    // FlatList 로 가상화한다(코드리뷰 반영). ScrollView + map 은 진입 즉시 모든 행을 마운트해,
    // 행마다 아이콘 조회(96px 비트맵 → PNG → base64 브리지 전송)가 한꺼번에 터진다. 앱을 많이
    // 쓴 날일수록 초기 렌더가 느려지고 캐시에 남는 문자열도 앱 수에 비례해 늘어난다.
    <FlatList
      data={items}
      keyExtractor={(item) => item.packageName}
      // 하단 시스템 영역 확보(코드리뷰 반영) — edgeToEdgeEnabled=true 이고 SafeAreaView 가
      // edges={['top']} 이라, 3버튼 내비게이션처럼 하단 인셋이 큰 기기에서 마지막 행이 투명한
      // 내비게이션 바 아래로 들어가 안 보인다.
      contentContainerStyle={[s.usageScroll, { paddingBottom: 16 + insets.bottom }]}
      ListHeaderComponent={
        <View style={s.listHeader}>
          {/* 총 사용시간 카드 — iOS와 같은 문구·위계 */}
          <View style={s.totalCard}>
            <Text style={s.totalLabel}>오늘 총 사용시간</Text>
            <Text style={s.totalValue}>{formatMinutes(totalMinutes ?? 0)}</Text>
          </View>
          <Text style={s.sectionHeader}>앱별 사용시간</Text>
          {items.length === 0 ? <Text style={s.emptyInline}>사용 기록이 없어요</Text> : null}
        </View>
      }
      ItemSeparatorComponent={() => <View style={s.rowDivider} />}
      renderItem={({ item, index }) => (
        <View
          style={[
            s.usageRow,
            s.usageRowCard,
            index === 0 && s.usageRowFirst,
            index === items.length - 1 && s.usageRowLast,
          ]}
        >
          {item.packageName === OTHER_ROW_KEY ? (
            <View style={[s.appIcon, s.appIconPlaceholder]} />
          ) : (
            <AppIcon packageName={item.packageName} />
          )}
          <Text style={s.usageLabel} numberOfLines={1}>
            {item.label}
          </Text>
          <Text style={s.usageValue}>{formatUsage(item.seconds)}</Text>
        </View>
      )}
    />
  );
}

// '그 외' 합계 행의 키 — 실제 패키지명과 겹치지 않게 점을 쓰지 않는다.
const OTHER_ROW_KEY = '__other__';

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
//
// 1분 이상은 **내림**이다(코드리뷰 반영). 총계는 네이티브가 밀리초를 60,000으로 나눠 내리고
// iOS formatDuration 도 내리는데 여기만 반올림하면 같은 사용량이 더 크게 뜬다 — 90초를 쓰면
// 총계는 '1분'인데 그 앱 행은 '2분'이 되고, 여러 앱이 분 경계에 걸리면 행 합계가 총계를
// 여러 분 넘어선다.
function formatUsage(seconds: number): string {
  if (seconds < 60) return `${seconds}초`;
  return formatMinutes(Math.floor(seconds / 60));
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
  // ⚠️ 여기에 gap 을 주면 안 된다(코드리뷰 반영). contentContainerStyle 의 gap 은 헤더뿐
  //    아니라 **FlatList 의 셀 사이에도** 붙어서, ItemSeparatorComponent 위에 18px 이 더
  //    끼어든다. 첫/마지막 행에만 모서리를 준 카드가 중간이 떨어진 각진 블록으로 보인다.
  //    섹션 간 간격은 헤더 안에서 준다.
  usageScroll: { padding: 16 },
  listHeader: { gap: 18, paddingBottom: 18 },
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
  // FlatList 로 가상화하면서 카드를 감싸는 View 를 못 쓰게 됐다(그 View 가 모든 행을
  // 마운트시킨다). 대신 행마다 카드 배경·좌우 테두리를 주고 첫/마지막 행만 모서리를 굴려
  // 같은 모양을 만든다 — 보이는 결과는 이전 usageCard 와 동일하다.
  usageRowCard: {
    backgroundColor: T.white,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: T.border,
  },
  usageRowFirst: {
    borderTopWidth: 1,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
  },
  usageRowLast: {
    borderBottomWidth: 1,
    borderBottomLeftRadius: 16,
    borderBottomRightRadius: 16,
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
