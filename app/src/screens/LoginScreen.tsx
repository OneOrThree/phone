import { useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  ScrollView,
  Alert,
  Platform,
  useWindowDimensions,
} from 'react-native';
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
import { logOnboardingSignupFailed, logOnboardingSignupSelected } from '@/services/analyticsEvents';

// v2 로그인 화면 — Claude Design 온보딩 O7 시안 그대로.
// 로직은 데이터 층(@/services/auth) 재사용, UI만 새로 구성. 색은 T 토큰만 사용.
// TODO: 버튼 아이콘(카카오/애플/구글/메타) 연결.

// 메타(facebook)는 화면에서 보류(GROMO-602) — auth.ts facebookLogin은 남겨둠(나중 복원).
type Method = Extract<AuthMethod, 'kakao' | 'apple' | 'google'>;

interface LoginScreenProps {
  // 온보딩 완료 처리(서버 동기화 포함)가 끝날 때까지 버튼을 잠가야 하므로 Promise를 요구한다.
  onLogin: (u: LoginResult) => Promise<void>;
  // 온보딩 W15로 쓰일 때만 true — 가입 수단 선택/실패 퍼널 이벤트(onboarding_signup_*)를 발행한다.
  // 독립 재로그인 화면(App.tsx)에서는 미발행 — 온보딩 퍼널 오염 방지(GROMO-782).
  isOnboarding?: boolean;
}

