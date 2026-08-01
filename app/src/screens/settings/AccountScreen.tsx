import { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import axios from 'axios';
import { Ionicons } from '@expo/vector-icons';
import type { V2RootStackParamList } from '@/navigation/types';
import SettingsScaffold from '@/screens/settings/components/SettingsScaffold';
import { SettingsSection, SettingsRow } from '@/screens/settings/components/SettingsList';
import { getSocialLinks, unlinkSocialAccount, withdraw } from '@/services/userApi';
import { triggerLogout, triggerRelogin } from '@/services/api';
import {
  kakaoLogin,
  appleLogin,
  googleLogin,
  trackAuthSuccess,
  clearLastAuthProvider,
  statusCodes,
  type AuthMethod,
} from '@/services/auth';
import { useUser } from '@/store/UserContext';
import {
  logGuestSocialLoginAttempted,
  logLogout,
  logWithdrawalConfirmed,
} from '@/services/analyticsEvents';
import type { Provider, SocialLinkResponse } from '@/types/dto/user';
import type { LoginResult } from '@/types/api';
import { T, withAlpha } from '@/constants/theme';

// 계정 설정 화면 — 소셜 로그인/연동 + 로그아웃 + 회원 탈퇴.
// 게스트(useUser().isGuest === true)일 땐 카카오·애플·구글 '로그인' 버튼을 띄워 계정 전환을 유도하고,
// 소셜 로그인 완료 상태일 땐 지금 연동된 계정만 보여주고 다른 소셜 로그인은 감춘다.
// 게스트 판별은 로그인 시점 태깅(isGuest)이 우선이고, 값이 소셜(false)이면 연동 목록으로 최종 확정한다
// (구 세션·정확성 대비). 게스트가 로그인하면 auth.ts가 세션을 저장하고 triggerRelogin으로 재부팅한다.

type Method = Extract<AuthMethod, 'kakao' | 'apple' | 'google'>;
type IconName = keyof typeof Ionicons.glyphMap;

// 노출 소셜 제공자(순서 고정) — key로 서버 provider 문자열과 매칭, fn은 게스트 로그인용.
const PROVIDERS: {
  key: Provider;
  method: Method;
  name: string;
  icon: IconName;
  iconColor: string;
  iconBg: string;
  fn: () => Promise<LoginResult>;
}[] = [
  {
    key: 'KAKAO',
    method: 'kakao',
    name: '카카오',
    icon: 'chatbubble',
    iconColor: T.kakaoInk,
    iconBg: T.kakao,
    fn: kakaoLogin,
  },
  {
    key: 'APPLE',
    method: 'apple',
    name: 'Apple',
    icon: 'logo-apple',
    iconColor: T.ink,
    iconBg: T.sandLight,
    fn: appleLogin,
  },
  {
    key: 'GOOGLE',
    method: 'google',
    name: 'Google',
    icon: 'logo-google',
    iconColor: T.grayInk,
    iconBg: T.sandLight,
    fn: googleLogin,
  },
];

export default function AccountScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<V2RootStackParamList>>();
  const { isGuest: isGuestCtx } = useUser();

  // 연동 목록(로딩 전 null). 재진입마다 최신화.
  const [links, setLinks] = useState<SocialLinkResponse[] | null>(null);
  const [busy, setBusy] = useState<Method | null>(null); // 게스트 로그인 진행 중인 provider
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);

  const loadLinks = useCallback(async () => {
    try {
      setLinks(await getSocialLinks());
    } catch {
      setLinks([]);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      getSocialLinks()
        .then((d) => !cancelled && setLinks(d))
        .catch(() => {}); // 조회 실패를 게스트(빈 목록)로 오판하지 않도록 null 유지(리뷰 반영)
      return () => {
        cancelled = true;
      };
    }, []),
  );

  // 게스트 판별 — 로그인 시점 태깅(isGuestCtx)이 1순위. 태깅이 소셜(false)인 구 세션 대비
  // '연동 목록 조회 성공 + 빈 목록'일 때만 게스트로 본다(조회 실패는 게스트로 분류하지 않음 — 리뷰 반영).
  const isGuest = isGuestCtx || (links !== null && links.length === 0);

  // 게스트 → 소셜 로그인. 세션은 auth.ts가 저장하고, triggerRelogin으로 새 계정으로 재부팅한다.
  const runLogin = async (method: Method, fn: () => Promise<LoginResult>) => {
    if (busy) return;
    logGuestSocialLoginAttempted({ method }); // 성공 여부는 auth.ts(login/sign_up)가 기록
    setBusy(method);
    try {
      const result = await fn();
      trackAuthSuccess(method, result.isNewUser);
      // 이 화면의 게스트 판별(태깅 || 연동 목록 빈 구 세션)을 전환 신호로 넘긴다 —
      // 프로필 플래그만으론 구 세션 게스트의 로컬 데이터 인계를 놓친다(GROMO-936 코덱스 리뷰).
      // 세션 교체·인계가 끝날 때까지 대기해 busy를 유지 — 전환 도중 다른 소셜 버튼 재탭으로
      // 이중 전환이 경합하지 않게 한다. 교체 실패는 종전(fire-and-forget)과 동일하게 무시.
      await triggerRelogin({ fromGuest: isGuest }).catch(() => {});
    } catch (e) {
      const code = (e as { code?: unknown })?.code;
      // 사용자 취소는 조용히 무시(google: SIGN_IN_CANCELLED, apple: ERR_REQUEST_CANCELED 등)
      if (
        code === statusCodes.SIGN_IN_CANCELLED ||
        code === 'CANCELLED' ||
        code === 'ERR_REQUEST_CANCELED' ||
        code === 'ERR_CANCELED'
      ) {
        return;
      }
      // 이미 다른 계정에 연동된 소셜로 업그레이드 시도 → 백엔드가 409로 거부, 게스트 유지(GROMO-962)
      if (code === 'SOCIAL_ACCOUNT_ALREADY_LINKED') {
        Alert.alert(
          '연동할 수 없어요',
          '이미 다른 계정에 연결된 소셜 계정이에요. 다른 소셜 계정으로 다시 시도해 주세요.',
        );
        return;
      }
      Alert.alert('로그인 실패', e instanceof Error ? e.message : '다시 시도해 주세요.');
    } finally {
      setBusy(null);
    }
  };

  // 연동 해제 — Alert 확인 후 실행. 마지막 수단이면 서버가 409 → 안내 후 목록 유지.
  const confirmUnlink = (provider: Provider, name: string) => {
    Alert.alert(`${name} 연동 해제`, `${name} 연동을 해제할까요?`, [
      { text: '취소', style: 'cancel' },
      {
        text: '해제',
        style: 'destructive',
        onPress: async () => {
          try {
            await unlinkSocialAccount(provider);
            await loadLinks();
          } catch (e) {
            const status = axios.isAxiosError(e) ? e.response?.status : undefined;
            if (status === 409) {
              Alert.alert('해제할 수 없어요', '마지막 로그인 수단은 해제할 수 없어요.');
            } else {
              Alert.alert('오류', '연동 해제에 실패했어요. 잠시 후 다시 시도해 주세요.');
            }
          }
        },
      },
    ]);
  };

  // 로그아웃 — 확인 후 등록된 로그아웃 핸들러 호출.
  const confirmLogout = () => {
    Alert.alert('로그아웃', '로그아웃할까요?', [
      { text: '취소', style: 'cancel' },
      {
        text: '로그아웃',
        style: 'destructive',
        onPress: () => {
          logLogout(); // 세션 해제(setUserId null) 전에 발행 — 유저 귀속 유지
          triggerLogout();
        },
      },
    ]);
  };

  // 회원 탈퇴 실행 — 성공 시 로그아웃까지. 방장(400)이면 안내 후 모달 닫기.
  const handleWithdraw = async () => {
    if (withdrawing) return;
    setWithdrawing(true);
    try {
      await withdraw();
      logWithdrawalConfirmed(); // 탈퇴 API 성공 시에만 — 로그아웃(setUserId null) 전에 발행
      await clearLastAuthProvider(); // GROMO-602: 탈퇴 시에만 마지막 provider 초기화(로그아웃은 유지)
      setWithdrawOpen(false);
      triggerLogout();
    } catch (e) {
      const status = axios.isAxiosError(e) ? e.response?.status : undefined;
      setWithdrawOpen(false);
      if (status === 400) {
        Alert.alert('탈퇴할 수 없어요', '그룹 방장은 위임 후 탈퇴할 수 있어요.');
      } else {
        Alert.alert('오류', '회원 탈퇴에 실패했어요. 잠시 후 다시 시도해 주세요.');
      }
    } finally {
      setWithdrawing(false);
    }
  };

  // 소셜 유저의 연동 목록 → 표시 구성(설정에 없는 provider는 기본 아이콘으로 방어).
  const linkedProviders = (links ?? []).map((l) => {
    const cfg = PROVIDERS.find((p) => p.key === l.provider);
    return (
      cfg ?? {
        key: l.provider as Provider,
        name: l.provider,
        icon: 'link' as IconName,
        iconColor: T.inkSub,
        iconBg: T.sandLight,
      }
    );
  });

  return (
    <SettingsScaffold title="계정 설정" onBack={() => navigation.goBack()}>
      {isGuest ? (
        // 게스트 — 카카오·애플·구글 로그인 버튼으로 계정 전환 유도.
        <>
          <SettingsSection title="소셜 로그인">
            {PROVIDERS.map((p) => (
              <SettingsRow
                key={p.key}
                icon={p.icon}
                iconColor={p.iconColor}
                iconBg={p.iconBg}
                label={`${p.name}로 로그인`}
                value={busy === p.method ? undefined : '연결'}
                valueColor={T.accent}
                right={
                  busy === p.method ? (
                    <ActivityIndicator size="small" color={T.inkSub} />
                  ) : undefined
                }
                onPress={busy ? undefined : () => runLogin(p.method, p.fn)}
              />
            ))}
          </SettingsSection>
          <View style={s.note}>
            <Ionicons name="information-circle-outline" size={16} color={T.accentDeep} />
            <Text style={s.noteText}>
              로그인하면 목표·집중 기록·코인이 계정에 안전하게 저장돼요.
            </Text>
          </View>
        </>
      ) : (
        // 소셜 유저 — 지금 연동된 계정만 표시(다른 소셜 로그인은 감춤) + 로그아웃·회원 탈퇴.
        <>
          <SettingsSection title="소셜 로그인 연동">
            {linkedProviders.length === 0 ? (
              <SettingsRow label="연동된 소셜 계정이 없어요" />
            ) : (
              linkedProviders.map((p) => (
                <SettingsRow
                  key={p.key}
                  icon={p.icon}
                  iconColor={p.iconColor}
                  iconBg={p.iconBg}
                  label={p.name}
                  sub="연동됨"
                  value="관리"
                  valueColor={T.successInk}
                  onPress={() => confirmUnlink(p.key, p.name)}
                />
              ))
            )}
          </SettingsSection>
          <SettingsSection>
            <SettingsRow
              icon="log-out-outline"
              iconColor={T.accentAlt}
              iconBg={T.accentAltBg}
              label="로그아웃"
              danger
              onPress={confirmLogout}
            />
            <SettingsRow
              icon="person-remove-outline"
              iconColor={T.accentAlt}
              iconBg={T.accentAltBg}
              label="회원 탈퇴"
              danger
              onPress={() => setWithdrawOpen(true)}
            />
          </SettingsSection>
        </>
      )}

      {/* 회원 탈퇴 확인 모달 — 반투명 오버레이 + 흰 카드(파괴적 동작 재확인) */}
      <Modal
        visible={withdrawOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setWithdrawOpen(false)}
      >
        <View style={s.overlay}>
          <TouchableOpacity
            style={s.backdrop}
            activeOpacity={1}
            onPress={() => setWithdrawOpen(false)}
          />
          <View style={s.card}>
            <Text style={s.cardTitle}>정말 떠나시겠어요?</Text>
            <Text style={s.cardBody}>
              탈퇴하면 쌓아온 집중 기록·코인·티어가 모두 사라지고 되돌릴 수 없어요.
            </Text>
            <TouchableOpacity
              style={[s.dangerBtn, withdrawing ? s.btnDisabled : null]}
              activeOpacity={0.85}
              disabled={withdrawing}
              onPress={handleWithdraw}
            >
              <Text style={s.dangerBtnText}>탈퇴할게요</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={s.stayBtn}
              activeOpacity={0.7}
              onPress={() => setWithdrawOpen(false)}
            >
              <Text style={s.stayBtnText}>더 머물래요</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SettingsScaffold>
  );
}

