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

// 서버 조회 → 성공 시 메모리·로컬 캐시 갱신, 실패 시 로컬 캐시 폴백.
// 동시 호출은 같은 요청을 공유하고, 실패한 요청은 캐시하지 않아 다음 호출에서 재시도된다.
export function loadOccupations(): Promise<OccupationResponse[] | null> {
  if (cache) return Promise.resolve(cache);
  inflight ??= getOccupations()
    .then(async (list) => {
      cache = list;
      await AsyncStorage.setItem(STORAGE_KEYS.occupations, JSON.stringify(list)).catch(() => {});
      return list;
    })
    .catch(async () => {
      const raw = await AsyncStorage.getItem(STORAGE_KEYS.occupations).catch(() => null);
      return raw ? (JSON.parse(raw) as OccupationResponse[]) : null;
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
export function useOccupations(): OccupationResponse[] | null {
  const [list, setList] = useState<OccupationResponse[] | null>(cache);
  useEffect(() => {
    if (list) return;
    let cancelled = false;
    loadOccupations().then((v) => !cancelled && v && setList(v));
    return () => {
      cancelled = true;
    };
  }, [list]);
  return list;
}

// code의 표시명 — 앱 i18n이 정본, 없으면 서버 displayName 폴백.
// 카탈로그를 아직 못 받았어도(list=null) i18n 키만 있으면 글자가 나온다 — 오프라인에서 리그
// 라벨·프로필 시험명이 빈칸으로 뜨지 않는다.
// 카탈로그를 받았는데 그 code가 목록에 없으면 null — 서버가 내리지 않는 시험을 앱이 혼자
// 그리지 않게 한다(신규/폐지 code의 안전망).
export function displayNameOf(
  list: OccupationResponse[] | null,
  code: Occupation | null | undefined,
): string | null {
  if (!code) return null;
  const server = list?.find((o) => o.code === code);
  if (list && !server) return null;
  const key = `shared.focusCategories.name.${code}`;
  // i18n에 키가 없으면 i18n-js가 'missing translation' 문자열을 돌려주므로 defaultValue로 판별한다.
  return i18n.t(key, { defaultValue: '' }) ? t(key) : (server?.displayName ?? null);
}

// 단건 표시명 훅 — 카탈로그를 직접 다루지 않는 화면용.
export function useOccupationName(code: Occupation | null | undefined): string | null {
  return displayNameOf(useOccupations(), code);
}
