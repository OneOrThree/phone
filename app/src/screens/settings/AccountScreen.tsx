import { useCallback, useRef, useState } from 'react';
import { View, Text, StyleSheet, Alert, ActivityIndicator, Platform } from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import axios from 'axios';
import { Ionicons } from '@expo/vector-icons';
import type { V2RootStackParamList } from '@/navigation/types';
import SettingsScaffold from '@/screens/settings/components/SettingsScaffold';
import { SettingsSection, SettingsRow } from '@/screens/settings/components/SettingsList';
import ConfirmCardModal from '@/components/ConfirmCardModal';
import { getSocialLinks, unlinkSocialAccount, withdraw } from '@/services/userApi';
import { getMyGroups, groupErrorCode } from '@/services/groupApi';
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
import type { GroupSummaryResponse } from '@/types/dto/group';
import type { LoginResult } from '@/types/api';
import { T } from '@/constants/theme';

// 계정 설정 화면 — 소셜 로그인/연동 + 로그아웃 + 회원 탈퇴.
// 게스트(useUser().isGuest === true)일 땐 카카오·애플·구글 '로그인' 버튼으로 계정 전환을 유도하되
// 회원 탈퇴는 게스트에게도 노출하고(게스트도 서버 User가 생성됨 — GROMO-963),
// 소셜 로그인 완료 상태일 땐 지금 연동된 계정만 보여주고 다른 소셜 로그인은 감춘다.
// 게스트 판별은 로그인 시점 태깅(isGuest)이 우선이고, 값이 소셜(false)이면 연동 목록으로 최종 확정한다
// (구 세션·정확성 대비). 게스트가 로그인하면 auth.ts가 세션을 저장하고 triggerRelogin으로 재부팅한다.

type Method = Extract<AuthMethod, 'kakao' | 'apple' | 'google'>;
type IconName = keyof typeof Ionicons.glyphMap;

