import { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  kakaoLogin,
  appleLogin,
  googleLogin,
  guestLogin,
  trackAuthSuccess,
  getLastAuthProvider,
  statusCodes,
  type AuthMethod,
} from '@/services/auth';
import type { LoginResult } from '@/types/api';
import { T } from '@/constants/theme';
import { CharacterImage } from '@/components/character/CharacterImage';

// v2 로그인 화면 — Claude Design 온보딩 O7 시안 그대로.
// 로직은 데이터 층(@/services/auth) 재사용, UI만 새로 구성. 색은 T 토큰만 사용.
// TODO: 버튼 아이콘(카카오/애플/구글/메타) 연결.

// 메타(facebook)는 화면에서 보류(GROMO-602) — auth.ts facebookLogin은 남겨둠(나중 복원).
type Method = Extract<AuthMethod, 'kakao' | 'apple' | 'google'>;

interface LoginScreenProps {
  // 온보딩 완료 처리(서버 동기화 포함)가 끝날 때까지 버튼을 잠가야 하므로 Promise를 요구한다.
  onLogin: (u: LoginResult) => Promise<void>;
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
];

export default function LoginScreen({ onLogin }: LoginScreenProps) {
  const [busy, setBusy] = useState<Method | null>(null);
  const [guestBusy, setGuestBusy] = useState(false);
  // 마지막으로 로그인한 소셜 — 재방문 시 해당 버튼에 '최근 사용' 배지(GROMO-602).
  // 저장값이 화면에 없는 provider(메타/라인)면 매칭되는 버튼이 없어 배지 미표시.
  const [lastProvider, setLastProvider] = useState<AuthMethod | null>(null);

  useEffect(() => {
    getLastAuthProvider().then(setLastProvider);
  }, []);

  async function run(method: Method, fn: () => Promise<LoginResult>) {
    if (busy) return;
    setBusy(method);
    try {
      const result = await fn();
      trackAuthSuccess(method, result.isNewUser);
      // 온보딩 완료 처리(프로필 서버 동기화 등)가 끝날 때까지 busy 유지 — 더블탭 중복 제출 방지.
      await onLogin(result);
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

  // 로그인 없이 시작 = 게스트 세션 생성(백엔드 /auth/guest). 소셜과 동일하게 onLogin으로 흘려보낸다.
  async function runGuest() {
    if (busy !== null || guestBusy) return;
    setGuestBusy(true);
    try {
      const result = await guestLogin();
      // 게스트도 완료 처리까지 대기 — 재탭 시 게스트 계정이 중복 생성되는 것을 막는다.
      await onLogin(result);
    } catch (e) {
      Alert.alert('시작 실패', e instanceof Error ? e.message : '다시 시도해 주세요.');
    } finally {
      setGuestBusy(false);
    }
  }

  return (
    <SafeAreaView style={s.root}>
      {/* 중앙: 마스코트 + 타이틀 */}
      <View style={s.center}>
        <View style={s.mascot}>
          <CharacterImage size={104} />
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
              disabled={busy !== null || guestBusy}
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
              {p.method === lastProvider ? (
                <View style={s.lastBadgeWrap} pointerEvents="none">
                  <View style={s.lastBadge}>
                    <Text style={s.lastBadgeText}>최근 사용</Text>
                  </View>
                </View>
              ) : null}
            </TouchableOpacity>
          );
        })}

        <TouchableOpacity
          onPress={runGuest}
          disabled={busy !== null || guestBusy}
          activeOpacity={0.85}
          style={[s.btn, s.guestBtn]}
        >
          {guestBusy ? (
            <ActivityIndicator color={T.ink} />
          ) : (
            <Text style={[s.btnText, s.guestBtnText]}>로그인 없이 시작하기</Text>
          )}
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
  // 게스트 버튼 — 소셜과 동급(채움). 중립 톤으로 브랜드색과 구분.
  guestBtn: { backgroundColor: T.sand, marginTop: 2, marginBottom: 16 },
  guestBtnText: { color: T.ink },
  // '최근 사용' 배지 — 마지막 로그인 소셜 버튼 우측(버튼 색 위에서도 보이게 accent 채움).
  lastBadgeWrap: { position: 'absolute', right: 10, top: 0, bottom: 0, justifyContent: 'center' },
  lastBadge: { backgroundColor: T.accent, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  lastBadgeText: { ...T.text.caption, fontWeight: '800', color: T.white },
  terms: { ...T.text.caption, lineHeight: 17, color: T.inkMuted, textAlign: 'center' },
  termsLink: { color: T.link, textDecorationLine: 'underline' },
});
