"""Role-specific model turns with durable handoffs and a separate QA gate."""
import json
import uuid
from typing import Literal

from pydantic import BaseModel, Field, StrictBool, ValidationError, model_validator

from core.database import db_manager
from models.studio import StudioCloud, StudioRun
from services import studio, team_workflow as workflow
from services.leadership import LeadershipPlan, PLAN_PROMPT
from services.browser_tests import TEST_GUIDANCE, validate_tests


class Option(BaseModel):
    label: str = Field(min_length=1, max_length=100)
    description: str = Field(min_length=1, max_length=400)


class Question(BaseModel):
    kind: Literal['preference', 'user_requested', 'scope_conflict', 'external_dependency', 'irreversible'] = 'preference'
    question: str = Field(min_length=1, max_length=300)
    options: list[Option] = Field(min_length=2, max_length=3)
    recommended: int = Field(ge=0, le=2)
    reason: str = Field(min_length=1, max_length=400)

    @model_validator(mode='after')
    def valid_recommendation(self):
        if self.recommended >= len(self.options):
            raise ValueError('推荐选项不存在')
        return self


class Brief(BaseModel):
    # Presentation text must not reject an otherwise valid deliverable. Keep it
    # whole in the document; bound only the event's display preview.
    handoff: str = Field(default='')
    goal: str = Field(min_length=1, max_length=1500)
    tasks: list[str] = Field(min_length=1, max_length=16)
    acceptance: list[str] = Field(min_length=1, max_length=16)
    questions: list[Question | str] = Field(default_factory=list,max_length=3)


class Document(BaseModel):
    handoff: str = Field(default='')
    summary: str = Field(min_length=1, max_length=1500)
    items: list[str] = Field(min_length=1, max_length=20)
    questions: list[Question | str] = Field(default_factory=list, max_length=2)


class Review(BaseModel):
    handoff: str = Field(default='')
    approved: StrictBool
    summary: str = Field(min_length=1, max_length=1500)
    issues: list[str] = Field(max_length=10)
    tests: list[dict] = Field(min_length=2, max_length=48)


class TestDiagnosis(BaseModel):
    model_config = {'extra': 'forbid'}
    verdict: Literal['test_defect', 'application_defect']
    reason: str = Field(min_length=1, max_length=2000)
    tests: list[dict] = Field(default_factory=list, max_length=48)


ROLES = {
    'leader': ('团队领导', PLAN_PROMPT),
    'product': ('产品经理', '你是产品经理。把用户当前需求整理成可交接的需求说明，尊重现有功能和云配置，不扩大范围。返回 JSON {"goal":"目标","tasks":["具体任务"],"acceptance":["可验证的验收标准"]}，最多8项，另返回 questions 数组（最多3个影响范围、数据或核心交互的待确认问题；需求已清楚则为空）。列出明确默认方案，不询问用户已说明的内容。不声称已执行。'),
    'design': ('交互设计师', '你是交互设计师。基于需求说明和已有代码，规划页面层级、具体布局、配色、控件状态、空状态和窄屏交互，保持已有应用的视觉一致性。返回 JSON {"summary":"设计概述","items":["可供工程师直接实施的设计规范"]}，最多10项。不生成源码。'),
    'architect': ('技术架构师', '你是技术架构师。接收需求和设计，明确修改哪些文件、组件职责、状态与数据持久化方案，列出实现顺序和风险。只用平台允许的依赖和已启用云服务，保留未涉及的功能。返回 JSON {"summary":"架构概述","items":["具体文件、数据契约或技术决策"]}，最多10项。不生成源码。'),
    'engineer': ('应用工程师', studio.ENGINEER),
    'qa': ('测试工程师', '你是独立测试工程师。根据需求验收标准、实际源码和已经执行的构建日志进行审查，不直接修改代码。发现功能缺失或真实缺陷时拒绝通过，不因主观偏好扩大需求。返回 JSON {"approved":true或false,"summary":"审查结论","issues":["必须修复的问题"],"tests":[{"action":"visible|click|fill|text","selector":"实际源码中的CSS选择器","value":"输入或期望文字"}]}。必须提供2–8步独立、确定性的核心交互测试；各步骤按顺序在全新浏览器运行，不能依赖外部网络或登录成功。测试只能使用 visible/click/fill/text 四种动作，text 为包含匹配。所有问题都解决后 approved 才能为 true，此时 issues 为空。你提供的测试尚未执行，不得声称通过。'),
}

