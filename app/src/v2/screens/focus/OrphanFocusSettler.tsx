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
// 마지막 저장 시점까지의 집중시간을 적립하고, 서버 업로드까지 성공해야 레코드를 지운다.
// 업로드 실패 시 레코드를 보존해 다음 실행에서 재시도한다(로컬 적립은 마킹으로 1회만). 규칙은 finish()와 동일.
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
      let rec: LiveFocusSession;
      try {
        rec = JSON.parse(raw) as LiveFocusSession;
      } catch {
        // 깨진 레코드 — 정산할 수 없으니 제거만 한다
        await AsyncStorage.removeItem(STORAGE_KEYS.focusLiveSession);
        return;
      }
      const focused = Math.floor(rec.elapsed);
      if (focused <= 0) {
        await AsyncStorage.removeItem(STORAGE_KEYS.focusLiveSession);
        return;
      }
      // 로컬 적립은 1회만 — 중복 적립 방지로 적립 전에 먼저 마킹해 되쓴다.
      // 레코드는 서버 업로드 성공 전까지 지우지 않는다(먼저 지우면 업로드 실패 시 기록이 영구 유실).
      let stored = raw;
      if (!rec.settledLocally) {
        rec = { ...rec, settledLocally: true };
        stored = JSON.stringify(rec);
        await AsyncStorage.setItem(STORAGE_KEYS.focusLiveSession, stored);
        // '오늘 집중'은 오늘 기록일 때만 반영(자정 넘겨 재실행 시 어제 세션이 오늘로 안 잡히게).
        // 과목 누적(all-time)과 코인은 항상 반영. 날짜 규칙은 FocusContext와 동일(ISO 날짜).
        if (rec.updatedAt.slice(0, 10) === new Date().toISOString().slice(0, 10)) {
          addFocusSeconds(focused);
        }
        addFocusToSubject(rec.subjectId, focused);
        const coins = Math.floor(focused / 10);
        if (coins > 0) addCoins(coins);
      }
      try {
        await api.post('/api/v1/focus-session', {
          focusTagId: null,
          subject: rec.subjectName,
          startedAt: rec.startedAt,
          endedAt: rec.updatedAt,
          distractionCount: 0,
          totalDistractionSeconds: 0,
        });
      } catch {
        // 업로드 실패 — 레코드를 보존해 다음 실행에서 재업로드(로컬 적립은 마킹으로 스킵)
        return;
      }
      // 업로드 성공 후 제거 — 그 사이 새 세션이 레코드를 덮어썼을 수 있으니 같은 값일 때만 지운다
      const cur = await AsyncStorage.getItem(STORAGE_KEYS.focusLiveSession);
      if (cur === stored) {
        await AsyncStorage.removeItem(STORAGE_KEYS.focusLiveSession);
      }
    })().catch(() => {});
  }, [addFocusSeconds, addCoins, addFocusToSubject]);

  return null;
}
