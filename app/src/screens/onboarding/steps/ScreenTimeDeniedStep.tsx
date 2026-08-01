import { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Alert, Linking, AppState } from 'react-native';
import StepScaffold from '@/screens/onboarding/components/StepScaffold';
import InfoNote, { NoteStrong } from '@/screens/onboarding/components/InfoNote';
import { CharacterImage } from '@/components/character/CharacterImage';
import { T } from '@/constants/theme';
import ScreenTimeModule from '@/services/ScreenTimeModule';
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
//   → 이 스텝이 허용 경로(W11 전날 스크린타임)로 자동 교체된다.
export default function ScreenTimeDeniedStep({ update, onNext }: StepProps) {
  // update는 매 렌더 새 함수라 ref로 최신값만 참조(리스너는 1회만 등록).
  const updateRef = useRef(update);
  updateRef.current = update;
  // 설정 앱 폴백으로 벗어났다가 돌아온 경우에만 권한을 재확인하도록 표시.
  const returningFromSettings = useRef(false);
  // 연타 방지 — FamilyControls 권한 요청은 시스템 전역 동시 1건 제한(GROMO-909). 요청 스텝과 동일 가드.
  const [requesting, setRequesting] = useState(false);

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
    // 허용 경로로 전환(이 스텝이 W11 전날 스크린타임으로 자동 교체됨).
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
    returningFromSettings.current = true;
    Linking.openSettings();
  };

  // '다시 허용하기' — 설정 앱 이동 없이 시스템 권한창 재요청(GROMO-971).
  const retryPermission = async () => {
    if (requesting) return;
    setRequesting(true);
    try {
      logOnboardingPermissionRequested();
      const granted = await ScreenTimeModule.requestAuthorization();
      logOnboardingPermissionResulted({ granted });
      if (granted) await completeApproved();
      // 다시 거부하면 이 화면 유지 — '이대로 계속하기'로 진행 가능.
    } catch {
      // 재요청 자체가 불가한 상태(기기 제한 등) — 설정 앱 이동으로 폴백.
      Alert.alert('앱에서 바로 요청할 수 없어요', '설정에서 스크린 타임 권한을 켜주세요.', [
        { text: '취소', style: 'cancel' },
        { text: '설정 열기', onPress: openSettings },
      ]);
    } finally {
      setRequesting(false);
    }
  };

  return (
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
  );
}

const s = StyleSheet.create({
  mascot: { alignItems: 'center', justifyContent: 'center' },
  strong: { color: T.ink, fontWeight: '700' }, // 부제 내 '사용시간 목표 설정·통계' 강조
});
