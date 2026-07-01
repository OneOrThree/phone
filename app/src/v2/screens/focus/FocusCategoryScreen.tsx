import { useRef, useState, type ElementRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Pressable,
  ScrollView,
  Alert,
  StyleSheet,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { T } from '@/v2/constants/theme';
import { useSubjects } from '@/store/SubjectContext';
import type { V2RootStackParamList } from '@/v2/navigation/types';
import type { FocusTimerMode, PomodoroConfig, Subject } from './types';
import { hmsCompact } from './format';
import { TimerMethodSheet } from './components/TimerMethodSheet';
import { CountdownSetupSheet } from './components/CountdownSetupSheet';
import { PomodoroSetupSheet } from './components/PomodoroSetupSheet';

// 02 과목 선택 — 홈 ● 집중 FAB → 이 화면. 행 탭 → 타이머 방식 시트(03) → 설정(04/05) → 세션.
// 각 행: 과목명 + 누적 집중시간 + ⋮(이름 편집/삭제 팝오버). 과목은 로컬 예시.
// 03/04/05는 별도 화면이 아니라 내부 시트 상태로 딤 위에 올린다.
const ICON_BG = '#F0E7D7';
const DANGER = '#C2705A';

type SheetKind = null | 'method' | 'countdown' | 'pomodoro';
// ⋮ 팝오버 위치(측정한 버튼의 window 좌표)
type MenuAnchor = { id: string; x: number; y: number; w: number; h: number } | null;

export default function FocusCategoryScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<V2RootStackParamList>>();
  const { width: winW } = useWindowDimensions();
  const { subjects, addSubject, renameSubject, deleteSubject } = useSubjects();
  const [selectedId, setSelectedId] = useState<string>('');
  const [sheet, setSheet] = useState<SheetKind>(null);
  const [menu, setMenu] = useState<MenuAnchor>(null);
  const dotRefs = useRef<Record<string, ElementRef<typeof View> | null>>({});

  // 선택 과목 — 미선택/삭제 시 첫 과목으로 폴백.
  const active = subjects.find((x) => x.id === selectedId) ?? subjects[0];
  const menuSubject = menu ? subjects.find((x) => x.id === menu.id) : undefined;

  function openMethod(sub: Subject) {
    setSelectedId(sub.id);
    setSheet('method');
  }

  // ⋮ 탭 — 버튼 위치를 측정해 그 바로 아래에 팝오버를 띄운다(같은 행이면 토글).
  function toggleMenu(id: string) {
    if (menu?.id === id) {
      setMenu(null);
      return;
    }
    dotRefs.current[id]?.measureInWindow((x, y, w, h) => setMenu({ id, x, y, w, h }));
  }

  function editSubject(sub: Subject) {
    setMenu(null);
    Alert.prompt(
      '과목 이름 편집',
      undefined,
      (text) => {
        const name = text?.trim();
        if (name) renameSubject(sub.id, name);
      },
      'plain-text',
      sub.name,
    );
  }

  function confirmDelete(sub: Subject) {
    setMenu(null);
    Alert.alert('과목 삭제', '해당 과목에 기록된 집중 시간이 사라집니다!', [
      { text: '취소', style: 'cancel' },
      {
        text: '삭제',
        style: 'destructive',
        onPress: () => {
          deleteSubject(sub.id);
          if (selectedId === sub.id) setSelectedId('');
        },
      },
    ]);
  }

  function handleAddSubject() {
    // 이름만 예시 — 누적시간은 0에서 시작해 실제 세션으로 쌓인다.
    const n = subjects.filter((x) => x.name.startsWith('새 과목')).length + 1;
    addSubject(`새 과목 ${n}`);
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

      <ScrollView
        style={s.flex1}
        contentContainerStyle={s.listContent}
        showsVerticalScrollIndicator={false}
      >
        {subjects.map((sub) => {
          const selected = sub.id === active?.id;
          return (
            <TouchableOpacity
              key={sub.id}
              style={[s.row, selected && s.rowSelected]}
              activeOpacity={0.85}
              onPress={() => openMethod(sub)}
            >
              <View style={[s.iconBox, selected ? s.iconBoxSelected : s.iconBoxIdle]}>
                <Ionicons name="play" size={13} color={selected ? T.white : T.accent} />
              </View>
              <Text style={s.rowName}>{sub.name}</Text>
              {/* 누적 집중시간 */}
              <Text style={s.rowTime}>{hmsCompact(sub.accumulatedSeconds)}</Text>
              <View
                style={s.moreBtn}
                collapsable={false}
                ref={(r) => {
                  dotRefs.current[sub.id] = r;
                }}
              >
                <TouchableOpacity
                  hitSlop={8}
                  activeOpacity={0.6}
                  onPress={() => toggleMenu(sub.id)}
                >
                  <Ionicons name="ellipsis-vertical" size={16} color={T.inkMuted} />
                </TouchableOpacity>
              </View>
            </TouchableOpacity>
          );
        })}

        <TouchableOpacity style={s.addBtn} activeOpacity={0.8} onPress={handleAddSubject}>
          <Ionicons name="add" size={16} color={T.inkMuted} />
          <Text style={s.addText}>새 과목 추가</Text>
        </TouchableOpacity>
      </ScrollView>

      <View style={s.infoBox}>
        <Ionicons name="information-circle-outline" size={16} color={T.accent} style={s.infoIcon} />
        <Text style={s.infoText}>
          허용 앱은 <Text style={s.infoStrong}>전체 → 집중 중 허용 앱 관리</Text>에서 바꿀 수
          있어요.
        </Text>
      </View>

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
              <Ionicons name="trash" size={14} color={DANGER} />
              <Text style={[s.menuText, s.menuTextDanger]}>과목 삭제</Text>
            </TouchableOpacity>
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
  flex1: { flex: 1 },
  header: { height: 40, justifyContent: 'center', paddingHorizontal: 12 },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 16, fontWeight: '700', color: T.ink, paddingHorizontal: 22, paddingBottom: 8 },
  listContent: { paddingHorizontal: 22, paddingTop: 6, gap: 8 },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    backgroundColor: T.white,
    borderWidth: 1.5,
    borderColor: '#ECE2D1',
    borderRadius: 14,
    paddingVertical: 9,
    paddingHorizontal: 13,
  },
  rowSelected: { borderColor: T.accent },
  iconBox: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconBoxIdle: { backgroundColor: ICON_BG },
  iconBoxSelected: { backgroundColor: T.accent },
  rowName: { flex: 1, fontSize: 15, fontWeight: '700', color: T.ink },
  rowTime: { fontSize: 12, fontWeight: '600', color: T.inkMuted, fontVariant: ['tabular-nums'] },
  moreBtn: { width: 26, alignItems: 'center', justifyContent: 'center' },

  // ⋮ 팝오버
  menu: {
    position: 'absolute',
    minWidth: 148,
    backgroundColor: T.white,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#ECE2D1',
    paddingVertical: 4,
    shadowColor: '#50371E',
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
  menuText: { fontSize: 13, fontWeight: '600', color: T.ink },
  menuTextDanger: { color: DANGER },
  menuDivider: { height: 1, backgroundColor: '#F0E9DC', marginHorizontal: 6 },

  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: '#D6C9B4',
    borderRadius: 14,
    paddingVertical: 11,
  },
  addText: { fontSize: 14, fontWeight: '600', color: T.inkMuted },

  infoBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: '#FBF3E8',
    borderWidth: 1,
    borderColor: '#EBDCC2',
    borderRadius: 12,
    paddingVertical: 11,
    paddingHorizontal: 13,
    marginHorizontal: 22,
    marginTop: 8,
    marginBottom: 12,
  },
  infoIcon: { marginTop: 1 },
  infoText: { flex: 1, fontSize: 12, fontWeight: '500', color: '#7A6B58', lineHeight: 18 },
  infoStrong: { fontWeight: '700', color: T.inkSub },
});
