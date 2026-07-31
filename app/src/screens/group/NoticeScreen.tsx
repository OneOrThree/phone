import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { T } from '@/constants/theme';
import type { V2RootStackParamList } from '@/navigation/types';

// 공지 화면 (root stack 'GroupNotice') — 명세 docs/app/group-plan.md §6-5.
// ⚠️ 스켈레톤: 헤더/라우트 파라미터만 배선돼 있고 목록·CRUD는 후속 워커(APP-6)가 채운다.
//
// 베이스: src/legacy/screens/group/NoticeTab.tsx(398줄)를 **복사해 legacy 밖에서 현행화**한다.
//   legacyTheme → T / 직접 api.get → @/services/groupApi / 로컬 interface → @/types/dto/group.
//   ❌ @/legacy import 금지(app/.claude/CLAUDE.md).
//
// 구현 가이드(§6-5):
//  · 목록: getAnnouncements(groupId). 서버가 createdAt DESC로 내려주므로 **앱에서 재정렬 금지**.
//  · 카드: title(T.text.subtitle) / content(T.text.body, 3줄 말줄임) / createdAt(T.text.caption)
//  · 작성: FAB '+' → NoticeComposeSheet → createAnnouncement → 재조회
//  · 수정: 카드 롱프레스 → 액션시트 '수정' → 같은 시트를 editing과 함께 오픈 → updateAnnouncement
//  · 삭제: 롱프레스 → '삭제' → 확인 Alert → deleteAnnouncement
//  · 작성/수정/삭제 진입점은 route.params.canWrite === false면 **렌더하지 않는다**(403 예방)
//  · 진입 시 logGroupTabViewed({ tab: 'notice' })

type NoticeRoute = RouteProp<V2RootStackParamList, 'GroupNotice'>;

export default function NoticeScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<V2RootStackParamList>>();
  const { groupId, canWrite } = useRoute<NoticeRoute>().params;

  return (
    <SafeAreaView style={s.root} edges={['top']}>
      {/* 헤더 — 원형 백버튼 + 좌측 정렬 제목(§5-1) */}
      <View style={s.header}>
        <TouchableOpacity style={s.backBtn} onPress={() => navigation.goBack()} activeOpacity={0.7}>
          <Ionicons name="chevron-back" size={18} color={T.inkSub} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>공지</Text>
      </View>

      {/* TODO(APP-6, §6-5): groupId로 공지 목록 조회 + canWrite일 때만 작성 FAB 렌더 */}
      <View style={s.body}>
        <Text style={s.placeholder}>공지 화면은 준비 중이에요</Text>
        <Text style={s.debug}>
          {groupId} · {canWrite ? '작성 가능' : '읽기 전용'}
        </Text>
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: T.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: T.space.md,
    paddingHorizontal: T.space.xl,
    paddingTop: T.space.sm,
    paddingBottom: T.space.md,
  },
  backBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: T.white,
    borderWidth: 1,
    borderColor: T.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: { ...T.text.heading, fontWeight: '800', color: T.ink },
  body: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: T.space.xs,
    paddingHorizontal: T.space.xxl,
  },
  placeholder: { ...T.text.body, color: T.inkMuted, textAlign: 'center' },
  debug: { ...T.text.caption, color: T.inkFaint, textAlign: 'center' },
});
