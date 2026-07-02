import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert, Modal } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { triggerLogout, api } from '@/services/api';
import ScreenTimeModule from '@/services/ScreenTimeModule';
import { STORAGE_KEYS } from '@/types/storage';
import { useUser } from '@/store/UserContext';
import { T } from '@/v2/constants/theme';

// v2 전체 탭 — 목표(스크린타임·집중) 변경 + 측정 대상 picker + 로그아웃.

// 초 → "N시간 M분"
function hm(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  if (h && m) return `${h}시간 ${m}분`;
  if (h) return `${h}시간`;
  return `${m}분`;
}

const STEP = 10 * 60; // 10분 단위 조정
type GoalKey = 'screen' | 'focus';
const GOAL_META: Record<GoalKey, { title: string; min: number; max: number }> = {
  screen: { title: '스크린타임 목표', min: 30 * 60, max: 12 * 3600 },
  focus: { title: '집중 목표', min: 30 * 60, max: 8 * 3600 },
};

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
  const { goalSeconds, setGoalSeconds, screenTimeGoalSeconds, setScreenTimeGoalSeconds } =
    useUser();
  const [editing, setEditing] = useState<{ key: GoalKey; seconds: number } | null>(null);
  // 집중 중 허용앱 개수 — 행 sub 표시용. null = 아직 로드 전.
  const [allowedApps, setAllowedApps] = useState<number | null>(null);

  useEffect(() => {
    ScreenTimeModule.getAllowedSelectionCounts()
      .then((c) => setAllowedApps(c?.applications ?? 0))
      .catch(() => setAllowedApps(0));
  }, []);

  function openEdit(key: GoalKey) {
    setEditing({ key, seconds: key === 'screen' ? screenTimeGoalSeconds : goalSeconds });
  }

  function adjust(delta: number) {
    setEditing((e) => {
      if (!e) return e;
      const meta = GOAL_META[e.key];
      return { ...e, seconds: Math.min(meta.max, Math.max(meta.min, e.seconds + delta)) };
    });
  }

  async function saveEdit() {
    if (!editing) return;
    const { key, seconds } = editing;
    setEditing(null);
    if (key === 'focus') {
      // 집중 목표는 로컬(세션) 반영 — 서버 필드 미정. TODO: 백엔드 필드 생기면 동기화.
      setGoalSeconds(seconds);
      return;
    }
    // 스크린타임 목표 — 컨텍스트 + 서버 + 로컬 유저 캐시 반영.
    setScreenTimeGoalSeconds(seconds);
    const minutes = Math.round(seconds / 60);
    try {
      await api.post('/api/v1/user', { dailyScreenTimeGoalMinutes: minutes });
    } catch {
      /* 실패해도 로컬은 반영, 다음 진입에 재시도 여지 */
    }
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEYS.user);
      if (raw) {
        const u = JSON.parse(raw);
        u.dailyScreenTimeGoalMinutes = minutes;
        await AsyncStorage.setItem(STORAGE_KEYS.user, JSON.stringify(u));
      }
    } catch {
      /* noop */
    }
  }

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
      if (!counts) return;
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

  // 집중 중 허용앱 선택 — 세션 실드에서 예외로 열어줄 앱들.
  async function editAllowedApps() {
    try {
      const status = await ScreenTimeModule.getAuthorizationStatus();
      if (status !== 'approved') {
        Alert.alert(
          '스크린타임 권한 필요',
          '허용앱을 고르려면 먼저 스크린타임 권한을 허용해야 해요.',
        );
        return;
      }
      const counts = await ScreenTimeModule.presentAllowedAppManager();
      if (!counts) return;
      setAllowedApps(counts.applications);
      // 실드 예외는 개별 앱 토큰만 지원 — 카테고리로 골랐으면 안내
      const categoryNote =
        counts.categories > 0 ? '\n(카테고리 선택은 적용되지 않아요 — 개별 앱으로 골라주세요)' : '';
      Alert.alert(
        '허용앱 변경됨',
        counts.applications > 0
          ? `집중 중에도 앱 ${counts.applications}개를 쓸 수 있어요.${categoryNote}`
          : `허용앱을 비웠어요 — 집중 중엔 모든 앱이 잠겨요.${categoryNote}`,
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
            icon="phone-portrait-outline"
            iconColor={T.accent}
            iconBg={T.accentBg}
            label="스크린타임 목표"
            sub={hm(screenTimeGoalSeconds)}
            onPress={() => openEdit('screen')}
          />
          <Row
            divider
            icon="book-outline"
            iconColor={T.greenDeep}
            iconBg={T.greenBg}
            label="집중 목표"
            sub={hm(goalSeconds)}
            onPress={() => openEdit('focus')}
          />
          <Row
            divider
            icon="apps-outline"
            iconColor={T.accentDeep}
            iconBg={T.sandLight}
            label="측정 대상 앱 설정"
            sub="핸드폰 사용시간을 잴 앱·카테고리 선택"
            onPress={editScreenTimeTargets}
          />
          <Row
            divider
            icon="lock-open-outline"
            iconColor={T.greenDeep}
            iconBg={T.greenBg}
            label="집중 중 허용 앱"
            sub={
              allowedApps === null
                ? '집중 중에도 쓸 수 있는 앱 선택'
                : allowedApps > 0
                  ? `앱 ${allowedApps}개 허용 중`
                  : '허용앱 없음 — 집중 중 모든 앱 잠금'
            }
            onPress={editAllowedApps}
          />
          <Row
            icon="log-out-outline"
            iconColor={T.accentAlt}
            iconBg={T.accentAltBg}
            label="로그아웃"
            onPress={onLogout}
            danger
          />
        </View>
      </View>

      {/* 목표 편집 모달 */}
      <Modal
        visible={editing !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setEditing(null)}
      >
        <View style={s.modalOverlay}>
          <View style={s.modalCard}>
            <Text style={s.modalTitle}>{editing ? GOAL_META[editing.key].title : ''}</Text>
            <View style={s.stepper}>
              <TouchableOpacity style={s.stepBtn} onPress={() => adjust(-STEP)} activeOpacity={0.7}>
                <Ionicons name="remove" size={22} color={T.ink} />
              </TouchableOpacity>
              <Text style={s.stepValue}>{editing ? hm(editing.seconds) : ''}</Text>
              <TouchableOpacity style={s.stepBtn} onPress={() => adjust(STEP)} activeOpacity={0.7}>
                <Ionicons name="add" size={22} color={T.ink} />
              </TouchableOpacity>
            </View>
            <View style={s.modalBtns}>
              <TouchableOpacity
                style={[s.modalBtn, s.modalCancel]}
                onPress={() => setEditing(null)}
                activeOpacity={0.8}
              >
                <Text style={s.modalCancelText}>취소</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.modalBtn, s.modalSave]}
                onPress={saveEdit}
                activeOpacity={0.8}
              >
                <Text style={s.modalSaveText}>저장</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
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
  rowDivider: { borderBottomWidth: 1, borderBottomColor: T.divider },
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

  // 목표 편집 모달
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(27,22,19,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  modalCard: {
    width: '100%',
    backgroundColor: T.white,
    borderRadius: 22,
    paddingHorizontal: 22,
    paddingTop: 22,
    paddingBottom: 18,
  },
  modalTitle: { ...T.text.subtitle, color: T.ink, textAlign: 'center' },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 20,
    marginBottom: 22,
  },
  stepBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: T.paperLight,
    borderWidth: 1,
    borderColor: T.paperAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepValue: { ...T.text.heading, color: T.ink },
  modalBtns: { flexDirection: 'row', gap: 10 },
  modalBtn: {
    flex: 1,
    height: 50,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalCancel: { backgroundColor: T.paperLight, borderWidth: 1, borderColor: T.paperAlt },
  modalCancelText: { ...T.text.label, color: T.inkSub },
  modalSave: { backgroundColor: T.accent },
  modalSaveText: { ...T.text.label, color: T.white },
});
