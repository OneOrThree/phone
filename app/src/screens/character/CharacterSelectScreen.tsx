import { useCallback } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import SettingsScaffold from '@/screens/settings/components/SettingsScaffold';
import { CharacterImage } from '@/components/character/CharacterImage';
import { PressableScale } from '@/components/PressableScale';
import { useCharacter } from '@/store/CharacterContext';
import type { V2RootStackParamList } from '@/navigation/types';
import { T } from '@/constants/theme';

// 캐릭터 고르기 화면 — 기본 그로몬 / 내가 만든 오브젝트 캐릭터(누끼) 중 하나를 장착한다.
// 카드 탭이 곧 장착(setChoice)이고, 장착된 카드에는 강조 테두리 + 체크 배지가 붙는다.
// 내 캐릭터(누끼)가 아직 없으면 카드②는 만들기 플레이스홀더로 뜨고, 탭하면 생성 화면으로 간다.
// 하단 버튼으로 언제든 새로/다시 만들 수 있다.

const CHAR_SIZE = 116;

export default function CharacterSelectScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<V2RootStackParamList>>();
  const { choice, customUri, setChoice } = useCharacter();

  const goCreate = useCallback(() => navigation.navigate('CharacterCreate'), [navigation]);

  const defaultSelected = choice === 'default';
  // 내 캐릭터는 누끼가 있을 때만 장착 상태가 될 수 있다.
  const customSelected = choice === 'custom' && customUri != null;

  return (
    <SettingsScaffold
      title="캐릭터 고르기"
      onBack={() => navigation.goBack()}
      footer={
        <PressableScale style={s.footerBtn} scaleTo={0.97} onPress={goCreate}>
          <Ionicons name="add" size={18} color={T.accent} />
          <Text style={s.footerBtnText}>{customUri ? '다시 만들기' : '새로 만들기'}</Text>
        </PressableScale>
      }
    >
      <Text style={s.hint}>홈과 축하 화면에 나올 캐릭터를 골라요.</Text>
      <View style={s.row}>
        {/* 카드① 기본 그로몬 */}
        <PressableScale
          style={[s.card, defaultSelected && s.cardSelected]}
          scaleTo={0.97}
          onPress={() => setChoice('default')}
        >
          {defaultSelected ? (
            <View style={s.checkBadge}>
              <Ionicons name="checkmark-circle" size={24} color={T.accent} />
            </View>
          ) : null}
          <View style={s.charBox}>
            <CharacterImage size={CHAR_SIZE} />
          </View>
          <Text style={s.cardLabel}>기본 그로몬</Text>
        </PressableScale>

        {/* 카드② 내 캐릭터 — 누끼 있으면 장착 카드, 없으면 만들기 플레이스홀더 */}
        {customUri ? (
          <PressableScale
            style={[s.card, customSelected && s.cardSelected]}
            scaleTo={0.97}
            onPress={() => setChoice('custom')}
          >
            {customSelected ? (
              <View style={s.checkBadge}>
                <Ionicons name="checkmark-circle" size={24} color={T.accent} />
              </View>
            ) : null}
            <View style={s.charBox}>
              <CharacterImage size={CHAR_SIZE} sourceUri={customUri} />
            </View>
            <Text style={s.cardLabel}>내 캐릭터</Text>
          </PressableScale>
        ) : (
          <PressableScale style={[s.card, s.cardEmpty]} scaleTo={0.97} onPress={goCreate}>
            <View style={s.charBox}>
              <Ionicons name="add-circle-outline" size={40} color={T.inkMuted} />
              <Text style={s.emptyText}>아직 없어요</Text>
            </View>
            <Text style={s.cardLabel}>만들기</Text>
          </PressableScale>
        )}
      </View>
    </SettingsScaffold>
  );
}

const s = StyleSheet.create({
  hint: { ...T.text.label, fontWeight: '500', color: T.inkSub, marginBottom: T.space.lg },
  row: { flexDirection: 'row', gap: T.space.md },
  card: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: T.white,
    borderWidth: 1.5,
    borderColor: T.border,
    borderRadius: 20,
    paddingVertical: T.space.xl,
    paddingHorizontal: T.space.md,
    gap: T.space.md,
  },
  // 장착된 카드 — 강조 테두리 + 인디고 틴트 배경
  cardSelected: { borderColor: T.accent, backgroundColor: T.accentBg },
  // 만들기 플레이스홀더 — 점선 테두리 + 보조 표면
  cardEmpty: { borderStyle: 'dashed', borderColor: T.borderDark, backgroundColor: T.paperAlt },
  charBox: { height: CHAR_SIZE, alignItems: 'center', justifyContent: 'center', gap: T.space.xs },
  cardLabel: { ...T.text.label, color: T.ink },
  emptyText: { ...T.text.caption, color: T.inkMuted },
  checkBadge: { position: 'absolute', top: T.space.sm, right: T.space.sm, zIndex: 1 },
  footerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: T.space.sm,
    height: 54,
    borderRadius: 16,
    backgroundColor: T.paper,
    borderWidth: 1,
    borderColor: T.accent,
  },
  footerBtnText: { ...T.text.subtitle, color: T.accent },
});
