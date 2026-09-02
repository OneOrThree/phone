// 준비 시험(occupation) 서버 쓰기 — 정본은 서버 users.occupation 하나다(GROMO-1624).
// 예전엔 앱이 한글 표시명을 로컬 정본으로 굴리고 서버엔 '알려주기'만 해서, 알려주기가 실패하면
// 화면(로컬)과 집계(서버)가 조용히 갈라졌다(GROMO-1620 · 티켓 1624 조재영 코멘트).
// 이제 로컬 정본은 없다 — 여기 두 함수만 서버 값을 건드린다.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { updateOccupation } from '@/services/userApi';
import { logOccupationSyncFailed, type OccupationSyncSource } from '@/services/analyticsEvents';
import { STORAGE_KEYS } from '@/types/storage';
import type { Occupation } from '@/types/dto/user';

// 준비 시험 변경 — 서버 PATCH가 성공해야 반영이다(화면 선반영 없음).
// 성공 시에만 true를 돌려주고, 호출부가 화면 상태(UserContext.setOccupation)를 갱신한다.
export async function syncOccupation(
  code: Occupation,
  source: OccupationSyncSource,
): Promise<boolean> {
  try {
    await updateOccupation({ occupation: code });
    return true;
  } catch {
    // 조용히 삼키지 않는다 — 1620이 안 보이던 이유
    logOccupationSyncFailed({ request_source: source });
    return false;
  }
}

// 폰에 남아 있는 구 한글 값(gromo:focusCategory)의 스냅샷 — **동결**이다. 살아 있는 대조표가
// 아니라 과거 기록이라, 이 앱은 이 키를 아래 1회 복구에서 읽기만 하고 다시 쓰지 않는다.
// 두 출처가 섞여 있다: 앱 하드코딩 목록(설정 > 준비 시험)과 GROMO-1620 이전 서버 표시명(온보딩).
// 그래서 '수능·N수'(앱)와 '수능/N수'(구 서버)가 둘 다 들어 있다.
const LEGACY_CATEGORY_TO_OCCUPATION: Record<string, Occupation> = {
  노무사: 'LABOR_ATTORNEY',
  변리사: 'PATENT_ATTORNEY',
  세무사: 'TAX_ACCOUNTANT',
  회계사: 'CPA',
  감정평가사: 'APPRAISER',
  공무원: 'CIVIL_SERVANT',
  '경찰·소방': 'POLICE_FIRE',
  경찰소방: 'POLICE_FIRE', // GROMO-1620 이전 서버 표시명
  행정고시: 'ADMIN_EXAM',
  자격증: 'CERTIFICATION',
  중학생: 'MIDDLE_SCHOOL',
  고등학생: 'HIGH_SCHOOL',
  '수능·N수': 'CSAT',
  '수능/N수': 'CSAT', // GROMO-1620 이전 서버 표시명
  대학생: 'UNIVERSITY',
  '취업 준비': 'JOB_PREP',
  '토익·토플': 'ENGLISH_TEST',
  '토익/토플': 'ENGLISH_TEST', // GROMO-1620 이전 서버 표시명
  코딩: 'CODING',
  자기계발: 'SELF_DEVELOPMENT',
  '집중력 키우기': 'FOCUS_BUILDING',
  기타: 'ETC',
};

// 피해 유저 복구(GROMO-1624) — 서버가 NULL인데 폰엔 옛 한글 값이 남은 유저를 살린다.
// GROMO-1620에서 표시명이 어긋나 PATCH를 '호출조차 안 한' 온보딩 완주자들(2026-08-25 기준
// 12명)이 대상. 그 버그 경로는 code 직접 전송으로 사라졌으므로 이 복구는 과거분 전용이다.
// 서버에 값이 있으면 아무것도 하지 않는다 — 서버가 정본이므로 폰의 옛 값으로 덮지 않는다.
// 반환: 복구한 code(호출부가 이번 세션 프로필에 반영). 대상 아님·실패면 null.
export async function recoverOccupation(profile: {
  occupation?: unknown;
}): Promise<Occupation | null> {
  try {
    if (typeof profile.occupation === 'string' && profile.occupation) return null;
    const legacy = await AsyncStorage.getItem(STORAGE_KEYS.focusCategory);
    const code = legacy ? LEGACY_CATEGORY_TO_OCCUPATION[legacy] : undefined;
    // 실패해도 마커를 남기지 않는다 — 서버가 NULL인 동안 다음 실행이 그대로 재시도한다.
    return code && (await syncOccupation(code, 'recovery')) ? code : null;
  } catch {
    return null;
  }
}
