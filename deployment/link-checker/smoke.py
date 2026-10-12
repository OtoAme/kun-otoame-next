#!/usr/bin/env python3
"""Exercise the exact built binary over loopback with synthetic inputs only."""
import argparse
import hashlib
import http.client
import json
import pathlib
import socket
import subprocess
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

KEY = 'SYNTHETIC_BINARY_SMOKE_KEY'


def request(port, method, path, payload=None, key=None):
    connection = http.client.HTTPConnection('127.0.0.1', port, timeout=3)
    headers = {'Content-Type': 'application/json'}
    if key is not None:
        headers['Authorization'] = 'Bearer ' + key
    body = json.dumps(payload) if payload is not None else None
    connection.request(method, path, body, headers)
    response = connection.getresponse()
    raw = response.read(8193)
    result = {'httpStatus': response.status, 'cacheControl': response.getheader('Cache-Control'), 'response': json.loads(raw)}
    connection.close()
    return result


class SyntheticEndpoint(BaseHTTPRequestHandler):
    calls = 0

    def log_message(self, *_):
        pass

    def do_POST(self):
        type(self).calls += 1
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b'{"code":41004}')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--manifest', type=pathlib.Path, required=True)
    parser.add_argument('--report', type=pathlib.Path, required=True)
    args = parser.parse_args()
    manifest = json.loads(args.manifest.read_text())
    binary = args.manifest.parent / 'bin' / 'llc'
    if hashlib.sha256(binary.read_bytes()).hexdigest() != manifest['binary_sha256']:
        raise RuntimeError('artifact hash mismatch')
    if args.report.exists():
        raise RuntimeError('preserve the existing smoke report')
    args.report.parent.mkdir(parents=True, exist_ok=True)
    fixture = ThreadingHTTPServer(('127.0.0.1', 0), SyntheticEndpoint)
    thread = threading.Thread(target=fixture.serve_forever, daemon=True)
    thread.start()
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0)); port = sock.getsockname()[1]
    environment = {
        'PATH': '/usr/bin:/bin', 'LLC_ADDR': '127.0.0.1:' + str(port),
        'LLC_API_KEYS': KEY, 'LLC_CHECK_TIMEOUT': '200ms',
        'LLC_CACHE_TTL_ALIVE': '0s', 'LLC_CACHE_TTL_DEAD': '0s', 'LLC_CACHE_TTL_UNKNOWN': '0s',
        'LLC_BATCH_MAX': '1', 'LLC_RATE_RPS': '1', 'LLC_RATE_BURST': '1',
        'LLC_QUARK_VERIFY_DETAIL': 'true', 'LLC_QUARK_BLOCKED_AS_DEAD': 'false',
        'LLC_UC_ENABLED': 'true', 'LLC_UC_TOKEN_URL': 'http://127.0.0.1:' + str(fixture.server_port),
        'LLC_UC_DETAIL_URL': 'http://127.0.0.1:' + str(fixture.server_port),
        'LLC_BAIDU_ENABLED': 'false', 'LLC_CAIYUN_ENABLED': 'false', 'LLC_PAN123_ENABLED': 'false',
    }
    rows = []
    log_path = args.report.with_suffix('.service.log')
    try:
        with log_path.open('w') as log:
            process = subprocess.Popen([str(binary.resolve())], env=environment, cwd=args.report.parent, stdout=log, stderr=log)
            try:
                for _ in range(200):
                    if process.poll() is not None:
                        raise RuntimeError('checker exited before readiness')
                    try:
                        health = request(port, 'GET', '/healthz')
                        if health['httpStatus'] == 200:
                            break
                    except OSError:
                        time.sleep(0.05)
                else:
                    raise RuntimeError('readiness deadline')
                cases = [('health', health, 200)]
                synthetic = {'url': 'https://drive.uc.cn/s/SYNTHETIC', 'passcode': 'SYN_CODE_CANARY'}
                cases.append(('missing-auth', request(port, 'POST', '/v1/check', synthetic), 401))
                cases.append(('wrong-auth', request(port, 'POST', '/v1/check', synthetic, 'SYN_WRONG'), 401))
                cases.append(('empty-url', request(port, 'POST', '/v1/check', {'url': ''}, KEY), 400))
                for name, url in [('private-url', 'https://127.0.0.1/SYN'), ('userinfo', 'https://SYN:SYN@drive.uc.cn/s/SYN'), ('non-default-port', 'https://drive.uc.cn:9443/s/SYN'), ('arbitrary-123-host', 'https://arbitrary.123pan.com/s/SYN')]:
                    result = request(port, 'POST', '/v1/check', {'url': url}, KEY)
                    cases.append((name, result, 200))
                    if result['response']['reason'] != 'unsupported_provider':
                        raise RuntimeError('unapproved input admitted')
                result = request(port, 'POST', '/v1/check', synthetic, KEY)
                cases.append(('configured-loopback-endpoint-rejected', result, 200))
                if result['response']['status'] != 'unknown' or SyntheticEndpoint.calls != 0:
                    raise RuntimeError('runtime endpoint override bypassed outbound policy')
                for name, result, expected in cases:
                    passed = result['httpStatus'] == expected and result['cacheControl'] == 'private, no-store'
                    row = {'name': name, 'passed': passed, **result}; rows.append(row)
                    if not passed:
                        raise RuntimeError('HTTP contract regression')
            finally:
                process.terminate()
                try:
                    process.wait(timeout=3)
                except subprocess.TimeoutExpired:
                    process.kill(); process.wait(timeout=3)
    finally:
        fixture.shutdown(); fixture.server_close(); thread.join(timeout=1)
    logs = log_path.read_text()
    if any(canary in logs for canary in [KEY, 'SYN_CODE_CANARY', 'https://', 'http://']):
        raise RuntimeError('private canary in binary logs')
    report = {'revision': manifest['upstream_revision'], 'patchSha256': manifest['patch_sha256'], 'binarySha256': manifest['binary_sha256'], 'passed': len(rows), 'failed': 0, 'cases': rows, 'externalProviderRequests': 0, 'fixtureProviderCalls': SyntheticEndpoint.calls, 'processCleanup': 'checker and fixture stopped'}
    args.report.write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({k: v for k, v in report.items() if k != 'cases'}))


if __name__ == '__main__':
    main()
