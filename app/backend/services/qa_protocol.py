"""Bounded QA-only recovery; never substitute an empty or truncated test suite."""
from services.browser_tests import ACTIONS, ASSERTIONS
from services.qa_review import (
    MAX_REVIEW_STEPS, MAX_SCENARIOS, ReviewProtocolError,
    validate_review, validate_review_decision,
)

MAX_CORRECTIONS = 3


def test_contract(minimum, maximum=MAX_REVIEW_STEPS):
    return {'min_total_steps': minimum, 'max_total_steps': maximum,
            'min_steps_per_scenario': 2, 'max_scenarios': MAX_SCENARIOS,
            'actions': sorted(ACTIONS), 'final_actions': sorted(ASSERTIONS),
            'approved_means': 'source_review_only', 'tests_are_executed_by': 'runner'}


def diagnostic(raw, error, minimum, maximum=MAX_REVIEW_STEPS):
    raw = raw if isinstance(raw, dict) else {}
    scenarios = raw.get('scenarios')
    counts = [{'name': item.get('name'), 'steps': len(item['tests']) if isinstance(item.get('tests'), list) else None}
              for item in scenarios if isinstance(item, dict)] if isinstance(scenarios, list) else []
    return {'error': str(error)[:2500], 'tests_count': len(raw['tests']) if isinstance(raw.get('tests'), list) else None,
            'scenarios': counts, 'total_scenario_steps': sum(item['steps'] or 0 for item in counts),
            'contract': test_contract(minimum, maximum)}


async def complete_review(raw, *, minimum, request, on_invalid, maximum=MAX_REVIEW_STEPS):
    """Keep a valid source decision immutable while repairing only test fields.

    request receives exact counts and a small repair instruction. on_invalid
    persists the latest failed report with its source revision for later resume.
    """
    decision = None
    required_names = []
    response_error = None
    for attempt in range(MAX_CORRECTIONS + 1):
        if decision is None:
            try:
                decision = validate_review_decision(raw)
            except ValueError:
                pass
        if not required_names and isinstance(raw, dict):
            plans = raw.get('scenarios')
            if isinstance(plans, list) and 0 < len(plans) <= MAX_SCENARIOS:
                names = [s.get('name', '').strip() for s in plans if isinstance(s, dict) and isinstance(s.get('name'), str)]
                if len(names) == len(plans) and all(names) and len({n.casefold() for n in names}) == len(names):
                    required_names = names
        try:
            if response_error is not None:
                raise response_error
            review = validate_review(raw, minimum=minimum, maximum=maximum)
            returned_names = {s['name'].strip() for s in review['scenarios']}
            if any(name not in returned_names for name in required_names):
                raise ValueError('纠正测试不能遗漏原独立场景：' + '、'.join(required_names))
            return review
        except ValueError as error:
            details = diagnostic(raw, error, minimum, maximum)
            await on_invalid(raw, details, attempt)
            if attempt == MAX_CORRECTIONS:
                raise ReviewProtocolError('验收测试计划自动纠正后仍未就绪；源码和报告已保留，可继续验收：' + details['error']) from error
        repair = {'mode': 'tests_only' if decision else 'full_report',
                  'previousOutput': raw, 'validationError': details['error'],
                  'diagnostic': details, 'requiredScenarioNames': required_names,
                  'instruction': f'保持已确认验收目标，修正实际出错字段。tests/scenarios 必须包含可执行步骤，全部场景合计不超过{maximum}步，每场景至少2步且以断言结束。保留全部独立场景及核心断言，精简重复检查，禁止直接截断数组或复制步骤凑数。不得修改源码、删除缺陷或声称未执行的测试已经通过。'}
        if decision:
            repair['instruction'] += ' 源码结论已保存，本次仅返回 {"scenarios":[{"name":"原场景名称","tests":[完整步骤]}]} 或旧单场景 {"tests":[完整步骤]}，不必重写审查长文。'
        else:
            repair['instruction'] += ' 返回完整报告。approved 仅表示源码审查：没有具体源码缺陷时设 true，不能因尚未执行测试或缺少测试文件而拒绝。'
        try:
            corrected = await request(repair)
        except ValueError as error:
            # A malformed JSON correction still belongs to QA, not engineering.
            response_error = error
            continue
        response_error = None
        raw = {**decision, 'tests': corrected.get('tests', []), 'scenarios': corrected.get('scenarios', [])} if decision and isinstance(corrected, dict) else corrected
