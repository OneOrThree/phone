// 별점 요청(GROMO-2783) — 집중을 세 번째로 끝낸 직후 OS 기본 별점창을 한 번 띄운다.
// requestReview 는 iOS(SKStoreReviewController)·Android(Play In-App Review)로 갈라지고, 실제로 뜰지는 OS 가 정한다
// (iOS 는 1년 3회 상한, 떴는지·별을 줬는지는 앱이 모른다). 우리 쪽은 횟수 판정과 1회 표시만 맡는다.
// 스토어 정책: 별점창 앞에 「앱 좋아요?」 같은 질문을 두지 않고, 별점에 보상을 주지 않는다.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState } from 'react-native';

const KEY = 'catus:store-review:v1';
const REQUIRED_COMPLETIONS = 3;
// 결과 화면이 먼저 보인 뒤 별점창이 뜨게 잠깐 기다린다.
const PROMPT_DELAY_MS = 1500;

type Progress = { completions: number; requested: boolean };

async function read(): Promise<Progress> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const p = raw ? (JSON.parse(raw) as Partial<Progress>) : {};
    return {
      completions: typeof p.completions === 'number' ? p.completions : 0,
      requested: p.requested === true,
    };
  } catch {
    return { completions: 0, requested: false };
  }
}

const save = (p: Progress) => AsyncStorage.setItem(KEY, JSON.stringify(p));

// 네이티브 모듈은 이 패키지를 넣은 스토어 빌드부터 있다. 옛 바이너리에 같은 JS 가 OTA 로 가면 import 가
// 던지므로(requireNativeModule) 부를 때만 늦게 불러 실패를 삼킨다. 이 파일 밖에서 expo-store-review 를 정적
// import 하지 말 것 — 그 순간 옛 바이너리가 앱 시작에서 죽는다(런타임을 같이 쓰므로, app.config.js 참고).
const storeReviewModule = (): typeof import('expo-store-review') => require('expo-store-review');

/** 집중 완료 1회를 센다. 세 번째(이상)이고 아직 묻지 않았으면 별점창을 한 번 띄운다. 실패는 조용히 무시한다. */
export async function countFocusCompletion(): Promise<void> {
  try {
    const progress = await read();
    if (progress.requested) return;
    const completions = progress.completions + 1;
    if (completions >= REQUIRED_COMPLETIONS) {
      const StoreReview = storeReviewModule();
      if (await StoreReview.isAvailableAsync()) {
        await save({ completions, requested: true });
        setTimeout(() => {
          // 그사이 앱이 백그라운드로 가면 iOS 는 요청을 조용히 버린다 — 물었음을 되돌려 다음 완료에서 다시 묻는다.
          if (AppState.currentState !== 'active') {
            save({ completions, requested: false }).catch(() => {});
            return;
          }
          StoreReview.requestReview().catch(() => {});
        }, PROMPT_DELAY_MS);
        return;
      }
    }
    await save({ completions, requested: false });
  } catch {
    // 모듈 없음(옛 바이너리)·저장 실패는 핵심 흐름을 막지 않는다 — 횟수는 다음 완료에서 다시 센다.
  }
}
