#!/usr/bin/env python3
"""Restore only the explicitly authorized dump into a new, networkless container.

Never loads dotenv, echoes dump SQL, retains raw SQL errors, or connects host PG.
Raw restore and migration copies remain inaccessible from host TCP and browsers.
"""
import argparse
import gzip
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import stat
import subprocess
import sys
import time
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
LABEL = 'official-mirror-dump-acceptance'
DATABASE = 'otoame_om06_dump'
IMAGE = 'postgres:18-alpine'
docker_binding = None


def environment():
    # Selection variables are consumed once by the local metadata resolver. No
    # Docker endpoint, TLS, or config override reaches a daemon command.
    return {k: os.environ[k] for k in ('PATH', 'HOME', 'TMPDIR', 'LANG', 'LC_ALL') if k in os.environ}


def docker_probe(command, name, metadata=False):
    child_env = environment()
    if metadata and 'DOCKER_CONFIG' in os.environ:
        child_env['DOCKER_CONFIG'] = os.environ['DOCKER_CONFIG']
    result = subprocess.run(command, capture_output=True, env=child_env, timeout=15)
    record(name, command, result.returncode, diagnosticsSuppressed=True)
    if result.returncode:
        raise RuntimeError(name.replace('-', '_') + '_failed')
    return result.stdout


def local_socket_identity(endpoint):
    # A loopback TCP address still selects a network transport. Only an actual
    # filesystem Unix socket owned by this user or root is accepted here.
    if os.name != 'posix' or not isinstance(endpoint, str) or not endpoint.startswith('unix:///'):
        raise RuntimeError('docker_endpoint_nonlocal_or_unknown_transport_refused')
    if '%' in endpoint or any(ord(c) < 33 or ord(c) == 127 for c in endpoint):
        raise RuntimeError('docker_endpoint_invalid_local_address')
    parsed = urlsplit(endpoint)
    if parsed.scheme != 'unix' or parsed.netloc or parsed.query or parsed.fragment or not parsed.path.startswith('/'):
        raise RuntimeError('docker_endpoint_invalid_local_address')
    try:
        path = Path(parsed.path).resolve(strict=True)
        metadata = path.lstat()
    except (OSError, RuntimeError):
        raise RuntimeError('docker_endpoint_local_socket_unverifiable') from None
    if not stat.S_ISSOCK(metadata.st_mode) or metadata.st_uid not in (0, os.geteuid()):
        raise RuntimeError('docker_endpoint_local_socket_unverifiable')
    return dict(endpoint='unix://' + str(path), socketDevice=metadata.st_dev,
                socketInode=metadata.st_ino, socketUid=metadata.st_uid)


def daemon_identity(endpoint):
    output = docker_probe(['docker', '--host', endpoint, 'info', '--format', '{{json .ID}}'],
                          'docker-daemon-identity')
    try:
        identity = json.loads(output)
    except (ValueError, UnicodeError):
        raise RuntimeError('docker_daemon_identity_invalid') from None
    if not isinstance(identity, str) or not re.fullmatch('[A-Za-z0-9][A-Za-z0-9:._-]{0,127}', identity):
        raise RuntimeError('docker_daemon_identity_invalid')
    return identity


def resolve_docker_binding():
    # Context metadata commands never contact a daemon. Honor Docker's actual
    # precedence, including a custom config directory, without reading config.
    context = os.environ.get('DOCKER_CONTEXT')
    if context:
        selection = 'context_environment'
    elif os.environ.get('DOCKER_HOST'):
        socket = local_socket_identity(os.environ['DOCKER_HOST'])
        return dict(socket, daemonId=daemon_identity(socket['endpoint']), selection='host_environment')
    else:
        selection = 'current_context'
        context = docker_probe(['docker', 'context', 'show'], 'docker-context-selection', metadata=True).decode().strip()
    if not re.fullmatch('[A-Za-z0-9][A-Za-z0-9_.-]{0,127}', context):
        raise RuntimeError('docker_context_selection_invalid')
    output = docker_probe(['docker', 'context', 'inspect', '--format', '{{json .Endpoints.docker.Host}}', context],
                          'docker-context-endpoint', metadata=True)
    try:
        endpoint = json.loads(output)
    except (ValueError, UnicodeError):
        raise RuntimeError('docker_context_endpoint_invalid') from None
    socket = local_socket_identity(endpoint)
    return dict(socket, daemonId=daemon_identity(socket['endpoint']), selection=selection, context=context)


def check_docker_binding():
    if docker_binding is None:
        raise RuntimeError('docker_endpoint_binding_required')
    actual = local_socket_identity(docker_binding['endpoint'])
    if any(actual[key] != docker_binding[key] for key in actual):
        raise RuntimeError('docker_local_socket_identity_changed')
    if daemon_identity(actual['endpoint']) != docker_binding['daemonId']:
        raise RuntimeError('docker_daemon_identity_changed')


def pin_docker(command):
    if command[0] != 'docker':
        return command
    check_docker_binding()
    # Callers supply subcommands only; an existing host/context option is never
    # allowed to compete with the endpoint established before reading input.
    if len(command) < 2 or command[1].startswith('-'):
        raise RuntimeError('docker_command_endpoint_override_refused')
    return ['docker', '--host', docker_binding['endpoint'], *command[1:]]


def bind_docker(allow_new=False):
    global docker_binding
    docker_binding = None
    resolved = resolve_docker_binding()
    expected = state.get('dockerEndpoint')
    if expected is None and not allow_new:
        raise RuntimeError('docker_endpoint_binding_required')
    if expected is not None and any(resolved.get(key) != expected.get(key) for key in
                                    ('endpoint', 'socketDevice', 'socketInode', 'socketUid', 'daemonId')):
        raise RuntimeError('docker_endpoint_binding_mismatch')
    docker_binding = resolved


