import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo-modules-core';

// 피사체 누끼 네이티브 모듈(modules/subject-mask) JS 래퍼 — 오브젝트 캐릭터 스파이크.
// 네이티브가 링크되지 않은 빌드(안드로이드·구 바이너리)에서도 앱이 죽지 않도록
// requireOptionalNativeModule + 전 구간 폴백으로 감싼다.

export interface SubjectMaskResult {
  uri: string; // 누끼 성공 시 투명 PNG의 file:// URI, 실패 시 원본 URI
  width: number;
  height: number;
  cutout: boolean; // false면 배경 제거 없이 원본을 그대로 쓰는 중
  reason: string; // cutout=false일 때 사유 코드
}

interface SubjectMaskNativeModule {
  isSupported(): boolean;
  cutout(uri: string): Promise<SubjectMaskResult>;
}

const native = requireOptionalNativeModule<SubjectMaskNativeModule>('SubjectMask');

// 사유 코드 → 화면에 띄울 한 줄 안내.
const REASON_LABEL: Record<string, string> = {
  ios17_required: 'iOS 17부터 배경 제거가 돼요. 지금은 원본 사진 그대로예요.',
  no_subject: '사진에서 물건을 찾지 못했어요. 배경이 단순한 사진이 잘 돼요.',
  vision_failed: '배경 제거에 실패했어요(시뮬레이터는 미지원). 원본 사진으로 보여줄게요.',
  load_failed: '사진을 읽지 못했어요. 원본 사진으로 보여줄게요.',
  unavailable: '이 빌드에는 배경 제거 모듈이 없어요. 원본 사진으로 보여줄게요.',
};

export function subjectMaskReasonLabel(reason: string): string | null {
  return REASON_LABEL[reason] ?? null;
}

// 누끼 지원 여부(OS 버전 기준). 실제 성공 여부는 돌려봐야 안다.
export function isSubjectMaskSupported(): boolean {
  if (Platform.OS !== 'ios' || !native) return false;
  try {
    return native.isSupported();
  } catch {
    return false;
  }
}

// 사진 URI → 누끼 결과. 어떤 실패에서도 throw하지 않고 원본으로 폴백한다.
export async function cutoutSubject(
  uri: string,
  fallbackSize?: { width: number; height: number },
): Promise<SubjectMaskResult> {
  const fallback: SubjectMaskResult = {
    uri,
    width: fallbackSize?.width ?? 0,
    height: fallbackSize?.height ?? 0,
    cutout: false,
    reason: 'unavailable',
  };
  if (!native) return fallback;
  try {
    const result = await native.cutout(uri);
    // 폭·높이를 못 받았으면 호출자가 알던 원본 크기로 메운다.
    return {
      ...result,
      width: result.width || fallback.width,
      height: result.height || fallback.height,
    };
  } catch {
    return { ...fallback, reason: 'vision_failed' };
  }
}
