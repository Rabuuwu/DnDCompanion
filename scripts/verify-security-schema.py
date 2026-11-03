"""Verify migrations and quota/session invariants in a disposable offline cluster.

Uses PostgreSQL single-user mode, without sockets, .env or existing databases.
This does not replace concurrent HTTP/API integration tests.
"""
from pathlib import Path
import os
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
PG = Path(os.environ.get('CAREER_PG_BIN', '/usr/local/opt/postgresql@17/bin'))
if not (PG / 'initdb').is_file() or not (PG / 'postgres').is_file():
    raise SystemExit('Missing local PostgreSQL binaries')

env = {key: value for key, value in os.environ.items() if not key.startswith('PG')}
with tempfile.TemporaryDirectory(prefix='dnd-security-schema-', dir='/private/tmp') as directory:
    data = Path(directory) / 'data'
    initialized = subprocess.run([str(PG / 'initdb'), '-D', str(data), '-A', 'trust', '--no-locale', '--encoding=UTF8'],
                                 env=env, capture_output=True, text=True)
    if initialized.returncode:
        raise SystemExit(initialized.stdout + initialized.stderr)

    def sql(statement, database='dnd_security_test'):
        # -j uses semicolon + two newlines as delimiter, without SQL awareness.
        # Remove empty lines so whole migration/function bodies reach the parser.
        statement = '\n'.join(line for line in statement.splitlines() if line.strip())
        result = subprocess.run([str(PG / 'postgres'), '--single', '-D', str(data), '-j', database],
                                input=statement + '\n', env=env, capture_output=True, text=True)
        output = result.stdout + result.stderr
        if result.returncode or any(level in output for level in ('ERROR:', 'FATAL:', 'PANIC:')):
            raise RuntimeError(output)
        return output

    sql('CREATE DATABASE dnd_security_test;', 'postgres')
    migrations = sorted((ROOT / 'server/migrations').glob('*.sql'))
    for migration in migrations:
        sql(migration.read_text())
    print(f'PASS: all {len(migrations)} migrations applied to an empty disposable cluster')

    sql("""
DO $$
DECLARE account_id BIGINT; sid UUID := '00000000-0000-4000-8000-000000000001';
BEGIN
  INSERT INTO users(username,password_hash) VALUES ('security_fixture','test-only') RETURNING id INTO account_id;
  INSERT INTO auth_sessions(id,user_id,expires_at) VALUES (sid,account_id,NOW()+INTERVAL '1 day');
  INSERT INTO refresh_tokens(user_id,session_id,token_hash,expires_at)
    VALUES (account_id,sid,repeat('a',64),NOW()+INTERVAL '1 day');
  IF NOT EXISTS (SELECT 1 FROM auth_sessions WHERE id=sid AND revoked_at IS NULL AND expires_at>NOW()) THEN
    RAISE EXCEPTION 'active session missing';
  END IF;
  UPDATE auth_sessions SET revoked_at=NOW() WHERE id=sid;
  IF EXISTS (SELECT 1 FROM auth_sessions WHERE id=sid AND revoked_at IS NULL AND expires_at>NOW()) THEN
    RAISE EXCEPTION 'revoked session accepted';
  END IF;
  INSERT INTO characters(owner_id,name) SELECT account_id,'quota fixture' FROM generate_series(1,100);
  BEGIN
    INSERT INTO characters(owner_id,name) VALUES (account_id,'over quota');
    RAISE EXCEPTION 'quota did not reject row 101';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
  DELETE FROM characters WHERE id=(SELECT min(id) FROM characters WHERE owner_id=account_id);
  INSERT INTO characters(owner_id,name) VALUES (account_id,'reclaimed slot');
  DELETE FROM users WHERE id=account_id;
  IF EXISTS (SELECT 1 FROM auth_sessions WHERE user_id=account_id) OR
     EXISTS (SELECT 1 FROM refresh_tokens WHERE user_id=account_id) THEN
    RAISE EXCEPTION 'session cascade failed';
  END IF;
END $$;
""")
    print('PASS: session revocation, account deletion cascade, quota enforcement and slot reuse')
