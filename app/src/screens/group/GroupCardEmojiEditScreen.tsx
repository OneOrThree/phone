import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { T } from '@/constants/theme';
import type { V2RootStackParamList } from '@/navigation/types';
import { useUser } from '@/store/UserContext';
import { GroupCardEmojiPicker } from './components/GroupCardEmojiPicker';
import {
  readGroupCardEmoji,
  writeGroupCardEmoji,
  type GroupCardEmoji,
} from './groupCardEmojiStore';
import {
  logGroupCardIconEditorViewed,
  logGroupCardIconSaveResult,
} from '@/services/analyticsEvents';

type Route = RouteProp<V2RootStackParamList, 'GroupCardEmojiEdit'>;

/** 서버 그룹 프로필과 독립된 현재 계정·기기의 카드 표현 설정 편집 화면. */
export default function GroupCardEmojiEditScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NativeStackNavigationProp<V2RootStackParamList>>();
  const { groupId } = useRoute<Route>().params;
  const { userId } = useUser();
  const [baseline, setBaseline] = useState<GroupCardEmoji | null>(null);
  const [selected, setSelected] = useState<GroupCardEmoji | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const savingRef = useRef(false);
  const viewedRef = useRef(false);

  useEffect(
    () =>
      navigation.addListener('beforeRemove', (event) => {
        if (savingRef.current) event.preventDefault();
      }),
    [navigation],
  );

  useEffect(() => {
    let canceled = false;
    readGroupCardEmoji(userId, groupId).then((emoji) => {
      if (canceled) return;
      setBaseline(emoji);
      setSelected(emoji);
      setSaveFailed(false);
      if (!viewedRef.current) {
        viewedRef.current = true;
        logGroupCardIconEditorViewed();
      }
    });
    return () => {
      canceled = true;
    };
  }, [groupId, userId]);

  const changed = selected !== null && baseline !== null && selected !== baseline;

  const save = useCallback(async () => {
    if (!userId || !selected || !changed || saving) return;
    savingRef.current = true;
    setSaving(true);
    setSaveFailed(false);
    try {
      await writeGroupCardEmoji(userId, groupId, selected);
      logGroupCardIconSaveResult({ surface: 'settings', result: 'success' });
      setBaseline(selected);
      savingRef.current = false;
      navigation.goBack();
    } catch {
      logGroupCardIconSaveResult({ surface: 'settings', result: 'failed' });
      // 선택은 롤백하지 않는다. 사용자가 같은 버튼으로 최신 선택을 다시 저장할 수 있다.
      setSaveFailed(true);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }, [changed, groupId, navigation, saving, selected, userId]);

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
        {selected === null ? (
          <ActivityIndicator color={T.accent} />
        ) : (
          <>
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
              testID="group.cardEmoji.save"
            >
              {saving ? (
                <ActivityIndicator color={T.white} />
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
  saveText: { ...T.text.subtitle, color: T.white },
});
