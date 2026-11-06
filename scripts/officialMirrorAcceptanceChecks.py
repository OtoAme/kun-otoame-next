#!/usr/bin/env python3
"""Controlled safety checks; never contacts Docker or application databases.

Run: python3 scripts/officialMirrorAcceptanceChecks.py
The runner subprocess sees fake Docker/pnpm executables, while process shutdown
checks use only real process groups created by this check in ignored coverage/.
"""
import hashlib
import json
import os
from pathlib import Path
import secrets
import shutil
import signal
import subprocess
import sys
import tempfile
import time
import unittest

ROOT = Path(__file__).resolve().parents[1]
RUNNER = ROOT / 'scripts/officialMirrorAcceptance.py'
REPORT = ROOT / 'coverage' / ('om06-safety-check-' + time.strftime('%Y%m%d%H%M%S') + '-' + secrets.token_hex(3))
REPORT.mkdir(parents=True)
RESULTS = []


def process_identity(pid, cwd, role='application'):
    result = subprocess.check_output(['ps', '-p', str(pid), '-o', 'pid=,pgid=,lstart='], text=True, env=dict(os.environ, LC_ALL='C'))
    actual, pgid, started = result.strip().split(None, 2)
    return {'pid': int(actual), 'pgid': int(pgid), 'started': started.strip(), 'cwd': str(cwd), 'role': role}


