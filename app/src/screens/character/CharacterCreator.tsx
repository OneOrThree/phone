import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  AppState,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { captureRef } from 'react-native-view-shot';
import { Ionicons } from '@expo/vector-icons';
import { ObjectCharacter } from '@/screens/character/ObjectCharacter';
import { ProgressRing } from '@/components/ProgressRing';
import {
  cutoutSubject,
  isSubjectMaskSupported,
  saveCustomCharacter,
  subjectMaskReasonLabel,
  type SubjectMaskResult,
} from '@/services/subjectMask';
import {
  getCharacterQuota,
  moderateImage,
  recordCharacterGeneration,
  type CharacterQuota,
} from '@/services/characterApi';
import { M } from '@/constants/motion';
import { useMotion } from '@/hooks/useMotion';
import { hapticSuccess } from '@/utils/haptics';
import { T, withAlpha } from '@/constants/theme';

// 캐릭터 생성기(자립 컴포넌트) — 앨범/카메라로 사물 사진을 얻으면 온디바이스 누끼(Vision) 후
// 만화 팔·다리·눈을 붙여 "내 물건이 공부하는" 모습을 만든다. "저장"하면 합성된 미리보기를
// 그대로 캡처(captureRef)해 팔다리·눈까지 구워진 투명 PNG로 기기에 영구 저장하고 그 경로를
// onSaved로 돌려준다.
//
// ⚠️ 이 컴포넌트는 useNavigation·useCharacter를 쓰지 않는다(완전 자립) — NavigationContainer·
//    CharacterProvider 밖(온보딩 Modal)에서도 그대로 동작해야 하기 때문이다. 화면 크롬(뒤로가기·
//    저장 후 이동/반영)은 감싸는 쪽(설정 화면 래퍼 / 온보딩 Modal)이 onSaved로 처리한다.

const STAGE_HEIGHT = 340; // 캐릭터가 서는 무대 높이

// ─────────────────────────────────────────────────────────────────────────────
// 누끼 완성 리빌 (GROMO-1494 · 정책 D21 — 누끼 완성은 축하 표면 등급 3)
//
// ⚠️ 이 화면의 비동기 대기는 **연속된 3단계가 아니다.** 누끼(`working`)가 끝나면 곧바로
//    `ready`로 돌아오고, 확인(모더레이션)·저장은 **사용자가 저장 버튼을 누른 뒤에야** 시작한다.
//    그래서 진행 표시도 **두 구간으로 나눈다**:
//
//      ① 누끼 구간(`working`) — 사용자가 가장 오래 기다리는 곳이자 **리빌의 대상**이다.
//         끝나는 순간이 축하(등급 3): 리빌 + hapticSuccess.
//      ② 저장 구간(`checking`→`saving`) — 별개의 짧은 대기다. **진행 표시일 뿐 축하가 아니다.**
//         리빌·햅틱·파티클을 여기에 붙이지 않는다(D21이 등급 3을 준 것은 누끼 완성 순간이다).
//
//    셋을 한 진행 신호로 묶으면 링이 사용자 입력을 기다리며 멈춰 있거나, 리빌이 누끼 완료와
//    어긋난 순간에 터진다 — 이 티켓의 핵심인 "기다림의 보상"이 엉뚱한 자리로 간다.
type StagePhase = 'working' | 'checking' | 'saving';

// 저장 구간은 확인 → 저장 2단계다. 확정 진행률은 **단계 경계에서만** 오른다 — 단계 안쪽의
// 진척률은 어디에서도 오지 않는다(모더레이션 API는 진행 신호를 주지 않는다).
const SAVE_TOTAL = 2;
const SAVE_STEP: Record<'checking' | 'saving', number> = { checking: 1, saving: 2 };
// 누끼 구간은 단계가 하나라 오를 경계가 없다. 호 길이를 고정해 두고 **회전**이 상태를 말한다.
// ⚠️ 진행률 0이면 호 길이도 0이라 아무것도 그려지지 않는다 — 회전만 도는 빈 원은 '굳은 것'과
//    구분되지 않는다. 그래서 불확정 구간에도 보이는 호를 남긴다.
const INDETERMINATE_ARC = 0.3;

const STAGE_LABEL: Record<StagePhase, string> = {
  working: '물건만 오려내는 중…',
  checking: '이미지를 확인하는 중…',
  saving: '캐릭터로 저장하는 중…',
};

// 구간별 링 진행률. 두 구간은 서로 다른 척도라 이어 붙이지 않는다.
function stageProgress(stage: StagePhase): number {
  return stage === 'working' ? INDETERMINATE_ARC : SAVE_STEP[stage] / SAVE_TOTAL;
}

