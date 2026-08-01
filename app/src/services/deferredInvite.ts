// 설치 후 초대 복원(deferred deep link) — 계약 정본은 초대 링크 스펙 §4-2 ③·§7-5.
//
// 무슨 문제를 푸나: 앱이 없는 사람이 초대 링크를 누르면 랜딩(웹)만 뜨고, 스토어를 거쳐 설치한
// 순간 "어느 그룹에 초대받았는지"가 사라진다. iOS엔 이 구간을 이어 주는 공식 채널이 없어
// (AdAttributionKit은 광고 집계 전용 — 스펙 §2-4) 서버가 클릭 기록과 첫 실행을
// **IP해시 + OS + 3시간 창**으로 맞춰 준다. 첫 실행 때 그 결과를 물어 오는 게 이 파일이다.
//
// 반드시 지켜야 하는 성질:
//  · 확률적 매칭이므로 **자동 가입은 절대 하지 않는다**(스펙 D3). 결과는 기존 초대 시트 체인에
//    태워 사용자가 직접 확인하게 한다 — 오매칭의 피해가 "엉뚱한 초대장이 한 번 보임"에서 끝난다.
//  · 앱 진입을 절대 막지 않는다(fire-and-forget). 호출부는 await 하지 않는다.
//  · 무인증 엔드포인트라 로그인 전에도 나가야 해 axios 인스턴스(JWT·401 리프레시)를 못 쓴다 —
//    여기만 bare axios 예외다(app/.claude/CLAUDE.md 'Pre-login … bare axios').
import axios from 'axios';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_URL } from '@/services/api';
import { claimInviteLink } from '@/services/inviteLinkApi';
import { getAppInstanceId, getDeviceId } from '@/services/analytics';
import { notifyGroupInvite, peekPendingInvite } from '@/navigation/navigationRef';
import { STORAGE_KEYS } from '@/types/storage';

// 매치 요청은 앱 진입 경로에 붙는다 — 서버가 느려도 첫 화면이 기다리지 않도록 짧게 끊는다.
// (실패는 플래그를 남기지 않아 다음 실행에서 자동 재시도된다.)
const MATCH_TIMEOUT_MS = 5000;

// 복원한 초대의 로컬 보관본. claim(§4-2 ④)은 로그인 직후 1회만 하면 되므로 여부를 함께 들고 있는다.
export interface InviteAttribution {
  slug: string;
  groupId: string;
  claimed: boolean;
}

// 서버 응답(§4-2 ③). matched=false면 나머지 필드가 없다.
interface InviteMatchResponse {
  matched: boolean;
  slug?: string;
  groupId?: string;
}

// 같은 실행에서 중복 호출 방지(App.tsx 재마운트·핫리로드). AsyncStorage 플래그는 비동기라
// 두 호출이 겹치면 둘 다 '아직 없음'을 보고 요청을 두 번 보낸다 — 인메모리 프라미스로 합친다.
let inFlight: Promise<void> | null = null;

// RN Platform → 서버 os 값('ios' | 'android' | 'other', 스펙 §5 컬럼).
// 하드코딩하지 않는 이유: 랜딩 클릭은 User-Agent로 os를 판정하므로, 앱이 실제와 다른 값을 보내면
// 일치 조건이 조용히 깨진다. (Android는 이번 범위 밖이지만 값이 틀리는 것보다 낫다.)
function currentOs(): string {
  if (Platform.OS === 'ios') return 'ios';
  if (Platform.OS === 'android') return 'android';
  return 'other';
}

// 조회 완료 표시 — **서버 응답을 실제로 받았을 때만** 세운다(matched 여부 무관).
// 네트워크 실패에 세우면 설치 직후 단 한 번뿐인 기회를 날린다.
async function markChecked(): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEYS.deferredInviteChecked, '1');
  } catch {
    // 저장 실패는 무시 — 다음 실행에서 한 번 더 물어볼 뿐이고, 서버가 클릭을 이미 소진해 무해하다.
  }
}

async function isChecked(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(STORAGE_KEYS.deferredInviteChecked)) !== null;
  } catch {
    // 읽기 실패는 '아직 안 함'으로 본다 — 한 번 더 묻는 쪽이 초대를 잃는 쪽보다 낫다.
    return false;
  }
}

