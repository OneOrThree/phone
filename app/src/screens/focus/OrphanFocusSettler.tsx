import { useEffect, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { STORAGE_KEYS } from '@/types/storage';
import ScreenTimeModule from '@/services/ScreenTimeModule';
import { useFocus } from '@/store/FocusContext';
import { useCoins } from '@/store/CoinContext';
import { useSubjects } from '@/store/SubjectContext';
import { useUser } from '@/store/UserContext';
import { todayOverlapSeconds, todayStr } from '@/utils/localDate';
import type { LiveFocusSession } from './types';
import { uploadFocusBlock } from './uploadFocusBlock';
import { cancelMarker } from './pendingMarkerCancels';
import { ensureFocusTagId } from './tagSync';
import { cancelStaleCompletionNotifications } from './completionNotification';
import {
  readPersistedSessionV1,
  removePersistedSessionV1,
  orphanSettlementFromV1,
} from './engine/persistence';

// 죽은(강제 종료된) 세션 정산 — 앱 시작 시 라이브 레코드가 남아 있으면
// 마지막 저장 시점까지의 집중시간을 적립하고, 서버 업로드까지 끝나야 레코드를 지운다.
// 업로드 실패 시 대기열(GROMO-614)로 인계해 재시도하고, 대기열 저장까지 실패한 극단
// 케이스에만 레코드를 보존해 다음 실행에서 이 경로가 재시도한다(로컬 적립은 마킹으로 1회만).
// 주의: finish()와 규칙이 다르다 — finish()는 레코드를 먼저 지우고 업로드하지만,
// 여기서는 업로드/인계가 끝난 뒤에만 레코드를 지운다(강제 종료 세션의 재시도 기회 보존).
// 정산은 두 컨텍스트의 ready(로컬 로드 + 서버 복원 완료)를 기다린 뒤 시작한다 —
// 복원이 네트워크를 기다리는 동안 적립하면 뒤늦은 복원 스냅샷이 적립분을 덮는다(GROMO-677 리뷰).
/**
 * legacy 라이브 레코드에 `settledLocally`를 찍는다 — v1 경로가 로컬 적립을 마킹할 때의 짝.
 * 레코드가 없거나 소유자가 다르면 아무것도 하지 않는다(남의 기록을 건드리지 않는다).
 */
async function syncLegacySettledMarker(userId: string | null): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEYS.focusLiveSession);
    if (!raw) return;
    const legacy = JSON.parse(raw) as LiveFocusSession;
    if (legacy.userId !== userId || legacy.settledLocally) return;
    await AsyncStorage.setItem(
      STORAGE_KEYS.focusLiveSession,
      JSON.stringify({ ...legacy, settledLocally: true }),
    );
  } catch {
    // 마커 동기화 실패는 정산을 막지 않는다 — 롤백이 겹쳐야 드러나는 이중 적립 방어일 뿐이다.
  }
}

