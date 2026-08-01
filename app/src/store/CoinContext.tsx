import {
  createContext,
  useCallback,
  useContext,
  useState,
  useEffect,
  useRef,
  type ReactNode,
} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from '@/services/api';
import { useUser } from './UserContext';
import { STORAGE_KEYS } from '@/types/storage';

interface CoinContextValue {
  coins: number;
  // 서버 잔액을 **한 번이라도 받아 왔는가**. false면 coins(0)는 '0코인'이 아니라 '아직 모름'이다 —
  // 넷(진짜 0 · 최초 로드 실패 · refresh 실패 · 응답 전)이 같은 숫자로 뭉개지면 화면이 사용자의
  // 재산에 대해 거짓을 말한다(3차 리뷰 F1). 잔액으로 사용자를 잠그는 화면은 이 값을 먼저 본다.
  coinsLoaded: boolean;
  // 지금 쥔 잔액이 **몇 번째로 받아 온 값인가**(성공한 조회마다 +1). 소비자가 '이 잔액이 내가 아는
  // 어떤 사건보다 나중에 도착한 값인가'를 판정하는 데 쓴다 — 서버가 내린 판정(BetSheet의
  // INSUFFICIENT_CURRENCY 승격)을 풀어도 되는지는 값의 크기가 아니라 **도착 순서**로 갈린다.
  coinsVersion: number;
  // 서버 잔액 재조회. 마운트 1회 로드만으로는 **서버가 깎은 잔액**(그룹 내기 판돈 차감·정산 지급)이
  // 앱에 영영 반영되지 않는다 — 잔액을 보여 주는 화면이 열릴 때 직접 부른다(3차 내기 시트).
  // 실패해도 throw하지 않는다(호출처가 try/catch를 두지 않아도 되게) — 대신 coinsLoaded가 false로 돌아간다.
  // 겹쳐 불러도 **마지막 호출의 결과만** 반영된다(아래 refreshSeqRef).
  refresh: () => Promise<void>;
  addCoins: (amount: number) => Promise<void>;
  isOwned: (itemId: string) => boolean;
  buyItem: (itemId: string, price: number) => Promise<boolean>;
}

const CoinContext = createContext<CoinContextValue | null>(null);

// 계정별 보유 아이템 맵. 아이템 API가 없어 로컬이 유일한 구매 기록이므로, 로그아웃 시
// 지우는 대신 계정별로 분리 보관해 계정 간 누출과 구매 기록 소실을 모두 막는다(GROMO-936 리뷰).
// 구 키(ownedItems)와 형식이 달라 새 키(:v2)를 쓴다 — OTA 롤백 호환(storageMigration v3 참고).
type OwnedItemsByUser = Record<string, string[]>;

// userId(JWT sub)를 디코드하지 못한 비정상 세션의 폴백 버킷 — 정상 경로에선 쓰이지 않는다.
const FALLBACK_BUCKET = 'unknown';

// 보유 아이템 키에 닿는 모든 쓰기를 직렬화하는 큐 — Provider 저장과 전환 인계가 서로의
// 쓰기를 낡은 스냅샷으로 덮어쓰지 않게, 읽기-수정-쓰기를 한 단위로 순차 실행한다(코덱스 리뷰).
let ownedItemsWrites: Promise<void> = Promise.resolve();
function updateOwnedItemsStore(update: (map: OwnedItemsByUser) => OwnedItemsByUser): Promise<void> {
  const run = ownedItemsWrites.then(async () => {
    const raw = await AsyncStorage.getItem(STORAGE_KEYS.ownedItemsV2);
    const map = raw ? (JSON.parse(raw) as OwnedItemsByUser) : {};
    await AsyncStorage.setItem(STORAGE_KEYS.ownedItemsV2, JSON.stringify(update(map)));
  });
  // 큐는 실패해도 이어지도록 내부에서만 삼키고, 호출자에겐 실패를 그대로 전파한다(코덱스 리뷰).
  ownedItemsWrites = run.catch(() => {});
  return run;
}

// 게스트 → 소셜 전환(계정 연결) 시 게스트 UUID 버킷의 구매 기록을 새 계정으로 인계(합집합).
// 고정 'guest' 버킷 대신 전환 시점에만 옮기는 이유: 고정 버킷은 게스트 로그아웃 후에도 남아
// 다음 게스트·무관한 소셜 계정에 누출된다(코덱스 리뷰). 호출처는 App.applyStoredSession —
// 이전·새 userId를 모두 아는 유일한 시점이다.
export function transferOwnedItems(fromUserId: string, toUserId: string): Promise<void> {
  return updateOwnedItemsStore((map) => {
    const fromItems = map[fromUserId];
    if (!fromItems) return map;
    delete map[fromUserId];
    map[toUserId] = Array.from(new Set([...(map[toUserId] ?? []), ...fromItems]));
    return map;
  });
}

