import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useUser } from './UserContext';
import { STORAGE_KEYS } from '@/types/storage';

// 캐릭터 선택: 기본 정적 에셋 vs 사용자가 만든 누끼(오브젝트 캐릭터).
export type CharacterChoice = 'default' | 'custom';

// 계정별로 저장되는 캐릭터 선택 상태.
interface SavedCharacter {
  choice: CharacterChoice;
  customUri: string | null; // 누끼 이미지 로컬 URI (없으면 null)
  createdAt: number | null; // 누끼 만든 시각(epoch ms) — 없으면 null
}

interface CharacterContextValue {
  choice: CharacterChoice;
  customUri: string | null;
  setChoice: (c: CharacterChoice) => void;
  setCustomUri: (uri: string | null) => void;
  // 파생값 — CharacterImage의 sourceUri prop에 그대로 넘길 형태로 정했다:
  //   choice==='custom'이고 customUri가 있으면 그 URI(string), 아니면 null(=기본 정적 에셋 사용).
  // CharacterImage는 sourceUri가 있으면 그 URI를, 없으면 기존 정적 에셋(variant)을 그린다.
  activeSource: string | null;
}

const CharacterContext = createContext<CharacterContextValue | null>(null);

// 계정별 캐릭터 맵. 로그아웃 시 키를 지우면 이전 계정 Provider가 지운 키에 옛 상태를
// 도로 써넣는 레이스가 있어(CoinContext·EquipmentContext 주석 참고), 지우는 대신 계정별로
// 분리 보관해 계정 간 누출을 막는다.
type CharacterByUser = Record<string, SavedCharacter>;

// userId(JWT sub)를 디코드하지 못한 비정상 세션의 폴백 버킷 — 정상 경로에선 쓰이지 않는다.
const FALLBACK_BUCKET = 'unknown';

// 저장 값이 없을 때의 기본 상태.
const DEFAULT_CHARACTER: SavedCharacter = { choice: 'default', customUri: null, createdAt: null };

// 캐릭터 키에 닿는 모든 쓰기를 직렬화하는 큐 — Provider 저장과 전환 인계가 서로의 쓰기를
// 낡은 스냅샷으로 덮어쓰지 않게, 읽기-수정-쓰기를 한 단위로 순차 실행한다(CoinContext 패턴).
let characterWrites: Promise<void> = Promise.resolve();
function updateCharacterStore(update: (map: CharacterByUser) => CharacterByUser): Promise<void> {
  const run = characterWrites.then(async () => {
    const raw = await AsyncStorage.getItem(STORAGE_KEYS.character);
    const map = raw ? (JSON.parse(raw) as CharacterByUser) : {};
    await AsyncStorage.setItem(STORAGE_KEYS.character, JSON.stringify(update(map)));
  });
  // 큐는 실패해도 이어지도록 내부에서만 삼키고, 호출자에겐 실패를 그대로 전파한다.
  characterWrites = run.catch(() => {});
  return run;
}

// 게스트 → 소셜 전환(계정 연결) 시 게스트 UUID 버킷의 캐릭터 선택을 새 계정으로 인계.
// 새 계정에 이미 선택 상태가 있으면 유지하고 게스트 것은 버린다. 인계를 전환 시점으로
// 한정하는 이유는 CoinContext.transferOwnedItems 주석 참고. 호출처는 App.applyStoredSession —
// 이전·새 userId를 모두 아는 유일한 시점이다.
export function transferCharacter(fromUserId: string, toUserId: string): Promise<void> {
  return updateCharacterStore((map) => {
    const fromSaved = map[fromUserId];
    if (!fromSaved) return map;
    delete map[fromUserId];
    map[toUserId] ??= fromSaved;
    return map;
  });
}

export function CharacterProvider({ children }: { children: ReactNode }) {
  const { userId } = useUser();
  // 게스트도 UUID JWT를 받으므로 userId 버킷만으로 계정이 분리된다(CoinContext와 동일).
  const bucket = userId ?? FALLBACK_BUCKET;
  const [choice, setChoiceState] = useState<CharacterChoice>('default');
  const [customUri, setCustomUriState] = useState<string | null>(null);
  const [createdAt, setCreatedAt] = useState<number | null>(null);
  const loaded = useRef(false);

  // 계정별 맵에서 자기 버킷 로드.
  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEYS.character).then((raw) => {
      const map = raw ? (JSON.parse(raw) as CharacterByUser) : {};
      const saved = map[bucket] ?? DEFAULT_CHARACTER;
      setChoiceState(saved.choice);
      setCustomUriState(saved.customUri);
      setCreatedAt(saved.createdAt);
      loaded.current = true;
    });
  }, [bucket]);

  // 자기 버킷만 갱신해 다른 계정 캐릭터를 건드리지 않는다.
  useEffect(() => {
    if (!loaded.current) return;
    // 저장 실패는 무시 — 다음 상태 변경 때 자연 재시도된다.
    updateCharacterStore((map) => ({
      ...map,
      [bucket]: { choice, customUri, createdAt },
    })).catch(() => {});
  }, [bucket, choice, customUri, createdAt]);

  const setChoice = useCallback((c: CharacterChoice) => {
    setChoiceState(c);
  }, []);

  // 누끼 URI 설정 — 새 누끼가 생기면 createdAt을 지금으로, 지우면 null로 함께 갱신한다.
  const setCustomUri = useCallback((uri: string | null) => {
    setCustomUriState(uri);
    setCreatedAt(uri ? Date.now() : null);
  }, []);

  const activeSource = choice === 'custom' && customUri ? customUri : null;

  return (
    <CharacterContext.Provider value={{ choice, customUri, setChoice, setCustomUri, activeSource }}>
      {children}
    </CharacterContext.Provider>
  );
}

export function useCharacter(): CharacterContextValue {
  const context = useContext(CharacterContext);
  if (!context) throw new Error('useCharacter must be used inside CharacterProvider');
  return context;
}
