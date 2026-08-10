import { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Pressable,
  Alert,
  AppState,
  StyleSheet,
  useWindowDimensions,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { T } from '@/constants/theme';
import { useFocus } from '@/store/FocusContext';
import { useSubjects } from '@/store/SubjectContext';
import { useFocusCategory } from '@/hooks/useFocusCategory';
import { occupationForCategory } from '@/constants/focusCategories';
import { getDefaultTags } from '@/services/focusApi';
import { STORAGE_KEYS } from '@/types/storage';
import { TabGuideOverlay } from '@/components/TabGuideOverlay';
import { PressableScale } from '@/components/PressableScale';
import { playTapSound } from '@/utils/sound';
import type { V2RootStackParamList } from '@/navigation/types';
import type { FocusTimerMode, PomodoroConfig, Subject } from './types';
import { DraggableSubjectRows } from './components/DraggableSubjectRows';
import { TimerMethodSheet } from './components/TimerMethodSheet';
import { SLIDE_MS } from '@/components/liquidGlass';
import { useMotion } from '@/hooks/useMotion';
import { CountdownSetupSheet } from './components/CountdownSetupSheet';
import { PomodoroSetupSheet } from './components/PomodoroSetupSheet';
import {
  logFocusTagCreated,
  logFocusTagUpdated,
  logFocusTagDeleted,
} from '@/services/analyticsEvents';
import {
  invalidateCardInteraction,
  normalizeFocusEntrySource,
  resolveFocusSessionRouteContext,
} from '@/services/cardInteraction';

// 02 과목 선택 — 홈 ● 집중 FAB → 이 화면. 행 탭 → 타이머 방식 시트(03) → 설정(04/05) → 세션.
// 각 행: 과목명 + 누적 집중시간 + ⋮(탭=이름편집/삭제 팝오버, 잡고 위아래=순서 변경).
// 리스트 아래에는 준비 시험(occupation) 추천 과목 중 미보유분을 노출해 추가를 유도한다(GROMO-668).
type SheetKind = null | 'method' | 'countdown' | 'pomodoro';
// ⋮ 팝오버 위치(측정한 버튼의 window 좌표)
type MenuAnchor = { id: string; x: number; y: number; w: number; h: number } | null;

export default function FocusCategoryScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<V2RootStackParamList>>();
  // 그룹방 FAB로 진입했으면 initialGroupId를 세션까지 넘겨 그 그룹 페이지를 기본으로 연다(F2 Part2).
  const { params } = useRoute<RouteProp<V2RootStackParamList, 'FocusCategory'>>();
  const initialGroupId = params?.initialGroupId;
  const entrySource = normalizeFocusEntrySource(params?.entrySource);
  const interactionId = entrySource === 'group_card' ? params?.interactionId : undefined;
  const interactionAcceptedAt =
    entrySource === 'group_card' ? params?.interactionAcceptedAt : undefined;
  const interactionTransferredRef = useRef(false);
  const startTransitionRef = useRef(false);
  const navigationCheckTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    interactionTransferredRef.current = false;
    startTransitionRef.current = false;
    // CTA 수락 뒤 이 화면이 마운트되기 전에 앱이 이미 background가 된 경우 listener는 그
    // 전환을 받지 못한다. 현재 상태도 먼저 확인해 오래된 intent를 복귀 뒤 세션에 넘기지 않는다.
    if (AppState.currentState === 'inactive' || AppState.currentState === 'background') {
      invalidateCardInteraction(interactionId);
    }
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') invalidateCardInteraction(interactionId);
    });
    // 화면 단위 얕은 테스트처럼 listener 표면이 없는 navigation host도 안전하게 수용한다.
    // 실제 React Navigation에서는 두 구독이 그대로 등록된다.
    const blurSub = navigation.addListener?.('blur', () => {
      if (!startTransitionRef.current) invalidateCardInteraction(interactionId);
    });
    const focusSub = navigation.addListener?.('focus', () => {
      startTransitionRef.current = false;
    });
    return () => {
      sub.remove();
      blurSub?.();
      focusSub?.();
      if (navigationCheckTimerRef.current) clearTimeout(navigationCheckTimerRef.current);
      if (!interactionTransferredRef.current) invalidateCardInteraction(interactionId);
    };
  }, [navigation, entrySource, interactionId, interactionAcceptedAt]);
  const { width: winW } = useWindowDimensions();
  const { subjects, addSubject, renameSubject, deleteSubject, reorderSubjects, setSubjectColor } =
    useSubjects();
  const { removeFocusSeconds } = useFocus();
  // Alert.prompt 콜백은 입력창을 연 순간의 subjects 클로저를 봐서, 입력창이 떠 있는 동안
  // 저장소/서버 복원이 끝나면 낡은 목록(시드)으로 중복 검사를 하게 된다(PR 288 Codex 리뷰).
  // 항상 최신 목록으로 검사하도록 ref를 경유한다.
  const subjectsRef = useRef<Subject[]>(subjects);
  useEffect(() => {
    subjectsRef.current = subjects;
  }, [subjects]);
  const [selectedId, setSelectedId] = useState<string>('');
  const [sheet, setSheet] = useState<SheetKind>(null);
  const [menu, setMenu] = useState<MenuAnchor>(null);
  const [colorMenu, setColorMenu] = useState<MenuAnchor>(null); // 색 선택 팝오버(네모 탭)

  // 준비 시험 추천 과목(GET /tag/defaults) — 미보유분만 리스트 아래에 추가 유도로 노출.
  // 조회 실패(미로그인·오프라인)면 조용히 숨긴다.
  const category = useFocusCategory();
  const [defaultTags, setDefaultTags] = useState<string[]>([]);
  // 추천 목록 조회 완료 여부 — 로딩 중엔 기본 과목 판별이 불가능하므로 이름 편집을 잠시 숨긴다
  // (fail-closed, PR 287 Codex 리뷰 반영). 조회 실패는 완료로 취급해 기존처럼 편집을 허용한다
  // (오프라인 fail-open — 이때는 서버 태그 동기화도 안 되는 상태라 영향이 제한적).
  const [defaultsReady, setDefaultsReady] = useState(false);
  useEffect(() => {
    // 카테고리 저장값을 아직 읽는 중(undefined) — "카테고리 없음"과 구분해 fail-closed 유지.
    // 이 분기 없이는 로딩 순간을 무카테고리로 오판해 ready가 켜져 기본 과목의 이름 편집이
    // 잠깐 노출된다(PR 287 Codex 리뷰 반영).
    if (category === undefined) {
      setDefaultsReady(false);
      return;
    }
    const occupation = occupationForCategory(category);
    if (!occupation) {
      setDefaultTags([]);
      setDefaultsReady(true); // 추천 과목이 없는 카테고리 — 판별할 기본 과목도 없음
      return;
    }
    let cancelled = false;
    setDefaultsReady(false);
    getDefaultTags(occupation)
      .then((res) => {
        if (cancelled) return;
        setDefaultTags([...res.tags].sort((a, b) => a.sortOrder - b.sortOrder).map((t) => t.name));
      })
      .catch(() => {
        // 실패 시 이전 카테고리의 추천이 남아 새 카테고리 라벨로 노출되지 않게 비운다(리뷰 반영)
        if (!cancelled) setDefaultTags([]);
      })
      .finally(() => {
        if (!cancelled) setDefaultsReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [category]);
  const ownedNames = new Set(subjects.map((x) => x.name));
  const recommended = defaultTags.filter((n) => !ownedNames.has(n));

  // 추천 섹션 접힘 토글 — AsyncStorage에 저장해 화면을 다시 열어도 유지
  const [recoHidden, setRecoHidden] = useState(false);
  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEYS.focusRecoHidden).then((v) => setRecoHidden(v === '1'));
  }, []);
  function toggleRecoHidden() {
    setRecoHidden((prev) => {
      const next = !prev;
      AsyncStorage.setItem(STORAGE_KEYS.focusRecoHidden, next ? '1' : '0').catch(() => {});
      return next;
    });
  }

  // 선택 과목 — 미선택/삭제 시 첫 과목으로 폴백.
  const active = subjects.find((x) => x.id === selectedId) ?? subjects[0];
  const menuSubject = menu ? subjects.find((x) => x.id === menu.id) : undefined;
  const colorSubject = colorMenu ? subjects.find((x) => x.id === colorMenu.id) : undefined;

  // 다른 과목을 고르면 유리 알약 슬라이드(GROMO-848)가 보이도록 시트를 슬라이드 뒤에 연다.
  // 같은 과목 재탭은 이동이 없으니 바로 연다. 언마운트 시 예약 취소는 아래 useEffect.
  // ⚠️ 알약을 실제로 그리는 건 DraggableSubjectRows다(glassSlide). 연출과 이 대기 타이머는
  //    한 쌍이라 '동작 줄이기' 처리도 짝을 맞춰야 한다 — 아래 m.delay 참고.
  const m = useMotion();
  const methodTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // '동작 줄이기' 값이 **확정되기 전**(콜드 스타트의 비동기 조회 구간)에 들어온 탭을 담아 둔다.
  // 미확정 구간의 useMotion은 보수적으로 reduce=true라, 그대로 시작하면 대기가 0으로 눌려
  // 설정을 켜지 않은 사용자도 알약 슬라이드를 통째로 잃는다 — 일회성 시퀀스라 나중에 설정이
  // false로 확정돼도 되돌릴 수 없다(codex 리뷰). 탭 자체는 씹지 않고 여기 보관했다가
  // 확정된 값으로 시작한다. ready는 조회가 실패해도 반드시 확정되므로 영영 대기하지 않는다.
  const [pendingSubject, setPendingSubject] = useState<Subject | null>(null);
  function clearMethodTimer() {
    if (methodTimer.current) {
      clearTimeout(methodTimer.current);
      methodTimer.current = null;
    }
  }
  // 예약된 시트 열기 취소 — 어느 분기든 새 인터랙션(재탭·팝오버)이 시작되면 먼저 부른다.
  // 스테일 콜백이 남으면 닫은 시트가 뒤늦게 다시 열린다(코덱스 리뷰, PR 301).
  // 아직 시작 전인 보류 탭도 함께 버린다 — 팝오버를 연 뒤 시퀀스가 뒤늦게 터지면 같은 사고다.
  function cancelPendingMethodSheet() {
    clearMethodTimer();
    setPendingSubject(null);
  }
  // 언마운트 정리는 타이머만 — 여기서 setState까지 부를 필요가 없다.
  useEffect(() => clearMethodTimer, []);

  // 시퀀스 본체: 선택 반영 → (이동했으면) 알약이 미끄러질 시간만큼 대기 → 시트.
  // delayMs는 **확정된** 설정으로 계산해 넘긴다.
  function startMethodSequence(sub: Subject, delayMs: number) {
    const moved = sub.id !== active?.id;
    setSelectedId(sub.id);
    if (!moved) {
      setSheet('method');
      return;
    }
    // 이 대기는 알약이 미끄러지는 걸 보여주기 위한 시간이다 — reduce면 알약이 이미 제자리에
    // 놓이므로 기다릴 연출이 없다. delayMs가 0이어도 setTimeout은 남으므로,
    // 예약 취소(cancelPendingMethodSheet)·스테일 콜백 방어가 그대로 성립한다.
    methodTimer.current = setTimeout(() => {
      methodTimer.current = null;
      setSheet('method');
    }, delayMs);
  }

  function openMethod(sub: Subject) {
    cancelPendingMethodSheet();
    // 같은 과목 재탭은 알약이 움직이지 않으므로 기다릴 연출이 없다 — 설정 확정과 무관하게
    // 곧바로 연다. 여기까지 보류하면 콜드 스타트에서 탭이 무반응으로 보인다(codex 리뷰).
    if (sub.id === active?.id) {
      startMethodSequence(sub, 0);
      return;
    }
    if (!m.ready) {
      // 설정 미확정 — 탭은 받아 두고 시작만 미룬다(선택 반영도 함께 미룬다: 알약을 먼저
      // 옮겨 버리면 확정 후엔 이미 이동이 끝나 슬라이드가 재생될 자리가 없다).
      setPendingSubject(sub);
      return;
    }
    startMethodSequence(sub, m.delay(SLIDE_MS + 60));
  }

  // ⚠️ 재생 도중 '동작 줄이기'가 켜지면 **남은 대기를 버리고 즉시 시트를 연다.** 대기 시간은
  //    예약할 때 한 번 계산되므로, 그대로 두면 알약은 이미 제자리에 놓였는데 아무 일도 없는
  //    410ms가 그대로 남는다(codex 리뷰).
  useEffect(() => {
    if (!m.reduce || !methodTimer.current) return;
    clearMethodTimer();
    setSheet('method');
  }, [m.reduce]);

  // 설정이 확정되면 보류해 둔 탭의 시퀀스를 확정된 값으로 시작한다.
  // ⚠️ 의존성에 m(useMotion 반환 객체)을 넣지 말 것 — reduce/ready가 바뀔 때마다 새 객체라
  //    일회성 시퀀스가 중복 실행된다. 원시값 m.ready만 넣고, 지연은 이 렌더의 m으로 계산한다.
  useEffect(() => {
    if (!m.ready || !pendingSubject) return;
    setPendingSubject(null);
    startMethodSequence(pendingSubject, m.delay(SLIDE_MS + 60));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- m(useMotion 객체)은 의존성에서 제외
  }, [m.ready, pendingSubject]);

  function editSubject(sub: Subject) {
    setMenu(null);
    Alert.prompt(
      '과목 이름 편집',
      undefined,
      (text) => {
        const name = text?.trim();
        if (!name) return;
        // 기존 과목과 같은 이름이면 저장하지 않음 — 서버 태그가 이름 기준 1태그라 통계가 합산되고
        // 목록에 같은 이름이 중복 노출되는 것을 막는다(GROMO-867). 자기 자신(변경 없음)은 허용.
        if (subjectsRef.current.some((x) => x.id !== sub.id && x.name === name)) {
          Alert.alert('이미 있는 과목이에요', '다른 이름으로 입력해 주세요.');
          return;
        }
        renameSubject(sub.id, name);
        logFocusTagUpdated();
      },
      'plain-text',
      sub.name,
    );
  }

  function doDelete(sub: Subject) {
    deleteSubject(sub.id);
    logFocusTagDeleted();
    // 삭제된 과목의 기록은 홈 '오늘 집중'에서도 차감 (오늘치 초과분은 0으로 클램프)
    if (sub.accumulatedSeconds > 0) removeFocusSeconds(sub.accumulatedSeconds);
    if (selectedId === sub.id) setSelectedId('');
  }

  function confirmDelete(sub: Subject) {
    setMenu(null);
    // 누적 집중시간이 없으면(00:00:00) 경고 없이 바로 삭제.
    if (sub.accumulatedSeconds <= 0) {
      doDelete(sub);
      return;
    }
    Alert.alert('과목 삭제', '해당 과목에 기록된 집중 시간이 사라집니다!', [
      { text: '취소', style: 'cancel' },
      { text: '삭제', style: 'destructive', onPress: () => doDelete(sub) },
    ]);
  }

  function handleAddSubject() {
    cancelPendingMethodSheet(); // 추가 프롬프트 위로 예약 시트가 뒤늦게 뜨는 것 방지(코덱스 리뷰, PR 301 후속)
    // 이름을 먼저 입력받고 추가. 누적시간은 0에서 시작해 실제 세션으로 쌓인다.
    Alert.prompt(
      '새 과목 추가',
      '집중할 과목 이름을 입력하세요.',
      (text) => {
        const name = text?.trim();
        if (!name) return;
        // 기존 과목과 같은 이름이면 추가하지 않음(GROMO-867)
        if (subjectsRef.current.some((x) => x.name === name)) {
          Alert.alert('이미 있는 과목이에요', '다른 이름으로 입력해 주세요.');
          return;
        }
        addSubject(name);
        logFocusTagCreated();
      },
      'plain-text',
    );
  }

  function startSession(
    mode: FocusTimerMode,
    extra?: { goalSeconds?: number; pomodoro?: PomodoroConfig },
  ) {
    if (!active || startTransitionRef.current) return;
    setSheet(null);
    const firstRouteTransfer = !interactionTransferredRef.current;
    const sessionContext = resolveFocusSessionRouteContext(
      { entrySource, interactionId, interactionAcceptedAt },
      firstRouteTransfer,
    );
    startTransitionRef.current = true;
    interactionTransferredRef.current = true;
    try {
      navigation.navigate('FocusSession', {
        subjectId: active.id,
        subjectName: active.name,
        mode,
        goalSeconds: extra?.goalSeconds,
        pomodoro: extra?.pomodoro,
        initialGroupId,
        entrySource: sessionContext.entrySource,
        interactionId: sessionContext.interactionId,
        interactionAcceptedAt: sessionContext.interactionAcceptedAt,
      });
      navigationCheckTimerRef.current = setTimeout(() => {
        navigationCheckTimerRef.current = null;
        const state = navigation.getState();
        if (state.routes[state.index]?.name === 'FocusSession') return;
        startTransitionRef.current = false;
        invalidateCardInteraction(sessionContext.interactionId);
      }, 500);
    } catch (error) {
      startTransitionRef.current = false;
      invalidateCardInteraction(sessionContext.interactionId);
      throw error;
    }
  }

  return (
    <SafeAreaView testID="focus.category.screen" style={s.root} edges={['top']}>
      <View style={s.header}>
        {/* 뒤로가기는 취소 동작이라 소리를 내지 않는다 — 눌림 스케일만 */}
        <PressableScale
          style={s.backBtn}
          scaleTo={0.9}
          sound={false}
          onPress={() => navigation.goBack()}
        >
          <Ionicons name="chevron-back" size={22} color={T.ink} />
        </PressableScale>
      </View>

      <Text style={s.title}>무엇에 집중할까요?</Text>

      <DraggableSubjectRows
        subjects={subjects}
        activeId={active?.id}
        onReorder={reorderSubjects}
        onPressRow={openMethod}
        onOpenColor={(id, a) => {
          cancelPendingMethodSheet(); // 팝오버 위로 예약 시트가 뒤늦게 뜨는 것 방지
          setMenu(null);
          setColorMenu((prev) => (prev?.id === id ? null : { id, ...a }));
        }}
        onOpenMenu={(id, a) => {
          cancelPendingMethodSheet();
          setColorMenu(null);
          setMenu((prev) => (prev?.id === id ? null : { id, ...a }));
        }}
        footer={
          <>
            <PressableScale style={s.addBtn} onPress={handleAddSubject}>
              <Ionicons name="add" size={16} color={T.inkMuted} />
              <Text style={s.addText}>새 과목 추가</Text>
            </PressableScale>
            {/* 추천 과목 유도 — 탭하면 바로 과목으로 추가되고 목록에서 사라진다.
                헤더 탭으로 접기/펼치기(상태는 AsyncStorage에 저장) */}
            {recommended.length > 0 && (
              <View style={s.recoSection}>
                {/* 행 계열 규칙 — 스케일 없이 사운드만(발화 시점은 PressableScale과 동일한 press-in) */}
                <TouchableOpacity
                  style={s.recoHeader}
                  activeOpacity={0.7}
                  onPressIn={playTapSound}
                  onPress={toggleRecoHidden}
                >
                  <Text style={s.recoLabel}>{category} 추천 과목</Text>
                  <Ionicons
                    name={recoHidden ? 'chevron-down' : 'chevron-up'}
                    size={15}
                    color={T.inkMuted}
                  />
                </TouchableOpacity>
                {!recoHidden &&
                  recommended.map((name) => (
                    <TouchableOpacity
                      key={name}
                      style={s.recoRow}
                      activeOpacity={0.8}
                      onPressIn={playTapSound}
                      onPress={() => {
                        cancelPendingMethodSheet(); // 추천 추가 중 예약 시트 발화 방지
                        addSubject(name);
                        logFocusTagCreated();
                      }}
                    >
                      <View style={s.recoIcon}>
                        <Ionicons name="book-outline" size={16} color={T.accent} />
                      </View>
                      <Text style={s.recoName} numberOfLines={1}>
                        {name}
                      </Text>
                      <View style={s.recoAddPill}>
                        <Ionicons name="add" size={13} color={T.accent} />
                        <Text style={s.recoAddText}>추가</Text>
                      </View>
                    </TouchableOpacity>
                  ))}
              </View>
            )}
          </>
        }
      />

      {/* ⋮ 팝오버 — 측정한 버튼 바로 아래, 우측 정렬 */}
      {menu && menuSubject && (
        <>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setMenu(null)} />
          <View style={[s.menu, { top: menu.y + menu.h + 4, right: winW - (menu.x + menu.w) }]}>
            {/* 서버에서 내려준 기본(추천) 과목은 이름 변경 불가 — 삭제/등록만 허용(GROMO-855).
                판정은 현재 카테고리 추천 과목명과의 일치 기준(재로그인 복원 뒤에도 유지됨).
                추천 목록 도착 전엔 판별 불가라 편집을 숨긴다(defaultsReady). */}
            {/* 팝오버 메뉴 항목도 행 계열 규칙 — 위 추천 과목 행과 같이 스케일 없이 사운드만 */}
            {defaultsReady && !defaultTags.includes(menuSubject.name) && (
              <>
                <TouchableOpacity
                  style={s.menuItem}
                  activeOpacity={0.7}
                  onPressIn={playTapSound}
                  accessibilityRole="button"
                  onPress={() => editSubject(menuSubject)}
                >
                  <Ionicons name="pencil" size={14} color={T.inkSub} />
                  <Text style={s.menuText}>이름 편집</Text>
                </TouchableOpacity>
                <View style={s.menuDivider} />
              </>
            )}
            <TouchableOpacity
              style={s.menuItem}
              activeOpacity={0.7}
              onPressIn={playTapSound}
              accessibilityRole="button"
              onPress={() => confirmDelete(menuSubject)}
            >
              <Ionicons name="trash" size={14} color={T.accentAlt} />
              <Text style={[s.menuText, s.menuTextDanger]}>과목 삭제</Text>
            </TouchableOpacity>
          </View>
        </>
      )}

      {/* 색 선택 팝오버 — 색 네모 바로 아래, 우측 정렬 */}
      {colorMenu && colorSubject && (
        <>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setColorMenu(null)} />
          <View
            style={[
              s.menu,
              { top: colorMenu.y + colorMenu.h + 6, right: winW - (colorMenu.x + colorMenu.w) },
            ]}
          >
            <View style={s.colorRow}>
              {/* 색 점은 라벨이 될 텍스트가 없어 VoiceOver가 읽을 게 없었다 — 번호로 라벨을
                  주고 선택 상태를 함께 알린다. 피드백은 팝오버 메뉴와 같은 사운드만. */}
              {T.subjectPalette.map((c, i) => (
                <TouchableOpacity
                  key={c}
                  style={[
                    s.colorDot,
                    { backgroundColor: c },
                    colorSubject.color === c && s.colorDotOn,
                  ]}
                  activeOpacity={0.8}
                  onPressIn={playTapSound}
                  accessibilityRole="button"
                  accessibilityLabel={`색상 ${i + 1}`}
                  accessibilityState={{ selected: colorSubject.color === c }}
                  onPress={() => {
                    setSubjectColor(colorSubject.id, c);
                    setColorMenu(null);
                  }}
                />
              ))}
            </View>
          </View>
        </>
      )}

      {/* 첫 진입 사용법 카드(GROMO-652) — 집중 시작(FAB) 첫 탭 시 잠깐 설명 후 이용 */}
      <TabGuideOverlay
        storageKey={STORAGE_KEYS.guideFocus}
        steps={[
          {
            text: '집중할 과목을 골라줘!\n과목을 탭하면 무제한·타이머·뽀모도로 중 집중 방식을 고를 수 있어.',
            character: require('@/assets/character_hi.png'),
          },
          {
            text: '집중을 마치면 공부 시간이 과목별로 기록되고 리그 순위에도 반영돼.\n그럼 시작해보자!',
            character: require('@/assets/character_study.png'),
          },
        ]}
      />

      {sheet === 'method' && active && (
        <TimerMethodSheet
          subjectName={active.name}
          onClose={() => setSheet(null)}
          onSelect={(mode) => {
            if (mode === 'countup') startSession('countup');
            else if (mode === 'countdown') setSheet('countdown');
            else setSheet('pomodoro');
          }}
        />
      )}
      {sheet === 'countdown' && active && (
        <CountdownSetupSheet
          subjectName={active.name}
          onClose={() => setSheet(null)}
          onStart={(goalSeconds) => startSession('countdown', { goalSeconds })}
        />
      )}
      {sheet === 'pomodoro' && active && (
        <PomodoroSetupSheet
          subjectName={active.name}
          onClose={() => setSheet(null)}
          onStart={(pomodoro) => startSession('pomodoro', { pomodoro })}
        />
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: T.paperLight },
  header: { height: 40, justifyContent: 'center', paddingHorizontal: T.space.md },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  title: {
    ...T.text.body,
    fontWeight: '700',
    color: T.ink,
    paddingHorizontal: T.space.xxl,
    paddingBottom: T.space.sm,
  },

  // ⋮ 팝오버
  menu: {
    position: 'absolute',
    minWidth: 148,
    backgroundColor: T.white,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: T.paperAlt,
    paddingVertical: T.space.xs,
    shadowColor: T.shadow,
    shadowOpacity: 0.2,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 12,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: T.space.sm,
    paddingVertical: T.space.md,
    paddingHorizontal: T.space.lg,
  },
  menuText: { ...T.text.caption, color: T.ink },
  menuTextDanger: { color: T.accentAlt },
  menuDivider: { height: 1, backgroundColor: T.divider, marginHorizontal: T.space.sm },

  // 색 선택 팝오버
  colorRow: {
    flexDirection: 'row',
    gap: T.space.sm,
    paddingHorizontal: T.space.md,
    paddingVertical: T.space.sm,
  },
  colorDot: { width: 22, height: 22, borderRadius: 11 },
  colorDotOn: { borderWidth: 2, borderColor: T.ink },

  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: T.space.sm,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: T.borderDark,
    borderRadius: 14,
    paddingVertical: T.space.md,
    marginTop: T.space.xs,
  },
  addText: { ...T.text.label, color: T.inkMuted },

  // 추천 과목 유도 섹션 — 실제 과목 행과 구분되게 옅은 카드로
  recoSection: { marginTop: 18, gap: 8, paddingBottom: 24 },
  // 접기/펼치기 헤더 — 라벨 왼쪽, 셰브론 오른쪽
  recoHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 2,
    paddingVertical: 2,
  },
  recoLabel: { ...T.text.caption, color: T.inkMuted },
  recoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: T.white,
    borderWidth: 1,
    borderColor: T.paperAlt,
    borderRadius: 13,
    paddingVertical: 9,
    paddingHorizontal: 12,
  },
  recoIcon: {
    width: 30,
    height: 30,
    borderRadius: 9,
    backgroundColor: T.caramel,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recoName: { flex: 1, ...T.text.label, fontWeight: '600', color: T.inkSub },
  recoAddPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingVertical: 6,
    paddingHorizontal: 11,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: T.accent,
  },
  recoAddText: { ...T.text.caption, fontWeight: '700', color: T.accent },
});
