import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { T } from '@/constants/theme';
import { t } from '@/i18n';
import { useOverlayAlert } from '@/store/useOverlayAlert';
import { getGroupSettings, updateGroupSettings } from '@/services/groupApi';
import { logGroupNoticeGrantChanged } from '@/services/analyticsEvents';
import { useUser } from '@/store/UserContext';
import type { GroupAnnouncementGrantView } from '@/types/dto/group';
import type { V2RootStackParamList } from '@/navigation/types';

// 공지 작성 권한 관리 (root stack 'GroupNoticePermission') — A-4, 방장 전용.
//
//   진입 → getGroupSettings() → 실패 [에러+재시도] / 성공 [멤버별 토글 목록]
//
// ⚠️ 방장 식별: 설정 응답 항목엔 role이 없다. 하지만 이 화면은 방장 전용이라
//    **방장 = 현재 로그인 유저(useUser().userId)**다 — userId === myUserId인 행이 방장이고,
//    그 행 토글은 항상 켜짐 + 비활성(잠금)으로 그린다(서버도 방장 항목을 무시한다).
// · 낙관적 토글: 스위치를 바꾸면 즉시 로컬 반영 → 그 멤버 하나만 담아 PATCH.
//     성공이면 계측, 실패면 이전 값으로 롤백 + 공통 실패 Alert.
// · 저장 중인 행은 재탭 잠금(행별 saving 상태) — 다른 행은 독립적으로 조작 가능하다.

type PermissionRoute = RouteProp<V2RootStackParamList, 'GroupNoticePermission'>;

