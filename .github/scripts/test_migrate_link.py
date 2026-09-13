from __future__ import annotations

import argparse
import importlib.util
import os
from pathlib import Path
from unittest import TestCase, mock

SCRIPT = Path(__file__).resolve().parents[2] / 'server/scripts/migrate-link.py'
SPEC = importlib.util.spec_from_file_location('migrate_link', SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class LinkMigrationProtocolTest(TestCase):
    def setUp(self):
        self.env = mock.patch.dict(os.environ, {'BATCH_ADMIN_KEY': 'operator-fixture',
                                               'LINK_MIGRATION_TOKEN': 'migration-fixture',
                                               'SVC_TOKEN_DATA_TO_LINK': 'relay-fixture'})
        self.env.start()
        self.addCleanup(self.env.stop)
        self.args = argparse.Namespace(step='import', data_url='http://data.invalid',
            link_url='http://link.invalid', migration_id='migration-1', batch_size=2, source_drained=False)
        self.manifest = dict(migrationId='migration-1', expectedClicks=2, sourceChecksum='click-digest',
            expectedLinks=1, linkChecksum='link-digest', importClosed=False)
        self.calls = []

    def request(self, base, path, token, body=None):
        self.calls.append((base, path, token, body))
        if path.endswith('/manifest'):
            return self.manifest
        if '/invite-links?' in path:
            return {'items': [{'source': {'linkId': 'zero-click-link'}, 'sourceChecksum': 'link'}], 'nextCursor': None}
        if '/clicks?' in path:
            return {'items': [{'source': {'clickId': i}, 'sourceChecksum': str(i)} for i in (1, 2)], 'nextCursor': None}
        return {'verified': 2}

    def test_zero_click_links_are_imported_before_clicks_and_keep_frozen_manifest(self):
        result = MODULE.transfer(self.args, self.request)
        batches = [body for _, path, _, body in self.calls if path == '/internal/migration/import']
        self.assertEqual(result['imported'], {'links': 1, 'clicks': 2})
        self.assertEqual(len(batches), 3)
        self.assertEqual(batches[0]['links'], [])
        self.assertEqual(batches[1]['links'][0]['source']['linkId'], 'zero-click-link')
        self.assertEqual(len(batches[2]['clicks']), 2)
        self.assertTrue(all(b['linkChecksum'] == 'link-digest' for b in batches))
        self.assertTrue(all(token == 'migration-fixture' for base, _, token, _ in self.calls
                            if base == self.args.link_url))

    def test_timeout_batches_split_without_changing_source_and_do_not_close(self):
        accepted = []
        def constrained(base, path, token, body=None):
            if body and len(body.get('clicks', [])) > 1:
                raise MODULE.TransferError('POST /internal/migration/import: HTTP 503')
            if body:
                accepted.extend(body.get('clicks', []))
            return self.request(base, path, token, body)
        MODULE.transfer(self.args, constrained)
        self.assertEqual([r['source']['clickId'] for r in accepted], [1, 2])
        self.assertFalse(any('/close' in path for _, path, _, _ in self.calls))

    def test_failed_link_close_never_closes_data_and_retry_closes_in_order(self):
        self.args.step = 'close'
        def failed(base, path, token, body=None):
            if path == '/internal/migration/close':
                raise MODULE.TransferError('verification failed')
            return self.request(base, path, token, body)
        with self.assertRaises(MODULE.TransferError):
            MODULE.transfer(self.args, failed)
        self.assertFalse(any(path.endswith('/close-import') for _, path, _, _ in self.calls))
        self.calls.clear()
        MODULE.transfer(self.args, self.request)
        self.assertEqual([path for _, path, _, _ in self.calls][-2:], [
            '/internal/migration/close', '/internal/migrations/migration-1/invite-link-clicks/close-import'])

    def test_freeze_requires_explicit_drain_and_redirects_never_forward_tokens(self):
        self.args.step = 'freeze'
        with self.assertRaises(MODULE.TransferError):
            MODULE.transfer(self.args, self.request)
        self.assertEqual(self.calls, [])
        self.assertIsNone(MODULE.NoRedirect().redirect_request(None, None, 302, '', {}, 'http://elsewhere.invalid'))
