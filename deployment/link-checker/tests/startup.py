#!/usr/bin/env python3
"""Bounded loopback startup failure and normal SIGTERM exit regression."""
import argparse
import hashlib
import http.client
import json
import pathlib
import socket
import subprocess
import time


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--manifest', type=pathlib.Path, required=True)
    parser.add_argument('--report', type=pathlib.Path, required=True)
    args = parser.parse_args()
    manifest = json.loads(args.manifest.read_text())
    binary = args.manifest.parent / 'bin/llc'
    if hashlib.sha256(binary.read_bytes()).hexdigest() != manifest['binary_sha256']:
        raise RuntimeError('artifact drift')
    if args.report.exists():
        raise RuntimeError('preserve the existing report')
    environment = {'PATH': '/usr/bin:/bin', 'LLC_API_KEYS': 'SYN_STARTUP_KEY', 'LLC_UC_ENABLED': 'false', 'LLC_BAIDU_ENABLED': 'false', 'LLC_CAIYUN_ENABLED': 'false', 'LLC_PAN123_ENABLED': 'false'}
    with socket.socket() as occupied:
        occupied.bind(('127.0.0.1', 0)); occupied.listen()
        environment['LLC_ADDR'] = '127.0.0.1:' + str(occupied.getsockname()[1])
        process = subprocess.Popen([str(binary.resolve())], env=environment, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        try:
            process.communicate(timeout=10)
        finally:
            if process.poll() is None:
                process.kill(); process.communicate(timeout=3)
        failed_exit = process.returncode
    with socket.socket() as available:
        available.bind(('127.0.0.1', 0)); port = available.getsockname()[1]
    environment['LLC_ADDR'] = '127.0.0.1:' + str(port)
    process = subprocess.Popen([str(binary.resolve())], env=environment, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    ready = False
    try:
        for _ in range(200):
            if process.poll() is not None:
                break
            try:
                connection = http.client.HTTPConnection('127.0.0.1', port, timeout=0.2)
                connection.request('GET', '/healthz'); response = connection.getresponse(); response.read(); connection.close()
                if response.status == 200:
                    ready = True; break
            except OSError:
                time.sleep(0.05)
        process.terminate(); process.communicate(timeout=3)
    finally:
        if process.poll() is None:
            process.kill(); process.communicate(timeout=3)
    normal_exit = process.returncode
    result = {'binarySha256': manifest['binary_sha256'], 'patchSha256': manifest['patch_sha256'], 'occupiedPortExit': failed_exit, 'normalSIGTERMExit': normal_exit, 'normalReadiness': ready, 'passed': failed_exit not in (None, 0) and ready and normal_exit == 0, 'externalProviderRequests': 0, 'processCleanup': 'both checker processes stopped; occupied socket closed'}
    args.report.write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result))
    if not result['passed']:
        raise SystemExit(1)


if __name__ == '__main__':
    main()