class SafetyChecks(unittest.TestCase):
    def setUp(self):
        self.directory = Path(tempfile.mkdtemp(prefix='om06-safety-fixture-', dir=ROOT / 'coverage'))
        self.source = self.directory / 'source'
        self.source.mkdir()
        self.bin = self.directory / 'bin'
        self.bin.mkdir()
        self.marker = self.directory.name
        self.state = {'marker': self.marker, 'sourceSha': 'controlled-safety-check', 'source': str(self.source),
                      'postgres': self.marker + '-pg', 'redis': self.marker + '-redis', 'jwt': 'synthetic-check-only',
                      'ports': [55432, 55443, 55435, 55436, 56380, 3100, 36741],
                      'containerIds': {'postgres': 'a' * 64, 'redis': 'b' * 64},
                      'createdProcesses': [], 'processIdentities': {}}
        self.metadata = {}
        for key, ports, internal in [('postgres', [55432, 55443, 55435, 55436], 5432), ('redis', [56380], 6379)]:
            self.metadata[self.state[key]] = {'id': self.state['containerIds'][key], 'name': '/' + self.state[key],
                'label': self.marker, 'running': True,
                'ports': {str(internal) + '/tcp': [{'HostIp': '127.0.0.1', 'HostPort': str(port)} for port in ports]}}
        for metadata in list(self.metadata.values()):
            self.metadata[metadata['id']] = metadata
        fake = '''#!/usr/bin/env python3
import json, os, pathlib, sys
root = pathlib.Path(__file__).resolve().parent.parent
args = sys.argv[1:]
with (root / 'tool-calls.jsonl').open('a') as out:
    out.write(json.dumps({'tool': pathlib.Path(__file__).name, 'args': args}) + '\\n')
if pathlib.Path(__file__).name == 'pnpm' and args[:3] == ['exec', 'next', 'start'] and (root / 'allow-start').exists():
    os.execv(sys.executable, [sys.executable, str(root / 'application.py')])
if pathlib.Path(__file__).name == 'docker' and args[0] == 'inspect':
    metadata = json.loads((root / 'metadata.json').read_text()).get(args[-1])
    if metadata is None:
        print('Error: No such object: ' + args[-1], file=sys.stderr)
        sys.exit(1)
    print(json.dumps(metadata))
    sys.exit(0)
with (root / 'unsafe-commands.jsonl').open('a') as out:
    out.write(json.dumps({'tool': pathlib.Path(__file__).name, 'args': args}) + '\\n')
sys.exit(71)
'''
        for command in ['docker', 'pnpm']:
            target = self.bin / command
            target.write_text(fake)
            target.chmod(0o755)
        self.processes = []
        self.observed_groups = set()
        self.extra_children = []
        self.write()

    def write(self):
        (self.directory / 'state.json').write_text(json.dumps(self.state))
        (self.directory / 'metadata.json').write_text(json.dumps(self.metadata))

    def invoke(self, phase):
        before = json.loads(json.dumps(self.state.get('processIdentities', {})))
        self.observed_groups.update(self.state['createdProcesses'])
        self.write()
        env = {'PATH': str(self.bin) + os.pathsep + os.environ['PATH'], 'HOME': os.environ['HOME'], 'LANG': 'C'}
        started = time.monotonic()
        result = subprocess.run([sys.executable, str(RUNNER), phase, '--run-dir', str(self.directory)],
                                env=env, text=True, capture_output=True, timeout=25)
        elapsed = time.monotonic() - started
        (self.directory / (phase + '.log')).write_text(result.stdout + result.stderr)
        self.state = json.loads((self.directory / 'state.json').read_text())
        self.observed_groups.update(self.state['createdProcesses'])
        RESULTS.append({'check': self.id(), 'phase': phase, 'exitCode': result.returncode,
                        'seconds': round(elapsed, 3), 'log': str(self.directory / (phase + '.log')),
                        'processIdentitiesBefore': before,
                        'processIdentitiesAfter': self.state.get('processIdentities', {})})
        return result

    def denied(self, phase, reason):
        result = self.invoke(phase)
        self.assertNotEqual(result.returncode, 0, result.stdout)
        self.assertIn(reason, result.stderr)
        self.assertFalse((self.directory / 'unsafe-commands.jsonl').exists(), 'runner reached a write command before refusing')
        self.assertFalse((self.source / 'tests').exists(), 'refusal must precede even copying entrypoints')

    def spawn(self, *, cwd=None, role='application', stubborn_child=False):
        ready = self.directory / ('ready-' + str(len(self.processes)))
        if stubborn_child:
            program = """import os,pathlib,signal,subprocess,sys,time
child = subprocess.Popen([sys.executable, '-c', 'import signal,time; signal.signal(signal.SIGTERM, signal.SIG_IGN); time.sleep(120)'])
time.sleep(.2)
pathlib.Path(sys.argv[1]).write_text(str(child.pid))
while True: time.sleep(.1)
"""
        else:
            program = "import pathlib,sys,time; pathlib.Path(sys.argv[1]).write_text('ready'); time.sleep(120)"
        child = subprocess.Popen([sys.executable, '-c', program, str(ready)], cwd=cwd or self.source,
                                 start_new_session=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        self.processes.append(child)
        self.observed_groups.add(child.pid)
        for _ in range(100):
            if ready.exists():
                break
            time.sleep(.02)
        self.assertTrue(ready.exists(), 'controlled child failed to start')
        identity = process_identity(child.pid, self.source, role)
        self.state['createdProcesses'].append(child.pid)
        self.state['processIdentities'][str(child.pid)] = identity
        if stubborn_child:
            grandchild = int(ready.read_text())
            self.extra_children.append(process_identity(grandchild, self.source))
        return child

    def tearDown(self):
        # Cleanup is restricted to exact processes created and recorded above.
        for identity in self.extra_children:
            try:
                actual = process_identity(identity['pid'], self.source)
                if actual['started'] == identity['started'] and actual['pgid'] == identity['pgid']:
                    os.kill(identity['pid'], signal.SIGKILL)
            except (ProcessLookupError, subprocess.CalledProcessError):
                pass
        for pid in self.state['createdProcesses']:
            identity = self.state['processIdentities'].get(str(pid))
            if not identity or any(child.pid == pid for child in self.processes):
                continue
            try:
                actual = process_identity(pid, self.source, identity['role'])
                if actual == identity:
                    cwd = subprocess.check_output(['lsof', '-a', '-p', str(pid), '-d', 'cwd', '-Fn'], text=True)
                    if 'n' + str(self.source) in cwd.splitlines():
                        os.killpg(pid, signal.SIGTERM)
            except (ProcessLookupError, subprocess.CalledProcessError):
                pass
        for child in self.processes:
            if child.poll() is None:
                child.terminate()
            child.wait(timeout=5)
        deadline = time.monotonic() + 5
        while True:
            table = subprocess.check_output(['ps', '-ax', '-o', 'pid=,pgid=,stat='], text=True)
            remaining = [int(pid) for pid, group, status in (line.split() for line in table.splitlines())
                         if int(group) in self.observed_groups and not status.startswith('Z')]
            if not remaining or time.monotonic() >= deadline:
                break
            time.sleep(.1)
        (self.directory / 'check-cleanup.json').write_text(json.dumps({
            'ownedLeadersExited': all(p.poll() is not None for p in self.processes),
            'observedGroups': sorted(self.observed_groups), 'remainingLiveGroupMembers': remaining}))
        self.assertFalse(remaining, 'controlled process cleanup did not prove exit')
        shutil.rmtree(self.source)

    def test_old_run_with_missing_container(self):
        self.metadata.clear()
        for phase in ['integration', 'build', 'start', 'browser', 'http', 'recover']:
            with self.subTest(phase=phase):
                self.denied(phase, 'container identity')

    def test_replaced_container_even_with_same_name_label_and_ports(self):
        self.metadata[self.state['postgres']]['id'] = 'c' * 64
        self.denied('integration', 'container identity')

    def test_wrong_label(self):
        self.metadata[self.state['redis']]['label'] = 'another-run'
        self.denied('build', 'container identity')

    def test_equivalent_docker_port_order_is_accepted(self):
        identity = self.state['containerIds']['postgres']
        self.metadata[identity] = json.loads(json.dumps(self.metadata[self.state['postgres']]))
        self.metadata[identity]['ports']['5432/tcp'].reverse()
        result = self.invoke('stop-app')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertFalse((self.directory / 'unsafe-commands.jsonl').exists())

    def test_wrong_port_mapping(self):
        self.metadata[self.state['postgres']]['ports']['5432/tcp'][0]['HostPort'] = '55431'
        self.denied('integration', 'container identity')

    def test_stop_rejects_replacement_without_signaling_application(self):
        child = self.spawn()
        self.metadata[self.state['postgres']]['id'] = 'c' * 64
        before = json.loads(json.dumps(self.state))
        result = self.invoke('stop')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('container identity', result.stderr)
        self.assertIsNone(child.poll())
        self.assertEqual(self.state, before)
        self.assertFalse((self.directory / 'unsafe-commands.jsonl').exists())

    def test_unrecorded_container_id(self):
        del self.state['containerIds']
        self.denied('build', 'container identity')

    def test_http_requires_this_runs_process_records(self):
        self.denied('http', 'service identity')

    def test_http_rejects_live_process_with_wrong_cwd(self):
        self.spawn(cwd=self.directory)
        self.spawn(role='services')
        self.denied('http', 'service identity')
        self.assertTrue(all(p.poll() is None for p in self.processes))

    def test_recover_rejects_reused_process_identity(self):
        child = self.spawn()
        self.spawn(role='services')
        self.state['processIdentities'][str(child.pid)]['started'] = 'not-the-recorded-process'
        self.denied('recover', 'service identity')

    def test_application_requires_owned_listener(self):
        self.spawn()
        self.spawn(role='services')
        self.denied('browser', 'service identity')

    def test_stop_rejects_wrong_cwd_and_retains_state(self):
        child = self.spawn(cwd=self.directory)
        before = json.loads(json.dumps(self.state))
        result = self.invoke('stop-app')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('service identity', result.stderr)
        self.assertEqual(self.state['createdProcesses'], before['createdProcesses'])
        self.assertEqual(self.state['processIdentities'], before['processIdentities'])
        self.assertIsNone(child.poll())

    def test_stop_timeout_retains_identity_of_surviving_child(self):
        self.spawn(stubborn_child=True)
        before = json.loads(json.dumps(self.state))
        result = self.invoke('stop-app')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('process group did not exit', result.stderr)
        self.assertEqual(self.state['createdProcesses'], before['createdProcesses'])
        self.assertEqual(self.state['processIdentities'], before['processIdentities'])
        self.assertFalse((self.directory / 'unsafe-commands.jsonl').exists())
        self.assertTrue(self.extra_children)
        os.kill(self.extra_children[0]['pid'], 0)
        cleanup = self.invoke('clean-source')
        self.assertNotEqual(cleanup.returncode, 0)
        self.assertIn('stop this run', cleanup.stderr)
        self.assertTrue(self.source.exists())
        self.assertEqual(self.state['processIdentities'], before['processIdentities'])
        denied = self.invoke('start')
        self.assertNotEqual(denied.returncode, 0)
        self.assertIn('stop it before starting', denied.stderr)

    def test_normal_start_and_stop(self):
        (self.directory / 'allow-start').touch()
        (self.directory / 'application.py').write_text('''import http.server,json
class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        body=json.dumps({'name':'E2E Rewrite Fixture'}).encode()
        self.send_response(200)
        self.send_header('Content-Type','application/json')
        self.end_headers()
        self.wfile.write(body)
http.server.HTTPServer(('127.0.0.1',3100),Handler).serve_forever()
''')
        started = self.invoke('start')
        self.assertEqual(started.returncode, 0, started.stderr)
        self.assertEqual(len(self.state['createdProcesses']), 2)
        identities = list(self.state['processIdentities'].values())
        self.assertEqual({p['role'] for p in identities}, {'application', 'services'})
        self.assertTrue(all(p['cwd'] == str(self.source) for p in identities))
        stopped = self.invoke('stop-app')
        self.assertEqual(stopped.returncode, 0, stopped.stderr)
        self.assertEqual(self.state['createdProcesses'], [])
        self.assertEqual(self.state['processIdentities'], {})
        self.assertFalse((self.directory / 'unsafe-commands.jsonl').exists())
        for port in [3100, 36741]:
            probe = subprocess.run(['lsof', '-nP', '-iTCP:' + str(port), '-sTCP:LISTEN', '-t'], capture_output=True)
            self.assertFalse(probe.stdout.strip(), 'owned listener survived successful stop')

    def test_stop_proves_exit_before_clearing_records(self):
        children = [self.spawn(), self.spawn(role='services')]
        result = self.invoke('stop-app')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.state['createdProcesses'], [])
        self.assertEqual(self.state['processIdentities'], {})
        for child in children:
            self.assertIsNotNone(child.poll())


if __name__ == '__main__':
    suite = unittest.defaultTestLoader.loadTestsFromTestCase(SafetyChecks)
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    summary = {'passed': result.wasSuccessful(), 'testsRun': result.testsRun,
               'runnerSha256': hashlib.sha256(RUNNER.read_bytes()).hexdigest(),
               'checksSha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
               'results': RESULTS, 'failures': len(result.failures), 'errors': len(result.errors)}
    (REPORT / 'results.json').write_text(json.dumps(summary, indent=2) + '\n')
    print('SAFETY_REPORT ' + str(REPORT), flush=True)
    raise SystemExit(0 if result.wasSuccessful() else 1)
