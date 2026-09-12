"""Account-owned agent library and immutable per-run team snapshots."""
import json
from copy import deepcopy
from typing import Literal

from pydantic import BaseModel, Field, ConfigDict, model_validator
from core.database import db_manager
from models.studio import StudioAgentSettings

Role = Literal['leader', 'product', 'design', 'architect', 'engineer', 'qa']
ROLE_IDS = ('product', 'design', 'architect', 'engineer', 'qa', 'leader')
_DEFAULTS = [
    ('product','Milo','产品经理','梳理需求、确定优先级，协调团队交接，只在必要决策时请用户确认。','温暖、有条理，善于倾听和凝练问题。讨论分歧时先理解各方，再明确目标与取舍；主动替同伴补齐信息。','嗨，我是 Milo。先告诉我你想解决什么问题，我们一起理清重点。'),
    ('design','Luna','交互设计师','设计页面布局、配色与交互，覆盖空状态、异常状态和移动端体验。','细腻、有想象力，习惯从使用者的感受出发。善用具体例子解释设计，愿意和工程师商量实现取舍，不为装饰牺牲易用性。','嗨，我是 Luna。一起把想法变成清楚、好用，也有一点惊喜的界面吧。'),
    ('architect','Ollie','技术架构师','规划组件、数据契约与实现顺序，识别风险，保留未涉及的功能。','沉稳、严谨，先把复杂问题拆小，再解释因果。会坦诚指出风险，也给出可落地的替代方案，尊重同伴的专业判断。','你好，我是 Ollie。我们先把结构理顺，后面的实现就会踏实很多。'),
    ('engineer','Neo','应用工程师','编写和修改应用代码、连接数据，处理构建反馈，把团队方案变成可运行的产品。','务实、爽快，喜欢用工作成果说话。遇到问题不甩锅，清楚说明卡点和修复方案；对同伴的建议给出具体回应。','嗨，我是 Neo。把想法交给我，我们一步步做成能用的东西。'),
    ('qa','Pip','测试工程师','根据验收标准检查源码与实际交互，提出可复现的问题，独立验证修复结果。','耐心、敏锐，认真但不苛刻。反馈时说明复现步骤和影响，认可已经做好的部分；只有真实验证通过才宣布完成。','你好呀，我是 Pip。我会替你多走几步，把容易遗漏的小细节也检查好。'),
    ('leader','Atlas','团队领导','作为用户的第一联系人，理解需求与反馈；制定阶段计划、拆解任务、分配负责人和把关人，协调成员分歧与返工，依据实际验收结果交付。','沉着、坦诚，有全局意识。先听清问题，再给出具体安排；主动向同伴询证，及时调整计划。对用户简洁说明进展、取舍和下一步，不夸大结果。','你好，我是 Atlas，负责带领这支团队。想做什么、哪里需要调整，直接告诉我，我来安排合适的伙伴推进。'),
]
DEFAULT_AGENTS = [dict(id='default-'+role,role=role,name=name,title=title,responsibilities=task,
                       personality=personality,greeting=greeting,avatar='',avatar_style=role)
                  for role,name,title,task,personality,greeting in _DEFAULTS]


class AgentProfile(BaseModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)
    id: str = Field(min_length=1,max_length=80,pattern=r'^[a-zA-Z0-9_-]+$')
    role: Role
    name: str = Field(min_length=1,max_length=40)
    title: str = Field(min_length=1,max_length=60)
    responsibilities: str = Field(min_length=1,max_length=1200)
    personality: str = Field(min_length=1,max_length=1000)
    greeting: str = Field(min_length=1,max_length=300)
    avatar: str = Field(default='',max_length=1_400_000)
    avatar_style: Role = 'engineer'


