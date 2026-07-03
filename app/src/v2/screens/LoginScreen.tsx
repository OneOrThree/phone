import { useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  kakaoLogin,
  appleLogin,
  googleLogin,
  facebookLogin,
  trackAuthSuccess,
  statusCodes,
  type AuthMethod,
} from '@/services/auth';
import type { LoginResult } from '@/types/api';
import { T } from '@/constants/theme';

// v2 로그인 화면 — Claude Design 온보딩 O7 시안 그대로.
// 로직은 데이터 층(@/services/auth) 재사용, UI만 새로 구성. 색은 T 토큰만 사용.
// TODO: 버튼 아이콘(카카오/애플/구글/메타) · 마스코트(CharacterImage) 연결.

type Method = Extract<AuthMethod, 'kakao' | 'apple' | 'google' | 'facebook'>;

interface LoginScreenProps {
  onLogin: (u: LoginResult) => void;
  onGuestStart: () => void;
}

const PROVIDERS: {
  method: Method;
  label: string;
  fn: () => Promise<LoginResult>;
  bg: string;
  fg: string;
  border?: string;
}[] = [
  { method: 'kakao', label: '카카오로 계속하기', fn: kakaoLogin, bg: T.kakao, fg: T.kakaoInk },
  { method: 'apple', label: 'Apple로 계속하기', fn: appleLogin, bg: T.black, fg: T.white },
  {
    method: 'google',
    label: 'Google로 계속하기',
    fn: googleLogin,
    bg: T.white,
    fg: T.grayInk,
    border: T.border,
  },
  {
    method: 'facebook',
    label: 'Meta로 계속하기',
    fn: facebookLogin,
    bg: T.white,
    fg: T.grayInk,
    border: T.border,
  },
];

export default function LoginScreen({ onLogin, onGuestStart }: LoginScreenProps) {
  const [busy, setBusy] = useState<Method | null>(null);

  async function run(method: Method, fn: () => Promise<LoginResult>) {
    if (busy) return;
    setBusy(method);
    try {
      const result = await fn();
      trackAuthSuccess(method, result.isNewUser);
      onLogin(result);
    } catch (e) {
      const code = (e as { code?: unknown })?.code;
      // 사용자 취소는 조용히 무시
      // - google: statusCodes.SIGN_IN_CANCELLED
      // - facebook: 'CANCELLED'
      // - apple(expo-apple-authentication): 'ERR_REQUEST_CANCELED' (구버전 'ERR_CANCELED')
      if (
        code === statusCodes.SIGN_IN_CANCELLED ||
        code === 'CANCELLED' ||
        code === 'ERR_REQUEST_CANCELED' ||
        code === 'ERR_CANCELED'
      ) {
        return;
      }
      Alert.alert('로그인 실패', e instanceof Error ? e.message : '다시 시도해 주세요.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <SafeAreaView style={s.root}>
      {/* 중앙: 마스코트 + 타이틀 */}
      <View style={s.center}>
        <View style={s.mascot}>
          <Text style={s.mascotEmoji}>🐹</Text>
        </View>
        <Text style={s.title}>Gromo</Text>
        <Text style={s.subtitle}>목표를 안전하게 저장하고{'\n'}어디서든 이어서 쓸 수 있어요.</Text>
      </View>

      {/* 하단: 소셜 로그인 + 게스트 + 약관 */}
      <View style={s.bottom}>
        {PROVIDERS.map((p) => {
          const loading = busy === p.method;
          return (
            <TouchableOpacity
              key={p.method}
              activeOpacity={0.85}
              disabled={busy !== null}
              onPress={() => run(p.method, p.fn)}
              style={[
                s.btn,
                { backgroundColor: p.bg },
                p.border ? { borderWidth: 1, borderColor: p.border } : null,
              ]}
            >
              {loading ? (
                <ActivityIndicator color={p.fg} />
              ) : (
                <Text style={[s.btnText, { color: p.fg }]}>{p.label}</Text>
              )}
            </TouchableOpacity>
          );
        })}

        <TouchableOpacity onPress={onGuestStart} disabled={busy !== null} style={s.guest}>
          <Text style={s.guestText}>로그인 없이 시작하기</Text>
        </TouchableOpacity>

        <Text style={s.terms}>
          계속하면 <Text style={s.termsLink}>이용약관</Text> 및{' '}
          <Text style={s.termsLink}>개인정보 처리방침</Text>에 동의하게 됩니다.
        </Text>
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: T.paper },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 30 },
  mascot: {
    width: 104,
    height: 112,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 18,
  },
  mascotEmoji: { fontSize: 72 }, // 임시 마스코트(이모지) 크기 — CharacterImage 교체 예정
  title: { ...T.text.display, color: T.ink },
  subtitle: {
    ...T.text.body,
    color: T.inkSub,
    textAlign: 'center',
    marginTop: 10,
  },
  bottom: { paddingHorizontal: 26, paddingBottom: 26 },
  btn: {
    height: 52,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 9,
  },
  btnText: { ...T.text.subtitle },
  guest: { alignItems: 'center', marginTop: 4, marginBottom: 16 },
  guestText: {
    ...T.text.label,
    color: T.link,
    textDecorationLine: 'underline',
  },
  terms: { ...T.text.caption, lineHeight: 17, color: T.inkMuted, textAlign: 'center' },
  termsLink: { color: T.link, textDecorationLine: 'underline' },
});
