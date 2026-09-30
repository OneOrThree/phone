/**
 * 1.x(동결 앱) 로컬 사용자 데이터 정리 — 회원 탈퇴 시 탈퇴한 userId 몫만 지운다.
 *
 * Android 에서는 1.x 와 2.0 이 같은 패키지(com.oneorthree.gromo)라 1.x 가 남긴 AsyncStorage 키와
 * 앱 내부 파일이 업데이트 뒤에도 그대로 남는다. 1.x 는 가구·아이템·캐릭터처럼 서버에 없는 데이터를
 * 계정별 버킷(`{ [userId]: … }`)으로 기기에만 보관했으므로, 서버 계정을 지워도 이 버킷과 누끼
 * 캐릭터 이미지는 사라지지 않는다. iOS 2.0 은 번들이 달라(focuscat) 해당 데이터가 없지만, 없는
 * 키·파일을 지우는 것은 무해하므로 플랫폼을 가리지 않고 실행한다(파일 정리만 웹 제외).
 *
 * 키 모양의 정본은 `app/legacy/app-dev/src/types/storage.ts`, 누끼 파일명의 정본은
 * `app/legacy/app-dev/modules/subject-mask`(Android `filesDir`·iOS Documents 의
 * `customCharacter_{userId 영숫자·-·_}.png`)다. 1.x 는 동결됐으므로 여기 목록도 고정이다.
 *
 * 실패 의미: 삭제·재기록이 하나라도 실패하면 던진다. 호출부는 탈퇴 완료로 넘어가지 않고 재시도를
 * 띄운다(소유자 표식 정리와 같은 규칙). 모든 단계가 멱등이라 재시도는 처음부터 다시 돌면 된다.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';

/** 계정별 맵 `{ [userId]: … }` 형태의 1.x 키. */
export const LEGACY_USER_MAP_KEYS = [
  'gromo:equipment:v2', // 장착 상태
  'gromo:ownedItems:v2', // 보유 아이템(유일한 구매 기록)
  'gromo:character:v1', // 캐릭터 선택 { choice, customUri, createdAt }
  'gromo:groups:cardOrder:v1', // 그룹 카드 순서
  'gromo:groups:cardEmoji:v1', // 그룹 카드 아이콘
] as const;
const CHARACTER_KEY = 'gromo:character:v1';

/**
 * OTA 롤백 호환용 단일 값 듀얼라이트 키. 1.x 는 활성 계정의 보유 아이템·장착 상태를 여기에도 쓰고,
 * 그 계정을 `ownedItems:legacyOwner` 에 남겼다. 소유자가 탈퇴 계정일 때만 지운다.
 */
const LEGACY_OWNER_KEY = 'gromo:ownedItems:legacyOwner';
const LEGACY_OWNER_DUAL_WRITE_KEYS = ['gromo:ownedItems', 'gromo:equipment', LEGACY_OWNER_KEY];

/** 실제 키가 `{prefix}:{userId}:{sessionId}` 인 1회 표시 마커. */
const LEGACY_USER_PREFIXES = ['gromo:sessionResult', 'gromo:groupChallengeSettlement'];

/** 값이 `{ userId, … }` 객체인 스크린타임 상태 키. 소유자가 탈퇴 계정일 때만 지운다. */
const LEGACY_USER_TAGGED_KEYS = [
  'gromo:screentime:syncState',
  'gromo:screentime:measurementStartDate',
  'gromo:screentime:effectiveGoal',
  'gromo:screentime:lastClosedDate',
  'gromo:screentime:windowReports',
];

/** 값이 `['{userId}:{날짜}', …]` 배열인 키. 탈퇴 계정 항목만 걸러 낸다. */
const LEGACY_STREAK_POPPED_KEY = 'gromo:focus:streakPoppedDate';

/** 누끼 캐릭터 파일명 — 1.x 네이티브(`customCharacterFileName`)와 같은 규칙이다. */
const CUSTOM_CHARACTER_FILE = /^customCharacter(_[A-Za-z0-9_-]+)?\.png$/;

export function legacyCustomCharacterFileName(userId: string): string {
  const safe = userId.replace(/[^A-Za-z0-9_-]/g, '');
  return safe ? `customCharacter_${safe}.png` : 'customCharacter.png';
}

/** 앱 문서 디렉터리(Android `filesDir`·iOS Documents)의 파일 삭제. 없으면 아무것도 하지 않는다. */
export interface LegacyDocumentFiles {
  remove(name: string): void | Promise<void>;
}

const documentFiles: LegacyDocumentFiles = {
  remove(name) {
    const file = new File(Paths.document, name);
    if (file.exists) file.delete();
  },
};

type UserMap = Record<string, unknown>;

const parse = (raw: string | null): unknown => {
  if (raw === null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined; // 손상 — 1.x 도 읽지 못하는 값이다.
  }
};

