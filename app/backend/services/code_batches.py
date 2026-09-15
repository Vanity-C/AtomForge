"""Recover oversized engineering output with atomic, resumable code batches."""
import copy
import asyncio
import hashlib
import json

from services import task_control
from services.patch_conflicts import PatchConflictError

BATCH_RULES = '''本次实现必须分批交付，每次只返回一个可完整解析的 JSON 补丁。
保留全部已确认需求，不能为了缩短输出删除原有功能。currentFiles 是最新已保存草稿，不要重复之前已完成的修改。
只做当前能完整返回的一小部分，优先精确 edits；复杂模块可拆成多个小文件，多次逐步接入。无入口时第一批必须创建根目录 App.jsx。
每批增加字段 {"complete":false,"remaining":["下一批具体待办及尚未完成的验收目标"]}。
remaining 必须完整保留剩余需求；只有全部需求实现、所有文件接入后才能 complete=true 且 remaining=[]。
最后一批返回覆盖最终应用核心场景的完整 tests；中间批次不能声称通过构建或验收。
平台不设置每批字符配额或团队累计输出配额，优先完整交付当前工作包；代码必须完整，不能写省略号或占位 TODO。
若上一批触及供应商单次输出上限，则将当前工作包进一步拆成单个函数或小模块，其他要求完整留在 remaining 中继续实现。'''


def source_fingerprint(files):
    source = [(f['path'], f['content']) for f in sorted(files, key=lambda f:f['path'])]
    return hashlib.sha256(json.dumps(source, ensure_ascii=False).encode()).hexdigest()


def validate_batch(patch):
    if not isinstance(patch, dict) or type(patch.get('complete')) is not bool:
        raise ValueError('分批输出必须有布尔 complete 字段')
    remaining = patch.get('remaining')
    if (not isinstance(remaining, list) or len(remaining) > 40 or
            any(not isinstance(item, str) or not item.strip() or len(item) > 2000 for item in remaining)):
        raise ValueError('分批输出必须提供有效 remaining 待办列表')
    if patch['complete'] == bool(remaining):
        raise ValueError('尚有待办时不能声明完成；未完成时必须说明下一批工作')
    if not isinstance(patch.get('tests', []), list):
        raise ValueError('tests 必须为数组')


