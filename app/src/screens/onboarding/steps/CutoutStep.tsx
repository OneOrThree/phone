import type { ComponentProps } from 'react';
import { useState } from 'react';
import { View, Text, TouchableOpacity, Modal, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import StepScaffold from '@/screens/onboarding/components/StepScaffold';
import { CharacterImage } from '@/components/character/CharacterImage';
import CharacterCreator from '@/screens/character/CharacterCreator';
import { T } from '@/constants/theme';
import type { StepProps } from '@/screens/onboarding/types';

// 누끼 체험 스텝 — 캐릭터 소개(CharacterIntroStep) 다음, 닉네임 앞. 스킵 불가.
// "이렇게 내 물건으로 캐릭터를 만들 수 있어요"를 한 번 직접 해보게 하는 체험/맛보기다.
// 여기서 누끼를 만들어도 기본 장착은 그로몬 유지 — 만든 결과는 온보딩 데이터(cutoutCharacterUri)에
// 담아 두고, 완료 시 App이 CharacterContext에 시드한다(장착은 나중에 홈 캐릭터 선택에서).
//
// 자립 배선: 생성기(CharacterCreator)는 useNavigation·useCharacter를 쓰지 않으므로
// NavigationContainer·CharacterProvider 밖(온보딩)에서도 동작한다. 여기선 RN Modal로 띄우고,
// 저장 결과는 onSaved 콜백으로 받아 update()로 온보딩 데이터에 담는다.

type IconName = ComponentProps<typeof Ionicons>['name'];

// 안내 3가지(해요체) — ① 직접 해보기 ② 나중에 홈에서 장착 ③ 친구에게 보여주기 예고.
const GUIDES: { icon: IconName; text: string }[] = [
  { icon: 'sparkles-outline', text: '이렇게 사진 속 물건으로 캐릭터를 만들 수 있어요.' },
  {
    icon: 'home-outline',
    text: '만든 캐릭터는 나중에 홈에서 바꿔 장착할 수 있어요. 기본은 그로몬이에요.',
  },
  { icon: 'people-outline', text: '친구에게 내 캐릭터를 보여주는 기능도 곧 만나요.' },
];

export default function CutoutStep({ data, update, onNext }: StepProps) {
  const [modalOpen, setModalOpen] = useState(false);
  const created = !!data.cutoutCharacterUri;

  // 생성기가 저장 경로를 돌려주면 온보딩 데이터에 담고 Modal을 닫는다. 저장 경로는 고정 파일이라
  // 그대로 두면 RN <Image>가 URI를 캐시 키로 잡아 '다시 만들어보기' 미리보기가 옛 이미지로 남는다.
  // 캐시버스트 쿼리를 붙여 매 저장마다 키를 바꾼다(CharacterCreateRoute와 동일한 처리).
  const handleSaved = (uri: string) => {
    update({ cutoutCharacterUri: `${uri}?t=${Date.now()}` });
    setModalOpen(false);
  };

  return (
    <StepScaffold
      testID="onboarding.step.cutout_experience"
      title={'내 물건으로\n캐릭터를 만들어 볼까요?'}
      subtitle="사진 한 장이면 나만의 캐릭터가 완성돼요."
      ctaLabel="다음"
      // 스킵 불가 — 캐릭터를 만들어(cutoutCharacterUri 생성) 체험을 완료해야 다음으로. 능동 스킵 버튼 없음.
      ctaDisabled={!created}
      onCta={onNext}
    >
      <View style={s.guides}>
        {GUIDES.map((g) => (
          <View key={g.text} style={s.guideRow}>
            <Ionicons name={g.icon} size={20} color={T.accent} style={s.guideIcon} />
            <Text style={s.guideText}>{g.text}</Text>
          </View>
        ))}
      </View>

      <TouchableOpacity
        testID="onboarding.cutout.create"
        style={s.makeBtn}
        activeOpacity={0.85}
        onPress={() => setModalOpen(true)}
      >
        <Ionicons name="camera-outline" size={20} color={T.accent} />
        <Text style={s.makeText}>{created ? '다시 만들어보기' : '내 물건으로 만들어보기'}</Text>
      </TouchableOpacity>

      {created ? (
        <View style={s.doneRow}>
          <CharacterImage size={64} sourceUri={data.cutoutCharacterUri} />
          <Text style={s.doneText}>이 캐릭터로 만들었어요.</Text>
        </View>
      ) : (
        <Text style={s.hint}>먼저 캐릭터를 만들어 주세요.</Text>
      )}

      {/* 생성기 — NavigationContainer가 필요 없는 RN Modal로 띄운다. 닫기는 상단 X 버튼. */}
      <Modal visible={modalOpen} animationType="slide" onRequestClose={() => setModalOpen(false)}>
        <SafeAreaView style={s.modalRoot} edges={['top', 'bottom']}>
          <View style={s.modalBar}>
            <Text style={s.modalTitle}>사진에서 캐릭터 만들기</Text>
            <TouchableOpacity
              onPress={() => setModalOpen(false)}
              style={s.modalClose}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            >
              <Ionicons name="close" size={24} color={T.ink} />
            </TouchableOpacity>
          </View>
          <View style={s.modalBody}>
            <CharacterCreator onSaved={handleSaved} />
          </View>
        </SafeAreaView>
      </Modal>
    </StepScaffold>
  );
}

const s = StyleSheet.create({
  guides: { gap: T.space.md },
  guideRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: T.space.sm,
    backgroundColor: T.paperAlt,
    borderWidth: 1,
    borderColor: T.border,
    borderRadius: 14,
    padding: T.space.lg,
  },
  guideIcon: { marginTop: 1 },
  guideText: { ...T.text.body, color: T.ink, flex: 1 },
  makeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: T.space.sm,
    height: 54,
    borderRadius: 16,
    backgroundColor: T.paper,
    borderWidth: 1.5,
    borderColor: T.accent,
    marginTop: T.space.xxl,
  },
  makeText: { ...T.text.subtitle, color: T.accent },
  hint: { ...T.text.caption, color: T.inkMuted, marginTop: T.space.lg, textAlign: 'center' },
  doneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: T.space.sm,
    marginTop: T.space.lg,
  },
  doneText: { ...T.text.caption, color: T.inkSub },

  // 생성기 Modal 크롬 — 설정 화면(SettingsScaffold)과 같은 톤의 상단바 + 좌우 패딩.
  modalRoot: { flex: 1, backgroundColor: T.paperLight },
  modalBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: T.space.xl,
    paddingTop: T.space.xs,
    paddingBottom: T.space.md,
  },
  modalTitle: { ...T.text.heading, color: T.ink },
  modalClose: { padding: T.space.xs },
  modalBody: { flex: 1, paddingHorizontal: T.space.xl },
});
