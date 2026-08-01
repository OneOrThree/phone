import { useState } from 'react';
import { View, Text, StyleSheet, Alert, Platform } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import StepScaffold from '@/screens/onboarding/components/StepScaffold';
import ScreenTimeGuideOverlay, {
  useGuideDismissal,
} from '@/screens/onboarding/components/ScreenTimeGuideOverlay';
import { T } from '@/constants/theme';
import {
  logOnboardingPermissionRequested,
  logOnboardingPermissionResulted,
} from '@/services/analyticsEvents';
import type { StepProps } from '@/screens/onboarding/types';
import ScreenTimeModule, { type SystemColorScheme } from '@/services/ScreenTimeModule';
import { registerUsageBucketMonitoring } from '@/services/screentimeSync';

// 09 · 스크린타임 권한 — Apple 스크린타임 권한 요청. 결과를 screenTimeGranted 에 저장.
// 요청 직전 권한창 리허설 오버레이(GROMO-934) — 승인 버튼이 왼쪽('계속')임을 안내한 뒤,
//   복제본의 '계속' 탭이 실제 requestAuthorization을 이어간다.
// 권한 허용 직후 측정 대상(앱) picker를 띄워 selection을 활성으로 저장(최초 설정 → 즉시 승격).
//   → 이 selection이 홈 '핸드폰 사용' 표시와 목표 판정(threshold)의 기준이 된다.
//   → 폰 전체 사용시간을 보려면 picker에서 '전체 선택' 권장. 선택 없으면 전체 앱으로 fallback.
// 거부 시 시안상 09a(제한 상태)·09b(수동 입력)로 분기(OnboardingFlow가 삽입).
// iOS 시스템 권한 시트·picker 시트는 OS/네이티브가 띄움(여기선 안 그림).

const PERKS = ['앱별 사용 시간', '카테고리별 분류', '기기에서만 처리 · 서버 미전송'];

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
      Alert.alert('권한 요청 실패', e instanceof Error ? e.message : String(e));
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
      Alert.alert('권한 요청 실패', e instanceof Error ? e.message : String(e));
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

  // 측정 대상 앱/카테고리 선택 → 최초 설정이라 즉시 활성(selection) 승격.
  // 취소(null)하면 미설정으로 진행 — 홈 사용시간 표시가 제한될 수 있음(추후 설정에서 가능).
  async function pickTargets() {
    try {
      const counts = await ScreenTimeModule.presentAppPicker();
      if (counts) {
        await ScreenTimeModule.promoteSelection();
        // threshold 이벤트는 등록 시점 selection 토큰으로 고정 — 선택 확정 직후
        // 15분 버킷 모니터링을 등록해야 사용량 측정·서버 동기화가 시작된다(GROMO-633).
        // 목표 달성 판정은 이 버킷 사용시간으로 한다(GROMO-942, 별도 목표 모니터 없음).
        // 로그인 전이라 소유 계정 미상(null) — Syncer 첫 실행이 현재 계정으로 귀속시킨다.
        await registerUsageBucketMonitoring(null);
        update({ screenTimeSelectionConfigured: true });
      }
    } catch {
      // picker 미지원 환경(시뮬레이터 등)은 조용히 무시 — 온보딩은 계속 진행.
    }
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
        title={'사용 시간을\n정확히 보려면'}
        subtitle="Apple 스크린타임 권한이 필요해요. 이 데이터로 통계를 계산해요."
        ctaLabel={requesting ? '요청 중…' : '권한 허용하기'}
        ctaDisabled={requesting}
        onCta={allow}
        secondaryLabel="나중에 할게요"
        onSecondary={later}
      >
        <View style={s.card}>
          {PERKS.map((p, i) => (
            <View key={p} style={[s.row, i < PERKS.length - 1 ? s.rowDivider : null]}>
              <View style={s.dot} />
              <Text style={s.rowText}>{p}</Text>
            </View>
          ))}
        </View>
      </StepScaffold>
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