const RING_SIZE = 104;
const RING_STROKE = 7;
const SPIN_MS = 1600; // 불확정 회전 한 바퀴

// 리빌 — 마스크가 위에서 아래로 벗겨지며 캐릭터가 드러난다.
const REVEAL_MS = M.dur.celebrate; // 1200 (등급 3 예산)
const POP_AT = REVEAL_MS / 2; // 물체 팝 시작 = 리빌 50% 지점 → 정점이 리빌 끝에 맞는다
const OBJECT_FROM = 0.86; // 팝 시작 크기 (가려져 있는 동안 미리 앉혀 둔다)
const SCAN_FADE_FROM = 0.86; // 스캔선이 사라지기 시작하는 지점

interface CutoutRevealProps {
  // 결과가 실제로 그려질 수 있는가(=오브젝트 이미지 디코드 완료). 리빌은 이게 참이 된 뒤에
  // 시작한다 — 아직 안 그려진 그림에서 마스크를 벗기면 빈자리가 드러난다.
  armed: boolean;
  // 완성 통보(문구)를 띄우라는 신호. 햅틱은 이 컴포넌트가 직접 낸다.
  onCelebrate: () => void;
  // 캡처 대상(captureViewRef)을 품은 미리보기.
  children: ReactNode;
}

// 누끼가 완성된 순간의 리빌 연출.
//
// ⚠️ **실행마다 새로 마운트한다**(호출부의 `key={revealKey}`). 진입 연출의 결정 경계는 마운트다
//    (useMotion 계약) — 같은 노드를 재사용하며 shared value만 되감으면, 이미 1로 안착한 물체가
//    0.86으로 순간 이동했다가 다시 튀어오른다.
// ⚠️ 마스크·스캔선은 반드시 캡처 대상(children 안의 captureViewRef) **바깥**에 둔다. 안에 두면
//    저장 PNG에 마스크 패널이 함께 구워진다. 팝 스케일도 같은 이유로 바깥 래퍼에 건다.
function CutoutReveal({ armed, onCelebrate, children }: CutoutRevealProps) {
  const m = useMotion();
  // 0 = 마스크가 덮은 시작 프레임, 1 = 완전히 드러남.
  const reveal = useSharedValue(0);
  const objScale = useSharedValue(OBJECT_FROM);
  // 마스크가 내려갈 거리 = 미리보기 높이. onLayout 전에는 0이라 마스크가 제자리에서 덮은 채다.
  const [boxHeight, setBoxHeight] = useState(0);
  const [masked, setMasked] = useState(true);
  // 완성 통보는 실행당 **한 번**이다. 재생 도중 '동작 줄이기'가 켜져 effect가 다시 돌아도
  // 햅틱이 두 번 나가면 안 된다.
  const celebratedRef = useRef(false);

  useEffect(() => {
    // 오브젝트가 아직 디코드 중이면 마스크를 덮은 채 기다린다 — 벗겨 봐야 빈자리다.
    if (!armed) return;
    // D18 — 이 표면은 **진입 연출**(없던 캐릭터가 나타난다) 갈래다. 확정 전에는 시작 프레임
    // (마스크가 덮은 상태)에서 기다린다. 어느 쪽으로 확정되든 이어지는 그림에 끊김이 없다.
    if (!m.ready) return;

    const celebrate = (): void => {
      if (celebratedRef.current) return;
      celebratedRef.current = true;
      // ⚠️ '동작 줄이기'여도 **완성 통보와 햅틱은 남는다** (정책 D21 · 정본 D7).
      //    사용자가 끈 것은 움직임이지 보상이 아니다.
      hapticSuccess();
      onCelebrate();
    };

    if (m.reduce) {
      // 리빌·팝만 생략하고 최종 상태로 간다.
      reveal.value = 1;
      objScale.value = 1;
      setMasked(false);
      celebrate();
      return;
    }

    reveal.value = withTiming(1, {
      duration: REVEAL_MS,
      easing: M.curve.standard.fn,
      // withTiming을 직접 부를 땐 내장 게이트를 명시적으로 끈다 (정책 D6).
      reduceMotion: M.never,
    });
    // 리빌 50% — 물체가 튀어 오르고 완성을 통보한다(축하의 정점을 리빌 끝에 맞춘다).
    const popTimer = setTimeout(() => {
      // M.spring.bouncy에는 reduceMotion: Never가 이미 박혀 있다.
      objScale.value = withSpring(1, M.spring.bouncy);
      celebrate();
    }, POP_AT);
    // 다 벗긴 뒤 마스크·스캔선을 걷는다 — 남겨 두면 캐릭터 위에 빈 레이어가 계속 붙어 있다.
    const endTimer = setTimeout(() => setMasked(false), REVEAL_MS);
    return () => {
      clearTimeout(popTimer);
      clearTimeout(endTimer);
    };
    // ⚠️ m을 의존성에 — 재생 도중 '동작 줄이기'가 켜지면 위 reduce 분기가 다시 돌아
    //    반쯤 벗겨진 마스크로 굳지 않는다(D18 재생 중 전환 = 즉시 최종 상태).
  }, [armed, m, onCelebrate, reveal, objScale]);

  const maskStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: reveal.value * boxHeight }],
  }));
  const scanStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: reveal.value * boxHeight }],
    opacity:
      reveal.value < SCAN_FADE_FROM
        ? 1
        : Math.max(0, 1 - (reveal.value - SCAN_FADE_FROM) / (1 - SCAN_FADE_FROM)),
  }));
  const objStyle = useAnimatedStyle(() => ({
    // 발이 책상에 붙은 채로 튄다 — 가운데 원점으로 두면 물체가 바닥에서 떠오른다.
    transformOrigin: '50% 100%',
    transform: [{ scale: objScale.value }],
  }));

  return (
    <View onLayout={(e) => setBoxHeight(e.nativeEvent.layout.height)}>
      <Animated.View style={objStyle}>{children}</Animated.View>
      {masked ? (
        <>
          <View pointerEvents="none" style={s.maskClip}>
            <Animated.View testID="character.reveal.mask" style={[s.maskPanel, maskStyle]} />
          </View>
          <Animated.View pointerEvents="none" style={[s.scanLine, scanStyle]} />
        </>
      ) : null}
    </View>
  );
}

