# 부하테스트 대시보드 (GROMO-548 M9)

서버 개발자용 딸깍 UI — 트리거·히스토리·판정·baseline diff. 백엔드 없음(정적 SPA).
시계열 심층분석은 Grafana(관측 VM :3000).

## 실행

```bash
make dashboard            # loadtest/ 에서 — npm install + vite dev
# 또는
cd loadtest/dashboard && npm install && npm run dev
```

브라우저에서 fine-grained PAT 1회 등록(권한: Actions rw · Contents r) → localStorage 저장.

## 동작

- **트리거**: `POST /actions/workflows/loadtest.yml/dispatches` (ref=main — WIF 신뢰 조건)
- **히스토리**: workflow runs API, 10초 폴링
- **판정·diff**: `loadtest-reports` 브랜치의 `runs/<name>/verdict.json` (Contents API, CORS 안전)

## 명시적 비범위 (PRD §6-4)

호스팅(GCS 정적)·서버 컴포넌트·Grafana 임베드(링크로 대체)·run 취소·스케줄링·알림·멀티 baseline.
