import { View, Text, TextInput, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import StepScaffold from '@/v2/screens/onboarding/components/StepScaffold';
import { T } from '@/v2/constants/theme';
import type { StepProps } from '@/v2/screens/onboarding/types';

// 15 · 캐릭터·닉네임 — nickname 입력. 캐릭터는 '표시'만(이 화면에 커스터마이즈 없음).
// TODO: 마스코트는 임시 이모지 → CharacterImage 연결. 닉네임 중복확인 API 연결.

function Room() {
  return (
    <LinearGradient colors={['#F3E7D3', '#EAD8BC']} style={s.room}>
      <View style={s.floor} />
      <View style={s.window} />
      <View style={s.box} />
      <Text style={s.mascot}>🐹</Text>
    </LinearGradient>
  );
}

export default function NicknameStep({ data, update, onNext, onBack }: StepProps) {
  const nickname = data.nickname;
  const ok = nickname.trim().length > 0; // TODO: 중복확인 API 연결

  return (
    <StepScaffold
      titleCenter
      title={'당신의 별사탕이\n도착했어요'}
      ctaLabel="시작하기"
      ctaDisabled={!ok}
      onCta={onNext}
      onBack={onBack}
    >
      <Room />
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

// 방 일러스트 로컬 색(테마 토큰 아님).
const s = StyleSheet.create({
  room: {
    height: 230,
    borderRadius: 24,
    marginTop: 18,
    marginBottom: 22,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  floor: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 62,
    backgroundColor: '#D9C09A',
  },
  window: {
    position: 'absolute',
    left: 32,
    top: 34,
    width: 54,
    height: 54,
    borderRadius: 10,
    backgroundColor: '#EFE2CC',
    borderWidth: 3,
    borderColor: '#D9C09A',
  },
  box: {
    position: 'absolute',
    right: 30,
    bottom: 62,
    width: 46,
    height: 30,
    borderTopLeftRadius: 6,
    borderTopRightRadius: 6,
    backgroundColor: '#C7A87E',
  },
  mascot: { fontSize: 96, marginBottom: 30 }, // 임시 마스코트(이모지) 크기 — CharacterImage 교체 예정
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
