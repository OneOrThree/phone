import { useEffect, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { STORAGE_KEYS } from '@/types/storage';
import { api } from '@/services/api';
import ScreenTimeModule from '@/services/ScreenTimeModule';
import { useFocus } from '@/store/FocusContext';
import { useCoins } from '@/store/CoinContext';
import { useSubjects } from '@/store/SubjectContext';
import type { LiveFocusSession } from './types';

// 죽은(강제 종료된) 세션 정산 — 앱 시작 시 라이브 레코드가 남아 있으면
// 마지막 저장 시점까지의 집중시간을 적립하고 레코드를 지운다. 규칙은 finish()와 동일.
// 컨텍스트들의 AsyncStorage 로드가 먼저 요청되므로(마운트 순서) 적립은 로드된 값 위에 얹힌다.
export function OrphanFocusSettler() {
  const { addFocusSeconds } = useFocus();
  const { addCoins } = useCoins();
  const { addFocusToSubject } = useSubjects();
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    // 세션 중 죽었으면 실드가 켜진 채 남는다 — 레코드 유무와 무관하게 앱 시작 시 해제(멱등).
    ScreenTimeModule.stopFocusShield().catch(() => {});
    (async () => {
      const raw = await AsyncStorage.getItem(STORAGE_KEYS.focusLiveSession);
      if (!raw) return;
      // 중복 정산 방지 — 적립 전에 먼저 지운다
      await AsyncStorage.removeItem(STORAGE_KEYS.focusLiveSession);
      const rec = JSON.parse(raw) as LiveFocusSession;
      const focused = Math.floor(rec.elapsed);
      if (focused <= 0) return;
      // '오늘 집중'은 오늘 기록일 때만 반영(자정 넘겨 재실행 시 어제 세션이 오늘로 안 잡히게).
      // 과목 누적(all-time)과 코인은 항상 반영. 날짜 규칙은 FocusContext와 동일(ISO 날짜).
      if (rec.updatedAt.slice(0, 10) === new Date().toISOString().slice(0, 10)) {
        addFocusSeconds(focused);
      }
      addFocusToSubject(rec.subjectId, focused);
      const coins = Math.floor(focused / 10);
      if (coins > 0) addCoins(coins);
      api
        .post('/api/v1/focus-session', {
          focusTagId: null,
          subject: rec.subjectName,
          startedAt: rec.startedAt,
          endedAt: rec.updatedAt,
          distractionCount: 0,
          totalDistractionSeconds: 0,
        })
        .catch(() => {});
    })().catch(() => {});
  }, [addFocusSeconds, addCoins, addFocusToSubject]);

  return null;
}