async def generate_patch(owner, project_id, run_id, model, stage, messages, files, *,
                         temperature=.25, checkpoint=None, save=None, prefer_batches=False):
    """Never parse a truncated response or commit a partially verified application.

    save(files, state) persists both together; callers keep their role documents.
    state is deliberately updated in place so a subsequent repair/resume sees it.
    """
    from services import studio

    state = checkpoint if checkpoint is not None else {}
    original = copy.deepcopy(files)
    template = json.loads(messages[-1]['content'])
    scope = hashlib.sha256(json.dumps({'request':template.get('request'),'model':model},
                                     ensure_ascii=False,sort_keys=True).encode()).hexdigest()
    if state and state.get('scope', scope) != scope:
        # A leader/user replan retains draft code, but must reconsider the new
        # requirements instead of accepting an old finished checkpoint.
        state.clear()
        prefer_batches = True
    if not state and not prefer_batches:
        corrected_messages=messages
        for correction in range(3):
            try:
                patch=await studio.call_model(owner, project_id, run_id, model, stage,
                                              corrected_messages, temperature=temperature)
                # A malformed patch is a protocol problem, not another failed
                # application acceptance round. Give the model actual evidence.
                studio.merge_patch(files,patch)
                return patch
            except PatchConflictError as exc:
                if correction==2:
                    raise studio.OutputLimitError('局部补丁连续无法安全定位，已保留完整草稿；请继续当前任务重新审查，避免反复应用旧修改。') from exc
                corrected_messages=[*copy.deepcopy(messages[:-1]),
                    {'role':'user','content':json.dumps({**template,'currentFiles':files,
                        'patchConflict':exc.details},ensure_ascii=False)}]
                await studio.event(run_id,'recovering','补丁定位未通过，已提供当前源码片段重新核对；本次未修改草稿。',
                                   role='engineer',kind='activity',state='recovering')
            except studio.OutputLimitError:
                break

    if not state:
        state.update(version=2, scope=scope, completed=[], remaining=['完成本轮全部已确认需求'],
                     finished=False)
    # Old failed runs may carry a 2k character budget: do not perpetuate it.
    state.pop('budget', None)
    state['version'] = 2
    state.setdefault('completed_count', len(state['completed']))
    working = copy.deepcopy(files)
    state.setdefault('recent_sources', [source_fingerprint(working)])

    async def persist():
        task_control.check()
        if save:
            await save(working, copy.deepcopy(state))

    await persist()
    await studio.event(run_id, 'recovering', '已切换为分批实现，每批完整校验后保存；全部完成后统一验收。',
                       role='engineer', kind='activity', state='recovering')
    # Replace only the engineering context's current files. Never trim user scope.
    error = ''
    format_failures = 0
    consecutive_truncations = 0
    while not state.get('finished'):
        task_control.check()
        context = {**template, 'currentFiles': working,
                   'completedBatches': state['completed'], 'remaining': state['remaining'],
                   'batchError': error}
        batch_messages = [*copy.deepcopy(messages[:-1]),
                          {'role': 'system', 'content': BATCH_RULES},
                          {'role': 'user', 'content': json.dumps(context, ensure_ascii=False)}]
        try:
            # Same provider capacity as every role; splitting changes the work
            # package, never imposes a smaller token cap on a model request.
            patch = await studio.call_model(owner, project_id, run_id, model, stage+'_batch',
                                           batch_messages,
                                           temperature=temperature, event_role='engineer')
            validate_batch(patch)
            merged = studio.merge_patch(working, patch)
            if merged == working and not patch['complete']:
                raise ValueError('未完成批次必须包含实际代码修改，不能重复空交接')
            if merged != working and source_fingerprint(merged) in state['recent_sources']:
                raise ValueError('当前补丁会恢复到最近已处理的相同源码，请基于剩余需求推进，避免来回撤销修改')
        except studio.OutputLimitError:
            consecutive_truncations += 1
            if consecutive_truncations >= 4:
                raise studio.OutputLimitError('供应商连续未返回完整补丁，当前阶段已暂停并保留断点；已完成批次不重做，可恢复后继续。')
            error = ('上一批触及供应商单次输出上限，未应用任何截断内容。'
                     '请将本批再拆小，仅实现一个函数或小模块，其他目标完整放入 remaining。'
                     f'已连续 {consecutive_truncations} 次未产出完整补丁，不得重复同一整文件输出。')
            await persist()
            await studio.event(run_id, 'recovering', '当前批次仍过大，已自动缩小修改范围；之前保存的批次不重做。',
                               role='engineer', kind='activity', state='recovering')
            continue
        except ValueError as exc:
            format_failures += 1
            if format_failures >= 3:
                raise studio.OutputLimitError('分批补丁校验未通过；已保留完整草稿和未完成清单，可继续当前任务。') from exc
            error = json.dumps(exc.details,ensure_ascii=False)[:6500] if isinstance(exc,PatchConflictError) else str(exc)[:2000]
            continue
        working = merged
        state['recent_sources'] = [*state['recent_sources'],source_fingerprint(working)][-16:]
        state['completed'].append({'summary': str(patch.get('summary', '增量修改'))[:1500],
                                   'paths': studio.patch_paths(patch)})
        # Bound historical presentation metadata, not requirements or source.
        state['completed'] = state['completed'][-48:]
        state.update(remaining=patch['remaining'], finished=patch['complete'],
                     tests=patch.get('tests', []), summary=str(patch.get('summary', '实现已完成'))[:2000],
                     handoff=str(patch.get('handoff', '')))
        state['completed_count'] += 1
        error = ''
        format_failures = 0
        consecutive_truncations = 0
        await persist()
        await studio.event(run_id, 'code', f'第 {state["completed_count"]} 批代码已保存，'+
                           ('开始完整构建与验收。' if state['finished'] else f'剩余 {len(state["remaining"])} 项待办。'),
                           role='engineer', kind='activity', state='running')
        await asyncio.sleep(0)  # Other tasks, progress polling and force-stop stay responsive.
    final_paths = {f['path'] for f in working}
    original_by_path = {f['path']: f for f in original}
    return {'files': [f for f in working if original_by_path.get(f['path']) != f],
            'delete': [f['path'] for f in original if f['path'] not in final_paths],
            'tests': state.get('tests', []), 'summary': state.get('summary', '实现已完成'),
            'handoff': state.get('handoff', '')}