def bind_local_environment():
    # Adoption of an older retained run is explicit and read-only: verify both
    # container names on the local daemon, then inspect only database settings.
    identity = verify()
    settings = query('postgres', "SELECT d.datname database,coalesce('default_transaction_read_only=on'=ANY(s.setconfig),false) default_read_only FROM pg_database d LEFT JOIN pg_db_role_setting s ON s.setdatabase=d.oid AND s.setrole=0 WHERE d.datname IN (" + ','.join("'" + d + "'" for d in state['databases'] if d != 'postgres') + ") ORDER BY d.datname", 'local-binding-readonly-settings')
    expected = set(state['databases']) - {'postgres'}
    if {row['database'] for row in settings} != expected or not all(row['default_read_only'] for row in settings):
        raise RuntimeError('retained_database_readonly_settings_mismatch')
    evidence = RUN / ('local-endpoint-binding-' + str(time.time_ns()) + '.json')
    save(evidence, dict(binding=docker_binding, container=identity, databaseSettings=settings,
                        readOnlyVerification=True, historicalEndpointNotIndependentlyProven=True))
    state['dockerEndpoint'] = dict(docker_binding)
    write_state()
    print(json.dumps(dict(localEndpointVerified=True, containerIdentityVerified=True,
                          readOnlyDatabases=len(settings), historicalEndpointNotIndependentlyProven=True)))


def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def save(path, value):
    with path.open('x', encoding='utf-8') as stream:
        os.chmod(path, 0o600)
        json.dump(value, stream, indent=2, ensure_ascii=False)
        stream.write('\n')


def record(name, command, code, **metadata):
    with (RUN / 'commands.jsonl').open('a', encoding='utf-8') as out:
        os.chmod(RUN / 'commands.jsonl', 0o600)
        out.write(json.dumps(dict(name=name, command=command, exitCode=code, **metadata)) + '\n')


def execute(command, name, data=None, timeout=180):
    command = pin_docker(command)
    result = subprocess.run(command, input=data, capture_output=True, env=environment(), timeout=timeout)
    # stdout/stderr may contain private COPY rows. Only callers of trusted JSON
    # catalog queries may decode stdout, and raw diagnostics never leave memory.
    codes = sorted(set(re.findall(rb'(?:ERROR|FATAL):\s+([A-Z0-9]{5})(?:\s|$)', result.stderr)))
    locations = sorted(set(int(n) for n in re.findall(rb'(?:<stdin>|-):(\d+):\s+(?:ERROR|FATAL):', result.stderr)))
    record(name, command, result.returncode, sqlStates=[c.decode('ascii') for c in codes], errorLines=locations,
           diagnosticsSuppressed=True, inputSha256=hashlib.sha256(data).hexdigest() if data is not None else None)
    return result


def inspect(container):
    template = ('{"id":{{json .Id}},"name":{{json .Name}},"imageId":{{json .Image}},'
                '"running":{{json .State.Running}},"started":{{json .State.StartedAt}},'
                '"label":{{json (index .Config.Labels "' + LABEL + '")}},'
                '"network":{{json .HostConfig.NetworkMode}},"ports":{{json .HostConfig.PortBindings}},'
                '"mounts":{{json .Mounts}},"readonly":{{json .HostConfig.ReadonlyRootfs}},'
                '"privileged":{{json .HostConfig.Privileged}},"caps":{{json .HostConfig.CapDrop}},'
                '"security":{{json .HostConfig.SecurityOpt}},"user":{{json .Config.User}},"tmpfs":{{json .HostConfig.Tmpfs}}}')
    result = execute(['docker', 'inspect', '--format', template, container], 'inspect-container')
    if result.returncode:
        raise RuntimeError('container_inspection_failed')
    return json.loads(result.stdout)


def verify(require_running=True):
    expected = state['containerId']
    if not re.fullmatch('[0-9a-f]{64}', expected):
        raise RuntimeError('container_id_invalid')
    for target in (expected, state['containerName']):
        actual = inspect(target)
        if (actual['id'] != expected or actual['name'] != '/' + state['containerName']
                or actual['label'] != state['marker'] or (require_running and not actual['running'])
                or actual['network'] != 'none' or actual['ports'] not in (None, {})
                or actual['imageId'] != state['imageId'] or not actual['readonly']
                or actual['privileged'] or actual['user'] != 'postgres'
                or actual['caps'] != ['ALL'] or 'no-new-privileges' not in actual['security']
                or any(m['Type'] != 'tmpfs' for m in actual['mounts'])
                or not actual.get('tmpfs')
                or actual['tmpfs'] != state.get('tmpfs')):
            raise RuntimeError('container_identity_or_isolation_mismatch')
    return actual


def psql(database, variables=None):
    if database not in state['databases']:
        raise RuntimeError('unregistered_database_refused')
    return ['docker', 'exec', '-i', state['containerId'], 'psql', '-X', '-qAt', '-U', 'postgres', '-d', database,
            '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=sqlstate', '-P', 'pager=off'] + [v for k, val in (variables or {}).items() for v in ('-v', k + '=' + val)]


def sql(database, text, name, variables=None, expect=0):
    verify()
    result = execute(psql(database, variables) + ['-f', '-'], name, data=text.encode())
    if expect is not None and result.returncode != expect:
        raise RuntimeError(name + '_unexpected_exit_' + str(result.returncode))
    return result


