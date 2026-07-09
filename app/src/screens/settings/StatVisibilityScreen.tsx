import { useEffect, useRef, useState } from 'react';
import { Text, StyleSheet } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import SettingsScaffold from '@/screens/settings/components/SettingsScaffold';
import { SettingsSection, SettingsRow } from '@/screens/settings/components/SettingsList';
import { getMyProfile, updateStatVisibility } from '@/services/userApi';
import type { StatVisibility } from '@/types/dto/user';
import { STORAGE_KEYS } from '@/types/storage';
import type { V2RootStackParamList } from '@/navigation/types';
import { T } from '@/constants/theme';

// 상세 통계 공개 범위(SET·통계 공개) — PUBLIC/FRIENDS 택1 라디오.
// 초기값: 서버 프로필 → 로컬 캐시 → 기본 'FRIENDS' 순으로 폴백. 탭 시 낙관적 반영 후 서버·캐시 저장.

// 옵션 메타 — 라벨/설명/아이콘을 한 곳에서 관리.
const OPTIONS: {
  value: StatVisibility;
  label: string;
  sub: string;
  icon: keyof typeof Ionicons.glyphMap;
  iconColor: string;
  iconBg: string;
}[] = [
  {
    value: 'PUBLIC',
    label: '전체 공개',
    sub: '리그의 모든 사람이 볼 수 있어요',
    icon: 'earth-outline',
    iconColor: T.accentDeep,
    iconBg: T.accentBg,
  },
  {
    value: 'FRIENDS',
    label: '친구 공개',
    sub: '친구로 수락한 사람만 볼 수 있어요',
    icon: 'people-outline',
    iconColor: T.greenDeep,
    iconBg: T.greenBg,
  },
];

// 선택 표시 — 선택 시 채운 체크, 미선택은 빈 원.
function RadioMark({ selected }: { selected: boolean }) {
  return selected ? (
    <Ionicons name="checkmark-circle" size={24} color={T.accent} />
  ) : (
    <Ionicons name="ellipse-outline" size={24} color={T.inkMuted} />
  );
}

export default function StatVisibilityScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<V2RootStackParamList>>();

  // null = 초기 로딩(아직 결정 전) — 이때는 둘 다 미선택으로 렌더해 잘못된 값 깜빡임을 피한다.
  const [value, setValue] = useState<StatVisibility | null>(null);
  // 로딩 완료 전 유저가 먼저 탭한 경우, 뒤늦게 도착한 초기값이 선택을 덮어쓰지 않도록 표시.
  const touchedRef = useRef(false);

  // 초기값 로드: 서버 프로필 → 로컬 캐시 → 기본 'FRIENDS'.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let resolved: StatVisibility | null = null;
      try {
        const profile = await getMyProfile();
        if (profile.statVisibility) resolved = profile.statVisibility;
      } catch {
        // 서버 조회 실패 — 캐시/기본값으로 폴백.
      }
      if (resolved === null) {
        try {
          const cached = await AsyncStorage.getItem(STORAGE_KEYS.statVisibility);
          if (cached === 'PUBLIC' || cached === 'FRIENDS') resolved = cached;
        } catch {
          // 캐시 조회 실패 — 기본값으로 폴백.
        }
      }
      if (!cancelled && !touchedRef.current) setValue(resolved ?? 'FRIENDS');
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // 탭 시 낙관적 반영 후 로컬 캐시·서버에 저장(각각 try/catch, 실패해도 낙관적 값 유지).
  const select = async (next: StatVisibility) => {
    touchedRef.current = true;
    if (next === value) return;
    setValue(next);
    try {
      await AsyncStorage.setItem(STORAGE_KEYS.statVisibility, next);
    } catch {
      // 로컬 캐시 저장 실패 — 무시(서버 저장이 소스 오브 트루스).
    }
    try {
      await updateStatVisibility({ statVisibility: next });
    } catch {
      // 서버 저장 실패 — 낙관적 값 유지, 다음 진입 시 재조회로 정정.
    }
  };

  return (
    <SettingsScaffold title="상세 통계 공개" onBack={() => navigation.goBack()}>
      <Text style={s.note}>다른 사람에게 내 상세 통계를 어디까지 보여줄지 선택해요.</Text>

      <SettingsSection>
        {OPTIONS.map((opt) => (
          <SettingsRow
            key={opt.value}
            icon={opt.icon}
            iconColor={opt.iconColor}
            iconBg={opt.iconBg}
            label={opt.label}
            sub={opt.sub}
            onPress={() => select(opt.value)}
            right={<RadioMark selected={value === opt.value} />}
          />
        ))}
      </SettingsSection>
    </SettingsScaffold>
  );
}

const s = StyleSheet.create({
  note: { ...T.text.caption, color: T.inkMuted, marginTop: 4, marginLeft: 6, lineHeight: 19 },
});
