import { useEffect, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { STORAGE_KEYS } from '@/types/storage';
import { api } from '@/services/api';
import ScreenTimeModule from '@/services/ScreenTimeModule';
import { useFocus } from '@/store/FocusContext';
import { useCoins } from '@/store/CoinContext';
import { useSubjects } from '@/store/SubjectContext';
import { useUser } from '@/store/UserContext';
import type { LiveFocusSession } from './types';
import { enqueuePendingFocusUpload } from './pendingFocusUploads';

// 죽은(강제 종료된) 세션 정산 — 앱 시작 시 라이브 레코드가 남아 있으면
// 마지막 저장 시점까지의 집중시간을 적립하고, 서버 업로드까지 끝나야 레코드를 지운다.
// 업로드 실패 시 대기열(GROMO-614)로 인계해 재시도하고, 대기열 저장까지 실패한 극단
// 케이스에만 레코드를 보존해 다음 실행에서 이 경로가 재시도한다(로컬 적립은 마킹으로 1회만).
// 주의: finish()와 규칙이 다르다 — finish()는 레코드를 먼저 지우고 업로드하지만,
// 여기서는 업로드/인계가 끝난 뒤에만 레코드를 지운다(강제 종료 세션의 재시도 기회 보존).
// 컨텍스트들의 AsyncStorage 로드가 먼저 요청되므로(마운트 순서) 적립은 로드된 값 위에 얹힌다.
export function OrphanFocusSettler() {
  const { addFocusSeconds } = useFocus();
  const { addCoins } = useCoins();
  const { addFocusToSubject } = useSubjects();
  const { userId } = useUser();
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
      // 계정 대조 — 레코드 소유자와 현재 계정이 다르면(로그아웃 후 다른 계정으로 로그인 등)
      // 정산하지 않고 폐기한다. 남의 세션을 현재 계정에 적립/업로드하면 통계 오염 + 메타데이터 누출.
      // userId 필드가 없는 구버전 레코드(undefined)도 소유자를 알 수 없으므로 이 비교에서
      // 함께 걸러 폐기한다(undefined는 string|null과 절대 같지 않음 — 대기열과 같은 규칙).
      if (rec.userId !== userId) {
        await AsyncStorage.removeItem(STORAGE_KEYS.focusLiveSession);
        return;
      }
      const focused = Math.floor(rec.elapsed);
      if (focused <= 0) {
        await AsyncStorage.removeItem(STORAGE_KEYS.focusLiveSession);
        return;
      }
      // 로컬 적립은 1회만 — 중복 적립 방지로 적립 전에 먼저 마킹해 되쓴다.
      // 레코드는 업로드/인계가 끝나기 전까지 지우지 않는다(먼저 지우면 실패 시 기록이 영구 유실).
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
      const body = {
        focusTagId: null,
        subject: rec.subjectName,
        startedAt: rec.startedAt,
        endedAt: rec.updatedAt,
        distractionCount: 0,
        totalDistractionSeconds: 0,
      };
      try {
        await api.post('/api/v1/focus-session', body);
      } catch {
        // 업로드 실패 — 대기열(GROMO-614)로 인계해 앱 시작·포그라운드 복귀마다 재시도.
        // 대기열 저장까지 실패하면 레코드를 보존해 다음 실행에서 이 경로가 재시도한다.
        try {
          await enqueuePendingFocusUpload(body, userId);
        } catch {
          return;
        }
      }
      // 업로드 성공(또는 대기열 인계) 후 제거 — 그 사이 새 세션이 레코드를 덮어썼을 수
      // 있으니 같은 값일 때만 지운다.
      const cur = await AsyncStorage.getItem(STORAGE_KEYS.focusLiveSession);
      if (cur === stored) {
        await AsyncStorage.removeItem(STORAGE_KEYS.focusLiveSession);
      }
    })().catch(() => {});
  }, [userId, addFocusSeconds, addCoins, addFocusToSubject]);

  return null;
}
