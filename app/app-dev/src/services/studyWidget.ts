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
  // 오늘 총 집중(초) — 홈 HUD의 '오늘 집중'과 같은 값
  totalSeconds: number;
  // 오늘 집중 내림차순 상위 2과목(0초 제외)
  subjects: WidgetSubject[];
};

type NativeStudyWidget = {
  updateSnapshot(subjectsJson: string, totalSeconds: number): Promise<boolean>;
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
  const from = kstDayStart(dayKey(now)),
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
  return { totalSeconds: Math.max(0, Math.floor(totalSeconds)), subjects };
}

// 같은 스냅샷을 반복해서 쓰지 않는다(홈 화면 리렌더마다 SharedPreferences·위젯 갱신 방지)
let lastSent: string | null = null;

// 스냅샷을 네이티브에 저장하고 배치된 위젯을 즉시 다시 그린다.
// 안드로이드 외 플랫폼·모듈이 없는 바이너리(OTA)에서는 no-op(false), 실패해도 앱 흐름을 막지 않는다.
export async function updateStudyWidget(snapshot: StudyWidgetSnapshot): Promise<boolean> {
  if (!native) return false;
  const subjectsJson = JSON.stringify(snapshot.subjects);
  // 날짜를 키에 넣어, 자정을 넘긴 뒤 같은 값이라도 새 날짜로 다시 저장되게 한다
  const key = `${dayKey()}|${snapshot.totalSeconds}|${subjectsJson}`;
  if (key === lastSent) return true;
  try {
    const ok = await native.updateSnapshot(subjectsJson, snapshot.totalSeconds);
    lastSent = key;
    return ok;
  } catch {
    return false;
  }
}