def query(database, text, name):
    wrapped = "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SET LOCAL statement_timeout='30s'; SET LOCAL lock_timeout='2s';\nSELECT row_to_json(safe_row)::text FROM (" + text.strip().rstrip(';') + ") safe_row;\nROLLBACK;"
    result = sql(database, wrapped, name)
    try:
        return [json.loads(line) for line in result.stdout.splitlines() if line.strip()]
    except (ValueError, UnicodeError):
        raise RuntimeError('json_query_protocol_failed') from None


def write_state():
    path = RUN / 'state.json'
    temp = RUN / 'state.next.json'
    if temp.exists():
        raise RuntimeError('state_update_collision')
    save(temp, state)
    temp.replace(path)


def clone(source, target):
    if target in state['databases']:
        raise RuntimeError('database_already_registered')
    if target not in ('otoame_om06_migrated_dump','otoame_om06_mechanism_dump','otoame_om06_recovery_dump','otoame_om06_lock_dump'):
        raise RuntimeError('invalid_clone_name')
    sql('postgres', 'CREATE DATABASE ' + target + ' TEMPLATE ' + source + ';', 'clone-' + target)
    state['databases'].append(target)
    write_state()


def prepare():
    check_docker_binding()
    if INPUT.parent != ROOT or INPUT.suffixes[-2:] != ['.sql','.gz']:
        raise RuntimeError('explicit_root_sql_gzip_input_required')
    info = INPUT.lstat()
    if not stat.S_ISREG(info.st_mode) or INPUT.is_symlink():
        raise RuntimeError('authorized_input_must_be_regular_nonsymlink')
    identity = dict(file=INPUT.name, bytes=info.st_size, sha256=digest(INPUT), filenameTimeIsProvenance=False,
                    originalSourceVerified=False, collectedAtVerified=False)
    unpacked_bytes = 0
    # gzip checksum/trailer validation only; no raw contents are decoded or saved.
    with gzip.open(INPUT, 'rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            unpacked_bytes += len(block)
    with gzip.open(INPUT, 'rb') as stream:
        header = stream.read(8)
    custom = header.startswith(b'PGDMP')
    identity.update(gzipIntegrity=True, uncompressedBytes=unpacked_bytes,
                    archiveFormat='postgres-custom' if custom else 'plain-sql',
                    archiveVersion=list(header[5:8]) if custom else None)
    save(RUN / 'input.json', identity)
    image = execute(['docker', 'image', 'inspect', '--format', '{{.Id}}', IMAGE], 'image-identity')
    if image.returncode:
        raise RuntimeError('local_image_unavailable')
    state.update(imageId=image.stdout.decode().strip(), input=identity, tmpfs={
        '/var/lib/postgresql':'rw,noexec,nosuid,size=1g,uid=70,gid=70,mode=0700',
        '/var/run/postgresql':'rw,noexec,nosuid,size=32m,uid=70,gid=70,mode=0700',
        '/tmp':'rw,noexec,nosuid,size=64m'})
    command = ['docker', 'run', '-d', '--name', state['containerName'], '--label', LABEL + '=' + state['marker'],
               '--network', 'none', '--read-only', '--user', 'postgres', '--cap-drop', 'ALL',
               '--security-opt', 'no-new-privileges', '--pids-limit', '256', '--memory', '2g', '--cpus', '2',
               '--log-driver', 'none', *[v for k,val in state['tmpfs'].items() for v in ('--tmpfs',k+':'+val)],
               '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', '-e', 'POSTGRES_DB=' + DATABASE, state['imageId']]
    result = execute(command, 'create-networkless-restore-container')
    if result.returncode:
        raise RuntimeError('container_creation_failed')
    state['containerId'] = result.stdout.decode().strip()
    write_state()
    verify()
    for attempt in range(40):
        ready = execute(['docker', 'exec', state['containerId'], 'pg_isready', '-U', 'postgres', '-d', DATABASE], 'postgres-ready', timeout=5)
        if ready.returncode == 0:
            break
        time.sleep(0.5)
    else:
        raise RuntimeError('new_postgres_not_ready')
    # The gzip stream is consumed solely by psql INSIDE the fenced container.
    # Never execute any SQL or psql metacommand on the host.
    command = (['docker','exec','-i',state['containerId'],'pg_restore','--exit-on-error','--no-owner','--no-privileges','-U','postgres','-d',DATABASE]
               if custom else psql(DATABASE) + ['-f','-'])
    command = pin_docker(command)
    with gzip.open(INPUT, 'rb') as stream:
        child = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, env=environment())
        # stderr is drained concurrently, held only in memory, never saved/raw-printed.
        import threading
        diagnostics = bytearray()
        def drain():
            for block in iter(lambda: child.stderr.read(8192), b''):
                if len(diagnostics) < 1048576:
                    diagnostics.extend(block[:1048576-len(diagnostics)])
        reader = threading.Thread(target=drain, daemon=True)
        reader.start()
        try:
            for block in iter(lambda: stream.read(65536), b''):
                child.stdin.write(block)
            child.stdin.close()
        except BrokenPipeError:
            child.stdin.close()
        code = child.wait(timeout=180)
        reader.join(timeout=3)
    codes = sorted(set(c.decode('ascii') for c in re.findall(rb'(?:ERROR|FATAL):\s+([A-Z0-9]{5})(?:\s|$)', diagnostics)))
    locations = sorted(set(int(n) for n in re.findall(rb'(?:<stdin>|-):(\d+):\s+(?:ERROR|FATAL):', diagnostics)))
    record('restore-opaque-gzip', command, code, inputSha256=identity['sha256'], sqlStates=codes,
           errorLines=locations, diagnosticsSuppressed=True)
    state['restoreExitCode'] = code
    write_state()
    save(RUN / 'restore.json', dict(exitCode=code, sqlStates=codes, errorLines=locations,
                                   rawDiagnosticsRetained=False, identity=verify()))
    if code:
        raise RuntimeError('restore_failed_details_suppressed')
    # A second input digest detects accidental source replacement during restore.
    if digest(INPUT) != identity['sha256']:
        raise RuntimeError('input_changed_during_restore')
    sql(DATABASE, 'ALTER DATABASE ' + DATABASE + ' SET default_transaction_read_only=on;', 'freeze-raw-restore')
    state['restoreComplete'] = True
    write_state()
    print(json.dumps(dict(runDirectory=str(RUN), inputSha256=identity['sha256'], restoreExitCode=code,
                          containerId=state['containerId'], network='none', hostPorts=[])))


