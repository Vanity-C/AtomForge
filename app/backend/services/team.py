"""Role-specific model turns with durable handoffs and a separate QA gate."""
import json
import uuid
from typing import Literal

from pydantic import BaseModel, Field, StrictBool, ValidationError, model_validator

from core.database import db_manager
from models.studio import StudioCloud, StudioRun
from services import studio


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
    goal: str = Field(min_length=1, max_length=1500)
    tasks: list[str] = Field(min_length=1, max_length=16)
    acceptance: list[str] = Field(min_length=1, max_length=16)
    questions: list[Question | str] = Field(default_factory=list,max_length=3)


class Document(BaseModel):
    summary: str = Field(min_length=1, max_length=1500)
    items: list[str] = Field(min_length=1, max_length=20)
    questions: list[Question | str] = Field(default_factory=list, max_length=2)


class Review(BaseModel):
    approved: StrictBool
    summary: str = Field(min_length=1, max_length=1500)
    issues: list[str] = Field(max_length=10)
    tests: list[dict] = Field(min_length=2, max_length=48)


ROLES = {
    'product': ('产品经理', '你是产品经理。把用户当前需求整理成可交接的需求说明，尊重现有功能和云配置，不扩大范围。返回 JSON {"goal":"目标","tasks":["具体任务"],"acceptance":["可验证的验收标准"]}，最多8项，另返回 questions 数组（最多3个影响范围、数据或核心交互的待确认问题；需求已清楚则为空）。列出明确默认方案，不询问用户已说明的内容。不声称已执行。'),
    'design': ('交互设计师', '你是交互设计师。基于需求说明和已有代码，规划页面层级、具体布局、配色、控件状态、空状态和窄屏交互，保持已有应用的视觉一致性。返回 JSON {"summary":"设计概述","items":["可供工程师直接实施的设计规范"]}，最多10项。不生成源码。'),
    'architect': ('技术架构师', '你是技术架构师。接收需求和设计，明确修改哪些文件、组件职责、状态与数据持久化方案，列出实现顺序和风险。只用平台允许的依赖和已启用云服务，保留未涉及的功能。返回 JSON {"summary":"架构概述","items":["具体文件、数据契约或技术决策"]}，最多10项。不生成源码。'),
    'engineer': ('应用工程师', studio.ENGINEER),
    'qa': ('测试工程师', '你是独立测试工程师。根据需求验收标准、实际源码和已经执行的构建日志进行审查，不直接修改代码。发现功能缺失或真实缺陷时拒绝通过，不因主观偏好扩大需求。返回 JSON {"approved":true或false,"summary":"审查结论","issues":["必须修复的问题"],"tests":[{"action":"visible|click|fill|text","selector":"实际源码中的CSS选择器","value":"输入或期望文字"}]}。必须提供2–8步独立、确定性的核心交互测试；各步骤按顺序在全新浏览器运行，不能依赖外部网络或登录成功。测试只能使用 visible/click/fill/text 四种动作，text 为包含匹配。所有问题都解决后 approved 才能为 true，此时 issues 为空。你提供的测试尚未执行，不得声称通过。'),
}

AGENT_NAMES = {'product': '米洛（Milo）', 'design': '露娜（Luna）', 'architect': '奥利（Ollie）', 'engineer': '尼奥（Neo）', 'qa': '皮普（Pip）'}
ROLES['product']=(ROLES['product'][0],ROLES['product'][1]+'\n区分用户描述的现状/缺陷与目标要求。例如“现在标签只能添加，不能删除，需要管理功能”是在报告缺少删除能力，不能改写为“禁止删除”。结合修复意图补齐缺失行为；只有用户明确说“不允许删除/不要删除功能”时才作为限制。')
ROLES['qa']=(ROLES['qa'][0],ROLES['qa'][1].replace('必须提供2–8步','建议提供2–16步（最多48步）')+'\n围绕用户本次新增或修复的核心行为安排实际操作和结果断言，不要只验证页面可见；最后一步必须为 visible 或 text 断言，不能以 click/fill 结束就声称验收覆盖。CSS selector 最多300字符。保留必要前置步骤，不要为了缩短测试而跳过核心验证。')
ROLES = {key: (label, f'你的名字是{AGENT_NAMES[key]}，是 AtomForge 团队的一员。沟通亲切、清楚、简洁。\n' + prompt) for key, (label, prompt) in ROLES.items()}
CHOICE_PROMPT = '\n待确认 questions 必须为对象数组，替代字符串问题格式：[{"question":"一个真正影响方案且尚未确定的问题","options":[{"label":"具体方案A","description":"实际行为与取舍"},{"label":"具体方案B","description":"实际行为与取舍"}],"recommended":0,"reason":"结合用户需求推荐此项的理由"}]。每题2–3个互斥、可实施的选项，recommended是从0开始的推荐选项索引。不要把其他或继续思考放进options，界面统一提供。需求已明确的内容不要再问；没有待决策项则questions为空。方案默认采用推荐项。设计与架构最多各1题，不重复已经确认的细节。'
for role in ('product', 'design', 'architect'):
    ROLES[role] = (ROLES[role][0], ROLES[role][1] + CHOICE_PROMPT)

