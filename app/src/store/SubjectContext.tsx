import { createContext, useContext, useState, useEffect, useRef, type ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { STORAGE_KEYS } from '@/types/storage';
import type { Subject } from '@/v2/screens/focus/types';

// 과목 목록 + 과목별 누적 집중시간(all-time)을 로컬에 저장·관리하는 store.
// 집중 세션이 끝나면 해당 과목에 실제 경과 시간을 누적한다(하드코딩 X).
// ⚠️ 과목 '이름'은 예시 시드 — 서버 tag 시스템 연동은 후속 티켓.
const SEED: Subject[] = [
  { id: 's1', name: '노동법', accumulatedSeconds: 0 },
  { id: 's2', name: '행정쟁송법', accumulatedSeconds: 0 },
  { id: 's3', name: '사회보험법', accumulatedSeconds: 0 },
];

interface SubjectContextValue {
  subjects: Subject[];
  addSubject: (name: string) => void;
  renameSubject: (id: string, name: string) => void;
  deleteSubject: (id: string) => void;
  addFocusToSubject: (id: string, seconds: number) => void;
}

const SubjectContext = createContext<SubjectContextValue | null>(null);

export function SubjectProvider({ children }: { children: ReactNode }) {
  const [subjects, setSubjects] = useState<Subject[]>(SEED);
  const loaded = useRef(false);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEYS.subjects).then((raw) => {
      if (raw) setSubjects(JSON.parse(raw) as Subject[]);
      loaded.current = true;
    });
  }, []);

  useEffect(() => {
    if (!loaded.current) return;
    AsyncStorage.setItem(STORAGE_KEYS.subjects, JSON.stringify(subjects));
  }, [subjects]);

  function addSubject(name: string) {
    const id = `subj-${Date.now().toString(36)}`;
    setSubjects((prev) => [...prev, { id, name, accumulatedSeconds: 0 }]);
  }

  function renameSubject(id: string, name: string) {
    setSubjects((prev) => prev.map((x) => (x.id === id ? { ...x, name } : x)));
  }

  function deleteSubject(id: string) {
    setSubjects((prev) => prev.filter((x) => x.id !== id));
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
      value={{ subjects, addSubject, renameSubject, deleteSubject, addFocusToSubject }}
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
