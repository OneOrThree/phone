import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import SettingsScaffold from '@/screens/settings/components/SettingsScaffold';
import { CharacterImage } from '@/components/character/CharacterImage';
import { PressableScale } from '@/components/PressableScale';
import { useCharacter, type CharacterChoice } from '@/store/CharacterContext';
import { useToast } from '@/store/ToastContext';
import type { V2RootStackParamList } from '@/navigation/types';
import { T } from '@/constants/theme';

// 캐릭터 변경 화면 — 기본 그로몬 / 내가 만든 오브젝트 캐릭터(누끼) 중 하나를 장착한다.
// 카드 탭은 선택 표시만 바꾸고(강조 테두리 + 체크 배지), 실제 장착(setChoice)은 하단
// '변경하기' 버튼으로 확정한다. 확정하면 완료를 알린 뒤 홈으로 돌아간다.
// 내 캐릭터(누끼)가 아직 없으면 카드②는 만들기 플레이스홀더로 뜨고, 탭하면 생성 화면으로 간다.
// 하단 버튼으로 언제든 새로/다시 만들 수 있다.

const CHAR_SIZE = 116;

// 지금 장착된 것으로 볼 캐릭터. 'custom'인데 쓸 수 있는 누끼가 없으면(경로가 없거나 그림을 못 그리면)
// 기본 그로몬으로 본다 — 이 값이 곧 사용자가 아무것도 안 고르고 '변경하기'를 눌렀을 때 확정되는 값이라,
// 여기서 막지 않으면 못 쓰는 누끼가 그대로 장착된다.
export function resolveEquippedChoice(
  choice: CharacterChoice,
  customUri: string | null,
  customBroken: boolean,
): CharacterChoice {
  return choice === 'custom' && !!customUri && !customBroken ? 'custom' : 'default';
}

