import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo-modules-core';
import { t } from '@/i18n';

// 피사체 누끼 네이티브 모듈(modules/subject-mask) JS 래퍼 — 오브젝트 캐릭터.
// iOS(Vision)·안드로이드(ML Kit) 양쪽에 같은 계약으로 링크된다. 네이티브가 없는 빌드
// (구 바이너리·미지원 플랫폼)에서도 앱이 죽지 않도록 requireOptionalNativeModule + 전 구간 폴백으로 감싼다.

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
  saveCustomCharacter(base64: string, userId: string | null): Promise<string>;
}

const native = requireOptionalNativeModule<SubjectMaskNativeModule>('SubjectMask');

// 사유 코드(네이티브가 주는 값) → 화면에 띄울 한 줄 안내의 번역 키.
const REASON_KEY: Record<string, string> = {
  ios17_required: 'services.subjectMask.reasonIos17Required',
  no_subject: 'services.subjectMask.reasonNoSubject',
  vision_failed: 'services.subjectMask.reasonVisionFailed',
  load_failed: 'services.subjectMask.reasonLoadFailed',
  unavailable: 'services.subjectMask.reasonUnavailable',
  // 안드로이드(ML Kit) 전용 사유
  model_downloading: 'services.subjectMask.reasonModelDownloading',
  gms_unavailable: 'services.subjectMask.reasonGmsUnavailable',
};

export function subjectMaskReasonLabel(reason: string): string | null {
  const key = REASON_KEY[reason];
  return key ? t(key) : null;
}

// 누끼 지원 여부. iOS(Vision)·안드로이드(ML Kit) 둘 다 대상이며, 네이티브 모듈이 링크돼 있으면
// 실제 판정은 네이티브에 위임한다(iOS는 OS 버전, 안드는 GMS 가용성). 실제 성공 여부는 돌려봐야 안다.
export function isSubjectMaskSupported(): boolean {
  if ((Platform.OS !== 'ios' && Platform.OS !== 'android') || !native) return false;
  try {
    return native.isSupported();
  } catch {
    return false;
  }
}

// 누끼 캐릭터를 저장할 수 있는 네이티브가 링크돼 있는지. isSubjectMaskSupported()의 iOS17+ 판정과
// 별개다 — 배경 제거(cutout)는 iOS17+가 필요하지만, 저장(saveCustomCharacter)은 모듈만 있으면
// iOS16.4에서도 원본으로 동작한다. 반대로 저장 불가한 빌드(안드로이드·구 바이너리 OTA)에선
// 온보딩이 이 경우를 스킵할 수 있게 이 판정을 따로 노출한다.
// ⚠️ native!=null만으론 부족하다 — 구 스파이크 OTA 바이너리는 isSupported·cutout만 노출하고
// saveCustomCharacter가 없어, 그것만 보면 저장 불가 기기를 '가능'으로 오판해 온보딩이 다시 막힌다.
// 저장 함수 자체의 존재까지 확인한다.
export function isSubjectMaskModuleAvailable(): boolean {
  return native != null && typeof native.saveCustomCharacter === 'function';
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

// 합성된 오브젝트 캐릭터(팔·다리·눈 포함 투명 PNG)를 기기 Documents에 영구 저장하고
// 그 file:// 경로를 돌려준다. 작은 아바타·위젯·실드 등 여러 곳에서 이 한 장을 축소해 쓴다.
// cutout과 달리 폴백이 없다 — 네이티브 저장 없이는 영구 캐릭터를 만들 수 없으므로
// 네이티브 모듈이 링크되지 않은 빌드에서는 명확히 throw한다.
// userId: 한 기기 두 계정이 서로의 캐릭터 파일을 덮어쓰지 않도록 유저별 파일로 저장한다.
// 없으면(null) 기존 단일 파일명으로 폴백한다(하위호환).
export async function saveCustomCharacter(base64: string, userId?: string | null): Promise<string> {
  if (!native) {
    throw new Error('배경 제거 모듈이 없어 커스텀 캐릭터를 저장할 수 없어요.');
  }
  return native.saveCustomCharacter(base64, userId ?? null);
}
