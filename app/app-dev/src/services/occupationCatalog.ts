// occupation 카탈로그 — 준비 시험 목록(code·순서)과 표시명을 공급한다(GROMO-1624).
//
// 두 축의 소스가 다르다:
//  - **목록·순서·존재 여부**: 서버 GET /occupations. code는 서버 CHECK 제약으로 19종 고정이다.
//  - **표시명**: 앱 i18n(shared.focusCategories.name.<CODE>). 서버 displayName은 **폴백**이다.
//
// 표시명을 서버에서 받으면 앱 언어와 무관하게 한국어로 고정된다(occupations.display_name 행이
// Flyway 마이그레이션에 없고 prod DB에만 존재해 다국어화 경로도 없다). 그래서 표시명 정본은
// 앱으로 올리고, 서버 값은 i18n에 키가 없는 신규 code가 생겼을 때의 안전망으로만 둔다.
// 예전엔 앱이 한글 대조표(CATEGORY_TO_OCCUPATION)를 들고 서버 표기와 문자열로 대조해서, 서버
// 표기가 바뀌면 조용히 깨졌다(GROMO-1620). 이제 대조하는 축은 code뿐이다.
//
// 조회는 프로세스당 1회 — 결과는 메모리 + AsyncStorage에 캐시한다. 오프라인·서버 실패 시엔
// 마지막 성공 응답(로컬 캐시)으로 그린다. 캐시도 없으면 null(호출부가 '표시명 없음'으로 처리).
import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getOccupations } from '@/services/userApi';
import { i18n, t } from '@/i18n';
import { STORAGE_KEYS } from '@/types/storage';
import type { Occupation, OccupationResponse } from '@/types/dto/user';

let cache: OccupationResponse[] | null = null;
let inflight: Promise<OccupationResponse[] | null> | null = null;
// 카탈로그 도착 구독자 — 첫 조회가 실패한 채 마운트된 화면(useOccupations)이 언마운트 없이도
// 나중 재시도 성공을 받아볼 수 있게 한다(PR 713 코덱스 3R). 도착은 setCache 한 곳으로 좁힌다.
const listeners = new Set<(list: OccupationResponse[]) => void>();

function setCache(list: OccupationResponse[]): void {
  cache = list;
  listeners.forEach((notify) => notify(list));
}

// 서버 조회 → 성공 시 메모리·로컬 캐시 갱신, 실패 시 로컬 캐시 폴백.
// 동시 호출은 같은 요청을 공유하고, 실패한 요청은 캐시하지 않아 다음 호출에서 재시도된다.
export function loadOccupations(): Promise<OccupationResponse[] | null> {
  if (cache) return Promise.resolve(cache);
  inflight ??= getOccupations()
    .then(async (list) => {
      setCache(list);
      await AsyncStorage.setItem(STORAGE_KEYS.occupations, JSON.stringify(list)).catch(() => {});
      return list;
    })
    .catch(async () => {
      const raw = await AsyncStorage.getItem(STORAGE_KEYS.occupations).catch(() => null);
      const fallback = raw ? (JSON.parse(raw) as OccupationResponse[]) : null;
      // 폴백도 메모리 캐시에 올린다 — 안 올리면 화면 마운트마다 실패할 요청을 다시 쏘고,
      // 그 타임아웃 동안 시험명이 사라졌다 나타난다(PR 713 코덱스 P2). 내용은 마지막 성공
      // 응답 그대로라 세션 내 재검증을 포기해도 잃는 게 없다(19종 고정 목록).
      if (fallback) setCache(fallback);
      return fallback;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

// 테스트 격리용 — 프로세스 캐시를 비운다.
export function resetOccupationCache(): void {
  cache = null;
  inflight = null;
}

// 카탈로그 구독. null = 아직 못 받음(로딩 또는 조회·캐시 모두 실패).
// 실패한 채 마운트돼도 구독을 유지한다 — 다른 화면의 재시도가 성공하면(setCache) 함께 갱신된다.
export function useOccupations(): OccupationResponse[] | null {
  const [list, setList] = useState<OccupationResponse[] | null>(cache);
  useEffect(() => {
    if (cache) {
      setList(cache);
      return;
    }
    const notify = (v: OccupationResponse[]) => setList(v);
    listeners.add(notify);
    loadOccupations(); // 결과는 위 구독으로 받는다(성공·폴백 모두 setCache 경유)
    return () => {
      listeners.delete(notify);
    };
  }, []);
  return list;
}

// 최후 정적 폴백(한국어) — 앱 업데이트 직후 '카탈로그 캐시 없음 + 오프라인 첫 실행'이면
// i18n 키(GROMO-1704 예정)도 서버 응답도 없어 시험명이 전부 사라진다(PR 713 코덱스 3R).
// 표시 전용이다 — 예전 대조표(CATEGORY_TO_OCCUPATION)와 달리 매칭 키로는 절대 쓰지 않는다.
// GROMO-1704의 name.<CODE> 19키가 얹히면 i18n이 항상 이겨 이 표는 죽은 안전망이 된다(그때 제거 가능).
const STATIC_NAME_FALLBACK: Record<Occupation, string> = {
  LABOR_ATTORNEY: '노무사',
  PATENT_ATTORNEY: '변리사',
  TAX_ACCOUNTANT: '세무사',
  CPA: '회계사',
  APPRAISER: '감정평가사',
  CIVIL_SERVANT: '공무원',
  POLICE_FIRE: '경찰·소방',
  ADMIN_EXAM: '행정고시',
  CERTIFICATION: '자격증',
  MIDDLE_SCHOOL: '중학생',
  HIGH_SCHOOL: '고등학생',
  CSAT: '수능·N수',
  UNIVERSITY: '대학생',
  JOB_PREP: '취업 준비',
  ENGLISH_TEST: '토익·토플',
  CODING: '코딩',
  SELF_DEVELOPMENT: '자기계발',
  FOCUS_BUILDING: '집중력 키우기',
  ETC: '기타',
};

// code의 표시명 — 앱 i18n이 정본, 없으면 서버 displayName, 그마저 없으면 정적 폴백(한국어).
// 카탈로그를 아직 못 받았어도(list=null) 글자가 나온다 — 오프라인에서 리그 라벨·프로필
// 시험명이 빈칸으로 뜨지 않는다.
// 카탈로그 목록에 없는 code도 **표시는 한다** — 서버가 soft-delete로 목록에서 뺀 직군이라도
// users.occupation에 이미 배정된 유저가 있어, 여기서 null을 돌리면 그들의 메뉴·프로필·리그
// 라벨이 통째로 사라진다(PR 713 코덱스 7R). '선택 가능' 제한은 표시가 아니라 선택 화면
// (OccupationScreen)이 활성 목록 멤버십으로 건다.
export function displayNameOf(
  list: OccupationResponse[] | null,
  code: Occupation | null | undefined,
): string | null {
  if (!code) return null;
  const key = `shared.focusCategories.name.${code}`;
  // i18n에 키가 없으면 i18n-js가 'missing translation' 문자열을 돌려주므로 defaultValue로 판별한다.
  if (i18n.t(key, { defaultValue: '' })) return t(key);
  return list?.find((o) => o.code === code)?.displayName ?? STATIC_NAME_FALLBACK[code] ?? null;
}

// 단건 표시명 훅 — 카탈로그를 직접 다루지 않는 화면용.
export function useOccupationName(code: Occupation | null | undefined): string | null {
  return displayNameOf(useOccupations(), code);
}
