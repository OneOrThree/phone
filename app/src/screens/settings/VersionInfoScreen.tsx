import { View, Text, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Constants from 'expo-constants';
import { Ionicons } from '@expo/vector-icons';
import SettingsScaffold from '@/screens/settings/components/SettingsScaffold';
import { CharacterImage } from '@/components/character/CharacterImage';
import type { V2RootStackParamList } from '@/navigation/types';
import { T } from '@/constants/theme';

// 버전 정보 화면 — 앱 이름·버전·빌드 번호와 최신 상태 안내를 중앙에 보여준다.
// 정적 정보 화면이라 별도 API/상태 없이 expo-constants 값만 읽는다.

// 앱 버전은 expo config에서 읽고, 값이 없으면 대시로 대체.
const APP_VERSION = Constants.expoConfig?.version ?? '—';
// iOS 빌드 번호는 설정돼 있을 때만 표기.
const BUILD_NUMBER = Constants.expoConfig?.ios?.buildNumber;

export default function VersionInfoScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<V2RootStackParamList>>();

  return (
    <SettingsScaffold title="버전 정보" onBack={() => navigation.goBack()}>
      <View style={s.center}>
        {/* 상단 캐릭터 아이콘 */}
        <View style={s.iconWrap}>
          <CharacterImage size={72} />
        </View>

        <Text style={s.appName}>gromo</Text>
        <Text style={s.version}>v{APP_VERSION}</Text>
        {BUILD_NUMBER ? <Text style={s.build}>build {BUILD_NUMBER}</Text> : null}

        {/* 최신 버전 안내 배지 */}
        <View style={s.latestPill}>
          <Ionicons name="checkmark-circle" size={16} color={T.successInk} />
          <Text style={s.latestText}>최신 버전이에요</Text>
        </View>
      </View>
    </SettingsScaffold>
  );
}

const s = StyleSheet.create({
  center: { alignItems: 'center', paddingTop: 48 },
  iconWrap: {
    width: 96,
    height: 96,
    borderRadius: 28,
    backgroundColor: T.sandLight,
    borderWidth: 1,
    borderColor: T.paperAlt,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  appName: { ...T.text.title, color: T.ink, marginTop: 20 },
  version: { ...T.text.body, color: T.inkSub, marginTop: 6 },
  build: { ...T.text.caption, color: T.inkMuted, marginTop: 4 },
  latestPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 20,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 999,
    backgroundColor: T.successBg,
    borderWidth: 1,
    borderColor: T.successBorder,
  },
  latestText: { ...T.text.label, color: T.successInk },
});
