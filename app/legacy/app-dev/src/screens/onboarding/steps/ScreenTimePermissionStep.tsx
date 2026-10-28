import { useState } from 'react';
import { View, Text, StyleSheet, Alert, Platform } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import StepScaffold from '@/screens/onboarding/components/StepScaffold';
import ScreenTimeGuideOverlay, {
  useGuideDismissal,
} from '@/screens/onboarding/components/ScreenTimeGuideOverlay';
import { T } from '@/constants/theme';
import { t } from '@/i18n';
import {
  logOnboardingPermissionRequested,
  logOnboardingPermissionResulted,
} from '@/services/analyticsEvents';
import type { StepProps } from '@/screens/onboarding/types';
import ScreenTimeModule, { type SystemColorScheme } from '@/services/ScreenTimeModule';
import { pickMeasuredTargets } from '@/screens/onboarding/pickMeasuredTargets';

// 09 · 스크린타임 권한 — Apple 스크린타임 권한 요청. 결과를 screenTimeGranted 에 저장.
// 요청 직전 권한창 리허설 오버레이(GROMO-934) — 승인 버튼이 왼쪽('계속')임을 안내한 뒤,
//   복제본의 '계속' 탭이 실제 requestAuthorization을 이어간다.
// 권한 허용 직후 측정 대상(앱) picker를 띄워 selection을 활성으로 저장(최초 설정 → 즉시 승격).
//   → 이 selection이 홈 '핸드폰 사용' 표시와 목표 판정(threshold)의 기준이 된다.
//   → 폰 전체 사용시간을 보려면 picker에서 '전체 선택' 권장. 선택 없으면 전체 앱으로 fallback.
// 거부 시 시안상 09a(제한 상태)·09b(수동 입력)로 분기(OnboardingFlow가 삽입).
// iOS 시스템 권한 시트·picker 시트는 OS/네이티브가 띄움(여기선 안 그림).
//
// 안드로이드(GROMO-994): Usage Access는 시스템 팝업이 없는 특수 권한 — CTA가 설정 화면을
// 열고, 앱 복귀 시 네이티브가 허용 여부를 재확인해 requestAuthorization이 resolve된다.
// 측정 대상 picker는 M2 전이라 없음 — 전체 앱 측정이 기본이다.

// 안드로이드 고지 정확성(코드리뷰 반영) — 앱별 상세 기록은 기기에만 저장되지만, 하루 사용시간
// 합계는 통계·목표 판정을 위해 서버로 전송된다(screentimeSync). '서버 미전송'은 허위 고지라
// 실제 동작 그대로 알린다.
// 모듈 최상위라 t() 대신 키만 담는다 — 렌더에서 t(key)로 그린다.
const PERK_KEYS =
  Platform.OS === 'android'
    ? [
        'onboarding.screenTimePermission.perkAndroidMeasure',
        'onboarding.screenTimePermission.perkAndroidCompare',
        'onboarding.screenTimePermission.perkAndroidPrivacy',
      ]
    : [
        'onboarding.screenTimePermission.perkIosPerApp',
        'onboarding.screenTimePermission.perkIosCategory',
        'onboarding.screenTimePermission.perkIosPrivacy',
      ];

function ClockIcon() {
  return (
    <View style={s.iconBox}>
      <Svg width={30} height={30} viewBox="0 0 24 24">
        <Circle cx={12} cy={12} r={9} fill="none" stroke={T.accentDeep} strokeWidth={2} />
        <Path
          d="M12 7 V12 L15.5 14"
          stroke={T.accentDeep}
          strokeWidth={2}
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </Svg>
    </View>
  );
}