AGENT_NAMES = {'leader':'阿特拉斯（Atlas）','product': '米洛（Milo）', 'design': '露娜（Luna）', 'architect': '奥利（Ollie）', 'engineer': '尼奥（Neo）', 'qa': '皮普（Pip）'}
ROLES['product']=(ROLES['product'][0],ROLES['product'][1]+'\n区分用户描述的现状/缺陷与目标要求。例如“现在标签只能添加，不能删除，需要管理功能”是在报告缺少删除能力，不能改写为“禁止删除”。结合修复意图补齐缺失行为；只有用户明确说“不允许删除/不要删除功能”时才作为限制。')
ROLES['qa']=(ROLES['qa'][0],ROLES['qa'][1].replace('必须提供2–8步','建议提供2–16步（最多48步）')+'\n围绕用户本次新增或修复的核心行为安排实际操作和结果断言，不要只验证页面可见；最后一步必须为 visible 或 text 断言，不能以 click/fill 结束就声称验收覆盖。CSS selector 最多300字符。保留必要前置步骤，不要为了缩短测试而跳过核心验证。')
ROLES = {key: (label, '你是 AtomForge 团队的一员。\n' + prompt) for key, (label, prompt) in ROLES.items()}
CHOICE_PROMPT = '\n待确认 questions 必须为对象数组，替代字符串问题格式：[{"question":"一个真正影响方案且尚未确定的问题","options":[{"label":"具体方案A","description":"实际行为与取舍"},{"label":"具体方案B","description":"实际行为与取舍"}],"recommended":0,"reason":"结合用户需求推荐此项的理由"}]。每题2–3个互斥、可实施的选项，recommended是从0开始的推荐选项索引。不要把其他或继续思考放进options，界面统一提供。需求已明确的内容不要再问；没有待决策项则questions为空。方案默认采用推荐项。设计与架构最多各1题，不重复已经确认的细节。'
for role in ('product', 'design', 'architect'):
    ROLES[role] = (ROLES[role][0], ROLES[role][1] + CHOICE_PROMPT)

DECISION_POLICY = '\n只在确实阻塞实施时提问。questions 每题必须附 kind：user_requested（用户明确要求自己决定）、scope_conflict（核心业务规则冲突且无法从上下文判断）、external_dependency（缺少必须由用户提供的外部条件）、irreversible（涉及付费、公开发布、不可逆数据操作）或 preference（可自行决定）。默认不提问。配色、字体、周起始日、文件结构、技术选型、排错先后顺序、实现方法均由团队选择合理默认值并写入方案，禁止因此打断用户。已有 confirmed_choices、userDecisions 和 previousUserDecisions 已是答案，不重复询问；历史决定沿用到后续修改和修复，但用户本轮明确的新要求优先。需求/方案本身不需要例行审批；明确反馈直接执行，只有出现新的必要阻塞才提问。'
for role in ('product', 'design', 'architect'):
    ROLES[role] = (ROLES[role][0], ROLES[role][1] + DECISION_POLICY)


def blocking_questions(questions):
    return [q for q in questions if isinstance(q, dict) and q.get('kind') in {'user_requested', 'scope_conflict', 'external_dependency', 'irreversible'}]


def handoff_preview(message):
    """Only shorten the UI message; output.handoff remains the source of truth."""
    if len(message) <= 400:
        return message
    suffix = '…（完整交接见文档）'
    return message[:400-len(suffix)] + suffix


CONFIRMED_SCOPE = '\n以 request、approvedRequirements 和 approvedSolution 中已确认的方案为执行与验收依据。用户最新确认的修改优先于初始请求、旧历史、讨论建议和错误的验收反馈。不要用旧配色或已被替换的要求推翻已确认方案；不要自行扩大范围。'
CONFIRMED_SCOPE += '\n文档中的 confirmed_choices 是用户实际选择，优先于同一文档中的默认方案和备选项；实现与验收必须体现这些选择。'


def validate_review(raw):
    review = Review.model_validate(raw).model_dump()
    if review['approved'] and review['issues']:
        raise ValueError('测试工程师的通过结论与问题清单冲突')
    validate_tests(review['tests'])
    return review


# Replace the older four-action contract so roles do not receive conflicting rules.
ROLES['qa'] = (ROLES['qa'][0], ROLES['qa'][1].replace('visible|click|fill|text', 'visible|click|fill|text|hidden|enabled|disabled|reload|clear_storage')
    .replace('测试只能使用 visible/click/fill/text 四种动作，text 为包含匹配。', '')
    .replace('最后一步必须为 visible 或 text 断言', '最后一步必须为结果断言') + '\n' + TEST_GUIDANCE)


