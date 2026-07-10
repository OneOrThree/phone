# GCP 부트스트랩 (1회) — GROMO-548

부하테스트 전용 GCP 프로젝트를 제로부터 준비하는 절차. 스크립트가 하는 일과 **사람이 해야 하는
수동 단계**를 구분해 적는다. 전부 끝나면 `make infra-up`(Terraform)으로 넘어간다.

## 0. 사전 준비 (수동)

1. **gcloud CLI 설치·로그인**
   ```bash
   brew install --cask google-cloud-sdk   # 미설치 시
   gcloud auth login                       # 브라우저 인증 (Claude 세션에선 `! gcloud auth login`)
   gcloud auth application-default login   # Terraform용 ADC
   ```
2. **무료체험 시작 + 빌링 계정 확인** — https://console.cloud.google.com 에서 무료체험($300/90일)
   활성화 후:
   ```bash
   gcloud billing accounts list    # ACCOUNT_ID (XXXXXX-XXXXXX-XXXXXX) 확인
   ```
3. 로컬 도구: `terraform`, `python3` (check-quota가 사용), `gh` (러너 등록 시 편의).

## 1. bootstrap.sh 실행

```bash
PROJECT_ID=gromo-loadtest-1 \
BILLING_ACCOUNT_ID=XXXXXX-XXXXXX-XXXXXX \
./bootstrap.sh
```

멱등이라 재실행 안전. 수행 내용: 프로젝트 생성 → 빌링 연결 → API 활성화 → TF 상태 버킷
(`gs://<project>-tf-state`, 버저닝) → `loadtest-runner` SA + 역할 → **WIF**(GitHub OIDC,
`OneOrThree/phone` 레포 한정 신뢰) → **budget alert**($300의 25/50/75/90%).

끝나면 GitHub Variables에 넣을 4개 값을 출력한다 (아래 §3).

> **SA 권한 메모**: 전용 프로젝트라 admin 계열 역할을 허용했고(blast radius = 이 프로젝트),
> VM들도 같은 SA로 실행하는 MVP 단순화를 택했다. dev/prod 자격증명과는 완전 분리 —
> **AWS dev 시크릿은 어떤 것도 복사하지 않는다.**

## 2. check-quota.sh 실행

```bash
PROJECT_ID=gromo-loadtest-1 ./check-quota.sh
```

무료체험 상한(동시 8 vCPU) 안의 예산: **SUT n2-standard-2(2) + 관측 e2-small(2) + 부하
c2-standard-4 spot(4) = 8**. C2 쿼터가 없으면 부하 VM을 `n2-highcpu-4`로 폴백한다(Terraform
변수). Cloud SQL vCPU는 Compute 쿼터와 별도.

## 3. GitHub 레포 설정 (수동)

`Settings → Secrets and variables → Actions → Variables`:

| Variable | 값 (bootstrap.sh 출력) |
|---|---|
| `GCP_PROJECT_ID` | `gromo-loadtest-1` |
| `GCP_WIF_PROVIDER` | `projects/<번호>/locations/global/workloadIdentityPools/github-pool/providers/github-provider` |
| `GCP_SA_EMAIL` | `loadtest-runner@<project>.iam.gserviceaccount.com` |
| `GCP_REGION` | `asia-northeast3` |

시크릿(PAT 등)은 불필요 — 워크플로우는 WIF 단명 토큰만 사용한다.

## 4. 전용 `loadtest` 러너 등록 (수동, dev 서버에서)

부하 run은 수십 분~수 시간 러너를 점유하므로, **기존 dev 러너와 별개 프로세스**를 등록해
`cd.yml` 배포 큐를 막지 않게 한다.

```bash
# dev 서버 ssh 후 — 새 토큰은 GitHub Settings → Actions → Runners → New self-hosted runner에서
mkdir -p ~/actions-runner-loadtest && cd ~/actions-runner-loadtest
# (러너 바이너리 다운로드/압축해제 — GitHub 안내 페이지의 명령 그대로)
./config.sh --url https://github.com/OneOrThree/phone --token <등록토큰> \
  --name dev-loadtest --labels self-hosted,loadtest --unattended
sudo ./svc.sh install && sudo ./svc.sh start
```

러너 사전 요구 도구 (run 오케스트레이션이 사용): `gcloud`(+`gke-gcloud-auth-plugin` 불필요),
`terraform`, `make`, `node`(≥20), `python3`, `docker`. 등록 후 확인:

```bash
gh api repos/OneOrThree/phone/actions/runners --jq '.runners[].labels[].name'
```

## 5. 완료 판정

- [ ] `bootstrap.sh` 재실행 시 전부 "(skip)" 출력 (멱등 확인)
- [ ] `check-quota.sh` ✅ 통과
- [ ] GitHub Variables 4종 등록
- [ ] `loadtest` 라벨 러너 Online
- [ ] 콘솔 Billing에 budget alert 4단계 표시

## 트러블슈팅

- **`billing budgets create` 실패**: 계정에 Billing Account Administrator 권한이 없으면 콘솔에서
  수동 생성 (https://console.cloud.google.com/billing/budgets, 금액 $300·임계 25/50/75/90%).
- **API 활성화 타임아웃**: 신규 프로젝트 직후엔 전파 지연이 있음 — 1~2분 뒤 재실행(멱등).
- **WIF 인증 실패 (워크플로우)**: `attribute-condition`이 **레포명 + ref**를 요구
  (`OneOrThree/phone` @ `refs/heads/main`) — loadtest.yml 은 **main 브랜치에서 dispatch**해야
  토큰이 발급된다. 레포 조건만 두면 "PR로 워크플로우를 추가할 수 있는 누구나"가 SA를 가장할 수
  있어 ref 조건으로 이중 한정했다. 포크/레포 이름·브랜치 정책 변경 시 프로바이더 재생성 필요.
