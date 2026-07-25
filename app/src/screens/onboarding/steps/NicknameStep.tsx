import { View, Text, TextInput, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import StepScaffold from '@/screens/onboarding/components/StepScaffold';
import { CharacterImage } from '@/components/character/CharacterImage';
import { T } from '@/constants/theme';
import { logOnboardingNicknameSubmitted } from '@/services/analyticsEvents';
import type { StepProps } from '@/screens/onboarding/types';

// 닉네임·캐릭터 — 온보딩 마지막 스텝(목표 설정 뒤). 입력 후 곧바로 가입 확정을 트리거한다.
// 캐릭터 '도착' 연출 + 닉네임 입력. 캐릭터 커스터마이즈는 이 화면 범위 밖(표시만).
// 중복 검증: 실시간 중복확인 API가 서버에 없어(중간 로그인은 마쳤지만) 여기선 형식(2~10자,
// 프로필 편집과 동일)만 검사하고, 실제 중복은 가입 확정(POST /users/me → 409
// NICKNAME_DUPLICATE) 시점에 확정된다. 서버 검증에 실패하면 OnboardingFlow가 이 화면을
// serverError와 함께 그대로 유지해 재입력/재시도를 받는다.
const NICK_MIN = 2;
const NICK_MAX = 10;

interface NicknameStepProps extends StepProps {
  serverError?: string | null; // 가입 확정 시 서버 검증 실패(중복·일시 오류) 메시지
  submitting?: boolean; // 가입 확정 요청 진행 중 — 입력·CTA 잠금
}

export default function NicknameStep({
  data,
  update,
  onNext,
  serverError,
  submitting,
}: NicknameStepProps) {
  const nickname = data.nickname;
  const trimmed = nickname.trim();
  const validLength = trimmed.length >= NICK_MIN && trimmed.length <= NICK_MAX;

  return (
    <StepScaffold
      testID="onboarding.step.nickname"
      titleCenter
      title={'당신의 집중을 도와줄 그로몬이\n도착했어요!'}
      ctaLabel={submitting ? '확인 중…' : '다음'}
      ctaDisabled={!validLength || !!submitting}
      onCta={() => {
        // ⚠️ 닉네임 문자열은 PII라 전송 금지 — 이벤트엔 값 없음.
        logOnboardingNicknameSubmitted();
        onNext();
      }}
    >
      <LinearGradient colors={[T.paperLight, T.caramel]} style={s.stage}>
        <CharacterImage size={172} />
      </LinearGradient>
      <Text style={s.label}>
        닉네임 <Text style={s.labelEn}>Nickname</Text>
      </Text>
      <View style={s.inputRow}>
        <TextInput
          testID="onboarding.nickname.input"
          value={nickname}
          onChangeText={(t) => update({ nickname: t })}
          placeholder="닉네임을 입력하세요"
          placeholderTextColor={T.inkMuted}
          style={[s.input, serverError ? s.inputError : null]}
          maxLength={NICK_MAX}
          autoCapitalize="none"
          autoCorrect={false}
          editable={!submitting}
        />
      </View>
      {/* 검증 안내 — 서버 실패 메시지 > 형식 가이드 > 기본 힌트 순. */}
      {serverError ? (
        <Text style={s.errorText}>{serverError}</Text>
      ) : nickname.length > 0 && !validLength ? (
        <Text style={s.errorText}>
          닉네임은 {NICK_MIN}~{NICK_MAX}자로 입력해 주세요
        </Text>
      ) : (
        <Text style={s.hintText}>
          {NICK_MIN}~{NICK_MAX}자 · 중복 여부는 가입 완료 시 확인돼요
        </Text>
      )}
    </StepScaffold>
  );
}

const s = StyleSheet.create({
  stage: {
    height: 230,
    borderRadius: 24,
    marginTop: T.space.xl,
    marginBottom: T.space.xxl,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: { ...T.text.caption, color: T.ink, marginBottom: T.space.sm },
  labelEn: { color: T.inkMuted, fontWeight: '500' },
  inputRow: { position: 'relative', justifyContent: 'center' },
  input: {
    height: 54,
    borderRadius: 14,
    backgroundColor: T.white,
    borderWidth: 1.5,
    borderColor: T.accent,
    paddingHorizontal: T.space.lg,
    ...T.text.subtitle,
    color: T.ink,
  },
  inputError: { borderColor: T.dangerInk },
  errorText: {
    ...T.text.caption,
    color: T.dangerInk,
    marginTop: T.space.sm,
    marginLeft: T.space.xs,
  },
  hintText: { ...T.text.caption, color: T.inkMuted, marginTop: T.space.sm, marginLeft: T.space.xs },
});
