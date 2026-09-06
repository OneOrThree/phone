import { useState } from 'react';
import { Text, TouchableOpacity, StyleSheet } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import SettingsScaffold from '@/screens/settings/components/SettingsScaffold';
import { SettingsSection, SettingsRow } from '@/screens/settings/components/SettingsList';
import { STORAGE_KEYS } from '@/types/storage';
import type { V2RootStackParamList } from '@/navigation/types';
import { T } from '@/constants/theme';
import {
  applyLocalePref,
  getLocale,
  getLocalePref,
  resolveLocale,
  t,
  LOCALE_NAMES,
  SUPPORTED_LOCALES,
  type LocalePref,
} from '@/i18n';
import { navigationRef } from '@/navigation/navigationRef';
import { useToast } from '@/store/ToastContext';
import { logLanguageChanged } from '@/services/analyticsEvents';

// 앱 표시 언어(GROMO-1672) — '기기 언어 따름' + 지원 4개 언어 택1.
//
// 라디오는 고르기만 하고 하단 '저장'을 눌러야 적용된다(OccupationScreen·GoalsScreen과 같은 관례).
// 탭 즉시 적용하지 않는 이유: 적용이 곧 화면 리셋이라 되돌리기가 비싸다 — 잘못 눌러도
// 저장 전이면 아무 일도 일어나지 않는다.
//
// 고른 즉시 반영하는 방식: i18n.locale 을 갈고 navigationRef.reset() 으로 루트 스택을
// 새로 만든다. reset 은 라우터가 각 화면에 **새 key** 를 발급하므로 화면이 리마운트되고,
// t() 가 다시 실행돼 새 언어로 그려진다.
//
// ⚠️ NavigationContainer 자체를 key 로 갈아치우는 방식은 쓰지 않는다 — 그 상자에 붙은
// 외부 구독자(ChallengeResultHost 의 navigationRef.addListener, Datadog RUM 의
// startTrackingViews)가 죽은 상자에 남아 세션 내내 되살아나지 않는다. reset 은 상자를
// 건드리지 않아 그 문제가 없고, onReady 도 재발화하지 않아 app_main_viewed 중복·
// 딥링크 재실행 사고도 생기지 않는다.
//
// ⚠️ 이 화면 진입점을 집중 세션 스택 안에 만들지 말 것 — 아래 reset 이 세션을 죽인다.
// (지금은 '전체' 탭에서만 들어오고, 거기 가려면 세션이 이미 끝나 있다.)

type Option = { pref: LocalePref; label: string };

const OPTIONS: Option[] = [
  { pref: 'system', label: '' }, // 라벨은 번역 키라 렌더 시점에 채운다
  ...SUPPORTED_LOCALES.map((locale) => ({ pref: locale, label: LOCALE_NAMES[locale] })),
];

// 선택 표시 — StatVisibilityScreen 과 같은 모양. 순수 장식이다 — radio 역할·상태는
// SettingsRow(실제 터치 대상)에 건다. 터치 가능한 부모가 자식을 하나의 접근성 요소로
// 묶으므로 여기에 걸면 스크린리더에 전달되지 않는다(코드리뷰).
function RadioMark({ selected }: { selected: boolean }) {
  return (
    <Ionicons
      name={selected ? 'checkmark-circle' : 'ellipse-outline'}
      size={24}
      color={selected ? T.accent : T.inkMuted}
    />
  );
}

export default function LanguageScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<V2RootStackParamList>>();
  const { show } = useToast();

  // 초기값은 **설정값**에서 읽는다(getLocalePref) — 적용 결과(getLocale)로 역추론하면
  // 명시 'ko' + 기기 ko 인 사용자를 'system' 으로 오인해, '기기 언어 따름'으로
  // 되돌아갈 길이 사라진다(선택이 항상 현재값과 같아 저장이 비활성 — 코드리뷰).
  // 부팅 때 App.tsx 의 applyLocalePref 가 저장값을 이미 정규화해 뒀다.
  const initial = getLocalePref();
  // selected = 라디오에서 고른 값(아직 적용 전), applied = 실제 적용돼 있는 값.
  // 둘을 나눠 들고 있어야 '고른 게 현재와 같으면 저장 비활성'을 판단할 수 있다.
  const [selected, setSelected] = useState<LocalePref>(initial);
  const [applied, setApplied] = useState<LocalePref>(initial);
  const [busy, setBusy] = useState(false);

  const handleSave = async () => {
    if (busy || selected === applied) return;
    setBusy(true);

    // ① 저장이 먼저다. 언어는 서버로 안 나가므로 로컬 저장이 유일한 정본 —
    //    저장 실패를 무시하고 화면만 바꾸면 앱 재시작 때 조용히 되돌아가 '설정이 고장났다'가 된다.
    try {
      await AsyncStorage.setItem(STORAGE_KEYS.locale, selected);
    } catch {
      show({ message: t('settings.language.saveFailed'), tone: 'error' });
      setBusy(false);
      return;
    }

    const before = getLocale();
    const after = applyLocalePref(selected);
    logLanguageChanged({ app_language: after, previous_app_language: applied });
    setApplied(selected);

    // 실제 언어가 그대로면(예: 기기가 ko 인데 'system' → 'ko' 를 고름) 리셋할 이유가 없다.
    if (getLocale() === before) {
      setBusy(false);
      return;
    }

    // ② 토스트가 사용자에게 유일한 확인 신호다 — 아래 reset 으로 이 화면이 사라진다.
    //    ToastProvider 는 NavigationContainer 밖(App.tsx)에 있어서 리셋을 견딘다.
    //    문구는 이미 새 언어로 뜬다.
    show({ message: t('settings.language.changed') });
    navigationRef.reset({ index: 0, routes: [{ name: 'Main' }] });
  };

  return (
    <SettingsScaffold
      title={t('settings.language.title')}
      onBack={() => navigation.goBack()}
      footer={
        <TouchableOpacity
          testID="settings.language.save"
          style={[s.saveBtn, selected === applied || busy ? s.saveBtnDisabled : null]}
          activeOpacity={0.85}
          disabled={selected === applied || busy}
          onPress={handleSave}
        >
          <Text style={s.saveText}>{busy ? t('common.saving') : t('common.save')}</Text>
        </TouchableOpacity>
      }
    >
      <Text style={s.note}>{t('settings.language.note')}</Text>

      <SettingsSection>
        {OPTIONS.map((opt) => (
          <SettingsRow
            key={opt.pref}
            testID={`settings.language.option.${opt.pref}`}
            accessibilityRole="radio"
            accessibilityState={{ selected: selected === opt.pref, checked: selected === opt.pref }}
            label={opt.pref === 'system' ? t('settings.language.system') : opt.label}
            sub={
              opt.pref === 'system'
                ? t('settings.language.systemSub', { language: LOCALE_NAMES[resolveLocale()] })
                : undefined
            }
            onPress={() => setSelected(opt.pref)}
            right={<RadioMark selected={selected === opt.pref} />}
          />
        ))}
      </SettingsSection>
    </SettingsScaffold>
  );
}

const s = StyleSheet.create({
  saveBtn: {
    minHeight: 54,
    paddingVertical: T.space.md,
    borderRadius: 16,
    backgroundColor: T.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveBtnDisabled: { opacity: 0.5 },
  saveText: { ...T.text.subtitle, color: T.white },
  note: {
    ...T.text.caption,
    color: T.inkMuted,
    marginTop: T.space.xs,
    marginLeft: T.space.sm,
    lineHeight: 19,
  },
});
