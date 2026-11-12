"""EfficientDet-Lite0 float16 원본에서 집중 판정용 출력 요약 모델을 만든다(GROMO-2879).

사전학습 가중치는 그대로 두고 그래프 앞뒤에 연산만 붙인다.
- 앞: uint8 RGB 입력을 받아 (x - 127.5) / 127.5 로 정규화해 원본 float 입력에 넣는다.
- 뒤: 원본 90클래스 확률 [1,N,90] 에서 laptop=72, keyboard=75, book=83 을 골라 앵커별 최대 확률 [1,3] 을 내고,
      원본 확률 전체가 0~1 범위인지 [1] bool 로 함께 낸다.

사용: uv run --python 3.12 --with tensorflow==2.21.0 --with flatbuffers==25.12.19 --with numpy==2.5.4 \
        python scripts/build-study-object-model.py <efficientdet_lite0 float16 원본> <출력 경로>
위 버전으로 만들면 번들 파일과 SHA-256 이 같다(3da388c1…). 다른 버전은 바이트가 달라질 수 있다.
원본: https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/float16/1/efficientdet_lite0.tflite
"""
import hashlib
import sys
from pathlib import Path

import flatbuffers
import numpy as np
import tensorflow as tf
from tensorflow.lite.python import schema_py_generated as s

STUDY_CLASSES = [72, 75, 83]  # 내장 COCO labels.txt 0 기반: laptop, keyboard, book


