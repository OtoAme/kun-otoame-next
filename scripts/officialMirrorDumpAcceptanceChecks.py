#!/usr/bin/env python3
"""Offline identity-refusal tests; never invokes Docker or a database."""
import argparse
import importlib.util
import os
import json
import stat
import tempfile
from types import SimpleNamespace
import subprocess
from pathlib import Path
import unittest
from unittest.mock import patch

path = Path(__file__).with_name('officialMirrorDumpAcceptance.py')
spec = importlib.util.spec_from_file_location('dump_acceptance', path)
harness = importlib.util.module_from_spec(spec)
spec.loader.exec_module(harness)


class IsolationChecks(unittest.TestCase):
    def setUp(self):
        harness.docker_binding = None
        harness.args = argparse.Namespace(phase='inventory')
        harness.state = dict(containerId='a'*64, containerName='om06-local-fixture', marker='test-marker',
                             imageId='sha256:'+'b'*64, databases=['postgres','otoame_fixture_dump'],
                             tmpfs={'/var/lib/postgresql':'rw,mode=0700'})
        self.valid = dict(id='a'*64, name='/om06-local-fixture', label='test-marker', running=True,
                          network='none', ports={}, imageId='sha256:'+'b'*64, readonly=True,
                          privileged=False,user='postgres',caps=['ALL'],security=['no-new-privileges'],
                          mounts=[],tmpfs=dict(harness.state['tmpfs']))

    def verify(self, metadata):
        with patch.object(harness,'inspect',return_value=metadata):
            return harness.verify()

    def test_valid_networkless_identity(self):
        self.assertEqual(self.verify(self.valid)['id'],harness.state['containerId'])

    def test_replaced_container_refused_before_query_or_write(self):
        for key,value in [('id','c'*64),('name','/other'),('label','other'),('imageId','sha256:'+'c'*64)]:
            with self.subTest(key=key),patch.object(harness,'execute') as execute:
                changed=dict(self.valid,**{key:value})
                with self.assertRaises(RuntimeError):
                    self.verify(changed)
                execute.assert_not_called()

    def test_network_ports_host_mounts_and_privileges_refused(self):
        changes=[dict(network='bridge'),dict(ports={'5432/tcp':[{'HostIp':'127.0.0.1','HostPort':'55432'}]}),
                 dict(mounts=[{'Type':'bind'}]),dict(mounts=[{'Type':'volume'}]),dict(privileged=True),
                 dict(readonly=False),dict(caps=[]),dict(security=[]),dict(user='root'),
                 dict(tmpfs={}),dict(tmpfs={'/var/lib/postgresql':'rw,mode=0777'})]
        for change in changes:
            with self.subTest(change=change),self.assertRaises(RuntimeError):
                self.verify(dict(self.valid,**change))

    def test_name_and_id_both_must_match(self):
        changed=dict(self.valid,label='replacement')
        with patch.object(harness,'inspect',side_effect=[self.valid,changed]),self.assertRaises(RuntimeError):
            harness.verify()

    def test_stopped_container_refused_for_active_phase(self):
        with self.assertRaises(RuntimeError):
            self.verify(dict(self.valid,running=False))

    def test_unknown_database_refused(self):
        for database in ['otoame_prod_dump','postgres; SELECT 1','unknown']:
            with self.subTest(database=database),self.assertRaises(RuntimeError):
                harness.psql(database)

    def test_invalid_id_refused_before_docker(self):
        harness.state['containerId']='not-an-id'
        with patch.object(harness,'inspect') as inspect,self.assertRaises(RuntimeError):
            harness.verify()
        inspect.assert_not_called()

    def test_run_directory_traversal_refused_before_state_read(self):
        escaped=harness.ROOT/'.deploy/module06-data-audit/../../other-run'
        argv=['officialMirrorDumpAcceptance.py','verify','--run-dir',str(escaped)]
        with patch.object(harness.sys,'argv',argv),patch.object(Path,'read_text',side_effect=AssertionError('state_read_before_path_validation')):
            with self.assertRaises(RuntimeError):
                harness.main()

    def test_unknown_clone_name_refused_without_mutation(self):
        with patch.object(harness,'sql') as sql,self.assertRaises(RuntimeError):
            harness.clone('otoame_fixture_dump','existing_service')
        sql.assert_not_called()


