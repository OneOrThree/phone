#!/usr/bin/env python3
"""위성 실행 범위 판정을 «표»로 고정한다 (GROMO-1918).

이 판정은 CI 비용을 직접 정한다 — `True` 하나가 서비스 전체 빌드(도커 이미지 + gradle build)를
켜고 러너 슬롯을 몇 분씩 문다. 그래서 「어떤 변경이 무엇을 켜는가」를 눈으로 읽히는 표로 두고
바뀌면 테스트가 깨지게 한다.

실제로 겪은 일: 워크플로 한 줄만 고친 PR 이 business-api·notification **전체 빌드**를 켰다.
`.github/**` 가 「분류 안 된 경로」로 떨어져 안전한 쪽(전부 검사)으로 escalate 했기 때문이다.
"""
import importlib.util
import pathlib
import unittest

_PLAN = pathlib.Path(__file__).with_name('satellite-ci-plan.py')
_spec = importlib.util.spec_from_file_location('satellite_ci_plan', _PLAN)
plan_module = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(plan_module)

BUSINESS = 'business-api'
NOTIFICATION = 'notification'


class SatelliteCiPlanTest(unittest.TestCase):
    def assert_plan(self, paths, business, notification):
        got = plan_module.plan(paths)
        self.assertEqual(
            (got[BUSINESS], got[NOTIFICATION]), (business, notification),
            f'변경 경로 {paths} 의 실행 범위가 표와 다르다')

    # ── 서비스 소스가 바뀌면 그 서비스만 ─────────────────────────────────────
    def test_서비스_소스는_그_서비스만_켠다(self):
        self.assert_plan(['server/business-api/src/Main.java'], True, False)
        self.assert_plan(['server/notification/src/Main.java'], False, True)
        self.assert_plan(['server/business-api/a', 'server/notification/b'], True, True)

    # ── 계약 검사만 돌리면 되는 것 ───────────────────────────────────────────
    def test_data_api_변경은_전체_빌드를_켜지_않는다(self):
        # 계약 검사(체크섬·공개 명령)는 workflow 가 별도로 계속 돌린다.
        self.assert_plan(['server/data-api/src/Main.java'], False, False)

    def test_문서_앱_realtime_은_켜지_않는다(self):
        self.assert_plan(['docs/prd/fishcat/x.md'], False, False)
        self.assert_plan(['app/app-dev/src/x.ts'], False, False)
        self.assert_plan(['server/realtime/src/x.java'], False, False)
        self.assert_plan(['README.md'], False, False)

    def test_위성과_무관한_github_변경은_켜지_않는다(self):
        """이 줄이 GROMO-1918 의 핵심이다 — 여기가 True 로 돌아가면 그때 그 사고가 재발한다."""
        self.assert_plan(['.github/workflows/dev-ci.yml'], False, False)
        self.assert_plan(['.github/workflows/app-lint.yml'], False, False)
        self.assert_plan(['.github/scripts/check-satellite-contracts.py'], False, False)

    # ── 그래도 전체를 켜야 하는 것 ───────────────────────────────────────────
    def test_빌드_방식을_바꾸는_입력은_전체를_켠다(self):
        """빌드가 바뀌었으면 그 빌드가 실제로 도는지 증명해야 한다."""
        self.assert_plan(['.github/workflows/satellite-ci.yml'], True, True)
        self.assert_plan(['.github/scripts/satellite-ci-plan.py'], True, True)
        self.assert_plan(['.github/scripts/check-migration-checksum.py'], True, True)
        self.assert_plan(['.github/actions/ci-jar/action.yml'], True, True)

    def test_루트_설정_파일은_전체를_켜지_않는다(self):
        """PR #790 이 여기서 샜다 — docs 만 바꿨는데 .gitignore 한 줄이 전체 빌드를 켰다."""
        self.assert_plan(['.gitignore'], False, False)
        self.assert_plan(['.gitattributes'], False, False)
        self.assert_plan(['.editorconfig'], False, False)

    def test_서비스_안의_같은_이름_파일은_그_서비스를_켠다(self):
        """루트 예외가 서비스 안까지 번지면 그 서비스 빌드가 통째로 빠진다."""
        self.assert_plan(['server/business-api/.gitignore'], True, False)
        self.assert_plan(['server/notification/README.md'], False, True)

    def test_분류하지_않은_경로는_안전한_쪽으로_간다(self):
        self.assert_plan(['server/scripts/docker-compose.dev.yml'], True, True)
        self.assert_plan(['newthing/x'], True, True)

    def test_변경_목록이_비면_전부_검사한다(self):
        """판정에 실패했을 때 «검사를 건너뛰는» 쪽으로 기울지 않는다."""
        self.assert_plan([], True, True)


if __name__ == '__main__':
    unittest.main()
