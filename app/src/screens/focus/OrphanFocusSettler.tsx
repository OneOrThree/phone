import { useEffect, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { STORAGE_KEYS } from '@/types/storage';
import { saveFocusSession } from '@/services/focusApi';
import ScreenTimeModule from '@/services/ScreenTimeModule';
import { useFocus } from '@/store/FocusContext';
import { useCoins } from '@/store/CoinContext';
import { useSubjects } from '@/store/SubjectContext';
import { useUser } from '@/store/UserContext';
import { todayStr, localDateStr } from '@/utils/localDate';
import type { LiveFocusSession } from './types';
import { enqueuePendingFocusUpload } from './pendingFocusUploads';
import { cancelStaleCompletionNotifications } from './completionNotification';

// 죽은(강제 종료된) 세션 정산 — 앱 시작 시 라이브 레코드가 남아 있으면
// 마지막 저장 시점까지의 집중시간을 적립하고, 서버 업로드까지 끝나야 레코드를 지운다.
// 업로드 실패 시 대기열(GROMO-614)로 인계해 재시도하고, 대기열 저장까지 실패한 극단
// 케이스에만 레코드를 보존해 다음 실행에서 이 경로가 재시도한다(로컬 적립은 마킹으로 1회만).
// 주의: finish()와 규칙이 다르다 — finish()는 레코드를 먼저 지우고 업로드하지만,
// 여기서는 업로드/인계가 끝난 뒤에만 레코드를 지운다(강제 종료 세션의 재시도 기회 보존).
// 정산은 두 컨텍스트의 ready(로컬 로드 + 서버 복원 완료)를 기다린 뒤 시작한다 —
// 복원이 네트워크를 기다리는 동안 적립하면 뒤늦은 복원 스냅샷이 적립분을 덮는다(GROMO-677 리뷰).
export function OrphanFocusSettler() {
  const { addFocusSeconds, ready: focusReady } = useFocus();
  const { addCoins, reconcileSessionAward } = useCoins();
  const { addFocusToSubject, ready: subjectsReady } = useSubjects();
  const { userId } = useUser();
  const ran = useRef(false);

  // 세션 중 죽었으면 실드가 켜진 채 남는다 — 정산(네트워크 대기)과 무관하게 마운트 즉시 해제(멱등).
  // 죽은 세션이 예약해둔 종료·경계 알림도 같은 이유로 OS에 남는다 — 함께 회수(GROMO-864).
  useEffect(() => {
    ScreenTimeModule.stopFocusShield().catch(() => {});
    cancelStaleCompletionNotifications().catch(() => {});
  }, []);

  useEffect(() => {
    if (ran.current) return;
    if (!focusReady || !subjectsReady) return;
    ran.current = true;
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
      // 재시도 런(이전 실행에서 이미 마킹)이면 낙관 가산이 이번 실행 메모리에 없다 — 아래
      // 서버 지급 정정에서 낙관분을 0으로 계산해야 지급액이 통째로 반영된다.
      const settledInPreviousRun = rec.settledLocally === true;
      // 서버 지급률(집중 60초당 1코인 — FocusService.sessionRewardCoins)에 정렬한 낙관 계산.
      const coins = Math.floor(focused / 60);
      let stored = raw;
      if (!rec.settledLocally) {
        rec = { ...rec, settledLocally: true };
        stored = JSON.stringify(rec);
        await AsyncStorage.setItem(STORAGE_KEYS.focusLiveSession, stored);
        // '오늘 집중'과 과목 누적은 둘 다 '오늘' 기준 → 세션이 오늘 기록일 때만 반영한다
        // (자정 넘겨 재실행 시 어제 세션이 오늘로 안 잡히게). 코인은 all-time이라 항상 반영.
        // 날짜 규칙은 FocusContext/SubjectContext와 동일(localDate=KST 자정 기준).
        if (localDateStr(new Date(rec.updatedAt)) === todayStr()) {
          addFocusSeconds(focused);
          addFocusToSubject(rec.subjectId, focused);
        }
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
        const res = await saveFocusSession(body);
        // 서버 지급액으로 낙관 가산 정정(B5a — 서버가 정본). 구서버(필드 없음)면 낙관 유지.
        // 서버는 endedAt−startedAt으로 집중초를 재계산하므로 rec.elapsed 기반 낙관치와
        // 어긋날 수 있다 — 그 차이도 여기서 흡수된다. 집중 목표 첫 달성 보너스
        // (goalRewardCoins, GROMO-1039)도 같은 저장 트랜잭션 지급이라 합산.
        reconcileSessionAward(
          settledInPreviousRun ? 0 : coins,
          typeof res?.awardedCoins === 'number'
            ? res.awardedCoins + (res.goalRewardCoins ?? 0)
            : undefined,
        );
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
  }, [
    userId,
    focusReady,
    subjectsReady,
    addFocusSeconds,
    addCoins,
    reconcileSessionAward,
    addFocusToSubject,
  ]);

  return null;
}
