import {
  createContext,
  useContext,
  useState,
  useEffect,
  useRef,
  useCallback,
  type ReactNode,
} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import StudyWidgetModule from '@/services/StudyWidgetModule';
import { STORAGE_KEYS } from '@/types/storage';
import { T } from '@/constants/theme';
import { todayStr } from '@/utils/localDate';
import { subscribeDayChange } from '@/utils/dayChange';
import { syncTagCreated, syncTagRenamed, syncTagDeleted } from '@/screens/focus/tagSync';
import { fetchTodayFocusRestore, todayRestoreSeconds } from '@/screens/focus/focusRestore';
import { DAY_SECONDS } from '@/store/FocusContext';
import type { Subject } from '@/screens/focus/types';

// 과목 목록 + 과목별 '오늘' 집중시간을 로컬에 저장·관리하는 store.
// 집중 세션이 끝나면 해당 과목에 실제 경과 시간을 누적하고, 로컬 날짜가 바뀌면 0으로 리셋한다.
// (accumulatedSeconds = 오늘 누적 — 홈 '공부 집중'과 같은 '오늘' 기준. 날짜 경계는 localDate=KST 자정.)
// 서버 tag 연동(GROMO-677): 생성/이름변경/삭제는 tagSync로 서버에 반영(fire-and-forget)하고,
// 로컬 데이터가 없으면(첫 실행·재로그인) GET /tag로 목록을, 오늘 세션 합산으로 오늘 누적을 복원한다.
// 색·순서는 서버에 없어 로컬 전용(복원 시 팔레트 순서 재배정).
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

// mock 모드는 빈 로컬 저장값이 남아 있어도 선택 화면을 즉시 검증할 수 있어야 한다.
// 실제 사용자 저장소·일반 dev/prod에는 적용하지 않고, Metro를 명시적으로 mock 플래그로 켠 경우만 쓴다.
const MOCK_MODE = __DEV__ && process.env.EXPO_PUBLIC_USE_MOCK === 'true';
const MOCK_SEED: Subject[] = [
  { id: 'mock-labor', name: '노동법', accumulatedSeconds: 7_560, color: PALETTE[0] },
  { id: 'mock-admin', name: '행정쟁송법', accumulatedSeconds: 4_320, color: PALETTE[1] },
  { id: 'mock-social', name: '사회보험법', accumulatedSeconds: 2_700, color: PALETTE[2] },
  { id: 'mock-civil', name: '민법', accumulatedSeconds: 1_800, color: PALETTE[3] },
  { id: 'mock-english', name: '영어', accumulatedSeconds: 900, color: PALETTE[4] },
];

