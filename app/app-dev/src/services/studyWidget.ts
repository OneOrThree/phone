// 안드로이드 홈 위젯('오늘의 공부시간') 브리지 — modules/study-widget(로컬 Expo 모듈)의 JS 래퍼.
//
// 1.x 앱이 홈 위젯을 등록해 뒀고 2.0은 같은 패키지로 제자리 업데이트되므로, 네이티브 쪽은
// 같은 컴포넌트 이름으로 위젯을 유지하고 여기서 2.0의 '오늘 집중' 값을 스냅샷으로 넘긴다.
// iOS·웹에는 이 위젯이 없어 no-op(false)이다.
import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo';
import { primitiveTokens } from '@/design-system/tokens';
import { dayKey, kstDayStart, recordSecondsBetween, type RecordItem } from '@/services/model';

// 위젯 과목 칩 한 줄 — 1.x 스냅샷({name, seconds, color})과 같은 형태(네이티브 호환)
export type WidgetSubject = { name: string; seconds: number; color: string };

export type StudyWidgetSnapshot = {
  // 스냅샷을 계산한 KST 날짜(yyyy-MM-dd, dayKey) — 네이티브가 그대로 snapshot_date 로 저장하고
  // 위젯도 KST 기준으로 '오늘'을 판정한다(기기 시간대와 무관하게 JS 와 같은 날짜 기준).
  day: string;
  // 오늘 총 집중(초) — 홈 HUD의 '오늘 집중'과 같은 값
  totalSeconds: number;
  // 오늘 집중 내림차순 상위 2과목(0초 제외)
  subjects: WidgetSubject[];
};

type NativeStudyWidget = {
  updateSnapshot(subjectsJson: string, totalSeconds: number, day: string): Promise<boolean>;
};

const native: NativeStudyWidget | null =
  Platform.OS === 'android'
    ? requireOptionalNativeModule<NativeStudyWidget>('StudyWidgetModule')
    : null;

// 2.0은 과목별 색이 없어 칩 점은 앱 포인트색 하나로 그린다
const SUBJECT_COLOR = primitiveTokens.color.pink;

// 오늘(KST 자정~) 기록을 과목별로 합쳐 위젯 스냅샷을 만든다.
// totalSeconds는 화면이 이미 계산한 값(서버 스냅샷 우선)을 그대로 받아 홈 HUD와 어긋나지 않게 한다.
export function buildStudyWidgetSnapshot(
  records: RecordItem[],
  islandId: string,
  totalSeconds: number,
  now = Date.now(),
): StudyWidgetSnapshot {
  const day = dayKey(now);
  const from = kstDayStart(day),
    until = from + 86400000;
  const bySubject = new Map<string, number>();
  for (const r of records) {
    if (r.islandId !== islandId) continue;
    const seconds = recordSecondsBetween(r, from, until);
    if (seconds > 0) bySubject.set(r.subject, (bySubject.get(r.subject) ?? 0) + seconds);
  }
  const subjects = [...bySubject]
    .map(([name, seconds]) => ({ name, seconds: Math.floor(seconds), color: SUBJECT_COLOR }))
    .filter((s) => s.seconds > 0)
    .sort((a, b) => b.seconds - a.seconds)
    .slice(0, 2);
  return { day, totalSeconds: Math.max(0, Math.floor(totalSeconds)), subjects };
}

// 같은 스냅샷을 반복해서 쓰지 않는다(홈 화면 리렌더마다 SharedPreferences·위젯 갱신 방지).
// lastSent 는 네이티브 저장이 끝난 스냅샷, inFlight 는 보내는 중인 스냅샷이다. 성공 뒤에만 lastSent 를
// 기록하므로, 응답 전에 같은 스냅샷이 또 오면 inFlight 의 약속을 함께 기다린다(중복 쓰기 방지).
let lastSent: string | null = null;
let inFlight: { key: string; promise: Promise<boolean> } | null = null;
// clearStudyWidget 이 올리는 세대 — 비우기 전에 출발한 전송이 뒤늦게 성공해도 lastSent 를 되살려
// 다음 계정의 같은 값 전송을 건너뛰지 않게 한다.
let generation = 0;

// 스냅샷을 네이티브에 저장하고 배치된 위젯을 즉시 다시 그린다.
// 안드로이드 외 플랫폼·모듈이 없는 바이너리(OTA)에서는 no-op(false), 실패해도 앱 흐름을 막지 않는다.
export function updateStudyWidget(snapshot: StudyWidgetSnapshot): Promise<boolean> {
  if (!native) return Promise.resolve(false);
  const updater = native;
  const subjectsJson = JSON.stringify(snapshot.subjects);
  // 날짜를 키에 넣어, 자정을 넘긴 뒤 같은 값이라도 새 날짜로 다시 저장되게 한다
  const key = `${snapshot.day}|${snapshot.totalSeconds}|${subjectsJson}`;
  if (key === lastSent) return Promise.resolve(true);
  if (inFlight?.key === key) return inFlight.promise;
  const sentGeneration = generation;
  // 전송 표식을 먼저 세운다 — 응답 전에 들어온 같은 스냅샷은 아래 약속을 함께 기다린다.
  const entry: { key: string; promise: Promise<boolean> } = {
    key,
    promise: Promise.resolve(false),
  };
  inFlight = entry;
  entry.promise = (async () => {
    try {
      const ok = await updater.updateSnapshot(subjectsJson, snapshot.totalSeconds, snapshot.day);
      if (generation === sentGeneration) lastSent = key;
      return ok;
    } catch {
      return false; // lastSent 를 남기지 않아 다음 호출이 다시 시도한다
    } finally {
      if (inFlight === entry) inFlight = null;
    }
  })();
  return entry.promise;
}

/**
 * 위젯을 빈 상태로 되돌린다 — 로그아웃·계정 전환·탈퇴 때 이전 계정의 과목·공부시간이 런처에 남지
 * 않게 한다(1.x 도 로그아웃·계정 전환에서 빈 스냅샷을 썼다, GROMO-1006). 위젯이 읽는 네이티브
 * SharedPreferences 는 앱 저장소 정리로 지워지지 않는다. 중복 방지 기록도 비워, 다음 홈 렌더가 같은
 * 값이라도 다시 보내게 한다. 실패는 삼키고 false — 호출부는 기다리지 않아도 된다(best-effort).
 */
export async function clearStudyWidget(now = Date.now()): Promise<boolean> {
  if (!native) return false;
  generation += 1;
  lastSent = null;
  inFlight = null;
  try {
    return await native.updateSnapshot('[]', 0, dayKey(now));
  } catch {
    return false;
  }
}
