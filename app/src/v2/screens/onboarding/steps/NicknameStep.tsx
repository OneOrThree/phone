import { TextInput, StyleSheet } from 'react-native';
import StepScaffold from '@/v2/screens/onboarding/StepScaffold';
import { T } from '@/v2/constants/theme';
import type { StepProps } from '@/v2/screens/onboarding/types';

// 15 · 캐릭터·닉네임 — nickname 입력. 캐릭터는 '표시'만(이 화면에 커스터마이즈 컨트롤 없음).
// TODO(시안 15): 상단 '별사탕 도착' 캐릭터 일러스트(방 배경) + 닉네임 중복확인(사용 가능 ✓).
export default function NicknameStep({ data, update, onNext, onBack }: StepProps) {
  const ok = data.nickname.trim().length > 0; // TODO: 중복확인 API 연결

  return (
    <StepScaffold
      title={'당신의 별사탕이\n도착했어요'}
      ctaLabel="시작하기"
      ctaDisabled={!ok}
      onCta={onNext}
      onBack={onBack}
    >
      {/* TODO(시안 15): 캐릭터 일러스트 영역 */}
      <TextInput
        value={data.nickname}
        onChangeText={(t) => update({ nickname: t })}
        placeholder="닉네임"
        placeholderTextColor={T.inkMuted}
        style={s.input}
        maxLength={12}
        autoCapitalize="none"
        autoCorrect={false}
      />
    </StepScaffold>
  );
}

const s = StyleSheet.create({
  input: {
    height: 54,
    borderRadius: 14,
    backgroundColor: T.white,
    borderWidth: 1.5,
    borderColor: T.accent,
    paddingHorizontal: 16,
    ...T.text.subtitle,
    color: T.ink,
  },
});
