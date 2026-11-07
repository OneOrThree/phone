import AsyncStorage from '@react-native-async-storage/async-storage';
import { captureAirbridgeEvent } from '@/services/airbridge';
import { getSession, sessionGeneration } from '@/services/api/session';

// 동시 응답도 저장·발행을 순서대로 처리한다. 서버의 최초 판정이 있는 호출만 들어온다.
let pending: Promise<void> = Promise.resolve();
export function captureFirstArrivalConversion(owner: string, generation: number): Promise<void> {
  const task = pending
    .then(async () => {
      const environment = process.env.EXPO_PUBLIC_ENV?.trim().toLowerCase();
      if (__DEV__ || (environment !== 'prod' && environment !== 'production')) return;
      const key = `catus:first-arrival-conversion:v1:${encodeURIComponent(owner)}`;
      if (await AsyncStorage.getItem(key)) return;
      if (generation !== sessionGeneration() || owner !== getSession()?.userId) return;
      if (captureAirbridgeEvent('first_island_arrival')) await AsyncStorage.setItem(key, '1');
    })
    .catch(() => {
      // 저장소·SDK 실패로 이미 성공한 도착을 실패로 바꾸지 않는다.
    });
  pending = task;
  return task;
}