const isMap = (value: unknown): value is UserMap =>
  !!value && typeof value === 'object' && !Array.isArray(value);

/** `customUri`(`file://…/customCharacter_x.png?t=…`)에서 문서 디렉터리 파일명만 꺼낸다. */
function customCharacterFileOf(saved: unknown): string | null {
  if (!isMap(saved) || typeof saved.customUri !== 'string') return null;
  const name = saved.customUri.split('?')[0].split('/').pop() ?? '';
  return CUSTOM_CHARACTER_FILE.test(name) ? name : null;
}

/**
 * 탈퇴한 userId 의 1.x 로컬 데이터(계정별 버킷·마커·누끼 파일)를 지운다. 다른 계정의 버킷은
 * 보존한다. 실패하면 던진다 — 재시도는 같은 호출을 다시 하면 된다.
 */
export async function clearLegacyUserData(
  userId: string,
  files: LegacyDocumentFiles = documentFiles,
): Promise<void> {
  const removeKeys: string[] = [];
  const writes: [string, string][] = [];
  const fileNames = new Set<string>([legacyCustomCharacterFileName(userId)]);
  const stillReferenced = new Set<string>();

  // 1) 계정별 맵 — 탈퇴 계정 버킷만 빼고 다시 쓴다. 비면 키째 지운다. 손상된 맵은 선택 삭제가
  //    불가능하고 1.x 도 읽지 못하므로 키째 지운다(남기면 탈퇴 계정 데이터가 섞여 있을 수 있다).
  const mapValues = await AsyncStorage.multiGet([...LEGACY_USER_MAP_KEYS]);
  for (const [key, raw] of mapValues) {
    const value = parse(raw);
    if (value === null) continue;
    if (!isMap(value)) {
      removeKeys.push(key);
      continue;
    }
    if (key === CHARACTER_KEY) {
      const own = customCharacterFileOf(value[userId]);
      if (own) fileNames.add(own);
      // userId 없이 저장된 공용 폴백 파일(customCharacter.png)은 다른 계정이 참조하면 남긴다.
      Object.entries(value).forEach(([owner, saved]) => {
        const name = owner === userId ? null : customCharacterFileOf(saved);
        if (name) stillReferenced.add(name);
      });
    }
    if (!Object.prototype.hasOwnProperty.call(value, userId)) continue;
    const rest = Object.fromEntries(Object.entries(value).filter(([owner]) => owner !== userId));
    if (Object.keys(rest).length === 0) removeKeys.push(key);
    else writes.push([key, JSON.stringify(rest)]);
  }

  // 2) 롤백 호환 듀얼라이트 — 마지막 활성 1.x 계정이 탈퇴 계정일 때만.
  if ((await AsyncStorage.getItem(LEGACY_OWNER_KEY)) === userId)
    removeKeys.push(...LEGACY_OWNER_DUAL_WRITE_KEYS);

  // 3) `{prefix}:{userId}:…` 마커.
  const allKeys = await AsyncStorage.getAllKeys();
  const prefixes = LEGACY_USER_PREFIXES.map((prefix) => `${prefix}:${userId}:`);
  removeKeys.push(...allKeys.filter((key) => prefixes.some((prefix) => key.startsWith(prefix))));

  // 4) `{ userId, … }` 스크린타임 상태.
  const tagged = await AsyncStorage.multiGet(LEGACY_USER_TAGGED_KEYS);
  for (const [key, raw] of tagged) {
    const value = parse(raw);
    if (isMap(value) && value.userId === userId) removeKeys.push(key);
  }

  // 5) `userId:날짜` 팝 마커 배열.
  const popped = parse(await AsyncStorage.getItem(LEGACY_STREAK_POPPED_KEY));
  if (Array.isArray(popped)) {
    const kept = popped.filter(
      (marker) => !(typeof marker === 'string' && marker.startsWith(`${userId}:`)),
    );
    if (kept.length !== popped.length) {
      if (kept.length) writes.push([LEGACY_STREAK_POPPED_KEY, JSON.stringify(kept)]);
      else removeKeys.push(LEGACY_STREAK_POPPED_KEY);
    }
  }

  // 파일을 먼저 지운다 — 키를 먼저 지운 뒤 파일 삭제가 실패하면, 재시도 때 customUri 로 찾던
  // 파일명(공용 폴백 등)을 다시 알 방법이 없다.
  if (Platform.OS !== 'web') {
    for (const name of fileNames) {
      if (stillReferenced.has(name)) continue;
      await files.remove(name);
      // 1.x 네이티브의 원자적 교체용 임시 파일 — 쓰기 도중 종료되면 남는다.
      await files.remove(`${name}.tmp`);
    }
  }
  if (writes.length) await AsyncStorage.multiSet(writes);
  if (removeKeys.length) await AsyncStorage.multiRemove([...new Set(removeKeys)]);
}
