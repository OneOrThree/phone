# 2026-10-20 이동 동기화 서버 재측정 — 원본

main `6e4857950`(에픽 2335 머지: 이동 단일 소유자 2339 기본 ON·Redis 릴레이, 유한 outbound 실행기·heartbeat 10s, 틱 히스토그램)을 10-09·10-18 과 같은 두 하네스로 다시 잰 원자료다. 해석은 [validation.md §7-2](../../validation.md)에 있다. 값은 손으로 옮기지 않았다 — 표는 스크립트 출력이다.

## 환경(공통)

- 맥 한 대(Apple M5 Pro, 15코어·48 GB)의 Docker Desktop(8 CPU · 7.65 GiB, aarch64). 발생기(Node 24)도 같은 맥.
- `host loadavg`·동시 작업은 각 `*-conditions.txt`·`host-conditions-run*.txt` 에 실었다. **`survey-run1/`(run1)은 다른 세션의 gradle 워커와 구현 에이전트(gradle build·jest·pod install)가 동시에 돌아 지연이 오염됐다 — 전달 누락·수신량·Snapshot 수만 참고하고 지연은 run2 를 본다.**

## ① 조사 하네스(`survey/`) — `loadtest/survey/realtime.mjs --mode movement`

- 스택: `loadtest/infra/local/compose.yml`(프로젝트 `gromo-loadtest-survey`), realtime·data-api·business-api 를 main 소스로 재빌드(10-18 이미지는 `:20261018` 태그 보존), fixture 1만 명 DB 그대로(`users` 10,191·Flyway V130), 사용자 파일 `loadtest/.local/params/users_uniform.json`(JWT 재발급).
- 조합: 10-18 과 같은 10c/50c/100c·1 Hz 20 s, 100c·5/10 Hz 20 s, 10c·20 Hz 10 s(정책 상한), 100c·1 Hz 60 s, 300c·1 Hz 20 s, 300c·1 Hz 60 s 발신 분산, **두 인스턴스 분산** 10c 10 s/60 s·100c 20 s(`ws://localhost:18083,18085`).
- `survey/repeat-300c/`: 300c·1 Hz·20 s 정렬 발신 3회(`ws-movement-300c-1hz-r1..r3`)와 100c·1 Hz·60 s 확인 1회(`…-confirm-r2`, Xcode 빌드와 겹쳐 오염 — 버리고 파일만 남김). 대조표 `compare-repeat.md`, 같은 형식의 `metrics/*.prom`·`run.log`.
- 파일: `<run>.json`(하네스 결과)·`<run>.log`, `metrics/<run>-{before,after}-realtime-{1,2-1}.prom`(각 run 전후 `/actuator/prometheus` 의 `movement_*`·`realtime_*`·`jvm_gc_pause`·`executor_*`·cpu), `metrics/prometheus-range.json`(조사 Prometheus 범위 쿼리 — `survey-run1/` 은 Prometheus 가 내려가 있어 비어 있음), `compare-run*.md`(10-18 대조표, `compare-survey.py`), `run.log`.

## ② 한 섬 N 측정(`one-island*`: `.json`·`.md`·`.stdout.md`·`.stderr.log`·`-conditions.txt`) — `scripts/measure-movement.mjs`(2270 보강판)

- 스택: 로컬 풀 스택 `phone-*-local`, realtime 만 2270 브랜치 jar 로 재기동(`movement.intent.rate_limited` 포함), data-api 는 게스트 상한 env 로 개방(ticket 2271).
- `--users 1,5,15 --repeat 3`. 표(`.md`)는 `--render` 출력 그대로(k회 중앙값).

## 전(10-18) 사본 `before-20261018/`

`loadtest/reports/matrix-20261018/`·`loadtest/survey/results/2026-10-18/`(둘 다 gitignored)에서 이동 관련만: `websocket-measurements-movement.csv`(CSV 의 movement 행), `users-{100,1000,10000}/ws-movement-*.json`, `movement-split.json`(두 인스턴스 450/900), `movement-spread-300c.json`, `movement-diagnostics/`, `environment-20261018.json`.

## 파일 해시

`README.md` 를 뺀 폴더 전체(210개), 이 폴더 기준 상대경로. 재확인: 이 폴더에서 `find . -type f ! -name README.md | sed 's|^\./||' | LC_ALL=C sort | xargs shasum -a 256`.

