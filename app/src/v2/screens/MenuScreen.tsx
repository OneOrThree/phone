import { View, Text, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { triggerLogout } from '@/services/api';
import { T } from '@/v2/constants/theme';

// v2 전체 탭 — 지금은 로그아웃 버튼 하나만. (정식 메뉴/설정은 추후)
// TODO: 프로필·설정·고객센터 등 메뉴 항목 추가.
export default function MenuScreen() {
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
        <TouchableOpacity style={s.logoutBtn} onPress={onLogout} activeOpacity={0.8}>
          <Ionicons name="log-out-outline" size={20} color={T.accentAlt} />
          <Text style={s.logoutText}>로그아웃</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: T.paperLight },
  header: { paddingHorizontal: 20, paddingTop: 6, paddingBottom: 8 },
  headerTitle: { ...T.text.title, color: T.ink },
  body: { paddingHorizontal: 18, paddingTop: 8 },
  logoutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: T.white,
    borderWidth: 1,
    borderColor: T.paperAlt,
    borderRadius: 16,
    paddingHorizontal: 18,
    paddingVertical: 18,
  },
  logoutText: { ...T.text.label, color: T.accentAlt },
});