export function CoinProvider({ children }: { children: ReactNode }) {
  const { userId } = useUser();
  // 게스트도 UUID JWT를 받으므로(auth.ts guestLogin) userId 버킷만으로 계정이 분리된다.
  const bucket = userId ?? FALLBACK_BUCKET;
  const [coins, setCoins] = useState(0);
  // 초기값이 false인 것이 핵심이다 — 응답 전의 0을 '0코인'으로 읽는 화면이 없어야 한다.
  const [coinsLoaded, setCoinsLoaded] = useState(false);
  const [coinsVersion, setCoinsVersion] = useState(0);
  const [ownedItemIds, setOwnedItemIds] = useState<string[]>([]);
  const loaded = useRef(false);
  // 조회 시퀀스 — refresh는 여러 곳에서 겹쳐 불린다(시트 오픈 + 성공 직후 + 인라인 재시도).
  // 순서를 지키지 않으면 **차감 전 잔액**을 실은 늦은 응답이 차감 후 잔액을 덮어써, 화면이
  // 재산을 과대 표시하고 부족 검사를 잘못 통과시킨다(코덱스 리뷰). 최신 호출의 결과만 반영한다.
  const refreshSeqRef = useRef(0);

  // 서버에서 잔액 로드. 실패해도 던지지 않는다 — 잔액은 화면을 막을 값이 아니고,
  // 다음 refresh(시트 오픈 등)에서 자연 재시도된다. 다만 **조용히 삼키지는 않는다**:
  // coinsLoaded를 false로 되돌려 '지금 쥔 값은 못 믿는다'를 소비자가 알 수 있게 한다(F1).
  const refresh = useCallback(async () => {
    const seq = ++refreshSeqRef.current;
    try {
      const res = await api.get<number>('/api/v1/currency');
      // 뒤이어 시작된 조회가 있으면 이 응답은 이미 낡았다 — 실패 처리도 마찬가지로 건너뛴다.
      if (seq !== refreshSeqRef.current) return;
      setCoins(res.data);
      setCoinsLoaded(true);
      setCoinsVersion((v) => v + 1);
    } catch {
      if (seq !== refreshSeqRef.current) return;
      setCoinsLoaded(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // 보유 아이템은 AsyncStorage 유지 (아이템 API 미구현)
  // 형식 변환은 storageMigration v3가 Provider 마운트 전에 보장하므로 맵으로 바로 읽는다.
  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEYS.ownedItemsV2).then((raw) => {
      const map = raw ? (JSON.parse(raw) as OwnedItemsByUser) : {};
      setOwnedItemIds(map[bucket] ?? []);
      loaded.current = true;
    });
  }, [bucket]);

  useEffect(() => {
    if (!loaded.current) return;
    // 저장 실패는 무시 — 다음 상태 변경 때 자연 재시도된다
    updateOwnedItemsStore((map) => ({ ...map, [bucket]: ownedItemIds })).catch(() => {});
    // 구 키에도 현재 계정 것을 같이 써(듀얼라이트) OTA 롤백된 구 번들에서도 구매가 보이게
    // 하고, 소유자 키를 함께 남겨 롤백 중의 구매를 복귀 후 정확한 버킷으로 병합한다
    // (storageMigration.reconcileLegacyOwnedItems, 코덱스 리뷰).
    AsyncStorage.setItem(STORAGE_KEYS.ownedItems, JSON.stringify(ownedItemIds)).catch(() => {});
    AsyncStorage.setItem(STORAGE_KEYS.ownedItemsLegacyOwner, bucket).catch(() => {});
  }, [bucket, ownedItemIds]);

  async function addCoins(amount: number) {
    setCoins((prev) => prev + amount);
    api.post('/api/v1/currency/earn', { amount, reason: 'SESSION_COMPLETE' }).catch(() => {});
  }

  function isOwned(itemId: string) {
    return ownedItemIds.includes(itemId);
  }

  async function buyItem(itemId: string, price: number) {
    if (coins < price) return false;
    try {
      await api.post('/api/v1/currency/spend', { amount: price, reason: 'PURCHASE' });
      setCoins((prev) => prev - price);
      setOwnedItemIds((prev) => [...prev, itemId]);
      return true;
    } catch {
      return false;
    }
  }

  return (
    <CoinContext.Provider
      value={{ coins, coinsLoaded, coinsVersion, refresh, addCoins, isOwned, buyItem }}
    >
      {children}
    </CoinContext.Provider>
  );
}

export function useCoins(): CoinContextValue {
  const context = useContext(CoinContext);
  if (!context) throw new Error('useCoins must be used inside CoinProvider');
  return context;
}
