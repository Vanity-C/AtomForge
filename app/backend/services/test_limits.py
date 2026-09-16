"""Test-plan defaults and bounded execution budgets, mirrored by the runner."""
import os

HARD_MAX_TEST_STEPS = 10000


def validate_max_steps(value):
    if type(value) is not int or not 2 <= value <= HARD_MAX_TEST_STEPS:
        raise ValueError(f'测试步骤上限必须是 2–{HARD_MAX_TEST_STEPS} 的整数')
    return value


def configured_max_steps():
    raw = os.getenv('ATOMFORGE_MAX_TEST_STEPS', '1000')
    if not raw.isascii() or not raw.isdecimal():
        raise ValueError('ATOMFORGE_MAX_TEST_STEPS 必须是 2–10000 的整数')
    return validate_max_steps(int(raw))


MAX_TEST_STEPS = configured_max_steps()


def test_timeout_seconds(step_count):
    # Allow each action its 2.5s timeout plus overhead, with time for mounting.
    return max(60, 30 + 3 * min(max(step_count, 0), HARD_MAX_TEST_STEPS))


def runner_request_timeout(step_count):
    # Browser deadline < runner watchdog (+30s) < HTTP read deadline (+60s).
    return test_timeout_seconds(step_count) + 60