| 파일 | sha256 |
| --- | --- |
| `before-20261018/environment-20261018.json` | `0b6b868985e26b24fa777db41413ab0713212c53b1f9f5f1311f879d895762b1` |
| `before-20261018/movement-diagnostics/mixed-fast.json` | `6dc23a2c8e60420637ba762ec14dc4d180a2fcfb5b1be5384682d9350b48dafa` |
| `before-20261018/movement-diagnostics/spread.json` | `a8d99fbd4d9b68c0d9d90d7cc657913008b28b3c88776350c4fee11df1ee9433` |
| `before-20261018/movement-split.json` | `6411fc459007637b569b52eac0082069c6761773bba8fca0b4d5fa38d43b9e54` |
| `before-20261018/movement-spread-300c.json` | `75130e47a307eb8451939b39f88e0f5eaf11c6c51cf45599c9988c50b6503c08` |
| `before-20261018/users-100/ws-movement-100c-10hz.json` | `9cb9d2c3a04c75068505fdf5c87ef4a038c637c89151289541ac999fb8a06808` |
| `before-20261018/users-100/ws-movement-100c-1hz-confirm.json` | `1260f10a163c0ca34a8b95d2d1ded457a317f6973654afa297433aca5b1e058a` |
| `before-20261018/users-100/ws-movement-100c-1hz.json` | `0aeeef9e20c7867d6a23f1c66a74b9db464c89afe38243fc13fb186e73b594f1` |
| `before-20261018/users-100/ws-movement-100c-5hz.json` | `9193e9fb03bfc022006a66a7755d984c91dd28b39f4ae37aa0c00af6cbde424b` |
| `before-20261018/users-100/ws-movement-10c-1hz.json` | `d809623b57a3a4fb5940e89860910394a4d1a749e466f467173f719c2591197e` |
| `before-20261018/users-100/ws-movement-10c-20hz-policy-limit.json` | `3c839fa4b1795603aa9e7a7bc604b83749cf29dd332bd332beeacfec41e2dfd1` |
| `before-20261018/users-100/ws-movement-50c-1hz.json` | `5f00574b2abdecbac8269e3dc7181982a249ea1b894dcbf2134a1cb093a90e23` |
| `before-20261018/users-1000/ws-movement-100c-10hz.json` | `9b901670f014baba687b334c77392b67b5ff0c2e47f233636868d3f2e1fd1b24` |
| `before-20261018/users-1000/ws-movement-100c-1hz-confirm.json` | `1eefdb0359df4481a6e04bbc15dd23513dd02a79668ed1402a3757729cc2583a` |
| `before-20261018/users-1000/ws-movement-100c-1hz.json` | `6af674aec7a6789883433b9901a8ea7163c9670b82737dd8e89ea226e63f5b7e` |
| `before-20261018/users-1000/ws-movement-100c-5hz.json` | `a6c5480216b426ab3c1ab8d13b7810c55fcdb2cff16f940a73fbb3cf2a1c63fa` |
| `before-20261018/users-1000/ws-movement-10c-1hz.json` | `653f3aa8ea9b8f302739624737e0ab9024a918095f3dffefa2f7c2e05d1e24f7` |
| `before-20261018/users-1000/ws-movement-10c-20hz-policy-limit.json` | `290f6c5455bd437d7754b4539f96457422871fbafe976837fea87378a1a30661` |
| `before-20261018/users-1000/ws-movement-300c-1hz.json` | `2f1e5b3a3631a272af43f38fc9a4b7d8c0249c73cd1af57e8b7e6ee6fc0878aa` |
| `before-20261018/users-1000/ws-movement-50c-1hz.json` | `9865dbdee1edfc2d7a4ea331b7acab1ed7f256076d47adae97ff48343c67fe8b` |
| `before-20261018/users-10000/ws-movement-10c-10hz.json` | `558afd7fc88504cf0d356fb20ceb41ae929beecdda4ea79170b0e6e26f60f25b` |
| `before-20261018/users-10000/ws-movement-10c-1hz-confirm.json` | `e5c1fe98fbe414607e785d34d10fef4808f8689f716f5865cd32e0427544f6b2` |
| `before-20261018/users-10000/ws-movement-10c-1hz.json` | `13a9032a388869647aeccefa810f512b70c0c0232285347b6f0df8a65810b740` |
| `before-20261018/users-10000/ws-movement-10c-20hz-policy-limit.json` | `2a4adfab36dd45d6b62603c49db9c51c8938d76dad4ba21300e592ee58bd8e3a` |
| `before-20261018/users-10000/ws-movement-10c-5hz.json` | `6426a3a95f085899e4f94acbfd813d79d8fd99de4c09ba562b94152a670b67e2` |
| `before-20261018/users-10000/ws-movement-50c-1hz.json` | `71732095fb8f49f66f0c18fbbcdd57f2dd957f1c74059f9791834186fbd90a79` |
| `before-20261018/websocket-measurements-movement.csv` | `acc3c98c27ae494a9652d72c881909e2b87d60974ed72afae70741cb3e7c5bd0` |
| `one-island-conditions.txt` | `230bbbbbdfda5cf70176928a512b11e69fa2af39bf467fce87f4278de815dcb3` |
| `one-island.json` | `fc4873faf07797ab37b47c5287c112014796b383e06a5cf1cefe58ac97f00ba5` |
| `one-island.md` | `dd9452ec3a0b73cebfacfdf0bdeac5e7b36656dc303ea71a21ada0016e8bfe21` |
| `one-island.stderr.log` | `a0f6b067f9738b7920d2fcce6047cb89bd500bffb812ea056ad590a46fabacc6` |
| `one-island.stdout.md` | `dd9452ec3a0b73cebfacfdf0bdeac5e7b36656dc303ea71a21ada0016e8bfe21` |
| `survey-run1/compare-run1.md` | `e98aff500ec96734160a43be99c8ba204c5400625506d9bbc880129fb05275f7` |
| `survey-run1/host-conditions-run1.txt` | `9aa18a243cd076178447e1e5baaaf1bf4047039468c71be4a1416f4359762a9f` |
| `survey-run1/metrics/movement-split-100c-20s-after-realtime-1.prom` | `3c95ba04132304a0e8b2b658eef3ce46bc92075a69ef53535ef6408634fe9aee` |
| `survey-run1/metrics/movement-split-100c-20s-after-realtime-2-1.prom` | `031089dae3f755b307118d9b3785f48fa494eeae5d63397cfad769be266b0f8b` |
| `survey-run1/metrics/movement-split-100c-20s-before-realtime-1.prom` | `3478dbb80d937bbeef661941d315bd30e3d63af5029e916c24d60a6cd7d144ce` |
| `survey-run1/metrics/movement-split-100c-20s-before-realtime-2-1.prom` | `48644dfdfa688129ed6415c3bfc1a718544429d6a9fe94ff59b0449ebef47536` |
| `survey-run1/metrics/movement-split-10c-10s-after-realtime-1.prom` | `79e6efcda32e55f0be940b7ce0417ed14c8ef7d3c90c5888a8f004444ae0c6e6` |
| `survey-run1/metrics/movement-split-10c-10s-after-realtime-2-1.prom` | `d99ef476bae722bca82732d35a1bae7714e5796c378ea7c9e631fc88def7687d` |
| `survey-run1/metrics/movement-split-10c-10s-before-realtime-1.prom` | `be3a273b44468731b30794221195c4e1551ef5f0ee445b1f2ac655c1b28376f4` |
| `survey-run1/metrics/movement-split-10c-10s-before-realtime-2-1.prom` | `9e9c62df41764777d7df429f75c9d69f4bbd60f78597143e00cfc6b4f111c7fe` |
| `survey-run1/metrics/movement-split-10c-60s-after-realtime-1.prom` | `bad62ebd3074d4bb54a1caf0e9af5da6ebe853d51212cf6739f8c1655ed36a61` |
| `survey-run1/metrics/movement-split-10c-60s-after-realtime-2-1.prom` | `6b0fc74f90325e899f2dd70eb39af3d219a25f0ac3c660dbacdb0765a918243d` |
| `survey-run1/metrics/movement-split-10c-60s-before-realtime-1.prom` | `bc21d97e0afbb98adc9ba870dace7ebd484ad114a9291acdf3f61a68b378d481` |
| `survey-run1/metrics/movement-split-10c-60s-before-realtime-2-1.prom` | `a475f896f151f0527b39d61474e01f2813e8dd1d5eb355fd9c4d90351de94495` |
| `survey-run1/metrics/movement-spread-300c-after-realtime-1.prom` | `4fa4a6b3e81010f8073f53da95956eb6c6f1a59d44a3d17dc26066804350ee63` |
| `survey-run1/metrics/movement-spread-300c-after-realtime-2-1.prom` | `d369ae87e10ae035cb03a745c7fe95a955d3aa3dcc2cd45350a716dc31d48844` |
| `survey-run1/metrics/movement-spread-300c-before-realtime-1.prom` | `23a43e846d6cfff070c7bf6aae1ac81a6dada0766273a7d4b8b0dad6aa7dddc2` |
| `survey-run1/metrics/movement-spread-300c-before-realtime-2-1.prom` | `81e8ec3569d9e2049c9f0242258afa3bbc896295776c1b2b41ae82089eb76bf3` |
| `survey-run1/metrics/prometheus-range.json` | `5928796375ca8afa9abaa36c4b7e3a9211f3e3a92e18af392e387f3171c7e2b1` |
| `survey-run1/metrics/ws-movement-100c-10hz-after-realtime-1.prom` | `0f361b527a9f4d701f9a92ffc5694f00b66d083dd868f5e760d9be28cd2bffef` |
| `survey-run1/metrics/ws-movement-100c-10hz-after-realtime-2-1.prom` | `a7e50280b50fbbd913f38b670bbaf97a717844792d60b56adf5b006fc7783080` |
| `survey-run1/metrics/ws-movement-100c-10hz-before-realtime-1.prom` | `daedede735ff8492674b1f997687b6bc2dd77d0e554a941388126f0cc3b827ce` |
| `survey-run1/metrics/ws-movement-100c-10hz-before-realtime-2-1.prom` | `8d6e9bac586fdef7e69c680f7b71f396a4ddfc5df7a22ddfabc94d60961c3319` |
| `survey-run1/metrics/ws-movement-100c-1hz-after-realtime-1.prom` | `7b242c9a60b7c217c7f6d2e3b491db13e6762f93de0301b73a4270f99737f249` |
| `survey-run1/metrics/ws-movement-100c-1hz-after-realtime-2-1.prom` | `4c0ce57f644fd950a79e4d2a1655623faea1615bbd050164f278ac3bfca79a34` |
| `survey-run1/metrics/ws-movement-100c-1hz-before-realtime-1.prom` | `1d7f030545dee31b7aa4dfead89ff075cd0c66bc79e7216c262fb27bc42e6220` |
| `survey-run1/metrics/ws-movement-100c-1hz-before-realtime-2-1.prom` | `2ba4e30dbfadccb946fa2c78737a5ac3945dd1b2c599d6b45462cb09a6b385ef` |
| `survey-run1/metrics/ws-movement-100c-1hz-confirm-after-realtime-1.prom` | `e75342d9679834a7cfcae345de3e62610b2adfb60796112880f4ec8560f1cb47` |
| `survey-run1/metrics/ws-movement-100c-1hz-confirm-after-realtime-2-1.prom` | `7407b668f62b8c641f65564dfea58ccdc863b8149e492322b7c7a99c8d3cf279` |
| `survey-run1/metrics/ws-movement-100c-1hz-confirm-before-realtime-1.prom` | `ba44a55dd2c69ec0d60e99a9f44fb983aca0ae4cb634442369e333e118a91099` |
| `survey-run1/metrics/ws-movement-100c-1hz-confirm-before-realtime-2-1.prom` | `94d043683f401d3ba68c5d2e0926be1e18d5088e25e91eda5cb029cff46b35ce` |
| `survey-run1/metrics/ws-movement-100c-5hz-after-realtime-1.prom` | `4958adbc567506174238d349c8498618e0f4c0123c7f67725cbbdfa57310ec1d` |
| `survey-run1/metrics/ws-movement-100c-5hz-after-realtime-2-1.prom` | `953c30e053655a473bff6931567e075068b326a53e6dc37f21a864f1b12673e9` |
| `survey-run1/metrics/ws-movement-100c-5hz-before-realtime-1.prom` | `f66de8979bb337b9f5e23bfae1caa250122a2632d30da853501f1141f5f81500` |
| `survey-run1/metrics/ws-movement-100c-5hz-before-realtime-2-1.prom` | `d99ea6bbe0678aea2040a1a7b8d70073c9d367d77c754a0bd7576e220fcd0cfa` |
| `survey-run1/metrics/ws-movement-10c-1hz-after-realtime-1.prom` | `1f417a7d06796c70df4196c01fc342801cfa528989897fef6d4ba06d28e15a4f` |
| `survey-run1/metrics/ws-movement-10c-1hz-after-realtime-2-1.prom` | `50642f7f5cc903d07f49105a7bad4fce9bc4d5a2613cc3608393879b1ce2fcd0` |
| `survey-run1/metrics/ws-movement-10c-1hz-before-realtime-1.prom` | `6d430c4bfe35dd2baa28f131c5c3f79bfabd8d364e032200f3107351cd9a2927` |
| `survey-run1/metrics/ws-movement-10c-1hz-before-realtime-2-1.prom` | `db10362e1515e0abb5baf20aa1f5f861da34dedae1c38d10b9935b9c8dc33666` |
| `survey-run1/metrics/ws-movement-10c-20hz-policy-limit-after-realtime-1.prom` | `6b9b62c0f535995bd39f2cdfe83b795bdbbc8497e2d28d8d00799afd319f0a9d` |
| `survey-run1/metrics/ws-movement-10c-20hz-policy-limit-after-realtime-2-1.prom` | `e8c3c07213520ca3f38fd042854408aec355dd29398f99f425a263d0f9e842f5` |
| `survey-run1/metrics/ws-movement-10c-20hz-policy-limit-before-realtime-1.prom` | `84de250caaa31b7b4806f282fb9cb7051216b329cfe60f66768176f50c080d3c` |
| `survey-run1/metrics/ws-movement-10c-20hz-policy-limit-before-realtime-2-1.prom` | `e79ca82939956aefa93e269c0dcd816e8ff5fccb5fc1c137df9b770cf7ab35f9` |
| `survey-run1/metrics/ws-movement-300c-1hz-after-realtime-1.prom` | `9cf3f6b176ef3231e341a3bc47dc7465f19122e5091ef9232aef96bb3af2b1b0` |
| `survey-run1/metrics/ws-movement-300c-1hz-after-realtime-2-1.prom` | `04283f7c8caac5dd5d713f010f8d19135e026e55ddce742c628e7277e7bb876c` |
| `survey-run1/metrics/ws-movement-300c-1hz-before-realtime-1.prom` | `5526951e7c1d166c9a482f40798aa3a93f7c29859bdb133e3cb3ae18a32aab2f` |
| `survey-run1/metrics/ws-movement-300c-1hz-before-realtime-2-1.prom` | `92bd48384a0bdfafd00b2f610862bb24baff6acbbdbe8ecbfd2c369d687e7ad1` |
| `survey-run1/metrics/ws-movement-50c-1hz-after-realtime-1.prom` | `a14084d6fa41dbf2e19da40a52a0be9aa12479c804c751949ea48dd3d78faf04` |
| `survey-run1/metrics/ws-movement-50c-1hz-after-realtime-2-1.prom` | `42c478c69bfb7e1a0c46ab64b9655a54dd87485050c5e5c924d3f62bc904a18c` |
| `survey-run1/metrics/ws-movement-50c-1hz-before-realtime-1.prom` | `9aa040dd3183cd295bd596eeffd5df5549949a41847d6b7151d6aa09f3740a1d` |
| `survey-run1/metrics/ws-movement-50c-1hz-before-realtime-2-1.prom` | `1178864163425b473d08c5abfc7b9666909bf820a936b6152d0659d42b22091e` |
| `survey-run1/movement-split-100c-20s.json` | `75b5c126959dcdd0fee7100df5f1c29b04acb8e9725556a7fd0539abe19f5ae6` |
| `survey-run1/movement-split-100c-20s.log` | `2a1db74b0e5012c4bf252918106e55f945178157adae61d88b3f838430e0ebe2` |
| `survey-run1/movement-split-10c-10s.json` | `4d6ef401c50fa833848bb3cdbbf107514fb78c00bc9e8f5b1b099f6bd6e92aed` |
| `survey-run1/movement-split-10c-10s.log` | `c959c7bfe264aae65a4df209cc4c8701c5b49e9025cb8bb4b91cf2dec3b855a3` |
| `survey-run1/movement-split-10c-60s.json` | `70de1bf62d939cc7855f67884e4568f6df31eb5a83c0b9cf2431ded6cdd3bf6c` |
| `survey-run1/movement-split-10c-60s.log` | `41bc35ea6bf29a8bc654075c57a6c2b6e8c59e69a34f67f000b0c7481b0a458b` |
| `survey-run1/movement-spread-300c.json` | `071dba7b73f2e5982d141651f271ece172fdf247dfab717f225ba11ca234fdd6` |
| `survey-run1/movement-spread-300c.log` | `b1cf8b6163ad731a6d0905e1460fc416a8c52297eec1b74de74a81693debbd37` |
| `survey-run1/run.log` | `2b6a515184bc8174aa45e6210dc398826febc7ff0aa88ad6aba2c0c0cecf1e2a` |
| `survey-run1/ws-movement-100c-10hz.json` | `dd6278b74959307290f2f84db60da4fc91c6bb62fe89bdfdf5283e9ebc12002a` |
| `survey-run1/ws-movement-100c-10hz.log` | `e78f61c5355c13dd40fcac4db2236b4b6ea6ee3d44d8ef3aac18f790189d9801` |
| `survey-run1/ws-movement-100c-1hz-confirm.json` | `fe533d92dd7fe26d6bc5d13c51a96da1edde061e52d55965057934bc408a59a3` |
| `survey-run1/ws-movement-100c-1hz-confirm.log` | `c61dd14ad671358de2ccace99f0abfba8aeea6acf4de450d73cb20bebdc6c588` |
| `survey-run1/ws-movement-100c-1hz.json` | `0e7ad088a8043748cb10c2e5c2cf968680b54e6f181786d9d925a5451d812b00` |
| `survey-run1/ws-movement-100c-1hz.log` | `4d500e3ab0110375bc9a4849f82d0cce0833025542fca0c5faf1275f6a07ca2c` |
| `survey-run1/ws-movement-100c-5hz.json` | `d7625d55ef004a0193817b80318d9a4d3cc7a19cd57cf0e851cc155fd4c78514` |
| `survey-run1/ws-movement-100c-5hz.log` | `6c7834f65fa6034fa31223ba4125c89b884e2312854cea1e2ffac10c17cf4d79` |
| `survey-run1/ws-movement-10c-1hz.json` | `e02d478cc4ac0d574eab6d673ab106dc1d01b854814791c68bb4bc5140361783` |
| `survey-run1/ws-movement-10c-1hz.log` | `796082f5ea48e00f68eb6cbcbdef4fe77743c70f26b369c2fadbe0e9f7d7947f` |
| `survey-run1/ws-movement-10c-20hz-policy-limit.json` | `a39f8c3413ae455f063c21d2f191df432f564a078579a6ce21b698c38bb70874` |
| `survey-run1/ws-movement-10c-20hz-policy-limit.log` | `a550c0d09ec1fbb74f2e1da2ead9c720b6e561462e1c587df4dd4e895b1288ea` |
| `survey-run1/ws-movement-300c-1hz.json` | `01cb89b50bcd9a3fa9ee10afaec42858a2f7372d09d3cdcda8f2be3fe6ccf2b5` |
| `survey-run1/ws-movement-300c-1hz.log` | `65a43f2aa14f29dd5bd9bd050e005fbf1c25fcb2d5be5f029a104e42c753c302` |
| `survey-run1/ws-movement-50c-1hz.json` | `2703ab76ee5bfa67ea9d3fa5f999f21160cd31d1a0100fe80fc71b7dfaa7c79c` |
| `survey-run1/ws-movement-50c-1hz.log` | `3683dc4c60022dadfdc0caa82f6f8168937f1372531242f3e495978a9a8d0c9f` |
| `survey/compare-run2.md` | `7b4766408336d8b972b39eb16c2e08f5e197c386f505c4ef2853bc85f524ef92` |
| `survey/host-conditions-run2.txt` | `cfd38fcaab24d085a9f8fdd6be8885a93615abe61f764d81716559e1fb2469ca` |
| `survey/metrics/movement-split-100c-20s-after-realtime-1.prom` | `ffa9306fe89e53b134b4a9d7518c76c5eedd96f053f34f1b5f1dba9be87ebcc3` |
| `survey/metrics/movement-split-100c-20s-after-realtime-2-1.prom` | `ba85365d50c94c703c8b232eb923db178f6888fa99cf12c77e7004ba55c2cb6a` |
| `survey/metrics/movement-split-100c-20s-before-realtime-1.prom` | `1f62b6949268d138a62f366f251db44cfe343664ac849dc0afb179028325c417` |
| `survey/metrics/movement-split-100c-20s-before-realtime-2-1.prom` | `08eb397b37cd2cf3ec67566a7da9ab8f2e594c8d682c8cf0c5fd614ea3c7add6` |
| `survey/metrics/movement-split-10c-10s-after-realtime-1.prom` | `1277b9ec44b9da97124e3adf4661a78deec2d277a460aaa076a049c550b6814a` |
| `survey/metrics/movement-split-10c-10s-after-realtime-2-1.prom` | `72b9bf3d2e60fd4d935bc7b8a7934a7013abfa84cb7eaaf74dd1fec65de053e6` |
| `survey/metrics/movement-split-10c-10s-before-realtime-1.prom` | `85a0eb5ef8494024a012df1bf0e1f35ac8860f89ae380b156a5079332b4404e5` |
| `survey/metrics/movement-split-10c-10s-before-realtime-2-1.prom` | `56b650648b198be66029384d7825ed83b9be66541c0ba4f32e280f06a0fcc6bc` |
| `survey/metrics/movement-split-10c-60s-after-realtime-1.prom` | `da0cec83592b585e5ff84e05c23d0481732e72562a41a1ca308d6fbb838f0a61` |
| `survey/metrics/movement-split-10c-60s-after-realtime-2-1.prom` | `86300f15bab774ba0aa20c3043f60e0fb70568f2aecfa5ba3380e4c790360d35` |
| `survey/metrics/movement-split-10c-60s-before-realtime-1.prom` | `ca757714c17f31860d3599eca31bfd77c439fd39de302e979baf8eb46ca9fbe3` |
| `survey/metrics/movement-split-10c-60s-before-realtime-2-1.prom` | `e07c879df03c63dfb11ee8ce0cde7bbd67f3be7b90de50c5c1b3af57baaf0441` |
| `survey/metrics/movement-spread-300c-after-realtime-1.prom` | `1419715a3a2926be8a66a2267a9ffeb9377dcae2e002ff91780bf6c8fbf35c38` |
| `survey/metrics/movement-spread-300c-after-realtime-2-1.prom` | `42c7758d3aa43ced4b529fada91dbcfd880c87aef5e2eeb7a8b662f1f2f080a5` |
| `survey/metrics/movement-spread-300c-before-realtime-1.prom` | `e7a035efa43541e42d47f380fe522dc3eb0d2caa902283196728d565317dce5d` |
| `survey/metrics/movement-spread-300c-before-realtime-2-1.prom` | `0948129bba2839267946dbc333ed893950d54cd788fc672ab69175789bcba484` |
| `survey/metrics/prometheus-range.json` | `f1bfdc7decb9a704fd2a3b080ff3d5f10aaabafe1a4b150b81e7a14e84684bd0` |
| `survey/metrics/ws-movement-100c-10hz-after-realtime-1.prom` | `21810f61843b693cb8a95f06e01491f705c9bafc7199819765687269528e2f1f` |
| `survey/metrics/ws-movement-100c-10hz-after-realtime-2-1.prom` | `8f7f51315d6b020e38f2be00d3f4a187557a349dc77429b70bc0bf5abef4b817` |
| `survey/metrics/ws-movement-100c-10hz-before-realtime-1.prom` | `8c89ae391f25055773a52363fd62020a95c7f8762fa03c68cd06b95a0fd72655` |
| `survey/metrics/ws-movement-100c-10hz-before-realtime-2-1.prom` | `655746df8ab486de2d22549d9e4076b37ebe5e997785034dbc28bf46acb4e280` |
| `survey/metrics/ws-movement-100c-1hz-after-realtime-1.prom` | `a515a0bf9b71bca0ca7482806ff5ec62943c5701c99411355c6fd336b57a81fd` |
| `survey/metrics/ws-movement-100c-1hz-after-realtime-2-1.prom` | `a46a60d03b2c4c19cd4e63bd017af2945447fde983be4fdd8562454325f2c8bb` |
| `survey/metrics/ws-movement-100c-1hz-before-realtime-1.prom` | `690fe93397cabe19420e64fdfe6352ab5958e7e4a8063c2cf5e62e3c503a65dd` |
| `survey/metrics/ws-movement-100c-1hz-before-realtime-2-1.prom` | `2651a05305ce7833b6bae3774bfdd9b17de109bf8b884f9489c70ec57f7a498d` |
| `survey/metrics/ws-movement-100c-1hz-confirm-after-realtime-1.prom` | `cb59946a8cfe310882ae3f2448451b926d173d5f6ba65e2a9b35e692037d0252` |
| `survey/metrics/ws-movement-100c-1hz-confirm-after-realtime-2-1.prom` | `57b8c668702d88aa93481e295c12a6546f03b6648b4cfcc8615f3ff7f0f75d42` |
| `survey/metrics/ws-movement-100c-1hz-confirm-before-realtime-1.prom` | `091f350437cd0c54c80e429e9989585c2fbb04f5eaf77db408848ccf21e34115` |
| `survey/metrics/ws-movement-100c-1hz-confirm-before-realtime-2-1.prom` | `6c5f8297cee86f908fa18ffa0dda621c35d2b55ab04a07dfd1e331d3a357fd57` |
| `survey/metrics/ws-movement-100c-5hz-after-realtime-1.prom` | `e5f6761dc45eaaac222b2d6d7337d591b9a8174427fedba4f16d19c44c06b04d` |
| `survey/metrics/ws-movement-100c-5hz-after-realtime-2-1.prom` | `274ff95125e4eada385d0dddf5f3f4c5cb0336794eae041ff9830f0fc30b3d0c` |
| `survey/metrics/ws-movement-100c-5hz-before-realtime-1.prom` | `5d5abde50c12002a1adab72327d65461097a8f7c2765e52337ce26bb551b0b29` |
| `survey/metrics/ws-movement-100c-5hz-before-realtime-2-1.prom` | `41ecc06deddf93496ca69eef500d497a9bff62a7dc37d9678253faadbde09cd7` |
| `survey/metrics/ws-movement-10c-1hz-after-realtime-1.prom` | `26b6e371efd2647abec14e9952b1bddcdf3115cc41ddf38c603b9d56529f6fd7` |
| `survey/metrics/ws-movement-10c-1hz-after-realtime-2-1.prom` | `bfe5889b54b4da413a55686e880d7ef20ec7c401bd997904c1bd4fa8347b3491` |
| `survey/metrics/ws-movement-10c-1hz-before-realtime-1.prom` | `7e3f867f8431d13c81c692a8777c0405446410bc04d0145b56fdf88a02620cd8` |
| `survey/metrics/ws-movement-10c-1hz-before-realtime-2-1.prom` | `8ca5a11e02db278bdedf923e50c95f66319926dad3a386176fb7526e56e8b1d9` |
| `survey/metrics/ws-movement-10c-20hz-policy-limit-after-realtime-1.prom` | `02ab5a26e59137a105a9d62101e3582598b08d3c0cf72dcd5824360cfa806f29` |
| `survey/metrics/ws-movement-10c-20hz-policy-limit-after-realtime-2-1.prom` | `6c2332ce13296188b3187a8c8ed63ee19fcd35178aca5c13058be442ea99ab31` |
| `survey/metrics/ws-movement-10c-20hz-policy-limit-before-realtime-1.prom` | `20c34c39b868b7f44ae139faf336a25bdb014dde6f6671dac39f05d3646fe8f0` |
| `survey/metrics/ws-movement-10c-20hz-policy-limit-before-realtime-2-1.prom` | `c749fa658d1aaf9f467c0f345cb3a7e4296393c83f7bc1df45b771f142ef3ffe` |
| `survey/metrics/ws-movement-300c-1hz-after-realtime-1.prom` | `b66dc024c3602e03cdbfb0d3bf51cff27f4d2f62672e7a50522db832a495b6d1` |
| `survey/metrics/ws-movement-300c-1hz-after-realtime-2-1.prom` | `24a617bd27be0ad877bf88d7581014fd877a8aec915dda7f4f65ee87070de2e6` |
| `survey/metrics/ws-movement-300c-1hz-before-realtime-1.prom` | `7e16cd433483748d67c6b42904cda816210916727278fdf421fc99966d45555e` |
| `survey/metrics/ws-movement-300c-1hz-before-realtime-2-1.prom` | `659c4b7506bdf18b01e1f4bd29b62d3cba615412643ac0fc1c78e84251d48c81` |
| `survey/metrics/ws-movement-50c-1hz-after-realtime-1.prom` | `c6b1c78f291f4c47b0dc7f52a7918481bb9191bb7b07f2f5fcbc6e42b51cba4c` |
| `survey/metrics/ws-movement-50c-1hz-after-realtime-2-1.prom` | `e37ca2306a2aa1220b55429583209b56db6a0dfe35a610f22111c9effb52eeac` |
| `survey/metrics/ws-movement-50c-1hz-before-realtime-1.prom` | `6fde00c80d11706e86d587d7205905488f67dca44635b4cae526165768685b16` |
| `survey/metrics/ws-movement-50c-1hz-before-realtime-2-1.prom` | `c1fcff0e37e9286637535570e4e6d2c0849d67a81165afd33a0abecfaf68b62a` |
| `survey/movement-split-100c-20s.json` | `22d05c1f8b52a2469472dfc8cc27563c7ea0ac893e843d526a752c0de22dde45` |
| `survey/movement-split-100c-20s.log` | `0ed25dd621cbeafeece608fa36a0464b6962904c2d4e64ac7dcbb33b9a6286cc` |
| `survey/movement-split-10c-10s.json` | `a7fe8dc48f2d46037673b7702bb701536283ccf4d63935a2c28e684d9f2ba738` |
| `survey/movement-split-10c-10s.log` | `e897020cf4b591f9528061508804415e3124d528044de7d07d7c36ddf3a213a2` |
| `survey/movement-split-10c-60s.json` | `78e183b9bb13f15752aa2deb412c57a4c29df8002ceb59e4ce1673f510bd2fbe` |
| `survey/movement-split-10c-60s.log` | `9aa337e16d8b650e91d36bca3a3ccf927c2592886e158b4ef2580d1801984df3` |
| `survey/movement-spread-300c.json` | `f16ecfb2eac2cf253f863afdd54fab1c2a1a0fda695de91b2ac01a9b2b1a10ee` |
| `survey/movement-spread-300c.log` | `a7bdfad7a2b709e502db79a2364e6e34cafeca4095ff072e7aebebf50733a553` |
| `survey/repeat-300c/compare-repeat.md` | `bbf43b4b0473a76c01313da3d856a47c5d0d8e0bc0d5c46aee6a2cd7715f5284` |
| `survey/repeat-300c/metrics/ws-movement-100c-1hz-confirm-r2-after-realtime-1.prom` | `7d9a1b58d85e16b3c3498a633dd57f39b4a8a99913c8a23ecb5aa251c555d075` |
| `survey/repeat-300c/metrics/ws-movement-100c-1hz-confirm-r2-after-realtime-2-1.prom` | `348fec6f11cc6d247938fe4ea49b4604855ef2f8136510af5592bb43e06f3f9c` |
| `survey/repeat-300c/metrics/ws-movement-100c-1hz-confirm-r2-before-realtime-1.prom` | `386dbc2601b327e7b7a413d99bf9668bab012b46418777727953671de05fb370` |
| `survey/repeat-300c/metrics/ws-movement-100c-1hz-confirm-r2-before-realtime-2-1.prom` | `b8310ccaf2358661d5688f848bc0943f15378f8fd5a438c6944c1e7060e9e9a4` |
| `survey/repeat-300c/metrics/ws-movement-300c-1hz-r1-after-realtime-1.prom` | `84db6c8af3713f004b589d8fc67fd90664d82916905ad76a133d2b842ff6f483` |
| `survey/repeat-300c/metrics/ws-movement-300c-1hz-r1-after-realtime-2-1.prom` | `6ad039a27d091ffaa611f1122bf1e21097612e3d463e5b434a19e851c4b09670` |
| `survey/repeat-300c/metrics/ws-movement-300c-1hz-r1-before-realtime-1.prom` | `5c70e940ee6b99f86ddf3694f6367a4b93824dca1c0325cb2867e6efed779a5e` |
| `survey/repeat-300c/metrics/ws-movement-300c-1hz-r1-before-realtime-2-1.prom` | `d16e20102d406d8593d7ff7299d244ac3e72574e083e9d42f2e74ed9ff271767` |
| `survey/repeat-300c/metrics/ws-movement-300c-1hz-r2-after-realtime-1.prom` | `eebcdfbd4e4917d0e6ce65e012f7ee0cd6b4bddf4b547d6282cb551532b45771` |
| `survey/repeat-300c/metrics/ws-movement-300c-1hz-r2-after-realtime-2-1.prom` | `1bf6417c08ac9a9b455c308570a5270f4cbe6f0125c268366623c4c94079e845` |
| `survey/repeat-300c/metrics/ws-movement-300c-1hz-r2-before-realtime-1.prom` | `64444567aa973ccbbcd02d9d57359b3875475d2755607ae7c826519ee4787e7f` |
| `survey/repeat-300c/metrics/ws-movement-300c-1hz-r2-before-realtime-2-1.prom` | `df146f5fdc1dc95016c56c3b45d289257990021a8b255d1d339788074ac85861` |
| `survey/repeat-300c/metrics/ws-movement-300c-1hz-r3-after-realtime-1.prom` | `55fc2d6552ca18739acf124a17d32231e3189c068b66ec167ee572f394f700ac` |
| `survey/repeat-300c/metrics/ws-movement-300c-1hz-r3-after-realtime-2-1.prom` | `5a64e9def43c1ec1f028c9370a7e81e233e38ed3d1b17afa3a9e4eb53b6b4fc8` |
| `survey/repeat-300c/metrics/ws-movement-300c-1hz-r3-before-realtime-1.prom` | `5226611cfcdd785fcb59742b07776c5f876b92bb822d02b505f438807b34cc52` |
| `survey/repeat-300c/metrics/ws-movement-300c-1hz-r3-before-realtime-2-1.prom` | `cb48c72ed28a578e4e89ae7648b737d117454d158131d72bdba20d60c02ea803` |
| `survey/repeat-300c/run.log` | `bef182ad250d805f371c422536de7d2765b3a545f530ca3e011eaee84d06daad` |
| `survey/repeat-300c/ws-movement-100c-1hz-confirm-r2.json` | `b10d29d84d9f2f01fa75fc3b2fac3a96916e45ea9a273603300478a86e65da0f` |
| `survey/repeat-300c/ws-movement-100c-1hz-confirm-r2.log` | `d788566a501cf13e4b9f6ae1de2f4a4a7ac67a434c73e4cedd7e617062e39f8e` |
| `survey/repeat-300c/ws-movement-300c-1hz-r1.json` | `4b1ee2de5c4a685e996cd5ab96a0aeb35eb985965ad4c678de2cb54455459edb` |
| `survey/repeat-300c/ws-movement-300c-1hz-r1.log` | `1ce6800cf3c759776cf5c2f08af32b8797974854c19e9c31e30bb8e71ab7aa21` |
| `survey/repeat-300c/ws-movement-300c-1hz-r2.json` | `9cf903a9bb14b57a17f8616fe1144668190ac09183558c2782fdc19082de0ecd` |
| `survey/repeat-300c/ws-movement-300c-1hz-r2.log` | `77cbf0fe293c9780030c00cbe34e706212138ec9d13a9acace6dcc5bc575fb73` |
| `survey/repeat-300c/ws-movement-300c-1hz-r3.json` | `527add5c6fcade3dac9c625a150697c41d1bfcc1403286fe6175470deecce02f` |
| `survey/repeat-300c/ws-movement-300c-1hz-r3.log` | `4a79daa36d3f953e0729a1e6dad0732911aefa25b2f365d8aa531c1b6fb733d1` |
| `survey/run.log` | `018f2ad2be53517c1d7ef36dadfe6149dbfd92ee909e64e5d7c741188b297c06` |
| `survey/ws-movement-100c-10hz.json` | `48311991f79dc714e1fae9d2ec811cd2de434d1cacbbbc338fccb7772d3f3bc1` |
| `survey/ws-movement-100c-10hz.log` | `c76911ed15d47751e93d197db4d8f8b361884d1e644163e46f2dee94d4ff46ef` |
| `survey/ws-movement-100c-1hz-confirm.json` | `0469adf107a38001c7744c1e9f46a449f39b603baba2d04b1a66bee6c659bbce` |
| `survey/ws-movement-100c-1hz-confirm.log` | `9cbd35225171d04f09e60730475bbb0a38dc4985a222342601fdc3741207874b` |
| `survey/ws-movement-100c-1hz.json` | `0636ed31dd904af7a0749f10297911caf1e1155403b03828611eba027b82dbb1` |
| `survey/ws-movement-100c-1hz.log` | `ea5fb00f4c5d56e2ab91bb84f587995480d061fd3154e5243085359c440e446f` |
| `survey/ws-movement-100c-5hz.json` | `1d9cb2a024d2584c15f92444580015ee4b64cb1e79b3c1396bcc32184e8354c2` |
| `survey/ws-movement-100c-5hz.log` | `36101c68bd44c355de40e7b58ff40031be3b816ef25e0a4c1cad154885688b23` |
| `survey/ws-movement-10c-1hz.json` | `474aeb7f618c135431ff01b85cbec7be6253a736e9f169d0b945c749437f76a9` |
| `survey/ws-movement-10c-1hz.log` | `ed504ce76c2f30fa9520c5bb08c827ad65d29628421aaf456e691821d4b84edc` |
| `survey/ws-movement-10c-20hz-policy-limit.json` | `436d302e0577fc47bac879fb3f09a07e3d67111a94b4f6b80b5514111c40a504` |
| `survey/ws-movement-10c-20hz-policy-limit.log` | `6962925c84d3bc919c715ebc13fae2766366fbdd2a4a66a66698c76ee49a8e2a` |
| `survey/ws-movement-300c-1hz.json` | `2cce2401eb485d42d296ee5edbccbb20fa3d1093e5021d8de0082205d8eef1fa` |
| `survey/ws-movement-300c-1hz.log` | `2d417f8e43edfd5e9dc9570ebe8e44af203b67c9c5462ce100aeabb55c84da93` |
| `survey/ws-movement-50c-1hz.json` | `f6eeaac176e89f34d139af2428ac1f672be8ea77b54ec2e496a95cb352af049f` |
| `survey/ws-movement-50c-1hz.log` | `3a6d6cbb9fcc03547be066846d8cd54fc818186f4cd148631f6f7b3c8dcdc42d` |
