// StudyWidgetModule.ts
// StudyWidgetModule.kt(안드로이드 홈 위젯, GROMO-1006) 네이티브 모듈의 JS 래퍼
//
// 역할: '오늘 공부시간 상위 2과목' 스냅샷을 네이티브(SharedPreferences)에 저장하고
// 홈 위젯을 즉시 갱신한다. iOS는 Live Activity(ScreenTimeModule) 경로를 쓰므로 안드로이드 전용.

import { NativeModules, Platform } from 'react-native';

// 위젯에 표시할 과목 항목 — iOS Live Activity의 otherSubjects와 같은 형태
export interface WidgetSubject {
  name: string;
  seconds: number; // 오늘 누적 집중(초)
  color: string; // 대표색 hex(#RRGGBB)
}

// Kotlin 네이티브 모듈 인터페이스 (안드로이드에서만 실제 구현 존재)
interface NativeStudyWidget {
  updateTopSubjects(subjectsJson: string): Promise<boolean>;
}

const NativeStudyWidgetModule = NativeModules.StudyWidgetModule as NativeStudyWidget | undefined;

const StudyWidgetModule = {
  // 오늘 집중시간 내림차순 상위 2과목을 위젯 스냅샷으로 저장(0초 과목 제외).
  // 안드로이드 외 플랫폼·구 바이너리(OTA로 모듈 없음)에는 no-op(false).
  updateTopSubjects: async (subjects: WidgetSubject[]): Promise<boolean> => {
    if (Platform.OS !== 'android') return false;
    if (typeof NativeStudyWidgetModule?.updateTopSubjects !== 'function') return false;
    const top = subjects
      .filter((s) => s.seconds > 0)
      .sort((a, b) => b.seconds - a.seconds)
      .slice(0, 2);
    return NativeStudyWidgetModule.updateTopSubjects(JSON.stringify(top));
  },
};

export default StudyWidgetModule;
