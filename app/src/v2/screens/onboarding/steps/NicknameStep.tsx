import { View, Text, TextInput, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import StepScaffold from '@/v2/screens/onboarding/components/StepScaffold';
import { CharacterImage } from '@/components/character/CharacterImage';
import { T } from '@/constants/theme';
import type { StepProps } from '@/v2/screens/onboarding/types';

// 닉네임·캐릭터 — W11(전날 스크린타임)과 W12(목표 설정) 사이 삽입.
// 캐릭터 '도착' 연출 + 닉네임 입력. 캐릭터 커스터마이즈는 이 화면 범위 밖(표시만).
// TODO: 닉네임 중복확인 API 연결.
export default function NicknameStep({ data, update, onNext, onBack }: StepProps) {
  const nickname = data.nickname;
  const ok = nickname.trim().length > 0;

  return (
    <StepScaffold
      titleCenter
      title={'당신의 집중을 도와줄 별사탕이\n도착했어요'}
      ctaLabel="다음"
      ctaDisabled={!ok}
      onCta={onNext}
      onBack={onBack}
    >
      <LinearGradient colors={[T.paperLight, T.caramel]} style={s.stage}>
        <CharacterImage size={172} />
      </LinearGradient>
      <Text style={s.label}>
        닉네임 <Text style={s.labelEn}>Nickname</Text>
      </Text>
      <View style={s.inputRow}>
        <TextInput
          value={nickname}
          onChangeText={(t) => update({ nickname: t })}
          placeholder="닉네임을 입력하세요"
          placeholderTextColor={T.inkMuted}
          style={s.input}
          maxLength={12}
          autoCapitalize="none"
          autoCorrect={false}
        />
        {ok ? <Text style={s.okText}>사용 가능 ✓</Text> : null}
      </View>
    </StepScaffold>
  );
}

const s = StyleSheet.create({
  stage: {
    height: 230,
    borderRadius: 24,
    marginTop: 18,
    marginBottom: 22,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: { ...T.text.caption, color: T.ink, marginBottom: 9 },
  labelEn: { color: T.inkMuted, fontWeight: '500' },
  inputRow: { position: 'relative', justifyContent: 'center' },
  input: {
    height: 54,
    borderRadius: 14,
    backgroundColor: T.white,
    borderWidth: 1.5,
    borderColor: T.accent,
    paddingHorizontal: 16,
    paddingRight: 90,
    ...T.text.subtitle,
    color: T.ink,
  },
  okText: { position: 'absolute', right: 16, ...T.text.caption, color: T.green },
});
