import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('watchdog', Path(__file__).with_name('runner-watchdog.py'))
watchdog = importlib.util.module_from_spec(spec)
spec.loader.exec_module(watchdog)


class RecoveryTests(unittest.TestCase):
    def observation(self, **values):
        return dict(id='runner-id', running=True, health='healthy', pids=20, limit=256, **values)

    def test_transient_failure_recovers_without_restart(self):
        bad = {**self.observation(), 'health':'unhealthy'}
        state, action = watchdog.evaluate({}, bad, 0)
        self.assertIsNone(action)
        state, action = watchdog.evaluate(state, self.observation(), 30)
        self.assertIsNone(state['bad_since'])
        self.assertIsNone(action)

    def test_persistent_unhealthy_even_when_health_http_cannot_respond(self):
        bad = {**self.observation(), 'health':'unhealthy'}
        state, _ = watchdog.evaluate({}, bad, 0)
        self.assertEqual(watchdog.evaluate(state, bad, 45)[1], 'unhealthy')

    def test_task_pressure_is_caught_even_if_healthcheck_says_healthy(self):
        bad = {**self.observation(), 'pids':236}
        state, _ = watchdog.evaluate({}, bad, 0)
        self.assertEqual(watchdog.evaluate(state, bad, 45)[1], 'process_pressure')

    def test_no_restart_for_a_valid_job_or_manually_stopped_container(self):
        for extra in [{'busy':True, 'active_for_ms':60000}, {'running':False}]:
            observation = {**self.observation(), 'health':'unhealthy', **extra}
            state, action = watchdog.evaluate({'container':'runner-id', 'bad_since':0}, observation, 200)
            self.assertIsNone(action)

    def test_cooldown_and_restart_ceiling_survive_new_container_id(self):
        bad = {**self.observation(), 'health':'unhealthy'}
        state = {'container':'runner-id', 'bad_since':0, 'restarts':[100]}
        self.assertEqual(watchdog.evaluate(state, bad, 210)[1], 'rate_limited')
        state['restarts'] = [10, 140, 270]
        self.assertEqual(watchdog.evaluate(state, bad, 500)[1], 'rate_limited')
        state, _ = watchdog.evaluate(state, {**bad, 'id':'new-runner'}, 510)
        self.assertEqual(len(state['restarts']), 3)
        self.assertIsNone(watchdog.evaluate(state, {**bad, 'id':'new-runner'}, 520)[1])
        self.assertEqual(watchdog.evaluate(state, {**bad, 'id':'new-runner'}, 560)[1], 'rate_limited')


if __name__ == '__main__':
    unittest.main()