export function OrphanFocusSettler() {
  const { addFocusSeconds, ready: focusReady } = useFocus();
  const { refresh: refreshCoins } = useCoins();
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
      // 엔진 영속 v1 우선(GROMO-1600) — 방해초를 역산이 아니라 실측(blockPause)으로 정산한다.
      // v1과 legacy는 같은 세션의 이중 표현이라, v1 경로의 폐기·완료 지점마다 legacy도 함께
      // 지운다(남기면 다음 부팅의 legacy 폴백이 같은 꼬리를 한 번 더 정산한다).
      const v1 = await readPersistedSessionV1();
      if (v1 != null) {
        if (v1.userId !== userId) {
          removePersistedSessionV1();
          await AsyncStorage.removeItem(STORAGE_KEYS.focusLiveSession);
          return;
        }
        const settlement = orphanSettlementFromV1(v1);
        if (settlement.focused <= 0) {
          removePersistedSessionV1();
          await AsyncStorage.removeItem(STORAGE_KEYS.focusLiveSession);
          return;
        }
        // 로컬 적립 1회 — legacy 경로와 같은 마킹 규칙(적립 전에 먼저 되쓴다).
        let storedV1 = JSON.stringify(v1);
        if (!v1.settledLocally) {
          const marked = { ...v1, settledLocally: true };
          storedV1 = JSON.stringify(marked);
          await AsyncStorage.setItem(STORAGE_KEYS.focusSessionV1, storedV1);
          // **legacy 레코드에도 같은 마커를 찍는다.** 업로드가 failed면 두 레코드가 모두
          // 보존되는데, 그 상태로 OTA 롤백이 나면 구버전 Settler는 legacy만 읽고
          // settledLocally가 없다고 판단해 **같은 시간을 다시 적립한다**(이중 기록을 롤백
          // 호환용으로 유지하는 동안의 대가). 소유자가 같을 때만 건드린다.
          await syncLegacySettledMarker(userId);
          const todaySeconds = settlement.localTodayShare(todayStr());
          if (todaySeconds > 0) {
            addFocusSeconds(todaySeconds);
            addFocusToSubject(v1.subjectId, todaySeconds);
          }
        }
        const focusTagId = await ensureFocusTagId(v1.subjectName, userId);
        const result = await uploadFocusBlock({
          sessionId: v1.serverSessionId ?? null,
          body: {
            focusTagId,
            subject: v1.subjectName,
            startedAt: settlement.startedAt,
            endedAt: settlement.endedAt,
            distractionCount: settlement.distractionCount,
            totalDistractionSeconds: settlement.totalDistractionSeconds,
            focusSecondsByDate: settlement.focusSecondsByDate,
          },
          userId,
          onMarkerStillOpen: (id) => {
            cancelMarker(id, v1.userId ?? null).catch(() => {});
          },
        });
        if (result.status === 'failed') return; // 레코드 보존 — 다음 부팅 재시도(legacy와 동일)
        if (result.status === 'saved') refreshCoins();
        // 그 사이 새 세션이 v1을 덮어썼을 수 있으니 같은 값일 때만 지운다(legacy와 동일 규칙).
        const curV1 = await AsyncStorage.getItem(STORAGE_KEYS.focusSessionV1);
        if (curV1 === storedV1) {
          removePersistedSessionV1();
          await AsyncStorage.removeItem(STORAGE_KEYS.focusLiveSession);
        }
        return;
      }
      // ── legacy 폴백 — 구버전 번들이 남긴 레코드(방해초는 종전 역산 유지) ─────────────
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
      // 코인은 여기서 세지 않는다(GROMO-1049) — 지급도 잔액도 서버가 정본이라, 업로드가 끝난 뒤
      // 서버 잔액을 다시 받는다.
      let stored = raw;
      if (!rec.settledLocally) {
        rec = { ...rec, settledLocally: true };
        stored = JSON.stringify(rec);
        await AsyncStorage.setItem(STORAGE_KEYS.focusLiveSession, stored);
        // '오늘 집중'과 과목 누적은 둘 다 '오늘' 기준 → 이 세션의 집중초 중 오늘 몫만 반영한다
        // (GROMO-1252 — 종전엔 updatedAt 하루만 보고 elapsed 전체를 오늘에 꽂아, 자정을 걸친
        // 세션의 어제 몫까지 오늘로 들어왔다). 근거는 레코드가 남긴 날짜별 집중초 —
        // 세션 화면과 같은 규칙(집중 tick의 날짜)이다(blockToday.ts 주석 참고).
        // 구간 [startedAt, updatedAt] 겹침 폴백은 필드가 없는 구버전 레코드 전용 — 일시정지가
        // 자정을 걸친 블록은 그 경로에서 여전히 과다 계상될 수 있다(어제 몫이 오늘로).
        // 날짜 축은 로컬 자정(FocusContext/SubjectContext와 동일).
        const todaySeconds = Math.min(
          focused,
          rec.focusDays?.local != null
            ? (rec.focusDays.local[todayStr()] ?? 0)
            : todayOverlapSeconds(rec.startedAt, rec.updatedAt),
        );
        if (todaySeconds > 0) {
          addFocusSeconds(todaySeconds);
          addFocusToSubject(rec.subjectId, todaySeconds);
        }
      }
      // 과목 태그 해석 — 종전엔 focusTagId를 null로 하드코딩해 고아 정산이 과목 귀속을 통째로
      // 날렸다(by-category 통계에 '미분류'로 들어감). 세션 정산과 같은 규칙으로 이름→서버 태그를
      // 매칭/생성한다. 실패하면 종전대로 null(미분류) — ensureFocusTagId가 내부에서 삼킨다.
      const focusTagId = await ensureFocusTagId(rec.subjectName, userId);
      // 방해초(GROMO-1214 코드리뷰) — 세션 화면은 일시정지를 직접 세지만 라이브 레코드엔 그 값이
      // 없다. 대신 구간 벽시계에서 집중초를 빼 역산한다: elapsed는 집중 tick에서만 오르므로
      // (updatedAt − startedAt) − elapsed = 이 구간의 '집중하지 않은' 초(대부분 일시정지)다.
      // 0을 보내면 그 시간이 통째로 집중으로 지급·집계된다. 서버 검증 상한(24h)으로 자른다.
      const spanSeconds = Math.round(
        (Date.parse(rec.updatedAt) - Date.parse(rec.startedAt)) / 1000,
      );
      const totalDistractionSeconds = Number.isFinite(spanSeconds)
        ? Math.min(24 * 3600, Math.max(0, spanSeconds - focused))
        : 0;
      const body = {
        focusTagId,
        subject: rec.subjectName,
        startedAt: rec.startedAt,
        endedAt: rec.updatedAt,
        distractionCount: 0,
        totalDistractionSeconds,
        // 날짜별 집중초(GROMO-1252 ①) — 레코드에 있으면 서버 벽시계 분할 대신 이 분포로 귀속된다.
        // 축은 서버 존(프로필 timeZone) — 로컬 축을 보내면 기기 존 ≠ 서버 존일 때 몫이 조용히
        // 버려진다(②). 구버전 레코드(필드 없음)는 미전송 → 서버가 종전대로 벽시계로 쪼갠다.
        // 이 분포는 집중 tick만 센 net 이라 서버가 방해초를 또 빼지 않는다(GROMO-1214).
        focusSecondsByDate: rec.focusDays?.server,
      };
      // 강제종료 시 열린 채 남은 라이브 마커가 있으면 그 마커를 PATCH로 종료해 시간·코인을
      // 귀속시킨다(GROMO-1214). 마커가 없거나(구버전 레코드·오프라인 시작) 종료 시각이 서버
      // 클램프 창 밖이면(대부분의 재실행) 종전 POST 경로로 폴백한다 — uploadFocusBlock이 판단.
      // 실패 시 대기열(GROMO-614)로 인계해 앱 시작·포그라운드 복귀마다 재시도하고, 대기열 저장
      // 까지 실패하면 레코드를 보존해 다음 실행에서 이 경로가 재시도한다.
      const result = await uploadFocusBlock({
        sessionId: rec.serverSessionId ?? null,
        body,
        userId,
        // PATCH가 마커를 못 닫은 채 실패하면 취소를 영속화한다(GROMO-1214 코드리뷰 3차 ④) —
        // 종전엔 이 콜백이 없어 POST만 큐에 넣고 라이브 레코드를 지웠다. 재시도 전에 계정이 바뀌면
        // flushPendingFocusUploads가 옛 계정 업로드를 폐기해 업로드도 취소도 남지 않고,
        // 친구 화면에 서버 스윕(12h)까지 '집중 중'으로 보인다. 세션 화면과 같은 규칙.
        // 계정 스코프는 이 레코드의 소유자(위에서 현재 계정과 일치를 확인했다).
        onMarkerStillOpen: (id) => {
          cancelMarker(id, rec.userId ?? null).catch(() => {});
        },
      });
      if (result.status === 'failed') return;
      // 지급이 확정됐으니 서버 잔액을 다시 받는다(GROMO-1049).
      if (result.status === 'saved') refreshCoins();
      // 업로드 성공(또는 대기열 인계) 후 제거 — 그 사이 새 세션이 레코드를 덮어썼을 수
      // 있으니 같은 값일 때만 지운다.
      const cur = await AsyncStorage.getItem(STORAGE_KEYS.focusLiveSession);
      if (cur === stored) {
        await AsyncStorage.removeItem(STORAGE_KEYS.focusLiveSession);
      }
    })().catch(() => {});
  }, [userId, focusReady, subjectsReady, addFocusSeconds, refreshCoins, addFocusToSubject]);

  return null;
}
