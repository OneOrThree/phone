import { HAND_SCORE } from './palmScore';
import { OBJECT_SCORE, type StudyObjectScores } from './studyObjects';
import { MEASUREMENT_BATCH_SIZE } from './cadence';

export type VerificationDetection =
  'checking' | 'focused' | 'missingHand' | 'missingObject' | 'unavailable';

/** 같은 프레임의 손과 공부 도구가 함께 확인된 장수로 판정한다. 오류는 미검출과 구분한다. */
export function focusDetection(
  hands: readonly number[] | null,
  objects: readonly (StudyObjectScores | null)[],
): VerificationDetection {
  if (!hands) return 'unavailable';
  if (hands.length < MEASUREMENT_BATCH_SIZE) return 'checking';
  if (hands.length !== MEASUREMENT_BATCH_SIZE || objects.length !== hands.length)
    return 'unavailable';
  let passed = 0;
  let handsSeen = 0;
  let unknown = 0;
  for (let i = 0; i < hands.length; i++) {
    const hand = hands[i]!;
    if (!Number.isFinite(hand) || hand < 0 || hand > 1) {
      unknown++;
      continue;
    }
    if (hand < HAND_SCORE) continue;
    handsSeen++;
    const object = objects[i];
    if (!object) {
      unknown++;
      continue;
    }
    if ([object.book, object.laptop, object.keyboard].some((v) => v >= OBJECT_SCORE && v <= 1))
      passed++;
  }
  if (passed >= 2) return 'focused';
  if (passed + unknown >= 2) return 'unavailable';
  // 둘 다 부족하면 손 안내 하나만 먼저 보여 준다.
  return handsSeen < 2 ? 'missingHand' : 'missingObject';
}
