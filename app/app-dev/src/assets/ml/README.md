# 집중 인증 모델

모델은 앱 자산으로 번들하며 사용자 프레임을 외부 서비스에 보내지 않는다. 공통 라이선스는 `LICENSE`(Apache 2.0)다.

- `palm_detection_full.tflite`: [Google MediaPipe Palm Detection Full](https://storage.googleapis.com/mediapipe-assets/palm_detection_full.tflite). 공식 배포 파일 그대로다. SHA-256 `1b14e9422c6ad006cde6581a46c8b90dd573c07ab7f3934b5589e7cea3f89a54`, 2,339,846바이트. 출처 프로젝트는 [Google MediaPipe](https://github.com/google-ai-edge/mediapipe)이며 Apache 2.0을 적용한다. 입력은 `[1,192,192,3]` float32 RGB를 `0~1`로 정규화한다. 출력은 박스/키포인트 `[1,2016,18]`과 sigmoid 적용 전 손 점수 `[1,2016,1]`이다(Lite와 같은 형식).
- `efficientdet_lite0_float16_study.tflite`: [Google MediaPipe EfficientDet-Lite0 float16 v1](https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/float16/1/efficientdet_lite0.tflite)(SHA-256 `4b59100025bea1235a84c1038879a6cccc9f6c49f5e41144e91e74d99e780993`, 7,254,339바이트)에서 `scripts/build-study-object-model.py`로 만든 출력 요약 모델이다. SHA-256 `3da388c1a89b0d5a9c28bbbcb36f94c850cba84112aef050699b8c2891854c65`, 7,255,056바이트. 사전학습 가중치는 바꾸지 않았다.

물체 모델의 입력은 `[1,320,320,3]` **uint8 RGB**다. 원본 float16 모델의 `(x−127.5)/127.5` 정규화를 그래프 앞에 넣었으므로 앱은 RGB 바이트를 그대로 넣는다. 그래프 끝에서 원본 90클래스 확률 `[1,19206,90]` 중 laptop=72, keyboard=75, book=83(내장 COCO labels.txt의 0 기반 인덱스)만 골라 앵커별 최대 확률 `[1,3]`(노트북·키보드·책 순서)을 내고, 원본 확률 전체가 `0~1` 범위인지를 `[1]` bool로 함께 낸다. 앱은 유효성이 거짓이거나 점수가 범위를 벗어나면 정상 미검출로 바꾸지 않고 오류로 보존한다. 존재 확인용이라 위치·손과의 관계·필기/타이핑 행동은 판정하지 않는다.

모델 선택 근거는 측정용 앱 실험(GROMO-2879)이다. 같은 개발 자료에서 Lite·int8 대비 실제 사진 100장 정확도 78%→86%, 손·책 22장×4방향 88입력의 충족 판정 45→65건, iPhone 15 Release 프레임 처리 평균 190.72→106.03ms였다. 모델·기준 선정에 쓴 자료라 독립 검증 수치가 아니다.

아래 판정·상태·촬영 정책은 후속 분할 PR에서 연결하는 최종 기능 계약이다. 이 기반 의존성 PR만으로 촬영·분석을 시작하지 않는다.

집중 판정은 **같은 프레임에서 손 점수 ≥0.5 AND (책·노트북·키보드 중 하나의 점수 ≥0.4)**를 만족하는 장수가 같은 3장 중 2장 이상인지 확인한다. 손이 안 보이면 다른 방향으로 한 번 더 보고(프레임당 최대 2회), 손이 보인 프레임은 도구를 최대 4방향으로 본다. 주기 검사에서는 3장 묶음의 도구 추론을 합쳐 6회 이내로 나눠 쓴다. 회전 결과는 그 프레임 하나의 점수로만 쓴다. 손만 또는 물체만 있으면 통과하지 않는다. 각 모델을 별도로 다수결한 뒤 결합하지 않는다. 물체별 감지 문구는 별도로 2/3장 기준을 쓴다.

모델/리사이저 오류나 물체 추론 실패는 해당 프레임의 물체 결과를 `null`로 남긴다. 확인된 성공이 2장이면 통과하고, 오류 때문에 성공 여부가 정해지지 않으면 `unavailable`로 인증 누적을 중단한다. 손만으로 성공시키는 대체 처리는 없다. 촬영 주기·버퍼 해제·기기 내 처리 정책은 유지한다. 이 조합은 사용자가 선택한 규칙이며 실제 공부 행동이나 정확도 개선이 검증됐다는 의미가 아니다.

[공식 모델 안내](https://developers.google.com/edge/mediapipe/solutions/vision/object_detector). 파일 크기와 실행 중 메모리 사용량은 다르며 폰에서 성능/전력을 별도로 측정해야 한다.

시작 전 실패 안내는 손 우선이다. 손이 2장 미만에서 보이면 `missingHand`(「손이 보이지 않아요.」), 손은 2장 이상 확인됐지만 결합 성공이 부족하면 `missingObject`(「노트북/책이 보이지 않아요.」)를 하나만 표시한다. 추론 오류 `unavailable`과는 구분한다.

## Android 지원 범위

GPU 프레임 리사이저의 AHardwareBuffer 요구에 맞춰 앱 최소 지원은 Android 8.0(API 26)이다. Android 7(API 24~25) 기기에는 이 변경 이후 앱 업데이트가 제공되지 않는다. `android/gradle.properties`의 `android.minSdkVersion`이 네이티브 빌드 기준이다.
