import { useEffect, useRef, useState } from 'react';
import { checkNickname } from '@/services/userApi';

// 닉네임 실시간 중복확인(GROMO-1215) — 온보딩 닉네임 스텝·프로필 편집이 공유한다.
// 입력 디바운스 후 GET /users/nickname/check를 부르고, 결과를 4상으로 돌려준다:
//   checking  — 디바운스 대기~응답 전(로딩 표시)
//   available — 서버가 사용 가능 판정
//   taken     — 서버가 사용 불가 판정(중복. 형식 위반도 서버는 false를 주지만,
//               호출부가 로컬 형식검사를 선행해 enabled=false로 거르므로 여기선 중복으로 읽는다)
//   unknown   — 요청 실패·구서버(404 등) → 호출부는 기존 낙관 표시로 폴백한다.
//               검사 응답이 stale해도 저장(POST/PATCH)의 409가 최종 방어라 안전하다.
// idle은 enabled=false(형식 미충족·미변경 등 검사할 이유가 없음)일 때다.
export type NicknameCheckStatus = 'idle' | 'checking' | 'available' | 'taken' | 'unknown';

// 검색 화면들(GroupFindSheet·FriendAddScreen)의 디바운스 관례와 같은 값.
const CHECK_DEBOUNCE_MS = 350;

export function useNicknameCheck(nickname: string, enabled: boolean): NicknameCheckStatus {
  const [status, setStatus] = useState<NicknameCheckStatus>('idle');
  // 요청 세대 번호 — 입력이 바뀌면 즉시 올려, 늦게 도착한 이전 응답이 새 입력의 판정을
  // 덮지 못하게 한다(GroupFindSheet searchSeqRef 패턴).
  const seqRef = useRef(0);

  // 언마운트 시에도 세대를 올려 진행 중 요청의 setState를 막는다.
  useEffect(
    () => () => {
      seqRef.current++;
    },
    [],
  );

  useEffect(() => {
    const seq = ++seqRef.current;
    if (!enabled) {
      setStatus('idle');
      return;
    }
    // 디바운스 대기 중에도 '확인 중'으로 — 이전 입력의 판정이 그대로 남아 보이면 안 된다.
    setStatus('checking');
    const timer = setTimeout(async () => {
      try {
        const { available } = await checkNickname(nickname);
        if (seq !== seqRef.current) return;
        setStatus(available ? 'available' : 'taken');
      } catch {
        if (seq !== seqRef.current) return;
        setStatus('unknown');
      }
    }, CHECK_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [nickname, enabled]);

  return status;
}