export default function ScreenTimePermissionStep({ update, onNext }: StepProps) {
  // 연타 방지 — FamilyControls 권한 요청은 시스템 전역 동시 1건 제한이라, 요청 중 재탭 시
  // "one application at a time" 에러 알림이 피커 뒤에 잔존한다(GROMO-909). 설정 화면과 동일 가드.
  const [requesting, setRequesting] = useState(false);
  // 권한창 리허설 오버레이(GROMO-934) — CTA 탭 시 표시, 복제본 '계속'이 실제 요청을 이어간다.
  const [guideVisible, setGuideVisible] = useState(false);
  const [scheme, setScheme] = useState<SystemColorScheme>('dark');
  // 모달 해제 '완료'를 기다렸다가 picker를 띄우기 위한 훅(코드리뷰 P1 — 해제 중 present 유실 방지).
  const { onDismissed, hideAndWait } = useGuideDismissal(setGuideVisible);

  // CTA — 이미 승인이면 재요청 창이 안 뜨므로 안내 없이 통과, 미승인이면 오버레이부터.
  async function allow() {
    if (requesting) return;
    setRequesting(true);
    try {
      if (Platform.OS === 'android') {
        // Usage Access 설정으로 딥링크 → 복귀 시 재확인 결과가 resolve된다(GROMO-994).
        // denied여도 설정을 다시 열 수 있어 iOS의 '재요청 불가' 알럿 분기가 필요 없다.
        logOnboardingPermissionRequested();
        const granted = await ScreenTimeModule.requestAuthorization();
        logOnboardingPermissionResulted({ granted });
        update({ screenTimeGranted: granted });
        // ⚠️ 이게 안드로이드 신규 사용자의 **가장 흔한 경로**다(코드리뷰 반영). 여기서
        //    등록을 안 부르면 ScreenTimeSyncer 가 마운트될 때까지 측정이 시작되지 않고,
        //    온보딩 도중 이탈하면 아예 시작되지 않는다. 측정 대상은 안 고르지만(D4)
        //    등록은 반드시 한다 — 그 둘을 헷갈려서 생긴 버그였다.
        if (granted) await pickTargets();
        onNext();
        return;
      }
      const status = await ScreenTimeModule.getAuthorizationStatus();
      if (status === 'approved') {
        // approved면 재요청 창 안 뜸(그대로 통과).
        logOnboardingPermissionRequested();
        logOnboardingPermissionResulted({ granted: true });
        update({ screenTimeGranted: true });
        await pickTargets();
        onNext();
        return;
      }
      if (Platform.OS !== 'ios') {
        // 시스템 권한창이 없는 환경 — 안내 없이 바로 요청(항상 거부 반환) 경로.
        await requestAndProceed(false);
        return;
      }
      // notDetermined/denied → 실제 권한창이 뜬다(denied여도 재호출로 시트가 다시 뜸, GROMO-971).
      // 복제본 외형을 실제 창과 맞추기 위해 기기 다크모드 설정을 읽고 오버레이 표시.
      setScheme(await ScreenTimeModule.getSystemColorScheme());
      setGuideVisible(true);
    } catch (e) {
      // 조용히 삼키지 않고 노출 (엔타이틀먼트/프로파일 문제 진단용).
      Alert.alert(
        t('onboarding.screenTimePermission.requestFailTitle'),
        e instanceof Error ? e.message : String(e),
      );
    } finally {
      setRequesting(false);
    }
  }

  // 오버레이 '계속' 탭 — 실제 권한 요청. 연타 방지 가드(GROMO-909)는 여기도 동일 적용.
  async function confirmGuide() {
    if (requesting) return;
    setRequesting(true);
    try {
      await requestAndProceed(true);
    } catch (e) {
      setGuideVisible(false);
      Alert.alert(
        t('onboarding.screenTimePermission.requestFailTitle'),
        e instanceof Error ? e.message : String(e),
      );
    } finally {
      setRequesting(false);
    }
  }

  // 실제 권한 요청 + 결과 처리 — 요청 중엔 오버레이가 딤만 남겨 시스템 창 뒤 배경을 유지한다.
  async function requestAndProceed(guideShown: boolean) {
    logOnboardingPermissionRequested();
    const granted = await ScreenTimeModule.requestAuthorization();
    logOnboardingPermissionResulted({ granted });
    update({ screenTimeGranted: granted });
    if (!granted) {
      setGuideVisible(false);
      onNext(); // 거부 → OnboardingFlow가 09a(제한)/09b(수동입력) 삽입
      return;
    }
    // 권한 허용 → 측정 대상(앱) 선택 picker. 가이드 모달이 완전히 내려간 뒤에 띄운다 —
    // 해제 중인 모달 위에서 present하면 picker가 같이 내려가거나 안 뜰 수 있다(코드리뷰 P1).
    if (guideShown) await hideAndWait();
    await pickTargets();
    onNext();
  }

  // 측정 대상 확정 + 측정 시작. 플랫폼 차이는 pickMeasuredTargets 안에 있다 —
  // 안드로이드는 시스템 피커가 없고 '미설정 = 전체 앱 측정'이라 등록만 하면 된다(코드리뷰 반영).
  async function pickTargets() {
    if (await pickMeasuredTargets()) update({ screenTimeSelectionConfigured: true });
  }
  function later() {
    update({ screenTimeGranted: false });
    onNext();
  }

  return (
    <>
      <StepScaffold
        testID="onboarding.step.screentime"
        // Maestro E2E — 권한 요청 CTA는 대본이 개별 식별해야 해서 공통 onboarding.cta 대신 전용 ID
        ctaTestID="onboarding.screentime.allow"
        header={<ClockIcon />}
        title={t('onboarding.screenTimePermission.title')}
        subtitle={t(
          Platform.OS === 'android'
            ? 'onboarding.screenTimePermission.subtitleAndroid'
            : 'onboarding.screenTimePermission.subtitleIos',
        )}
        ctaLabel={
          requesting
            ? t('onboarding.screenTimePermission.requesting')
            : t(
                Platform.OS === 'android'
                  ? 'onboarding.screenTimePermission.ctaAndroid'
                  : 'onboarding.screenTimePermission.ctaIos',
              )
        }
        ctaDisabled={requesting}
        onCta={allow}
        secondaryLabel={t('onboarding.screenTimePermission.later')}
        onSecondary={later}
      >
        <View style={s.card}>
          {PERK_KEYS.map((key, i) => (
            <View key={key} style={[s.row, i < PERK_KEYS.length - 1 ? s.rowDivider : null]}>
              <View style={s.dot} />
              <Text style={s.rowText}>{t(key)}</Text>
            </View>
          ))}
        </View>
      </StepScaffold>
      {/* iOS 전용 권한창 리허설(GROMO-934) — 안드로이드는 시스템 팝업이 없어 guideVisible이 켜지지 않는다. */}
      <ScreenTimeGuideOverlay
        visible={guideVisible}
        scheme={scheme}
        requesting={requesting}
        onConfirm={confirmGuide}
        onDismissed={onDismissed}
      />
    </>
  );
}

const s = StyleSheet.create({
  iconBox: {
    width: 62,
    height: 62,
    borderRadius: 18,
    backgroundColor: T.sand,
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: {
    backgroundColor: T.white,
    borderWidth: 1,
    borderColor: T.border,
    borderRadius: 16,
    paddingHorizontal: T.space.lg,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: T.space.md, paddingVertical: T.space.md },
  rowDivider: { borderBottomWidth: 1, borderBottomColor: T.divider },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: T.green },
  rowText: { ...T.text.label, fontWeight: '500', color: T.ink },
});