const ALL_PROVIDERS: {
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

// 애플 로그인은 expo-apple-authentication이 iOS 전용 — 안드로이드에선 버튼 미노출(GROMO-998).
const PROVIDERS = ALL_PROVIDERS.filter(
  (p) => Platform.OS !== 'web' && (p.method !== 'apple' || Platform.OS === 'ios'),
);

export default function LoginScreen({ onLogin, isOnboarding }: LoginScreenProps) {
  const [busy, setBusy] = useState<Method | null>(null);
  const [guestBusy, setGuestBusy] = useState(false);
  // 마지막으로 로그인한 소셜 — 재방문 시 해당 버튼에 '최근 사용' 배지(GROMO-602).
  // 저장값이 화면에 없는 provider(메타/라인)면 매칭되는 버튼이 없어 배지 미표시.
  const [lastProvider, setLastProvider] = useState<AuthMethod | null>(null);
  // '최근 사용' 배지는 버튼 위에 겹쳐 놓는 장식이라, 기본 배율에서도 가운데 라벨과 3pt 남짓
  // 사이를 두고 지나간다. 기기 글자 크기를 키우면 라벨과 배지가 서로를 파고들어 둘 다 못 읽게
  // 되므로, 배율이 올라가면 배지를 접는다 — 장식을 접어 기능(라벨)을 살리는 쪽(GROMO-1485).
  //
  // ⚠️ 여기서 걸리는 건 **가로 폭**이지 버튼 높이가 아니다(높이는 minHeight가 알아서 자란다).
  // 라벨은 버튼 전체 폭 기준 가운데 정렬이라 커질수록 양쪽으로 퍼지는데, 배지는 오른쪽에
  // 고정돼 있다. xxLarge(1.235)만 돼도 '카카오로 계속하기'가 배지 자리를 침범한다 —
  // 그래서 표준 Dynamic Type 단계에서도 배지가 사라진다. 이건 손해를 알고 고른 쪽이다.
  // (배지를 끝까지 살리려면 아이콘 점으로 줄이거나 버튼 위 한 줄로 빼는 디자인 변경이 필요.)
  const { fontScale } = useWindowDimensions();
  const showLastBadge = fontScale <= 1.15;

  useEffect(() => {
    // 빠른 언마운트(자동 로그인·딥링크 레이스) 시 해제된 컴포넌트 setState 방지 — 다른 화면 패턴과 일관.
    let cancelled = false;
    getLastAuthProvider().then((p) => {
      if (!cancelled) setLastProvider(p);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function run(method: Method, fn: () => Promise<LoginResult>) {
    if (busy) return;
    if (isOnboarding) logOnboardingSignupSelected({ method });
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
        if (isOnboarding) logOnboardingSignupFailed({ method, reason: 'cancelled' });
        return;
      }
      if (isOnboarding)
        logOnboardingSignupFailed({
          method,
          // 에러 메시지 원문은 계정 관련 텍스트·고카디널리티 위험 — 코드가 있을 때만 코드로 버킷(PR 276 리뷰 반영)
          reason: typeof code === 'string' || typeof code === 'number' ? String(code) : 'unknown',
        });
      Alert.alert('로그인 실패', e instanceof Error ? e.message : '다시 시도해 주세요.');
    } finally {
      setBusy(null);
    }
  }

  // 게스트 로그인 = 게스트 세션 생성(백엔드 /auth/guest). 소셜과 동일하게 onLogin으로 흘려보낸다.
  // 실제 계정 생성은 안내창 확인 뒤에만 실행한다 — 안내창을 닫은 사용자의 빈 게스트 계정이
  // 서버에 남거나 온보딩 선택 이벤트가 오염되지 않게 선택 계측도 runGuest 안에 둔다.
  async function runGuest() {
    if (busy !== null || guestBusy) return;
    if (isOnboarding) logOnboardingSignupSelected({ method: 'guest' });
    setGuestBusy(true);
    try {
      const result = await guestLogin();
      // 게스트도 완료 처리까지 대기 — 재탭 시 게스트 계정이 중복 생성되는 것을 막는다.
      await onLogin(result);
    } catch (e) {
      // 게스트 실패는 구분 코드가 없어 'unknown' 고정 — 메시지 원문 미전송(PR 276 리뷰 반영)
      if (isOnboarding) logOnboardingSignupFailed({ method: 'guest', reason: 'unknown' });
      Alert.alert('시작 실패', e instanceof Error ? e.message : '다시 시도해 주세요.');
    } finally {
      setGuestBusy(false);
    }
  }

  function confirmGuestLogin() {
    if (busy !== null || guestBusy) return;
    Alert.alert(
      '게스트 로그인 안내',
      '기록은 서버에 저장되지만 이 기기의 인증 정보로만 다시 접근할 수 있어요. 앱을 지우거나 기기를 바꾸거나 인증 정보가 만료되면 기록을 되찾을 수 없어요.',
      [
        { text: '취소', style: 'cancel' },
        { text: '확인', onPress: runGuest },
      ],
    );
  }

  return (
    <SafeAreaView style={s.root}>
      {/* 스크롤 래퍼 — 기기 글자 크기를 키우면 버튼 라벨이 두 줄로 접히며 하단 블록이 화면
          아래로 밀리는데, 이 화면엔 로그인·게스트 시작 말고 다른 진입로가 없다. 잠긴 화면이면
          그대로 못 누른다(코드리뷰 P0). contentContainer가 flexGrow:1이라 기본 배율에서는
          가운데 블록이 남는 높이를 다 먹어 종전 배치 그대로다 — 넘칠 때만 스크롤이 생긴다. */}
      <ScrollView
        style={s.scroll}
        contentContainerStyle={s.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* 중앙: 마스코트 + 타이틀 */}
        <View style={s.center}>
          <View style={s.mascot}>
            <CharacterImage size={104} />
          </View>
          <Text style={s.title}>Gromo</Text>
          <Text style={s.subtitle}>
            목표를 안전하게 저장하고{'\n'}어디서든 이어서 쓸 수 있어요.
          </Text>
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
                  p.border ? [s.btnBorder, { borderColor: p.border }] : null,
                ]}
              >
                {loading ? (
                  <ActivityIndicator color={p.fg} />
                ) : (
                  <Text style={[s.btnText, { color: p.fg }]}>{p.label}</Text>
                )}
                {p.method === lastProvider && showLastBadge ? (
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
            testID="login.guest"
            onPress={confirmGuestLogin}
            disabled={busy !== null || guestBusy}
            activeOpacity={0.85}
            style={[s.btn, s.guestBtn]}
          >
            {guestBusy ? (
              <ActivityIndicator color={T.ink} />
            ) : (
              <Text style={[s.btnText, s.guestBtnText]}>게스트 로그인</Text>
            )}
          </TouchableOpacity>

          <Text style={s.terms}>
            계속하면 <Text style={s.termsLink}>이용약관</Text> 및{' '}
            <Text style={s.termsLink}>개인정보 처리방침</Text>에 동의하게 됩니다.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: T.paper },
  scroll: { flex: 1 },
  scrollContent: { flexGrow: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 30 },
  mascot: {
    width: 104,
    height: 112,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: T.space.xl,
  },
  title: { ...T.text.display, color: T.ink },
  subtitle: {
    ...T.text.body,
    color: T.inkSub,
    textAlign: 'center',
    marginTop: T.space.md,
  },
  bottom: { paddingHorizontal: T.space.xxl, paddingBottom: T.space.xxl },
  // 높이는 minHeight — 기기 글자 크기를 키우면 라벨이 두 줄로 접히는데, 고정 height면
  // 그대로 잘린다(GROMO-1485). 기본 배율에선 라벨 한 줄(≈23) + 패딩 24 < 52라 52 그대로다.
  btn: {
    minHeight: 52,
    paddingVertical: T.space.md,
    paddingHorizontal: T.space.lg,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: T.space.sm,
  },
  btnBorder: { borderWidth: 1 },
  btnText: { ...T.text.subtitle },
  // 게스트 버튼 — 소셜과 동급(채움). 중립 톤으로 브랜드색과 구분.
  guestBtn: { backgroundColor: T.sand, marginTop: 2, marginBottom: T.space.lg },
  guestBtnText: { color: T.ink },
  // '최근 사용' 배지 — 마지막 로그인 소셜 버튼 우측(버튼 색 위에서도 보이게 accent 채움).
  lastBadgeWrap: { position: 'absolute', right: 10, top: 0, bottom: 0, justifyContent: 'center' },
  lastBadge: {
    backgroundColor: T.accent,
    borderRadius: 8,
    paddingHorizontal: T.space.sm,
    paddingVertical: 3,
  },
  lastBadgeText: { ...T.text.caption, fontWeight: '800', color: T.white },
  terms: { ...T.text.caption, lineHeight: 17, color: T.inkMuted, textAlign: 'center' },
  termsLink: { color: T.link, textDecorationLine: 'underline' },
});
