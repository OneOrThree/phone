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
import { notifyShieldInterrupted } from './shieldInterruptedNotification';

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
      // 여기까지 왔다 = 내 계정의 실제 세션이 정산도 못 하고 죽었다.
      // 안드로이드에서는 그 순간부터 **차단도 함께 풀려 있었다** — 사용자는 잠긴 줄 알고
      // 집중을 시작했으므로 사실을 알린다.
      //
      // ⚠️ **세션을 자동 재개하지 않는다.** 죽은 뒤 얼마나 지났는지 알 수 없고, 사용자가
      //    의도적으로 껐을 수도 있다. 세션 없이 실드만 되살리면 아무 세션도 없는 상태에서
      //    남의 앱을 덮게 된다(FocusShieldService가 START_NOT_STICKY인 것과 같은 이유).
      //
      // ⚠️ 단, **레코드가 남아 있다 ≠ 강제 종료다**(코드리뷰 반영). 세션 화면을 시스템 Back 으로
      //    정상적으로 빠져나가는 경로도 레코드를 일부러 남긴다(시간 적립을 여기에 맡긴다).
      //    그 경우 실드는 화면을 떠날 때 정상 해제됐으므로 "차단도 함께 풀렸어요"는 거짓이다.
      //    화면이 실드를 직접 내렸으면 표식을 남기므로, 표식이 없을 때만 알린다 — 프로세스가
      //    실제로 죽었다면 표식을 남길 기회 자체가 없다.
      //
      // await 하지 않는 이유: 알림 발행이 늦어져도 정산을 붙잡아 둘 이유가 없다.
      //
      // ⚠️ 그리고 **실제로 켜졌던 실드만** 알린다(코드리뷰 2차). 권한이 없어 처음부터
      //    startFocusShield()가 false 였던 세션은 풀릴 차단이 없었으므로, 그 알림은
      //    잠긴 적 없는 사람에게 "잠금이 풀렸다"고 말하는 셈이다.
      //
      // ⚠️ **한 번만** 발행한다(코드리뷰 3차). 업로드와 대기열 인계가 모두 실패하면 레코드가
      //    남는데, 표식이 없으면 앱을 다시 켤 때마다 같은 알림이 또 나간다(`ran` 은 이 컴포넌트
      //    수명에서만 막는다 — 프로세스가 죽으면 초기화된다). 저장 장애가 이어지는 동안
      //    이미 확인한 알림이 매 실행마다 되살아난다.
      // ⚠️ stored 를 함께 갱신한다. 아래에서 '그 사이 새 세션이 덮어썼는지'를 이 문자열과
      //    비교해 판단하는데, 여기서 쓴 내용을 반영하지 않으면 **영영 같지 않아 레코드가
      //    안 지워진다.**
      let stored = raw;
      if (!rec.shieldReleasedCleanly && rec.shieldActive && !rec.shieldInterruptNotified) {
        rec = { ...rec, shieldInterruptNotified: true };
        stored = JSON.stringify(rec);
        await AsyncStorage.setItem(STORAGE_KEYS.focusLiveSession, stored);
        notifyShieldInterrupted().catch(() => {});
      }
      // 로컬 적립은 1회만 — 중복 적립 방지로 적립 전에 먼저 마킹해 되쓴다.
      // 레코드는 업로드/인계가 끝나기 전까지 지우지 않는다(먼저 지우면 실패 시 기록이 영구 유실).
      // 코인은 여기서 세지 않는다(GROMO-1049) — 지급도 잔액도 서버가 정본이라, 업로드가 끝난 뒤
      // 서버 잔액을 다시 받는다.
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
