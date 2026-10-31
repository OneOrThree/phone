# 집중 인증 모델

모델은 앱 자산으로 번들하며 사용자 프레임을 외부 서비스에 보내지 않는다. 공통 라이선스는 `LICENSE`(Apache 2.0)다.

- `palm_detection_lite.tflite`: MediaPipe Palm Detection Lite. 192×192 float32 RGB, 손 존재 판정용.
- `efficientdet_lite0_int8.tflite`: [Google MediaPipe EfficientDet-Lite0 int8 v1](https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/int8/1/efficientdet_lite0.tflite). 2026-10-31 다운로드, SHA-256 `0720bf247bd76e6594ea28fa9c6f7c5242be774818997dbbeffc4da460c723bb`.

물체 모델의 입력은 `[1,320,320,3]` **uint8 RGB**다. 내부 양자화 scale=0.0078125, zero_point=127은 모델에 포함돼 있으므로 앱은 RGB 바이트를 그대로 넣는다. 출력은 이미 sigmoid를 적용한 float32 확률 `[1,19206,90]`과 디코드 전 박스 `[1,19206,4]`이며, 검출 후처리의 4개 텐서 형식이 아니다. 확률에 sigmoid를 다시 적용하지 않는다.

내장 `labels.txt`의 0 기반 인덱스는 laptop=72, keyboard=75, book=83이다. 빈 COCO 라벨을 빼거나 80개 연속 인덱스로 재번호를 매기지 않는다. 존재 확인용으로 해당 클래스의 앵커별 최대 확률만 사용하며 위치·손과의 관계·필기/타이핑 행동은 판정하지 않는다.

집중 판정은 **같은 프레임에서 손 점수 ≥0.5 AND (책·노트북·키보드 중 하나의 점수 ≥0.5)**를 만족하는 장수가 같은 3장 중 2장 이상인지 확인한다. 손만 또는 물체만 있으면 통과하지 않는다. 각 모델을 별도로 다수결한 뒤 결합하지 않는다. 물체별 감지 문구는 별도로 2/3장 기준을 쓴다.

모델/리사이저 오류나 물체 추론 실패는 해당 프레임의 물체 결과를 `null`로 남긴다. 확인된 성공이 2장이면 통과하고, 오류 때문에 성공 여부가 정해지지 않으면 `unavailable`로 인증 누적을 중단한다. 손만으로 성공시키는 대체 처리는 없다. 촬영 주기·버퍼 해제·기기 내 처리 정책은 유지한다. 이 조합은 사용자가 선택한 규칙이며 실제 공부 행동이나 정확도 개선이 검증됐다는 의미가 아니다.

[공식 모델 안내](https://developers.google.com/edge/mediapipe/solutions/vision/object_detector). 파일 크기와 실행 중 메모리 사용량은 다르며 폰에서 성능/전력을 별도로 측정해야 한다.

시작 전 실패 안내는 손 우선이다. 손이 2장 미만에서 보이면 `missingHand`(「손이 보이지 않아요.」), 손은 2장 이상 확인됐지만 결합 성공이 부족하면 `missingObject`(「노트북/책이 보이지 않아요.」)를 하나만 표시한다. 추론 오류 `unavailable`과는 구분한다.
