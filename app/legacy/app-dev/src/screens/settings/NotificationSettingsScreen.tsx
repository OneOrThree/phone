import { useEffect, useState } from 'react';
import { Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import type { V2RootStackParamList } from '@/navigation/types';
import SettingsScaffold from '@/screens/settings/components/SettingsScaffold';
import {
  SettingsSection,
  SettingsRow,
  SettingsToggleRow,
} from '@/screens/settings/components/SettingsList';
import { DrumPicker } from '@/components/DrumPicker';
import { getMyProfile, updateNotificationSettings } from '@/services/userApi';
import type { NotificationSettingsRequest } from '@/types/dto/user';
import { STORAGE_KEYS } from '@/types/storage';
import { T, withAlpha } from '@/constants/theme';
import { t } from '@/i18n';
import {
  logNotificationSettingsChanged,
  type NotificationSettingKey,
} from '@/services/analyticsEvents';

// 알림 · 심야 · 소리 (라우트 SettingsNotification).
// 현재 백엔드가 저장하는 알림 필드는 5개뿐 → 토글도 그 범위에 맞춰 3개만 노출한다:
//   (1) 알림 받기(master)  (2) 소리(알림음)  (3) 심야 방해 금지(+시작/끝 시간대)
// 집중 리마인더·리그별 개별 토글은 대응 BE 필드가 아직 없어 넣지 않는다(후속 GROMO-559 짝 BE 확장 시 추가).
// 리그 마감·승급·강등 같은 리그 알림은 별도 토글 없이 「알림 받기」에 함께 묶인다(아래 안내문).

// 로컬 상태 = 저장 body와 1:1. 시각 필드는 항상 'HH:mm'로 유지한다.
interface NotifState {
  notificationEnabled: boolean;
  soundEnabled: boolean;
  nightModeEnabled: boolean;
  nightStartTime: string; // 'HH:mm'
  nightEndTime: string; // 'HH:mm'
}

// GET 응답·캐시가 모두 없을 때의 기본값(알림 on, 소리 on, 심야 off, 22:00~08:00).
const DEFAULTS: NotifState = {
  notificationEnabled: true,
  soundEnabled: true,
  nightModeEnabled: false,
  nightStartTime: '22:00',
  nightEndTime: '08:00',
};

// 계측용 필드명 매핑 — NotifState 필드를 이벤트 setting 값으로(GROMO-782)
const SETTING_PARAM: Record<keyof NotifState, NotificationSettingKey> = {
  notificationEnabled: 'notification',
  soundEnabled: 'sound',
  nightModeEnabled: 'night_mode',
  nightStartTime: 'night_start_time',
  nightEndTime: 'night_end_time',
};

// 시(0..23) / 10분 단위 휠 아이템.
const HOUR_ITEMS = Array.from({ length: 24 }, (_, h) => String(h).padStart(2, '0'));
const MINUTE_ITEMS = ['00', '10', '20', '30', '40', '50'];

// 'HH:mm' → [시 인덱스(0..23), 10분 인덱스(0..5)]. 파싱 실패 시 안전한 기본으로 클램프.
function parseHM(time: string): [number, number] {
  const [rawH, rawM] = time.split(':').map((n) => Number(n));
  const h = Number.isFinite(rawH) ? Math.max(0, Math.min(23, rawH)) : 0;
  const mi = Number.isFinite(rawM) ? Math.max(0, Math.min(5, Math.round(rawM / 10))) : 0;
  return [h, mi];
}

// [시 인덱스, 10분 인덱스] → 'HH:mm'.
function fmtHM(hourIdx: number, minIdx: number): string {
  return `${String(hourIdx).padStart(2, '0')}:${String(minIdx * 10).padStart(2, '0')}`;
}

export default function NotificationSettingsScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<V2RootStackParamList>>();

  const [settings, setSettings] = useState<NotifState>(DEFAULTS);
  // 시각 편집 대상 — null이면 피커 닫힘.
  const [pickerFor, setPickerFor] = useState<null | 'start' | 'end'>(null);

  // 초기값 로드: 서버 프로필 → AsyncStorage 캐시 → 기본값(state 초기치) 순서로 폴백.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      // 1) 서버 프로필. 확장 필드(notificationEnabled 등)가 오면 그걸 우선.
      try {
        const p = await getMyProfile();
        if (cancelled) return;
        if (typeof p.notificationEnabled === 'boolean') {
          setSettings({
            notificationEnabled: p.notificationEnabled,
            soundEnabled: p.soundEnabled ?? DEFAULTS.soundEnabled,
            nightModeEnabled: p.nightModeEnabled ?? DEFAULTS.nightModeEnabled,
            nightStartTime: p.nightStartTime ?? DEFAULTS.nightStartTime,
            nightEndTime: p.nightEndTime ?? DEFAULTS.nightEndTime,
          });
          return;
        }
      } catch {
        // 조회 실패 → 캐시로 폴백
      }
      // 2) 로컬 캐시(GET 부재 폴백).
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEYS.notificationSettings);
        if (cancelled) return;
        if (raw) {
          const cached = JSON.parse(raw) as Partial<NotifState>;
          setSettings({
            notificationEnabled: cached.notificationEnabled ?? DEFAULTS.notificationEnabled,
            soundEnabled: cached.soundEnabled ?? DEFAULTS.soundEnabled,
            nightModeEnabled: cached.nightModeEnabled ?? DEFAULTS.nightModeEnabled,
            nightStartTime: cached.nightStartTime ?? DEFAULTS.nightStartTime,
            nightEndTime: cached.nightEndTime ?? DEFAULTS.nightEndTime,
          });
        }
      } catch {
        // 캐시 파싱 실패 → 기본값 유지
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // 값 변경 공통 처리 — 낙관적 로컬 반영 + 캐시 갱신 + 서버 저장(실패해도 로컬 유지).
  function apply(next: NotifState) {
    // 바뀐 필드만 계측 — 모든 변경이 이 함수를 지나므로 여기서 diff로 한 번에 잡는다(GROMO-782)
    (Object.keys(next) as (keyof NotifState)[]).forEach((k) => {
      if (next[k] !== settings[k])
        logNotificationSettingsChanged({ setting: SETTING_PARAM[k], setting_value: next[k] });
    });
    setSettings(next);
    const body: NotificationSettingsRequest = {
      notificationEnabled: next.notificationEnabled,
      soundEnabled: next.soundEnabled,
      nightModeEnabled: next.nightModeEnabled,
      nightStartTime: next.nightStartTime,
      nightEndTime: next.nightEndTime,
    };
    AsyncStorage.setItem(STORAGE_KEYS.notificationSettings, JSON.stringify(body)).catch(() => {});
    (async () => {
      try {
        await updateNotificationSettings(body);
      } catch {
        // 저장 실패해도 낙관적 반영·캐시는 유지(다음 변경 때 재시도)
      }
    })();
  }

  // master가 꺼지면 소리/심야는 조작 불가(회색). 심야 시간행은 master·심야 둘 다 켜졌을 때만 노출.
  const master = settings.notificationEnabled;
  const childDisabled = !master;
  const showNightTimes = master && settings.nightModeEnabled;

  // 시각 피커 확정.
  function confirmTime(value: string) {
    if (pickerFor === 'start') apply({ ...settings, nightStartTime: value });
    else if (pickerFor === 'end') apply({ ...settings, nightEndTime: value });
    setPickerFor(null);
  }

  return (
    <SettingsScaffold title={t('settings.notification.title')} onBack={() => navigation.goBack()}>
      <SettingsSection title={t('settings.notification.sectionNotification')}>
        <SettingsToggleRow
          icon="notifications-outline"
          iconColor={T.accentDeep}
          iconBg={T.sandLight}
          label={t('settings.notification.master')}
          sub={t('settings.notification.masterSub')}
          value={master}
          onValueChange={(v) => apply({ ...settings, notificationEnabled: v })}
        />
        <SettingsToggleRow
          icon="volume-high-outline"
          iconColor={T.greenDeep}
          iconBg={T.greenBg}
          label={t('settings.notification.sound')}
          sub={t('settings.notification.soundSub')}
          value={settings.soundEnabled}
          disabled={childDisabled}
          onValueChange={(v) => apply({ ...settings, soundEnabled: v })}
        />
      </SettingsSection>

      {/* 리그 알림은 개별 토글 없이 「알림 받기」에 포함된다는 안내 */}
      <View style={s.note}>
        <Ionicons name="information-circle-outline" size={16} color={T.inkSub} />
        <Text style={s.noteText}>{t('settings.notification.leagueNote')}</Text>
      </View>

      <SettingsSection title={t('settings.notification.night')}>
        <SettingsToggleRow
          icon="moon-outline"
          iconColor={T.accent}
          iconBg={T.accentBg}
          label={t('settings.notification.night')}
          sub={t('settings.notification.nightSub')}
          value={settings.nightModeEnabled}
          disabled={childDisabled}
          onValueChange={(v) => apply({ ...settings, nightModeEnabled: v })}
        />
        {showNightTimes ? (
          <SettingsRow
            icon="bed-outline"
            iconColor={T.inkSub}
            iconBg={T.sandLight}
            label={t('settings.notification.start')}
            value={settings.nightStartTime}
            valueColor={T.ink}
            onPress={() => setPickerFor('start')}
          />
        ) : null}
        {showNightTimes ? (
          <SettingsRow
            icon="sunny-outline"
            iconColor={T.inkSub}
            iconBg={T.sandLight}
            label={t('settings.notification.end')}
            value={settings.nightEndTime}
            valueColor={T.ink}
            onPress={() => setPickerFor('end')}
          />
        ) : null}
      </SettingsSection>

      {/* 시각 선택 모달 — 편집 대상이 정해졌을 때만 마운트(열 때마다 초기값 새로 반영) */}
      {pickerFor ? (
        <TimePickerModal
          title={
            pickerFor === 'start'
              ? t('settings.notification.nightStartTitle')
              : t('settings.notification.nightEndTitle')
          }
          initial={pickerFor === 'start' ? settings.nightStartTime : settings.nightEndTime}
          onConfirm={confirmTime}
          onClose={() => setPickerFor(null)}
        />
      ) : null}
    </SettingsScaffold>
  );
}

