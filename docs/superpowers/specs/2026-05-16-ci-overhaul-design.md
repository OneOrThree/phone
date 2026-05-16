---
title: CI 워크플로우 개편 설계
date: 2026-05-16
status: approved
---

## 배경

현재 CI 상태:
- 워크플로우 1개 (`api-doc.yml`) 만 존재
- 테스트 완전 스킵 (`./gradlew build -x test`)
- PR 체크 없음 (lint, test 전무)
- concurrency 제어 없음
- 모든 `uses:` 버전 태그 고정 (SHA 핀 없음)

## 목표

- PR마다 lint + test 자동 실행
- 연속 push 시 마지막 실행만 유지 (비용 절감)
- 보안 강화 (최소 권한, SHA 핀)
- 프론트엔드 추가 시 확장 가능한 구조

## 파일 구조

```
.github/workflows/
├── backend-ci.yml      ← PR 트리거, back/** 변경 감지
└── api-doc.yml         ← main/develop push, api/** 변경 감지 (기존 개선)
```

프론트엔드 추가 시 `frontend-ci.yml` 파일만 추가하면 됨.

## backend-ci.yml

### 트리거

```yaml
on:
  pull_request:
    paths:
      - 'back/**'
      - '.github/workflows/backend-ci.yml'
```

`back/**` 외 변경(문서, 루트 설정 등)만 있는 PR은 CI 스킵.  
워크플로우 파일 자체 수정도 감지해 검증.

### Concurrency

```yaml
concurrency:
  group: backend-ci-${{ github.ref }}
  cancel-in-progress: true
```

PR에 연속 push 시 이전 실행 취소, 마지막만 실행.

### 권한

```yaml
permissions:
  contents: read
```

최소 권한. 쓰기 권한 불필요.

### Jobs (병렬)

**`lint` job**
- `./gradlew checkstyleMain checkstyleTest` — 코드 스타일
- `./gradlew spotbugsMain` — 버그 패턴 정적 분석
- `timeout-minutes: 10`

**`test` job**
- `./gradlew test` — 전체 테스트 실행
  - ArchUnit 테스트 포함 (레이어 아키텍처 검증)
  - Testcontainers 포함 (PostgreSQL 통합 테스트)
- `timeout-minutes: 15`
- ubuntu-latest 사용 (Docker 내장 → Testcontainers 별도 설정 불필요)

두 job은 `needs` 의존 없이 병렬 실행. lint 실패가 test를 막지 않음.

### Gradle 의존성 추가 필요

`build.gradle`에 아래 추가:

```groovy
plugins {
    id 'checkstyle'
    id 'com.github.spotbugs' version 'x.x.x'
}

dependencies {
    testImplementation 'com.tngtech.archunit:archunit-junit5:1.3.0'
}
```

Checkstyle 규칙 파일: `config/checkstyle/checkstyle.xml`

## api-doc.yml 개선

### 트리거에 paths 추가

```yaml
on:
  push:
    branches: [ main, develop ]
    paths:
      - 'back/src/main/java/**/api/**'
      - '.github/workflows/api-doc.yml'
```

`service/`, `repository/` 등 API 스펙에 영향 없는 변경 시 스킵.

### 보안 강화

- 모든 `uses:` 버전 태그 → SHA 핀으로 교체
- `permissions` 블록 추가:

```yaml
permissions:
  contents: write   # gh-pages 배포
  pages: write
```

기존 비즈니스 로직(OpenAPI 생성 → gh-pages 배포 → Slack → Apidog 동기화)은 그대로 유지.

## 보안 체크리스트

- [ ] 모든 `uses:` SHA 핀 적용
- [ ] 각 워크플로우 `permissions: contents: read` 기본값
- [ ] `timeout-minutes` 모든 job에 명시
- [ ] fork PR은 GitHub 기본 정책으로 secrets 차단 (별도 설정 불필요)

## 적용 범위 밖 (나중에)

- Claude AI PR 리뷰 연동
- SonarCloud / OIDC (배포 파이프라인 생길 때)
- Self-hosted runner (팀 규모 커질 때)
- DORA 메트릭 수집
