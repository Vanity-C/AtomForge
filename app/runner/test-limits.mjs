// Keep defaults and execution budgets aligned with backend/services/test_limits.py.
export const HARD_MAX_TEST_STEPS = 10000;
export function validateMaxSteps(value) {
  if (!Number.isInteger(value) || value < 2 || value > HARD_MAX_TEST_STEPS) {
    throw Error('测试协议错误：测试步骤上限必须是 2–10000 的整数');
  }
  return value;
}
export function configuredMaxSteps(raw = process.env.ATOMFORGE_MAX_TEST_STEPS ?? '1000') {
  if (typeof raw !== 'string' || !/^[0-9]+$/.test(raw)) throw Error('ATOMFORGE_MAX_TEST_STEPS 必须是 2–10000 的整数');
  return validateMaxSteps(Number(raw));
}
export const MAX_TEST_STEPS = configuredMaxSteps();
export function testTimeoutMs(stepCount) {
  return Math.max(60, 30 + 3 * Math.min(Math.max(stepCount, 0), HARD_MAX_TEST_STEPS)) * 1000;
}
export function jobTimeoutMs(stepCount) { return testTimeoutMs(stepCount) + 30000; }
