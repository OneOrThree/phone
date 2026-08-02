import { useCallback, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import SettingsScaffold from '@/screens/settings/components/SettingsScaffold';
import { CharacterImage } from '@/components/character/CharacterImage';
import { PressableScale } from '@/components/PressableScale';
import { useCharacter, type CharacterChoice } from '@/store/CharacterContext';
import type { V2RootStackParamList } from '@/navigation/types';
import { T } from '@/constants/theme';

// 캐릭터 고르기 화면 — 기본 그로몬 / 내가 만든 오브젝트 캐릭터(누끼) 중 하나를 장착한다.
// 카드 탭은 선택 표시만 바꾸고(강조 테두리 + 체크 배지), 실제 장착(setChoice)은 하단
// '장착하기' 버튼으로 확정한다. 확정하면 완료를 알린 뒤 홈으로 돌아간다.
// 내 캐릭터(누끼)가 아직 없으면 카드②는 만들기 플레이스홀더로 뜨고, 탭하면 생성 화면으로 간다.
// 하단 버튼으로 언제든 새로/다시 만들 수 있다.

const CHAR_SIZE = 116;

export default function CharacterSelectScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<V2RootStackParamList>>();
  const { choice, customUri, setChoice } = useCharacter();

  // 화면 안에서만 쓰는 선택 상태 — 진입 시엔 지금 장착된 캐릭터를 고른 것으로 시작한다.
  // 'custom'인데 누끼가 사라진 비정상 상태는 기본 그로몬으로 잡아, 아무것도 안 골라진
  // 상태가 생기지 않게 한다(그래서 '장착하기'는 항상 누를 수 있다).
  const [selected, setSelected] = useState<CharacterChoice>(
    choice === 'custom' && customUri != null ? 'custom' : 'default',
  );

  const goCreate = useCallback(() => navigation.navigate('CharacterCreate'), [navigation]);

  // 장착 확정 — 고른 캐릭터를 실제로 장착하고, 알림을 닫으면 홈으로 돌아간다.
  // 이 화면은 홈 '캐릭터 바꾸기'로만 들어오므로 popToTop이 곧 홈 복귀다(중간에 '만들기'로
  // 다녀온 스택이 남아 있어도 한 번에 걷어낸다).
  const equip = useCallback(() => {
    setChoice(selected);
    Alert.alert('장착되었습니다!', '홈에서 바로 확인할 수 있어요.', [
      { text: '확인', onPress: () => navigation.popToTop() },
    ]);
  }, [selected, setChoice, navigation]);

  const defaultSelected = selected === 'default';
  const customSelected = selected === 'custom';

  return (
    <SettingsScaffold
      title="캐릭터 고르기"
      onBack={() => navigation.goBack()}
      footer={
        <View style={s.footerCol}>
          <PressableScale style={s.equipBtn} scaleTo={0.97} haptic="light" onPress={equip}>
            <Ionicons name="checkmark" size={18} color={T.white} />
            <Text style={s.equipBtnText}>장착하기</Text>
          </PressableScale>
          <PressableScale style={s.footerBtn} scaleTo={0.97} onPress={goCreate}>
            <Ionicons name="add" size={18} color={T.accent} />
            <Text style={s.footerBtnText}>{customUri ? '다시 만들기' : '새로 만들기'}</Text>
          </PressableScale>
        </View>
      }
    >
      <Text style={s.hint}>홈과 축하 화면에 나올 캐릭터를 골라요.</Text>
      <View style={s.row}>
        {/* 카드① 기본 그로몬 */}
        <PressableScale
          style={[s.card, defaultSelected && s.cardSelected]}
          scaleTo={0.97}
          onPress={() => setSelected('default')}
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

        {/* 카드② 내 캐릭터 — 누끼 있으면 선택 카드, 없으면 만들기 플레이스홀더 */}
        {customUri ? (
          <PressableScale
            style={[s.card, customSelected && s.cardSelected]}
            scaleTo={0.97}
            onPress={() => setSelected('custom')}
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
  // 선택된 카드 — 강조 테두리 + 인디고 틴트 배경
  cardSelected: { borderColor: T.accent, backgroundColor: T.accentBg },
  // 만들기 플레이스홀더 — 점선 테두리 + 보조 표면
  cardEmpty: { borderStyle: 'dashed', borderColor: T.borderDark, backgroundColor: T.paperAlt },
  charBox: { height: CHAR_SIZE, alignItems: 'center', justifyContent: 'center', gap: T.space.xs },
  cardLabel: { ...T.text.label, color: T.ink },
  emptyText: { ...T.text.caption, color: T.inkMuted },
  checkBadge: { position: 'absolute', top: T.space.sm, right: T.space.sm, zIndex: 1 },
  // 하단 2버튼 — 장착 확정(주) 위, 만들기(보조) 아래
  footerCol: { gap: T.space.md },
  equipBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: T.space.sm,
    height: 54,
    borderRadius: 16,
    backgroundColor: T.accent,
  },
  equipBtnText: { ...T.text.subtitle, color: T.white },
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
