import { ReportSheet } from '@/components/ReportSheet';
import { PRIVACY_URL, TERMS_URL, openPolicy } from '@/constants/legal';
import { Btn, Field, Pic, Toggle, Txt } from '@/design-system/patterns';
import { semanticTokens } from '@/design-system/tokens';
import {
  errorTextOr,
  type LocalePref,
  LOCALE_KEY,
  LOCALE_NAMES,
  applyLocalePref,
  getLocale,
  isDeviceLocaleSupported,
  resolveLocale,
  t,
} from '@/i18n';
import type { ScreenProps } from '@/navigation/ScreenEnvironment';
import appManifest from '@/screens/../../package.json';
import { IslandSheet, SheetGroup, SheetRow, sheetInput, st } from '@/screens/island/IslandSheet';
import { updateProfile, withdrawAccount } from '@/services/api/account';
import { ApiError, uuid } from '@/services/api/client';
import { REPORT_EMAIL_RECIPIENT, openFeedback } from '@/services/api/safety';
import { getSession, sessionGeneration } from '@/services/api/session';
import { isHost, mainIsland } from '@/services/model';
import { type PushPermission, pushPermissionStatus, requestPushPermission } from '@/services/push';
import { isScreenTimeAvailable } from '@/services/screenTime';
import { appleAuthorizationCode, isSocialLoginCancellation } from '@/services/socialLogin';
import {
  beginWithdrawal,
  confirmWithdrawal,
  needsAppleAuthorizationCode,
} from '@/services/withdrawalIntent';
import { stripNicknameWhitespace } from '@/utils/nickname';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Application from 'expo-application';
import { useEffect, useRef, useState } from 'react';
import { AppState, Linking, Platform } from 'react-native';
import { AvatarGrid } from '../island/navigation/screenParts';
import type { ScreenContext } from '../island/navigation/useScreenState';

// 언어 화면 pick() 의 겹침 탭 가드 — route 분기 안이라 useRef 를 못 써(조건부 훅 금지) 모듈 플래그로 둔다.
let pickingLocale = false;

