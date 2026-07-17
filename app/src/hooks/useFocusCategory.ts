import { useCallback, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { STORAGE_KEYS } from '@/types/storage';

// 온보딩 W4(목표 선택)에서 고른 집중 목표(시험 카테고리)를 읽는 훅.
// 화면 focus마다 재조회한다 → 설정에서 준비 시험을 바꾸고 돌아오면 리그 등에 즉시 반영된다.
// 서버 필드 미정이라 로컬 저장값만 사용 — TODO: 백엔드 협의 후 GET /user 값으로 교체.
// 반환값 3상태: undefined = 저장값 읽는 중(로딩), null = 미설정 확정, string = 설정됨.
// 로딩과 미설정을 구분해야 "카테고리 없음" 분기(기본 과목 판별 등)가 로딩 중에 오발동하지 않는다
// (PR 287 Codex 리뷰 반영).
export function useFocusCategory(): string | null | undefined {
  const [category, setCategory] = useState<string | null | undefined>(undefined);
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      AsyncStorage.getItem(STORAGE_KEYS.focusCategory).then(
        (c) => !cancelled && setCategory(c),
        // 읽기 실패 — 미설정(null)으로 확정. undefined(로딩)로 남기면 소비자들이 로딩 대기에
        // 영원히 갇힌다(리그 조회 스킵·기본 과목 판별 보류, PR 291 리뷰 반영).
        () => !cancelled && setCategory(null),
      );
      return () => {
        cancelled = true;
      };
    }, []),
  );
  return category;
}