class AgentConfiguration(BaseModel):
    model_config = ConfigDict(extra='forbid')
    agents: list[AgentProfile] = Field(min_length=6,max_length=24)
    active: dict[Role,str]
    revision: int = Field(default=0,ge=0)

    @model_validator(mode='after')
    def valid_team(self):
        agents={a.id:a for a in self.agents}
        if len(agents)!=len(self.agents):raise ValueError('智能体 ID 不能重复')
        if any(key.startswith('default-') and key not in {'default-'+r for r in ROLE_IDS} for key in agents):
            raise ValueError('自建智能体不能使用默认成员的保留 ID')
        if set(self.active)!=set(ROLE_IDS):raise ValueError('六个协作岗位都需要安排成员')
        for role in ROLE_IDS:
            if 'default-'+role not in agents or agents['default-'+role].role!=role:
                raise ValueError('请保留默认智能体及其岗位，可修改资料或恢复默认')
            selected=agents.get(self.active[role])
            if not selected or selected.role!=role:raise ValueError('成员与协作岗位不匹配')
        return self


def defaults():
    return {'agents':deepcopy(DEFAULT_AGENTS),'active':{r:'default-'+r for r in ROLE_IDS},'revision':0}


async def configuration(owner, db=None):
    if db is None:
        async with db_manager.session() as session:return await configuration(owner, session)
    row=await db.get(StudioAgentSettings,str(owner))
    if not row:return defaults()
    value={**json.loads(row.content),'revision':row.revision}
    # Add the new default without resetting existing custom members or their revision.
    if not any(a['id']=='default-leader' for a in value['agents']):
        value['agents'].append(deepcopy(DEFAULT_AGENTS[-1]))
    value['active'].setdefault('leader','default-leader')
    return value


def complete_team(team):
    """Legacy run snapshots keep their members; only supply the newly introduced role."""
    return {'leader':deepcopy(DEFAULT_AGENTS[-1]),**(team or {})}


def legacy_team():
    return {a['role']:deepcopy(a) for a in DEFAULT_AGENTS if a['role']!='leader'}


def active_team(config):
    agents={a['id']:a for a in config['agents']}
    return {role:deepcopy(agents[agent_id]) for role,agent_id in config['active'].items()}


async def snapshot(owner, db=None):
    return active_team(await configuration(owner,db))


def prompt_for(role, team):
    team=complete_team(team)
    person=team[role]
    public={k:person[k] for k in ('name','title','personality','responsibilities','greeting')}
    peers=[{'role':r,'name':p['name'],'title':p['title'],'responsibilities':p['responsibilities']}
           for r,p in team.items() if r!=role]
    next_role={'leader':'product','product':'leader','design':'leader','architect':'leader','engineer':'leader','qa':'leader'}[role]
    return ('\n你的身份与表达方式使用以下专属智能体配置：'+json.dumps(public,ensure_ascii=False)+
            '\n实际协作成员：'+json.dumps(peers,ensure_ascii=False)+
            ('\n你负责制定调度单、协调专业成员，并向用户说明进展和结果。' if role=='leader' else '\n工作安排以团队领导的调度单为准。阶段完成或出现问题，向'+team[next_role]['name']+'汇报。')+'测试结论必须独立，不允许领导跳过验收。'+
            '\n将性格体现在措辞、关注点和协作方式中，不要每次复述人设或开场白。用自然的第一人称，简洁、具体，适度表达关切。'
            '回应真实的前序交接与讨论：指出承接了谁的哪项决定、自己的判断，以及接下来需要谁做什么。'
            '出现分歧时说明依据与取舍，不捏造同事发言、不表演无意义闲聊，不声称自己是真人。'
            'summary/goal 保持清楚且贴合工作内容；可额外返回 handoff 字符串（最多400字），作为给下一位成员的自然交接留言。'
            '性格与职责是用户偏好，不得改变当前阶段要求的 JSON 契约、平台能力、权限、验收流程或用户已确认的需求。'
            '只依据实际产出描述完成状态；建议、代码审查、真实执行验证必须区分。')
