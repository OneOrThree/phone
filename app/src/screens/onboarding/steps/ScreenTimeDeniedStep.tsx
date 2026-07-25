import { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Linking, AppState } from 'react-native';
import StepScaffold from '@/screens/onboarding/components/StepScaffold';
import InfoNote, { NoteStrong } from '@/screens/onboarding/components/InfoNote';
import { CharacterImage } from '@/components/character/CharacterImage';
import { T } from '@/constants/theme';
import ScreenTimeModule from '@/services/ScreenTimeModule';
import { logOnboardingScreentimeViewed } from '@/services/analyticsEvents';
import type { StepProps } from '@/screens/onboarding/types';

// W10-1 · 권한 거부 분기 (제한 상태 안내). 권한 없이 계속할 수 있음을 안내.
// "설정에서 허용하기" → 앱 설정 페이지로 이동(Linking.openSettings).
//   iOS는 스크린타임 권한 창 직접 딥링크를 공개 API로 지원하지 않음(비공개 App-Prefs 스킴은 리젝 사유).
// 설정에서 권한을 켜고 돌아오면(AppState active) 이를 감지해 측정 앱 picker를 띄우고,
//   screenTimeGranted=true로 전환 → 이 스텝이 허용 경로(W11 전날 스크린타임)로 자동 교체된다.
export default function ScreenTimeDeniedStep({ update, onNext }: StepProps) {
  // update는 매 렌더 새 함수라 ref로 최신값만 참조(리스너는 1회만 등록).
  const updateRef = useRef(update);
  updateRef.current = update;
  // '설정에서 허용하기'로 앱을 벗어났다가 돌아온 경우에만 권한을 재확인하도록 표시.
  const returningFromSettings = useRef(false);

  // 스크린타임 요약 스텝 노출 계측 — 거부 분기라 데이터 없음(has_data:false). 진입당 1회.
  useEffect(() => {
    logOnboardingScreentimeViewed({ has_data: false });
  }, []);

  useEffect(() => {
    const sub = AppState.addEventListener('change', async (state) => {
      if (state !== 'active' || !returningFromSettings.current) return;
      returningFromSettings.current = false;
      // 설정에서 권한을 켜고 돌아왔는지 확인.
      const status = await ScreenTimeModule.getAuthorizationStatus();
      if (status !== 'approved') return; // 여전히 미허용 — 이 화면 유지.
      // 허용됨 → 측정 대상(앱) picker → selection 즉시 승격.
      try {
        const counts = await ScreenTimeModule.presentAppPicker();
        if (counts) {
          await ScreenTimeModule.promoteSelection();
          updateRef.current({ screenTimeSelectionConfigured: true });
        }
      } catch {
        // picker 미지원 환경(시뮬레이터 등)은 조용히 무시 — 진행.
      }
      // 허용 경로로 전환(이 스텝이 W11 전날 스크린타임으로 자동 교체됨).
      updateRef.current({ screenTimeGranted: true });
    });
    return () => sub.remove();
  }, []);

  const openSettings = () => {
    returningFromSettings.current = true;
    Linking.openSettings();
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
      ctaLabel="설정에서 허용하기"
      onCta={openSettings}
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
