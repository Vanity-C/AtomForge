"""Collect a candidate's review and isolated scenarios before one repair handoff."""
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, StrictBool

from services.browser_tests import MAX_TEST_STEPS, validate_tests
from services.test_limits import HARD_MAX_TEST_STEPS, validate_max_steps


MAX_SCENARIOS = 6
MAX_REVIEW_STEPS = MAX_TEST_STEPS


class Scenario(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    tests: list[dict] = Field(min_length=2, max_length=HARD_MAX_TEST_STEPS)


class ReviewIssue(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    description: str = Field(min_length=1)
    type: Literal['functionality', 'data', 'ui', 'performance', 'security', 'compatibility', 'build', 'test', 'other', 'unknown']
    severity: Literal['critical', 'high', 'medium', 'low', 'unknown']
    location: str = ''
    reproduction: str = ''
    expected: str = ''
    actual: str = ''
    evidence: str = ''
    source: str = 'source_review'
    scenario: str = ''
    disposition: Literal['blocker', 'advisory', 'pending'] = 'pending'
    requirement: str = ''
    impact: str = ''
    reason: str = ''


class ReviewDecision(BaseModel):
    handoff: str = ''
    approved: StrictBool
    summary: str = Field(min_length=1, max_length=1500)
    issues: list[str | ReviewIssue] = Field(max_length=48)
    issueDetails: list[ReviewIssue] = Field(default_factory=list, max_length=48)
    limitations: list[str] = Field(default_factory=list, max_length=16)
    advisories: list[ReviewIssue] = Field(default_factory=list, max_length=48)


class Review(ReviewDecision):
    tests: list[dict] = Field(default_factory=list, max_length=HARD_MAX_TEST_STEPS)
    scenarios: list[Scenario] = Field(default_factory=list, max_length=MAX_SCENARIOS)


class ReviewProtocolError(ValueError):
    """An invalid QA handoff is not a request to change application code."""


def unique_issues(issues):
    result, seen = [], set()
    for issue in issues:
        text = str(issue).strip()
        key = ' '.join(text.split()).casefold()
        if text and key not in seen:
            seen.add(key)
            result.append(text)
    return result


class ReviewFailures(ValueError):
    def __init__(self, issues):
        self.issues = unique_issues(issues)
        super().__init__('；'.join(self.issues))


def validate_review_decision(raw):
    review = ReviewDecision.model_validate(raw).model_dump()
    details = [issue for issue in review['issues'] if isinstance(issue, dict)] + review['issueDetails']
    review['issues'] = unique_issues(issue['description'] if isinstance(issue, dict) else issue for issue in review['issues'])
    review['issueDetails'] = issue_details(review['issues'], details)
    if review['approved'] and review['issues']:
        raise ValueError('测试工程师的通过结论与问题清单冲突')
    if not review['approved'] and not review['issues']:
        raise ValueError('源码审查拒绝通过却未列出源码缺陷；尚未执行测试或缺少测试文件不属于源码缺陷。无源码缺陷时 approved 应为 true，执行结果由执行器判定')
    return review


def validate_review(raw, minimum=2, maximum=MAX_REVIEW_STEPS):
    maximum = validate_max_steps(maximum)
    # Validate the plan first so missing/oversized plans have actionable counts,
    # including the total across independent scenarios rather than only each list.
    if isinstance(raw, dict):
        scenarios = raw.get('scenarios')
        if isinstance(scenarios, list) and scenarios:
            for index, scenario in enumerate(scenarios):
                if isinstance(scenario, dict):
                    try:
                        validate_tests(scenario.get('tests'), maximum=maximum)
                    except ValueError as error:
                        raise ValueError(f"场景 {index+1}（{scenario.get('name', '未命名')}）：{error}") from error
            total = sum(len(s.get('tests', [])) for s in scenarios if isinstance(s, dict))
            if not minimum <= total <= maximum:
                raise ValueError(f'全部场景合计需要 {minimum}–{maximum} 个步骤；实际 {len(scenarios)} 个场景共 {total} 步')
        else:
            validate_tests(raw.get('tests', []), minimum=minimum, maximum=maximum)
    review = Review.model_validate(raw).model_dump()
    review.update(validate_review_decision(raw))
    scenarios = review['scenarios']
    if scenarios:
        names = [scenario['name'].strip().casefold() for scenario in scenarios]
        if not all(names) or len(names) != len(set(names)):
            raise ValueError('独立测试场景名称不能为空或重复')
        steps = []
        for scenario in scenarios:
            steps.extend(validate_tests(scenario['tests'], maximum=maximum))
        if review['tests'] and review['tests'] != steps:
            raise ValueError('使用 scenarios 时不要另附不同的 tests，避免遗漏测试')
        review['tests'] = steps  # Keep legacy history/UI readers compatible.
    validate_tests(review['tests'], minimum=minimum, maximum=maximum)
    return review


def issue_details(issues, details=()):
    """Keep repair strings compatible while preserving evidence-backed metadata."""
    def key(text):
        return ' '.join(text.split()).casefold()
    by_text = {key(item['description']): item for item in details}
    return [ReviewIssue.model_validate(by_text.get(key(text), {'description': text, 'type': 'unknown', 'severity': 'unknown', 'source': 'legacy'})).model_dump()
            for text in unique_issues(issues)]


def execution_issue(checked, description, source, scenario=''):
    # A failed assertion proves verification failed, not the business severity.
    return {'description': description, 'type': 'test' if checked.get('failure') else 'build',
            'severity': 'unknown', 'source': source, 'scenario': scenario,
            'actual': checked.get('error', ''), 'evidence': '\n'.join(checked.get('logs', []))}


def review_scenarios(review):
    return review.get('scenarios') or [{'name': '独立验收', 'tests': review['tests']}]


def execution_evidence(checked):
    """Keep evidence, never duplicate the compiled application in each report."""
    return {key: checked[key] for key in ('ok', 'logs', 'error', 'failure') if key in checked}


def can_test_independently(checked):
    # A failed interaction/assertion does not stop other isolated scenarios.
    # No browser evidence means compilation or mounting may be blocked.
    return bool(checked.get('ok') or checked.get('failure', {}).get('kind') in {'interaction', 'assertion'}
                or checked.get('error', '').startswith('测试协议错误'))


BATCH_REVIEW_GUIDANCE = '''本轮采用集中验收、一次返工。先通读 currentFiles 全部文件，逐项核对已确认验收标准及相关设计/技术约定，再输出结论；不能发现第一个问题就结束审查。按需求检查核心成功路径、空状态、无效/边界输入、状态切换、数据增删改与持久化，以及受影响的既有功能；仅在需求涉及的范围内检查，不新增要求。
approved 只表示源码审查结论，绝不能因独立测试尚未执行、开发自测脚本错误或 currentFiles 中没有测试文件而设为 false。无可确认的源码缺陷时 approved=true、issues=[]，但必须提供 tests 或 scenarios；实际验收是否通过由执行器决定。拒绝源码审查必须在 issues 中列出有依据的具体源码缺陷。
issues 中每项必须返回结构化对象：{"description":"具体问题描述","type":"functionality|data|ui|performance|security|compatibility|other","severity":"critical|high|medium|low|unknown","location":"文件或页面位置","reproduction":"复现条件与步骤","expected":"预期结果","actual":"实际结果","evidence":"源码或执行证据"}。type 按根因选择：功能、数据、界面、性能、安全、兼容性或其他。severity 按实际用户影响评定：critical 为应用不可用、严重数据损坏或安全漏洞；high 为核心功能无法完成；medium 为局部功能异常；low 为轻微问题；证据不足以定级时明确 unknown。严重等级是说明字段，不改变已确认验收范围；非阻塞建议仍放 limitations。不要只返回问题数量或把未知影响编造成严重缺陷。
issues 一次列出当前源码中能够确认的全部真实缺陷，不限制为少数代表问题；同一根因合并，按影响排序。每项写明位置、复现条件、预期与实际、影响及修复后如何验证。修复后重新核对当前源码和完整验收范围，不能机械沿用旧结论。主观优化建议和无法验证的外部条件放 limitations，不伪装成必须返工的源码缺陷。
优先返回 scenarios，格式为 [{"name":"独立场景名称","tests":[测试步骤]}]，通常按独立业务能力划分 2–6 个场景，简单应用可只用 1 个。每个场景从全新隔离浏览器及空存储开始，必须自带前置操作并以断言结束，不得依赖别的场景创建的数据。每个场景至少 2 步，所有场景合计上限以 testContract.max_total_steps 为准，不为凑数量重复测试。使用 scenarios 时不另写 tests；旧版单场景 tests 格式仍兼容。单个场景失败会停止该场景的依赖步骤，其他独立场景继续执行，最终合并反馈。
即使源码审查 approved=false，也应提供能实际执行的独立场景，让本轮尽量发现其他问题；不能因为已找到缺陷就省略其他检查。编译或挂载阻塞、测试协议无法覆盖的要求在 limitations 说明，不能声称已全部测试或保证不存在遗漏。缺少测试步骤由你补齐，不要求工程师改正确的业务代码。summary 此时只表示源码审查，实际测试结果由执行器补充，最终报告完成后才统一交给工程师。'''

REPAIR_GUIDANCE = '''repairRequest.items 是上一轮汇总、去重后的完整缺陷清单。先逐项定位关联根因，一次修复所有可处理的问题及受影响的回归场景，再交付完整结果，不只修第一项就交回测试。逐项核对修复后的源码与原验收目标；确实无法处理的项在 summary 说明原因，不能声称已全部修复或修改测试预期来掩盖缺陷。'''
