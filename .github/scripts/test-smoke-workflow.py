#!/usr/bin/env python3
"""배포 이미지 커밋과 검사 코드 커밋을 분리하는 워크플로 계약을 검증한다."""
from pathlib import Path
import re
import unittest


class SmokeWorkflowTests(unittest.TestCase):
    def test_old_image_revision_does_not_select_old_smoke_source(self):
        workflow = (Path(__file__).parents[1] / 'workflows' / 'ops-smoke.dev.yml').read_text()
        refs = re.findall(r'^\s+ref:\s*(.+)$', workflow, re.MULTILINE)
        self.assertEqual(len(refs), 4)
        self.assertTrue(all(ref == '${{ github.sha }}' for ref in refs))
        self.assertIn('DEPLOY_REVISION: ${{ inputs.deploy_revision }}', workflow)


if __name__ == '__main__':
    unittest.main()
