"""Run migrations/API contracts and a restore drill against a disposable PostgreSQL.

Requires local PostgreSQL 17 binaries and installed repository dependencies.
Copies the API to a temporary directory without .env; never uses configured databases.
"""
from pathlib import Path
import os
import shutil
import socket
import subprocess
import tempfile
import time
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
PG = Path(os.environ.get('CAREER_PG_BIN', '/usr/local/opt/postgresql@17/bin'))
NODE = shutil.which('node')
if not NODE or not (PG / 'initdb').is_file():
    raise SystemExit('Missing node or PostgreSQL binaries')
if not (ROOT / 'node_modules/pg').is_dir():
    raise SystemExit('Install locked dependencies first')


def free_port():
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        return sock.getsockname()[1]


with tempfile.TemporaryDirectory(prefix='dnd-career-', dir='/private/tmp') as directory:
    temp = Path(directory)
    source = temp / 'repo'
    source.mkdir()
    shutil.copytree(ROOT / 'server', source / 'server', ignore=shutil.ignore_patterns('node_modules', '.env*'))
    (source / 'node_modules').symlink_to(ROOT / 'node_modules', target_is_directory=True)
    for name in ('package.json', 'release.json'):
        shutil.copy2(ROOT / name, source / name)
    shutil.copytree(ROOT / 'scripts', source / 'scripts')
    mutation = os.environ.get('CAREER_EXPECT_BOLA_REGRESSION') == '1'
    if mutation:
        target = source / 'server/src/characters.js'
        original = target.read_text()
        needle = 'WHERE id = $1 AND owner_id = $2'
        assert needle in original, 'Missing authorization mutation anchor'
        target.write_text(original.replace(needle, 'WHERE id = $1 AND ($2::bigint IS NOT NULL)', 1))
    data = temp / 'pgdata'
    pg_port, api_port = free_port(), free_port()
    env = dict(os.environ, NODE_ENV='test', HOST='127.0.0.1', PORT=str(api_port), DATABASE_SSL='false',
               DATABASE_URL=f'postgresql://127.0.0.1:{pg_port}/dnd_career_test',
               API_BASE=f'http://127.0.0.1:{api_port}',
               CORS_ORIGINS='https://localhost,http://localhost:5173,http://127.0.0.1:4173',
               JWT_SECRET='isolated-local-test-only-' * 4)
    # Prevent inherited connection settings from selecting any other server/user.
    for key in list(env):
        if key.startswith('PG'):
            del env[key]

    def run(args, capture=False):
        print('+', ' '.join(map(str, args)), flush=True)
        return subprocess.run(list(map(str, args)), cwd=source, env=env, check=True,
                              text=True, capture_output=capture)

    started = False
    api = None
    try:
        run([PG / 'initdb', '-D', data, '-A', 'trust', '--no-locale'])
        run([PG / 'pg_ctl', '-D', data, '-l', temp / 'postgres.log', '-o',
             f'-h 127.0.0.1 -p {pg_port} -k {temp}', '-w', 'start'])
        started = True
        common = ['-h', '127.0.0.1', '-p', str(pg_port)]
        run([PG / 'createdb', *common, 'dnd_career_test'])
        run([NODE, 'server/scripts/migrate.js'])
        run([NODE, 'server/scripts/test-migrations.js'])
        with (temp / 'api.log').open('w') as log:
            api = subprocess.Popen([NODE, 'server/src/server.js'], cwd=source, env=env, stdout=log, stderr=log)
        for attempt in range(80):
            if api.poll() is not None:
                raise RuntimeError((temp / 'api.log').read_text())
            try:
                with urllib.request.urlopen(env['API_BASE'] + '/ready', timeout=1) as response:
                    if response.status == 200:
                        break
            except OSError:
                time.sleep(0.25)
        else:
            raise RuntimeError('Test API readiness timed out')
        for script in ('smoke-auth.js', 'smoke-friends.js'):
            run([NODE, 'server/scripts/' + script])
        if mutation:
            result = subprocess.run([NODE, 'server/scripts/test-access-security.js'], cwd=source, env=env,
                                    text=True, capture_output=True)
            print(result.stdout, flush=True)
            print(result.stderr, flush=True)
            assert result.returncode != 0 and '200 !== 404' in result.stdout + result.stderr, (
                'BOLA mutation was not detected by its expected assertion')
            print('PASS: real API BOLA regression detected in a temporary source copy', flush=True)
            raise SystemExit(0)
        run([NODE, 'server/scripts/test-access-security.js'])
        if os.environ.get('CAREER_RUN_UI') == '1':
            shutil.copytree(ROOT / 'mobile', source / 'mobile',
                            ignore=shutil.ignore_patterns('node_modules', 'dist', 'android', 'ios', '.env*'))
            shutil.copytree(ROOT / 'tests', source / 'tests')
            config = (ROOT / 'playwright.config.js').read_text()
            chrome = os.environ.get('CAREER_CHROME', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
            assert Path(chrome).is_file(), 'Missing explicit local Chrome executable'
            import json
            config = config.replace("trace: 'retain-on-failure',",
                                    "trace: 'retain-on-failure', launchOptions: { executablePath: " + json.dumps(chrome) + ' },')
            (source / 'playwright.config.js').write_text(config)
            env.update(VITE_API_BASE='http://127.0.0.1:4173', VITE_API_PROXY_TARGET=env['API_BASE'])
            run([NODE, str(ROOT / 'node_modules/vite/bin/vite.js'), 'build', '--config', 'mobile/vite.config.js', 'mobile'])
            run([NODE, str(ROOT / 'node_modules/@playwright/test/cli.js'), 'test', '--workers=1'])
        run([PG / 'psql', *common, '-d', 'dnd_career_test', '-v', 'ON_ERROR_STOP=1', '-c',
             "INSERT INTO users(username,password_hash) VALUES ('restore_test_fixture','test-only-not-a-login-hash')"])
        dump = temp / 'backup.dump'
        run([PG / 'pg_dump', *common, '-Fc', '-f', dump, 'dnd_career_test'])
        run([PG / 'createdb', *common, 'dnd_restore_test'])
        run([PG / 'pg_restore', *common, '--exit-on-error', '-d', 'dnd_restore_test', dump])
        query = "SELECT username,password_hash FROM users ORDER BY username; SELECT version FROM schema_migrations ORDER BY version;"
        before = run([PG / 'psql', *common, '-d', 'dnd_career_test', '-At', '-c', query], True).stdout
        after = run([PG / 'psql', *common, '-d', 'dnd_restore_test', '-At', '-c', query], True).stdout
        assert before == after and 'restore_test_fixture' in after, 'Restore data verification failed'
        print('PASS: migration, auth, friends, access/concurrency contracts and test-data backup/restore', flush=True)
    finally:
        if api is not None:
            api.terminate()
            try:
                api.wait(timeout=10)
            except subprocess.TimeoutExpired:
                api.kill()
                api.wait()
        if started:
            run([PG / 'pg_ctl', '-D', data, '-m', 'fast', '-w', 'stop'])
