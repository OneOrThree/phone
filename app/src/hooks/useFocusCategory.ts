import { useCallback, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { STORAGE_KEYS } from '@/types/storage';

// 온보딩 W4(목표 선택)에서 고른 집중 목표(시험 카테고리)를 읽는 훅.
// 화면 focus마다 재조회한다 → 설정에서 준비 시험을 바꾸고 돌아오면 리그 등에 즉시 반영된다.
// 서버 필드 미정이라 로컬 저장값만 사용 — TODO: 백엔드 협의 후 GET /user 값으로 교체.
export function useFocusCategory(): string | null {
  const [category, setCategory] = useState<string | null>(null);
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      AsyncStorage.getItem(STORAGE_KEYS.focusCategory).then((c) => !cancelled && setCategory(c));
      return () => {
        cancelled = true;
      };
    }, []),
  );
  return category;
}