def inventory(database, suffix):
    queries = {
        'session': "SELECT current_database() database, current_setting('server_version') server_version, current_setting('transaction_read_only') read_only, (SELECT system_identifier::text FROM pg_control_system()) system_identifier",
        'tables': "SELECT tablename table_name FROM pg_tables WHERE schemaname='public' ORDER BY tablename",
        'module_columns': "SELECT table_name,column_name,data_type,udt_name,is_nullable,column_default,datetime_precision,character_maximum_length FROM information_schema.columns WHERE table_schema='public' AND ((table_name='patch_resource' AND column_name='publisher_left_at') OR (table_name='patch_resource_link' AND column_name IN ('attached_at','click')) OR table_name IN ('patch_resource_backup_state','patch_resource_merge_record','patch_resource_file_cleanup','patch_resource_link_attached_at_fill')) ORDER BY table_name,ordinal_position",
        'constraints': "SELECT c.relname table_name,co.conname constraint_name,co.contype,co.confdeltype,co.confupdtype,co.convalidated,pg_get_constraintdef(co.oid) definition FROM pg_constraint co JOIN pg_class c ON c.oid=co.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND (c.relname LIKE 'patch_resource%' OR c.relname LIKE 'ops_case%') ORDER BY c.relname,co.conname",
        'indexes': "SELECT c.relname table_name,i.relname index_name,x.indisunique,x.indisvalid,x.indpred IS NOT NULL partial,pg_get_indexdef(i.oid) definition FROM pg_index x JOIN pg_class c ON c.oid=x.indrelid JOIN pg_class i ON i.oid=x.indexrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN ('patch_resource_backup_state','patch_resource_merge_record','patch_resource_file_cleanup','patch_resource_link_attached_at_fill') ORDER BY c.relname,i.relname"
    }
    report = dict(database=database, sourceSha=state['sourceSha'], inputSha256=state['input']['sha256'], results={})
    for name, text in queries.items():
        report['results'][name] = query(database, text, suffix + '-' + name)
    present = {row['table_name'] for row in report['results']['tables']}
    report['opsCasePresent'] = 'ops_case' in present
    if report['opsCasePresent']:
        # Known kind names are safe schema enum facts; unknown values are grouped.
        report['results']['cases_all_statuses'] = query(database, "SELECT CASE WHEN kind IN ('takedown_request','mirror_version_check') THEN kind ELSE 'other_kind' END kind,CASE WHEN status IN ('open','waiting_reporter','waiting_owner','resolved','rejected','merged') THEN status ELSE 'other_status' END status,count(*)::bigint cases FROM public.ops_case GROUP BY 1,2 ORDER BY 1,2", suffix + '-case-statuses')
    save(RUN / (suffix + '-inventory.json'), report)
    return report


def audit(database, suffix):
    verify()
    exported = execute(['node','scripts/officialMirrorDataAudit.ts','--sql'], suffix+'-export-reviewed-queries')
    if exported.returncode:
        raise RuntimeError('query_export_failed')
    source = json.loads(exported.stdout)
    catalog = query(database, "SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='public'", suffix+'-catalog-presence')
    has = lambda table,column: any(row['table_name']==table and row['column_name']==column for row in catalog)
    present = {row['table_name'] for row in catalog}
    result = dict(source=source['source'],rules=source['rules'],inputSha256=state['input']['sha256'],
                  target=dict(containerId=state['containerId'],database=database),
                  originalSourceVerified=False,collectedAtVerified=False,results={},failures=[])
    queries = source['queries']
    selections = {'current_candidates': ('candidatesCurrent' if has('patch_resource','publisher_left_at') else 'candidatesBeforeMigration') if 'ops_case' in present else 'candidatesLegacyDump',
                  'link_created_groups':'createdGroupsCurrent' if has('patch_resource_link','attached_at') else 'createdGroupsBeforeMigration'}
    if 'ops_case' in present:
        selections['reserved_case_kinds']='cases'
    else:
        result['failures'].append(dict(query='reserved_case_kinds',code='ops_case_missing'))
    if 'patch_resource_link_attached_at_fill' in present and has('patch_resource_link','attached_at'):
        selections['fill_manifest']='fillManifest'
    else:
        result['failures'].append(dict(query='fill_manifest',code='manifest_or_attached_at_missing'))
    for name,key in selections.items():
        result['results'][name]=query(database,queries[key],suffix+'-'+name)
    postflight=sql(database,queries['postflight'],suffix+'-postflight',expect=None)
    result['postflightExitCode']=postflight.returncode
    if postflight.returncode:
        result['failures'].append(dict(query='postflight',code='assertion_failed_diagnostics_suppressed'))
    result['queriesSucceeded']=not result['failures']
    save(RUN/(suffix+'-audit.json'),result)
    print(json.dumps(dict(phase=suffix,queriesSucceeded=result['queriesSucceeded'],postflightExitCode=postflight.returncode,reports=str(RUN))))
    return result


