import { useCallback, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert, Linking } from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import ScreenTimeModule, { type AuthorizationStatus } from '@/services/ScreenTimeModule';
import { updateScreenTimePermission } from '@/services/userApi';
import { registerUsageBucketMonitoring, registerGoalMonitoring } from '@/services/screentimeSync';
import { useUser } from '@/store/UserContext';
import SettingsScaffold from '@/screens/settings/components/SettingsScaffold';
import { SettingsSection, SettingsRow } from '@/screens/settings/components/SettingsList';
import type { V2RootStackParamList } from '@/navigation/types';
import { STORAGE_KEYS } from '@/types/storage';
import { T } from '@/constants/theme';

// SET · 스크린타임 권한 관리 화면(SettingsScreenTimePermission).
// 권한 상태 배지 + 수집 항목 안내 + 기기내 처리 안내 + '측정 대상 앱 설정'(기존 MenuScreen 이식) + iOS 설정 이동.
// 스크린타임은 iOS 전용 기능이라 실기기에서만 실제 동작하고, 그 외에선 배지·버튼이 무해하게 표시된다.

// 로컬(기기 시간대) 기준 'YYYY-MM-DD'.
function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// 저장된 마지막 동기화 날짜 → 상대 라벨(오늘/어제/날짜).
function syncLabel(raw: string): string {
  const date = raw.slice(0, 10); // 타임스탬프로 저장돼도 날짜부만 사용
  const now = new Date();
  if (date === ymd(now)) return '오늘';
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date === ymd(yesterday)) return '어제';
  return date;
}

// 권한 상태별 배지 메타(라벨·글자색·배경). null = 조회 중.
function badgeMeta(status: AuthorizationStatus | null): {
  label: string;
  color: string;
  bg: string;
} {
  if (status === 'approved') return { label: '허용됨', color: T.successInk, bg: T.successBg };
  if (status === 'denied') return { label: '거부됨', color: T.dangerInk, bg: T.dangerBg };
  if (status === 'notDetermined') return { label: '요청 필요', color: T.inkSub, bg: T.sandLight };
  return { label: '확인 중', color: T.inkMuted, bg: T.sandLight };
}

