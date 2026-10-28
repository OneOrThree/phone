# 2026-10-20 이동 동기화 서버 재측정 — 원본

main `6e4857950`(에픽 2335 머지: 이동 단일 소유자 2339 기본 ON·Redis 릴레이, 유한 outbound 실행기·heartbeat 10s, 틱 히스토그램)을 10-09·10-18 과 같은 두 하네스로 다시 잰 원자료다. 해석은 [validation.md §7-2](../../validation.md)에 있다. 값은 손으로 옮기지 않았다 — 표는 스크립트 출력이다.

## 환경(공통)

- 맥 한 대(Apple M5 Pro, 15코어·48 GB)의 Docker Desktop(8 CPU · 7.65 GiB, aarch64). 발생기(Node 24)도 같은 맥.
- `host loadavg`·동시 작업은 각 `*-conditions.txt`·`host-conditions-run*.txt` 에 실었다. **`survey-run1/`(run1)은 다른 세션의 gradle 워커와 구현 에이전트(gradle build·jest·pod install)가 동시에 돌아 지연이 오염됐다 — 전달 누락·수신량·Snapshot 수만 참고하고 지연은 run2 를 본다.**

## 원본 축소 (리뷰 1라운드 반영)

- `survey-run1/metrics/*.prom` 은 오염 run 이라 삭제했다. 인용값은 같은 폴더의 JSON 이다(`prometheus-range.json` 은 유지).
- `survey/metrics/*.prom`·`survey/repeat-300c/metrics/*.prom` 은 각 파일을 `grep -E '^(movement_|realtime_|jvm_gc_pause|process_cpu|system_cpu|executor_)'` 결과로 제자리 교체했다(파일명 유지). 필터 전 전체 스크레이프의 해시는 커밋 `a8199cf41` 의 이 README 표에 있다.
- `one-island.json` 은 각 result 의 `raw.promBefore`·`raw.promAfter` 키를 제거했다(나머지 필드 불변). 스크립트는 이제 `--keep-raw` 일 때만 이 텍스트를 `--json` 에 담는다.
- `before-20261018/` 는 유지한다. 원본(`loadtest/reports/matrix-20261018/`·`loadtest/survey/results/2026-10-18/`)은 gitignored 라 레포에 없다.

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