// 쿼터 초기화 시각(ISO) → "N월 N일에 다시 만들 수 있어요." 안내 문구.
// resetAt이 없거나 파싱이 안 되면 날짜 없는 일반 안내로 폴백한다.
// 한도는 달력 주가 아니라 롤링 7일이라("이번 주"가 아니라) 폴백도 주 단위로 말하지 않는다.
function formatResetLabel(resetAt: string | null): string {
  if (!resetAt) return '조금 뒤에 다시 만들 수 있어요.';
  const d = new Date(resetAt);
  if (Number.isNaN(d.getTime())) return '조금 뒤에 다시 만들 수 있어요.';
  return `${d.getMonth() + 1}월 ${d.getDate()}일에 다시 만들 수 있어요.`;
}

type Phase = 'idle' | 'working' | 'ready' | 'checking' | 'saving';

interface Props {
  // 저장 완료 시 만들어진 커스텀 캐릭터의 file:// 경로를 넘긴다.
  onSaved: (uri: string) => void;
  // 유저별 파일로 저장하기 위한 userId(JWT sub). 이 컴포넌트는 context-free라 직접 얻지 못하므로
  // 감싸는 쪽(설정 화면=useUser / 온보딩=토큰 디코드)이 넘긴다. 없으면 단일 파일명으로 폴백한다.
  userId?: string | null;
  // 서버 모더레이션이 '검사 불가(unavailable)'로 막았을 때 알린다(선택). 온보딩처럼 저장을
  // 강제하는 화면이, 검사 불가일 때만 다른 진행 경로(스킵 등)를 열어 갇힘을 피하게 하기 위함.
  onUnavailable?: () => void;
}