// 앱 시작 시 1회 호출(App.tsx). 실패해도 조용히 끝난다.
export async function runDeferredInviteMatchOnce(): Promise<void> {
  if (!inFlight) {
    inFlight = matchOnce().finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
}

async function matchOnce(): Promise<void> {
  if (await isChecked()) return;

  // 직접 링크가 이미 이겼다(Universal Link·스킴) — 확실한 초대를 확률적 매치로 덮지 않는다.
  // 플래그는 세운다: 이 기기의 초대 맥락은 이미 확보됐고, 다음 실행에서 또 물을 이유가 없다.
  if (peekPendingInvite()) {
    await markChecked();
    return;
  }

  let data: InviteMatchResponse;
  try {
    const deviceId = await getDeviceId();
    const appInstanceId = await getAppInstanceId();
    const res = await axios.post<InviteMatchResponse>(
      `${API_URL}/l/match`,
      { os: currentOs(), deviceId, appInstanceId },
      { timeout: MATCH_TIMEOUT_MS },
    );
    data = res.data;
  } catch {
    // 네트워크·서버 오류 — 플래그를 남기지 않아 다음 실행에서 자동 재시도된다(3시간 창 안이면 유효).
    return;
  }

  await markChecked();

  // 서버가 matched=true인데 식별자를 빠뜨리면 시트를 열 수 없다 — 초대로 취급하지 않는다.
  if (!data?.matched || !data.slug || !data.groupId) return;

  const attribution: InviteAttribution = {
    slug: data.slug,
    groupId: data.groupId,
    claimed: false,
  };
  try {
    await AsyncStorage.setItem(STORAGE_KEYS.inviteAttribution, JSON.stringify(attribution));
  } catch {
    // 보관 실패는 claim(어트리뷰션 연결)만 못 하게 할 뿐 — 초대 시트는 그대로 띄운다.
  }

  // 여기부터는 링크로 들어온 초대와 **완전히 같은 체인**이다(버퍼 → GroupScreen → 초대 시트).
  // entry='deferred'가 6b 이벤트와 join_method(deferred_invite)를 가른다.
  notifyGroupInvite({ groupId: attribution.groupId, slug: attribution.slug, entry: 'deferred' });
}

// 로그인 직후 claim 배선(services/auth.ts)이 읽는다. 깨진 값은 null로 흘린다.
export async function getStoredInviteAttribution(): Promise<InviteAttribution | null> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEYS.inviteAttribution);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<InviteAttribution>;
    if (!parsed?.slug || !parsed.groupId) return null;
    return { slug: parsed.slug, groupId: parsed.groupId, claimed: parsed.claimed === true };
  } catch {
    return null;
  }
}

// 로그인/가입 직후 1회 — 복원한 초대 slug를 우리 user_id에 붙인다(스펙 §2-3 ③·§4-2 ④).
// 배선 지점은 services/auth.ts 의 postAuthSave 한 곳뿐이다(소셜 5종·게스트·게스트→소셜 승격이
// 전부 그 함수로 합류하는 토큰 저장 완료 시점).
//
// 그룹 참여 **전**에 붙이는 이유: 결정론 결합이 가능한 가장 이른 시점이라, 가입만 하고 그룹엔
// 안 들어간 유저도 초대자와 이어진다(추후 초대 보상의 기반 — 보상 트리거는 이번 범위 밖).
// 실패는 전부 삼킨다 — 어트리뷰션은 부가 정보이고, 로그인 흐름을 절대 막지 않는다.
// claimed 를 세우지 않으므로 다음 로그인에서 자동 재시도된다(서버도 멱등).
export async function claimStoredInviteAttribution(): Promise<void> {
  try {
    const attribution = await getStoredInviteAttribution();
    if (!attribution || attribution.claimed) return;
    await claimInviteLink(attribution.slug);
    await markInviteAttributionClaimed();
  } catch {
    // 네트워크 실패·404(SLUG_NOT_FOUND) 모두 무시.
  }
}

// claim 성공 표시 — 계정을 갈아타도 재호출하지 않게 로컬에 굳힌다(서버도 멱등, 이중 방어).
export async function markInviteAttributionClaimed(): Promise<void> {
  const current = await getStoredInviteAttribution();
  if (!current) return;
  try {
    await AsyncStorage.setItem(
      STORAGE_KEYS.inviteAttribution,
      JSON.stringify({ ...current, claimed: true }),
    );
  } catch {
    // 저장 실패는 무시 — 다음 로그인에서 claim이 한 번 더 나갈 뿐이고 서버가 no-op으로 받는다.
  }
}
