// 일/주 타임테이블 카드가 공용으로 쓰는 공유 캡처 훅(GROMO-1070).
// 두 카드가 각자 복제하던 캡처→공유·로드 게이트 로직을 하나로 모은다. 흐름:
//   1) capturing=true → 브랜드 chrome(밴드/헤더·마스코트)가 캡처 이미지에만 렌더됨
//   2) 브랜드 캐릭터(마스코트/누끼) 이미지 로드 대기(빈/깨진 캡처 방지, onLoad/onError + 타임아웃 폴백)
//   3) 캡처 영역에 사방 작은 여백만 두고(비율 강제 없음) captureRef로 PNG를 떠 시스템 공유 시트로 내보냄
//
// 캡처 폭 = 카드 폭(화면 안)이라 화면 밖으로 안 넓혀 잘림이 없다. 캡처 직후 chrome을 즉시 원복해
// 공유 시트가 떠 있는 동안 카드가 변형된 채 남지 않게 한다(PR 386 리뷰와 동일 취지).
import { useCallback, useRef, useState } from 'react';
import { View, Share, Platform, type ViewStyle } from 'react-native';
import { captureRef } from 'react-native-view-shot';
import { logStatsShared, type StatsShareCard } from '@/services/analyticsEvents';

// 캐릭터 onLoad/onError가 끝내 안 와도 공유가 막히지 않도록 하는 상한(FocusSessionScreen 캡처 선례 참고).
const CHAR_READY_TIMEOUT = 1500;
// 캡처 이미지 사방 여백 — '정말 조금만'. ttShot의 좌우 패딩·음수마진을 같은 크기로 덮어(|음수마진|=패딩)
// '내용 폭은 그대로' 유지하면서(캡처해도 격자/플롯 폭이 안 바뀌어 onLayout 재측정이 없다) 사방 균일 소여백.
const CAPTURE_PAD = 10;
const CAPTURE_FRAME: ViewStyle = {
  marginHorizontal: -CAPTURE_PAD,
  paddingHorizontal: CAPTURE_PAD,
  paddingVertical: CAPTURE_PAD,
};

const nextFrame = (): Promise<void> =>
  new Promise((resolve) => requestAnimationFrame(() => resolve()));

export function useTimetableShareCapture({
  card,
  makeFileName,
}: {
  // 계측 구분용 카드 종류
  card: StatsShareCard;
  // 공유 파일명 생성기 — 예: () => '260711_타임테이블' (캡처 시점에 오늘 날짜로 만든다)
  makeFileName: () => string;
}): {
  shotRef: React.RefObject<View | null>;
  capturing: boolean;
  // shotRef에 얹을 캡처 여백 스타일(캡처 중에만 non-null)
  captureStyle: ViewStyle | null;
  // 공유 버튼 disabled — 공유 중이거나 데이터 로드 전(로딩 스피너·빈 이미지 캡처 방지)
  disabled: boolean;
  // 브랜드 캐릭터 이미지 로드/실패 콜백 — ShareBrandFooter/ShareDayFrame에 넘긴다
  onCharReady: () => void;
  // 타임테이블 데이터 로드 완료 신호 — FocusTimetable/WeeklyTimetable이 조회 후 호출
  onLoaded: () => void;
  onShare: () => Promise<void>;
} {
  const shotRef = useRef<View | null>(null);
  const [sharing, setSharing] = useState(false);
  // 캡처 전용 상태 — 브랜드 chrome 렌더 조건. sharing은 공유 시트가 닫혀야 풀리므로 그걸 쓰면
  // 시트가 카드를 다 안 가릴 때(iPad 팝오버 등) chrome이 계속 노출된다(PR 386 리뷰 반영).
  const [capturing, setCapturing] = useState(false);
  // 타임테이블 데이터 로드 완료 여부 — 로딩 중(격자 스피너)에 공유하면 빈 이미지가 캡처되므로 막는다.
  const [ready, setReady] = useState(false);
  const onLoaded = useCallback(() => setReady(true), []);

  // 브랜드 캐릭터 로드 대기 게이트 — onLoad/onError가 오면 대기를 푼다(멱등). fast path에선 타임아웃을
  // 걷어 댕글링 타이머·중복 resolve를 막는다.
  const charResolve = useRef<(() => void) | null>(null);
  const onCharReady = useCallback(() => {
    charResolve.current?.();
    charResolve.current = null;
  }, []);
  const waitCharReady = useCallback(
    () =>
      new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          charResolve.current = null;
          resolve();
        }, CHAR_READY_TIMEOUT);
        charResolve.current = () => {
          clearTimeout(timer);
          resolve();
        };
      }),
    [],
  );

  const onShare = useCallback(async () => {
    if (sharing) return;
    setSharing(true);
    setCapturing(true);
    try {
      // 1) 브랜드 캐릭터(마스코트/누끼)가 그려진 뒤 진행 — 빈/깨진 이미지 방지
      await waitCharReady();
      // 2) chrome·여백이 커밋·페인트된 뒤 캡처(두 프레임 대기). 여백은 내용 폭 불변이라 재측정 없음.
      await nextFrame();
      await nextFrame();
      const uri = await captureRef(shotRef, {
        format: 'png',
        quality: 1,
        fileName: makeFileName(),
      });
      // 캡처 직후 chrome 즉시 원복 — 공유 시트가 떠 있는 동안 카드가 변형된 채 남지 않게
      setCapturing(false);
      // Android Share는 url을 무시하고 message 기반이라 플랫폼별 페이로드(현재 iOS 전용 앱이지만 방어)
      const result = await Share.share(Platform.OS === 'ios' ? { url: uri } : { message: uri });
      // 시트만 열고 닫으면 completed=false — 탭 대비 실공유 전환을 구분(GROMO-782). Android는 항상
      // sharedAction으로 resolve라 completed를 iOS에서만 인정(PR 276 Codex 리뷰 반영).
      logStatsShared({
        card,
        completed: Platform.OS === 'ios' && result.action === Share.sharedAction,
      });
    } catch {
      // 캡처 실패·공유 취소 — 무시
    } finally {
      // 실패 경로에서도 chrome 정리(성공 경로에선 이미 원복 — 멱등)
      setCapturing(false);
      setSharing(false);
    }
  }, [sharing, waitCharReady, makeFileName, card]);

  return {
    shotRef,
    capturing,
    captureStyle: capturing ? CAPTURE_FRAME : null,
    disabled: sharing || !ready,
    onCharReady,
    onLoaded,
    onShare,
  };
}
