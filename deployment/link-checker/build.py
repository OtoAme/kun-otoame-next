#!/usr/bin/env python3
"""Verify a pinned archive, apply the bounded patch, test, then build in a new directory."""
import argparse
import hashlib
import json
import os
import pathlib
import shutil
import subprocess
import tarfile

ASSETS = pathlib.Path(__file__).resolve().parent
PIN = json.loads((ASSETS / 'pin.json').read_text())
OVERLAYS = {
    'provider_test.go': 'evaluation/provider_test.go',
    'http_test.go': 'evaluation/http_test.go',
    'outbound_test.go': 'internal/providerhttp/outbound_test.go',
}


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def run(command, cwd, environment, log_path, timeout=120):
    result = subprocess.run(command, cwd=cwd, env=environment, capture_output=True, timeout=timeout)
    log_path.write_bytes(result.stdout + result.stderr)
    if result.returncode:
        raise RuntimeError('command failed; see ' + str(log_path))
    return result.stdout


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--archive', type=pathlib.Path, required=True)
    parser.add_argument('--work-dir', type=pathlib.Path, required=True)
    parser.add_argument('--go', default='go')
    parser.add_argument('--goos')
    parser.add_argument('--goarch')
    args = parser.parse_args()
    archive_path = args.archive.resolve(strict=True)
    archive_bytes = archive_path.read_bytes()
    patch = ASSETS / 'hardening.patch'
    if sha256(archive_bytes) != PIN['archive_sha256'] or sha256(patch.read_bytes()) != PIN['patch_sha256']:
        raise RuntimeError('archive or patch hash mismatch')
    work = args.work_dir.absolute()
    if work.exists() or work.is_symlink():
        raise RuntimeError('work directory must be new; existing artifacts are preserved')
    if ASSETS.parents[1] in work.resolve().parents:
        raise RuntimeError('keep build source/cache/artifacts outside the repository')
    go = shutil.which(args.go)
    git = shutil.which('git')
    if not go or not git:
        raise RuntimeError('existing Go and git executables are required; no dependency install is performed')
    work.mkdir(parents=True, mode=0o700)
    source = work / 'source'
    source.mkdir()
    prefix = 'kungal-link-live-checker-' + PIN['revision']
    with tarfile.open(archive_path) as archive:
        for member in archive.getmembers():
            parts = pathlib.PurePosixPath(member.name).parts
            if not parts or parts[0] != prefix or '..' in parts:
                raise RuntimeError('archive path rejected')
            relative = parts[1:]
            if not relative or member.issym() or member.islnk() or any(p.startswith('.env') for p in relative):
                continue
            # Build only pinned Go source and license; never execute upstream scripts/instructions.
            name = '/'.join(relative)
            if member.isfile() and (name == 'go.mod' or name == 'LICENSE' or name.endswith('.go')):
                destination = source.joinpath(*relative)
                destination.parent.mkdir(parents=True, exist_ok=True)
                destination.write_bytes(archive.extractfile(member).read())
    for name in ('go-cache', 'go-path', 'go-tmp', 'bin'):
        (work / name).mkdir()
    environment = {
        'PATH': os.pathsep.join([str(pathlib.Path(go).parent), str(pathlib.Path(git).parent), '/usr/bin', '/bin']),
        'GOCACHE': str(work / 'go-cache'), 'GOPATH': str(work / 'go-path'),
        'GOMODCACHE': str(work / 'go-path' / 'pkg' / 'mod'), 'GOTMPDIR': str(work / 'go-tmp'),
        'GOTOOLCHAIN': 'local', 'GOPROXY': 'off', 'GOSUMDB': 'off', 'CGO_ENABLED': '0',
        'GIT_CONFIG_NOSYSTEM': '1', 'GIT_CONFIG_GLOBAL': '/dev/null',
    }
    run([git, 'apply', '--check', '--whitespace=error-all', str(patch)], source, environment, work / 'patch-check.log')
    run([git, 'apply', '--whitespace=error-all', str(patch)], source, environment, work / 'patch-apply.log')
    overlay_hashes = {}
    for name, destination in OVERLAYS.items():
        raw = (ASSETS / 'tests' / name).read_bytes()
        target = source / destination
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(raw)
        overlay_hashes[destination] = sha256(raw)
    tests = run([go, 'test', '-json', '-count=1', '-timeout=45s', './...'], source, environment, work / 'tests.jsonl')
    events = [json.loads(line) for line in tests.decode().splitlines() if line.startswith('{')]
    build_environment = dict(environment)
    if args.goos:
        build_environment['GOOS'] = args.goos
    if args.goarch:
        build_environment['GOARCH'] = args.goarch
    binary = work / 'bin' / 'llc'
    run([go, 'build', '-trimpath', '-buildvcs=false', '-o', str(binary), './cmd/server'], source, build_environment, work / 'build.log')
    go_version = run([go, 'version'], source, environment, work / 'go-version.log').decode().strip()
    metadata = run([go, 'version', '-m', str(binary)], source, environment, work / 'binary-metadata.log').decode()
    source_files = {p.relative_to(source).as_posix(): sha256(p.read_bytes()) for p in sorted(source.rglob('*')) if p.is_file()}
    manifest = {
        'upstream_repository': PIN['repository'], 'upstream_revision': PIN['revision'],
        'archive_sha256': PIN['archive_sha256'], 'patch_sha256': PIN['patch_sha256'],
        'regression_overlay_sha256': overlay_hashes,
        'source_tree_sha256': sha256(json.dumps(source_files, sort_keys=True, separators=(',', ':')).encode()),
        'source_file_sha256': source_files, 'binary_sha256': sha256(binary.read_bytes()),
        'go_version': go_version, 'binary_metadata': metadata,
        'test_passes': sum(e.get('Action') == 'pass' and 'Test' in e for e in events),
        'test_failures': sum(e.get('Action') == 'fail' and 'Test' in e for e in events),
        'live_provider_qualification': 'not established by synthetic tests',
    }
    (work / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    print(json.dumps({k: v for k, v in manifest.items() if k not in ('source_file_sha256', 'binary_metadata')}, indent=2))
    print('Artifact: ' + str(binary))


if __name__ == '__main__':
    main()
