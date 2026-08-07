import { View, Text, TextInput, StyleSheet } from 'react-native';
import StepScaffold from '@/screens/onboarding/components/StepScaffold';
import { T } from '@/constants/theme';
import { logOnboardingNicknameSubmitted } from '@/services/analyticsEvents';
import { useNicknameCheck } from '@/hooks/useNicknameCheck';
import type { StepProps } from '@/screens/onboarding/types';

// 닉네임 — 온보딩 마지막 스텝(캐릭터 소개·누끼 체험 뒤). 입력 후 곧바로 가입 확정을 트리거한다.
// 캐릭터 첫 노출은 앞선 character_intro 스텝이 전담 — 이 화면은 이름 입력만 받는다.
// 중복 검증: 형식(2~10자, 프로필 편집과 동일)은 로컬이 먼저 거르고, 통과하면 실시간
// 중복확인(GROMO-1215, useNicknameCheck — 중간 로그인을 마친 뒤라 토큰이 있다)을 부른다.
// 확인 실패·구서버는 기존 힌트(가입 완료 시 확인)로 폴백하고, 최종 판정은 가입 확정
// (POST /users/me → 409 NICKNAME_DUPLICATE)이 맡는다. 서버 검증에 실패하면
// OnboardingFlow가 이 화면을 serverError와 함께 그대로 유지해 재입력/재시도를 받는다.
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

  // 실시간 중복확인 — 형식 통과분만 검사(형식 위반은 아래 로컬 문구가 선행).
  // taken이어도 CTA는 잠그지 않는다 — 검사 응답이 stale할 수 있어 최종 판정은
  // 가입 확정의 409가 맡고, 그 실패는 serverError로 되돌아온다.
  const checkStatus = useNicknameCheck(trimmed, validLength && !submitting);

  return (
    <StepScaffold
      testID="onboarding.step.nickname"
      titleCenter
      title={'앞으로 어떤 이름으로\n불러드릴까요?'}
      ctaLabel={submitting ? '확인 중…' : '다음'}
      ctaDisabled={!validLength || !!submitting}
      onCta={() => {
        // ⚠️ 닉네임 문자열은 PII라 전송 금지 — 이벤트엔 값 없음.
        logOnboardingNicknameSubmitted();
        onNext();
      }}
    >
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
        {/* 글자 수 카운터 — 색 처리는 아래 검증 안내와 동일한 validLength 규칙을 따른다.
            표시 전용이라 터치는 통과시켜 입력창 탭을 막지 않는다. */}
        <Text
          pointerEvents="none"
          style={[s.counter, nickname.length > 0 && !validLength ? s.counterError : null]}
        >
          {nickname.length}/{NICK_MAX}
        </Text>
      </View>
      {/* 검증 안내 — 서버 실패 메시지 > 형식 가이드 > 중복확인 결과 > 기본 힌트 순.
          unknown(확인 실패·구서버)은 기본 힌트로 폴백 — '가입 완료 시 확인' 문구가
          그대로 최종 방어(409) 경로를 안내한다(GROMO-1215). */}
      {serverError ? (
        <Text style={s.errorText}>{serverError}</Text>
      ) : nickname.length > 0 && !validLength ? (
        <Text style={s.errorText}>
          닉네임은 {NICK_MIN}~{NICK_MAX}자로 입력해 주세요
        </Text>
      ) : checkStatus === 'taken' ? (
        <Text style={s.errorText}>이미 사용 중인 닉네임이에요</Text>
      ) : checkStatus === 'available' ? (
        <Text style={s.successText}>사용 가능해요</Text>
      ) : checkStatus === 'checking' ? (
        <Text style={s.hintText}>확인 중…</Text>
      ) : (
        <Text style={s.hintText}>
          {NICK_MIN}~{NICK_MAX}자 · 중복 여부는 가입 완료 시 확인돼요
        </Text>
      )}
    </StepScaffold>
  );
}

const s = StyleSheet.create({
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
    paddingRight: 60, // 우측 글자 수 카운터 자리 확보
    ...T.text.subtitle,
    color: T.ink,
  },
  inputError: { borderColor: T.dangerInk },
  counter: { ...T.text.caption, color: T.inkMuted, position: 'absolute', right: T.space.lg },
  counterError: { color: T.dangerInk },
  errorText: {
    ...T.text.caption,
    color: T.dangerInk,
    marginTop: T.space.sm,
    marginLeft: T.space.xs,
  },
  successText: {
    ...T.text.caption,
    color: T.successInk,
    marginTop: T.space.sm,
    marginLeft: T.space.xs,
  },
  hintText: { ...T.text.caption, color: T.inkMuted, marginTop: T.space.sm, marginLeft: T.space.xs },
});