// ── 시각 선택 바텀시트 — 시/10분 휠로 'HH:mm' 확정 ──────────────
function TimePickerModal({
  title,
  initial,
  onConfirm,
  onClose,
}: {
  title: string;
  initial: string; // 'HH:mm'
  onConfirm: (value: string) => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [h, m] = parseHM(initial);
  const [hourIdx, setHourIdx] = useState(h);
  const [minIdx, setMinIdx] = useState(m);

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={s.overlay}>
        <TouchableOpacity style={s.backdrop} activeOpacity={1} onPress={onClose} />
        <View style={[s.sheet, { paddingBottom: insets.bottom + 20 }]}>
          <View style={s.handle} />
          <Text style={s.sheetTitle}>{title}</Text>

          <View style={s.pickerRow}>
            <View style={s.pickerCol}>
              <DrumPicker items={HOUR_ITEMS} selectedIndex={hourIdx} onChange={setHourIdx} />
            </View>
            <Text style={s.colon}>:</Text>
            <View style={s.pickerCol}>
              <DrumPicker items={MINUTE_ITEMS} selectedIndex={minIdx} onChange={setMinIdx} />
            </View>
          </View>

          <TouchableOpacity
            style={s.confirmBtn}
            activeOpacity={0.85}
            onPress={() => onConfirm(fmtHM(hourIdx, minIdx))}
          >
            <Text style={s.confirmText}>{t('common.confirm')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  // 안내(인포) 박스
  note: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: T.space.sm,
    backgroundColor: T.noteBg,
    borderWidth: 1,
    borderColor: T.noteBorder,
    borderRadius: 12,
    paddingVertical: T.space.md,
    paddingHorizontal: T.space.md,
    marginTop: T.space.md,
  },
  noteText: { ...T.text.caption, color: T.inkSub, flex: 1 },

  // 시각 피커 모달
  overlay: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: withAlpha(T.night.bottom, 0.5) },
  sheet: {
    backgroundColor: T.paperLight,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: T.space.xl,
    paddingTop: T.space.md,
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 5,
    borderRadius: 3,
    backgroundColor: T.chipBorder,
    marginBottom: T.space.md,
  },
  sheetTitle: { ...T.text.subtitle, color: T.ink, textAlign: 'center', marginBottom: T.space.sm },
  pickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: T.space.xs,
    marginBottom: T.space.xl,
  },
  pickerCol: { flex: 1 },
  colon: { ...T.text.title, color: T.inkSub, marginHorizontal: T.space.xs },
  confirmBtn: {
    minHeight: 54,
    paddingVertical: T.space.md,
    borderRadius: 16,
    backgroundColor: T.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmText: { ...T.text.subtitle, color: T.white },
});
