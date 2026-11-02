"""앱 버전 태그(GROMO-2731) — 다음 버전 계산과 게시 전 검사."""
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('app_version', Path(__file__).with_name('app-version.py'))
version = importlib.util.module_from_spec(spec)
spec.loader.exec_module(version)

TAGS = {'app-2.3.2-android-753', 'app-2.3.3-android-760', 'app-2.3.0-ios-41', 'app-1.1.0-7', 'backoffice-v1.0.5-V2'}


class AppVersionTests(unittest.TestCase):
    def test_next_is_patch_after_latest_tag_of_same_platform(self):
        self.assertEqual(version.next_version(TAGS, 'android', '2.3.2'), '2.3.4')
        self.assertEqual(version.next_version(TAGS, 'ios', '2.3.0'), '2.3.1')

    def test_floor_is_used_before_first_tag_and_for_minor_major(self):
        self.assertEqual(version.next_version(set(), 'android', '2.3.2'), '2.3.2')
        self.assertEqual(version.next_version(TAGS, 'android', '2.4.0'), '2.4.0')
        # 숫자로 비교한다 — 문자열이면 2.3.10 이 2.3.9 보다 작다
        self.assertEqual(version.next_version({'app-2.3.9-android-1', 'app-2.3.10-android-2'}, 'android', '2.3.0'), '2.3.11')

    def test_check_blocks_same_or_lower_version_but_allows_rerun_of_tagged_build(self):
        version.check(TAGS, 'android', '2.3.4', '761')
        version.check(TAGS, 'android', '2.3.3', '760')  # 이미 단 태그 = 같은 게시의 재실행
        version.check(set(), 'android', '2.3.2', '753')
        for name, build in (('2.3.3', '761'), ('2.3.0', '770')):
            with self.subTest(name=name), self.assertRaisesRegex(ValueError, '직전 앱 태그 2.3.3'):
                version.check(TAGS, 'android', name, build)
        with self.assertRaisesRegex(ValueError, 'X.Y.Z'):
            version.check(TAGS, 'android', '2.3', '761')

    def test_ls_remote_output_keeps_annotated_tag_names_once(self):
        output = ('a\trefs/tags/app-2.3.2-android-753\n'
                  'b\trefs/tags/app-2.3.2-android-753^{}\n'
                  'c\trefs/tags/app-2.3.0-ios-41\n')
        self.assertEqual(version.names_from_ls_remote(output), {'app-2.3.2-android-753', 'app-2.3.0-ios-41'})


if __name__ == '__main__':
    unittest.main()
