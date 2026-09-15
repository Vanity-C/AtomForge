#!/usr/bin/env python3
"""Host-side runner recovery, including a blocked event loop or exhausted PIDs.

Never exec inside the failing container. Never restart app/proxy or a manually
stopped runner. Logs contain operational counters only, no environment secrets.
"""
import argparse
import json
import os
from pathlib import Path
import subprocess
import time
import urllib.request

SETTLE_SECONDS = 45
COOLDOWN_SECONDS = 120
WINDOW_SECONDS = 900
MAX_RESTARTS = 3


def evaluate(previous, observation, now):
    state = dict(previous)
    history = [value for value in state.get('restarts', []) if now-value < WINDOW_SECONDS]
    state['restarts'] = history
    if state.get('container') != observation.get('id'):
        state.update(container=observation.get('id'), bad_since=None)
    # Never revive a deliberately stopped service or interrupt a healthy job.
    if not observation.get('running'):
        state['bad_since'] = None
        return state, None
    busy = observation.get('busy') and observation.get('active_for_ms', 0) < 90000
    pressure = (observation.get('pids') is not None and observation.get('limit', 0) > 0
                and observation['pids'] >= observation['limit']*.85)
    reason = ('process_pressure' if pressure else 'unhealthy') if (
        not busy and (pressure or observation.get('health') == 'unhealthy')) else None
    if not reason:
        state['bad_since'] = None
        return state, None
    if state.get('bad_since') is None:
        state['bad_since'] = now
    if now-state['bad_since'] < SETTLE_SECONDS:
        return state, None
    if history and (now-history[-1] < COOLDOWN_SECONDS or len(history) >= MAX_RESTARTS):
        return state, 'rate_limited'
    return state, reason


def docker(*args, timeout=10):
    env = {**os.environ, 'DOCKER_HOST': 'unix:///var/run/docker.sock'}
    result = subprocess.run(['docker', *args], env=env, capture_output=True,
                            text=True, timeout=timeout, check=True)
    return result.stdout.strip()


def process_count(pid):
    """Read the actual container task controller on either cgroup version."""
    try:
        for line in Path(f'/proc/{pid}/cgroup').read_text().splitlines():
            _, controllers, relative = line.split(':', 2)
            root = Path('/sys/fs/cgroup') if not controllers else Path('/sys/fs/cgroup/pids')
            if controllers and 'pids' not in controllers.split(','):
                continue
            path = (root / relative.lstrip('/') / 'pids.current').resolve()
            if root.resolve() not in path.parents:
                continue
            return int(path.read_text().strip())
    except (OSError, ValueError):
        pass
    return None


def inspect(project):
    ids = docker('ps', '-q', '--filter', f'label=com.docker.compose.project={project}',
                 '--filter', 'label=com.docker.compose.service=runner').split()
    if len(ids) != 1:
        return {'id': None, 'running': False}
    item = json.loads(docker('inspect', ids[0]))[0]
    current = item['State']
    result = {'id': item['Id'], 'running': current['Running'],
              'health': current.get('Health', {}).get('Status', 'unknown'),
              'pids': process_count(current['Pid']), 'limit': item['HostConfig'].get('PidsLimit') or 0}
    address = next((v['IPAddress'] for v in item['NetworkSettings']['Networks'].values() if v.get('IPAddress')), None)
    if address:
        try:
            # Disable proxy inheritance for this private Docker network probe.
            opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
            with opener.open(f'http://{address}:8001/health', timeout=2) as response:
                health = json.load(response)
            result.update(busy=bool(health.get('busy')), active_for_ms=health.get('active_for_ms', 0))
        except (OSError, ValueError):
            pass
    return result


def main():
    import fcntl  # Host service is Linux-only; evaluate() is portable for tests.
    parser = argparse.ArgumentParser()
    parser.add_argument('--project', default='atomforge-production')
    parser.add_argument('--state-file', default='/var/lib/atomforge-runner-watchdog/state.json')
    parser.add_argument('--dry-run', action='store_true')
    args = parser.parse_args()
    path = Path(args.state_file)
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    with path.with_suffix('.lock').open('a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return
        previous = json.loads(path.read_text()) if path.exists() else {}
        observation = inspect(args.project)
        now = time.time()
        state, action = evaluate(previous, observation, now)
        if action and action != 'rate_limited' and not args.dry_run:
            # Recheck the exact container immediately before the side effect.
            fresh = json.loads(docker('inspect', observation['id']))[0]
            if fresh['State']['Running'] and not fresh['State'].get('Restarting'):
                # Persist the attempt BEFORE restart, so crashes/timeouts cannot
                # bypass cooldown or create an unbounded restart loop.
                state['restarts'].append(now)
                state['bad_since'] = None
                temp = path.with_suffix('.tmp')
                temp.write_text(json.dumps(state))
                temp.replace(path)
                docker('restart', '--time', '10', observation['id'], timeout=25)
        temp = path.with_suffix('.tmp')
        temp.write_text(json.dumps(state))
        temp.replace(path)
        if action or args.dry_run:
            print(json.dumps({'action': action or 'healthy', 'dry_run': args.dry_run,
                              'observation': observation, 'restart_attempts_15m': len(state['restarts'])}), flush=True)


if __name__ == '__main__':
    main()