DECISION_POLICY = '\n只在确实阻塞实施时提问。questions 每题必须附 kind：user_requested（用户明确要求自己决定）、scope_conflict（核心业务规则冲突且无法从上下文判断）、external_dependency（缺少必须由用户提供的外部条件）、irreversible（涉及付费、公开发布、不可逆数据操作）或 preference（可自行决定）。默认不提问。配色、字体、周起始日、文件结构、技术选型、排错先后顺序、实现方法均由团队选择合理默认值并写入方案，禁止因此打断用户。已有 confirmed_choices、userDecisions 和 previousUserDecisions 已是答案，不重复询问；历史决定沿用到后续修改和修复，但用户本轮明确的新要求优先。需求/方案本身不需要例行审批；明确反馈直接执行，只有出现新的必要阻塞才提问。'
for role in ('product', 'design', 'architect'):
    ROLES[role] = (ROLES[role][0], ROLES[role][1] + DECISION_POLICY)


def blocking_questions(questions):
    return [q for q in questions if isinstance(q, dict) and q.get('kind') in {'user_requested', 'scope_conflict', 'external_dependency', 'irreversible'}]


CONFIRMED_SCOPE = '\n以 request、approvedRequirements 和 approvedSolution 中已确认的方案为执行与验收依据。用户最新确认的修改优先于初始请求、旧历史、讨论建议和错误的验收反馈。不要用旧配色或已被替换的要求推翻已确认方案；不要自行扩大范围。'
CONFIRMED_SCOPE += '\n文档中的 confirmed_choices 是用户实际选择，优先于同一文档中的默认方案和备选项；实现与验收必须体现这些选择。'


def validate_review(raw):
    review = Review.model_validate(raw).model_dump()
    if review['approved'] and review['issues']:
        raise ValueError('测试工程师的通过结论与问题清单冲突')
    if review['tests'][-1].get('action') not in {'visible','text'}:
        raise ValueError('独立测试需要在操作后验证实际结果，最后一步必须为 visible 或 text 断言')
    for test in review['tests']:
        if test.get('action') not in {'visible', 'click', 'fill', 'text'}:
            raise ValueError('测试工程师返回了不支持的测试动作')
        if not isinstance(test.get('selector'), str) or not test['selector'].strip() or len(test['selector']) > 300:
            raise ValueError('测试工程师返回了无效的测试选择器')
        if test['action'] in {'fill', 'text'} and not isinstance(test.get('value'), str):
            raise ValueError('测试步骤缺少输入或期望文字')
    return review