// 설정 「알림」 토글(GROMO-2526). «실제로 받는지»를 보인다 — 시스템 권한이 허용일 때만 켜진 것으로 그리고, 아직 안 물음·거부는
// 앱 설정이 켜져 있어도(기본값이 켜짐이다) 꺼진 것으로 그린다. 켜진 채로 두면 첫 누름이 앱 설정만 끄고 팝업·시스템 설정은 두 번째
// 누름에야 간다. 시트가 열릴 때와 앱이 활성으로 돌아올 때(시스템 설정에서 돌아온 때) 권한을 다시 읽는다. 푸시 브리지가 없는
// 바이너리(Android·옛 iOS·웹)는 'unavailable' 이라 앱 설정 그대로다. 읽지 못한 경우('error')도 앱 설정(사용자의 뜻)을 그대로
// 보이되 「확인하지 못했어요」 를 붙여 확인된 것처럼 보이지 않게 한다 — 꺼진 것으로 그리면 앱에서 끌 수 없다.
function NotificationToggle({ e }: ScreenProps) {
  // null = 아직 안 읽음
  const [permission, setPermission] = useState<PushPermission | null>(null);
  // 권한 읽기·요청마다 번호를 매긴다(시작할 때 올린다) — 더 새 것이 시작된 뒤 늦게 끝난 옛 결과가 표시를 덮지 못하게, 가장 새 것의
  // 결과만 표시를 정한다.
  const readSeq = useRef(0);
  useEffect(() => {
    let active = true;
    const read = () => {
      const seq = ++readSeq.current;
      void pushPermissionStatus().then((next) => {
        if (active && seq === readSeq.current) setPermission(next);
      });
    };
    read();
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') read();
    });
    return () => {
      active = false;
      subscription.remove();
    };
  }, []);
  const change = async (value: boolean) => {
    // 아직 안 물음·거부 때문에 꺼져 보이던 토글을 누르면 앱 설정은 이미 그 값이다 — 다시 쓰지 않는다.
    if (value !== e.state.settings.notifications)
      e.dispatch({ type: 'SETTING', key: 'notifications', value });
    if (!value) return;
    // 켤 때 시스템 권한도 맞춘다 — 아직 안 물음이면 시스템 팝업, 거부면 시스템 설정(앱에서는 다시 켤 수 없다).
    const readStart = ++readSeq.current;
    const current = await pushPermissionStatus();
    // 다시 읽은 값을 바로 보인다 — 읽지 못했던('error') 권한이 읽히는 경우.
    if (readStart === readSeq.current) setPermission(current);
    if (current === 'undetermined') {
      const requestStart = ++readSeq.current;
      const answered = await requestPushPermission();
      if (requestStart === readSeq.current) setPermission(answered);
    } else if (current === 'denied')
      await Linking.openSettings().catch(() =>
        e.notify(t('settings.permissions.errors.settingsOpen')),
      );
  };
  // 읽기 전에는 iOS 만 꺼진 것으로 그린다(푸시 브리지가 iOS 에만 있어 허용인지 아직 모른다) — 켜진 것으로 그렸다 꺼지는 깜빡임이 없다.
  // 읽은 뒤에는 허용·브리지 없음('unavailable')·확인 못 함('error')이 앱 설정을 따른다. 아직 안 물음·거부는 꺼진 것으로 그린다.
  const receiving =
    permission === null
      ? Platform.OS !== 'ios'
      : permission === 'granted' || permission === 'unavailable' || permission === 'error';
  // 꺼진 채 보이는 까닭이 권한이면 누르는 일이 스위치를 넘기는 것만이 아니다 — 팝업이 뜨거나 설정 앱이 열린다(힌트). 확인 못 함(error)의
  // 「확인하지 못했어요」 는 스위치와 따로 읽히는 sub 라서, 스위치 이름에도 붙여 상태가 스위치에 닿게 한다.
  const hint =
    permission === 'undetermined'
      ? t('settings.permissions.notifications.hint.ask')
      : permission === 'denied'
        ? t('settings.permissions.notifications.hint.openSettings')
        : undefined;
  const unconfirmed =
    permission === 'error' ? t('settings.permissions.notifications.error') : undefined;
  const label = unconfirmed
    ? `${t('settings.notifications')}, ${unconfirmed}`
    : t('settings.notifications');
  return (
    <SheetRow
      title={t('settings.notifications')}
      sub={unconfirmed}
      tail={
        <Toggle
          label={label}
          accessibilityHint={hint}
          value={!!e.state.settings.notifications && receiving}
          onChange={change}
        />
      }
    />
  );
}
export function renderSettingsScreens(context: ScreenContext) {
  const {
    route,
    state,
    profileName,
    setProfileNameError,
    notify,
    server,
    act,
    profileColor,
    back,
    profileSaveIntent,
    profileErrorScope,
    run,
    routeNowRef,
    accountBg,
    home,
    serverBusy,
    setProfileColor,
    setProfileName,
    profileNameError,
    confirm,
    e,
    reset,
    withdrawCleanupPending,
    finishWithdrawal,
    withdrawIntent,
    snap,
    island,
    go,
  } = context;

  // 메인 섬 줄은 내 정보 안에 있다(GROMO-2885)
  const primaryIslandName = server
    ? (snap?.memberships.find((m) => m.id === state.mainIslandId)?.name ??
      snap?.memberships.find((m) => m.id === snap.currentIslandId)?.name ??
      t('account.boat.myIslandFallback'))
    : (mainIsland(state)?.name ?? island.name);
  const islandCount = server
    ? (snap?.memberships.length ?? 0)
    : state.islands.filter((candidate) => candidate.joined && !candidate.closed).length;
  const canChangeMainIsland = islandCount > 1;

  if (route === 'profile') {
    // 「저장」은 시트 머리 글자가 아니라 아래 버튼 줄의 가득 폭 Btn 이다(GROMO-2473). 처리 중에는 입력과 같이 막는다.
    const saveProfile = () => {
      const name = profileName;
      setProfileNameError('');
      if (!name) {
        notify(t('account.profile.nicknameRequired'));
        return;
      }
      if (!server) {
        act('PROFILE', { name, color: profileColor });
        notify(t('account.profile.saved'));
        back();
        return;
      }
      const signature = JSON.stringify([name, profileColor]);
      if (profileSaveIntent.current?.signature !== signature) {
        profileSaveIntent.current = { signature, key: uuid() };
      }
      const intent = profileSaveIntent.current;
      const errorScope = profileErrorScope.current;
      const gen = sessionGeneration();
      run(
        () =>
          updateProfile({ name, catColor: profileColor }, intent.key)
            .then((saved) => {
              if (profileSaveIntent.current?.key === intent.key) profileSaveIntent.current = null;
              act('PROFILE', {
                name: saved.name ?? name,
                color: saved.catColor ?? profileColor,
              });
              notify(t('account.profile.saved'));
              back();
            })
            .catch((thrown) => {
              if (thrown instanceof ApiError && thrown.code === 'NICKNAME_INVALID') {
                if (
                  profileErrorScope.current === errorScope &&
                  routeNowRef.current === 'profile' &&
                  sessionGeneration() === gen
                )
                  setProfileNameError(errorTextOr(thrown, 'errors.NICKNAME_INVALID'));
                return;
              }
              throw thrown;
            }),
        notify,
      );
    };
    return (
      <IslandSheet
        bg={accountBg}
        sign={'avatar/' + profileColor}
        signKind="av"
        title={t('account.profile.title')}
        tall
        onBack={back}
        onClose={home}
        footer={<Btn title={t('common.save')} onPress={saveProfile} disabled={serverBusy} />}
      >
        <AvatarGrid
          mini
          value={profileColor}
          onChange={serverBusy ? () => {} : setProfileColor}
          disabled={serverBusy}
        />
        <Field
          label={t('account.profile.nickname')}
          placeholder={t('account.profile.nicknamePlaceholder')}
          value={profileName}
          onChange={(value: string) => {
            if (serverBusy) return;
            setProfileName(stripNicknameWhitespace(value));
            setProfileNameError('');
          }}
          disabled={serverBusy}
          inputStyle={sheetInput}
        />
        {!!profileNameError && (
          <Txt kind="meta" accessibilityRole="alert" style={{ color: semanticTokens.color.danger }}>
            {profileNameError}
          </Txt>
        )}
        {/* 소속 섬이 없으면(바다 표류에서 연 설정, GROMO-2404) 메인 섬 줄을 두지 않는다 */}
        {islandCount > 0 && (
          <SheetGroup>
            <SheetRow
              title={t('account.profile.mainIsland')}
              sub={primaryIslandName}
              chevron={canChangeMainIsland}
              disabled={serverBusy}
              onPress={canChangeMainIsland ? () => go('mainIsland') : undefined}
            />
          </SheetGroup>
        )}
      </IslandSheet>
    );
  }

  if (route === 'settings') {
    const providerLabels: Record<string, string> = {
      google: t('account.profile.providers.google'),
      kakao: t('account.profile.providers.kakao'),
      line: t('account.profile.providers.line'),
      apple: t('account.profile.providers.apple'),
    };
    const linkedProviderText = (state.linkedProviders ?? [])
      .map((provider: string) => providerLabels[provider] ?? provider)
      .filter(Boolean)
      .join(' · ');
    const mustTransferHost = state.islands.some(
      (candidate) => isHost(candidate) && candidate.members.length > 0,
    );
    const toggle = (label: string, key: string, sub?: string) => (
      <SheetRow
        title={label}
        sub={sub}
        tail={
          <Toggle
            label={label}
            // 화면용 합친 값이 아니라 저장값을 보인다 — OS 모션 줄이기가 켜져 있어도 앱 설정을 바꿀 수 있다(GROMO-2159)
            value={((e.savedSettings ?? state.settings) as any)[key]}
            onChange={(value: boolean) => act('SETTING', { key, value })}
          />
        }
      />
    );
    const sec = (name: string) => (
      <Txt kind="section" style={st.sec}>
        {name}
      </Txt>
    );
    const pref: LocalePref = e.localePref;
    const accountSub = linkedProviderText
      ? t('account.profile.signedInWith', { providers: linkedProviderText })
      : t('account.profile.noLinkedAccount');
    // 기록 공개 토글은 없다(도서관 기록은 전체 공개 고정)
    return (
      <IslandSheet
        bg={accountBg}
        sign="boat/raft"
        title={t('account.boat.settingsTitle')}
        tall
        tight
        onBack={back}
        onClose={home}
      >
        {/* 첫 줄은 닉네임과 로그인 방식이다. 누르면 내 정보(GROMO-2885) */}
        <SheetGroup>
          <SheetRow
            title={state.name || t('account.profile.title')}
            sub={accountSub}
            // 닉네임만으로는 무엇을 여는 줄인지 안 읽힌다 — 이름이 있으면 「내 정보」를 앞에 붙인다
            label={
              state.name ? `${t('account.profile.title')}, ${state.name}, ${accountSub}` : undefined
            }
            lead={<Pic id={'avatar/' + state.color} w={28} />}
            chevron
            onPress={() => go('profile')}
          />
        </SheetGroup>
        {sec(t('settings.generalSection'))}
        <SheetGroup flat>
          <NotificationToggle e={e} />
          {toggle(t('settings.sound'), 'sound')}
          {toggle(t('settings.haptics'), 'haptics')}
          {toggle(t('settings.reduceMotion'), 'reduceMotion')}
          <SheetRow
            title={t('settings.language.title')}
            sub={pref === 'system' ? t('settings.language.system') : LOCALE_NAMES[pref]}
            chevron
            onPress={() => go('language', 'settings')}
          />
          <SheetRow
            title={t('settings.permissionManage')}
            sub={
              isScreenTimeAvailable
                ? t(
                    state.settings.permission
                      ? 'settings.permissions.connected'
                      : 'settings.permissions.needed',
                  )
                : undefined
            }
            chevron
            onPress={() => go('permission', 'settings')}
          />
        </SheetGroup>
        {sec(t('settings.newsHelpSection'))}
        <SheetGroup flat>
          <SheetRow
            title={t('developerNotices.title')}
            chevron
            onPress={() => go('developerNotices')}
          />
          <SheetRow
            title={t('settings.feedback.title')}
            sub={t('settings.feedback.sub')}
            chevron
            onPress={() => {
              openFeedback(Application.nativeApplicationVersion ?? appManifest.version).catch(() =>
                confirm(
                  t('settings.feedback.title'),
                  t('settings.feedback.openFailed', { email: REPORT_EMAIL_RECIPIENT }),
                  () => {},
                ),
              );
            }}
          />
          <ReportCenterRow />
          {/* 목업에는 차단 API 가 없다 */}
          {server && (
            <SheetRow
              title={t('account.blocked.title')}
              chevron
              onPress={() => go('blockedUsers')}
            />
          )}
        </SheetGroup>
        {sec(t('settings.termsAccountSection'))}
        <SheetGroup flat>
          <SheetRow
            title={t('login.policy.terms')}
            chevron
            label={t('login.policy.viewOriginalA11y', { title: t('login.policy.terms') })}
            onPress={() => openPolicy(TERMS_URL)}
          />
          <SheetRow
            title={t('login.policy.privacy')}
            chevron
            label={t('login.policy.viewOriginalA11y', { title: t('login.policy.privacy') })}
            onPress={() => openPolicy(PRIVACY_URL)}
          />
          <SheetRow
            title={t('account.profile.logout')}
            onPress={() =>
              confirm(
                t('account.profile.logoutConfirmTitle'),
                t('account.profile.logoutConfirmBody'),
                async () => {
                  // 기기에 로그아웃을 기록하지 못했으면 세션이 남아 있으니 로그인 화면으로 가지 않는다.
                  if ((await e.signOut()) === false) return;
                  act('LOGOUT');
                  reset('login');
                },
              )
            }
          />
        </SheetGroup>
        {withdrawCleanupPending ? (
          <Btn
            title={t('account.profile.retryDeviceCleanup')}
            kind="danger"
            style={{ alignSelf: 'center' }}
            // 계정은 이미 삭제됐다 — 탈퇴 API 없이 로컬 정리만 다시 한다.
            onPress={() => run(finishWithdrawal, notify)}
          />
        ) : (
          <Btn
            title={t('account.profile.withdraw')}
            kind="danger"
            style={{ alignSelf: 'center' }}
            onPress={() =>
              mustTransferHost
                ? notify(t('account.profile.mustTransferHost'))
                : confirm(
                    t('account.profile.withdrawConfirmTitle'),
                    t('account.profile.withdrawConfirmBody'),
                    () => {
                      if (!server) {
                        run(finishWithdrawal, notify);
                        return;
                      }
                      run(async () => {
                        // 호출 전에 대상 계정과 멱등 키를 기기에 남긴다(기록 실패면 요청하지 않는다).
                        // 같은 계정의 재시도면 저장된 키를 재사용해 서버가 첫 결과를 재생한다.
                        const userId = getSession()?.userId ?? null;
                        // Apple 로그인 계정은 탈퇴 직전에 재인증해 일회용 코드를 받는다(App Store 5.1.1(v) —
                        // 서버가 탈퇴 뒤 Apple 토큰을 폐기). 코드는 한 번만 쓰이고 수명이 짧아 시도마다 새로
                        // 받는다. 의도 기록 전에 받으므로 취소·실패해도 기기엔 아무것도 남지 않는다.
                        let appleCode: string | undefined;
                        if (
                          needsAppleAuthorizationCode(
                            Platform.OS,
                            getSession()?.provider,
                            state.linkedProviders,
                          )
                        ) {
                          try {
                            appleCode = await appleAuthorizationCode();
                          } catch (thrown) {
                            // 시트를 닫은 것은 조용히 중단한다. 그 밖의 실패는 run 의 일반 오류 문구로 간다.
                            if (isSocialLoginCancellation(thrown)) return;
                            throw thrown;
                          }
                        }
                        withdrawIntent.current = userId
                          ? await beginWithdrawal(userId)
                          : { userId: '', key: uuid() };
                        try {
                          await withdrawAccount(withdrawIntent.current.key, appleCode);
                        } catch (thrown) {
                          // 서버가 DELETE /me 를 커밋했는데 응답만 잃었으면 재시도는 404
                          // USER_NOT_FOUND 다 — 계정은 이미 없으니 탈퇴 완료로 보고 로컬 정리를 이어 간다.
                          // 공용 클라이언트도 이 404 를 세션 거절로 처리해 세션을 비우고 로그인으로
                          // 보낼 수 있다. 두 경로가 겹쳐도 계정이 없다는 같은 전제라 정리는 그대로 맞다.
                          if (!(
                            thrown instanceof ApiError &&
                            thrown.status === 404 &&
                            thrown.code === 'USER_NOT_FOUND'
                          ))
                            throw thrown;
                        }
                        // 서버 탈퇴가 확정됐다 — 이후 정리가 실패하고 세션이 먼저 폐기돼도 다음 부팅이
                        // 세션 없이 정리를 재개하도록 기기에 남긴다.
                        await confirmWithdrawal(withdrawIntent.current);
                        await finishWithdrawal();
                      }, notify);
                    },
                    { ok: t('account.profile.withdrawConfirmOk'), destructive: true },
                  )
            }
          />
        )}
        <Txt kind="meta" testID="settings-app-version" style={[st.meta, { textAlign: 'center' }]}>
          {t('onboardingStory.brand')} {Application.nativeApplicationVersion ?? appManifest.version}
        </Txt>
      </IslandSheet>
    );
  }

  if (route === 'language') {
    const pref: LocalePref = e.localePref;
    // 탭 즉시 저장·적용 — 저장 버튼은 없다
    const pick = async (next: LocalePref) => {
      if (next === pref) return; // 같은 값이면 저장·재렌더·토스트 전부 생략
      if (pickingLocale) return; // 겹침 탭 — 앞선 저장이 끝날 때까지 무시
      pickingLocale = true;
      try {
        await AsyncStorage.setItem(LOCALE_KEY, next);
      } catch {
        notify(t('settings.language.saveFailed')); // 저장 못 하면 적용도 안 한다
        return;
      } finally {
        pickingLocale = false;
      }
      const before = getLocale();
      e.setLocalePref(applyLocalePref(next));
      if (getLocale() !== before) notify(t('settings.language.changed')); // 실제로 언어가 바뀔 때만
    };
    return (
      <IslandSheet
        bg={accountBg}
        sign="boat/raft"
        title={t('settings.language.title')}
        tall
        tight
        onBack={back}
        onClose={home}
      >
        <SheetGroup flat>
          <SheetRow
            title={t('settings.language.system')}
            sub={t(
              isDeviceLocaleSupported()
                ? 'settings.language.systemNow'
                : 'settings.language.systemNowFallback',
              { name: LOCALE_NAMES[resolveLocale()] },
            )}
            selected={pref === 'system'}
            onPress={() => {
              pick('system');
            }}
          />
          <SheetRow
            title={LOCALE_NAMES.ko}
            selected={pref === 'ko'}
            onPress={() => {
              pick('ko');
            }}
            divider
          />
          <SheetRow
            title={LOCALE_NAMES.en}
            selected={pref === 'en'}
            onPress={() => {
              pick('en');
            }}
            divider
          />
        </SheetGroup>
      </IslandSheet>
    );
  }
}

function ReportCenterRow({ divider }: { divider?: boolean }) {
  const [visible, setVisible] = useState(false);
  return (
    <>
      <SheetRow
        divider={divider}
        title={t('settings.report.title')}
        sub={t('report.centerSub')}
        chevron
        onPress={() => setVisible(true)}
      />
      {visible ? <ReportSheet visible onClose={() => setVisible(false)} /> : null}
    </>
  );
}