export default function ScreenTimePermissionScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<V2RootStackParamList>>();
  // 측정 대상 변경 시 재등록에 현재 목표초와, 모니터 소유 기록용 계정이 필요하다(GROMO-633).
  const { userId, screenTimeGoalSeconds } = useUser();

  const [status, setStatus] = useState<AuthorizationStatus | null>(null);
  const [lastSynced, setLastSynced] = useState<string | null>(null);
  const [requesting, setRequesting] = useState(false);

  // 재진입마다 권한 상태·마지막 동기화 최신값 반영(iOS 설정에서 바꾸고 돌아올 수 있으므로).
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      ScreenTimeModule.getAuthorizationStatus()
        .then((st) => !cancelled && setStatus(st))
        .catch(() => !cancelled && setStatus(null));
      AsyncStorage.getItem(STORAGE_KEYS.screentimeLastSyncedDate)
        .then((raw) => !cancelled && setLastSynced(raw ? syncLabel(raw) : null))
        .catch(() => !cancelled && setLastSynced(null));
      return () => {
        cancelled = true;
      };
    }, []),
  );

  // notDetermined 상태에서만 노출 — 시스템 권한창 → 서버 반영 → 상태 재조회.
  async function requestPermission() {
    if (requesting) return;
    setRequesting(true);
    try {
      const granted = await ScreenTimeModule.requestAuthorization();
      try {
        await updateScreenTimePermission({ granted });
      } catch {
        // 서버 반영 실패는 조용히 무시 — 기기 권한 상태가 진실.
      }
      const st = await ScreenTimeModule.getAuthorizationStatus();
      setStatus(st);
      Alert.alert(
        granted ? '권한이 켜졌어요' : '권한이 꺼져 있어요',
        granted
          ? '이제 사용시간 통계와 자동 코인이 동작해요.'
          : 'iOS 설정 > 스크린 타임에서 다시 켤 수 있어요.',
      );
    } catch (e) {
      Alert.alert('권한 처리 실패', e instanceof Error ? e.message : String(e));
    } finally {
      setRequesting(false);
    }
  }

  // 스크린타임 측정 대상(앱/카테고리) 재선택 → 즉시 활성 selection으로 승격(기존 MenuScreen editScreenTimeTargets 이식).
  async function editScreenTimeTargets() {
    try {
      const st = await ScreenTimeModule.getAuthorizationStatus();
      if (st !== 'approved') {
        Alert.alert(
          '스크린타임 권한 필요',
          '측정 대상을 고르려면 먼저 스크린타임 권한을 허용해야 해요.',
        );
        return;
      }
      const counts = await ScreenTimeModule.presentAppPicker();
      if (!counts) return; // 피커 취소
      await ScreenTimeModule.promoteSelection();
      // 측정 대상이 바뀌면 두 모니터링(사용량 버킷·목표 판정) 모두 재등록 필수 — threshold
      // 이벤트가 등록 시점 selection 토큰으로 고정되어 있어 재등록 없이는 새 대상이 측정되지
      // 않는다(GROMO-633).
      const monitoring = await registerUsageBucketMonitoring(userId);
      await registerGoalMonitoring(screenTimeGoalSeconds);
      const total = counts.applications + counts.categories + counts.webDomains;
      if (!monitoring && total === 0) {
        // 빈 선택 — 네이티브가 기존 모니터를 중지하고 등록을 거부한다(threshold는 토큰 없이
        // 발화 불가). 등록 기록을 지워 다음 선택 때 다시 등록되게 하고, 사실대로 안내한다.
        AsyncStorage.removeItem(STORAGE_KEYS.screentimeBucketMonitorRegistered).catch(() => {});
        AsyncStorage.removeItem(STORAGE_KEYS.screentimeGoalMonitorSeconds).catch(() => {});
        Alert.alert(
          '측정 대상 변경됨',
          '측정 대상을 비웠어요 — 사용량 측정과 서버 동기화가 중단돼요. 홈 리포트는 전체 앱 기준으로 표시돼요.',
        );
        return;
      }
      Alert.alert('측정 대상 변경됨', `앱·카테고리 ${total}개를 측정합니다.`);
    } catch (e) {
      Alert.alert('설정 실패', e instanceof Error ? e.message : String(e));
    }
  }

  const badge = badgeMeta(status);

  const footer = (
    <View style={s.footerCol}>
      {status === 'notDetermined' ? (
        <TouchableOpacity
          style={[s.primaryBtn, requesting ? s.btnDisabled : null]}
          activeOpacity={0.85}
          disabled={requesting}
          onPress={requestPermission}
        >
          <Text style={s.primaryBtnText}>{requesting ? '요청 중…' : '권한 요청'}</Text>
        </TouchableOpacity>
      ) : null}
      <TouchableOpacity
        style={s.secondaryBtn}
        activeOpacity={0.8}
        onPress={() => Linking.openSettings()}
      >
        <Ionicons name="settings-outline" size={18} color={T.ink} />
        <Text style={s.secondaryBtnText}>iOS 설정에서 관리</Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <SettingsScaffold title="스크린타임 권한" onBack={() => navigation.goBack()} footer={footer}>
      {/* 상태 카드 — 권한 배지 + 마지막 동기화 */}
      <View style={s.statusCard}>
        <View style={s.iconBox}>
          <Ionicons name="phone-portrait-outline" size={20} color={T.accentDeep} />
        </View>
        <View style={s.flex1}>
          <Text style={s.statusTitle}>스크린타임 접근</Text>
          {lastSynced ? <Text style={s.statusSub}>{`마지막 동기화 · ${lastSynced}`}</Text> : null}
        </View>
        <View style={[s.badge, { backgroundColor: badge.bg }]}>
          <Text style={[s.badgeText, { color: badge.color }]}>{badge.label}</Text>
        </View>
      </View>

      {/* 수집 항목 — 정적 안내(탭 불가) */}
      <SettingsSection title="수집 항목">
        <SettingsRow
          icon="time-outline"
          iconColor={T.accentDeep}
          iconBg={T.accentBg}
          label="앱별 사용 시간"
          sub="어떤 앱을 얼마나 썼는지"
        />
        <SettingsRow
          icon="albums-outline"
          iconColor={T.greenDeep}
          iconBg={T.greenBg}
          label="카테고리별 분류"
          sub="SNS · 게임 등으로 묶어 집계"
        />
      </SettingsSection>

      {/* 기기내 처리 안내 + 권한 종료 시 영향 */}
      <View style={s.noteCard}>
        <View style={s.noteHead}>
          <Ionicons name="lock-closed-outline" size={16} color={T.successInk} />
          <Text style={s.noteStrong}>기기에서만 처리 · 서버 미전송</Text>
        </View>
        <Text style={s.noteBody}>
          권한을 끄면 사용시간 통계·자동 코인이 멈춰요. iOS 설정 앱에서도 바꿀 수 있어요.
        </Text>
      </View>

      {/* 관리 — 측정 대상 앱 설정 */}
      <SettingsSection title="관리">
        <SettingsRow
          icon="apps-outline"
          iconColor={T.accent}
          iconBg={T.accentBg}
          label="측정 대상 앱 설정"
          sub="사용시간을 잴 앱·카테고리 선택"
          onPress={editScreenTimeTargets}
        />
      </SettingsSection>
    </SettingsScaffold>
  );
}

const s = StyleSheet.create({
  flex1: { flex: 1 },

  // 상태 카드
  statusCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: T.space.md,
    backgroundColor: T.white,
    borderWidth: 1,
    borderColor: T.paperAlt,
    borderRadius: 16,
    paddingVertical: T.space.lg,
    paddingHorizontal: T.space.lg,
  },
  iconBox: {
    width: 44,
    height: 44,
    borderRadius: 13,
    backgroundColor: T.accentBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusTitle: { ...T.text.label, color: T.ink },
  statusSub: { ...T.text.caption, color: T.inkMuted, marginTop: 3 },
  badge: { paddingHorizontal: T.space.md, paddingVertical: T.space.xs, borderRadius: 999 },
  badgeText: { ...T.text.caption },

  // 안내 카드
  noteCard: {
    backgroundColor: T.noteBg,
    borderWidth: 1,
    borderColor: T.noteBorder,
    borderRadius: 14,
    paddingVertical: T.space.md,
    paddingHorizontal: T.space.lg,
    marginTop: T.space.lg,
  },
  noteHead: { flexDirection: 'row', alignItems: 'center', gap: T.space.sm },
  noteStrong: { ...T.text.label, color: T.ink },
  noteBody: { ...T.text.caption, color: T.inkSub, lineHeight: 19, marginTop: T.space.sm },

  // 하단 버튼
  footerCol: { gap: T.space.md },
  primaryBtn: {
    height: 54,
    borderRadius: 16,
    backgroundColor: T.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnText: { ...T.text.subtitle, color: T.white },
  btnDisabled: { opacity: 0.5 },
  secondaryBtn: {
    height: 52,
    borderRadius: 16,
    backgroundColor: T.white,
    borderWidth: 1,
    borderColor: T.paperAlt,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: T.space.sm,
  },
  secondaryBtnText: { ...T.text.label, color: T.ink },
});
