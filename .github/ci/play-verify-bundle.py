#!/usr/bin/env python3
"""versionCode 재사용은 같은 업로드 바이트일 때만 허용한다."""
import hashlib
import os
from pathlib import Path
from play_api import Play


def verify(bundles, codes, want, digest):
    existing = [bundle for bundle in bundles if int(bundle['versionCode']) == want]
    if existing:
        if len(existing) != 1 or existing[0].get('sha256', '').lower() != digest:
            raise ValueError('동일 versionCode에 다른 AAB가 있음. CD의 게시 job만 재실행하거나 새 CI를 실행할 것')
        return True
    if codes and want <= max(codes):
        raise ValueError('Play 기존 versionCode보다 작음. ANDROID_VERSION_CODE_BASE를 올리고 새 CI를 실행할 것')
    return False


def main():
    want = int(os.environ['VERSION_CODE'])
    with Path(os.environ['AAB_FILE']).open('rb') as file:
        digest = hashlib.file_digest(file, 'sha256').hexdigest()
    play = Play(os.environ['PLAY_SERVICE_ACCOUNT_FILE'], os.environ['PLAY_PACKAGE_NAME'])
    with play.read_edit() as eid:
        bundles = play.call('GET', f'/edits/{eid}/bundles').get('bundles', [])
        apks = play.call('GET', f'/edits/{eid}/apks').get('apks', [])
        tracks = play.call('GET', f'/edits/{eid}/tracks').get('tracks', [])
    codes = [int(item['versionCode']) for item in [*bundles, *apks]]
    codes += [int(code) for track in tracks for release in track.get('releases', []) for code in release.get('versionCodes', [])]
    present = verify(bundles, codes, want, digest)
    with open(os.environ['GITHUB_OUTPUT'], 'a') as file:
        file.write('present=' + str(present).lower() + '\n')
    if os.environ.get('REQUIRE_PRESENT') == '1' and not present:
        raise ValueError('Play 게시 후 동일 SHA-256의 AAB를 확인하지 못함')


if __name__ == '__main__':
    main()