def build(source: Path, dest: Path) -> None:
    model = s.ModelT.InitFromObj(s.Model.GetRootAsModel(source.read_bytes(), 0))
    g = model.subgraphs[0]

    def tensor(name, shape, dtype, data=None):
        t = s.TensorT()
        t.name = name.encode()
        t.shape = np.array(shape, dtype=np.int32)
        t.type = dtype
        t.buffer = 0
        if data is not None:
            b = s.BufferT()
            b.data = np.frombuffer(data, dtype=np.uint8)
            t.buffer = len(model.buffers)
            model.buffers.append(b)
        g.tensors.append(t)
        return len(g.tensors) - 1

    def op(code, ins, outs, options=None, options_type=0):
        found = [i for i, c in enumerate(model.operatorCodes) if c.builtinCode == code]
        if found:
            index = found[0]
        else:
            c = s.OperatorCodeT()
            c.builtinCode = code
            c.deprecatedBuiltinCode = min(code, 127)
            c.version = 1
            index = len(model.operatorCodes)
            model.operatorCodes.append(c)
        o = s.OperatorT()
        o.opcodeIndex = index
        o.inputs = np.array(ins, dtype=np.int32)
        o.outputs = np.array(outs, dtype=np.int32)
        o.builtinOptionsType = options_type
        o.builtinOptions = options
        return o

    F, I, B = s.TensorType.FLOAT32, s.TensorType.INT32, s.TensorType.BOOL
    original_buffers = [bytes(b.data.tobytes()) if b.data is not None else b'' for b in model.buffers]

    # 다른 원본을 넣어 조용히 틀린 모델이 나오지 않게 입력·출력 형식부터 확인한다.
    assert len(g.inputs) == 1, 'input count'
    old = int(g.inputs[0])
    shape = list(g.tensors[old].shape)
    assert g.tensors[old].type == F and shape == [1, 320, 320, 3], ('input', g.tensors[old].type, shape)
    class_outputs = [int(i) for i in g.outputs if list(g.tensors[int(i)].shape)[-1] == 90]
    assert len(class_outputs) == 1, 'exactly one 90-class probability output'

    # uint8 입력 → float 정규화 → 원본 입력
    new = tensor('input_rgb_uint8', shape, s.TensorType.UINT8)
    cast = tensor('input_float', shape, F)
    center = tensor('input_centered', shape, F)
    half = tensor('normalization_127_5', [], F, np.array(127.5, np.float32).tobytes())
    cast_options = s.CastOptionsT()
    cast_options.inDataType = s.TensorType.UINT8
    cast_options.outDataType = F
    g.operators = [
        op(s.BuiltinOperator.CAST, [new], [cast], cast_options, s.BuiltinOptions.CastOptions),
        op(s.BuiltinOperator.SUB, [cast, half], [center], s.SubOptionsT(), s.BuiltinOptions.SubOptions),
        op(s.BuiltinOperator.DIV, [center, half], [old], s.DivOptionsT(), s.BuiltinOptions.DivOptions),
    ] + g.operators
    g.inputs = np.array([new], np.int32)

    # 90클래스 확률 → 대상 3클래스 앵커별 최대 확률
    raw = next(int(i) for i in g.outputs if list(g.tensors[int(i)].shape)[-1] == 90)
    anchors = int(g.tensors[raw].shape[1])
    indexes = tensor('study_class_indices', [3], I, np.array(STUDY_CLASSES, np.int32).tobytes())
    selected = tensor('study_class_scores', [1, anchors, 3], F)
    gather = s.GatherOptionsT()
    gather.axis = 2
    gather.batchDims = 0
    g.operators.append(op(s.BuiltinOperator.GATHER, [raw, indexes], [selected], gather, s.BuiltinOptions.GatherOptions))
    axis = tensor('anchor_axis', [1], I, np.array([1], np.int32).tobytes())
    scores = tensor('study_scores_laptop_keyboard_book', [1, 3], F)
    reduce_max = s.ReducerOptionsT()
    reduce_max.keepDims = False
    g.operators.append(op(s.BuiltinOperator.REDUCE_MAX, [selected, axis], [scores], reduce_max, s.BuiltinOptions.ReducerOptions))

    # 원본 확률 전체가 0~1 인지(NaN·무한대 포함 거부)
    zero = tensor('zero', [], F, np.array(0, np.float32).tobytes())
    one = tensor('one', [], F, np.array(1, np.float32).tobytes())
    full = [1, anchors, 90]
    ge = tensor('scores_ge_zero', full, B)
    le = tensor('scores_le_one', full, B)
    valid = tensor('scores_valid', full, B)
    g.operators.extend([
        op(s.BuiltinOperator.GREATER_EQUAL, [raw, zero], [ge]),
        op(s.BuiltinOperator.LESS_EQUAL, [raw, one], [le]),
        op(s.BuiltinOperator.LOGICAL_AND, [ge, le], [valid]),
    ])
    axes = tensor('all_score_axes', [2], I, np.array([1, 2], np.int32).tobytes())
    ok = tensor('all_scores_valid', [1], B)
    reduce_all = s.ReducerOptionsT()
    reduce_all.keepDims = False
    g.operators.append(op(s.BuiltinOperator.REDUCE_ALL, [valid, axes], [ok], reduce_all, s.BuiltinOptions.ReducerOptions))
    g.outputs = np.array([scores, ok], np.int32)

    model.signatureDefs = []
    model.metadata = [m for m in model.metadata if m.name != b'TFLITE_METADATA']
    model.description = b'Cattus experimental derived model: original weights, RGB normalization and study-score reduction with full validity check.'
    builder = flatbuffers.Builder(0)
    builder.Finish(model.Pack(builder), file_identifier=b'TFL3')
    dest.write_bytes(builder.Output())

    # 가중치 불변: 원본 버퍼는 순서·바이트 그대로 남고 새 상수만 뒤에 붙었다.
    rebuilt = s.ModelT.InitFromObj(s.Model.GetRootAsModel(dest.read_bytes(), 0))
    for i, data in enumerate(original_buffers):
        b = rebuilt.buffers[i].data
        assert (bytes(b.tobytes()) if b is not None else b'') == data, f'buffer {i} changed'

    # 같은 입력에서 원본의 클래스별 최대 확률과 요약 모델 출력이 같은지 확인한다.
    rng = np.random.default_rng(0)
    src = tf.lite.Interpreter(model_path=str(source))
    out = tf.lite.Interpreter(model_path=str(dest))
    src.allocate_tensors()
    out.allocate_tensors()
    raw_index = next(d['index'] for d in src.get_output_details() if d['shape'][-1] == 90)
    for _ in range(4):
        pixels = rng.integers(0, 256, size=(1, 320, 320, 3), dtype=np.uint8)
        src.set_tensor(src.get_input_details()[0]['index'], ((pixels.astype(np.float32) - 127.5) / 127.5))
        src.invoke()
        expected = src.get_tensor(raw_index)[0][:, STUDY_CLASSES].max(axis=0)
        out.set_tensor(out.get_input_details()[0]['index'], pixels)
        out.invoke()
        details = out.get_output_details()
        assert np.allclose(out.get_tensor(details[0]['index'])[0], expected, atol=1e-6), 'score parity'
        assert bool(out.get_tensor(details[1]['index'])[0]), 'validity'
    print(dest, hashlib.sha256(dest.read_bytes()).hexdigest())


if __name__ == '__main__':
    build(Path(sys.argv[1]), Path(sys.argv[2]))