async def execute_team(run_id, owner, project_id, payload):
    async with db_manager.session() as db:
        saved = await db.get(StudioRun,run_id)
        documents = json.loads(saved.result).get('team',{})
        cloud = await db.get(StudioCloud, project_id)
        from services.connections import read_connection
        connection = await read_connection(db, project_id)
        config = {'enabled': bool(cloud and cloud.enabled), 'ai_enabled': bool(cloud and cloud.ai_enabled), 'collections': json.loads(cloud.collections) if cloud else {}}
        config['payments_enabled'] = bool(config['enabled'] and all(connection.get(k) for k in ['stripe_secret', 'stripe_webhook_secret', 'stripe_price_id', 'public_base_url']))

    draft_files = json.loads(saved.result).get('draft_files', payload['files'])

    async def persist():
        await studio.change(run_id, result={'team': documents, 'draft_files': draft_files})

    async def role_event(role, message, state='running', stage=None, **extra):
        await studio.event(run_id, stage or role, message, role=role, state=state, **extra)

    async def checkpoint(key, role, title, output):
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
        await role_event(role,'请审阅'+title+'，确认或提出修改后再继续。','waiting',kind='confirmation',recipient='user')
        await studio.change(run_id,status='awaiting_input',stage=key,result={'team':documents,'draft_files':draft_files,'pending':pending})
        schedule(owner, run_id, pending)
        return True

    async def handoff(sender,recipient,output):
        await role_event(sender,'交接给'+ROLES[recipient][0]+'：'+(output.get('summary') or output.get('goal') or '请按照交接文档执行'),'done',kind='handoff',recipient=recipient,output=output)

    async def turn(role, context, schema, max_tokens=2600):
        from services.agent_chat import discussion_context
        context={**context,'userDiscussions':await discussion_context(owner,project_id)}
        await role_event(role, f'{ROLES[role][0]}：先核对用户需求和已交接文档，再形成{ROLES[role][0]}负责的产出。', model=payload['model'],kind='plan')
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
        except Exception:
            await role_event(role, '本轮未完成，查看任务错误后可重新执行', 'error')
            raise
        documents[role] = output
        await persist()
        await role_event(role, output.get('summary') or output.get('goal') or '产出已交接', 'running' if role == 'qa' else 'done', output=output)
        return output

    context = {'request': payload['instruction'], 'history': payload['history'], 'currentFiles': payload['files'], 'cloud': config, 'handoffs': documents,'userDecisions':payload.get('decisions',[])}
    from services.agent_chat import decision_context
    context['previousUserDecisions'] = await decision_context(owner, project_id)
    latest_feedback=next((decision['feedback'] for decision in reversed(payload.get('decisions',[])) if decision.get('feedback','').strip()),'')
    if latest_feedback:
        context['originalRequest']=payload['instruction']
        context['request']=latest_feedback
    if 'product' not in documents:
        await turn('product', context, lambda r: Brief.model_validate(r).model_dump())
    if await checkpoint('requirements','product','需求与验收标准',{'product':documents['product']}): return
    # Keep the original prompt in the durable payload, not as a competing downstream spec.
    context['request']=documents['product']['goal']
    context.pop('originalRequest',None)
    context['approvedRequirements']=documents['product']
    context['history']=[]
    if 'design' not in documents:
        await handoff('product','design',documents['product'])
        await turn('design', context, lambda r: Document.model_validate(r).model_dump())
    if 'architect' not in documents:
        await handoff('design','architect',documents['design'])
        await turn('architect', context, lambda r: Document.model_validate(r).model_dump())
    if await checkpoint('solution','product','设计与开发方案',{'design':documents['design'],'architect':documents['architect']}): return
    context['approvedSolution']={'design':documents['design'],'architect':documents['architect']}
    await handoff('architect','engineer',documents['architect'])
    files = draft_files
    failure = payload.get('previousError', '')
    for attempt in range(3):
        await role_event('engineer', '接收需求、设计与架构，开始实现' if not attempt else f'接收验收反馈，第 {attempt} 次修复', stage='code' if not attempt else 'repair')
        active_role = 'engineer'
        try:
            patch = await studio.call_model(owner, project_id, run_id, payload['model'], 'team_code' if not attempt else 'team_repair',
                [{'role': 'system', 'content': studio.ENGINEER+CONFIRMED_SCOPE},
                 {'role': 'user', 'content': json.dumps({**context, 'currentFiles': files, 'previousError': failure}, ensure_ascii=False)}],
                temperature=payload.get('temperature', .35))
            files = studio.merge_patch(files, patch)
            draft_files = files
            changed_paths=studio.patch_paths(patch)
            await role_event('engineer','增量修改完成，等待构建验证',kind='tool_result',tool='workspace.apply_patch',output={'files':[{'path':f['path'],'bytes':len(f['content'].encode())} for f in files if f['path'] in changed_paths],'deleted':patch.get('delete',[])})
            documents['engineer'] = {'summary': str(patch.get('summary', '实现已完成'))[:2000], 'items': changed_paths}
            await persist()
            await role_event('engineer', '代码已交接，开始构建与开发自测', 'done', output=documents['engineer'])
            await handoff('engineer','qa',documents['engineer'])
            active_role = 'qa'
            await role_event('qa', '运行构建与开发自测', stage='test')
            checked = await studio.checked_build(run_id, files, patch.get('tests', []))
            for line in checked.get('logs', []):
                await role_event('qa', line, stage='test')
            if not checked['ok']:
                raise ValueError(checked.get('error', '构建或开发自测未通过'))
            review = await turn('qa', {**context, 'currentFiles': files, 'buildLogs': checked.get('logs', [])}, validate_review, 3000)
            if not review['approved']:
                raise ValueError('独立验收要求修复：' + '; '.join(review['issues'] or [review['summary']]))
            await role_event('qa', '代码审查通过，执行测试工程师编写的独立测试', stage='test')
            checked = await studio.checked_build(run_id, files, review['tests'])
            for line in checked.get('logs', []):
                await role_event('qa', line, stage='test')
            if not checked['ok']:
                raise ValueError(checked.get('error', '独立浏览器测试未通过'))
            documents['qa']['verified'] = True
            await persist()
            await role_event('qa', '独立审查与浏览器测试通过，交付验收完成', 'done', output=documents['qa'])
            break
        except (ValueError, ValidationError) as exc:
            if isinstance(exc,studio.OutputLimitError): raise
            failure = str(exc)[:5000]
            if attempt == 2:
                await role_event(active_role,'这一轮还未通过验收，已保留草稿和交接进度，可从工作看板继续。','error',stage='error',diagnostic=failure)
                raise ValueError('团队经过两次修复仍未通过验收：' + failure) from exc
            await role_event('qa','检查发现需要调整的细节，已交给 Neo 处理，修复后会重新验证。','recovering',stage='repair',kind='handoff',recipient='engineer',diagnostic=failure)
    await studio.event(run_id, 'save', '团队验收通过，保存代码和构建产物')
    summary = documents['engineer']['summary']
    result = {'files': files, 'summary': summary, 'artifact': checked['artifact'], 'model': payload['model']}
    version = await studio.commit_result(owner, project_id, payload['base_version'], result, run_id)
    await role_event('engineer',summary+'；独立验收通过，已保存为 v'+str(version),'done',kind='summary',recipient='user')
    await studio.change(run_id, status='done', stage='done', result={'version': version, 'summary': summary, 'plan': documents['product'], 'team': documents})
