"""An unclassified finding is QA work, not an automatic engineering repair."""
from pydantic import BaseModel, ConfigDict, Field

from services.qa_review import ReviewIssue, ReviewProtocolError, issue_details


class ReviewTriageError(ReviewProtocolError):
    """Preserve verification evidence without spending an engineering round."""


PLATFORM_SCOPE = '''平台约束：交付源码只允许 JS/JSX/TS/TSX/CSS/JSON，入口是根目录 App.jsx 或 App.tsx；SVG 可内联在组件中。不得要求工程师提交平台不支持的独立 .svg 文件或去掉必需的 React 入口。若用户交付要求与平台能力确实冲突，列为待核实并说明约束，不反复要求无法执行的修改。'''

TRIAGE_GUIDANCE = '''你是验收分诊负责人。本轮所有可执行检查已经汇总，根据 currentFiles、已确认需求及真实执行证据，一次性判断每项是否需要开发返工。只处理给定 findings，不添加新要求。
返回 JSON {"items":[{"id":"给定ID","disposition":"blocker|advisory|pending","type":"functionality|data|ui|performance|security|compatibility|build|test|other|unknown","severity":"critical|high|medium|low|unknown","requirement":"对应的已确认要求","location":"源码位置","reproduction":"复现步骤","expected":"预期","actual":"实际","evidence":"当前源码或执行证据","impact":"实际用户影响","reason":"处置理由"}]}。每个ID恰好出现一次，不重写或遗漏原问题。
blocker 仅用于已确认要求未满足、核心流程失败、崩溃、数据或安全等有证据的真实应用缺陷；必须填写明确类型、已评定等级、需求、位置、复现、预期/实际、证据及用户影响。低等级不是自动豁免明确要求的理由，但不能只因细微坐标差异、主观美化、命名、重构偏好或未经验证的推测要求返工。无必要的优化放 advisory，并说明不影响本轮验收的证据和理由。
unknown 表示缺少分类依据，不代表轻微或必须修改。不能确认根因/影响则 pending，先由 QA 核实。真实执行失败不能通过改成 advisory 掩盖；测试脚本错误应纠正并重新执行，尚未执行通过的项目保持 pending。不得靠删除场景、改预期、伪造通过来消除问题。测试记录不需要出现在应用源码文件中。'''


class Decision(ReviewIssue):
    id: str


class Decisions(BaseModel):
    model_config = ConfigDict(extra='forbid')
    items: list[Decision] = Field(max_length=128)


def ready(issue):
    """The server, not an untrusted severity label, decides repair eligibility."""
    if issue['disposition'] == 'blocker':
        return (issue['severity'] != 'unknown' and issue['type'] not in {'unknown', 'test'}
                and all(issue.get(key, '').strip() for key in
                        ('requirement', 'location', 'reproduction', 'expected', 'actual', 'evidence', 'impact', 'reason')))
    if issue['disposition'] == 'advisory':
        return (issue.get('source') not in {'self_test', 'browser_test'}
                and issue['severity'] not in {'critical', 'high'}
                and all(issue.get(key, '').strip() for key in ('evidence', 'impact', 'reason')))
    return False


def partition(findings):
    result = {'blockers': [], 'advisories': [], 'pending': []}
    for issue in findings:
        bucket = 'blockers' if ready(issue) and issue['disposition'] == 'blocker' else 'advisories' if ready(issue) else 'pending'
        result[bucket].append(issue)
    return result


async def triage_issues(issues, details, *, request, on_update):
    findings = issue_details(issues, details)
    await on_update(partition(findings))
    unresolved = [i for i, issue in enumerate(findings) if not ready(issue)]
    if not unresolved:
        return partition(findings)
    originals = {f'I{i+1}': findings[i] for i in unresolved}
    diagnostic = ''
    # A single batch, with one retry only for malformed classification output.
    for attempt in range(2):
        try:
            raw = await request({'findings': [{'id': key, **item} for key, item in originals.items()],
                                 'validationError': diagnostic, 'attempt': attempt + 1})
            # Descriptions and provenance are immutable; the model classifies IDs.
            if not isinstance(raw, dict) or not isinstance(raw.get('items'), list):
                raise ValueError('分诊结果必须包含 items 数组')
            expanded = []
            for item in raw['items']:
                if not isinstance(item, dict) or item.get('id') not in originals:
                    raise ValueError('分诊包含未知问题 ID')
                original = originals[item['id']]
                expanded.append({**original, **item, 'description': original['description'],
                                 'source': original['source'], 'scenario': original['scenario']})
            decisions = Decisions.model_validate({'items': expanded}).items
            ids = [d.id for d in decisions]
            if len(ids) != len(set(ids)) or set(ids) != set(originals):
                raise ValueError('分诊必须完整覆盖每个原问题 ID，不能遗漏或重复')
            for decision in decisions:
                index = int(decision.id[1:]) - 1
                item = decision.model_dump(exclude={'id'})
                # Never let a relabelled test failure become an optional suggestion.
                if not ready(item):
                    item['disposition'] = 'pending'
                    item['reason'] = item['reason'] or '缺少可验证的分类依据，需要 QA 核实'
                findings[index] = item
            break
        except ValueError as error:
            diagnostic = str(error)[:1800]
            if attempt == 1:
                for index in unresolved:
                    findings[index]['disposition'] = 'pending'
                    findings[index]['reason'] = '分诊未完成：' + diagnostic
    result = partition(findings)
    await on_update(result)
    return result