def aggregate_fingerprint(database,name):
    catalog=query(database,"SELECT count(*)::bigint columns FROM information_schema.columns WHERE table_schema='public'",name+'-columns')
    links=query(database,"SELECT count(*)::bigint links,sum(download)::text downloads,md5(string_agg(id::text||':'||resource_id::text||':'||created::text||':'||download::text,',' ORDER BY id)) structural_data_digest FROM patch_resource_link",name+'-links')
    attached=query(database,"SELECT count(*)::bigint present FROM information_schema.columns WHERE table_schema='public' AND table_name='patch_resource_link' AND column_name='attached_at'",name+'-attached-presence')[0]['present']
    module=None
    if attached:
        module=query(database,"SELECT count(*)::bigint links,count(*) FILTER(WHERE attached_at IS NULL)::bigint nulls,md5(string_agg(id::text||':'||coalesce(attached_at::text,'NULL')||':'||click::text,',' ORDER BY id)) attached_digest FROM patch_resource_link",name+'-attached')
    return dict(catalog=catalog,links=links,module=module)


def backup_clone(database):
    verify()
    path=RUN/(database+'-before-migration.dump')
    command=['docker','exec',state['containerId'],'pg_dump','-U','postgres','-d',database,'--format=custom','--no-owner','--no-privileges']
    command=pin_docker(command)
    with path.open('xb') as output:
        os.chmod(path,0o600)
        result=subprocess.run(command,stdout=output,stderr=subprocess.DEVNULL,env=environment(),timeout=120)
    record('backup-disposable-clone',command,result.returncode,output=str(path))
    if result.returncode:
        raise RuntimeError('clone_backup_failed')
    command=['docker','exec','-i',state['containerId'],'pg_restore','--list']
    command=pin_docker(command)
    with path.open('rb') as stream:
        result=subprocess.run(command,stdin=stream,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,env=environment(),timeout=30)
    record('verify-clone-backup-directory',command,result.returncode,inputSha256=digest(path))
    if result.returncode:
        raise RuntimeError('clone_backup_verification_failed')
    save(RUN/'migration-backup.json',dict(file=str(path),bytes=path.stat().st_size,sha256=digest(path),archiveDirectoryExitCode=0,
                                       restoreProof='original input fully restored; clone derives from frozen raw restore'))


def migration(database,filename,name,decisions=None,expect=0):
    text=(ROOT/'migration'/filename).read_text()
    result=sql(database,text,name,variables=decisions,expect=expect)
    # The reviewed migration outputs only timestamps, structure and counts.
    if result.returncode==0:
        path=RUN/(name+'-safe-output.txt')
        with path.open('xb') as stream:
            os.chmod(path,0o600)
            stream.write(result.stdout)
    return result


def decisions(confirmed,rejected):
    return dict(stamp_confirmed=','.join(confirmed) or 'none',stamp_rejected=','.join(rejected) or 'none',small_stamp_review='acknowledged')


SYNC='production-official-mirror-sync-2026-11-04.sql'
CORRECT='production-official-mirror-attached-at-correct-2026-11-04.sql'
PREFLIGHT='production-official-mirror-preflight-2026-11-04.sql'
POSTFLIGHT='production-official-mirror-postflight-2026-11-04.sql'


def migrate():
    database='otoame_om06_migrated_dump'
    clone(DATABASE,database)
    backup_clone(database)
    migration(database,PREFLIGHT,'restored-preflight')
    baseline=aggregate_fingerprint(database,'before-rejected-attempt')
    failed=migration(database,SYNC,'missing-decisions-rejected',expect=None)
    if failed.returncode==0:
        raise RuntimeError('migration_accepted_missing_decisions')
    after_failure=aggregate_fingerprint(database,'after-rejected-attempt')
    if after_failure!=baseline:
        raise RuntimeError('missing_decisions_failed_to_rollback')
    groups=query(database,"SELECT to_char(created,'YYYY-MM-DD HH24:MI:SS.MS') created,count(*)::bigint links FROM patch_resource_link GROUP BY created ORDER BY count(*) DESC,created",'all-created-groups-before-sync')
    large=[g['created'] for g in groups if g['links']>50]
    hypothetical=decisions([],large)
    save(RUN/'test-decisions.json',dict(testOnly=True,provenanceVerified=False,productionPermission=False,
                                      rationale='Explicit hypothetical reject of all large groups to exercise greatest formula; no historical finding.',groups=groups,parameters=hypothetical))
    # All variables exist, but one large group remains undecided: failure must
    # roll back after the attempted DDL/backfill in the real migration.
    if large:
        missing=decisions([],large[1:])
        fail=migration(database,SYNC,'undecided-large-group-rejected',missing,expect=None)
        if fail.returncode==0 or aggregate_fingerprint(database,'after-undecided-large-group')!=baseline:
            raise RuntimeError('undecided_group_rollback_failed')
    migration(database,SYNC,'hypothetical-reject-sync',hypothetical)
    migration(database,POSTFLIGHT,'hypothetical-reject-postflight')
    first=aggregate_fingerprint(database,'after-first-sync')
    migration(database,SYNC,'same-decisions-reentry',hypothetical)
    second=aggregate_fingerprint(database,'after-reentry')
    if first!=second:
        raise RuntimeError('sync_reentry_changed_data')
    inventory(database,'migrated')
    result=audit(database,'migrated')
    save(RUN/'migration-results.json',dict(testOnly=True,missingParametersRejected=failed.returncode!=0,
                                         missingParametersRollback=baseline==after_failure,undecidedLargeGroupRollback=bool(large),
                                         sameDecisionReentryUnchanged=first==second,rawDatabaseUnmodified=True,
                                         before=baseline,after=second,postflightExitCode=result['postflightExitCode']))
    # Leave the complete migrated clone as a read-only review target.
    sql(database,'ALTER DATABASE '+database+' SET default_transaction_read_only=on;','freeze-migrated-clone')
    state['migrationComplete']=True
    write_state()


