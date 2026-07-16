import { useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Pressable,
  Alert,
  StyleSheet,
  useWindowDimensions,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { T } from '@/constants/theme';
import { useFocus } from '@/store/FocusContext';
import { useSubjects } from '@/store/SubjectContext';
import { useFocusCategory } from '@/hooks/useFocusCategory';
import { occupationForCategory } from '@/constants/focusCategories';
import { getDefaultTags } from '@/services/focusApi';
import { STORAGE_KEYS } from '@/types/storage';
import type { V2RootStackParamList } from '@/navigation/types';
import type { FocusTimerMode, PomodoroConfig, Subject } from './types';
import { DraggableSubjectRows } from './components/DraggableSubjectRows';
import { TimerMethodSheet } from './components/TimerMethodSheet';
import { CountdownSetupSheet } from './components/CountdownSetupSheet';
import { PomodoroSetupSheet } from './components/PomodoroSetupSheet';
import {
  logFocusTagCreated,
  logFocusTagUpdated,
  logFocusTagDeleted,
} from '@/services/analyticsEvents';

// 02 과목 선택 — 홈 ● 집중 FAB → 이 화면. 행 탭 → 타이머 방식 시트(03) → 설정(04/05) → 세션.
// 각 행: 과목명 + 누적 집중시간 + ⋮(탭=이름편집/삭제 팝오버, 잡고 위아래=순서 변경).
// 리스트 아래에는 준비 시험(occupation) 추천 과목 중 미보유분을 노출해 추가를 유도한다(GROMO-668).
type SheetKind = null | 'method' | 'countdown' | 'pomodoro';
// ⋮ 팝오버 위치(측정한 버튼의 window 좌표)
type MenuAnchor = { id: string; x: number; y: number; w: number; h: number } | null;

export default function FocusCategoryScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<V2RootStackParamList>>();
  const { width: winW } = useWindowDimensions();
  const { subjects, addSubject, renameSubject, deleteSubject, reorderSubjects, setSubjectColor } =
    useSubjects();
  const { removeFocusSeconds } = useFocus();
  const [selectedId, setSelectedId] = useState<string>('');
  const [sheet, setSheet] = useState<SheetKind>(null);
  const [menu, setMenu] = useState<MenuAnchor>(null);
  const [colorMenu, setColorMenu] = useState<MenuAnchor>(null); // 색 선택 팝오버(네모 탭)

  // 준비 시험 추천 과목(GET /tag/defaults) — 미보유분만 리스트 아래에 추가 유도로 노출.
  // 조회 실패(미로그인·오프라인)면 조용히 숨긴다.
  const category = useFocusCategory();
  const [defaultTags, setDefaultTags] = useState<string[]>([]);
  useEffect(() => {
    const occupation = occupationForCategory(category);
    if (!occupation) {
      setDefaultTags([]);
      return;
    }
    let cancelled = false;
    getDefaultTags(occupation)
      .then((res) => {
        if (cancelled) return;
        setDefaultTags([...res.tags].sort((a, b) => a.sortOrder - b.sortOrder).map((t) => t.name));
      })
      .catch(() => {});
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

  function openMethod(sub: Subject) {
    setSelectedId(sub.id);
    setSheet('method');
  }

  function editSubject(sub: Subject) {
    setMenu(null);
    Alert.prompt(
      '과목 이름 편집',
      undefined,
      (text) => {
        const name = text?.trim();
        if (name) {
          renameSubject(sub.id, name);
          logFocusTagUpdated();
        }
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
    // 이름을 먼저 입력받고 추가. 누적시간은 0에서 시작해 실제 세션으로 쌓인다.
    Alert.prompt(
      '새 과목 추가',
      '집중할 과목 이름을 입력하세요.',
      (text) => {
        const name = text?.trim();
        if (name) {
          addSubject(name);
          logFocusTagCreated();
        }
      },
      'plain-text',
    );
  }

  function startSession(
    mode: FocusTimerMode,
    extra?: { goalSeconds?: number; pomodoro?: PomodoroConfig },
  ) {
    if (!active) return;
    setSheet(null);
    navigation.navigate('FocusSession', {
      subjectId: active.id,
      subjectName: active.name,
      mode,
      goalSeconds: extra?.goalSeconds,
      pomodoro: extra?.pomodoro,
    });
  }

  return (
    <SafeAreaView style={s.root} edges={['top']}>
      <View style={s.header}>
        <TouchableOpacity style={s.backBtn} activeOpacity={0.7} onPress={() => navigation.goBack()}>
          <Ionicons name="chevron-back" size={22} color={T.ink} />
        </TouchableOpacity>
      </View>

      <Text style={s.title}>무엇에 집중할까요?</Text>

      <DraggableSubjectRows
        subjects={subjects}
        activeId={active?.id}
        onReorder={reorderSubjects}
        onPressRow={openMethod}
        onOpenColor={(id, a) => {
          setMenu(null);
          setColorMenu((m) => (m?.id === id ? null : { id, ...a }));
        }}
        onOpenMenu={(id, a) => {
          setColorMenu(null);
          setMenu((m) => (m?.id === id ? null : { id, ...a }));
        }}
        footer={
          <>
            <TouchableOpacity style={s.addBtn} activeOpacity={0.8} onPress={handleAddSubject}>
              <Ionicons name="add" size={16} color={T.inkMuted} />
              <Text style={s.addText}>새 과목 추가</Text>
            </TouchableOpacity>
            {/* 추천 과목 유도 — 탭하면 바로 과목으로 추가되고 목록에서 사라진다.
                헤더 탭으로 접기/펼치기(상태는 AsyncStorage에 저장) */}
            {recommended.length > 0 && (
              <View style={s.recoSection}>
                <TouchableOpacity
                  style={s.recoHeader}
                  activeOpacity={0.7}
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
                      onPress={() => {
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
            <TouchableOpacity
              style={s.menuItem}
              activeOpacity={0.7}
              onPress={() => editSubject(menuSubject)}
            >
              <Ionicons name="pencil" size={14} color={T.inkSub} />
              <Text style={s.menuText}>이름 편집</Text>
            </TouchableOpacity>
            <View style={s.menuDivider} />
            <TouchableOpacity
              style={s.menuItem}
              activeOpacity={0.7}
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
              {T.subjectPalette.map((c) => (
                <TouchableOpacity
                  key={c}
                  style={[
                    s.colorDot,
                    { backgroundColor: c },
                    colorSubject.color === c && s.colorDotOn,
                  ]}
                  activeOpacity={0.8}
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
  header: { height: 40, justifyContent: 'center', paddingHorizontal: 12 },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  title: {
    ...T.text.body,
    fontWeight: '700',
    color: T.ink,
    paddingHorizontal: 22,
    paddingBottom: 8,
  },

  // ⋮ 팝오버
  menu: {
    position: 'absolute',
    minWidth: 148,
    backgroundColor: T.white,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: T.paperAlt,
    paddingVertical: 4,
    shadowColor: T.shadow,
    shadowOpacity: 0.2,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 12,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingVertical: 11,
    paddingHorizontal: 14,
  },
  menuText: { ...T.text.caption, color: T.ink },
  menuTextDanger: { color: T.accentAlt },
  menuDivider: { height: 1, backgroundColor: T.divider, marginHorizontal: 6 },

  // 색 선택 팝오버
  colorRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 12, paddingVertical: 8 },
  colorDot: { width: 22, height: 22, borderRadius: 11 },
  colorDotOn: { borderWidth: 2, borderColor: T.ink },

  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: T.borderDark,
    borderRadius: 14,
    paddingVertical: 11,
    marginTop: 4,
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