// 로컬 과목 id — Date.now()만 쓰면 '추천 과목 전부 추가'(forEach 연속 호출)처럼 같은 밀리초에
// 생성될 때 id가 전부 겹쳐 목록 렌더·이름변경·삭제가 꼬인다(762 작업 중 발견). 난수 꼬리로 유니크 보장.
function newSubjectId(): string {
  return `subj-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

// 과목별 '오늘' 누적의 **합**을 하루 상한으로 정규화한다(GROMO-1253 코드리뷰 2차).
// 행별 클램프만으론 부패가 여러 과목에 나뉜 경우(20h+14h) 각 행이 24h 미만이라 전부 통과해
// 합은 34h로 남는다. 통계 일 탭 도넛(SubjectDonut)은 과목 합을 분모·중앙 총합으로 쓰고,
// 과목 삭제는 그 값을 캡된 전역 총합(FocusContext)에서 빼기 때문에 합 기준으로 막아야 한다.
// 비례 축소라 과목 간 비율은 유지되고(도넛이 안 뒤틀린다), 내림 잔여는 마지막 비-0 과목이
// 흡수해 합이 정확히 상한이 된다(0초 과목이 잔여를 받아 되살아나지 않게).
function capSubjectsToDay(list: Subject[]): Subject[] {
  const safe = list.map((x) => ({ ...x, accumulatedSeconds: Math.max(0, x.accumulatedSeconds) }));
  const sum = safe.reduce((a, x) => a + x.accumulatedSeconds, 0);
  if (sum <= DAY_SECONDS) return safe;
  const lastIdx = safe.reduce((m, x, i) => (x.accumulatedSeconds > 0 ? i : m), 0);
  let rest = DAY_SECONDS;
  return safe.map((x, i) => {
    const seconds = i === lastIdx ? rest : Math.floor((x.accumulatedSeconds * DAY_SECONDS) / sum);
    rest -= seconds;
    return { ...x, accumulatedSeconds: seconds };
  });
}

interface SubjectContextValue {
  subjects: Subject[];
  // 로컬 로드(+서버 복원) 완료 여부 — 복원 스냅샷이 이후 적립분을 덮지 않게
  // OrphanFocusSettler가 이걸 기다린다(리뷰 반영).
  ready: boolean;
  addSubject: (name: string) => void;
  renameSubject: (id: string, name: string) => void;
  deleteSubject: (id: string) => void;
  deleteSubjects: (ids: string[]) => void;
  reorderSubjects: (next: Subject[]) => void;
  setSubjectColor: (id: string, color: string) => void;
  addFocusToSubject: (id: string, seconds: number) => void;
}

const SubjectContext = createContext<SubjectContextValue | null>(null);

export function SubjectProvider({ children }: { children: ReactNode }) {
  const [subjects, setSubjects] = useState<Subject[]>(SEED);
  const [ready, setReady] = useState(false);
  const loaded = useRef(false);
  // 지금 메모리의 accumulatedSeconds가 속한 로컬 날짜. 날짜 리셋이 로드 시점에만 있으면
  // 앱을 켠 채 자정을 넘길 때 어제 누적이 오늘 값처럼 남는다(코드리뷰 반영) — 이 ref로 롤오버 판정.
  const dayRef = useRef(todayStr());

  // 자정 롤오버 — 날짜가 바뀌었으면 과목별 '오늘' 누적만 0으로 리셋(목록·이름·색·순서 유지).
  // 날짜 경계 신호(아래 구독)와 적립·저장 직전에 호출해, 어제 값이 오늘로 표시·적산되는 걸 막는다.
  const rolloverIfNeeded = useCallback(() => {
    if (dayRef.current === todayStr()) return;
    dayRef.current = todayStr();
    setSubjects((prev) => prev.map((x) => ({ ...x, accumulatedSeconds: 0 })));
  }, []);

  // 공유 날짜 경계 신호 구독(코드리뷰 반영) — 포그라운드 복귀뿐 아니라 앱이 활성인 채
  // 자정을 넘기는 경우도 자정 타이머로 감지한다. FocusContext와 같은 신호를 구독해
  // 두 스토어가 항상 같은 경계에서 함께 넘어간다(기존 개별 AppState 리스너 대체).
  useEffect(() => subscribeDayChange(rolloverIfNeeded), [rolloverIfNeeded]);

  useEffect(() => {
    if (MOCK_MODE) {
      setSubjects(MOCK_SEED.map((subject) => ({ ...subject })));
      dayRef.current = todayStr();
      loaded.current = true;
      setReady(true);
      return;
    }
    AsyncStorage.getItem(STORAGE_KEYS.subjects).then(async (raw) => {
      if (raw) {
        // 구버전(배열)·신버전({date, subjects}) 모두 지원
        const parsed = JSON.parse(raw) as SavedSubjects | StoredSubject[];
        const list = Array.isArray(parsed) ? parsed : (parsed.subjects ?? []);
        const savedDate = Array.isArray(parsed) ? undefined : parsed.date;
        const sameDay = savedDate === todayStr();
        const seen = new Set<string>();
        setSubjects(
          capSubjectsToDay(
            list.map((x, i) => {
              // 같은 밀리초 연속 생성으로 id가 중복된 과거 데이터 복구 — 뒤쪽 중복에 새 id 재부여.
              // (id는 로컬 전용 — 서버 태그 동기화는 이름 기준이라 재부여해도 안전)
              const id = seen.has(x.id) ? newSubjectId() : x.id;
              seen.add(id);
              return {
                ...x,
                id,
                // color 없던 기존 데이터 마이그레이션 — 팔레트를 순서대로 배정
                color: x.color ?? PALETTE[i % PALETTE.length],
                // 날짜가 바뀌었거나(자정 지남) 구버전(날짜 없음)이면 오늘 집중시간만 0으로 리셋.
                // 과목 목록·이름·색·순서는 유지. 하루 상한은 위 capSubjectsToDay가 합 기준으로 건다
                // (GROMO-1253 코드리뷰) — 34시간이 찍힌 기기의 과목별 값도 함께 정리된다.
                accumulatedSeconds: sameDay ? x.accumulatedSeconds : 0,
              };
            }),
          ),
        );
      } else {
        // 로컬 데이터 없음(첫 실행·재로그인) — 서버 태그로 과목 목록 복원(GROMO-677).
        // 과목별 오늘 누적은 오늘 세션 중 tagId 일치분 합산. 태그 조회 실패(미로그인·오프라인)면 시드 유지.
        // 복원 조회는 FocusContext와 공유 — 같은 스냅샷에서 계산해 자정 경계 불일치 제거(GROMO-920)
        try {
          const { sessions: restored, tags } = await fetchTodayFocusRestore();
          if (tags === null) {
            // 태그 조회 실패(미로그인·오프라인) — 기존처럼 시드 유지
          } else if (tags.length === 0) {
            // 성공 응답의 빈 목록 = 서버에 태그가 없는 계정(과목 전부 삭제 등) —
            // 시드가 부활하지 않게 빈 목록을 그대로 반영한다(리뷰 반영).
            setSubjects([]);
          } else {
            // 세션 조회만 실패한 경우엔 목록 복원은 살리고 오늘 누적만 0으로(기존 동작 유지)
            const sessions = restored ?? [];
            setSubjects(
              // 서버 세션 합도 같은 하루 상한을 받는다(중복·비정상 세션 방어)
              capSubjectsToDay(
                tags.map((t, i) => ({
                  id: t.tagId,
                  name: t.name,
                  // 세션 응답에 과목명 필드가 없어 tagId 일치분만 합산(리뷰 반영 — 구 s.subject 조건은
                  // 서버가 안 보내는 필드라 죽은 코드였음). 태그 매칭 실패(tagId=null) 세션은
                  // 홈 총합(FocusContext)에만 포함되고 과목별로는 귀속 불가.
                  // 세션 전체 길이가 아니라 '오늘 몫'만 — 자정을 걸친 세션의 어제 몫은 제외한다
                  // (GROMO-1252/1214). 몫 산정은 todayRestoreSeconds(서버 확정 분포 우선, 폴백은
                  // 겹침−방해 비율) — FocusContext 총합과 같은 규칙이라 과목 합 == 총합이 유지된다.
                  accumulatedSeconds: sessions
                    .filter((s) => s.focusTagId === t.tagId)
                    .reduce((acc, s) => acc + todayRestoreSeconds(s), 0),
                  color: PALETTE[i % PALETTE.length],
                })),
              ),
            );
          }
        } catch {}
      }
      // 로드가 오늘 기준으로 리셋·복원을 끝냈으므로 여기서 롤오버 기준 날짜를 잡는다
      dayRef.current = todayStr();
      loaded.current = true;
      setReady(true);
    });
  }, []);

  useEffect(() => {
    if (!loaded.current) return;
    // 쓰기 직전에도 날짜 검증(코드리뷰 반영) — 앱이 켜진 채(AppState 전환 없이) 자정을 넘긴 뒤
    // 이름변경·삭제·순서·색 변경처럼 rolloverIfNeeded를 안 거치는 변경이 오면, 어제 누적이
    // 오늘 날짜 도장으로 저장·스냅샷된다. 여기선 롤오버만 하고 리턴 — 리셋된 subjects로
    // 이 effect가 다시 돌며 최신값을 기록한다.
    if (dayRef.current !== todayStr()) {
      rolloverIfNeeded();
      return;
    }
    AsyncStorage.setItem(STORAGE_KEYS.subjects, JSON.stringify({ date: todayStr(), subjects }));
    // 안드로이드 홈 위젯 스냅샷도 같은 시점에 갱신(GROMO-1006). 화면 언마운트 타이밍에 쓰면
    // 마지막 정산 setState와 화면 교체가 한 배치로 묶여 정산 전 값이 기록된다(코드리뷰 반영) —
    // 스토어는 화면 교체 후에도 살아 있어 커밋된 최신값으로 쓴다. iOS·구 바이너리는 래퍼가 no-op.
    StudyWidgetModule.updateTopSubjects(
      subjects.map((x) => ({ name: x.name, seconds: x.accumulatedSeconds, color: x.color })),
    ).catch(() => {});
  }, [subjects, rolloverIfNeeded]);

  function addSubject(name: string) {
    const id = newSubjectId();
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

  // 여러 과목 일괄 삭제 — '삭제 후 남는 이름' 기준으로 서버 태그 동기화를 판단한다.
  // 개별 deleteSubject를 루프로 돌리면 각 호출이 삭제 전 subjects 클로저를 봐서,
  // 같은 이름 과목을 함께 지울 때 서로가 남아 있는 걸로 오판해 서버 삭제가 전부 스킵된다(리뷰 반영).
  function deleteSubjects(ids: string[]) {
    const idSet = new Set(ids);
    const removed = subjects.filter((x) => idSet.has(x.id));
    // 같은 이름 과목이 삭제 후에도 남아 있으면 서버 태그는 그 과목과 공유 중 — 삭제하지 않는다
    const remainingNames = new Set(subjects.filter((x) => !idSet.has(x.id)).map((x) => x.name));
    [...new Set(removed.map((x) => x.name))]
      .filter((n) => !remainingNames.has(n))
      .forEach((n) => syncTagDeleted(n));
    setSubjects((prev) => prev.filter((x) => !idSet.has(x.id)));
  }

  function deleteSubject(id: string) {
    deleteSubjects([id]);
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
    // 자정을 넘긴 뒤 첫 적립이면 어제 누적을 먼저 0으로 — 리셋 없이 더하면 어제+오늘이 섞인다
    rolloverIfNeeded();
    setSubjects((prev) => {
      // 상한은 과목 '합' 기준(코드리뷰 2차) — 행별로만 막으면 여러 과목에 나눠 담긴 채 합이 24h를
      // 넘는다. 남은 여유만큼만 들어간다.
      const room = DAY_SECONDS - prev.reduce((a, x) => a + x.accumulatedSeconds, 0);
      const add = Math.min(seconds, room);
      if (add <= 0) return prev;
      return prev.map((x) =>
        x.id === id ? { ...x, accumulatedSeconds: x.accumulatedSeconds + add } : x,
      );
    });
  }

  return (
    <SubjectContext.Provider
      value={{
        subjects,
        ready,
        addSubject,
        renameSubject,
        deleteSubject,
        deleteSubjects,
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