def mechanisms():
    if not state.get('migrationComplete'):
        raise RuntimeError('migration_phase_required')
    database='otoame_om06_mechanism_dump'
    clone(DATABASE,database)
    groups=query(database,"SELECT to_char(created,'YYYY-MM-DD HH24:MI:SS.MS') created,count(*)::bigint links FROM patch_resource_link GROUP BY created ORDER BY count(*) DESC,created",'mechanism-created-groups')
    large=[g['created'] for g in groups if g['links']>50]
    small=[g['created'] for g in groups if g['links']<=50]
    confirmed=large[:1]+small[:1]
    rejected=[g for g in large if g not in confirmed]
    selected=decisions(confirmed,rejected)
    save(RUN/'mechanism-decisions.json',dict(testOnly=True,provenanceVerified=False,productionPermission=False,parameters=selected,
                                           rationale='Exercise confirm/reject and small-group paths against the actual restored shape; these are test assumptions.'))
    # An existing attached_at value must survive, with no fill manifest entry.
    sql(database,"ALTER TABLE patch_resource_link ADD COLUMN attached_at TIMESTAMP(3) WITHOUT TIME ZONE; UPDATE patch_resource_link SET attached_at='1998-01-01 00:00:00.000' WHERE id=(SELECT min(id) FROM patch_resource_link);",'seed-existing-attached-at-in-copy')
    migration(database,SYNC,'mechanism-confirm-and-small-sync',selected)
    migration(database,POSTFLIGHT,'mechanism-postflight')
    preserved=query(database,"SELECT count(*)::bigint preserved,count(*) FILTER (WHERE NOT EXISTS(SELECT 1 FROM patch_resource_link_attached_at_fill f WHERE f.link_id=l.id))::bigint outside_manifest FROM patch_resource_link l WHERE attached_at='1998-01-01'::timestamp",'verify-existing-attached-preserved')
    if preserved!=[dict(preserved=1,outside_manifest=1)]:
        raise RuntimeError('existing_attached_not_preserved')
    # Mark a previously filled row as a later real change, without exposing IDs.
    sql(database,"UPDATE patch_resource_link SET attached_at='2031-01-01 00:00:00.000' WHERE id=(SELECT min(link_id) FROM patch_resource_link_attached_at_fill);",'seed-later-attached-change-in-copy')
    # Synthetic post-sync link references a card only inside the DB; no original
    # owner, address, object key or card content is brought into the host.
    sql(database,"INSERT INTO patch_resource_link (id,resource_id,storage,content,size,created,updated) SELECT -6000601,id,'user','https://example.invalid/om06-synthetic-only','1 GB','2032-01-01'::timestamp,'2032-01-01'::timestamp FROM patch_resource ORDER BY id LIMIT 1;",'seed-synthetic-post-sync-link')
    default_before=query(database,"SELECT attached_at IS NOT NULL has_default,click=0 click_default,NOT EXISTS(SELECT 1 FROM patch_resource_link_attached_at_fill f WHERE f.link_id=l.id) outside_manifest,md5(attached_at::text) attached_digest FROM patch_resource_link l WHERE id=-6000601",'post-sync-default-before-correction')
    # Flip previous assumptions explicitly through the LIMITED correction path.
    changed=decisions([],large)
    migration(database,CORRECT,'limited-correction-flip-to-reject',changed)
    protected=query(database,"SELECT count(*)::bigint protected FROM patch_resource_link WHERE attached_at='2031-01-01'::timestamp",'verify-later-change-protected')
    default_after=query(database,"SELECT attached_at IS NOT NULL has_default,click=0 click_default,NOT EXISTS(SELECT 1 FROM patch_resource_link_attached_at_fill f WHERE f.link_id=l.id) outside_manifest,md5(attached_at::text) attached_digest FROM patch_resource_link l WHERE id=-6000601",'post-sync-default-after-correction')
    if protected!=[dict(protected=1)] or default_before!=default_after:
        raise RuntimeError('limited_correction_overwrote_later_facts')
    first=aggregate_fingerprint(database,'limited-correction-first')
    migration(database,CORRECT,'limited-correction-reentry',changed)
    if aggregate_fingerprint(database,'limited-correction-second')!=first:
        raise RuntimeError('limited_correction_reentry_changed_values')
    # Changed decision sync must refuse the protected row's manifest mismatch.
    refusal=migration(database,SYNC,'changed-decision-sync-rejected',changed,expect=None)
    if refusal.returncode==0 or aggregate_fingerprint(database,'after-changed-decision-rejection')!=first:
        raise RuntimeError('changed_decision_sync_did_not_rollback')
    migration(database,POSTFLIGHT,'mechanism-final-postflight')
    fill=query(database,"SELECT fill_source,count(*)::bigint rows,count(*) FILTER(WHERE l.attached_at IS DISTINCT FROM f.filled_value)::bigint changed_since_fill FROM patch_resource_link_attached_at_fill f JOIN patch_resource_link l ON l.id=f.link_id GROUP BY fill_source ORDER BY fill_source",'mechanism-final-fill-counts')
    save(RUN/'mechanism-results.json',dict(testOnly=True,largeGroupConfirmed=bool(large),smallGroupConfirmed=bool(small),
                                         existingValuePreserved=preserved,protectedLaterChange=protected,
                                         postSyncInsertProtected=default_before==default_after,postSyncDefaults=default_after,
                                         correctionReentryUnchanged=True,changedDecisionSyncRejected=True,fill=fill,
                                         historicalTimestampDecisionsVerified=False))
    sql(database,'ALTER DATABASE '+database+' SET default_transaction_read_only=on;','freeze-mechanism-clone')
    state['mechanismsComplete']=True
    write_state()


