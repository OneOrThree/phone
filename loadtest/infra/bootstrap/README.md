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

무료체험 상한(동시 8 vCPU) 안의 예산: **SUT n2d-standard-2(2) + 관측 e2-small(2) + 부하
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

## 4. 전용 `loadtest` 러너 (GROMO-752 — terraform 관리 온디맨드 spot)

부하 run은 러너를 점유하므로 dev 러너와 **별개**의 전용 러너를 둔다. 수동 등록 대신 **gromo-stress
안의 spot MIG**(`terraform/runner.tf`)로 관리하고, 유휴 비용 0을 위해 **온디맨드**(MIG `target_size=0`
→ `make runner-up`/`runner-down`)로 운용한다. 등록 크리덴셜은 dev CI 러너와 **같은 GitHub App**
(`oneorthree/ci-runner`)을 재사용하되 값만 이 프로젝트 Secret Manager 에 넣는다 — WIF 는 job→GCP
인증일 뿐, 러너 등록은 VM→GitHub 라 GitHub 크리덴셜이 별도로 필요하기 때문.

### 4-1. 등록 크리덴셜 주입 (수동 1회)

ci-runner GitHub App 정보를 JSON 으로 `loadtest-runner-gh-app` 시크릿에 넣는다(App ID/PEM 은 dev
AWS SM `oneorthree/ci-runner` 값과 동일). 시크릿 **컨테이너는 terraform 이 생성**하므로 값만 추가:

```bash
cat > /tmp/gh-app.json <<'JSON'
{"GITHUB_APP_ID":"<app id>","INSTALLATION_ID":"<installation id>",
 "GITHUB_APP_PEM":"-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----",
 "RUNNER_ORG":"OneOrThree","RUNNER_REPO":"phone"}
JSON
gcloud secrets versions add loadtest-runner-gh-app --data-file=/tmp/gh-app.json --project=<project>
rm /tmp/gh-app.json
```

### 4-2. 러너 인프라 생성 (terraform)

```bash
cd ../terraform
terraform apply -var "project_id=<project>" -var "enable_runner=true"
```

→ spot 인스턴스 템플릿 + MIG(`loadtest-runner`, `target_size=0`) 생성. 이 시점엔 VM 0대(비용 0).

### 4-3. 온디맨드 기동/정리

```bash
make runner-up   PROJECT_ID=<project>   # MIG→1, 러너 자가등록(~1-2분, 라벨 self-hosted,loadtest)
# ... 대시보드 딸깍 / make test ...
make runner-down PROJECT_ID=<project>   # MIG→0 (유휴 비용 0)

gh api repos/OneOrThree/phone/actions/runners --jq '.runners[]|[.name,.status]'   # 등록 확인
```

러너 VM 이 startup 에서 자동 설치하는 도구: `docker`·`terraform`·`gcloud`·`node`(20)·`make`·`git`·`gh`·`gettext`·`jq`·`python3` + actions-runner 런타임 의존성(`installdependencies.sh`).
선점(spot) 시 MIG 가 재시작→startup 재실행으로 재등록. offline 잔재 러너는 startup 이 정리.

## 5. 완료 판정

- [ ] `bootstrap.sh` 재실행 시 전부 "(skip)" 출력 (멱등 확인)
- [ ] `check-quota.sh` ✅ 통과
- [ ] GitHub Variables 4종 등록
- [ ] (러너, §4) `loadtest-runner-gh-app` 주입 + `enable_runner=true` apply → `make runner-up` 시 `loadtest` 러너 Online
- [ ] 콘솔 Billing에 budget alert 4단계 표시

## 트러블슈팅

- **`billing budgets create` 실패**: 계정에 Billing Account Administrator 권한이 없으면 콘솔에서
  수동 생성 (https://console.cloud.google.com/billing/budgets, 금액 $300·임계 25/50/75/90%).
- **API 활성화 타임아웃**: 신규 프로젝트 직후엔 전파 지연이 있음 — 1~2분 뒤 재실행(멱등).
- **WIF 인증 실패 (워크플로우)**: `attribute-condition`이 **레포명 + ref**를 요구
  (`OneOrThree/phone` @ `refs/heads/main`) — loadtest.yml 은 **main 브랜치에서 dispatch**해야
  토큰이 발급된다. 레포 조건만 두면 "PR로 워크플로우를 추가할 수 있는 누구나"가 SA를 가장할 수
  있어 ref 조건으로 이중 한정했다. 포크/레포 이름·브랜치 정책 변경 시 프로바이더 재생성 필요.
