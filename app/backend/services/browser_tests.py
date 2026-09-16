"""The bounded browser test contract shared by generation and QA."""
from services.test_limits import MAX_TEST_STEPS, validate_max_steps
ASSERTIONS = {'visible', 'text', 'hidden', 'enabled', 'disabled', 'attached', 'detached'}
PAGE_ACTIONS = {'reload', 'clear_storage'}
ACTIONS = ASSERTIONS | PAGE_ACTIONS | {'click', 'fill'}

TEST_GUIDANCE = '''浏览器测试协议：支持 visible/text/hidden/enabled/disabled/click/fill，以及不需要 selector 的 reload、clear_storage。text 为包含匹配，fill/text 的 value 必须是字符串。步数上限以本轮 testContract.max_total_steps 或 qualityPolicy.max_test_steps 为准，未指定时默认 __MAX_TEST_STEPS__ 步；上限不是必须凑齐的数量。每次测试从隔离的空环境开始，按顺序执行；reload 真正重新加载应用并保留当前测试的 localStorage，clear_storage 只清除此测试的 localStorage，随后应 reload 验证空状态。最后一步必须是结果断言。
另支持 attached（DOM 中存在）和 detached（DOM 中不存在），可以用属性选择器检查真实属性。visible/hidden 检查渲染可见性，不能替代存在性。text 读取 textContent，不读取 from/to/dur 等属性；属性断言应使用 attached 配合真实属性选择器，例如 #spin[dur="1s"]。SVG 的 animate/animateTransform/animateMotion/defs 等定义节点不直接渲染，必须使用 attached/detached；宿主 svg/g/path 的显示使用 visible。动画节点存在不代表实际动效已验证，无法覆盖的视觉效果写入 limitations。测试由 tests/scenarios 字段交给执行器，不要求 currentFiles 包含测试文件，不得为验收增加无业务用途的属性或调试入口。
空值或空白输入导致按钮禁用时，应断言 disabled，不能点击禁用按钮或靠填空格绕过 trim 校验。若测试与正确的交互设计冲突，修正测试，不能取消禁用、放宽校验或修改业务逻辑来迎合测试。持久化通过正常 UI 操作→reload→UI 断言验证，禁止为了测试在应用中增加调试按钮、测试模式或后门。
开发自测覆盖不足不等于产品缺陷：QA 应补充独立测试并交给执行器验证，不要把缺少测试步骤作为必须改应用代码的理由。仅对明确的源码/业务缺陷拒绝源码审查；approved 仅代表源码审查通过，独立测试实际通过才完成验收。没有执行日志就不得声称已经复跑或验证。当前协议不支持任意脚本、修改系统时间或真实外部服务；无法自动验证的条件说明限制，不要虚构测试入口。'''.replace('__MAX_TEST_STEPS__', str(MAX_TEST_STEPS))


def validate_tests(tests, minimum=2, maximum=MAX_TEST_STEPS):
    maximum = validate_max_steps(maximum)
    if not isinstance(tests, list):
        raise ValueError(f'测试需要 {minimum}–{maximum} 个步骤；实际 tests 不是数组')
    if not minimum <= len(tests) <= maximum:
        raise ValueError(f'测试需要 {minimum}–{maximum} 个步骤；实际收到 {len(tests)} 步')
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