export default function CharacterSelectScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<V2RootStackParamList>>();
  const { choice, customUri, setChoice } = useCharacter();
  const { show } = useToast();

  // 저장된 누끼를 실제로 그릴 수 있는지. 이미지 로드는 비동기라 세 상태가 필요하다.
  //  pending — 아직 로드 결과를 모름 / ok — 그려짐 / broken — 경로가 죽어 못 그림
  // 경로가 죽으면 카드②는 기본 그로몬으로 폴백돼 그려지는데, 그대로 장착까지 되면 홈·집중·축하
  // 화면의 캐릭터가 전부 기본으로 돌아가 "빈 칸을 장착한" 꼴이 된다. 그래서 못 쓰는 누끼는 아예
  // 없는 것으로 본다. 저장소의 customUri 는 지우지 않는다 — 일시적 읽기 실패였을 경우 다음
  // 실행에서 되살아난다.
  // 판정 결과는 '어느 URI 를 검사한 것인지'와 함께 들고 있는다(코드리뷰 반영). 이펙트로 리셋하면
  // 순서에 기대게 되는데, 캐시된 로컬 이미지는 이펙트가 돌기 전에 onLoad 가 먼저 터질 수 있다.
  // 그러면 뒤늦은 리셋이 ok 를 pending 으로 되돌리고, 두 번째 onLoad 는 오지 않아 확정 버튼이
  // 영영 잠긴다. 반대로 이전 URI 의 늦은 이벤트가 새 URI 를 검증된 것으로 만들 수도 있다.
  // URI 를 같이 저장해 두면 지금 보고 있는 URI 의 결과만 유효해져 두 방향 모두 막힌다.
  const [customLoad, setCustomLoad] = useState<{ uri: string; status: 'ok' | 'broken' } | null>(
    null,
  );
  const customStatus: 'pending' | 'ok' | 'broken' =
    customLoad && customLoad.uri === customUri ? customLoad.status : 'pending';

  const hasCustom = !!customUri && customStatus !== 'broken';
  // 선택은 로드가 확인된 뒤에만 허용한다 — onError 는 비동기라, 그 전에 카드를 탭하고 곧바로
  // '변경하기'를 누르면 못 쓰는 누끼가 장착돼 버린다(코드리뷰 반영). 렌더는 pending 에도 그대로
  // 두어 정상 누끼가 잠깐 플레이스홀더로 깜빡이지 않게 한다.
  const canPickCustom = !!customUri && customStatus === 'ok';

  const equipped = resolveEquippedChoice(choice, customUri, customStatus === 'broken');

  // 화면 안에서만 쓰는 선택 상태 — 사용자가 카드를 탭하기 전까지는 null이고, 그동안은 위의
  // 장착값을 그대로 따라간다. useState 초기값으로 스냅샷을 뜨면 CharacterContext가 AsyncStorage를
  // 아직 못 읽은 시점에 마운트됐을 때 'default'로 굳어, 그대로 '변경하기'를 누르면 사용자의
  // 누끼 캐릭터가 조용히 해제된다. 아무것도 안 골라진 상태는 생기지 않으므로 '변경하기'는 항상 활성.
  const [picked, setPicked] = useState<CharacterChoice | null>(null);
  const selected = picked ?? equipped;

  // 누끼가 바뀌면 골라둔 선택을 비운다 — 누끼를 고른 상태로 '다시 만들기'를 다녀오면 picked 는
  // 'custom'인데 새 이미지는 아직 pending 이라, 그 사이 '변경하기'를 누르면 검증되지 않은 교체본이
  // 장착된다. 비우면 selected 가 저장된 장착값으로 되돌아가고, 새 누끼는 로드 확인 뒤 다시 탭해야
  // 골라진다. (판정은 위에서 URI 와 묶여 저절로 pending 이 되므로 여기서 건드리지 않는다.)
  useEffect(() => {
    setPicked(null);
  }, [customUri]);

  const goCreate = useCallback(() => navigation.navigate('CharacterCreate'), [navigation]);

  // 누끼 그림을 못 그렸다 — 카드②를 만들기 플레이스홀더로 되돌리고, 골라둔 상태였으면 기본으로 뺀다.
  // 검사한 URI 를 함께 기록해, 이전 URI 의 늦은 이벤트가 새 교체본을 깨진 것으로 만들지 않게 한다.
  const onCustomBroken = useCallback(() => {
    if (!customUri) return;
    setCustomLoad({ uri: customUri, status: 'broken' });
    setPicked((p) => (p === 'custom' ? 'default' : p));
  }, [customUri]);

  // 그려졌다 — 같은 URI 의 판정이 아직 없을 때만 기록한다. CharacterImage 는 로드 실패 시 기본
  // 에셋으로 폴백하고 그 폴백이 그려질 때도 onLoad 를 주므로, 먼저 온 broken 을 덮지 않게 한다.
  const onCustomLoaded = useCallback(() => {
    if (!customUri) return;
    setCustomLoad((prev) => (prev?.uri === customUri ? prev : { uri: customUri, status: 'ok' }));
  }, [customUri]);

  // 변경 확정 — 고른 캐릭터를 실제로 장착하고 곧바로 홈으로 돌아간다.
  // 이 화면은 홈 '캐릭터 변경'으로만 들어오므로 popToTop이 곧 홈 복귀다(중간에 '만들기'로
  // 다녀온 스택이 남아 있어도 한 번에 걷어낸다).
  // 종전엔 Alert의 '확인' 버튼 onPress에 popToTop이 달려 있었다(GROMO-1381 §6-5). 토스트는
  // 버튼이 없으므로 부작용을 잃지 않게 여기서 직접 부른다 — ToastProvider가 NavigationContainer
  // 바깥이라 배너는 화면 전환을 넘어 그대로 살아남는다.
  const equip = useCallback(() => {
    setChoice(selected);
    show({ message: '캐릭터를 변경했어요', tone: 'success' });
    navigation.popToTop();
  }, [selected, setChoice, navigation, show]);

  const defaultSelected = selected === 'default';
  const customSelected = selected === 'custom';

  // 고른 게 누끼인데 아직 로드 확인 전이면 확정을 잠근다(코드리뷰 반영).
  // picked 를 리셋하는 것만으로는 부족하다 — 저장된 choice 가 이미 'custom'이면 '다시 만들기'로
  // 교체본이 들어와도 selected 는 계속 'custom'이라, onError 가 오기 전에 확정하면 못 쓰는
  // 교체본이 그대로 남는다.
  // 반대로 pending 을 '미장착'으로 처리하면 안 된다 — 그 순간 selected 가 'default'로 바뀌어,
  // 하이드레이션이 늦은 정상 유저가 확정을 누르면 멀쩡한 누끼가 조용히 해제된다(위 주석의 그 사고).
  // 그래서 값을 바꾸는 대신 확정만 잠근다. 잠기는 구간은 로컬 파일 디코드 시간뿐이다.
  const confirmLocked = customSelected && customStatus !== 'ok';

  return (
    <SettingsScaffold
      title="캐릭터 변경"
      onBack={() => navigation.goBack()}
      footer={
        <View style={s.footerCol}>
          <PressableScale
            style={[s.equipBtn, confirmLocked && s.equipBtnLocked]}
            scaleTo={0.97}
            haptic="light"
            disabled={confirmLocked}
            onPress={equip}
          >
            <Ionicons name="checkmark" size={18} color={T.white} />
            <Text style={s.equipBtnText}>변경하기</Text>
          </PressableScale>
          <PressableScale style={s.footerBtn} scaleTo={0.97} onPress={goCreate}>
            <Ionicons name="add" size={18} color={T.accent} />
            <Text style={s.footerBtnText}>{hasCustom ? '다시 만들기' : '새로 만들기'}</Text>
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
          onPress={() => setPicked('default')}
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

        {/* 카드② 내 캐릭터 — 쓸 수 있는 누끼가 있으면 선택 카드, 없으면 만들기 플레이스홀더 */}
        {hasCustom ? (
          <PressableScale
            style={[s.card, customSelected && s.cardSelected]}
            scaleTo={0.97}
            disabled={!canPickCustom}
            onPress={() => setPicked('custom')}
          >
            {customSelected ? (
              <View style={s.checkBadge}>
                <Ionicons name="checkmark-circle" size={24} color={T.accent} />
              </View>
            ) : null}
            <View style={s.charBox}>
              {/* key 로 URI 마다 새로 마운트한다(코드리뷰 반영) — 같은 Image 호스트 뷰를 재사용하면
                  이전 요청의 대기 중이던 onLoad/onError 가 현재 콜백으로 배달돼, 옛 결과가 새 URI 의
                  판정으로 기록된다(옛 성공이 미검증 교체본을 열거나, 옛 실패가 멀쩡한 걸 숨김). */}
              <CharacterImage
                key={customUri ?? 'none'}
                size={CHAR_SIZE}
                sourceUri={customUri ?? undefined}
                onLoad={onCustomLoaded}
                onSourceError={onCustomBroken}
              />
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
  // 로드 확인 전 잠금 — 누끼 디코드 동안만이라 색을 바꾸지 않고 살짝 흐리게만 둔다.
  equipBtnLocked: { opacity: 0.6 },
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
