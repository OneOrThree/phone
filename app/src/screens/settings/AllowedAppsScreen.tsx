import { useCallback, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import ScreenTimeModule, { type AppSelectionCounts } from '@/services/ScreenTimeModule';
import SettingsScaffold from '@/screens/settings/components/SettingsScaffold';
import { SettingsSection, SettingsRow } from '@/screens/settings/components/SettingsList';
import type { V2RootStackParamList } from '@/navigation/types';
import { T } from '@/constants/theme';

// SET·집중 중 허용 앱 관리 화면.
// 집중 세션 실드에서 예외로 열어줄 앱들을 고른다.
//
// ⚠️ iOS FamilyControls 토큰은 opaque라 JS에서 개별 앱 이름/아이콘을 읽을 수 없다.
// 그래서 MVP는 '허용 개수 + 네이티브 피커 버튼'으로만 구성한다.
// (개별 앱 리스트뷰가 필요하면 네이티브 SwiftUI Label(token) 뷰로 후속 구현 — GROMO-571 참고)

export default function AllowedAppsScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<V2RootStackParamList>>();

  // 저장된 허용앱 선택 개수. null = 아직 로드 전.
  const [counts, setCounts] = useState<AppSelectionCounts | null>(null);
  const [loaded, setLoaded] = useState(false);

  // 화면 재진입마다 최신 개수 반영(피커 닫고 돌아올 수 있으므로).
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      ScreenTimeModule.getAllowedSelectionCounts()
        .then((c) => {
          if (cancelled) return;
          setCounts(c);
          setLoaded(true);
        })
        .catch(() => {
          if (cancelled) return;
          setCounts(null);
          setLoaded(true);
        });
      return () => {
        cancelled = true;
      };
    }, []),
  );

  const apps = counts?.applications ?? 0;

  // 요약 문구 — 로딩 전/허용앱 있음/없음.
  const summaryLabel = !loaded
    ? '허용 앱 불러오는 중'
    : apps > 0
      ? `앱 ${apps}개 허용 중`
      : '허용앱 없음';
  const summarySub = !loaded
    ? undefined
    : apps > 0
      ? '집중 중에도 이 앱들은 쓸 수 있어요'
      : '집중 중 모든 앱이 잠겨요';

  // 집중 중 허용앱 선택 — 세션 실드에서 예외로 열어줄 앱들.
  // (MenuScreen의 옛 editAllowedApps 로직을 그대로 이식)
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
      const before = counts; // 편집 전 선택 스냅샷 — 변경 여부 판정용
      const result = await ScreenTimeModule.presentAllowedAppManager();
      if (!result) return; // 취소
      setCounts(result);
      setLoaded(true);
      // 변경 없이 '완료'하면 알럿 생략 (GROMO-637).
      // presentAllowedAppManager는 스와이프 취소가 불가해 완료 시 항상 현재 개수를 반환하므로,
      // 편집 전 스냅샷과 앱/카테고리/웹도메인 개수가 모두 같으면 실제 변경이 없는 것으로 본다.
      if (
        before != null &&
        before.applications === result.applications &&
        before.categories === result.categories &&
        before.webDomains === result.webDomains
      ) {
        return;
      }
      Alert.alert('허용앱 변경됨', `집중 중에도 앱 ${result.applications}개를 쓸 수 있어요.`);
    } catch (e) {
      Alert.alert('설정 실패', e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <SettingsScaffold
      title="집중 중 허용 앱"
      onBack={() => navigation.goBack()}
      footer={
        <TouchableOpacity
          style={s.doneBtn}
          activeOpacity={0.85}
          onPress={() => navigation.goBack()}
        >
          <Text style={s.doneBtnText}>완료</Text>
        </TouchableOpacity>
      }
    >
      {/* 안내 카드 — 허용앱의 의미 + 카테고리 처리(하위 앱으로 확장) */}
      <View style={s.note}>
        <View style={s.noteDot} />
        <Text style={s.noteText}>
          집중 중에도 이 앱들은 쓸 수 있어요. 카테고리를 고르면 그 안의 앱들도 함께 허용돼요(지금
          설치된 앱 기준).
        </Text>
      </View>

      {/* 현재 허용 개수 요약 (개별 앱 리스트는 토큰 opaque라 네이티브 필요 — 개수만 표시) */}
      <SettingsSection title="현재 허용 앱">
        <SettingsRow
          icon="lock-open-outline"
          iconColor={T.greenDeep}
          iconBg={T.greenBg}
          label={summaryLabel}
          sub={summarySub}
        />
      </SettingsSection>

      {/* 허용 앱 고르기 — 네이티브 관리 화면(목록 + 추가/삭제 피커) 표시 */}
      <TouchableOpacity style={s.pickBtn} activeOpacity={0.85} onPress={editAllowedApps}>
        <Ionicons name="add-circle-outline" size={20} color={T.accentDeep} />
        <Text style={s.pickBtnText}>허용 앱 고르기</Text>
      </TouchableOpacity>
    </SettingsScaffold>
  );
}

const s = StyleSheet.create({
  // 안내 카드
  note: {
    flexDirection: 'row',
    gap: T.space.md,
    alignItems: 'flex-start',
    backgroundColor: T.noteBg,
    borderWidth: 1,
    borderColor: T.noteBorder,
    borderRadius: 14,
    padding: T.space.lg,
  },
  noteDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: T.accent,
    marginTop: T.space.sm,
  },
  noteText: { ...T.text.caption, fontWeight: '500', color: T.inkSub, flex: 1, lineHeight: 19 },

  // 허용 앱 고르기 버튼(아웃라인 틴트)
  pickBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: T.space.sm,
    height: 54,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: T.accent,
    backgroundColor: T.accentBg,
    marginTop: T.space.xl,
  },
  pickBtnText: { ...T.text.label, color: T.accentDeep },

  // 하단 완료 CTA(필드)
  doneBtn: {
    height: 56,
    borderRadius: 18,
    backgroundColor: T.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  doneBtnText: { ...T.text.subtitle, color: T.white },
});
