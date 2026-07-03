import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { STORAGE_KEYS } from '@/types/storage';

// 온보딩 16(목표 선택)에서 고른 집중 목표(시험 카테고리)를 읽는 훅.
// 서버 필드 미정이라 로컬 저장값만 사용 — TODO: 백엔드 협의 후 GET /user 값으로 교체.
export function useFocusCategory(): string | null {
  const [category, setCategory] = useState<string | null>(null);
  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEYS.focusCategory).then(setCategory);
  }, []);
  return category;
}
