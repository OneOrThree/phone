import importlib.util
import io
import os
from pathlib import Path
import unittest
from unittest import mock

spec = importlib.util.spec_from_file_location('smoke_docker', Path(__file__).with_name('dev-smoke-docker-V2.py'))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class SmokeDockerTest(unittest.TestCase):
    def test_host_by_container(self):
        self.assertEqual(m.host_for(['inspect', 'catus-dev-app-v2-app-1']), 'catus-dev-v2-app')
        self.assertEqual(m.host_for(['exec', '-i', 'catus-dev-redis-v2-shared-1', 'redis-cli']), 'catus-dev-v2-redis')
        self.assertEqual(m.host_for(['inspect', 'catus-dev-kafka-v2-kafka-1']), 'catus-dev-v2-data')
        self.assertEqual(m.host_for(['exec', '-i', 'catus-dev-postgres-v2-postgres-1', 'psql']), 'catus-dev-v2-data')
        self.assertEqual(m.host_for(['image', 'inspect', 'sha256:abc']), 'catus-dev-v2-app')

    def test_unknown_container_rejected(self):
        with self.assertRaises(ValueError): m.host_for(['inspect', 'phone-data-api'])

    def test_only_read_and_exec_commands(self):
        for args in (['rm', '-f', 'x'], ['compose', 'down'], ['image', 'rm', 'x']):
            with self.assertRaises(ValueError): m.remote_command(args, None)

    def test_arguments_quoted(self):
        command = m.remote_command(['exec', 'catus-dev-postgres-v2-postgres-1', 'sh', '-c', 'printf "%s" "$POSTGRES_USER"'], None)
        self.assertIn("'printf \"%s\" \"$POSTGRES_USER\"'", command)
        self.assertTrue(command.startswith('sudo docker exec'))

    def test_password_goes_through_stdin_only(self):
        args = ['exec', '-i', '-e', m.AUTH, 'catus-dev-redis-v2-shared-1', 'redis-cli']
        stdin = mock.Mock(buffer=io.BytesIO(b'GET k\n'))
        with mock.patch.dict(os.environ, {m.AUTH: 'hunter2'}), mock.patch.object(m.sys, 'stdin', stdin), \
                mock.patch.object(m.subprocess, 'run', return_value=mock.Mock(returncode=0)) as run:
            self.assertEqual(m.main(args), 0)
        self.assertEqual(run.call_args.kwargs['input'], b'hunter2\nGET k\n')
        self.assertNotIn('hunter2', ' '.join(run.call_args.args[0]))


if __name__ == '__main__':
    unittest.main()
