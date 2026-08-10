import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  Keyboard,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';
import Animated, {
  cancelAnimation,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { M } from '@/constants/motion';
import { useMotion } from '@/hooks/useMotion';
import { T, withAlpha } from '@/constants/theme';

// 바텀시트 공용 껍데기(03/04/05) — 딤 + 하단 흰 패널.
// 닫기: ① 딤 탭 ② 상단 그랩바를 잡고 아래로 끌기(pull-down) ③ 시트 안 CTA(useSheetClose).
// 키보드: iOS에서 키보드가 뜨면 패널을 그 높이만큼 위로 띄워 입력/버튼이 가리지 않게 한다
//         (공지·찾기 시트의 입력 가림 해소).
// 높이: 패널에 가용 높이의 85% 상한을 두고, 넘치면 패널 안이 스크롤된다(GROMO-1111).
//
// ── 모션(GROMO-1381 / 정책 D3·D4, 설계 §4) ────────────────────────────────────
// 상태 기계: mount → (모션 설정 확정 대기) → entering → idle ⇄ dragging → closing → onClose()
//   대기      패널을 화면 밖(prelayoutY)에 둔 채 '동작 줄이기' 확정만 기다린다(보통 0프레임)
//   entering  translateY h→0 (spring.snappy) + 딤 0→1 (quick)
//   dragging  PanResponder가 translateY를 직접 쓴다. 딤은 진행률에 연동돼 끌수록 옅어진다.
//   복귀      임계 미달·dismissible=false → withSpring(0, snappy) — entering과 같은 스프링(대칭)
//   closing   translateY→화면 밖 (quick, standard) + 딤 0 → 완료 콜백에서 onClose()
//             퇴장이 시작되는 즉시 자식에게 알린다(useSheetClosing) — 자식이 예약해 둔 진행을
//             취소할 수 있어야 한다. onClose는 220ms 뒤라 언마운트만으로는 늦는다.
//
// ⚠️ 왜 이 파일만 Reanimated인가 (정책 D4) — **등장 값과 드래그 값이 물리적으로 같은 값**이라
//    두 애니메이션 시스템으로 나눌 수 없다(등장 중 드래그 시작·드래그 중 등장 종료가 실재한다).
//    레거시 Animated로 남기면 M.spring.snappy를 옮길 방법이 없다(파라미터 모델이 다르다).
//    제스처는 그대로 PanResponder다 — gesture-handler는 새 네이티브 모듈이라 OTA에서 못 쓴다(D5).
//
// ⚠️ 탭 화면(홈·리그·그룹·전체) 안에서 쓸 때는 반드시 asModal을 켠다.
//    기본형은 화면 트리 안에 그리는 absoluteFill View인데, 플로팅 탭바는
//    BottomTabView가 화면 컨테이너 **다음에** 렌더하므로 시트가 항상 탭바·FAB 아래에 깔린다.
//    asModal은 같은 트리를 RN Modal로 한 겹 올려 탭바 위로 띄운다.
//    스택 화면(settings·focus·공지)은 탭바가 없으므로 기본형 그대로 쓴다.

// 레이아웃 전 초기 위치 — 어떤 패널 높이보다 크게 잡아 측정 전 한 프레임도 보이지 않게 한다(§4.2).
// ⚠️ 상수 1000pt로 두면 안 된다. 패널 높이 상한이 화면의 85%이므로 화면이 1176pt를 넘는 기기·
//    폴더블·큰 글꼴 환경에서는 1000pt를 내려도 패널 상단 일부가 화면에 남아, 첫 onLayout 전에
//    흰 조각이 번쩍였다가 다시 올라오는 깜빡임이 생긴다(codex 리뷰). 화면 높이 자체를 쓴다 —
//    패널은 그보다 클 수 없다.
const prelayoutY = (windowHeight: number) => windowHeight;
/**
 * 퇴장 목표 거리 — **화면의 긴 변**을 쓴다.
 *
 * ⚠️ 화면 높이만 쓰면 퇴장 220ms 사이에 **회전**이 일어날 때 모자란다. 목표는 요청 시점의
 *    작은 높이에 고정되는데 패널 상한(가용 높이의 85%)은 새 높이로 커져, 늘어난 상단이
 *    언마운트 직전까지 화면에 남는다(codex 리뷰).
 *    긴 변은 **회전에 불변**이다 — 회전 후 높이는 회전 전의 두 변 중 하나이므로 항상
 *    `max(w, h)` 이하다. 즉 이 한 값이 어느 방향으로 돌든 충분하다.
 *    (펼침으로 두 변이 **함께** 커지는 경우는 이 상수로 못 덮는다 — 아래 useEffect가 받는다.)
 */
const exitDistance = (windowWidth: number, windowHeight: number) =>
  Math.max(windowWidth, windowHeight);
// 드래그가 딤을 얼마나 걷어내는가(0~1). 1이면 손을 놓기도 전에 배경이 완전히 드러나 이미 닫힌
// 것처럼 보인다 — 절반 조금 넘게만 걷어 "닫히는 중"임을 알린다.
const DIM_DRAG_FADE = 0.6;
// 드래그로 딤이 얼마나 걷혔는가를 곱셈 계수(0.4~1)로. 패널을 자기 높이만큼 끌어내리면 최대치다.
// ⚠️ 워클릿과 JS 양쪽에서 쓴다 — 퇴장을 시작할 때 "지금까지 걷힌 만큼"을 JS에서 한 번 접어
//    넣어야 하므로(아래 requestClose 주석), 식이 두 벌이 되지 않게 여기 한 곳에 둔다.
function dimDragFactor(y: number, panelHeight: number): number {
  'worklet';
  const dragged = panelHeight > 0 ? Math.min(Math.max(y, 0), panelHeight) / panelHeight : 0;
  return 1 - dragged * DIM_DRAG_FADE;
}
// 시트 안착 스프링 — M.spring.snappy에 **오버슛 클램프**를 더한 것.
// ⚠️ snappy는 ζ≈0.65의 과소감쇠라 translateY=0을 지나 음수로 넘어간다. 패널 전체를 위로
//    옮기는 transform이므로 그 구간에는 **패널 아래와 화면 바닥 사이에 딤이 띠처럼 드러난다**
//    — 시작 높이가 큰 시트일수록 틈이 커진다(codex 리뷰). 바텀시트는 바닥에 붙어 있는 게
//    전제라 여기서만 클램프한다(토큰 자체는 건드리지 않는다 — 다른 표면에서는 오버슛이 맞다).
const SHEET_SETTLE = { ...M.spring.snappy, overshootClamping: true } as const;
// 닫힘 임계 — 이동량 90pt 또는 던지는 속도 1.2. 종전 값 그대로다(회귀 방지).
const CLOSE_DY = 90;
const CLOSE_VY = 1.2;

// 딤을 애니메이트하려면 Pressable 자체가 Animated여야 한다 — 뒤에 Animated.View를 한 겹 깔면
// 트리에 호스트 뷰가 늘어 E2E(testID) 계약과 히트 영역이 흔들린다(컨트랙트 §0-6).
const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

// 시트 안 CTA가 부모 onClose 대신 부를 닫기. 딤 탭·그랩바 드래그는 이 껍데기가 내부에서
// 가로채므로 호출부 변경이 필요 없지만, CTA는 부모 onClose를 직접 불러 언마운트해 버려
// 퇴장이 보이지 않는다. 그래서 컨텍스트로 "애니메이션을 태운 닫기"를 내려 준다.
const SheetCloseContext = createContext<(() => void) | null>(null);
// 퇴장이 **시작됐다**는 신호. 위 컨텍스트와 따로 두는 이유: 값이 닫힐 때 한 번 바뀌므로 한 객체로
// 합치면 close만 쓰는 자식들의 memo까지 그때 통째로 무효화된다.
const SheetClosingContext = createContext<boolean | null>(null);

/**
 * 시트 안 CTA용 닫기 — 퇴장 애니메이션을 재생한 뒤 부모 `onClose`를 부른다.
 *
 * ⚠️ 컨텍스트는 SheetShell **자식 트리**에서만 잡힌다. 시트 컴포넌트 본문에서 직접 부르면
 *    (그 본문은 SheetShell보다 위에서 실행된다) 잡히지 않으므로, CTA를 작은 하위 컴포넌트로
 *    빼서 거기서 부른다. 렌더 결과(호스트 뷰·testID)는 종전과 같아야 한다 — Maestro가
 *    testID 셀렉터만 쓰기 때문이다.
 *
 * ⚠️ `dismissible=false`(저장 중 등)면 아무 일도 하지 않는다 — 종전에 호출부가 onClose를
 *    no-op으로 갈아끼워 막던 것과 같은 결과다.
 */
export function useSheetClose(): () => void {
  const close = useContext(SheetCloseContext);
  if (close === null) {
    throw new Error('useSheetClose()는 SheetShell 자식 트리 안에서만 쓸 수 있다.');
  }
  return close;
}

/**
 * 퇴장이 시작됐는가 — 시트 안에서 **예약해 둔 진행을 취소**할 신호.
 *
 * ⚠️ 왜 필요한가. 종전에는 닫기 = 즉시 언마운트라 자식의 cleanup이 그 자리에서 돌았지만, 이제
 *    `onClose`는 퇴장 220ms **뒤에** 불린다. 그 사이에 자식이 걸어 둔 `setTimeout`은 그대로
 *    발화한다 — 타이머 방식 시트에서 옵션을 고른 뒤 곧바로 딤을 눌러 취소해도, 예약된 `onSelect`가
 *    퇴장이 끝나기 전에 실행돼 세션이 시작되거나 다음 시트가 열린다(codex 리뷰).
 *    `pointerEvents='none'`은 **새 입력**만 막는다 — 이미 예약된 진행은 못 막는다.
 *
 * ⚠️ `useSheetClose`와 같은 제약: SheetShell **자식 트리** 안에서만 잡힌다. 시트 컴포넌트 본문은
 *    SheetShell보다 위에서 실행되므로, 예약을 들고 있는 상태를 하위 컴포넌트로 빼서 거기서 쓴다.
 *    (밖에서 부르면 조용히 false를 돌려주는 대신 터뜨린다 — 취소가 조용히 죽으면 배포 뒤에야 안다.)
 */
export function useSheetClosing(): boolean {
  const closing = useContext(SheetClosingContext);
  if (closing === null) {
    throw new Error('useSheetClosing()은 SheetShell 자식 트리 안에서만 쓸 수 있다.');
  }
  return closing;
}

export function SheetShell({
  children,
  onClose,
  asModal = false,
  dismissible = true,
}: {
  children: ReactNode;
  onClose: () => void;
  asModal?: boolean;
  // false면(예: 저장 요청 중) 그랩바 드래그가 임계치를 넘어도 닫지 않고 제자리로 되돌린다 —
  // onClose가 no-op으로 막힌 시트에서 패널만 화면 밖으로 밀려 박제되는 회귀 방지.
  // 딤 탭·useSheetClose()도 같은 게이트를 지난다(퇴장만 재생되고 언마운트는 안 되는 상태 방지).
  dismissible?: boolean;
}) {
  const insets = useSafeAreaInsets();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const m = useMotion();

  // onClose는 사용처마다 새 함수라(제출 중 무력화 등) PanResponder 클로저가 stale해지지 않게
  // ref로 최신값을 읽는다.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  // PanResponder는 한 번만 생성돼 클로저가 stale하므로 dismissible도 ref로 최신값을 읽는다.
  const dismissibleRef = useRef(dismissible);
  dismissibleRef.current = dismissible;
  // 퇴장 거리 계산에 쓰는 키보드 높이 — 위와 같은 이유로 ref.
  const keyboardHeightRef = useRef(keyboardHeight);
  keyboardHeightRef.current = keyboardHeight;
  const reduceRef = useRef(m.reduce);
  reduceRef.current = m.reduce;
  // '동작 줄이기' 값이 **확정됐는가**. 콜백 안에서는 최신값을 봐야 하므로 ref로도 들고 있다.
  const readyRef = useRef(m.ready);
  readyRef.current = m.ready;
  // 드래그 시작 시점의 패널 위치 — 등장·복귀 스프링이 도는 중에 잡아도 이어서 끌리게 한다.
  const dragStartYRef = useRef(0);

  // 패널 세로 위치. 등장·드래그·퇴장이 **같은 값**을 쓴다(정책 D4).
  // 초기값은 화면 높이 — 패널은 그보다 클 수 없으므로 측정 전 한 프레임도 보이지 않는다.
  const translateY = useSharedValue(prelayoutY(windowHeight));
  // 딤 불투명도의 등장/퇴장 성분. 드래그 성분은 아래 useAnimatedStyle에서 곱해진다.
  const dimProgress = useSharedValue(0);
  // 퇴장이 시작되면 딤에서 **드래그 성분을 뗀다**(아래 requestClose·dimAnimStyle 주석).
  // ⚠️ React 상태(closing)가 아니라 shared value여야 한다 — 상태는 리렌더 뒤에야 워클릿에
  //    반영돼, 접어 넣기(JS)와 성분 제거(UI) 사이에 한 프레임 어긋난 딤이 그려진다.
  const dimDragMuted = useSharedValue(false);
  // 측정된 패널 높이 — 등장 시작점이자 퇴장 목표점이다(추정값을 쓰지 않는 이유는 §4.2).
  const panelHeight = useSharedValue(0);
  // 등장은 최초 레이아웃 1회만 — 키보드·내용 변화로 onLayout이 다시 불려도 재생하지 않는다.
  const enteredRef = useRef(false);
  // 모션 설정이 확정되기 전에 측정된 패널 높이를 **보관**해 두는 자리.
  // 확정 전에는 등장을 시작하지도, 생략하기로 확정하지도 않는다 — 값만 들고 기다린다.
  const pendingEnterHeightRef = useRef<number | null>(null);
  // 퇴장 진행 중 — 딤 탭·드래그·CTA가 겹쳐 들어와도 onClose를 두 번 부르지 않게 한다.
  const closingRef = useRef(false);
  // ⚠️ ref만으로는 **자식 입력**을 못 막는다. 종전에는 닫는 즉시 언마운트돼서 불가능했던 일이
  //    퇴장 220ms 동안 가능해진다 — 예를 들어 초대 시트에서 '닫기'를 누른 직후 '참여하기'를
  //    빠르게 누르거나 두 버튼을 멀티터치하면, 사용자가 닫기를 골랐는데도 서버에서 가입이
  //    끝난다(codex 리뷰). 퇴장이 시작되면 패널의 pointerEvents를 끈다.
  //    딤·그랩바는 이 껍데기가 내부에서 이미 게이트하므로 패널만 막으면 된다.
  const [closing, setClosing] = useState(false);

  // 키보드 높이 추적(iOS만) — 안드로이드는 windowSoftInputMode가 처리하므로 건드리지 않는다.
  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    const showSub = Keyboard.addListener('keyboardWillShow', (e) =>
      setKeyboardHeight(e.endCoordinates.height),
    );
    const hideSub = Keyboard.addListener('keyboardWillHide', () => setKeyboardHeight(0));
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  // 재생 도중 '동작 줄이기'가 켜지면 중간 프레임으로 굳는다 — 최종 상태로 스냅한다.
  // (imperative 애니메이션은 CSS 경로와 달리 스타일을 떼는 것만으로 되돌아가지 않는다.)
  //
  // ⚠️ **등장을 시작하기 전에는 스냅하지 않는다.** 모션 설정이 확정되기 전 useMotion은 보수적으로
  //    reduce=true를 돌려주는데(그게 옳다), 그 값에 반응해 여기서 최종 상태로 스냅해 버리면
  //    콜드 스타트 직후 열리는 시트가 등장 없이 **제자리에서 튀어나온 뒤**, 뒤늦게 reduce=false로
  //    확정돼도 되돌릴 수 없다. 확정 전에는 화면 밖(prelayoutY)에 그대로 둔다.
  useEffect(() => {
    if (!m.reduce || closingRef.current || !enteredRef.current) return;
    translateY.value = 0;
    dimProgress.value = 1;
  }, [m.reduce, translateY, dimProgress]);

  // ⚠️ 퇴장 **시작 시점**의 onClose를 붙잡아 뒀다가 완료 시 그걸 부른다.
  //    onCloseRef는 매 렌더 갱신되므로(제출 중 무력화 등을 위해 PanResponder가 최신값을 읽어야
  //    한다), 완료 콜백에서 ref를 다시 읽으면 **220ms 사이에 바뀐 다른 콜백**이 실행된다.
  //    실제 사고: 그룹 초대 A를 닫는 중에 초대 B가 도착하면 onClose prop이 B를 캡처한 함수로
  //    교체되고, 그게 실행되면서 방금 온 B가 버퍼에서 지워졌다(codex 리뷰).
  //    "닫기를 요청한 그 시점의 의도"를 실행하는 게 맞다.
  const pendingCloseRef = useRef<(() => void) | null>(null);
  const fireClose = useCallback(() => {
    const fn = pendingCloseRef.current ?? onCloseRef.current;
    pendingCloseRef.current = null;
    fn();
  }, []);

  // 퇴장 시작. 딤 탭·그랩바 릴리스·시트 안 CTA가 전부 이 하나를 지난다.
  const requestCloseRef = useRef<() => void>(() => {});
  requestCloseRef.current = () => {
    if (!dismissibleRef.current || closingRef.current) return;
    closingRef.current = true;
    setClosing(true);
    pendingCloseRef.current = onCloseRef.current;
    // '동작 줄이기'에서는 퇴장을 재생하지 않고 즉시 닫는다(설계 §4.1).
    if (reduceRef.current) {
      fireClose();
      return;
    }
    // ⚠️ 퇴장 목표는 **요청 시점의 패널 높이가 아니라 화면 높이**다. withTiming의 목표값은 한 번
    //    정해지면 갱신되지 않는데, 퇴장 220ms 동안 패널 높이는 얼마든지 커진다 — 초대 시트의
    //    로딩 화면에서 딤을 누른 직후 프리뷰가 도착하면 패널이 커지고, 목표가 옛 높이에 묶여 있어
    //    **늘어난 패널 상단이 퇴장이 끝날 때까지 화면에 다시 드러난다**(codex 리뷰).
    //    두 대안 중 '항상 더 큰 거리로 내린다'를 고른 이유: 패널 높이 상한이 가용 높이의 85%라
    //    `panelHeight + keyboardHeight ≤ 0.85·(H−kb) + kb ≤ H`가 **항상** 성립한다. 즉 화면 높이
    //    하나면 높이 변화든 키보드 등장이든 전부 덮는다(레이아웃 고정은 높이 축만 막고 키보드 축은
    //    못 막는다). prelayoutY가 이미 쓰는 "어떤 패널 높이보다 큰 값"과 같은 개념이라 값의 출처도
    //    하나로 유지된다. 키보드 높이를 더하는 건 상한 재계산이 한 프레임 늦는 과도 구간까지 덮는
    //    여유분이다.
    //    (거리가 길어진 만큼 패널은 220ms를 다 쓰기 전에 화면 밖으로 나간다. 딤 페이드가 같은
    //     220ms를 채우므로 닫힘 연출 전체 길이와 onClose 시점은 종전과 같다.)
    const exitY = exitDistance(windowWidth, windowHeight) + keyboardHeightRef.current;
    // ⚠️ 퇴장 중에는 딤에서 **드래그 성분을 뗀다.** 퇴장은 손끝이 아니라 시간이 끄는 애니메이션이고
    //    (드래그는 이미 closingRef 가드로 전부 막혀 있다), 위에서 퇴장 거리를 화면 높이로 고정한
    //    뒤로는 translateY/panelHeight 비율이 "얼마나 끌었나"를 더는 뜻하지 않는다.
    //    그대로 두면 퇴장 220ms 사이에 패널 높이가 커질 때 분모가 커져 감쇠가 **약해지고**,
    //    0으로 내려가던 딤이 순간 다시 어두워진다(codex 리뷰 — 초대 시트 로딩→프리뷰 전환).
    //    ⚠️ 대신 **지금까지 걷힌 만큼은 dimProgress에 접어 넣는다.** 그냥 떼기만 하면 임계를 넘겨
    //       손을 놓는 순간 딤이 도로 짙어져(끌어서 걷어 둔 게 사라져) 같은 종류의 역행이 된다.
    dimProgress.value *= dimDragFactor(translateY.value, panelHeight.value);
    dimDragMuted.value = true;
    dimProgress.value = withTiming(0, {
      duration: M.dur.quick,
      easing: M.curve.standard.fn,
      reduceMotion: M.never,
    });
    translateY.value = withTiming(
      exitY,
      { duration: M.dur.quick, easing: M.curve.standard.fn, reduceMotion: M.never },
      (finished) => {
        // 중간에 끊겼으면(다른 애니메이션이 값을 가져감) 닫지 않는다 — 시트가 남아 있는 게 맞다.
        if (finished) runOnJS(fireClose)();
      },
    );
  };
  // ⚠️ 퇴장 **중에** 화면이 커지면(폴더블 펼침처럼 두 변이 함께 커지는 경우) 목표를 다시 건다.
  //    긴 변 상수는 회전을 덮지만 펼침은 못 덮는다 — withTiming의 목표값은 한 번 정해지면
  //    갱신되지 않으므로 다시 거는 수밖에 없다(codex 리뷰).
  //    다시 걸면 앞 애니메이션의 콜백은 finished=false로 와서 닫지 않고(그 가드가 이미 있다),
  //    새 애니메이션이 끝날 때 닫는다. 그만큼 퇴장이 길어지지만 **패널이 화면에 남는 것보다 낫다.**
  //    딤은 자기 타임라인을 그대로 유지한다 — 이미 0으로 가는 중이라 다시 걸 이유가 없다.
  useEffect(() => {
    if (!closingRef.current) return;
    const target = exitDistance(windowWidth, windowHeight) + keyboardHeightRef.current;
    if (translateY.value >= target) return;
    translateY.value = withTiming(
      target,
      { duration: M.dur.quick, easing: M.curve.standard.fn, reduceMotion: M.never },
      (finished) => {
        if (finished) runOnJS(fireClose)();
      },
    );
  }, [windowWidth, windowHeight, translateY, fireClose]);

  // 컨텍스트로 내려보내는 참조는 렌더마다 바뀌지 않아야 한다(자식 memo 무효화 방지).
  const close = useCallback(() => requestCloseRef.current(), []);

  const pan = useRef(
    PanResponder.create({
      // 아래로(세로 우세) 끌기 시작할 때만 응답을 가져간다 — 시트 안 스크롤/입력과 충돌하지 않게
      // 그랩바 영역에만 붙인다.
      // ⚠️ 퇴장이 시작된 뒤에는 응답 자체를 가져가지 않는다. 아래 grant/move/release가 각각
      //    막고 있지만, 애초에 제스처를 받지 않는 게 근본이다 — 퇴장 중 시트는 이미 사라지는
      //    중이라 끌 대상이 아니다.
      onMoveShouldSetPanResponder: (_, g) =>
        !closingRef.current && g.dy > 4 && Math.abs(g.dy) > Math.abs(g.dx),
      // ⚠️ 제스처 시작 시점의 패널 위치를 붙잡는다. g.dy는 **이번 터치 시작점부터의 누적
      //    이동량**이지 translateY의 델타가 아니라서, 이 캡처가 없으면 translateY가 0이 아닌
      //    상태(등장 스프링이 아직 도는 중 · release 후 복귀 스프링이 도는 중)에서 그랩바를 잡는
      //    순간 패널이 g.dy(≈0) 자리로 **순간이동**한다. 같은 shared value를 쓰는 것만으로는
      //    인터럽트가 성립하지 않는다 — 절대값으로 덮어쓰면 이전 위치가 사라진다(claude 리뷰).
      onPanResponderGrant: () => {
        // ⚠️ 퇴장 중이면 취소하지 않는다. 그랩바를 누른 채(4pt 임계 미만) 하드웨어 뒤로가기로
        //    퇴장이 시작된 뒤 손가락을 움직여 뒤늦게 grant되면, 무조건적인 cancelAnimation이
        //    진행 중인 퇴장 withTiming을 취소해 **닫을 수 없는 시트**가 남는다(codex 리뷰).
        if (closingRef.current) return;
        // ⚠️ 진행 중인 스프링을 **멈춘 뒤** 위치를 캡처한다. 멈추지 않으면 UI 스레드의 스프링이
        //    계속 전진하는데, 사용자가 잡은 채 잠깐 멈췄다 다시 움직이면 다음 move가 낡은
        //    dragStartY를 기준으로 값을 덮어써 패널이 뒤로 튄다(claude 리뷰).
        cancelAnimation(translateY);
        dragStartYRef.current = translateY.value;
      },
      onPanResponderMove: (_, g) => {
        // 퇴장이 시작된 뒤의 잔여 이벤트가 패널을 도로 끌어올리지 않게 막는다.
        if (closingRef.current) return;
        // 위로는 끌리지 않는다(0 미만 방지) — 시트는 아래로만 닫힌다.
        const next = dragStartYRef.current + g.dy;
        if (next > 0) translateY.value = next;
      },
      // ⚠️ 시스템 제스처 등이 터치를 가져가면 release가 아니라 이쪽이 불린다. 이게 없으면
      //    등장 스프링을 grant에서 멈춰 둔 채 아무도 되돌리지 않아, 사용자가 끌지도 않았는데
      //    시트가 등장 중간 위치에 영구히 멈춘다(codex 리뷰).
      onPanResponderTerminate: () => {
        if (closingRef.current) return;
        translateY.value = reduceRef.current ? 0 : withSpring(0, SHEET_SETTLE);
      },
      onPanResponderRelease: (_, g) => {
        // ⚠️ 이미 퇴장 중이면 아무것도 하지 않는다. 안드로이드에서 그랩바를 잡은 채 하드웨어
        //    뒤로가기로 닫기가 시작된 뒤 임계 미만에서 손을 놓으면, 아래 복귀 스프링이 진행 중인
        //    퇴장 withTiming을 **취소**한다. 그러면 완료 콜백이 finished=false라 onClose가 불리지
        //    않는데 closingRef는 true로 남고 딤은 이미 투명해져서, 이후 딤 탭·뒤로가기가 전부
        //    무시되는 **닫을 수 없는 시트**가 된다(codex 리뷰).
        if (closingRef.current) return;
        // dismissible=false(예: 저장 중)면 임계치와 무관하게 항상 제자리로 되돌린다 — 화면 밖으로
        // 밀어낸 뒤 no-op onClose로 언마운트되지 않아 시트가 박제되는 회귀를 막는다(리뷰 반영).
        if (dismissibleRef.current && (g.dy > CLOSE_DY || g.vy > CLOSE_VY)) {
          requestCloseRef.current();
        } else {
          // 복귀는 등장과 **같은 스프링**이다 — 올라올 때와 되돌아갈 때의 물성이 다르면 겉돈다.
          translateY.value = reduceRef.current ? 0 : withSpring(0, SHEET_SETTLE);
        }
      },
    }),
  ).current;

  // 등장 실행부 — 측정 높이 h에서 시작해 제자리로 올린다. '동작 줄이기'면 최종 상태로 바로 놓는다.
  // 호출 시점에는 모션 설정이 **확정돼 있어야 한다**(아래 onPanelLayout·useEffect가 그걸 보장한다).
  const startEnter = useCallback(
    (h: number) => {
      enteredRef.current = true;
      pendingEnterHeightRef.current = null;
      if (reduceRef.current) {
        // '동작 줄이기' — 최종 상태로 바로 놓는다. 이후 설정이 꺼져도 제자리라 안전하다.
        translateY.value = 0;
        dimProgress.value = 1;
        return;
      }
      translateY.value = h + keyboardHeightRef.current;
      translateY.value = withSpring(0, SHEET_SETTLE);
      dimProgress.value = withTiming(1, {
        duration: M.dur.quick,
        easing: M.curve.standard.fn,
        reduceMotion: M.never,
      });
    },
    [translateY, dimProgress],
  );

  // ⚠️ 모션 설정이 확정되면 **보류해 둔 등장**을 그제서야 시작한다. 콜드 스타트 직후(초대 딥링크
  //    등) 첫 시트는 isReduceMotionEnabled() 조회보다 먼저 레이아웃될 수 있는데, 그때의
  //    reduce=true는 실제 설정이 아니라 미확정을 뜻하는 보수값이다. 그걸로 등장을 확정하면
  //    enteredRef 때문에 다시 시작할 수 없어, 동작 줄이기를 쓰지 않는 사용자도 이번 슬라이드업을
  //    영구히 잃는다(codex 리뷰). 조회가 실패해도 ready는 false로 반드시 확정되므로
  //    (useReduceMotion의 catch) 여기서 영원히 기다리는 일은 없다.
  //    ⚠️ 의존성엔 `m`(매 렌더 새 객체)이 아니라 원시값 m.ready만 넣는다 — 1회성 등장이 중복
  //       실행되지 않게.
  useEffect(() => {
    if (!m.ready || enteredRef.current || closingRef.current) return;
    const h = pendingEnterHeightRef.current;
    if (h === null) return;
    startEnter(h);
  }, [m.ready, startEnter]);

  // 등장 트리거는 useEffect가 아니라 패널 onLayout이다(설계 §4.2).
  // asModal은 iOS에서 Modal이 UIViewController를 present하느라 한 프레임 늦게 붙어, useEffect로
  // 걸면 레이아웃 전에 애니메이션이 시작돼 깜빡인다. 여기서 측정 높이로 스냅하고 **같은 프레임에**
  // 스프링을 걸면 높이 추정값도, 깜빡임도 없다.
  // (모션 설정이 아직 미확정이면 여기서 시작하지 않고 위 useEffect로 넘긴다 — 아래 주석 참고.)
  const onPanelLayout = (h: number): void => {
    panelHeight.value = h;
    // ⚠️ 이미 닫는 중이면 등장을 시작하지 않는다. 첫 onLayout 전에 (아직 투명한) 딤을 빠르게
    //    탭하거나 안드로이드 뒤로가기를 누르면 퇴장 withTiming이 먼저 걸리는데, 여기서
    //    withSpring(0)을 대입하면 그 퇴장을 **취소**한다 → 완료 콜백이 finished=false라
    //    onClose가 안 불리고, closingRef=true인 투명한 Modal이 화면 입력을 계속 가로막는다
    //    (codex 리뷰).
    if (closingRef.current) return;
    if (enteredRef.current) return;
    // ⚠️ 모션 설정이 아직 미확정이면 **높이만 보관하고 등장을 확정하지 않는다.** 패널은 화면
    //    밖(prelayoutY)에 그대로 머문다 — 시트의 자연스러운 시작 상태이고, 여기서 최종 위치로
    //    놓아 버리면 확정 후에 되돌릴 방법이 없다. 확정되는 즉시 위 useEffect가 이어받는다.
    if (!readyRef.current) {
      pendingEnterHeightRef.current = h;
      return;
    }
    startEnter(h);
  };

  const panelAnimStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));
  // 딤 = 등장/퇴장 성분 × 드래그 성분. 끌수록 옅어져 "지금 닫는 중"이 손끝에 붙는다.
  // 퇴장이 시작되면 드래그 성분은 dimProgress에 접힌 채 계산에서 빠진다(위 requestClose 주석).
  const dimAnimStyle = useAnimatedStyle(() => {
    if (dimDragMuted.value) return { opacity: dimProgress.value };
    return { opacity: dimProgress.value * dimDragFactor(translateY.value, panelHeight.value) };
  });

  // 패널 높이 상한 — 가용 높이(키보드가 떠 있으면 그 위)의 85%.
  // 상한이 없으면 내용이 긴 시트(챌린지 만들기 = 드럼 피커 220pt로 패널 ~890pt)가 화면을 넘겨
  // 딤이 한 픽셀도 안 보이고 그랩바까지 화면 밖으로 밀려 **닫을 수단이 통째로 사라진다**.
  // 키보드 높이를 빼고 재는 이유: 패널 하단이 이미 키보드 위로 올라가 있으므로(bottom),
  // 전체 화면의 85%를 그대로 쓰면 패널 상단이 화면 밖으로 나간다.
  const panelMaxHeight = Math.max(0, windowHeight - keyboardHeight) * 0.85;

  // 내용이 상한을 넘칠 때만 스크롤을 켠다 — 넘치지 않는 시트(대부분)는 지금과 한 픽셀도 다르지
  // 않게 두기 위해서다. 스크롤이 꺼져 있으면 안쪽 목록·드럼 피커와 제스처를 다툴 일도 없다.
  const [scrollEnabled, setScrollEnabled] = useState(false);
  const viewportHeightRef = useRef(0);
  const contentHeightRef = useRef(0);
  const syncScrollEnabled = (): void => {
    // 1pt 여유 — 소수점 레이아웃 값이 스스로 스크롤을 켜고 끄며 진동하는 것을 막는다.
    const next = contentHeightRef.current > viewportHeightRef.current + 1;
    setScrollEnabled((prev) => (prev === next ? prev : next));
  };

  const body = (
    <SheetCloseContext.Provider value={close}>
      {/* 퇴장 시작 신호 — 자식이 예약해 둔 타이머를 취소할 수 있게(useSheetClosing 주석) */}
      <SheetClosingContext.Provider value={closing}>
        <View style={StyleSheet.absoluteFill}>
          <AnimatedPressable
            // ⚠️ 딤도 reduce에서 뗄 수 없다 — 드래그 진행률에 연동돼 있어서, 떼면 끌어도
            //    배경이 그대로다. 등장·퇴장 성분은 위에서 즉시 대입되므로 애니메이션은 없다.
            style={[s.dim, dimAnimStyle]}
            onPress={close}
            // ⚠️ 딤은 접근성에서 빼지 않는다. 딤의 유일한 액션은 '닫기'이고 closingRef가 두 번째
            //    호출을 이미 막는다 — 멱등한 액션까지 숨기면 스크린리더 사용자가 닫는 중에
            //    화면 구조를 잃을 뿐 얻는 게 없다. 막아야 할 건 패널 **안의** 자식 액션이다.
            testID="sheetShell.dim"
          />
          <Animated.View
            style={[
              s.panel,
              {
                bottom: keyboardHeight,
                maxHeight: panelMaxHeight,
                paddingBottom: keyboardHeight > 0 ? T.space.lg : insets.bottom + 20,
              },
              // ⚠️ **reduce여도 이 transform은 뗀 적이 없다.** 손가락을 따라오는 건 시간 기반
              //    애니메이션이 아니라 직접 조작이다. m.css()로 떨어뜨리면 패널이 꿈쩍도 않다가
              //    임계를 넘는 순간 갑자기 사라져, 사용자는 자기가 뭘 했는지 알 수 없게 된다
              //    (codex 리뷰). 끄는 건 등장·복귀·퇴장 **애니메이션**뿐이고, 그건 위
              //    reduceRef 분기가 이미 담당한다.
              panelAnimStyle,
            ]}
            onLayout={(e) => onPanelLayout(e.nativeEvent.layout.height)}
            // 퇴장이 시작되면 자식 입력을 막는다 — 위 closing 상태 주석 참고.
            pointerEvents={closing ? 'none' : 'auto'}
            // ⚠️ `pointerEvents='none'`은 **터치 히트 테스트만** 막는다. 접근성 트리는 그대로라,
            //    TalkBack·VoiceOver에서는 퇴장 220ms 동안에도 포커스된 자식(초대 시트의 '참여하기'
            //    같은)의 **접근성 액션이 실행된다** — 사용자가 닫았는데 join()이 도는 것이다
            //    (codex 리뷰). 두 플랫폼 prop이 달라 **둘 다** 건다:
            //      · Android: importantForAccessibility='no-hide-descendants'
            //      · iOS:     accessibilityElementsHidden
            //    닫는 중 시트가 접근성에서 사라지면 포커스는 뒤 화면으로 넘어간다 — 그게 맞다.
            //    시트는 사라지는 중이고, 곧 언마운트될 트리에 포커스를 붙들어 두는 게 더 나쁘다.
            importantForAccessibility={closing ? 'no-hide-descendants' : 'auto'}
            accessibilityElementsHidden={closing}
            testID="sheetShell.panel"
          >
            {/* 상단 그랩바 — 잡고 아래로 끌면 닫힌다(뒤로가기가 없는 시트의 명시적 닫기 수단) */}
            <View {...pan.panHandlers} style={s.grabArea} accessibilityLabel="아래로 끌어 닫기">
              <View style={s.grabber} />
            </View>
            {/* 내용 스크롤 — 상한 안에서는 내용 높이 그대로 줄어들고(flexShrink), 넘칠 때만 스크롤한다.
              keyboardShouldPersistTaps='handled': 스크롤 껍데기가 생기기 전과 똑같이 키보드가 떠 있어도
              첫 탭이 버튼에 그대로 닿게 한다(한 번 탭해서 키보드만 닫히는 회귀 방지). */}
            <ScrollView
              style={s.scroll}
              scrollEnabled={scrollEnabled}
              showsVerticalScrollIndicator={scrollEnabled}
              keyboardShouldPersistTaps="handled"
              nestedScrollEnabled
              onLayout={(e) => {
                viewportHeightRef.current = e.nativeEvent.layout.height;
                syncScrollEnabled();
              }}
              onContentSizeChange={(_, h) => {
                contentHeightRef.current = h;
                syncScrollEnabled();
              }}
              testID="sheetShell.scroll"
            >
              {children}
            </ScrollView>
          </Animated.View>
        </View>
      </SheetClosingContext.Provider>
    </SheetCloseContext.Provider>
  );

  // 기본값은 기존 렌더 그대로 — settings·focus 사용처가 트리 구조는 그대로다.
  if (!asModal) return body;

  // animationType='none' — 패널 슬라이드·딤 페이드를 이 컴포넌트가 직접 그린다(정책 D3).
  // RN Modal의 'slide'는 딤까지 포함한 컨테이너 전체를 밀어 올려 딤이 사각형째 슬라이드해 들어온다.
  // 'fade'는 패널이 제자리에서 나타나 시트 관용구가 아니다. 그래서 Modal 자체 전환은 끄고 직접 그린다.
  // (iOS의 Modal 전환은 UIKit presentation이라 중단할 수 없어, 같은 transform을 쓰는 그랩바
  //  드래그와 다투게 되는 것도 이유다. asModal=false 경로엔 Modal 자체가 없어 체감도 갈린다.)
  return (
    <Modal transparent statusBarTranslucent visible animationType="none" onRequestClose={close}>
      {body}
    </Modal>
  );
}

const s = StyleSheet.create({
  dim: { ...StyleSheet.absoluteFill, backgroundColor: withAlpha(T.night.bottom, 0.42) },
  panel: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: T.white,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: T.space.xl,
    paddingTop: T.space.sm,
    shadowColor: T.shadow,
    shadowOpacity: 0.22,
    shadowRadius: 40,
    shadowOffset: { width: 0, height: -14 },
    elevation: 20,
  },
  // 그랩바 — 상단 중앙 손잡이. 이 영역에만 PanResponder를 붙여 시트 내용과 충돌을 피한다.
  grabArea: { alignItems: 'center', paddingTop: 2, paddingBottom: T.space.md },
  grabber: { width: 40, height: 5, borderRadius: 3, backgroundColor: T.border },
  // 내용 스크롤 — flexGrow:0으로 패널을 키우지 않고, flexShrink:1로 상한에 닿을 때만 줄어든다.
  scroll: { flexGrow: 0, flexShrink: 1 },
});