`README.md` 를 뺀 폴더 전체(162개), 이 폴더 기준 상대경로. 재확인: 이 폴더에서 `find . -type f ! -name README.md | sed 's|^\./||' | LC_ALL=C sort | xargs shasum -a 256`. 축소한 `.prom`·`one-island.json` 은 축소 후 해시다.

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
| `one-island.json` | `758804d2e002ebd054ffea1ba6db7be285b7c43b574058d1e911689433667739` |
| `one-island.md` | `dd9452ec3a0b73cebfacfdf0bdeac5e7b36656dc303ea71a21ada0016e8bfe21` |
| `one-island.stderr.log` | `a0f6b067f9738b7920d2fcce6047cb89bd500bffb812ea056ad590a46fabacc6` |
| `one-island.stdout.md` | `dd9452ec3a0b73cebfacfdf0bdeac5e7b36656dc303ea71a21ada0016e8bfe21` |
| `survey-run1/compare-run1.md` | `e98aff500ec96734160a43be99c8ba204c5400625506d9bbc880129fb05275f7` |
| `survey-run1/host-conditions-run1.txt` | `9aa18a243cd076178447e1e5baaaf1bf4047039468c71be4a1416f4359762a9f` |
| `survey-run1/metrics/prometheus-range.json` | `5928796375ca8afa9abaa36c4b7e3a9211f3e3a92e18af392e387f3171c7e2b1` |
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
| `survey/metrics/movement-split-100c-20s-after-realtime-1.prom` | `b689c6f94a564bfd3d828e47aa452534713ce69a75ee2d3bf350a3f12d1e5c79` |
| `survey/metrics/movement-split-100c-20s-after-realtime-2-1.prom` | `e7e9d25b7ccfd3d081c056130d0f0077e4fb240286572ab41f17160951a8f7a4` |
| `survey/metrics/movement-split-100c-20s-before-realtime-1.prom` | `1a8413921e0322d29992483fcb8781a6e3b10f0aee6cb2fc3fe2bc358ecad2c9` |
| `survey/metrics/movement-split-100c-20s-before-realtime-2-1.prom` | `81f33828c16a954e2bd0bf06037ef5b4e47c1e4cee7eccc3423c7dfb327869b6` |
| `survey/metrics/movement-split-10c-10s-after-realtime-1.prom` | `038908bc956aa6cf90140001b4cbfc43656daf452a1edc01f41c3f82ca5fe131` |
| `survey/metrics/movement-split-10c-10s-after-realtime-2-1.prom` | `7b5cdc18f26b618d9e2e45afab1807281b6200afc78bb577e7be150c5b7c39a7` |
| `survey/metrics/movement-split-10c-10s-before-realtime-1.prom` | `964f56589c82fc742431fd877b2156e5789ecbd45bfa231f749c3a9ab76288de` |
| `survey/metrics/movement-split-10c-10s-before-realtime-2-1.prom` | `1bd8f9e85126fa90a893c9cf65f4d4b813598ef9a8586f91b2a547b93ef1d555` |
| `survey/metrics/movement-split-10c-60s-after-realtime-1.prom` | `4ced14022a0d9b7322cb6c2ec4b4fc6abb4e88a912b9f98a782307cd22c71b63` |
| `survey/metrics/movement-split-10c-60s-after-realtime-2-1.prom` | `8162da730dc51912dd6f7ee0b8df81863aeee65b37f814c02ff2df42ddc40a8b` |
| `survey/metrics/movement-split-10c-60s-before-realtime-1.prom` | `aef17e9fc0d5ae82b3d75348efb9cd08fba34e89729765c73ad44d2a72c1ccc9` |
| `survey/metrics/movement-split-10c-60s-before-realtime-2-1.prom` | `89ff331d2317926e4c3576ee145daa06201cd1e7f94b75c15097b008eb9a2691` |
| `survey/metrics/movement-spread-300c-after-realtime-1.prom` | `1020c3a97106c656277d9a813bd8a5aea3f17de91ce93e6d1ef4b964e6419c56` |
| `survey/metrics/movement-spread-300c-after-realtime-2-1.prom` | `cf9527dccaae51eea72c222386520ffc11836bb4659a181f664a6b042ab19d71` |
| `survey/metrics/movement-spread-300c-before-realtime-1.prom` | `6e5f982772b605a4bbd2ef611fa5b9bb4555789e036d2e0a73ad965c0863df40` |
| `survey/metrics/movement-spread-300c-before-realtime-2-1.prom` | `7972f827c180cc420e7ca7d9c8de3a3413a808e1ecc74d208bd5afb32aed2519` |
| `survey/metrics/prometheus-range.json` | `f1bfdc7decb9a704fd2a3b080ff3d5f10aaabafe1a4b150b81e7a14e84684bd0` |
| `survey/metrics/ws-movement-100c-10hz-after-realtime-1.prom` | `186533066dbdc7c9ce9097d72a53768739f4c057a44919b24231e58058524517` |
| `survey/metrics/ws-movement-100c-10hz-after-realtime-2-1.prom` | `859249b76100eec650de83fd4fb556e58fced9270ae95fd8d10d90c5452424a8` |
| `survey/metrics/ws-movement-100c-10hz-before-realtime-1.prom` | `f23cc0ea1e4285531718b77579542eff92618daa7b4f2b032e493a0c2532e293` |
| `survey/metrics/ws-movement-100c-10hz-before-realtime-2-1.prom` | `2d977ec70050f7239ff9afb49fd7e61c6a83980e4175b4560fa6c63a41a22928` |
| `survey/metrics/ws-movement-100c-1hz-after-realtime-1.prom` | `3b37816ee3a67cf470f4683e71adcfdd3a7f9151e06298e3dd7f4a4537582708` |
| `survey/metrics/ws-movement-100c-1hz-after-realtime-2-1.prom` | `6a722c5067278ec38990783324abf0fd198acf0accd87ebbc901cac71fe30d6a` |
| `survey/metrics/ws-movement-100c-1hz-before-realtime-1.prom` | `2a15cb09bdbde16d07d213e1e1899930a974c721c194bd85b4158a0b624e7c74` |
| `survey/metrics/ws-movement-100c-1hz-before-realtime-2-1.prom` | `b18572d5b2e18d3c8e6499316a97c9f70e2a5fa85aebac05bf0bbe47b9c685c1` |
| `survey/metrics/ws-movement-100c-1hz-confirm-after-realtime-1.prom` | `0b650effee427531bad5c53f164fe3f1402bcff1ac3f1ea2bbc54d45aa851f2e` |
| `survey/metrics/ws-movement-100c-1hz-confirm-after-realtime-2-1.prom` | `a50d97eb27fb08e13be33da74e49983129b4780b65b68d17c6671a304a7260d1` |
| `survey/metrics/ws-movement-100c-1hz-confirm-before-realtime-1.prom` | `f0646a850fd04aaf4b3f7c7c0b660aadc5b1195eb9b5156aef957b8377e6f82c` |
| `survey/metrics/ws-movement-100c-1hz-confirm-before-realtime-2-1.prom` | `233a8fd5af483c7da3abdb335026e32ec5fb3cdc0b23c0509b2b8106a0705344` |
| `survey/metrics/ws-movement-100c-5hz-after-realtime-1.prom` | `6f324798992d5909e212636df7df8efba8eca59b169392afded264e6a844773f` |
| `survey/metrics/ws-movement-100c-5hz-after-realtime-2-1.prom` | `490ba3b79d8cdb7b4cd61b6462c29c52dd701fd561808894d446df7c3f9b7392` |
| `survey/metrics/ws-movement-100c-5hz-before-realtime-1.prom` | `ea4a0b9b700bd793c6b7c0080943c77433dfd3873724375d0b676f1b93fbefd3` |
| `survey/metrics/ws-movement-100c-5hz-before-realtime-2-1.prom` | `7238f7bbebafd708aa95833c710bc5008227dbdcf5547c83b71b253c96caf9ae` |
| `survey/metrics/ws-movement-10c-1hz-after-realtime-1.prom` | `223bbb3a8400a3bc06bdddd4dd82c279ffff0909ad2d6a2ea87264f06c7428af` |
| `survey/metrics/ws-movement-10c-1hz-after-realtime-2-1.prom` | `dd828544631dfe3f226b4eef0dc0ee3c2db1c68b47c82d6be5bfc9f5cdc58c14` |
| `survey/metrics/ws-movement-10c-1hz-before-realtime-1.prom` | `5e4808da33bd433301a8e24b43573404b2ad79f740868a2d5a494d9f8d447a60` |
| `survey/metrics/ws-movement-10c-1hz-before-realtime-2-1.prom` | `79de7efcaeb68ee18ba1ce33640ccab66be783dd01f2308249eadb96a8d10a28` |
| `survey/metrics/ws-movement-10c-20hz-policy-limit-after-realtime-1.prom` | `9b7d60e8e4afd64d8a27a45b38b4e0388704e0357c34a0048a355dabd1083ebc` |
| `survey/metrics/ws-movement-10c-20hz-policy-limit-after-realtime-2-1.prom` | `15d8883e9f4df42b93485f557ddce6eeab19f9ab00e8dd9379c808ecb5f2bfd3` |
| `survey/metrics/ws-movement-10c-20hz-policy-limit-before-realtime-1.prom` | `a702b348e19fb51771ea7141f4ff7f61c7bc9b638b47f40ac9990eb60b9d9b30` |
| `survey/metrics/ws-movement-10c-20hz-policy-limit-before-realtime-2-1.prom` | `2e9d9e336b6d4b9794aef5e183f323c535eac62236752d2d68e3cab9aff00c71` |
| `survey/metrics/ws-movement-300c-1hz-after-realtime-1.prom` | `b418c2fac9430445e2974f34c3a50ada74d83537af8816ccf3c4c34f48d58da7` |
| `survey/metrics/ws-movement-300c-1hz-after-realtime-2-1.prom` | `9b77db63db34b4b1f9f7797c8ef204f5c596b8e3b2fcca53faf25e4e3bed0d5d` |
| `survey/metrics/ws-movement-300c-1hz-before-realtime-1.prom` | `ac6e99d80008d6adf9f0f79cf432ab253646e5f644b63cbd52c24f834f4e4824` |
| `survey/metrics/ws-movement-300c-1hz-before-realtime-2-1.prom` | `dfd7f3208083f50992480b75437460b07ef62910f66f6b6fbf4332f66de45fed` |
| `survey/metrics/ws-movement-50c-1hz-after-realtime-1.prom` | `05069530500796c1e311fa3bd1a1ce85b594c0a28522cdd8ce8db6f7a547ef38` |
| `survey/metrics/ws-movement-50c-1hz-after-realtime-2-1.prom` | `b2c80a3e095b94abc533b6d3abb048b5ef39de3523a294ff61cac7858413660c` |
| `survey/metrics/ws-movement-50c-1hz-before-realtime-1.prom` | `ab05ac2c4e04e0257bfdfcb69082ca5c75cd24e3e2ece36b95bf51408d0ee31b` |
| `survey/metrics/ws-movement-50c-1hz-before-realtime-2-1.prom` | `ca5e74915d632c7543c65e1d829abb558b4574a542f4030985a2a3f91b75c8d4` |
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

## ③ 실기기 측정(`device-run/`) — 티켓 2250

실기기(iPhone 16 Pro Max·iOS 27.0.1·Wi-Fi)에서 개발 전용 앱 계기로 봇 5명과 공존해 잰 기록. 서버는 로컬 풀 스택(realtime 2270 jar)이고 **dev 가 아니다**. 방법·수치·함정은 [device-run/README.md](device-run/README.md), 해석은 [validation.md §7-3](../../validation.md).
