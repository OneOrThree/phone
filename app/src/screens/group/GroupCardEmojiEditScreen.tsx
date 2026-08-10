import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { T } from '@/constants/theme';
import type { V2RootStackParamList } from '@/navigation/types';
import { useUser } from '@/store/UserContext';
import {
  logGroupCardIconEditorViewed,
  logGroupCardIconSaveResult,
} from '@/services/analyticsEvents';
import { GroupCardEmojiPicker } from './components/GroupCardEmojiPicker';
import {
  clearPendingGroupCardEmoji,
  groupCardEmojiLabel,
  readGroupCardEmojiResult,
  preservePendingGroupCardEmoji,
  updatePendingGroupCardEmojiSelection,
  writeGroupCardEmoji,
  type GroupCardEmoji,
} from './groupCardEmojiStore';

type Route = RouteProp<V2RootStackParamList, 'GroupCardEmojiEdit'>;

export function ownsGroupCardIconSaveResult(
  session: { userId: string | null; active: boolean },
  userId: string,
): boolean {
  return session.active && session.userId === userId;
}

/** 서버 그룹 프로필과 독립된 현재 계정·기기의 카드 표현 설정 편집 화면. */
export default function GroupCardEmojiEditScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NativeStackNavigationProp<V2RootStackParamList>>();
  const { groupId } = useRoute<Route>().params;
  const { userId, sessionIdentityRef } = useUser();
  const [baseline, setBaseline] = useState<GroupCardEmoji | null>(null);
  const [selected, setSelected] = useState<GroupCardEmoji | null>(null);
  const [loadedIdentity, setLoadedIdentity] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const [hasPendingSelection, setHasPendingSelection] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const requestRef = useRef(0);
  const changeRetryRef = useRef(0);
  const activeRef = useRef(true);
  const identity = `${userId ?? 'anonymous'}:${groupId}`;
  const identityRef = useRef(identity);
  identityRef.current = identity;

  useEffect(() => {
    activeRef.current = true;
    return () => {
      activeRef.current = false;
    };
  }, []);

  useEffect(() => {
    logGroupCardIconEditorViewed();
  }, [identity]);

  useEffect(() => {
    const requests = requestRef;
    const request = ++requests.current;
    const requestedIdentity = identity;
    setLoadFailed(false);
    readGroupCardEmojiResult(userId, groupId).then((result) => {
      if (request !== requests.current || identityRef.current !== requestedIdentity) return;
      if (result.status === 'error') {
        setBaseline(null);
        setSelected(null);
        setLoadedIdentity(requestedIdentity);
        setLoadFailed(true);
        return;
      }
      const emoji = result.emoji;
      setBaseline(result.storedEmoji);
      setSelected(emoji);
      setHasPendingSelection(emoji !== result.storedEmoji);
      setLoadedIdentity(requestedIdentity);
      setSaveFailed(false);
    });
    return () => {
      requests.current++;
    };
  }, [groupId, identity, loadAttempt, userId]);

  const ready = loadedIdentity === identity && selected !== null && baseline !== null;
  const changed = ready && selected !== baseline;

  const save = useCallback(async () => {
    if (!userId || !selected || !changed || saving || !ready) return;
    const saveIdentity = identity;
    const saveSessionIdentity = sessionIdentityRef.current;
    changeRetryRef.current++;
    setSaving(true);
    setSaveFailed(false);
    // 네이티브 뒤로가기·스와이프로 화면이 먼저 닫혀도 현재 실행의 카드는 수락한 선택을 즉시 쓴다.
    // 성공하면 아래에서 pending을 지우고, 실패하면 다음 그룹 화면 활성화에서 재시도한다.
    preservePendingGroupCardEmoji(userId, groupId, selected);
    setHasPendingSelection(true);
    try {
      await writeGroupCardEmoji(userId, groupId, selected);
      clearPendingGroupCardEmoji(userId, groupId);
      if (activeRef.current && identityRef.current === saveIdentity) {
        setHasPendingSelection(false);
      }
      if (
        identityRef.current !== saveIdentity ||
        !ownsGroupCardIconSaveResult(saveSessionIdentity, userId)
      )
        return;
      logGroupCardIconSaveResult({ surface: 'settings', result: 'success' });
      if (!activeRef.current) return;
      setBaseline(selected);
      navigation.goBack();
    } catch {
      preservePendingGroupCardEmoji(userId, groupId, selected);
      if (
        identityRef.current !== saveIdentity ||
        !ownsGroupCardIconSaveResult(saveSessionIdentity, userId)
      )
        return;
      logGroupCardIconSaveResult({ surface: 'settings', result: 'failed' });
      if (!activeRef.current) return;
      // 선택은 롤백하지 않는다. 사용자가 같은 버튼으로 최신 선택을 다시 저장할 수 있다.
      setSaveFailed(true);
    } finally {
      if (activeRef.current && identityRef.current === saveIdentity) setSaving(false);
    }
  }, [changed, groupId, identity, navigation, ready, saving, selected, sessionIdentityRef, userId]);

  const selectEmoji = useCallback(
    (emoji: GroupCardEmoji) => {
      setSelected(emoji);
      if ((hasPendingSelection || saveFailed) && userId && baseline) {
        updatePendingGroupCardEmojiSelection(userId, groupId, emoji, baseline);
        setHasPendingSelection(emoji !== baseline);
      }
      if (saveFailed && userId && baseline) {
        const retry = ++changeRetryRef.current;
        const retryIdentity = identity;
        const retrySessionIdentity = sessionIdentityRef.current;
        writeGroupCardEmoji(userId, groupId, emoji)
          .then(() => {
            if (retry !== changeRetryRef.current || identityRef.current !== retryIdentity) return;
            clearPendingGroupCardEmoji(userId, groupId, emoji);
            if (ownsGroupCardIconSaveResult(retrySessionIdentity, userId)) {
              logGroupCardIconSaveResult({ surface: 'settings', result: 'success' });
            }
            if (!activeRef.current) return;
            setHasPendingSelection(false);
            setBaseline(emoji);
            setSaveFailed(false);
          })
          .catch(() => {
            if (retry !== changeRetryRef.current || identityRef.current !== retryIdentity) return;
            // 기준값으로 되돌린 선택도 앞선 자동 쓰기 뒤 실패할 수 있으므로 최신 값으로 보존한다.
            preservePendingGroupCardEmoji(userId, groupId, emoji);
            if (ownsGroupCardIconSaveResult(retrySessionIdentity, userId)) {
              logGroupCardIconSaveResult({ surface: 'settings', result: 'failed' });
            }
          });
      }
    },
    [baseline, groupId, hasPendingSelection, identity, saveFailed, sessionIdentityRef, userId],
  );

  return (
    <SafeAreaView style={s.root} edges={['top']} testID="group.cardEmoji.screen">
      <View style={s.header}>
        <TouchableOpacity
          style={s.backBtn}
          onPress={() => navigation.goBack()}
          disabled={saving}
          accessibilityLabel="뒤로"
          activeOpacity={0.7}
        >
          <Ionicons name="chevron-back" size={18} color={T.inkSub} />
        </TouchableOpacity>
        <Text style={s.title}>내 카드 아이콘</Text>
      </View>

      <ScrollView
        style={s.body}
        contentContainerStyle={[s.bodyContent, { paddingBottom: insets.bottom + T.space.xxl }]}
        keyboardShouldPersistTaps="handled"
        testID="group.cardEmoji.content"
      >
        {loadFailed ? (
          <View style={s.loadError}>
            <Text style={s.error} accessibilityRole="alert">
              내 카드 아이콘을 불러오지 못했어요.
            </Text>
            <TouchableOpacity
              style={s.retryButton}
              onPress={() => setLoadAttempt((attempt) => attempt + 1)}
              accessibilityRole="button"
              testID="group.cardEmoji.retry"
            >
              <Text style={s.retryText}>다시 시도</Text>
            </TouchableOpacity>
          </View>
        ) : !ready ? (
          <ActivityIndicator color={T.accent} />
        ) : (
          <>
            <View
              style={s.cardPreview}
              accessible={false}
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              testID="group.cardEmoji.preview"
            >
              <Text style={s.cardPreviewEmoji}>{selected}</Text>
              <Text style={s.cardPreviewLabel}>내 그룹 카드</Text>
              <Text style={s.cardPreviewName}>{groupCardEmojiLabel(selected)}</Text>
            </View>
            <GroupCardEmojiPicker value={selected} onChange={selectEmoji} disabled={saving} />
            {saveFailed && (
              <Text style={s.error} accessibilityLiveRegion="polite">
                내 카드 아이콘을 저장하지 못했어요. 앱을 다시 열면 이전 아이콘으로 돌아갈 수 있어요.
              </Text>
            )}
            <TouchableOpacity
              style={[s.saveButton, (!changed || saving || !userId) && s.saveButtonDisabled]}
              disabled={!changed || saving || !userId}
              onPress={save}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel={saving ? '저장 중…' : '저장'}
              accessibilityState={{ disabled: !changed || saving || !userId, busy: saving }}
              testID="group.cardEmoji.save"
            >
              {saving ? (
                <View style={s.savingContent}>
                  <ActivityIndicator color={T.white} accessible={false} />
                  <Text style={s.saveText}>저장 중…</Text>
                </View>
              ) : (
                <Text style={s.saveText}>저장</Text>
              )}
            </TouchableOpacity>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: T.paperLight },
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
  title: { ...T.text.heading, fontWeight: '800', color: T.ink },
  body: { flex: 1 },
  bodyContent: { flexGrow: 1, paddingHorizontal: T.space.xl, paddingTop: T.space.xl },
  cardPreview: {
    minHeight: 132,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: T.space.xl,
    backgroundColor: T.accent,
  },
  cardPreviewEmoji: { fontSize: 42 },
  cardPreviewLabel: { ...T.text.caption, color: T.white, marginTop: T.space.sm },
  cardPreviewName: { ...T.text.subtitle, color: T.white, marginTop: T.space.xs },
  error: { ...T.text.caption, color: T.dangerInk, marginTop: T.space.lg },
  loadError: { alignItems: 'center', justifyContent: 'center', flex: 1 },
  retryButton: { minHeight: 44, justifyContent: 'center', marginTop: T.space.md },
  retryText: { ...T.text.label, color: T.accent },
  saveButton: {
    height: 52,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: T.accent,
    marginTop: T.space.xxl,
  },
  saveButtonDisabled: { opacity: 0.5 },
  savingContent: { flexDirection: 'row', alignItems: 'center', gap: T.space.sm },
  saveText: { ...T.text.subtitle, color: T.white },
});