async def execute_team(run_id, owner, project_id, payload):
    from services.agent_profiles import snapshot,complete_team
    members=complete_team(payload.get('agents') or await snapshot(owner))
    async with db_manager.session() as db:
        saved = await db.get(StudioRun,run_id)
        documents = json.loads(saved.result).get('team',{})
        cloud = await db.get(StudioCloud, project_id)
        from services.connections import read_connection
        connection = await read_connection(db, project_id)
        config = {'enabled': bool(cloud and cloud.enabled), 'ai_enabled': bool(cloud and cloud.ai_enabled), 'collections': json.loads(cloud.collections) if cloud else {}}
        config['payments_enabled'] = bool(config['enabled'] and all(connection.get(k) for k in ['stripe_secret', 'stripe_webhook_secret', 'stripe_price_id', 'public_base_url']))

    draft_files = json.loads(saved.result).get('draft_files', payload['files'])
    resume_verification = json.loads(saved.result).get('resume_stage') == 'verification' and bool(documents.get('engineer'))

    async def persist():
        await studio.change(run_id, result={'team': documents, 'draft_files': draft_files})

    test_corrections = 0

    async def verify(files, tests, source):
        """Triage an interaction/protocol failure once, without handing code back.

        A correction is a fresh real execution, never a passed/skipped assertion.
        Other failures still take the normal application-repair path.
        """
        nonlocal test_corrections
        checked = await studio.checked_build(run_id, files, tests)
        candidate = checked.get('failure', {}).get('kind') == 'interaction' or checked.get('error', '').startswith('测试协议错误')
        if checked.get('ok') or not candidate or test_corrections >= 1:
            return checked
        test_corrections += 1
        await role_event('qa', '交互测试未通过，先核对测试前置条件与源码；本次诊断不修改应用代码。', stage='test', kind='activity')
        raw = await studio.call_model(owner, project_id, run_id, payload['model'], 'team_test_diagnosis',
            [{'role': 'system', 'content': '你是测试工程师，诊断交互步骤失败。仅当源码和已确认需求证明应用行为正确、测试前置条件或操作错误时返回 test_defect，并提供保留原验收目标的完整替代测试。真实缺陷、依据不足或业务结果断言错误返回 application_defect，不调整预期掩盖缺陷。不得删除失败场景，合法禁用行为要改成 disabled 断言，保留有效输入的成功路径。禁止返回或修改 files/edits/delete。只返回 JSON {"verdict":"test_defect|application_defect","reason":"引用源码和需求的具体证据","tests":[]}。\n' + TEST_GUIDANCE},
             {'role': 'user', 'content': json.dumps({'requirements': documents['product'], 'solution': context.get('approvedSolution'), 'currentFiles': files, 'tests': tests, 'failure': checked}, ensure_ascii=False)}],
            max_tokens=4200, temperature=.1)
        try:
            diagnosis = TestDiagnosis.model_validate(raw)
            if diagnosis.verdict != 'test_defect':
                await role_event('qa', diagnosis.reason, stage='test', kind='activity')
                return checked
            minimum = (await workflow.policy(run_id)).min_tests if source == 'qa' else 2
            corrected = validate_tests(diagnosis.tests, minimum=minimum)
        except (ValueError, ValidationError):
            return checked
        documents[source].setdefault('test_corrections', []).append({'reason': diagnosis.reason, 'before': tests, 'after': corrected, 'failure': checked.get('error')})
        documents[source]['tests'] = corrected
        await persist()
        await role_event('qa', '测试脚本已修正，保留验收目标并重新执行；应用源码未改动。', stage='test', kind='activity', output={'summary': diagnosis.reason, 'tests': corrected})
        return await studio.checked_build(run_id, files, corrected)

    async def role_event(role, message, state='running', stage=None, **extra):
        await studio.event(run_id, stage or role, message, role=role, state=state, **extra)

    async def checkpoint(key, role, title, output):
        from services.leadership import apply_feedback
        # Serialize entering a wait with feedback submission: it must either replan
        # now or observe awaiting_input and schedule a resume, never get stranded.
        async with studio.start_lock:
            await apply_feedback(run_id,locked=True)
            return await create_checkpoint(key,role,title,output)

    async def create_checkpoint(key, role, title, output):
        if not payload.get('interactive',True) or key in payload.get('confirmed',[]):
            return False
        import time
        from services.checkpoints import choices_for, schedule, TIMEOUT_SECONDS
        questions = documents.get('product', {}).get('questions', []) if key == 'requirements' else [q for doc in output.values() for q in doc.get('questions', [])][:3]
        questions = blocking_questions(questions)
        if not questions:
            await role_event(role, title+'已整理，按已知需求与合理默认方案继续。', 'done', kind='activity')
            return False
        manual_only = any(q.get('kind') in {'external_dependency', 'irreversible'} for q in questions)
        pending={'id':uuid.uuid4().hex,'key':key,'role':role,'title':title,'documents':output,'questions':questions,
            'choices': choices_for(questions), 'auto': {'paused': manual_only, 'deadline': None if manual_only else time.time() + TIMEOUT_SECONDS}}
        await workflow.move(run_id,role,'review',blocked='等待用户回答必要问题',locked=True)
        await role_event(role,'请审阅'+title+'，确认或提出修改后再继续。','waiting',kind='confirmation',recipient='user')
        await studio.change(run_id,status='awaiting_input',stage=key,result={'team':documents,'draft_files':draft_files,'pending':pending})
        schedule(owner, run_id, pending)
        return True

    async def handoff(sender,recipient,output):
        message=output.get('handoff') or f"{members[recipient]['name']}，这部分交给你了。"+(output.get('summary') or output.get('goal') or '请结合交接文档继续。')
        await role_event(sender,handoff_preview(message),'done',kind='handoff',recipient=recipient,output=output)

    async def turn(role, context, schema, max_tokens=2600):
        from services.agent_chat import discussion_context
        context={**context,'userDiscussions':await discussion_context(owner,project_id)}
        if role!='leader':await workflow.move(run_id,role,'doing','负责人直接拉取工作包')
        starts={'product':'我先理清目标和验收标准，再直接交给设计伙伴。','design':f"{members['product']['name']}，需求已收到。我来补齐页面、状态和操作体验。",'architect':f"{members['design']['name']}，我来承接设计，明确组件、数据契约和实现步骤。",'qa':f"{members['engineer']['name']}，我来对照需求检查实现，再安排独立测试。"}
        await role_event(role, starts.get(role,'我接着处理这部分，先核对已有的交接内容。'), model=payload['model'],kind='plan')
        try:
            raw = await studio.call_model(owner, project_id, run_id, payload['model'], 'team_'+role,
                [{'role': 'system', 'content': (('平台实现约束：入口' + studio.ENGINEER.split('入口', 1)[1] + '\n\n' + ROLES[role][1]) if role in {'design','architect'} else ROLES[role][1])+('\n你正在编写或修订需求。request 是用户本轮最新要求，优先于 originalRequest、旧历史和旧交接文档；发生冲突必须采用最新要求。完整保留未受影响的功能，把最新修改写入 goal、tasks 和 acceptance，直接交接实施；仅遇到新的必要阻塞才提问。' if role=='product' else CONFIRMED_SCOPE)},
                 {'role': 'user', 'content': json.dumps(context, ensure_ascii=False)}],
                max_tokens=max_tokens, temperature=payload.get('temperature', .35))
            try:
                output = schema(raw)
            except (ValidationError, ValueError) as validation_error:
                await role_event(role, '交接格式需要整理，正在自动修正后继续。', kind='activity')
                raw = await studio.call_model(owner, project_id, run_id, payload['model'], 'team_'+role,
                    [{'role':'system','content':ROLES[role][1] + CONFIRMED_SCOPE + '\n修正交接 JSON 的格式和字段，保持原有业务要求，不增加问题；只返回有效 JSON。'},
                     {'role':'user','content':json.dumps({'context':context,'previousOutput':raw,'validationError':str(validation_error)[:2500]},ensure_ascii=False)}],
                    max_tokens=max_tokens, temperature=.1)
                output = schema(raw)
        except studio.Replan:
            raise
        except Exception:
            await role_event(role, '本轮未完成，查看任务错误后可重新执行', 'error')
            raise
        documents[role] = output
        await persist()
        if role!='leader':await workflow.move(run_id,role,'review','结构化产出已保存，等待阶段门禁')
        await role_event(role, output.get('summary') or output.get('goal') or '产出已交接', 'running' if role == 'qa' else 'done', output=output)
        return output

    async def dispatch(role):
        assignment=next(s for s in documents['leader']['stages'] if s['role']==role)
        context['assignment']=assignment
        context['qualityPolicy']=(await workflow.policy(run_id)).model_dump()
        # Assignment is shared context; specialist handoffs drive the workflow.

    async def repair_order(failure, attempt):
        order={'summary':'依据独立测试证据修复，不扩大范围','items':[failure], 'attempt':attempt}
        if 'qa' in documents:documents['qa'].pop('verified',None)
        context['repairRequest']=order
        await persist()
        await role_event('qa','验收未通过，复现信息直接交给工程师修复。','recovering',stage='repair',kind='handoff',recipient='engineer',diagnostic=failure,output=order)

    context = {'request': payload['instruction'], 'history': payload['history'], 'currentFiles': payload['files'], 'cloud': config, 'handoffs': documents,'userDecisions':payload.get('decisions',[])}
    from services.agent_chat import decision_context
    context['previousUserDecisions'] = await decision_context(owner, project_id)
    latest_feedback=next((decision['feedback'] for decision in reversed(payload.get('decisions',[])) if decision.get('feedback','').strip()),'')
    if latest_feedback:
        context['originalRequest']=payload['instruction']
        context['request']=latest_feedback
    # Additional members are named collaborators, not mandatory pre-flight
    # model calls. Specific consultations remain available through role chat.
    if 'leader' not in documents:
        await role_event('leader','收到需求。我先拆分任务、安排负责人和把关人，再带团队推进。',kind='activity',recipient='user')
        await turn('leader',context,lambda r:LeadershipPlan.model_validate(r).model_dump(),3200)
    documents['leader']['stages']=LeadershipPlan.model_validate(documents['leader']).model_dump()['stages']
    await workflow.initialize(run_id,documents['leader'],members,documents)
    if 'product' not in documents:
        await dispatch('product')
        await turn('product', context, lambda r: Brief.model_validate(r).model_dump())
        await handoff('product','design',documents['product'])
    if await checkpoint('requirements','product','需求与验收标准',{'product':documents['product']}): return
    await workflow.move(run_id,'product','done','需求、任务及验收标准格式有效，必要问题已解决',acceptance=documents['product']['acceptance'])
    # Keep the original prompt in the durable payload, not as a competing downstream spec.
    context['request']=documents['product']['goal']
    context.pop('originalRequest',None)
    context['approvedRequirements']=documents['product']
    context['history']=[]
    documents['leader']['stages']=LeadershipPlan.model_validate(documents['leader']).model_dump()['stages']
    for assignment in documents['leader']['stages']:
        role=assignment['role']
        if role in {'design','architect'} and role not in documents:
            await dispatch(role)
            await turn(role,context,lambda r:Document.model_validate(r).model_dump())
            await handoff(role,'architect' if role=='design' else 'engineer',documents[role])
        if role=='design':await workflow.move(run_id,'design','done','设计规范已保存；最终体验由独立测试验证')
    if await checkpoint('solution','architect','设计与开发方案',{'design':documents['design'],'architect':documents['architect']}): return
    await workflow.move(run_id,'architect','done','技术方案已保存，必要的外部依赖已确认')
    context['approvedSolution']={'design':documents['design'],'architect':documents['architect']}
    if not resume_verification: await dispatch('engineer')
    files = draft_files
    failure = payload.get('previousError', '')
    # One initial verification plus the configured repair rounds. Read the
    # live policy at failure boundaries so strategy changes remain effective.
    for attempt in range(workflow.MAX_REPAIRS + 1):
        await workflow.move(run_id,'engineer','doing','实现工作包' if not attempt else '依据测试证据返工')
        if not (resume_verification and attempt == 0):
            await role_event('engineer', '接收需求、设计与架构，开始实现' if not attempt else f'接收验收反馈，第 {attempt} 次修复', stage='code' if not attempt else 'repair')
        active_role = 'engineer'
        try:
            if resume_verification and attempt == 0:
                patch = {'tests':documents['engineer'].get('tests',[])}
                await role_event('engineer','实现和交接已保存，直接继续验收，无需重新生成。','done')
            else:
                patch = await studio.call_model(owner, project_id, run_id, payload['model'], 'team_code' if not attempt else 'team_repair',
                    [{'role': 'system', 'content': studio.ENGINEER+CONFIRMED_SCOPE},
                     {'role': 'user', 'content': json.dumps({**context, 'currentFiles': files, 'previousError': failure}, ensure_ascii=False)}],
                    temperature=payload.get('temperature', .35))
                files = studio.merge_patch(files, patch)
                draft_files = files
                changed_paths=studio.patch_paths(patch)
                await role_event('engineer','增量修改完成，等待构建验证',kind='tool_result',tool='workspace.apply_patch',output={'files':[{'path':f['path'],'bytes':len(f['content'].encode())} for f in files if f['path'] in changed_paths],'deleted':patch.get('delete',[])})
                documents['engineer'] = {'summary': str(patch.get('summary', '实现已完成'))[:2000], 'items': changed_paths,'handoff':str(patch.get('handoff','')), 'tests':patch.get('tests',[])}
                await persist()
                await role_event('engineer', '代码已交接，开始构建与开发自测', 'done', output=documents['engineer'])
                await handoff('engineer','qa',documents['engineer'])
            await dispatch('qa')
            await workflow.move(run_id,'engineer','review','代码与开发自测输入已保存')
            active_role = 'qa'
            await role_event('qa', '运行构建与开发自测', stage='test')
            checked = await verify(files, patch.get('tests', []), 'engineer')
            for line in checked.get('logs', []):
                await role_event('qa', line, stage='test')
            if not checked['ok']:
                raise ValueError(checked.get('error', '构建或开发自测未通过'))
            if resume_verification and attempt == 0 and documents.get('qa',{}).get('approved'):
                review = validate_review(documents['qa'])
                await workflow.move(run_id,'qa','doing','继续已保存的独立验证')
                await workflow.move(run_id,'qa','review','复用独立审查报告')
            else:
                review = await turn('qa', {**context, 'currentFiles': files, 'buildLogs': checked.get('logs', [])}, validate_review, 3000)
            if not review['approved']:
                raise ValueError('独立验收要求修复：' + '; '.join(review['issues'] or [review['summary']]))
            quality=await workflow.policy(run_id)
            if len(review['tests'])<quality.min_tests:raise ValueError(f'战略门禁要求至少 {quality.min_tests} 个独立测试步骤，请补足核心操作与结果断言')
            await workflow.move(run_id,'engineer','verifying','开发自测与独立源码审查通过，执行独立验证')
            await workflow.move(run_id,'qa','verifying','独立审查通过，执行测试用例')
            await role_event('qa', '代码审查通过，执行测试工程师编写的独立测试', stage='test')
            checked = await verify(files, review['tests'], 'qa')
            for line in checked.get('logs', []):
                await role_event('qa', line, stage='test')
            if not checked['ok']:
                raise ValueError(checked.get('error', '独立浏览器测试未通过'))
            documents['qa']['verified'] = True
            await workflow.move(run_id,'qa','acceptance','独立浏览器测试实际执行通过')
            await workflow.move(run_id,'qa','done','独立审查与执行证据已保存')
            await workflow.move(run_id,'engineer','acceptance','独立 QA 通过，等待保存基线版本')
            await persist()
            await role_event('qa', '独立审查与浏览器测试通过，交付验收完成', 'done', output=documents['qa'])
            break
        except (ValueError, ValidationError) as exc:
            if isinstance(exc,studio.OutputLimitError): raise
            failure = str(exc)[:5000]
            quality=await workflow.policy(run_id)
            if attempt >= quality.max_repairs:
                await role_event('qa',f'达到自动修复上限（{quality.max_repairs} 次），升级领导协调范围、资源或外部依赖。','error',stage='repair',kind='handoff',recipient='leader',diagnostic=failure)
                await role_event(active_role,'这一轮还未通过验收，已保留草稿和交接进度，可从工作看板继续。','error',stage='error',diagnostic=failure)
                raise ValueError(f'达到修复上限（{quality.max_repairs} 次），仍未通过验收：' + failure) from exc
            await repair_order(failure,attempt+1)
            await dispatch('engineer')
    await studio.event(run_id, 'save', '团队验收通过，保存代码和构建产物')
    summary = documents['engineer']['summary']
    result = {'files': files, 'summary': summary, 'artifact': checked['artifact'], 'model': payload['model']}
    version = await studio.commit_result(owner, project_id, payload['base_version'], result, run_id)
    await workflow.move(run_id,'engineer','done','验收版本已保存：v'+str(version))
    await role_event('leader',summary+'；'+members['qa']['name']+' 已完成独立验收，我已安排保存为 v'+str(version)+'。你可以继续把反馈交给我。','done',kind='summary',recipient='user')
    await studio.change(run_id, status='done', stage='done', result={'version': version, 'summary': summary, 'plan': documents['product'], 'team': documents})
