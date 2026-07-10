import { createContext, useContext, useState, useEffect, useRef, type ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { STORAGE_KEYS } from '@/types/storage';
import { getFocusTags } from '@/services/focusApi';
import { T } from '@/constants/theme';
import { todayStr } from '@/utils/localDate';
import { syncTagCreated, syncTagRenamed, syncTagDeleted } from '@/screens/focus/tagSync';
import type { Subject } from '@/screens/focus/types';

// 과목 목록 + 과목별 '오늘' 집중시간을 로컬에 저장·관리하는 store.
// 집중 세션이 끝나면 해당 과목에 실제 경과 시간을 누적하고, 로컬 날짜가 바뀌면 0으로 리셋한다.
// (accumulatedSeconds = 오늘 누적 — 홈 '공부 집중'과 같은 '오늘' 기준. 날짜 경계는 localDate=KST 자정.)
// 서버 tag 연동(GROMO-677): 생성/이름변경/삭제는 tagSync로 서버에 반영(fire-and-forget)하고,
// 로컬 데이터가 없으면(첫 실행·재로그인) GET /tag로 목록을 복원한다. 색·순서·오늘 누적은 로컬 전용.
const PALETTE = T.subjectPalette;

// 저장 포맷 — 신버전 { date, subjects }. 구버전(subjects 배열 그대로)도 로드 시 지원.
type StoredSubject = Omit<Subject, 'color'> & { color?: string };
interface SavedSubjects {
  date?: string;
  subjects?: StoredSubject[];
}

const SEED: Subject[] = [
  { id: 's1', name: '노동법', accumulatedSeconds: 0, color: PALETTE[0] },
  { id: 's2', name: '행정쟁송법', accumulatedSeconds: 0, color: PALETTE[1] },
  { id: 's3', name: '사회보험법', accumulatedSeconds: 0, color: PALETTE[2] },
];

interface SubjectContextValue {
  subjects: Subject[];
  addSubject: (name: string) => void;
  renameSubject: (id: string, name: string) => void;
  deleteSubject: (id: string) => void;
  reorderSubjects: (next: Subject[]) => void;
  setSubjectColor: (id: string, color: string) => void;
  addFocusToSubject: (id: string, seconds: number) => void;
}

const SubjectContext = createContext<SubjectContextValue | null>(null);

export function SubjectProvider({ children }: { children: ReactNode }) {
  const [subjects, setSubjects] = useState<Subject[]>(SEED);
  const loaded = useRef(false);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEYS.subjects).then(async (raw) => {
      if (raw) {
        // 구버전(배열)·신버전({date, subjects}) 모두 지원
        const parsed = JSON.parse(raw) as SavedSubjects | StoredSubject[];
        const list = Array.isArray(parsed) ? parsed : (parsed.subjects ?? []);
        const savedDate = Array.isArray(parsed) ? undefined : parsed.date;
        const sameDay = savedDate === todayStr();
        setSubjects(
          list.map((x, i) => ({
            ...x,
            // color 없던 기존 데이터 마이그레이션 — 팔레트를 순서대로 배정
            color: x.color ?? PALETTE[i % PALETTE.length],
            // 날짜가 바뀌었거나(자정 지남) 구버전(날짜 없음)이면 오늘 집중시간만 0으로 리셋.
            // 과목 목록·이름·색·순서는 유지.
            accumulatedSeconds: sameDay ? x.accumulatedSeconds : 0,
          })),
        );
      } else {
        // 로컬 데이터 없음(첫 실행·재로그인) — 서버 태그로 과목 목록 복원(GROMO-677).
        // 색은 팔레트 순서 배정, 오늘 누적은 서버에 없으므로 0. 실패·빈 목록이면 시드 유지.
        try {
          const tags = await getFocusTags();
          if (tags.length > 0) {
            setSubjects(
              tags.map((t, i) => ({
                id: t.tagId,
                name: t.name,
                accumulatedSeconds: 0,
                color: PALETTE[i % PALETTE.length],
              })),
            );
          }
        } catch {}
      }
      loaded.current = true;
    });
  }, []);

  useEffect(() => {
    if (!loaded.current) return;
    AsyncStorage.setItem(STORAGE_KEYS.subjects, JSON.stringify({ date: todayStr(), subjects }));
  }, [subjects]);

  function addSubject(name: string) {
    const id = `subj-${Date.now().toString(36)}`;
    setSubjects((prev) => {
      // 아직 안 쓰인 팔레트 색 우선 배정, 다 쓰였으면 순환
      const used = new Set(prev.map((x) => x.color));
      const color = PALETTE.find((c) => !used.has(c)) ?? PALETTE[prev.length % PALETTE.length];
      return [...prev, { id, name, accumulatedSeconds: 0, color }];
    });
    syncTagCreated(name);
  }

  function renameSubject(id: string, name: string) {
    // 서버 태그도 함께 교체 — 이름이 실제로 바뀔 때만(GROMO-677)
    const target = subjects.find((x) => x.id === id);
    if (target && target.name !== name) syncTagRenamed(target.name, name);
    setSubjects((prev) => prev.map((x) => (x.id === id ? { ...x, name } : x)));
  }

  function deleteSubject(id: string) {
    const target = subjects.find((x) => x.id === id);
    if (target) syncTagDeleted(target.name);
    setSubjects((prev) => prev.filter((x) => x.id !== id));
  }

  // 드래그로 재정렬된 목록을 그대로 반영 (저장은 subjects effect가 자동 처리).
  function reorderSubjects(next: Subject[]) {
    setSubjects(next);
  }

  function setSubjectColor(id: string, color: string) {
    setSubjects((prev) => prev.map((x) => (x.id === id ? { ...x, color } : x)));
  }

  function addFocusToSubject(id: string, seconds: number) {
    if (seconds <= 0) return;
    setSubjects((prev) =>
      prev.map((x) =>
        x.id === id ? { ...x, accumulatedSeconds: x.accumulatedSeconds + seconds } : x,
      ),
    );
  }

  return (
    <SubjectContext.Provider
      value={{
        subjects,
        addSubject,
        renameSubject,
        deleteSubject,
        reorderSubjects,
        setSubjectColor,
        addFocusToSubject,
      }}
    >
      {children}
    </SubjectContext.Provider>
  );
}

export function useSubjects(): SubjectContextValue {
  const context = useContext(SubjectContext);
  if (!context) throw new Error('useSubjects must be used inside SubjectProvider');
  return context;
}
