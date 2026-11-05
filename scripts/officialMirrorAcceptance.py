#!/usr/bin/env python3
"""Reproducible disposable module-06 acceptance; never reads a real env file.

Run prepare, integration, build, start, browser, contrast, http, stop-app, start, recover, typecheck, verify-source, stop, clean-source in that order. A run directory
under ignored coverage/ is mandatory for every phase after prepare. Only resources
created by prepare (and carrying this task's unique label) may be stopped.
"""
import argparse
import hashlib
import io
import json
import os
from pathlib import Path
import secrets
import shutil
import signal
import socket
import subprocess
import tarfile
import time
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('phase', choices=['prepare', 'integration', 'build', 'start', 'browser', 'http', 'contrast', 'recover', 'stop-app', 'snapshot', 'typecheck', 'verify-source', 'stop', 'clean-source'])
parser.add_argument('--run-dir', type=Path)
parser.add_argument('--suite', choices=['a-migration', 'a-reference', 'c-grant', 'd-merge', 'b-reopen'])
args = parser.parse_args()


def clean_env():
    keep = ['PATH', 'HOME', 'TMPDIR', 'LANG', 'LC_ALL', 'SHELL']
    return {k: os.environ[k] for k in keep if k in os.environ}


def run(cmd, name, cwd=None, env=None, data=None):
    if args.phase in ACTIVE_PHASES:
        verify_containers()
    if args.phase in SERVICE_PHASES:
        verify_services()
    print(f'RUN {name}: ' + ' '.join(map(str, cmd)), flush=True)
    result = subprocess.run(cmd, cwd=cwd or ROOT, env=env or clean_env(), input=data,
                            stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    existing = list(RUN.glob(name + '*.log'))
    log = RUN / (name + (f'-attempt{len(existing)+1}' if existing else '') + '.log')
    log.write_bytes(result.stdout)
    with (RUN / 'commands.jsonl').open('a') as out:
        out.write(json.dumps({'name': name, 'command': list(map(str, cmd)),
                              'cwd': str(cwd or ROOT), 'exitCode': result.returncode,
                              'log': str(log)}) + '\n')
    print(f'EXIT {result.returncode} LOG {log}', flush=True)
    if result.returncode:
        print(result.stdout.decode(errors='replace')[-9000:])
        raise SystemExit(result.returncode)
    return result.stdout


def write_state():
    path = RUN / 'state.json'
    path.write_text(json.dumps(state, indent=2) + '\n')
    path.chmod(0o600)


def dburl(role, name, port):
    return f'postgresql://{role}@127.0.0.1:{port}/{name}'


CONTAINER_PORTS = {'postgres': {'5432/tcp': [55432, 55443, 55435, 55436]},
                   'redis': {'6379/tcp': [56380]}}
ACTIVE_PHASES = {'integration', 'build', 'start', 'browser', 'http', 'contrast', 'recover'}
SERVICE_PHASES = {'browser', 'http', 'contrast', 'recover'}


def inspect_container(target):
    # Request identity metadata only: never read container environment variables.
    template = ('{"id":{{json .Id}},"name":{{json .Name}},'
                '"label":{{json (index .Config.Labels "official-mirror-acceptance")}},'
                '"running":{{json .State.Running}},"ports":{{json .NetworkSettings.Ports}}}')
    result = subprocess.run(['docker', 'inspect', '--format', template, target],
                            capture_output=True, text=True, env=clean_env(), timeout=3)
    if result.returncode:
        if 'No such object:' in result.stderr or 'No such container:' in result.stderr:
            return None
        raise RuntimeError('container identity cannot be inspected; refusing to assume absence')
    return json.loads(result.stdout)


def verify_container(key, allow_absent=False):
    identity = state.get('containerIds', {}).get(key)
    if not isinstance(identity, str) or len(identity) != 64 or any(c not in '0123456789abcdef' for c in identity):
        raise RuntimeError('container identity missing: prepare a new disposable run')
    by_name = inspect_container(state[key])
    by_id = inspect_container(identity)
    if by_name is None and by_id is None and allow_absent:
        return None
    if not by_name or not by_id:
        raise RuntimeError('container identity missing or replaced: ' + key)
    expected_ports = {internal: sorted(('127.0.0.1', str(port)) for port in ports)
                      for internal, ports in CONTAINER_PORTS[key].items()}
    for observed in [by_name, by_id]:
        actual_ports = {internal: sorted((p['HostIp'], p['HostPort']) for p in bindings)
                        for internal, bindings in observed['ports'].items() if bindings}
        if (observed['id'] != identity or observed['name'] != '/' + state[key]
                or observed['label'] != state['marker'] or actual_ports != expected_ports
                or not observed['running']):
            raise RuntimeError('container identity, label, running state or port mapping mismatch: ' + key)
    return identity


def verify_containers():
    for key in CONTAINER_PORTS:
        verify_container(key)


def process_identity(pid, role):
    result = subprocess.run(['ps', '-p', str(pid), '-o', 'pid=,pgid=,lstart='],
                            capture_output=True, text=True, env=dict(clean_env(), LC_ALL='C'), timeout=3)
    if result.returncode or not result.stdout.strip():
        raise RuntimeError('service identity: recorded process is absent')
    actual, pgid, started = result.stdout.strip().split(None, 2)
    cwd = subprocess.run(['lsof', '-a', '-p', str(pid), '-d', 'cwd', '-Fn'],
                         capture_output=True, text=True, env=clean_env(), timeout=3)
    if cwd.returncode or ('n' + str(source)) not in cwd.stdout.splitlines():
        raise RuntimeError('service identity: process cwd does not match this run')
    return {'pid': int(actual), 'pgid': int(pgid), 'started': started.strip(),
            'cwd': str(source), 'role': role}


def live_group_members(pgid):
    result = subprocess.run(['ps', '-ax', '-o', 'pid=,pgid=,stat='],
                            capture_output=True, text=True, env=clean_env(), timeout=3)
    if result.returncode:
        raise RuntimeError('service identity: process group cannot be inspected')
    # A zombie has exited and cannot perform I/O; its parent alone can reap it.
    return [int(pid) for pid, group, status in (line.split() for line in result.stdout.splitlines())
            if int(group) == pgid and not status.startswith('Z')]


def verify_process(pid):
    expected = state.get('processIdentities', {}).get(str(pid))
    if not expected or expected.get('pid') != pid or expected.get('pgid') != pid:
        raise RuntimeError('service identity: immutable process record is missing')
    actual = process_identity(pid, expected['role'])
    if actual != expected:
        raise RuntimeError('service identity: PID, process group, start time or cwd changed')
    for member in live_group_members(pid):
        process_identity(member, expected['role'])
    return expected


def verify_services():
    records = [verify_process(pid) for pid in state['createdProcesses']]
    if len(records) != 2 or {p['role'] for p in records} != {'application', 'services'}:
        raise RuntimeError('service identity: this run needs both recorded application and service groups')
    for record in records:
        port = 3100 if record['role'] == 'application' else 36741
        listeners = subprocess.run(['lsof', '-nP', '-iTCP:' + str(port), '-sTCP:LISTEN', '-t'],
                                   capture_output=True, text=True, env=clean_env(), timeout=3)
        owners = {int(pid) for pid in listeners.stdout.split()}
        if listeners.returncode or not owners or not owners.issubset(set(live_group_members(record['pgid']))):
            raise RuntimeError('service identity: listener does not belong to this run process group')
    with urllib.request.urlopen('http://127.0.0.1:36741/health', timeout=2) as response:
        if json.load(response).get('marker') != state['marker']:
            raise RuntimeError('service identity: controlled service run marker changed')


def register_process(process, role):
    state['createdProcesses'].append(process.pid)
    # Preserve the PID even if identity inspection fails: cleanup must not forget it.
    write_state()
    state['processIdentities'][str(process.pid)] = process_identity(process.pid, role)
    write_state()


def stop_processes(timeout=10):
    groups = list(state['createdProcesses'])
    if set(state.get('processIdentities', {})) - {str(pid) for pid in groups}:
        raise RuntimeError('service identity: process records are inconsistent; identities retained')
    # Preflight all groups before signaling any of them. PID reuse or cwd changes
    # cannot authorize a signal to an unknown process group.
    for pid in groups:
        if live_group_members(pid):
            verify_process(pid)
    for pid in groups:
        if live_group_members(pid):
            verify_process(pid)
            try:
                os.killpg(pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
    deadline = time.monotonic() + timeout
    while any(live_group_members(pid) for pid in groups):
        if time.monotonic() >= deadline:
            raise RuntimeError('process group did not exit after SIGTERM; identities retained, no escalation')
        time.sleep(.1)
    state['createdProcesses'] = []
    state['processIdentities'] = {}
    write_state()
    print('PASS all recorded process groups have exited before clearing identities', flush=True)


if args.phase == 'prepare':
    assert args.run_dir is None, 'prepare creates a new run; it cannot reset an existing one'
    marker = 'om06-' + time.strftime('%Y%m%d%H%M%S') + '-' + secrets.token_hex(3)
    RUN = ROOT / 'coverage' / marker
    RUN.mkdir(parents=True, exist_ok=False)
    sha = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    subprocess.run(['git', 'merge-base', '--is-ancestor', 'c34569c1', sha], cwd=ROOT, check=True)
    state = {'marker': marker, 'sourceSha': sha, 'source': str(RUN / 'source'),
             'postgres': marker + '-pg', 'redis': marker + '-redis',
             'ports': [55432, 55443, 55435, 55436, 56380, 3100, 36741],
             'jwt': secrets.token_hex(32), 'createdProcesses': [],
             'containerIds': {}, 'processIdentities': {}}
    write_state()
    for port in state['ports']:
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', port))
    source = Path(state['source'])
    source.mkdir()
    archive = subprocess.check_output(['git', 'archive', sha], cwd=ROOT)
    with tarfile.open(fileobj=io.BytesIO(archive)) as tar:
        safe = [m for m in tar.getmembers() if not m.issym() and not m.islnk()
                and not Path(m.name).name.startswith('.env') and Path(m.name).parts[0] != 'backup']
        assert all(not Path(m.name).is_absolute() and '..' not in Path(m.name).parts for m in safe)
        tar.extractall(source, members=safe)
    (source / 'node_modules').symlink_to(ROOT / 'node_modules', target_is_directory=True)
    write_state()
    created = run(['docker', 'run', '-d', '--name', state['postgres'], '--label', 'official-mirror-acceptance=' + marker,
         *[x for p in [55432, 55443, 55435, 55436] for x in ['-p', f'127.0.0.1:{p}:5432']],
         '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', '-e', 'POSTGRES_USER=official_mirror_owner',
         '-e', 'POSTGRES_DB=official_mirror_owner_e2e', '--tmpfs', '/var/lib/postgresql/data', 'postgres:16'], 'postgres-create')
    state['containerIds']['postgres'] = created.decode().strip()
    write_state()
    verify_container('postgres')
    created = run(['docker', 'run', '-d', '--name', state['redis'], '--label', 'official-mirror-acceptance=' + marker,
         '-p', '127.0.0.1:56380:6379', 'redis:7-alpine', 'redis-server', '--save', '', '--appendonly', 'no'], 'redis-create')
    state['containerIds']['redis'] = created.decode().strip()
    write_state()
    verify_containers()
    for _ in range(60):
        check = subprocess.run(['docker', 'exec', state['containerIds']['postgres'], 'pg_isready', '-h', '127.0.0.1', '-U', 'official_mirror_owner'],
                               capture_output=True, env=clean_env())
        if check.returncode == 0:
            break
        time.sleep(.3)
    else:
        raise RuntimeError('new disposable PostgreSQL did not become ready')
    databases = [('official_mirror_a', 'official_mirror_a_e2e'),
                 ('official_mirror_a', 'official_mirror_a_ref_e2e'),
                 ('official_mirror_c', 'official_mirror_c_e2e'),
                 ('official_mirror_d', 'official_mirror_d_e2e'),
                 ('official_mirror_b', 'official_mirror_b_reopen_e2e'),
                 ('official_mirror_e', 'official_mirror_e_ui_e2e')]
    roles = set()
    statements = []
    for role, database in databases:
        if role not in roles:
            statements.append(f'CREATE ROLE {role} LOGIN SUPERUSER;')
            roles.add(role)
        statements.append(f'CREATE DATABASE {database} OWNER {role};')
    verify_containers()
    run(['docker', 'exec', '-i', state['containerIds']['postgres'], 'psql', '-X', '-v', 'ON_ERROR_STOP=1',
         '-U', 'official_mirror_owner', '-d', 'official_mirror_owner_e2e'],
        'database-create', data='\n'.join(statements).encode())
    print('RUN_DIRECTORY ' + str(RUN), flush=True)
else:
    assert args.run_dir, '--run-dir required'
    RUN = args.run_dir.resolve()
    assert RUN.parent == ROOT / 'coverage' and RUN.name.startswith('om06-')
    state = json.loads((RUN / 'state.json').read_text())

source = Path(state['source'])
if source != RUN / 'source' or state['marker'] != RUN.name:
    raise RuntimeError('run directory identity mismatch')
if args.phase in ACTIVE_PHASES:
    verify_containers()
if args.phase in SERVICE_PHASES:
    verify_services()
# Copy only owned acceptance entrypoints and tests; application source stays at sourceSha.
for relative in ['scripts/officialMirrorAcceptanceNetwork.cjs', 'scripts/officialMirrorAcceptanceServices.mjs', 'tests/e2e/official-mirror-ui.browser.ts',
                 'tests/e2e/official-mirror-acceptance.e2e.ts', 'tests/e2e/official-mirror-http.e2e.ts', 'tests/e2e/official-mirror-contrast.e2e.ts', 'tests/integration/official-mirror-d-merge.test.ts', 'tests/integration/official-mirror-a-migration.test.ts']:
    origin = ROOT / relative
    if origin.is_file() and source.exists():
        target = source / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(origin, target)

env = clean_env()
env.update({
    'NODE_ENV': 'production', 'NEXT_TELEMETRY_DISABLED': '1',
    'NODE_OPTIONS': '--require=' + str(source / 'scripts/officialMirrorAcceptanceNetwork.cjs'),
    'KUN_DATABASE_URL': dburl('official_mirror_e', 'official_mirror_e_ui_e2e', 55436),
    'KUN_E2E_DATABASE_URL': dburl('official_mirror_e', 'official_mirror_e_ui_e2e', 55436),
    'KUN_E2E_REDIS_URL': 'redis://127.0.0.1:56380', 'KUN_E2E_BASE_URL': 'http://127.0.0.1:3100',
    'KUN_E2E_SOURCE_SHA': state['sourceSha'], 'KUN_E2E_ARTIFACT_DIR': str(RUN / 'artifacts'),
    'REDIS_HOST': '127.0.0.1', 'REDIS_PORT': '56380', 'REDIS_PASSWORD': '',
    'JWT_ISS': state['marker'], 'JWT_AUD': state['marker'], 'JWT_SECRET': state['jwt'],
    'KUN_VISUAL_NOVEL_SITE_URL': 'http://127.0.0.1:3100',
    'NEXT_PUBLIC_KUN_PATCH_ADDRESS_DEV': 'http://127.0.0.1:3100',
    'NEXT_PUBLIC_KUN_PATCH_ADDRESS_PROD': 'http://127.0.0.1:3100',
    'KUN_VISUAL_NOVEL_EMAIL_FROM': 'synthetic@example.invalid',
    'KUN_VISUAL_NOVEL_EMAIL_HOST': '127.0.0.1', 'KUN_VISUAL_NOVEL_EMAIL_PORT': '36741',
    'KUN_VISUAL_NOVEL_EMAIL_ACCOUNT': '', 'KUN_VISUAL_NOVEL_EMAIL_PASSWORD': '',
    'KUN_VISUAL_NOVEL_S3_STORAGE_ACCESS_KEY_ID': 'synthetic-test-only',
    'KUN_VISUAL_NOVEL_S3_STORAGE_SECRET_ACCESS_KEY': 'synthetic-test-only',
    'KUN_VISUAL_NOVEL_S3_STORAGE_BUCKET_NAME': 'synthetic',
    'KUN_VISUAL_NOVEL_S3_STORAGE_ENDPOINT': 'http://127.0.0.1:36741',
    'KUN_VISUAL_NOVEL_S3_STORAGE_REGION': 'us-east-1',
    'NEXT_PUBLIC_KUN_VISUAL_NOVEL_S3_STORAGE_URL': 'http://127.0.0.1:36741',
    'KUN_VISUAL_NOVEL_IMAGE_BED_HOST': 'example.invalid',
    'KUN_VISUAL_NOVEL_IMAGE_BED_URL': 'http://127.0.0.1:36741',
    'KUN_CF_CACHE_ZONE_ID': '', 'KUN_CF_CACHE_PURGE_API_TOKEN': '',
    'KUN_CF_CACHE_SITE_ZONE_ID': '', 'KUN_CF_CACHE_SITE_PURGE_API_TOKEN': '',
    'KUN_VISUAL_NOVEL_INDEX_NOW_KEY': '', 'KUN_ENABLE_CRON': 'false',
    'KUN_COMPANY_IDENTITY_RESOLVER_ENABLED': 'false',
    'KUN_STATIC_TAG_PREGEN_LIMIT': '0', 'KUN_STATIC_COMPANY_PREGEN_LIMIT': '0',
    'KUN_VISUAL_NOVEL_TEST_SITE_LABEL': 'DISPOSABLE OFFICIAL MIRROR ACCEPTANCE',
    'HOSTNAME': '127.0.0.1', 'PORT': '3100', 'AWS_EC2_METADATA_DISABLED': 'true',
    'KUN_LINK_CHECKER_ENDPOINT': 'http://127.0.0.1:36741',
    'KUN_LINK_CHECKER_API_KEY': 'synthetic-test-only',
    'KUN_ACCEPTANCE_MARKER': state['marker'], 'KUN_ACCEPTANCE_SERVICE_LOG': str(RUN / 'synthetic-services.jsonl'),
})


def psql(database, text, name, variables=None):
    verify_containers()
    run(['docker', 'exec', '-i', state['containerIds']['postgres'], 'psql', '-X', '-v', 'ON_ERROR_STOP=1',
         '-U', 'official_mirror_owner', '-d', database,
         *[x for k, v in (variables or {}).items() for x in ['-v', k + '=' + v]]], name, data=text)


def schema(role, database, port):
    scoped = dict(env, KUN_DATABASE_URL=dburl(role, database, port))
    run(['pnpm', 'exec', 'prisma', 'db', 'push'], database + '-schema', cwd=source, env=scoped)
    decisions = {'stamp_confirmed': 'none', 'stamp_rejected': 'none', 'small_stamp_review': 'acknowledged'}
    for phase in ['sync', 'postflight']:
        psql(database, (source / f'migration/production-official-mirror-{phase}-2026-11-04.sql').read_bytes(),
             database + '-' + phase, decisions)
    run(['pnpm', 'exec', 'esno', 'migration/ensurePatchCounters.ts'], database + '-counters', cwd=source, env=scoped)


if args.phase == 'integration':
    for role, database, port in [('official_mirror_c', 'official_mirror_c_e2e', 55435),
                                 ('official_mirror_d', 'official_mirror_d_e2e', 55443),
                                 ('official_mirror_b', 'official_mirror_b_reopen_e2e', 55436)]:
        if not args.suite or args.suite == {'official_mirror_c':'c-grant', 'official_mirror_d':'d-merge', 'official_mirror_b':'b-reopen'}[role]:
            schema(role, database, port)
    batches = [
        ('a-migration', 'official-mirror-a-migration.test.ts', {'KUN_OFFICIAL_MIRROR_A_TEST_DATABASE_URL': dburl('official_mirror_a', 'official_mirror_a_e2e', 55432), 'KUN_OFFICIAL_MIRROR_A_PG_CONTAINER': state['containerIds']['postgres']}),
        ('a-reference', 'official-mirror-a-file-cleanup-ref.test.ts', {'KUN_OFFICIAL_MIRROR_A_REF_DATABASE_URL': dburl('official_mirror_a', 'official_mirror_a_ref_e2e', 55432), 'KUN_OFFICIAL_MIRROR_A_REF_PG_CONTAINER': state['containerIds']['postgres']}),
        ('c-grant', 'official-mirror-c-grant-merge.integration.test.ts', {'OFFICIAL_MIRROR_C_DATABASE_URL': dburl('official_mirror_c', 'official_mirror_c_e2e', 55435)}),
        ('d-merge', 'official-mirror-d-merge.test.ts', {'KUN_OFFICIAL_MIRROR_D_TEST_DATABASE_URL': dburl('official_mirror_d', 'official_mirror_d_e2e', 55443), 'KUN_OFFICIAL_MIRROR_D_TEST_PORT': '55443'}),
        ('b-reopen', 'official-mirror-handover-reopen-race.test.ts', {'KUN_OFFICIAL_MIRROR_B_REOPEN_TEST_DATABASE_URL': dburl('official_mirror_b', 'official_mirror_b_reopen_e2e', 55436)}),
    ]
    for name, filename, specific in batches:
        if args.suite and args.suite != name:
            continue
        run(['pnpm', 'exec', 'vitest', 'run', 'tests/integration/' + filename, '--reporter=verbose'], name,
            cwd=source, env=dict(env, NODE_ENV='test', **specific))
elif args.phase == 'snapshot':
    archive = subprocess.check_output(['git', 'archive', state['sourceSha']], cwd=ROOT)
    with tarfile.open(fileobj=io.BytesIO(archive)) as tar:
        safe = [m for m in tar.getmembers() if not m.issym() and not m.islnk() and not Path(m.name).name.startswith('.env') and Path(m.name).parts[0] != 'backup']
        assert all(not Path(m.name).is_absolute() and '..' not in Path(m.name).parts for m in safe)
        tar.extractall(source, members=safe)
    print('PASS rematerialized complete tracked source without sensitive files')
elif args.phase == 'build':
    schema('official_mirror_e', 'official_mirror_e_ui_e2e', 55436)
    psql('official_mirror_e_ui_e2e', b'''INSERT INTO public."user" (name,email,password,role,enable_email_notice,updated)
VALUES ('e2e_admin','admin@example.invalid','not-used',4,false,CURRENT_TIMESTAMP) ON CONFLICT (name) DO NOTHING;
INSERT INTO public.patch (unique_id,name,user_id,type,language,engine,platform,updated)
SELECT 'e2e00001','E2E Rewrite Fixture',id,ARRAY[]::text[],ARRAY[]::text[],ARRAY[]::text[],ARRAY[]::text[],CURRENT_TIMESTAMP
FROM public."user" WHERE name='e2e_admin' ON CONFLICT (unique_id) DO NOTHING;''', 'browser-fixture')
    run(['pnpm', 'build'], 'production-build', cwd=source, env=env)
elif args.phase == 'verify-source':
    roots = {'app', 'components', 'lib', 'types', 'validations', 'hooks', 'utils', 'prisma', 'constants', 'config', 'middleware', 'styles'}
    root_files = {'middleware.ts', 'next.config.ts', 'package.json', 'pnpm-lock.yaml', 'tsconfig.json', 'vitest.config.ts'}
    archive = subprocess.check_output(['git', 'archive', state['sourceSha']], cwd=ROOT)
    manifest = {}
    with tarfile.open(fileobj=io.BytesIO(archive)) as tar:
        for member in tar.getmembers():
            if not member.isfile() or (Path(member.name).parts[0] not in roots and member.name not in root_files):
                continue
            expected = tar.extractfile(member).read()
            actual = (source / member.name).read_bytes()
            assert actual == expected, 'application source differs from sourceSha: ' + member.name
            manifest[member.name] = hashlib.sha256(actual).hexdigest()
    (RUN / 'source-manifest.json').write_text(json.dumps({'sourceSha': state['sourceSha'], 'files': manifest,
        'applicationFileCount': len(manifest), 'buildId': (source / '.next/BUILD_ID').read_text().strip()}, indent=2) + '\n')
    print('PASS ' + str(len(manifest)) + ' application source files exactly match sourceSha')
elif args.phase == 'clean-source':
    assert not state['createdProcesses'] and not state.get('processIdentities'), 'stop this run before removing its source snapshot'
    assert source == RUN / 'source' and RUN.parent == ROOT / 'coverage'
    for key in ['postgres', 'redis']:
        assert verify_container(key, allow_absent=True) is None, 'stop this run containers before source cleanup'
    shutil.rmtree(source)
    state['sourceRemoved'] = True
    write_state()
    print('PASS removed this run source/build snapshot; artifacts retained and root test discovery restored')
elif args.phase == 'recover':
    pending = json.loads((RUN / 'artifacts/pending-restart.json').read_text())
    assert pending['marker'] == state['marker'] and pending['sourceSha'] == state['sourceSha']
    assert state['createdProcesses'] and pending['appPidsBeforeRestart'] != state['createdProcesses'], 'restart this run application before recovery'
    job, resource = pending['jobId'], pending['resourceId']
    assert isinstance(job, int) and job > 0 and isinstance(resource, int) and resource > 0
    run(['pnpm', 'exec', 'esno', 'scripts/replayResourceFileCleanup.ts', '--confirm-database', 'official_mirror_e_ui_e2e', '--ids', str(job)], 'restart-replay', cwd=source, env=env)
    psql('official_mirror_e_ui_e2e', (f"""DO $$$$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM patch_resource_file_cleanup WHERE id={job} AND status='completed') THEN RAISE EXCEPTION 'job not completed'; END IF;
      IF NOT EXISTS (SELECT 1 FROM patch_resource WHERE id={resource} AND publisher_left_at IS NOT NULL) THEN RAISE EXCEPTION 'handover lost'; END IF;
      IF (SELECT COUNT(*) FROM admin_log WHERE type='resource_handover' AND content LIKE '资源 {resource} 已交由站方维护%') <> 1 THEN RAISE EXCEPTION 'handover repeated'; END IF;
      END $$$$;""".replace('$$$$', '$$')).encode(), 'restart-replay-postflight')
    (RUN / 'artifacts/restart-recovery.json').write_text(json.dumps({'passed': True, 'marker': state['marker'], 'sourceSha': state['sourceSha'], 'jobId': job, 'resourceId': resource, 'newAppPids': state['createdProcesses']}, indent=2) + '\n')
    print('PASS durable handover cleanup replay after actual application process exit and restart')
elif args.phase == 'typecheck':
    run(['pnpm', 'typecheck'], 'typecheck', cwd=source, env=env)
elif args.phase == 'start':
    if state['createdProcesses'] or state.get('processIdentities'):
        raise RuntimeError('This run still has a created process; stop it before starting another')
    for port in [3100, 36741]:
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', port))
    service_log = (RUN / 'synthetic-server.log').open('ab')
    service = subprocess.Popen(['node', str(source / 'scripts/officialMirrorAcceptanceServices.mjs')], cwd=source, env=env, stdout=service_log, stderr=subprocess.STDOUT, start_new_session=True)
    register_process(service, 'services')
    for _ in range(40):
        try:
            with urllib.request.urlopen('http://127.0.0.1:36741/health', timeout=1) as response:
                assert json.load(response)['marker'] == state['marker']
                break
        except OSError:
            time.sleep(.1)
    else:
        raise RuntimeError('controlled storage/checker did not become ready')
    log = (RUN / 'server.log').open('ab')
    child = subprocess.Popen(['pnpm', 'exec', 'next', 'start', '--hostname', '127.0.0.1', '--port', '3100'],
                             cwd=source, env=env, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
    register_process(child, 'application')
    for _ in range(120):
        if child.poll() is not None:
            raise RuntimeError('isolated Next server exited; inspect server.log')
        try:
            with urllib.request.urlopen('http://127.0.0.1:3100/api/patch?uniqueId=e2e00001', timeout=2) as response:
                body = json.load(response)
                assert body['name'] == 'E2E Rewrite Fixture'
                verify_services()
                print('PASS run process identities, cwd, listeners, marker and synthetic database sentinel', flush=True)
                break
        except (OSError, ValueError):
            time.sleep(.5)
    else:
        raise RuntimeError('isolated Next server readiness timeout')
elif args.phase in ['browser', 'http', 'contrast']:
    # Browser script intentionally compares its URL with a non-matching default sentinel.
    browser_env = dict(env, KUN_DATABASE_URL=dburl('official_mirror_owner', 'never_connect_default', 1))
    script = {'browser':'official-mirror-acceptance.e2e.ts', 'http':'official-mirror-http.e2e.ts', 'contrast':'official-mirror-contrast.e2e.ts'}[args.phase]
    run(['pnpm', 'exec', 'esno', 'tests/e2e/' + script], args.phase, cwd=source, env=browser_env)
    if args.phase == 'http':
        pending_path = RUN / 'artifacts/pending-restart.json'
        pending = json.loads(pending_path.read_text())
        pending['appPidsBeforeRestart'] = state['createdProcesses']
        pending_path.write_text(json.dumps(pending, indent=2) + '\n')
elif args.phase in ['stop', 'stop-app']:
    # Verify all container identities before stopping any resources. Missing own
    # containers are harmless during cleanup; replacement names are never adopted.
    for key in CONTAINER_PORTS:
        verify_container(key, allow_absent=True)
    stop_processes()
    for key in ([] if args.phase == 'stop-app' else ['postgres', 'redis']):
        identity = verify_container(key, allow_absent=True)
        if identity:
            run(['docker', 'rm', '-f', identity], key + '-remove')
