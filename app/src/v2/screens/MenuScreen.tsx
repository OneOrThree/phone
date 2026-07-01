import { View, Text, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { triggerLogout } from '@/services/api';
import ScreenTimeModule from '@/services/ScreenTimeModule';
import { T } from '@/v2/constants/theme';

// v2 전체 탭 — 측정 대상(스크린타임 picker) 재설정 + 로그아웃.
// TODO: 프로필·목표 변경·고객센터 등 메뉴 항목 추가.

// 설정 리스트 한 줄 (렌더 중 컴포넌트 정의 방지 위해 모듈 스코프)
function Row({
  icon,
  iconColor,
  iconBg,
  label,
  sub,
  onPress,
  danger,
  divider,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  iconColor: string;
  iconBg: string;
  label: string;
  sub?: string;
  onPress: () => void;
  danger?: boolean;
  divider?: boolean;
}) {
  return (
    <TouchableOpacity
      style={[s.row, divider ? s.rowDivider : null]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <View style={[s.rowIcon, { backgroundColor: iconBg }]}>
        <Ionicons name={icon} size={18} color={iconColor} />
      </View>
      <View style={s.flex1}>
        <Text style={[s.rowLabel, danger ? { color: T.accentAlt } : null]}>{label}</Text>
        {sub ? <Text style={s.rowSub}>{sub}</Text> : null}
      </View>
      {!danger ? <Ionicons name="chevron-forward" size={17} color={T.inkMuted} /> : null}
    </TouchableOpacity>
  );
}

export default function MenuScreen() {
  // 스크린타임 측정 대상(앱/카테고리) 재선택 → 즉시 활성 selection으로 반영.
  async function editScreenTimeTargets() {
    try {
      const status = await ScreenTimeModule.getAuthorizationStatus();
      if (status !== 'approved') {
        Alert.alert(
          '스크린타임 권한 필요',
          '측정 대상을 고르려면 먼저 스크린타임 권한을 허용해야 해요.',
        );
        return;
      }
      const counts = await ScreenTimeModule.presentAppPicker();
      if (!counts) return; // 취소
      await ScreenTimeModule.promoteSelection();
      const total = counts.applications + counts.categories + counts.webDomains;
      Alert.alert(
        '측정 대상 변경됨',
        total > 0 ? `앱·카테고리 ${total}개를 측정합니다.` : '측정 대상을 비웠어요(전체 앱 기준).',
      );
    } catch (e) {
      Alert.alert('설정 실패', e instanceof Error ? e.message : String(e));
    }
  }

  function onLogout() {
    Alert.alert('로그아웃', '로그아웃 하시겠어요?', [
      { text: '취소', style: 'cancel' },
      { text: '로그아웃', style: 'destructive', onPress: () => triggerLogout() },
    ]);
  }

  return (
    <SafeAreaView style={s.root} edges={['top']}>
      <View style={s.header}>
        <Text style={s.headerTitle}>전체</Text>
      </View>

      <View style={s.body}>
        <View style={s.card}>
          <Row
            divider
            icon="apps-outline"
            iconColor={T.accent}
            iconBg="#F6ECE0"
            label="측정 대상 앱 설정"
            sub="핸드폰 사용시간을 잴 앱·카테고리 선택"
            onPress={editScreenTimeTargets}
          />
          <Row
            icon="log-out-outline"
            iconColor={T.accentAlt}
            iconBg="#F6E7E2"
            label="로그아웃"
            onPress={onLogout}
            danger
          />
        </View>
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: T.paperLight },
  header: { paddingHorizontal: 20, paddingTop: 6, paddingBottom: 8 },
  headerTitle: { ...T.text.title, color: T.ink },
  body: { paddingHorizontal: 18, paddingTop: 8 },
  card: {
    backgroundColor: T.white,
    borderWidth: 1,
    borderColor: T.paperAlt,
    borderRadius: 16,
    paddingHorizontal: 14,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14 },
  rowDivider: { borderBottomWidth: 1, borderBottomColor: '#F0E9DC' },
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
});
