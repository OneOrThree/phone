// 일/주 타임테이블 카드가 공용으로 쓰는 공유 캡처 훅(GROMO-1070).
// 두 카드가 각자 복제하던 캡처→공유 로직을 하나로 모은다. 흐름:
//   1) capturing=true → 브랜드 밴드(ShareBrandFooter)가 본문 아래에 렌더됨
//   2) 밴드 캐릭터(마스코트/누끼) 이미지 로드 대기(빈/깨진 캡처 방지, onLoad + 타임아웃 폴백)
//   3) 캡처 영역 자연 크기를 재서 1:1 정사각으로 레터박스 — 내용은 안 자르고 '부족한 쪽에만'
//      흰 여백을 더한다. 인스타 피드(정사각) 규격에 맞춘 이미지(GROMO-1070).
//   4) captureRef로 PNG를 떠서 시스템 공유 시트로 내보냄
//
// 정사각 프레임이 화면보다 넓어져도 view-shot은 뷰 bounds 전체(view.bounds.size)를 캡처하므로
// 화면 밖 여백까지 온전히 담긴다(RNViewShot.mm 확인). 캡처 직후 밴드·정사각을 즉시 원복해
// 공유 시트가 떠 있는 동안 카드가 변형된 채 남지 않게 한다(PR 386 리뷰와 동일 취지).
import { useCallback, useRef, useState } from 'react';
import { View, Share, Platform, type ViewStyle } from 'react-native';
import { captureRef } from 'react-native-view-shot';
import { logStatsShared, type StatsShareCard } from '@/services/analyticsEvents';

// 캐릭터 onLoad가 끝내 안 와도 공유가 막히지 않도록 하는 상한(FocusSessionScreen 캡처 선례 참고).
const CHAR_READY_TIMEOUT = 1500;

// 정사각 캡처 상태 — 정사각 한 변(side)·내용 너비(innerWidth)·축소 배율(scale).
// side는 '캡처 내용 너비(=카드 폭)'로 고정해 화면 밖으로 넓히지 않는다(넓히면 화면 밖 오른쪽이
// 캡처에서 잘린다). 내용이 정사각보다 높으면 scale로 축소해 정사각 안에 담는다.
interface SquareCapture {
  side: number;
  innerWidth: number;
  scale: number;
}

const nextFrame = (): Promise<void> =>
  new Promise((resolve) => requestAnimationFrame(() => resolve()));

// 뷰의 렌더 크기 측정 — .measure 콜백(x, y, width, height, ...)을 프라미스로 감싼다.
function measureView(node: View | null): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    if (!node?.measure) {
      resolve({ width: 0, height: 0 });
      return;
    }
    node.measure((_x, _y, width, height) => resolve({ width, height }));
  });
}

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
  innerRef: React.RefObject<View | null>;
  sharing: boolean;
  capturing: boolean;
  // shotRef에 얹을 정사각 프레임 스타일(캡처 중에만 non-null)
  frameStyle: ViewStyle | null;
  // 캡처 내용 래퍼(innerRef)에 얹을 너비 고정 스타일(캡처 중에만 non-null)
  innerStyle: ViewStyle | null;
  onCharReady: () => void;
  onShare: () => Promise<void>;
} {
  const shotRef = useRef<View | null>(null);
  const innerRef = useRef<View | null>(null);
  const [sharing, setSharing] = useState(false);
  // 캡처 전용 상태 — 브랜드 밴드 렌더 조건. sharing은 공유 시트가 닫혀야 풀리므로 그걸 쓰면
  // 시트가 카드를 다 안 가릴 때(iPad 팝오버 등) 밴드가 계속 노출된다(PR 386 리뷰 반영).
  const [capturing, setCapturing] = useState(false);
  // 정사각 레터박스 — 측정 후에만 채워진다. 평소·측정 전엔 null(카드 원래 레이아웃 그대로).
  const [square, setSquare] = useState<SquareCapture | null>(null);

  // 밴드 캐릭터 로드 대기 게이트 — onLoad가 오면 대기를 푼다(멱등).
  const charResolve = useRef<(() => void) | null>(null);
  const onCharReady = useCallback(() => {
    charResolve.current?.();
    charResolve.current = null;
  }, []);
  const waitCharReady = useCallback(
    () =>
      new Promise<void>((resolve) => {
        charResolve.current = resolve;
        setTimeout(resolve, CHAR_READY_TIMEOUT);
      }),
    [],
  );

  const onShare = useCallback(async () => {
    if (sharing) return;
    setSharing(true);
    setCapturing(true);
    try {
      // 1) 밴드 캐릭터(마스코트/누끼)가 그려진 뒤 진행 — 빈/깨진 이미지 방지
      await waitCharReady();
      // 2) 밴드가 커밋·레이아웃된 뒤(한 프레임) 캡처 내용의 자연 크기 측정
      await nextFrame();
      const { width, height } = await measureView(innerRef.current);
      // 3) 인스타 정사각(1:1) — 한 변 = 카드 폭(화면 안). 내용이 더 높으면 그 비율만큼 축소해
      //    정사각 안에 담고(내용 유지·안 잘림), 남는 좌우는 흰 여백(레터박스). 화면 밖으로
      //    넓히지 않으므로 오른쪽이 잘리지 않는다. width==0(측정 실패)이면 자연 크기 캡처(폴백).
      if (width > 0 && height > 0) {
        setSquare({ side: width, innerWidth: width, scale: Math.min(1, width / height) });
      }
      // 4) 정사각 적용 후 페인트 대기(두 프레임) → 캡처
      await nextFrame();
      await nextFrame();
      const uri = await captureRef(shotRef, {
        format: 'png',
        quality: 1,
        fileName: makeFileName(),
      });
      // 캡처 직후 밴드·정사각 즉시 원복 — 공유 시트가 떠 있는 동안 카드가 변형된 채 남지 않게
      setCapturing(false);
      setSquare(null);
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
      // 실패 경로에서도 밴드·정사각 정리(성공 경로에선 이미 원복 — 멱등)
      setCapturing(false);
      setSquare(null);
      setSharing(false);
    }
  }, [sharing, waitCharReady, makeFileName, card]);

  // 정사각 프레임 — 캡처 중에만. 한 변=카드 폭(화면 안)이라 화면 밖으로 안 넓혀 잘림이 없다.
  // stretch를 명시 크기로 덮고(패딩·음수마진 트릭 무효화), 내용을 가운데 두고 넘치면 잘라낸다.
  const frameStyle: ViewStyle | null = square
    ? {
        width: square.side,
        height: square.side,
        marginHorizontal: 0,
        paddingHorizontal: 0,
        alignSelf: 'center',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
      }
    : null;
  // 캡처 내용 래퍼 — 자연 너비 유지 + 정사각보다 높으면 scale로 축소(가운데 기준). 세로는 꽉,
  // 가로는 축소분만큼 흰 여백이 생겨 1:1이 된다.
  const innerStyle: ViewStyle | null = square
    ? { width: square.innerWidth, transform: [{ scale: square.scale }] }
    : null;

  return {
    shotRef,
    innerRef,
    sharing,
    capturing,
    frameStyle,
    innerStyle,
    onCharReady,
    onShare,
  };
}