def supplement():
    if not state.get('mechanismsComplete'):
        raise RuntimeError('mechanisms_phase_required')
    migrated='otoame_om06_migrated_dump'
    # Compare the current generated client model directory with restored schema
    # metadata. The imported client is not connected to any database.
    export = execute(['node','--input-type=module','-e',
        "import {Prisma} from '@prisma/client'; console.log(JSON.stringify(Prisma.dmmf.datamodel.models.map(m=>({table:m.dbName||m.name,fields:m.fields.filter(f=>f.kind!=='object').map(f=>f.dbName||f.name)}))))"],
        'export-current-client-model-directory')
    if export.returncode:
        raise RuntimeError('client_model_metadata_unavailable')
    models=json.loads(export.stdout)
    columns=query(migrated,"SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='public'",'migrated-all-columns')
    existing={(r['table_name'],r['column_name']) for r in columns}
    missing=[dict(table=m['table'],column=f) for m in models for f in m['fields'] if (m['table'],f) not in existing]
    save(RUN/'application-schema-directory-check.json',dict(models=len(models),scalarFields=sum(len(m['fields']) for m in models),missing=missing,
                                                           scope='Column presence only; not Prisma full schema diff or HTTP runtime proof.'))
    # Non-personal migration/dependency metadata. No row content selected.
    dependency_tables=['ops_case','patch_resource_access_grant','patch_resource_link_check','patch_resource_link_report',
                       'patch_resource_link_history','patch_resource_link_maintenance','patch_resource_link_maintenance_event',
                       'patch_resource_link_maintenance_participant']
    dependencies=query(DATABASE,"SELECT required.name,to_regclass('public.'||required.name) IS NOT NULL present FROM (VALUES "+','.join("('"+t+"')" for t in dependency_tables)+") required(name)",'raw-prerequisite-tables')
    case_targets=query(DATABASE,"SELECT CASE WHEN target_type IN ('resource','link','patch','user','comment','rating','shoutbox','help_post','help_answer','help_reply','site') THEN target_type ELSE 'other_target' END target_type,CASE WHEN status IN ('open','waiting_reporter','waiting_owner','resolved','rejected','merged') THEN status ELSE 'other_status' END status,count(*)::bigint cases FROM ops_case GROUP BY 1,2 ORDER BY 1,2",'case-target-status-counts')
    metadata_present=query(DATABASE,"SELECT to_regclass('public._prisma_migrations') IS NOT NULL present",'prisma-migration-metadata-presence')
    save(RUN/'dependencies-and-cases.json',dict(tables=dependencies,caseTargetStatusCounts=case_targets,prismaMigrationMetadata=metadata_present))
    # Full recovery of the newly written restricted clone backup, not only TOC.
    recovery='otoame_om06_recovery_dump'
    if recovery in state['databases']:
        raise RuntimeError('recovery_already_exists')
    sql('postgres','CREATE DATABASE '+recovery+' TEMPLATE template0;','create-new-backup-recovery-database')
    state['databases'].append(recovery)
    write_state()
    path=RUN/'otoame_om06_migrated_dump-before-migration.dump'
    verify()
    command=['docker','exec','-i',state['containerId'],'pg_restore','--exit-on-error','--no-owner','--no-privileges','-U','postgres','-d',recovery]
    command=pin_docker(command)
    with path.open('rb') as stream:
        # Do not retain diagnostics, which could include a private COPY row.
        result=subprocess.run(command,stdin=stream,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,env=environment(),timeout=120)
    record('full-backup-recovery',command,result.returncode,inputSha256=digest(path),diagnosticsSuppressed=True)
    if result.returncode:
        raise RuntimeError('full_clone_backup_restore_failed')
    raw=aggregate_fingerprint(DATABASE,'raw-final-unchanged')
    recovered=aggregate_fingerprint(recovery,'recovered-backup')
    if raw!=recovered:
        raise RuntimeError('recovery_aggregate_fingerprint_mismatch')
    sql(recovery,'ALTER DATABASE '+recovery+' SET default_transaction_read_only=on;','freeze-recovery-clone')
    # Real lock timeout on the actual restored shape, with an identified bounded
    # lock session in another disposable copy. No external/host PG connection.
    locked='otoame_om06_lock_dump'
    clone(DATABASE,locked)
    baseline=aggregate_fingerprint(locked,'lock-before')
    verify()
    command=psql(locked)+['-c',"SET application_name='om06_dump_lock_fixture'; BEGIN; LOCK TABLE patch_resource IN ACCESS EXCLUSIVE MODE; SELECT pg_sleep(12); ROLLBACK;"]
    command=pin_docker(command)
    holder=subprocess.Popen(command,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,env=environment())
    try:
        for _ in range(30):
            held=query('postgres',"SELECT count(*)::bigint held FROM pg_locks l JOIN pg_stat_activity a ON a.pid=l.pid WHERE a.application_name='om06_dump_lock_fixture' AND l.mode='AccessExclusiveLock' AND l.granted",'lock-fixture-presence')[0]['held']
            if held:
                break
            time.sleep(0.1)
        else:
            raise RuntimeError('lock_fixture_not_established')
        large=query(DATABASE,"SELECT to_char(created,'YYYY-MM-DD HH24:MI:SS.MS') created FROM patch_resource_link GROUP BY created HAVING count(*)>50",'lock-test-large-groups')
        parameters=decisions([],[g['created'] for g in large])
        failed=migration(locked,SYNC,'actual-shape-lock-timeout',parameters,expect=None)
        if failed.returncode==0:
            raise RuntimeError('locked_migration_unexpectedly_succeeded')
    finally:
        # This child exits itself after bounded pg_sleep. Never signal a PID that
        # could now refer to another process or stop an unknown service.
        holder_code=holder.wait(timeout=16)
        record('bounded-lock-holder',command,holder_code)
    after=aggregate_fingerprint(locked,'lock-after-timeout')
    if after!=baseline:
        raise RuntimeError('lock_timeout_failed_to_rollback')
    migration(locked,SYNC,'lock-timeout-retry-sync',parameters)
    migration(locked,POSTFLIGHT,'lock-timeout-retry-postflight')
    sql(locked,'ALTER DATABASE '+locked+' SET default_transaction_read_only=on;','freeze-lock-clone')
    save(RUN/'supplement-results.json',dict(fullBackupRestoreExitCode=result.returncode,recoveryMatchesRawAggregate=raw==recovered,
                                          rawFingerprint=raw,recoveredFingerprint=recovered,lockWaitRejected=True,
                                          lockTimeoutRollbackUnchanged=after==baseline,lockRetryPostflightExitCode=0,
                                          prerequisiteTablesPresent=all(t['present'] for t in dependencies),clientMissingColumns=missing))
    state['supplementComplete']=True
    write_state()


