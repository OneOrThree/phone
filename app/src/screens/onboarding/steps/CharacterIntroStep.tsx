import { StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import StepScaffold from '@/screens/onboarding/components/StepScaffold';
import { CharacterImage } from '@/components/character/CharacterImage';
import { T } from '@/constants/theme';
import type { StepProps } from '@/screens/onboarding/types';

// 캐릭터 소개 스텝 — 목표 설정 다음, 누끼 체험(CutoutStep) 바로 앞.
// 기본 그로몬과의 "첫 만남" 연출: 무대 위 캐릭터 + 해요체 인사. 캐릭터 첫 노출은
// 이 스텝이 전담한다(닉네임 스텝의 기존 '도착' 연출을 이리로 옮김).
export default function CharacterIntroStep({ onNext }: StepProps) {
  return (
    <StepScaffold
      testID="onboarding.step.character_intro"
      titleCenter
      header={
        <LinearGradient colors={[T.paperLight, T.caramel]} style={s.stage}>
          <CharacterImage size={172} />
        </LinearGradient>
      }
      title={'만나서 반가워요'}
      subtitle={'앞으로 함께 집중할 친구, 그로몬이에요.'}
      ctaLabel="다음"
      onCta={onNext}
    />
  );
}

const s = StyleSheet.create({
  // 캐릭터가 서는 무대 — 헤더 폭을 꽉 채우도록 stretch(부모 header는 flex-start 정렬).
  stage: {
    alignSelf: 'stretch',
    height: 230,
    borderRadius: 24,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