class EndpointChecks(unittest.TestCase):
    def setUp(self):
        harness.docker_binding = dict(endpoint='unix:///offline-fixture/docker.sock', socketDevice=1,
                                      socketInode=2, socketUid=0, daemonId='offline-daemon', selection='current_context')

    def test_endpoint_environment_never_reaches_children(self):
        with patch.dict(os.environ, dict(DOCKER_HOST='ssh://remote.invalid', DOCKER_CONTEXT='remote',
                                        DOCKER_CONFIG='/offline-config', DOCKER_TLS_VERIFY='1',
                                        DOCKER_CERT_PATH='/offline-cert'), clear=True):
            self.assertFalse(any(key.startswith('DOCKER_') for key in harness.environment()))

    def test_execute_pins_endpoint_despite_context_change(self):
        result = subprocess.CompletedProcess([], 0, b'{}', b'')
        with patch.dict(os.environ, dict(DOCKER_HOST='tcp://remote.invalid:2375', DOCKER_CONTEXT='remote'), clear=True), \
             patch.object(harness, 'check_docker_binding', create=True), \
             patch.object(harness.subprocess, 'run', return_value=result) as run, patch.object(harness, 'record'):
            harness.execute(['docker', 'inspect', 'offline-container'], 'offline-inspect')
        self.assertEqual(run.call_args.args[0][:3], ['docker', '--host', 'unix:///offline-fixture/docker.sock'])
        self.assertFalse(any(key.startswith('DOCKER_') for key in run.call_args.kwargs['env']))


    def test_network_and_unknown_transports_refused_before_daemon_contact(self):
        endpoints = ['ssh://remote.invalid', 'tcp://127.0.0.1:2375', 'http://remote.invalid',
                     'https://remote.invalid', 'npipe:////./pipe/docker_engine', '/offline/docker.sock',
                     'unix://remote.invalid/docker.sock', 'unix:///offline/docker.sock?redirect=remote',
                     'unix:///offline/docker.sock#remote', 'unix:///offline/%2fremote.sock', None]
        for endpoint in endpoints:
            with self.subTest(endpoint=endpoint), patch.object(harness, 'docker_probe') as probe:
                with self.assertRaises(RuntimeError):
                    harness.local_socket_identity(endpoint)
                probe.assert_not_called()

    def test_local_socket_requires_socket_type_and_trusted_owner(self):
        for mode, uid in [(stat.S_IFREG, os.geteuid()), (stat.S_IFSOCK, os.geteuid()+10000)]:
            metadata=SimpleNamespace(st_mode=mode, st_uid=uid, st_dev=1, st_ino=2)
            with self.subTest(mode=mode, uid=uid), patch.object(Path, 'resolve', return_value=Path('/offline/socket')), \
                 patch.object(Path, 'lstat', return_value=metadata), self.assertRaises(RuntimeError):
                harness.local_socket_identity('unix:///offline/socket')

    def test_local_socket_is_canonicalized_before_pinning(self):
        metadata=SimpleNamespace(st_mode=stat.S_IFSOCK, st_uid=os.geteuid(), st_dev=1, st_ino=2)
        with patch.object(Path, 'resolve', return_value=Path('/offline/canonical.sock')), \
             patch.object(Path, 'lstat', return_value=metadata):
            actual=harness.local_socket_identity('unix:///offline/symlink.sock')
        self.assertEqual(actual['endpoint'], 'unix:///offline/canonical.sock')
        self.assertEqual(actual['socketInode'], 2)

    def test_remote_host_override_never_queries_daemon_or_context(self):
        for endpoint in ['ssh://remote.invalid', 'tcp://127.0.0.1:2375', 'http://remote.invalid']:
            with self.subTest(endpoint=endpoint), patch.dict(os.environ, {'DOCKER_HOST':endpoint}, clear=True), \
                 patch.object(harness, 'docker_probe') as probe, self.assertRaises(RuntimeError):
                harness.resolve_docker_binding()
            probe.assert_not_called()

    def test_remote_context_overrides_local_host_and_is_refused(self):
        with patch.dict(os.environ, {'DOCKER_CONTEXT':'remote', 'DOCKER_HOST':'unix:///offline/local.sock'}, clear=True), \
             patch.object(harness, 'docker_probe', return_value=b'"ssh://remote.invalid"') as probe, \
             patch.object(harness, 'daemon_identity') as daemon, self.assertRaises(RuntimeError):
            harness.resolve_docker_binding()
        self.assertEqual(probe.call_count, 1)
        self.assertEqual(probe.call_args.args[0][-1], 'remote')
        self.assertTrue(probe.call_args.kwargs['metadata'])
        daemon.assert_not_called()

    def test_custom_config_context_is_resolved_without_forwarding_host_override(self):
        replies=[subprocess.CompletedProcess([],0,b'remote-config-context\n',b''),
                 subprocess.CompletedProcess([],0,b'"tcp://remote.invalid:2376"',b'')]
        with patch.dict(os.environ, {'DOCKER_CONFIG':'/offline/config'}, clear=True), \
             patch.object(harness.subprocess, 'run', side_effect=replies) as run, patch.object(harness, 'record'), \
             patch.object(harness, 'daemon_identity') as daemon, self.assertRaises(RuntimeError):
            harness.resolve_docker_binding()
        self.assertEqual(run.call_count, 2)
        for call in run.call_args_list:
            self.assertEqual(call.args[0][:2], ['docker','context'])
            self.assertEqual(call.kwargs['env'], {'DOCKER_CONFIG':'/offline/config'})
        daemon.assert_not_called()

    def test_context_selection_precedence_matches_docker(self):
        socket=dict(endpoint='unix:///offline/local.sock',socketDevice=1,socketInode=2,socketUid=0)
        with patch.dict(os.environ, {'DOCKER_CONTEXT':'local', 'DOCKER_HOST':'ssh://ignored.invalid'}, clear=True), \
             patch.object(harness, 'docker_probe', return_value=b'"unix:///offline/local.sock"') as probe, \
             patch.object(harness, 'local_socket_identity', return_value=socket), \
             patch.object(harness, 'daemon_identity', return_value='local-daemon'):
            resolved=harness.resolve_docker_binding()
        self.assertEqual(resolved['selection'],'context_environment')
        self.assertEqual(probe.call_args.args[0][-1],'local')
        with patch.dict(os.environ, {'DOCKER_HOST':socket['endpoint']}, clear=True), \
             patch.object(harness, 'docker_probe') as probe, \
             patch.object(harness, 'local_socket_identity', return_value=socket), \
             patch.object(harness, 'daemon_identity', return_value='local-daemon'):
            resolved=harness.resolve_docker_binding()
        self.assertEqual(resolved['selection'],'host_environment')
        probe.assert_not_called()

    def test_default_context_switch_does_not_retarget_bound_commands(self):
        socket={key:harness.docker_binding[key] for key in ('endpoint','socketDevice','socketInode','socketUid')}
        result=subprocess.CompletedProcess([],0,b'{}',b'')
        with patch.object(harness, 'local_socket_identity', return_value=socket), \
             patch.object(harness, 'daemon_identity', return_value='offline-daemon') as daemon, \
             patch.object(harness.subprocess, 'run', return_value=result) as run, patch.object(harness, 'record'):
            for context in ['local','remote-after-switch']:
                with patch.dict(os.environ, {'DOCKER_CONTEXT':context,'DOCKER_HOST':'ssh://remote.invalid'}, clear=True):
                    harness.execute(['docker','inspect','offline-container'],'offline-inspect')
        self.assertEqual(daemon.call_count,2)
        for call in run.call_args_list:
            self.assertEqual(call.args[0][:3],['docker','--host',socket['endpoint']])
            self.assertFalse(any(k.startswith('DOCKER_') for k in call.kwargs['env']))

    def test_replaced_socket_or_daemon_refused_before_container_operation(self):
        socket={key:harness.docker_binding[key] for key in ('endpoint','socketDevice','socketInode','socketUid')}
        for change, daemon in [(dict(socketInode=3),'offline-daemon'), ({},'replacement-daemon')]:
            with self.subTest(change=change,daemon=daemon), \
                 patch.object(harness, 'local_socket_identity', return_value=dict(socket,**change)), \
                 patch.object(harness, 'daemon_identity', return_value=daemon), \
                 patch.object(harness.subprocess, 'run') as run, self.assertRaises(RuntimeError):
                harness.execute(['docker','stop','offline-container'],'offline-stop')
            run.assert_not_called()

    def test_new_invocation_cannot_adopt_different_endpoint_or_daemon(self):
        harness.state={'dockerEndpoint':dict(harness.docker_binding)}
        for change in [dict(endpoint='unix:///offline/other.sock'),dict(daemonId='other-daemon'),dict(socketInode=3)]:
            selected=dict(harness.state['dockerEndpoint'],**change)
            with self.subTest(change=change), patch.object(harness,'resolve_docker_binding',return_value=selected), \
                 self.assertRaises(RuntimeError):
                harness.bind_docker()
            self.assertIsNone(harness.docker_binding)

    def test_binding_is_required_before_any_input_read(self):
        harness.docker_binding=None
        with patch.object(harness,'digest') as digest, patch.object(harness.gzip,'open') as stream, \
             patch.object(harness,'INPUT',Path('/offline/authorized.sql.gz'),create=True), self.assertRaises(RuntimeError):
            harness.prepare()
        digest.assert_not_called()
        stream.assert_not_called()

    def test_prepare_entrypoint_refuses_remote_before_reading_dump(self):
        with tempfile.TemporaryDirectory(prefix='om06-endpoint-check-', dir='/private/tmp') as directory:
            root=Path(directory)
            source=root/'authorized-fixture.sql.gz'
            argv=['officialMirrorDumpAcceptance.py','prepare','--dump',str(source)]
            original_digest=harness.digest
            def guarded_digest(path):
                if path==source:
                    raise AssertionError('dump_read_before_endpoint_validation')
                return original_digest(path)
            with patch.object(harness,'ROOT',root), patch.object(harness.sys,'argv',argv), \
                 patch.dict(os.environ,{'DOCKER_HOST':'ssh://remote.invalid'},clear=True), \
                 patch.object(harness.subprocess,'check_output',return_value=b'offline-source'), \
                 patch.object(harness,'digest',side_effect=guarded_digest), \
                 patch.object(harness.gzip,'open') as stream, patch.object(harness,'docker_probe') as probe, \
                 patch('builtins.print'), self.assertRaises(SystemExit) as failure:
                harness.main()
            self.assertEqual(failure.exception.code,1)
            stream.assert_not_called()
            probe.assert_not_called()
            failures=list(root.glob('.deploy/module06-data-audit/*/failure-*.json'))
            self.assertEqual(len(failures),1)
            self.assertEqual(json.loads(failures[0].read_text())['error'],
                             'docker_endpoint_nonlocal_or_unknown_transport_refused')
            self.assertFalse(list(root.glob('.deploy/module06-data-audit/*/input.json')))

    def test_unbound_existing_run_requires_explicit_readonly_adoption(self):
        selected=dict(harness.docker_binding)
        harness.state={}
        with patch.object(harness,'resolve_docker_binding',return_value=selected),self.assertRaises(RuntimeError):
            harness.bind_docker()
        self.assertIsNone(harness.docker_binding)
        with patch.object(harness,'resolve_docker_binding',return_value=selected):
            harness.bind_docker(allow_new=True)
        self.assertEqual(harness.docker_binding,selected)

    def test_all_daemon_command_forms_are_pinned(self):
        commands=[['inspect','fixture'],['exec','-i','fixture','pg_restore'],['exec','fixture','pg_dump'],
                  ['exec','-i','fixture','psql'],['stop','fixture'],['rm','fixture'],
                  ['run','--network','none','fixture'],['image','inspect','fixture']]
        with patch.object(harness,'check_docker_binding'):
            for command in commands:
                with self.subTest(command=command):
                    actual=harness.pin_docker(['docker',*command])
                    self.assertEqual(actual,['docker','--host',harness.docker_binding['endpoint'],*command])
            for option in ['--host','--context','-H','-c']:
                with self.subTest(option=option),self.assertRaises(RuntimeError):
                    harness.pin_docker(['docker',option,'other','inspect','fixture'])

    def test_bad_daemon_identity_diagnostics_are_suppressed(self):
        for output in [b'private-invalid-output',b'null',b'"invalid identity with spaces"']:
            with self.subTest(output=output),patch.object(harness,'docker_probe',return_value=output):
                with self.assertRaisesRegex(RuntimeError,'^docker_daemon_identity_invalid$'):
                    harness.daemon_identity('unix:///offline/socket')


if __name__=='__main__':
    unittest.main()