def main():
    global args, RUN, state, INPUT
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('phase', choices=['prepare','inventory','migrate','mechanisms','supplement','review','verify','bind-local','stop','clean-failed'])
    parser.add_argument('--run-dir', type=Path)
    parser.add_argument('--dump', type=Path, help='explicitly authorized workspace-root SQL gzip; required only for prepare')
    args = parser.parse_args()
    os.umask(0o077)
    if args.phase == 'prepare':
        if not args.dump:
            parser.error('--dump required for prepare')
        INPUT = args.dump.absolute()
        marker = time.strftime('%Y%m%d%H%M%S') + '-' + secrets.token_hex(4)
        RUN = ROOT / '.deploy' / 'module06-data-audit' / ('specified-dump-' + marker)
        RUN.mkdir(mode=0o700, parents=True)
        state = dict(marker=marker, containerName='om06-dump-' + marker, databases=['postgres',DATABASE],
                     sourceSha=subprocess.check_output(['git','rev-parse','HEAD'],env=environment()).decode().strip(), createdAt=time.time())
        write_state()
    else:
        if not args.run_dir:
            parser.error('--run-dir required')
        if '..' in args.run_dir.parts:
            raise RuntimeError('run_directory_traversal_refused')
        RUN = args.run_dir.absolute()
        allowed = ROOT / '.deploy' / 'module06-data-audit'
        if not RUN.is_relative_to(allowed):
            raise RuntimeError('run_directory_outside_approved_ignored_path')
        cursor = RUN
        while cursor != ROOT:
            if cursor.is_symlink():
                raise RuntimeError('run_directory_symlink_refused')
            cursor = cursor.parent
        RUN = RUN.resolve()
        if (RUN / 'state.json').is_symlink():
            raise RuntimeError('state_symlink_refused')
        state = json.loads((RUN / 'state.json').read_text())
    record('phase-start', [sys.executable,*sys.argv], None, phase=args.phase, scriptSha256=digest(Path(__file__)))
    try:
        bind_docker(allow_new=args.phase in ('prepare','bind-local'))
        if args.phase == 'prepare':
            state['dockerEndpoint'] = dict(docker_binding)
            write_state()
            prepare()
        elif args.phase == 'bind-local':
            bind_local_environment()
        elif args.phase == 'inventory':
            if not state.get('restoreComplete'):
                raise RuntimeError('completed_restore_required')
            if not (RUN/'raw-inventory.json').exists():
                inventory(DATABASE, 'raw')
            audit(DATABASE, 'raw')
        elif args.phase == 'migrate':
            migrate()
        elif args.phase == 'mechanisms':
            mechanisms()
        elif args.phase == 'supplement':
            supplement()
        elif args.phase == 'review':
            suffix='review-'+str(time.time_ns())
            inventory(DATABASE,suffix+'-raw')
            audit(DATABASE,suffix+'-raw')
            if state.get('migrationComplete'):
                audit('otoame_om06_migrated_dump',suffix+'-migrated')
        elif args.phase == 'verify':
            print(json.dumps(verify()))
        elif args.phase == 'clean-failed':
            if state.get('restoreComplete'):
                raise RuntimeError('completed_environment_cleanup_refused')
            actual = verify(require_running=False)
            if actual['running']:
                raise RuntimeError('running_environment_cleanup_refused')
            result = execute(['docker','rm',state['containerId']], 'remove-own-failed-container')
            if result.returncode:
                raise RuntimeError('failed_container_remove_failed')
            state['removed']=True
            write_state()
            print('own_failed_container_removed')
        elif args.phase == 'stop':
            verify()
            result = execute(['docker','stop','--time','10',state['containerId']], 'stop-own-container',timeout=20)
            if result.returncode or inspect(state['containerId'])['running']:
                raise RuntimeError('container_stop_not_confirmed')
            state['stopped']=True
            write_state()
            print('own_container_stopped')
        record('phase-end',[sys.executable,*sys.argv],0,phase=args.phase)
    except Exception as error:
        record('phase-end',[sys.executable,*sys.argv],1,phase=args.phase)
        code = str(error) if re.fullmatch('[a-zA-Z0-9_-]{1,100}', str(error)) else type(error).__name__
        failure = RUN / ('failure-' + str(time.time_ns()) + '.json')
        save(failure, dict(phase=args.phase,error=code,detailsSuppressed=True))
        print(json.dumps(dict(phase=args.phase,completed=False,error=code,report=str(failure))))
        raise SystemExit(1)


if __name__ == "__main__":
    main()