export default function GroupNoticePermissionScreen() {
  // 네이티브 Alert는 RN Modal **위에** 뜬다 — 떠 있는 동안 결과 모달이 그 아래에서
  // 마운트되면 사용자는 못 봤는데 seen 마커와 ack이 찍힌다. 이 훅이 Alert 수명 동안
  // 조정자 slot을 점유해 그걸 막는다(store/useOverlayAlert 헤더).
  const showAlert = useOverlayAlert('groupNoticePermission.alert');
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NativeStackNavigationProp<V2RootStackParamList>>();
  const { groupId } = useRoute<PermissionRoute>().params;
  // 방장 = 현재 로그인 유저(위 주석). 이 행만 토글을 잠근다.
  const { userId: myUserId } = useUser();

  // null = 아직 한 번도 못 받음(로딩·에러 분기의 기준).
  const [grants, setGrants] = useState<GroupAnnouncementGrantView[] | null>(null);
  const [error, setError] = useState(false);
  // 저장 중인 행(userId 집합) — 그 행 Switch를 재탭 잠금한다. 행별이라 다른 행은 계속 조작 가능.
  const [savingIds, setSavingIds] = useState<Set<string>>(() => new Set<string>());

  // 요청 시퀀스 — '다시 시도' 연타 시 늦게 도착한 이전 응답이 최신을 덮지 않게(NoticeScreen 패턴).
  const requestSeqRef = useRef(0);

  const load = useCallback(async () => {
    const seq = ++requestSeqRef.current;
    setError(false);
    try {
      const res = await getGroupSettings(groupId);
      if (seq !== requestSeqRef.current) return;
      setGrants(res.announcementGrants);
    } catch {
      if (seq !== requestSeqRef.current) return;
      setError(true);
    }
  }, [groupId]);

  // cleanup에서 시퀀스를 올려 진행 중이던 조회를 무효화한다(언마운트 뒤 setState 방지).
  useEffect(() => {
    load();
    return () => {
      // 노드 참조가 아니라 요청 카운터라 cleanup 시점 값을 그대로 올리는 게 맞다(NoticeScreen과 동일).
      // eslint-disable-next-line react-hooks/exhaustive-deps
      requestSeqRef.current++;
    };
  }, [load]);

  // 낙관적 토글 — 즉시 로컬 반영 후 그 멤버 하나만 담아 PATCH(서버는 항목별 upsert). 실패 시 롤백한다.
  const onToggle = useCallback(
    async (userId: string, next: boolean) => {
      // 방장 행은 잠금 — 조작 이벤트가 와도 요청을 내지 않는다(서버도 방장 항목을 무시).
      if (userId === myUserId) return;
      // 저장 중인 행은 재탭 잠금.
      if (savingIds.has(userId)) return;

      // 즉시 로컬 반영(낙관적).
      setGrants((prev) =>
        prev ? prev.map((g) => (g.userId === userId ? { ...g, granted: next } : g)) : prev,
      );
      setSavingIds((prev) => {
        const set = new Set(prev);
        set.add(userId);
        return set;
      });

      try {
        await updateGroupSettings(groupId, { announcementGrants: [{ userId, granted: next }] });
        logGroupNoticeGrantChanged({ group_id: groupId, granted: next });
      } catch {
        // 롤백 — 낙관적으로 바꾼 값을 이전(!next)으로 되돌린다.
        setGrants((prev) =>
          prev ? prev.map((g) => (g.userId === userId ? { ...g, granted: !next } : g)) : prev,
        );
        // ⚠️ `await` 뒤에 여는 Alert다 — 승인을 받고 띄운다.
        await showAlert.afterSlot(
          t('group.noticePermissionScreen.saveFailTitle'),
          t('common.retryLater'),
        );
      } finally {
        setSavingIds((prev) => {
          const set = new Set(prev);
          set.delete(userId);
          return set;
        });
      }
    },
    [groupId, myUserId, savingIds, showAlert],
  );

  // 백버튼은 로딩·에러·목록 모든 분기에 세운다 — 루트 스택은 headerShown:false라 이 화면엔
  // 네이티브 헤더가 없어, 조회 중·실패 시 백버튼이 없으면 돌아갈 명시 경로가 0개가 된다.
  const header = (
    <View style={s.header}>
      <TouchableOpacity
        style={s.backBtn}
        onPress={() => navigation.goBack()}
        activeOpacity={0.7}
        accessibilityLabel={t('common.back')}
      >
        <Ionicons name="chevron-back" size={18} color={T.inkSub} />
      </TouchableOpacity>
      <Text style={s.headerTitle}>{t('group.noticePermissionScreen.title')}</Text>
    </View>
  );

  // ── 최초 로딩 — 중앙 스피너 ──
  if (grants === null && !error) {
    return (
      <SafeAreaView style={s.root} edges={['top']} testID="group.notice.permission.screen">
        {header}
        <View style={s.center}>
          <ActivityIndicator color={T.accent} />
        </View>
      </SafeAreaView>
    );
  }

  // ── 에러 + 다시 시도 ──
  if (grants === null) {
    return (
      <SafeAreaView style={s.root} edges={['top']} testID="group.notice.permission.screen">
        {header}
        <View style={s.center}>
          <Text style={s.emptyTitle}>{t('group.noticePermissionScreen.loadFailed')}</Text>
          <Text style={s.emptyDesc}>{t('common.retryLater')}</Text>
          <TouchableOpacity style={s.retryBtn} activeOpacity={0.85} onPress={() => load()}>
            <Text style={s.retryText}>{t('common.retry')}</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.root} edges={['top']} testID="group.notice.permission.screen">
      {header}
      <ScrollView
        contentContainerStyle={[s.content, { paddingBottom: insets.bottom + T.space.xl }]}
        showsVerticalScrollIndicator={false}
      >
        <Text style={s.guide}>{t('group.noticePermissionScreen.guide')}</Text>

        <View style={s.list}>
          {grants.map((g) => {
            const isOwner = g.userId === myUserId;
            const saving = savingIds.has(g.userId);
            return (
              <View key={g.userId} style={s.row}>
                <View style={s.rowText}>
                  <Text style={s.nickname} numberOfLines={1}>
                    {g.nickname}
                  </Text>
                  {isOwner && (
                    <Text style={s.ownerTag}>{t('group.noticePermissionScreen.ownerTag')}</Text>
                  )}
                </View>
                <Switch
                  testID={`group.notice.toggle.${g.userId}`}
                  // 방장 행은 서버 값과 무관하게 항상 켜짐으로 고정한다.
                  value={isOwner ? true : g.granted}
                  disabled={isOwner || saving}
                  onValueChange={(next) => onToggle(g.userId, next)}
                  trackColor={{ false: T.chipBorder, true: T.accent }}
                  thumbColor={T.white}
                  ios_backgroundColor={T.chipBorder}
                />
              </View>
            );
          })}
        </View>
      </ScrollView>
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

  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: T.space.xxl,
  },
  // 화면 전체를 차지하는 에러 헤드라인은 T.text.title(26/800) — 그룹 화면 공통 위계.
  emptyTitle: { ...T.text.title, color: T.ink, textAlign: 'center' },
  emptyDesc: { ...T.text.body, color: T.inkSub, marginTop: T.space.sm, textAlign: 'center' },
  // 인라인 재시도 = 48 / r16 / px xxl — 그룹 탭·그룹방·공지와 같은 값(§G-4).
  retryBtn: {
    minHeight: 48,
    paddingVertical: T.space.md,
    paddingHorizontal: T.space.xxl,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: T.accent,
    marginTop: T.space.xl,
  },
  retryText: { ...T.text.label, color: T.white },

  content: { paddingHorizontal: T.space.xl, paddingTop: T.space.xs, gap: T.space.md },
  // 상단 안내 — 인디고 틴트 인포 박스(theme noteBg/noteBorder).
  guide: {
    ...T.text.caption,
    fontWeight: '500',
    color: T.inkSub,
    lineHeight: 19,
    backgroundColor: T.noteBg,
    borderWidth: 1,
    borderColor: T.noteBorder,
    borderRadius: 12,
    padding: T.space.md,
  },

  list: { gap: T.space.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: T.space.md,
    backgroundColor: T.white,
    borderWidth: 1,
    borderColor: T.border,
    borderRadius: 16,
    paddingVertical: T.space.md,
    paddingHorizontal: T.space.lg,
  },
  rowText: { flex: 1, gap: 2 },
  nickname: { ...T.text.label, color: T.ink },
  ownerTag: { ...T.text.caption, fontWeight: '500', color: T.accent },
});
