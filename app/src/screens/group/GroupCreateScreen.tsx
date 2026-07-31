import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { T } from '@/constants/theme';
import type { V2RootStackParamList } from '@/navigation/types';

// 그룹 생성 화면 (root stack 'GroupCreate') — 명세 docs/app/group-plan.md §6-2.
// ⚠️ 스켈레톤: 헤더/네비게이션만 배선돼 있고 폼은 후속 워커(APP-3)가 채운다.
//
// 구현 가이드(§6-2):
//  · 폼 필드 4개 — 이름(TextInput, 필수 ≤50자) / 정원(스텝퍼 2~10, 기본 5) /
//    하루 목표 집중 시간(칩 30·60·120·180분, 기본 60) / 공개 설정(세그먼트 공개·비공개, 기본 공개)
//  · 공개 설정은 단순 옵션이 아니라 참여 경로를 가르는 스위치 — 캡션을 함께 노출한다
//    공개: "누구나 그룹 이름을 검색해 들어올 수 있어요"
//    비공개: "검색에 뜨지 않아요. 초대 링크를 받은 사람만 들어올 수 있어요"
//  · 전송 body(@/services/groupApi createGroup):
//      { name, maxMembers, missionType: 'DURATION', missionCategory: 'FOCUS', durationMinutes, isPrivate }
//    missionType·missionCategory는 서버 @NotNull이라 반드시 보낸다(§3-1-2).
//    ❌ password·description은 절대 보내지 않는다 — 보내는 순간 아무도 못 들어오는 그룹이 된다(§3-1-3).
//  · 진입 시 logGroupCreateStarted() (@/services/analyticsEvents)
//  · 성공 후: 비공개면 초대 링크 다이얼로그(buildInviteLink + Share/클립보드) → 확인 → goBack().
//    공개면 바로 goBack(). 탭(GroupScreen)이 useFocusEffect로 재조회해 그룹방으로 전환된다.
//  · 에러: 400 검증 → 필드 하이라이트 / GUEST_FORBIDDEN → 로그인 유도 / 그 외 공통 문구
//    (분기는 groupErrorCode(e) 사용 — §3-2)

export default function GroupCreateScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<V2RootStackParamList>>();

  return (
    <SafeAreaView style={s.root} edges={['top']}>
      {/* 헤더 — 원형 백버튼 + 좌측 정렬 제목(FriendAddScreen 관행, §5-1) */}
      <View style={s.header}>
        <TouchableOpacity style={s.backBtn} onPress={() => navigation.goBack()} activeOpacity={0.7}>
          <Ionicons name="chevron-back" size={18} color={T.inkSub} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>그룹 만들기</Text>
      </View>

      {/* TODO(APP-3, §6-2): 아래 자리에 폼 4필드 + '만들기' CTA를 구현한다. */}
      <View style={s.body}>
        <Text style={s.placeholder}>그룹 생성 폼은 준비 중이에요</Text>
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
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: T.space.xxl },
  placeholder: { ...T.text.body, color: T.inkMuted, textAlign: 'center' },
});