export default function CharacterCreator({ onSaved, userId, onUnavailable }: Props) {
  const { width } = useWindowDimensions();

  const [phase, setPhase] = useState<Phase>('idle');
  const [result, setResult] = useState<SubjectMaskResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 오브젝트 이미지 디코드 완료 여부 — cutout 반환 즉시 phase는 ready가 되지만 <Image>가
  // 아직 디코딩 중일 수 있어, 그 전에 저장하면 captureRef가 사진 물체가 빠진 채로 굽는다.
  // 새 결과·회전으로 uri가 바뀌면 false로 리셋하고 ObjectCharacter onLoad에서 다시 true로.
  const [imageLoaded, setImageLoaded] = useState(false);

  const m = useMotion();
  // 리빌 실행 키 — 누끼가 **성공**할 때마다 새 값이 되어 CutoutReveal을 새로 마운트시킨다.
  // 0이면 리빌할 것이 없다(폴백 결과·회전만 한 결과는 리빌하지 않는다 — D21은 '누끼 완성'이다).
  // ⚠️ 값이 재사용되면 key가 같아 리마운트가 안 되므로 되돌리지 않는 시퀀스로 만든다.
  const revealSeqRef = useRef(0);
  const [revealKey, setRevealKey] = useState(0);
  // 완성 통보가 나갔는가. 리빌 50%(‘동작 줄이기’면 즉시)에 참이 된다.
  const [celebrated, setCelebrated] = useState(false);
  const handleCelebrate = useCallback(() => setCelebrated(true), []);

  // 생성 쿼터 — 마운트 시 1회 조회. quotaLoading은 조회 완료 전까지 true(깜빡임 최소화용).
  // quota===null은 '조회 실패'로, fail-open(생성 허용)으로 다룬다(쿼터는 제한이지 안전이 아님).
  const [quota, setQuota] = useState<CharacterQuota | null>(null);
  const [quotaLoading, setQuotaLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      const q = await getCharacterQuota();
      if (!alive) return;
      setQuota(q);
      setQuotaLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, []);

  // 제한 사용자이면서 남은 횟수가 0 이하 → 생성 차단. (unlimited이거나 조회 실패(null)면 허용.)
  // 개발(Debug) 빌드에선 차단을 건너뛴다 — 테스트 중 반복 생성이 쿼터에 막히지 않게. Release
  // (TestFlight·스토어)는 번들러가 __DEV__를 false로 인라인해 그대로 제한이 걸린다. 서버는
  // 손대지 않는다(dev 서버 = 스테이징이라 프로덕션과 동작이 같아야 함).
  // 차단 뷰 자체를 확인하려면 아래 `!__DEV__ &&`를 잠시 지우면 된다.
  const blocked = !__DEV__ && quota != null && !quota.unlimited && (quota.remaining ?? 0) <= 0;
  // 제한 구간이지만 남은 횟수가 있으면 은은히 안내(과하지 않게).
  // 한도는 달력 주가 아니라 롤링 7일이라 "이번 주"로 말하지 않는다.
  const remainingHint =
    quota != null && !quota.unlimited && (quota.remaining ?? 0) > 0
      ? `앞으로 ${quota.remaining}번 만들 수 있어요`
      : null;

  // 차단(쿼터 소진) 상태로 화면을 켜둔 채 resetAt을 넘기면(예: 밤새 백그라운드) 마운트 1회
  // 조회만으론 새로 초기화된 쿼터를 못 받아 계속 차단 뷰에 머문다. 앱이 다시 활성화될 때
  // 재조회해 자동으로 풀리게 한다(스피너로 되돌리지 않게 quotaLoading은 건드리지 않는다).
  useEffect(() => {
    if (!blocked) return;
    let alive = true;
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      getCharacterQuota().then((q) => {
        if (alive) setQuota(q);
      });
    });
    return () => {
      alive = false;
      sub.remove();
    };
  }, [blocked]);

  // 합성 미리보기를 감싸는 컨테이너 — 저장 시 이 View를 통째로 캡처해 PNG로 굽는다.
  const captureViewRef = useRef<View>(null);

  // 언마운트(온보딩 모달 X·설정 뒤로가기)로 화면이 사라졌는지. 저장은 검사(최대 15초)→저장 순인데,
  // 그 사이 창을 닫아도 promise는 계속 돈다. 취소 시 뒤늦게 저장·onSaved가 실행돼 "닫았는데 등록됨"이
  // 되지 않도록, await 지점마다 이 ref로 확인해 이후 부수효과를 건너뛴다.
  const activeRef = useRef(true);
  useEffect(() => {
    activeRef.current = true;
    return () => {
      activeRef.current = false;
    };
  }, []);

  const supported = useMemo(() => isSubjectMaskSupported(), []);
  const stageWidth = width - T.space.xl * 2 - T.space.xl;

  // 얻은 사진(앨범/카메라 공통)을 같은 누끼 흐름에 태운다.
  const runCutout = useCallback(async (asset: ImagePicker.ImagePickerAsset) => {
    setPhase('working');
    setImageLoaded(false); // 새 물체 이미지 — 디코드 완료 전까지 저장 잠금
    setCelebrated(false); // 이전 실행의 완성 통보를 지운다
    setRevealKey(0);
    try {
      const cut = await cutoutSubject(asset.uri, {
        width: asset.width ?? 0,
        height: asset.height ?? 0,
      });
      setResult(cut);
      setError(cut.cutout ? null : subjectMaskReasonLabel(cut.reason));
      // 리빌은 **누끼가 실제로 성공했을 때만** 건다. 폴백(원본 그대로)은 축하할 일이 아니고,
      // 마스크를 씌우면 벗길 이유가 없는 레이어만 남는다.
      if (cut.cutout) {
        revealSeqRef.current += 1;
        setRevealKey(revealSeqRef.current);
      }
      setPhase('ready');
    } catch {
      // ⚠️ 누끼가 던져도 진행 링이 'working'에 굳으면 안 된다 — 사진을 고르기 전 상태로 되돌린다.
      setError('사진에서 물건을 오려내지 못했어요. 다시 시도해 주세요.');
      setPhase('idle');
    }
  }, []);

  // 앨범에서 고르기
  const pick = useCallback(async () => {
    setError(null);
    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 1,
      allowsMultipleSelection: false,
    }).catch(() => null);

    if (!picked || picked.canceled || !picked.assets?.length) return;
    await runCutout(picked.assets[0]);
  }, [runCutout]);

  // 카메라로 찍기 — 권한을 먼저 요청하고, 거부되면 해요체로 안내한다.
  const takePhoto = useCallback(async () => {
    setError(null);
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      setError('카메라 권한이 필요해요. 설정에서 카메라 접근을 허용해 주세요.');
      return;
    }
    const shot = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      quality: 1,
    }).catch(() => null);

    if (!shot || shot.canceled || !shot.assets?.length) return;
    await runCutout(shot.assets[0]);
  }, [runCutout]);

  // 시계방향 90도 회전 — 현재 물체 PNG를 90도 돌려 다시 굽는다(탭할 때마다 90도씩 누적).
  // 90도 회전은 가로·세로가 뒤바뀌므로 결과 크기를 그대로 받아 aspect를 갱신한다.
  const rotate = useCallback(async () => {
    if (!result) return;
    try {
      const context = ImageManipulator.manipulate(result.uri);
      context.rotate(90);
      const image = await context.renderAsync();
      const out = await image.saveAsync({ format: SaveFormat.PNG });
      setImageLoaded(false); // 회전된 새 이미지 — 디코드 완료 전까지 저장 잠금
      setResult((prev) =>
        prev ? { ...prev, uri: out.uri, width: out.width, height: out.height } : prev,
      );
    } catch {
      setError('사진을 돌리지 못했어요. 다시 시도해 주세요.');
    }
  }, [result]);

  // 다시 고르기 — 사진을 고르기 전(idle) 상태로 완전히 되돌린다. 누끼 결과(result)에는 회전으로
  // 누적된 uri·크기까지 들어 있으므로 result를 비우면 편집 상태가 함께 사라지고, 에러 배너와
  // 디코드 완료 플래그도 같이 초기화해 다음 사진이 깨끗한 상태에서 시작되게 한다.
  const resetPick = useCallback(() => {
    setResult(null);
    setError(null);
    setImageLoaded(false);
    // 연출 상태도 함께 초기화 — 다음 사진이 완성 통보가 남은 채로 시작하지 않게.
    setCelebrated(false);
    setRevealKey(0);
    setPhase('idle');
  }, []);

  // 저장 — 합성 미리보기를 캡처해 투명 PNG로 굽고 영구 저장한 뒤 경로를 onSaved로 돌려준다.
  // 단, 저장 전 서버 모더레이션(필수 관문)을 통과해야 한다. 막히면 저장·onSaved 하지 않는다.
  const save = useCallback(async () => {
    if (!result) return;
    setError(null);
    setPhase('checking');
    try {
      // 1) 합성본 캡처 — 서버 모더레이션과 저장에 같은 base64를 쓴다.
      const base64 = await captureRef(captureViewRef, { format: 'png', result: 'base64' });

      // 2) 서버 모더레이션(필수 게이트) — 통과해야만 저장한다. 검사 불가(unavailable)는 fail-safe로
      //    차단하되, "위반 차단"과 "확인 실패"를 안내 문구로 구분한다.
      const verdict = await moderateImage(base64);
      // 검사 도중 창을 닫았으면(언마운트) 이후 아무 것도 하지 않는다.
      if (!activeRef.current) return;
      if (verdict.unavailable) {
        setError('지금은 확인이 어려워요. 잠시 후 다시 시도해 주세요.');
        setPhase('ready');
        // 저장을 강제하는 화면(온보딩)이 갇히지 않게, 검사 불가만 별도로 알린다.
        onUnavailable?.();
        return;
      }
      if (!verdict.allowed) {
        setError('이 사진으로는 캐릭터를 만들 수 없어요.');
        setPhase('ready');
        return;
      }

      // 3) 통과 → 기존 저장 흐름. userId를 넘겨 유저별 파일로 저장 — 한 기기 두 계정이 서로 덮어쓰지 않게 한다.
      setPhase('saving');
      const uri = await saveCustomCharacter(base64, userId);
      // 저장 도중 창을 닫았으면(언마운트) onSaved를 건너뛴다 — 닫힌 화면에 캐릭터가 뒤늦게 붙는 걸 막는다.
      if (!activeRef.current) return;
      // 위젯·실드가 읽는 App Group 스냅샷(focusCharacter.png)은 여기서 발행하지 않는다 —
      // '생성'은 '장착'이 아니라(생성 후에도 choice는 default 유지) 여기서 발행하면 미장착 커스텀이
      // 위젯·실드에 먼저 떠 버린다(코드리뷰). 스냅샷은 집중 세션이 장착된 캐릭터로 갱신하며,
      // 장착 즉시 반영은 후속 작업이다.
      // 저장 성공 → 생성 1건을 서버 쿼터에 기록(best-effort). 네트워크 지연·타임아웃이 완료를
      // 막지 않도록 await 하지 않고 발사만 한다(함수 내부에서 실패를 이미 삼킨다).
      recordCharacterGeneration().catch(() => {});
      onSaved(uri);
    } catch {
      setError('캐릭터를 저장하지 못했어요. 다시 시도해 주세요.');
      setPhase('ready');
    }
  }, [result, onSaved, userId, onUnavailable]);

  const aspect = result && result.height > 0 ? result.width / result.height : 1;
  // 지금 진행 표시를 띄워야 하는 단계인가. 누끼(working)·검사(checking)·저장(saving) 셋 다
  // 도구·저장 버튼을 잠근다 — 잠그지 않으면 captureRef가 바뀌는 중인 타깃을 잡는다.
  const stage: StagePhase | null =
    phase === 'working' || phase === 'checking' || phase === 'saving' ? phase : null;
  const busy = stage !== null;

  // 불확정 회전 — 단계 안쪽은 진척률을 알 수 없어 링 전체가 돈다.
  // ⚠️ 이 화면의 **유일한 무한 루프**다(IA §2 화면당 1개 상한). 그래서 busy가 풀리는 즉시 멈춘다.
  // ⚠️ D18 무한 루프 갈래 — 확정 전(`!m.ready`)에도, 재생 도중 켜져도(`m.reduce`) **정지**다.
  //    무한 루프는 켜지지 않은 상태가 곧 최종 상태라 정지가 곧 대기다.
  const spin = useSharedValue(0);
  useEffect(() => {
    if (!busy || !m.ready || m.reduce) {
      cancelAnimation(spin);
      spin.value = 0;
      return;
    }
    spin.value = 0;
    spin.value = withRepeat(
      withTiming(360, { duration: SPIN_MS, easing: Easing.linear, reduceMotion: M.never }),
      -1,
      false,
      undefined,
      // ⚠️ withRepeat은 **다섯 번째** 인자로 게이트를 받는다. 안 넘기면 기본값(정적 System)이
      //    걸려 '동작 줄이기'를 켠 채 켰다가 끈 사용자에게 회전이 영영 돌지 않는다.
      M.never,
    );
    return () => cancelAnimation(spin);
  }, [busy, m.ready, m.reduce, spin]);
  const spinStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${spin.value}deg` }] }));

  // 쿼터 소진 → 사진 선택/생성 UI 대신 차단 뷰. 뒤로/닫기는 감싸는 화면 크롬이 담당한다.
  if (blocked) {
    return (
      <View style={[s.flex1, s.blocked]}>
        <Ionicons name="time-outline" size={44} color={T.inkMuted} />
        <Text style={s.blockedTitle}>캐릭터 만들기 횟수를 다 썼어요.</Text>
        <Text style={s.blockedSub}>{formatResetLabel(quota?.resetAt ?? null)}</Text>
      </View>
    );
  }

  // 저장 시 이 컨테이너를 통째로 캡처한다(배경 투명 → 팔다리·눈까지 구워진 PNG).
  // ⚠️ 리빌의 마스크·스캔선·팝 스케일은 전부 이 바깥에 있다 — 안에 두면 PNG에 함께 구워진다.
  const preview = result ? (
    <View ref={captureViewRef} collapsable={false}>
      <ObjectCharacter
        uri={result.uri}
        aspect={aspect}
        maxWidth={stageWidth}
        maxHeight={STAGE_HEIGHT - 90}
        onLoad={() => setImageLoaded(true)}
      />
    </View>
  ) : null;

  // 무대(340 고정)+안내 배너+액션이 화면보다 길어질 수 있어 세로 스크롤을 허용한다. 배너는 상황에
  // 따라 여러 줄·여러 개(에러 + 생성 성공 + 남은 횟수)가 겹쳐 뜨는데, 액션이 marginTop:'auto'로
  // 바닥에 붙어 있어 작은 기기(SE 등)에서는 '저장' 버튼이 화면 밖으로 밀려 눌리지 않았다.
  // contentContainer는 flexGrow:1 — 자리가 남을 때는 지금처럼 액션이 바닥에 붙고(레이아웃 동일),
  // 모자랄 때만 스크롤이 생긴다.
  return (
    <ScrollView style={s.flex1} contentContainerStyle={s.body} showsVerticalScrollIndicator={false}>
      {/* 무대 — 단색 배경 + 책상 띠 위에 캐릭터가 선다 */}
      <View style={s.stage}>
        <View style={s.desk} />

        <View style={s.stageCenter}>
          {result ? (
            revealKey > 0 ? (
              // 누끼 완성 — 마스크가 벗겨지며 드러난다. key로 실행마다 새로 마운트한다.
              <CutoutReveal key={revealKey} armed={imageLoaded} onCelebrate={handleCelebrate}>
                {preview}
              </CutoutReveal>
            ) : (
              preview
            )
          ) : busy ? null : (
            <View style={s.center}>
              <Ionicons name="cube-outline" size={44} color={T.inkMuted} />
              <Text style={s.hint}>사진을 고르면 여기에 캐릭터가 서요</Text>
            </View>
          )}
        </View>

        {/* 진행 링 — 두 구간(누끼 / 저장)이 같은 표시를 쓰되 진행률의 척도는 서로 다르다.
            무대 전체를 옅게 덮어 작업 중임을 분명히 하고, 뒤의 캐릭터(숨쉬기 루프)가 회전과
            겹쳐 읽히지 않게 한다. */}
        {stage ? (
          <View style={s.progressLayer} pointerEvents="none">
            <Animated.View style={spinStyle}>
              <ProgressRing
                size={RING_SIZE}
                stroke={RING_STROKE}
                progress={stageProgress(stage)}
                color={T.accent}
                // 링이 도는 동안 퍼센트를 읽어 주면 오히려 틀린 정보다(단계 안쪽은 불확정이고,
                // 누끼 구간의 호는 아예 값이 아니다). 지금 무엇을 하는지는 아래 문구가 읽어 준다.
                decorative
                testID="character.progress"
              />
            </Animated.View>
            <Text style={s.hint}>{STAGE_LABEL[stage]}</Text>
          </View>
        ) : null}
      </View>

      {/* 상태 안내 — 누끼 폴백 사유 / 지원 여부 */}
      {error ? <Text style={s.notice}>{error}</Text> : null}
      {!supported && !error ? (
        <Text style={s.notice}>
          이 기기·빌드에서는 배경 제거가 지원되지 않아요. 원본 사진 그대로 보여줄게요.
        </Text>
      ) : null}
      {/* 완성 통보 — 리빌 50% 지점에 뜬다. '동작 줄이기'를 켜도 **이건 남는다**(정책 D21). */}
      {result?.cutout && celebrated ? <Text style={s.ok}>나만의 그로몬이 완성됐어요</Text> : null}
      {remainingHint ? <Text style={s.remaining}>{remainingHint}</Text> : null}

      <View style={s.actions}>
        {quotaLoading ? (
          // 쿼터 확인 전엔 액션 영역만 잠깐 로딩(무대는 그대로 유지 → 깜빡임 최소화).
          <View style={s.center}>
            <ActivityIndicator color={T.accent} />
          </View>
        ) : result ? (
          <>
            {/* 도구 — 회전 / 다시 고르기(사진 고르기 전 상태로 되돌리기) */}
            <View style={s.toolRow}>
              <TouchableOpacity
                style={s.tool}
                onPress={rotate}
                disabled={busy}
                activeOpacity={0.85}
              >
                <Ionicons name="refresh-outline" size={20} color={T.ink} />
                <Text style={s.toolText}>회전</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={s.tool}
                onPress={resetPick}
                disabled={busy}
                activeOpacity={0.85}
              >
                <Ionicons name="arrow-undo-outline" size={20} color={T.ink} />
                <Text style={s.toolText}>다시 고르기</Text>
              </TouchableOpacity>
            </View>

            {/* 저장 — 처리 중(busy)이거나 이미지 디코드 완료 전(imageLoaded=false)엔 잠근다 */}
            <TouchableOpacity
              style={[s.primary, (busy || !imageLoaded) && s.primaryDisabled]}
              onPress={save}
              disabled={busy || !imageLoaded}
              activeOpacity={0.85}
            >
              {busy ? (
                // ⚠️ 여기 스피너를 두지 않는다 — 진행 링이 이미 같은 신호를 무대에서 돌리고 있고,
                //    두 개를 같이 돌리면 화면당 무한 루프 1개 상한(IA §2)을 넘는다.
                <Text style={s.primaryText}>{phase === 'checking' ? '검사 중…' : '저장 중…'}</Text>
              ) : (
                <>
                  <Ionicons name="checkmark" size={18} color={T.white} />
                  <Text style={s.primaryText}>저장</Text>
                </>
              )}
            </TouchableOpacity>
          </>
        ) : (
          <>
            <TouchableOpacity style={s.primary} onPress={pick} activeOpacity={0.85}>
              <Ionicons name="images-outline" size={18} color={T.white} />
              <Text style={s.primaryText}>사진 고르기</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.secondary} onPress={takePhoto} activeOpacity={0.85}>
              <Ionicons name="camera-outline" size={18} color={T.accent} />
              <Text style={s.secondaryText}>사진 찍기</Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  flex1: { flex: 1 },
  // 스크롤 본문 — 자리가 남으면 뷰포트만큼 늘어나 actions의 marginTop:'auto'가 그대로 먹는다.
  body: { flexGrow: 1 },
  stage: {
    height: STAGE_HEIGHT,
    borderRadius: 20,
    backgroundColor: T.sandLight,
    borderWidth: 1,
    borderColor: T.border,
    overflow: 'hidden',
    justifyContent: 'flex-end',
  },
  // 책상 띠 — 캐릭터 발이 닿는 바닥
  desk: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 64,
    backgroundColor: T.sand,
  },
  stageCenter: { flex: 1, alignItems: 'center', justifyContent: 'flex-end', paddingBottom: 52 },
  center: { alignItems: 'center', gap: T.space.sm, paddingBottom: 40 },
  hint: { ...T.text.caption, color: T.inkMuted },

  // 진행 링 레이어 — 무대를 옅게 덮는다. 완전히 불투명하게 하면 책상 띠가 사라져 무대가 흔들린다.
  progressLayer: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    gap: T.space.md,
    backgroundColor: withAlpha(T.sandLight, 0.88),
  },

  // 리빌 마스크 — 미리보기를 덮은 패널이 자기 높이만큼 아래로 내려가며 벗겨진다.
  // 잘라내기 컨테이너를 따로 두는 이유: 패널을 translateY로 밀어내고 **넘친 부분을 잘라야**
  // height 애니메이션(매 프레임 레이아웃 패스) 없이 같은 그림이 나온다.
  maskClip: { ...StyleSheet.absoluteFill, overflow: 'hidden' },
  maskPanel: {
    ...StyleSheet.absoluteFill,
    backgroundColor: T.paperAlt,
    borderWidth: 1,
    borderColor: T.border,
    borderRadius: 12,
  },
  // 벗겨지는 경계를 따라가는 스캔선. 잘라내기 컨테이너 밖에 둬야 좌우로 조금 넘칠 수 있다.
  scanLine: {
    position: 'absolute',
    left: -10,
    right: -10,
    top: 0,
    height: 2,
    borderRadius: 2,
    backgroundColor: T.accent,
  },

  // 쿼터 소진 차단 뷰
  blocked: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: T.space.md,
    paddingHorizontal: T.space.xl,
  },
  blockedTitle: { ...T.text.subtitle, color: T.ink, textAlign: 'center' },
  blockedSub: { ...T.text.body, color: T.inkMuted, textAlign: 'center' },
  // 남은 횟수 은은한 안내
  remaining: { ...T.text.caption, color: T.inkMuted, textAlign: 'center', marginTop: T.space.md },

  notice: {
    ...T.text.caption,
    color: T.dangerInk,
    backgroundColor: T.dangerBg,
    borderWidth: 1,
    borderColor: T.dangerBorder,
    borderRadius: 12,
    padding: T.space.md,
    marginTop: T.space.lg,
  },
  ok: {
    ...T.text.caption,
    color: T.successInk,
    backgroundColor: T.successBg,
    borderWidth: 1,
    borderColor: T.successBorder,
    borderRadius: 12,
    padding: T.space.md,
    marginTop: T.space.lg,
  },

  actions: { marginTop: 'auto', paddingTop: T.space.xl, gap: T.space.md },
  // 도구 2버튼 한 줄 — 회전 / 다시 고르기
  toolRow: { flexDirection: 'row', gap: T.space.md },
  tool: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: T.space.xs,
    height: 48,
    borderRadius: 14,
    backgroundColor: T.paperAlt,
    borderWidth: 1,
    borderColor: T.border,
  },
  toolText: { ...T.text.caption, color: T.ink },
  primary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: T.space.sm,
    height: 54,
    borderRadius: 16,
    backgroundColor: T.accent,
  },
  primaryDisabled: { opacity: 0.6 },
  primaryText: { ...T.text.subtitle, color: T.white },
  secondary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: T.space.sm,
    height: 54,
    borderRadius: 16,
    backgroundColor: T.paper,
    borderWidth: 1,
    borderColor: T.accent,
  },
  secondaryText: { ...T.text.subtitle, color: T.accent },
});
