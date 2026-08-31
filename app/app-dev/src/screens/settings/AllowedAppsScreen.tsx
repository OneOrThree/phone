import { useCallback, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import ScreenTimeModule, { type AppSelectionCounts } from '@/services/ScreenTimeModule';
import SettingsScaffold from '@/screens/settings/components/SettingsScaffold';
import {
  SettingsSection,
  SettingsRow,
  SettingsToggleRow,
} from '@/screens/settings/components/SettingsList';
import type { V2RootStackParamList } from '@/navigation/types';
import { useToast } from '@/store/ToastContext';
import { T } from '@/constants/theme';
import { t } from '@/i18n';
import { logAllowedAppsUpdated } from '@/services/analyticsEvents';

// SET·집중 중 허용 앱 관리 화면.
// 집중 세션 실드에서 예외로 열어줄 앱들을 고른다.
//
// ⚠️ iOS FamilyControls 토큰은 opaque라 JS에서 개별 앱 이름/아이콘을 읽을 수 없다.
// 그래서 MVP는 '허용 개수 + 네이티브 피커 버튼'으로만 구성한다.
// (개별 앱 리스트뷰가 필요하면 네이티브 SwiftUI Label(token) 뷰로 후속 구현 — GROMO-571 참고)

export default function AllowedAppsScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<V2RootStackParamList>>();
  const { show } = useToast();

  // 저장된 허용앱 선택 개수. null = 아직 로드 전.
  const [counts, setCounts] = useState<AppSelectionCounts | null>(null);
  const [loaded, setLoaded] = useState(false);
  // 집중 중 사파리·웹 허용 토글 — 허용앱 토큰이 불투명해 "사파리를 허용앱으로 골랐는지"를
  // 식별할 수 없어 별도 스위치로 둔다. 기본 꺼짐 = 집중 중 사파리·웹 차단(GROMO-866).
  const [allowSafariWeb, setAllowSafariWeb] = useState(false);

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
      ScreenTimeModule.getFocusAllowSafariWeb()
        .then((v) => !cancelled && setAllowSafariWeb(v))
        .catch(() => {});
      return () => {
        cancelled = true;
      };
    }, []),
  );

  // 토글 즉시 반영(낙관적) — 네이티브 저장 실패 시 원복. 세션 중이면 실드에도 바로 적용됨.
  async function toggleSafariWeb(v: boolean) {
    setAllowSafariWeb(v);
    try {
      await ScreenTimeModule.setFocusAllowSafariWeb(v);
    } catch (e) {
      setAllowSafariWeb(!v);
      Alert.alert(
        t('settings.allowedApps.saveFailTitle'),
        e instanceof Error ? e.message : String(e),
      );
    }
  }

  const apps = counts?.applications ?? 0;

  // 요약 문구 — 로딩 전/허용앱 있음/없음.
  const summaryLabel = !loaded
    ? t('settings.allowedApps.loading')
    : apps > 0
      ? t('settings.allowedApps.summaryCount', { count: apps })
      : t('settings.allowedApps.summaryNone');
  const summarySub = !loaded
    ? undefined
    : apps > 0
      ? t('settings.allowedApps.summaryCountSub')
      : t('settings.allowedApps.summaryNoneSub');

  // 집중 중 허용앱 선택 — 세션 실드에서 예외로 열어줄 앱들.
  // (MenuScreen의 옛 editAllowedApps 로직을 그대로 이식)
  async function editAllowedApps() {
    try {
      const status = await ScreenTimeModule.getAuthorizationStatus();
      if (status !== 'approved') {
        // 안내만 하고 끝나면 막다른 길(GROMO-860) — 권한 화면으로 이어줘
        // 상태별 처리(요청 필요→권한 요청, 거부됨→iOS 설정 이동)를 그쪽에서 하게 한다.
        Alert.alert(t('settings.allowedApps.permTitle'), t('settings.allowedApps.permBody'), [
          { text: t('common.cancel'), style: 'cancel' },
          {
            text: t('settings.allowedApps.permCta'),
            onPress: () => navigation.navigate('SettingsScreenTimePermission'),
          },
        ]);
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
        (before.selectionSignature && result.selectionSignature
          ? before.selectionSignature === result.selectionSignature
          : before.applications === result.applications &&
            before.categories === result.categories &&
            before.webDomains === result.webDomains)
      ) {
        return;
      }
      logAllowedAppsUpdated({ app_count: result.applications });
      // 성공 통보(선택지 없음) → 토스트. 실패·확인 알럿은 Alert 그대로 둔다(정책 D8).
      // ⚠️ 단, **구 바이너리에서는 Alert를 유지한다.** 그쪽 네이티브는 모달 dismiss 완료를
      //    기다리지 않고 promise를 풀어서, 토스트가 아직 떠 있는 모달 아래에서 등장 연출과
      //    2200ms 타이머를 시작한다 — 모달이 사라진 뒤 갑자기 나타나고 노출도 짧아진다.
      //    이 JS는 hot-updater로 구 바이너리에도 내려가므로 네이티브 수정만으로는 못 막는다
      //    (codex 리뷰). `dismissed`는 새 바이너리만 응답에 담는 표식이다.
      const message = t('settings.allowedApps.savedMessage', { count: result.applications });
      if (result.dismissed) {
        show({ message });
      } else {
        Alert.alert(t('settings.allowedApps.saveDoneTitle'), message);
      }
    } catch (e) {
      Alert.alert(
        t('settings.allowedApps.saveFailTitle'),
        e instanceof Error ? e.message : String(e),
      );
    }
  }

  return (
    <SettingsScaffold
      title={t('settings.allowedApps.title')}
      onBack={() => navigation.goBack()}
      footer={
        <TouchableOpacity
          style={s.doneBtn}
          activeOpacity={0.85}
          onPress={() => navigation.goBack()}
        >
          <Text style={s.doneBtnText}>{t('settings.allowedApps.done')}</Text>
        </TouchableOpacity>
      }
    >
      {/* 안내 카드 — 허용앱의 의미 + 카테고리 처리(하위 앱으로 확장) */}
      <View style={s.note}>
        <View style={s.noteDot} />
        <Text style={s.noteText}>{t('settings.allowedApps.note')}</Text>
      </View>

      {/* 현재 허용 개수 요약 (개별 앱 리스트는 토큰 opaque라 네이티브 필요 — 개수만 표시) */}
      <SettingsSection title={t('settings.allowedApps.currentSection')}>
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
        <Text style={s.pickBtnText}>{t('settings.allowedApps.pick')}</Text>
      </TouchableOpacity>

      {/* Safari·웹 허용 — 허용앱 피커로는 시스템 앱(사파리) 허용 여부를 알 수 없어 별도 토글.
          꺼짐(기본)이면 집중 중 사파리가 잠기고 다른 브라우저·웹뷰의 웹페이지도 차단된다. */}
      <SettingsSection title={t('settings.allowedApps.webSection')}>
        <SettingsToggleRow
          icon="globe-outline"
          iconColor={T.accentDeep}
          iconBg={T.accentBg}
          label={t('settings.allowedApps.safariLabel')}
          sub={t('settings.allowedApps.safariSub')}
          value={allowSafariWeb}
          onValueChange={toggleSafariWeb}
        />
      </SettingsSection>
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
    minHeight: 54,
    paddingVertical: T.space.md,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: T.accent,
    backgroundColor: T.accentBg,
    marginTop: T.space.xl,
  },
  pickBtnText: { ...T.text.label, color: T.accentDeep },

  // 하단 완료 CTA(필드)
  doneBtn: {
    minHeight: 56,
    paddingVertical: T.space.md,
    borderRadius: 18,
    backgroundColor: T.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  doneBtnText: { ...T.text.subtitle, color: T.white },
});
