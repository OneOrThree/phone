// 리텐션 유저 별점 요청(GROMO-980) — 누적 7일 이상 접속 + 집중 세션 완료 시 OS 별점창을 1회 노출한다.
// requestReview()는 iOS(SKStoreReviewController)/안드로이드(Play In-App Review)로 자동 분기되고,
// 실제 노출 빈도는 OS가 제한한다(호출해도 안 뜰 수 있음). 우리 쪽은 조건 판정 + 1회 마커만 담당.
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as StoreReview from 'expo-store-review';

import { STORAGE_KEYS } from '@/types/storage';
import { todayStr } from '@/utils/localDate';

const REQUIRED_ACCESS_DAYS = 7; // 누적 접속 임계값(서로 다른 날 기준)

interface AccessDays {
  count: number; // 접속한 서로 다른 날의 누적 수
  lastDate: string; // 마지막으로 카운트한 날짜(YYYY-MM-DD) — 하루 1회 증가 판정용
}

async function readAccessDays(): Promise<AccessDays> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEYS.storeReviewAccessDays);
    if (!raw) return { count: 0, lastDate: '' };
    const p = JSON.parse(raw) as { count?: unknown; lastDate?: unknown };
    return {
      count: typeof p.count === 'number' ? p.count : 0,
      lastDate: typeof p.lastDate === 'string' ? p.lastDate : '',
    };
  } catch {
    return { count: 0, lastDate: '' };
  }
}

// 오늘 첫 접속이면 누적 접속일 +1. 앱 시작·포그라운드 복귀마다 호출해도 하루 1회만 증가한다.
export async function recordAccessDay(): Promise<void> {
  const today = todayStr();
  const { count, lastDate } = await readAccessDays();
  if (lastDate === today) return; // 오늘 이미 카운트함
  const next: AccessDays = { count: count + 1, lastDate: today };
  await AsyncStorage.setItem(STORAGE_KEYS.storeReviewAccessDays, JSON.stringify(next)).catch(
    () => {},
  );
}

// 별점 요청 조건 판정 후 1회 노출 — 집중 세션 완료 시 호출한다.
// 조건: 아직 요청 안 함 && 누적 7일 이상 접속 && OS가 요청 가능.
export async function maybeRequestReview(): Promise<void> {
  try {
    if ((await AsyncStorage.getItem(STORAGE_KEYS.storeReviewRequested)) === '1') return;
    const { count } = await readAccessDays();
    if (count < REQUIRED_ACCESS_DAYS) return;
    if (!(await StoreReview.isAvailableAsync())) return;
    await StoreReview.requestReview();
    // 요청창을 띄운(또는 OS가 스킵한) 뒤 마커를 세워 다시 노출하지 않는다.
    await AsyncStorage.setItem(STORAGE_KEYS.storeReviewRequested, '1');
  } catch {
    // 별점 요청 실패는 조용히 무시 — 핵심 플로우를 막지 않는다.
  }
}
