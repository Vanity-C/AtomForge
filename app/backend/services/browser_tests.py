"""The bounded browser test contract shared by generation and QA."""
ASSERTIONS = {'visible', 'text', 'hidden', 'enabled', 'disabled'}
PAGE_ACTIONS = {'reload', 'clear_storage'}
ACTIONS = ASSERTIONS | PAGE_ACTIONS | {'click', 'fill'}

TEST_GUIDANCE = '''浏览器测试协议：支持 visible/text/hidden/enabled/disabled/click/fill，以及不需要 selector 的 reload、clear_storage。text 为包含匹配，fill/text 的 value 必须是字符串。最多 48 步，每次测试从隔离的空环境开始，按顺序执行；reload 真正重新加载应用并保留当前测试的 localStorage，clear_storage 只清除此测试的 localStorage，随后应 reload 验证空状态。最后一步必须是结果断言。
空值或空白输入导致按钮禁用时，应断言 disabled，不能点击禁用按钮或靠填空格绕过 trim 校验。若测试与正确的交互设计冲突，修正测试，不能取消禁用、放宽校验或修改业务逻辑来迎合测试。持久化通过正常 UI 操作→reload→UI 断言验证，禁止为了测试在应用中增加调试按钮、测试模式或后门。
开发自测覆盖不足不等于产品缺陷：QA 应补充独立测试并交给执行器验证，不要把缺少测试步骤作为必须改应用代码的理由。仅对明确的源码/业务缺陷拒绝源码审查；approved 仅代表源码审查通过，独立测试实际通过才完成验收。没有执行日志就不得声称已经复跑或验证。当前协议不支持任意脚本、修改系统时间或真实外部服务；无法自动验证的条件说明限制，不要虚构测试入口。'''


def validate_tests(tests, minimum=2):
    if not isinstance(tests, list) or not minimum <= len(tests) <= 48:
        raise ValueError(f'测试需要 {minimum}–48 个步骤')
    for test in tests:
        if not isinstance(test, dict) or test.get('action') not in ACTIONS:
            raise ValueError('测试工程师返回了不支持的测试动作')
        if test['action'] not in PAGE_ACTIONS and (
            not isinstance(test.get('selector'), str) or not test['selector'].strip() or len(test['selector']) > 300
        ):
            raise ValueError('测试工程师返回了无效的测试选择器')
        if test['action'] in {'fill', 'text'} and not isinstance(test.get('value'), str):
            raise ValueError('测试步骤缺少输入或期望文字')
    if not tests or tests[-1]['action'] not in ASSERTIONS:
        raise ValueError('独立测试需要在操作后验证实际结果，最后一步必须为结果断言')
    return tests
