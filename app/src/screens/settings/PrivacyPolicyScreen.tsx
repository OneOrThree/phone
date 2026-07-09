import { View, Text, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import SettingsScaffold from '@/screens/settings/components/SettingsScaffold';
import type { V2RootStackParamList } from '@/navigation/types';
import { T } from '@/constants/theme';

// 개인정보 처리방침 화면 — 아직 공개된 정책 URL이 없어 placeholder만 노출한다.
// URL 확정 시 Linking.openURL(policyUrl) 로 외부 브라우저를 열거나
// react-native WebView 로 인앱 표시하도록 이 화면 본문을 교체하면 된다.
export default function PrivacyPolicyScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<V2RootStackParamList>>();

  return (
    <SettingsScaffold title="개인정보 처리방침" onBack={() => navigation.goBack()} scroll={false}>
      <View style={s.center}>
        <View style={s.iconWrap}>
          <Ionicons name="document-text-outline" size={30} color={T.inkSub} />
        </View>
        <Text style={s.message}>
          개인정보 처리방침을 준비 중이에요.{'\n'}
          공개되면 여기에서 바로 확인할 수 있어요.
        </Text>
      </View>
    </SettingsScaffold>
  );
}

const s = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
  },
  iconWrap: {
    width: 64,
    height: 64,
    borderRadius: 20,
    backgroundColor: T.sandLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  message: {
    ...T.text.body,
    color: T.inkSub,
    textAlign: 'center',
  },
});
