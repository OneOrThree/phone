/** 개발 중 번들 모델의 입출력을 확인하는 수동 점검 함수. 제품 노출 조건과는 무관하다. */
import { loadTensorflowModel } from 'react-native-fast-tflite';
import {
  OBJECT_INPUT,
  objectScoreIndex,
  studyObjectScores,
} from '@/services/studyVerification/studyObjects';
import { PALM_INPUT, maxSigmoid, scoreTensorIndex } from '@/services/studyVerification/palmScore';

/** 스파이크 점검용: 번들된 .tflite 가 로드되는지, 텐서 모양이 맞는지 Metro 콘솔에 찍는다. */
export async function probeModel(): Promise<void> {
  const t0 = Date.now();
  try {
    const m = await loadTensorflowModel(require('../../assets/ml/palm_detection_lite.tflite'), []);
    console.log('[verify-spike] model loaded', Date.now() - t0, 'ms', {
      inputs: m.inputs.map((x) => `${x.name} ${x.dataType} [${x.shape.join(',')}]`),
      outputs: m.outputs.map((x) => `${x.name} ${x.dataType} [${x.shape.join(',')}]`),
      scoreIdx: scoreTensorIndex(m.outputs),
    });
    // 검은 프레임 한 장으로 추론 1회 — 지연과 점수 범위 확인(손 없음 → 0.5 미만이어야 함)
    const t1 = Date.now();
    const out = await m.run([new Float32Array(PALM_INPUT * PALM_INPUT * 3).buffer]);
    console.log(
      '[verify-spike] blank frame score',
      maxSigmoid(new Float32Array(out[scoreTensorIndex(m.outputs)]!)).toFixed(3),
      Date.now() - t1,
      'ms',
    );
  } catch (e) {
    console.log('[verify-spike] model load failed', String(e));
  }
  if (!__DEV__) return;
  try {
    const objectModel = await loadTensorflowModel(
      require('../../assets/ml/efficientdet_lite0_int8.tflite'),
      [],
    );
    const index = objectScoreIndex(objectModel.inputs, objectModel.outputs);
    if (index < 0) throw new Error('Unexpected object model tensor layout');
    const started = Date.now();
    const output = await objectModel.run([new Uint8Array(OBJECT_INPUT * OBJECT_INPUT * 3).buffer]);
    console.log(
      '[verify-spike] object model ready',
      JSON.stringify({
        elapsedMs: Date.now() - started,
        blankFrameScores: studyObjectScores(new Float32Array(output[index]!)),
      }),
    );
  } catch (error) {
    console.warn('[verify-spike] object model unavailable', String(error));
  }
}
