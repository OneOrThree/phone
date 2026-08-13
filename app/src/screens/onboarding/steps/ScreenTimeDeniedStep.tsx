import { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Alert, Linking, AppState, Platform } from 'react-native';
import StepScaffold from '@/screens/onboarding/components/StepScaffold';
import InfoNote, { NoteStrong } from '@/screens/onboarding/components/InfoNote';
import ScreenTimeGuideOverlay, {
  useGuideDismissal,
} from '@/screens/onboarding/components/ScreenTimeGuideOverlay';
import { CharacterImage } from '@/components/character/CharacterImage';
import { T } from '@/constants/theme';
import ScreenTimeModule, { type SystemColorScheme } from '@/services/ScreenTimeModule';
import { registerUsageBucketMonitoring } from '@/services/screentimeSync';
import {
  logOnboardingPermissionRequested,
  logOnboardingPermissionResulted,
  logOnboardingScreentimeViewed,
} from '@/services/analyticsEvents';
import type { StepProps } from '@/screens/onboarding/types';

// W10-1 · 권한 거부 분기 (제한 상태 안내). 권한 없이 계속할 수 있음을 안내.
// "다시 허용하기" → 설정 앱 이동 없이 시스템 권한창을 앱 안에서 재요청(GROMO-971).
//   FamilyControls는 denied 상태여도 requestAuthorization 재호출로 권한 시트가 다시 뜬다(홈 986과 동일).
//   재요청 자체가 실패하는 기기(제한 설정 등)만 설정 앱 이동으로 폴백 — 설정에서 켜고
//   돌아오면(AppState active) 이를 감지해 같은 허용 처리를 태운다.
// 허용되면 측정 앱 picker를 띄우고 screenTimeGranted=true로 전환
//   → 이 스텝이 빠지고 목표 설정 화면으로 자동 전환된다.
// 안드로이드(GROMO-994): 시스템 권한창·리허설 오버레이 없이 requestAuthorization이 Usage Access
//   설정 딥링크 + 복귀 재확인까지 담당한다 — resolve 결과가 허용이면 바로 허용 경로로 전환된다.
export default function ScreenTimeDeniedStep({ update, onNext }: StepProps) {
  // update는 매 렌더 새 함수라 ref로 최신값만 참조(리스너는 1회만 등록).
  const updateRef = useRef(update);
  updateRef.current = update;
  // 설정 앱 폴백으로 벗어났다가 돌아온 경우에만 권한을 재확인하도록 표시.
  const returningFromSettings = useRef(false);
  // 연타 방지 — FamilyControls 권한 요청은 시스템 전역 동시 1건 제한(GROMO-909). 요청 스텝과 동일 가드.
  const [requesting, setRequesting] = useState(false);
  // 권한창 리허설 오버레이(GROMO-934) — 재요청도 실제 창이 뜨므로 요청 스텝과 동일 안내.
  const [guideVisible, setGuideVisible] = useState(false);
  const [scheme, setScheme] = useState<SystemColorScheme>('dark');
  // 모달 해제 '완료'를 기다렸다가 picker를 띄우기 위한 훅(코드리뷰 P1 — 해제 중 present 유실 방지).
  const { onDismissed, hideAndWait } = useGuideDismissal(setGuideVisible);

  // 스크린타임 요약 스텝 노출 계측 — 거부 분기라 데이터 없음(has_data:false). 진입당 1회.
  useEffect(() => {
    logOnboardingScreentimeViewed({ has_data: false });
  }, []);

  // 허용 확정 공통 처리(재요청 승인·설정 폴백 복귀 공용) — 측정 대상(앱) picker → selection 즉시 승격.
  const completeApproved = useCallback(async () => {
    try {
      const counts = await ScreenTimeModule.presentAppPicker();
      if (counts) {
        await ScreenTimeModule.promoteSelection();
        // 선택 확정 직후 15분 버킷 모니터링 등록(GROMO-633) — Syncer는 온보딩 완료 후에만
        // 마운트되므로, 여기서 등록하지 않으면 온보딩 미완주 이탈 시 측정이 시작되지 않는다.
        // 소유 미상(null)으로 등록 — Syncer 첫 실행이 현재 계정으로 귀속시킨다(요청 스텝과 동일).
        await registerUsageBucketMonitoring(null);
        updateRef.current({ screenTimeSelectionConfigured: true });
      }
    } catch {
      // picker 미지원 환경(시뮬레이터 등)은 조용히 무시 — 진행.
    }
    // 허용 경로로 전환(이 스텝이 빠지고 목표 설정으로 자동 교체됨).
    updateRef.current({ screenTimeGranted: true });
  }, []);

  useEffect(() => {
    const sub = AppState.addEventListener('change', async (state) => {
      if (state !== 'active' || !returningFromSettings.current) return;
      returningFromSettings.current = false;
      // 설정에서 권한을 켜고 돌아왔는지 확인.
      const status = await ScreenTimeModule.getAuthorizationStatus();
      if (status !== 'approved') return; // 여전히 미허용 — 이 화면 유지.
      await completeApproved();
    });
    return () => sub.remove();
  }, [completeApproved]);

  const openSettings = () => {
    if (Platform.OS === 'android') {
      // Usage Access 설정 딥링크 — 복귀 시 네이티브가 재확인한 결과로 resolve된다(GROMO-994).
      // 허용이면 이 스텝이 빠지고 목표 설정으로 자동 전환된다. 측정 앱 picker는 M2 전이라 없음.
      ScreenTimeModule.requestAuthorization()
        .then((granted) => {
          if (granted) updateRef.current({ screenTimeGranted: true });
        })
        .catch(() => {});
      return;
    }
    returningFromSettings.current = true;
    Linking.openSettings();
  };

  // '다시 허용하기' — 설정 앱 이동 없이 시스템 권한창 재요청(GROMO-971).
  // 재요청도 실제 창이 뜨므로 리허설 오버레이(GROMO-934)를 먼저 보여준다.
  const retryPermission = async () => {
    if (requesting) return;
    if (Platform.OS !== 'ios') {
      // 시스템 권한창이 없는 환경 — 안내 없이 바로 요청 경로.
      await doRetry(false);
      return;
    }
    setScheme(await ScreenTimeModule.getSystemColorScheme());
    setGuideVisible(true);
  };

  // 오버레이 '계속' 탭 — 실제 재요청. 요청 중엔 오버레이가 딤만 남겨 시스템 창 뒤 배경을 유지.
  const doRetry = async (guideShown: boolean) => {
    if (requesting) return;
    setRequesting(true);
    try {
      logOnboardingPermissionRequested();
      const granted = await ScreenTimeModule.requestAuthorization();
      logOnboardingPermissionResulted({ granted });
      if (granted) {
        // 허용 → picker(completeApproved)는 가이드 모달이 완전히 내려간 뒤에 — 해제 중인
        // 모달 위에서 present하면 picker가 같이 내려가거나 안 뜰 수 있다(코드리뷰 P1).
        if (guideShown) await hideAndWait();
        await completeApproved();
        return;
      }
      setGuideVisible(false);
      // 다시 거부하면 이 화면 유지 — '이대로 계속하기'로 진행 가능.
    } catch {
      // 재요청 자체가 불가한 상태(기기 제한 등) — 설정 앱 이동으로 폴백.
      setGuideVisible(false);
      Alert.alert('앱에서 바로 요청할 수 없어요', '설정에서 스크린 타임 권한을 켜 주세요.', [
        { text: '취소', style: 'cancel' },
        { text: '설정 열기', onPress: openSettings },
      ]);
    } finally {
      setRequesting(false);
    }
  };

  return (
    <>
      <StepScaffold
        testID="onboarding.step.screentimeDenied"
        center
        header={
          <View style={s.mascot}>
            <CharacterImage size={132} />
          </View>
        }
        title="권한 없이도 괜찮아요"
        subtitle={
          <>
            다만 <Text style={s.strong}>사용시간 목표 설정·통계</Text>는 쓸 수 없어요. 집중 타이머와
            리그는 그대로 이용할 수 있어요.
          </>
        }
        ctaLabel={requesting ? '요청 중…' : '다시 허용하기'}
        ctaDisabled={requesting}
        onCta={retryPermission}
        secondaryLabel="이대로 계속하기"
        onSecondary={onNext}
      >
        <InfoNote>
          언제든 <NoteStrong>설정 › 스크린 타임 권한</NoteStrong>에서 켤 수 있어요.
        </InfoNote>
      </StepScaffold>
      <ScreenTimeGuideOverlay
        visible={guideVisible}
        scheme={scheme}
        requesting={requesting}
        onConfirm={() => doRetry(true)}
        onDismissed={onDismissed}
      />
    </>
  );
}

const s = StyleSheet.create({
  mascot: { alignItems: 'center', justifyContent: 'center' },
  strong: { color: T.ink, fontWeight: '700' }, // 부제 내 '사용시간 목표 설정·통계' 강조
});