const s = StyleSheet.create({
  // 게스트 안내 박스
  note: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: T.space.sm,
    backgroundColor: T.noteBg,
    borderWidth: 1,
    borderColor: T.noteBorder,
    borderRadius: 14,
    paddingVertical: T.space.md,
    paddingHorizontal: T.space.lg,
    marginTop: T.space.lg,
  },
  noteText: { ...T.text.caption, fontWeight: '500', color: T.inkSub, flex: 1, lineHeight: 19 },

  // 모달 — 리그 오버레이와 같던 스크림 값(전용 토큰 없음, 원본 ProfileSheet는 GROMO-940에서 폐기) + 중앙 흰 카드
  overlay: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28 },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: withAlpha(T.night.bottom, 0.5) },
  card: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: T.paperLight,
    borderWidth: 1,
    borderColor: T.paperAlt,
    borderRadius: 20,
    paddingHorizontal: T.space.xxl,
    paddingTop: T.space.xxl,
    paddingBottom: T.space.md,
  },
  cardTitle: { ...T.text.heading, color: T.ink },
  cardBody: { ...T.text.body, color: T.inkSub, marginTop: T.space.md },
  dangerBtn: {
    marginTop: T.space.xl,
    backgroundColor: T.accentAlt,
    borderRadius: 14,
    paddingVertical: T.space.lg,
    alignItems: 'center',
  },
  btnDisabled: { opacity: 0.5 },
  dangerBtnText: { ...T.text.subtitle, color: T.white },
  stayBtn: { paddingVertical: T.space.lg, alignItems: 'center' },
  stayBtnText: { ...T.text.label, color: T.inkSub },
});