// 노출 소셜 제공자(순서 고정) — key로 서버 provider 문자열과 매칭, fn은 게스트 로그인용.
const ALL_PROVIDERS: {
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

const PROVIDERS = Platform.OS === 'web' ? [] : ALL_PROVIDERS;

// 탈퇴 플로우 카드 모달 상태 머신 — 셋 중 하나만 열린다(동시 노출 불가, GROMO-1210).
//   confirm            : 탈퇴 재확인(파괴적 동작)
//   hostBlocked        : 방장 블록 — 위임 대상 그룹으로 유도
//   hostBlockedNoList  : 방장 블록 — 위임 대상을 못 찾음(목록 0개·조회 실패) → 일반 안내
type WithdrawModalState =
  | { kind: 'confirm' }
  | { kind: 'hostBlocked'; count: number; target: { groupId: string; name: string } }
  | { kind: 'hostBlockedNoList' };

export default function AccountScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<V2RootStackParamList>>();
  const { isGuest: isGuestCtx } = useUser();

  // 연동 목록(로딩 전 null). 재진입마다 최신화.
  const [links, setLinks] = useState<SocialLinkResponse[] | null>(null);
  const [busy, setBusy] = useState<Method | null>(null); // 게스트 로그인 진행 중인 provider
  const [withdrawModal, setWithdrawModal] = useState<WithdrawModalState | null>(null);
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

  // 회원 탈퇴 실행 — 성공 시 로그아웃까지. 방장 블록(HOST_WITHDRAW)이면 카드 모달로 위임 유도.
  const handleWithdraw = async () => {
    if (withdrawing) return;
    setWithdrawing(true);
    try {
      await withdraw();
      logWithdrawalConfirmed(); // 탈퇴 API 성공 시에만 — 로그아웃(setUserId null) 전에 발행
      await clearLastAuthProvider(); // GROMO-602: 탈퇴 시에만 마지막 provider 초기화(로그아웃은 유지)
      setWithdrawModal(null);
      triggerLogout();
    } catch (e) {
      // §3-2: status가 아니라 서버 에러 code로 분기 — 무관한 400은 아래 일반 오류로 떨어진다.
      if (groupErrorCode(e) === 'HOST_WITHDRAW') {
        // A-2: 방장으로 남아 있는 그룹이 있어 탈퇴가 막혔다. 위임이 필요한 그룹으로 유도한다.
        // 1인 소유 그룹은 서버가 탈퇴와 함께 자동 종료하므로 위임 대상이 아니다 — 다중 멤버 소유 그룹만
        // 남는다. 그룹이 여러 개면 하나씩 위임하고 다시 탈퇴를 눌러 반복한다(그룹 수만큼).
        let ownedGroups: GroupSummaryResponse[] = [];
        try {
          ownedGroups = (await getMyGroups()).filter(
            (g) => g.role === 'OWNER' && g.currentMembers > 1,
          );
        } catch {
          // 목록 조회 실패는 아래 일반 안내(hostBlockedNoList)로 떨어뜨린다.
        }
        if (ownedGroups.length > 0) {
          const target = ownedGroups[0];
          setWithdrawModal({
            kind: 'hostBlocked',
            count: ownedGroups.length,
            target: { groupId: target.groupId, name: target.name },
          });
        } else {
          setWithdrawModal({ kind: 'hostBlockedNoList' });
        }
      } else {
        setWithdrawModal(null);
        Alert.alert('오류', '회원 탈퇴에 실패했어요. 잠시 후 다시 시도해 주세요.');
      }
    } finally {
      setWithdrawing(false);
    }
  };

  const closeWithdrawModal = () => setWithdrawModal(null);

  // 카드 모달은 단일 인스턴스로 상태에 따라 내용만 바꾼다 — confirm→블록 안내가 같은 모달의
  // 내용 교체가 되어 iOS의 연속 present/dismiss 경합(뒤 모달이 안 뜨는 문제)이 없다.
  // 닫힘 페이드아웃 동안 내용이 confirm으로 되튀지 않게 마지막 내용을 ref로 유지한다.
  const lastModalRef = useRef<WithdrawModalState>({ kind: 'confirm' });
  if (withdrawModal !== null) lastModalRef.current = withdrawModal;
  const shownModal = withdrawModal ?? lastModalRef.current;

  // 상태별 카드 내용 — 문구는 기존 네이티브 Alert에서 그대로 이식(계약: 카피 정본, GROMO-1210).
  let withdrawCard: {
    title: string;
    body: string;
    primaryLabel: string;
    onPrimary: () => void;
    primaryDisabled?: boolean;
    destructive?: boolean;
    secondaryLabel?: string;
    testID: string;
  };
  switch (shownModal.kind) {
    case 'hostBlocked': {
      const { count, target } = shownModal;
      withdrawCard = {
        title: '먼저 방장을 넘겨주세요',
        body: `방장으로 있는 그룹이 ${count}개 있어요.\n"${target.name}"의 방장을 넘기고 다시 탈퇴해 주세요.`,
        primaryLabel: '방장 넘기러 가기',
        onPrimary: () => {
          setWithdrawModal(null);
          navigation.navigate('GroupOwnerTransfer', { groupId: target.groupId, source: 'account' });
        },
        secondaryLabel: '나중에',
        testID: 'account.withdraw.hostBlocked',
      };
      break;
    }
    case 'hostBlockedNoList':
      withdrawCard = {
        title: '탈퇴할 수 없어요',
        body: '그룹 방장은 위임 후 탈퇴할 수 있어요.',
        primaryLabel: '확인',
        onPrimary: closeWithdrawModal,
        testID: 'account.withdraw.blocked',
      };
      break;
    default:
      withdrawCard = {
        title: '정말 떠나시겠어요?',
        body: '탈퇴하면 쌓아온 집중 기록·티어가 모두 사라지고 되돌릴 수 없어요.',
        primaryLabel: '탈퇴할게요',
        onPrimary: handleWithdraw,
        primaryDisabled: withdrawing,
        destructive: true,
        secondaryLabel: '더 머물래요',
        testID: 'account.withdraw.confirm',
      };
  }

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
        // 게스트 — 카카오·애플·구글 로그인 버튼으로 계정 전환 유도 + 회원 탈퇴(GROMO-963).
        // 게스트도 서버에 실제 User가 생성되므로 계정 삭제 경로가 필요(Apple 심사 요건).
        // 로그아웃은 노출하지 않는다 — 게스트 세션은 로그아웃하면 계정 복구가 불가능해서
        // 사실상 탈퇴와 같으므로, 명시적 파괴 동작인 탈퇴만 제공한다.
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
          {/* 게스트 소실 고지 + 승격 유도 (GROMO-1509) — 종전 문구는 이점만 말하고 위험을 안 알렸다.
              흔한 소실 경로는 90일 미접속이 아니라 앱 삭제·기기 변경이라 그쪽을 앞에 둔다.
              90일은 서버 guest-refresh-expiration(7776000)과 같은 값이니 함께 고쳐야 한다. */}
          <View style={s.note}>
            <Ionicons name="information-circle-outline" size={16} color={T.accentDeep} />
            <Text style={s.noteText}>
              지금은 로그인 없이 쓰는 중이에요. 기록이 이 기기에만 있어서, 앱을 지우거나 기기를
              바꾸면 되돌릴 수 없어요. 90일 넘게 앱을 열지 않아도 사라져요.
              {'\n\n'}
              소셜 로그인을 연결하면 지금까지 기록 그대로 옮겨가요.
            </Text>
          </View>
          <SettingsSection>
            <SettingsRow
              icon="person-remove-outline"
              iconColor={T.accentAlt}
              iconBg={T.accentAltBg}
              label="회원 탈퇴"
              danger
              onPress={() => setWithdrawModal({ kind: 'confirm' })}
            />
          </SettingsSection>
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
              onPress={() => setWithdrawModal({ kind: 'confirm' })}
            />
          </SettingsSection>
        </>
      )}

      {/* 탈퇴 플로우 카드 모달 — 재확인(파괴적)·방장 블록 안내를 한 인스턴스로 전환(GROMO-1210) */}
      <ConfirmCardModal
        visible={withdrawModal !== null}
        onRequestClose={closeWithdrawModal}
        onSecondary={closeWithdrawModal}
        {...withdrawCard}
      />
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
});
