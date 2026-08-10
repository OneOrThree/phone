import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
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
  readGroupCardEmoji,
  preservePendingGroupCardEmoji,
  writeGroupCardEmoji,
  type GroupCardEmoji,
} from './groupCardEmojiStore';

type Route = RouteProp<V2RootStackParamList, 'GroupCardEmojiEdit'>;

/** 서버 그룹 프로필과 독립된 현재 계정·기기의 카드 표현 설정 편집 화면. */
export default function GroupCardEmojiEditScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NativeStackNavigationProp<V2RootStackParamList>>();
  const { groupId } = useRoute<Route>().params;
  const { userId } = useUser();
  const [baseline, setBaseline] = useState<GroupCardEmoji | null>(null);
  const [selected, setSelected] = useState<GroupCardEmoji | null>(null);
  const [loadedIdentity, setLoadedIdentity] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const requestRef = useRef(0);
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
    readGroupCardEmoji(userId, groupId).then((emoji) => {
      if (request !== requests.current || identityRef.current !== requestedIdentity) return;
      setBaseline(emoji);
      setSelected(emoji);
      setLoadedIdentity(requestedIdentity);
      setSaveFailed(false);
    });
    return () => {
      requests.current++;
    };
  }, [groupId, identity, userId]);

  const ready = loadedIdentity === identity && selected !== null && baseline !== null;
  const changed = ready && selected !== baseline;

  const save = useCallback(async () => {
    if (!userId || !selected || !changed || saving || !ready) return;
    const saveIdentity = identity;
    setSaving(true);
    setSaveFailed(false);
    try {
      await writeGroupCardEmoji(userId, groupId, selected);
      clearPendingGroupCardEmoji(userId, groupId);
      if (!activeRef.current || identityRef.current !== saveIdentity) return;
      logGroupCardIconSaveResult({ surface: 'settings', result: 'success' });
      setBaseline(selected);
      navigation.goBack();
    } catch {
      preservePendingGroupCardEmoji(userId, groupId, selected);
      if (!activeRef.current || identityRef.current !== saveIdentity) return;
      logGroupCardIconSaveResult({ surface: 'settings', result: 'failed' });
      // 선택은 롤백하지 않는다. 사용자가 같은 버튼으로 최신 선택을 다시 저장할 수 있다.
      setSaveFailed(true);
    } finally {
      if (activeRef.current && identityRef.current === saveIdentity) setSaving(false);
    }
  }, [changed, groupId, identity, navigation, ready, saving, selected, userId]);

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

      <View style={[s.body, { paddingBottom: insets.bottom + T.space.xxl }]}>
        {!ready ? (
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
            <GroupCardEmojiPicker value={selected} onChange={setSelected} disabled={saving} />
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
      </View>
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
  body: { flex: 1, paddingHorizontal: T.space.xl, paddingTop: T.space.xl },
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
