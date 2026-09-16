import type {StudioRun} from './studio';

export function runExperience(run: StudioRun) {
  const active=['queued','running'].includes(run.status);
  const qaProtocol=run.result.error_code==='qa_protocol_error'||/独立验收报告格式|验收测试计划自动纠正|测试脚本需要纠正/.test(run.error);
  const qaTriage=run.result.error_code==='qa_triage_pending';
  const resumeVerification=!!run.result.draft_files?.length&&(qaTriage||qaProtocol||run.result.error_code==='runner_unavailable'||/构建服务不可用|验证服务尚未就绪/.test(run.error));
  const latest=run.events.at(-1);
  const recovering=active&&(latest?.state==='recovering'||run.stage==='repair'||run.stage==='recovering');
  const names:Record<string,string>={product:'Milo',design:'Luna',architect:'Ollie',engineer:'Neo',qa:'Pip'};
  const work:Record<string,string>={product:'梳理需求',design:'设计交互',architect:'整理实现方案',engineer:'修改代码',qa:'验证功能'};
  const roles=Object.fromEntries(Object.entries(work).map(([role,action])=>[role,`${run.agents?.[role]?.name||names[role]} 正在${action}`]));
  let title=run.status==='queued'?'团队即将开始':roles[latest?.role??'']||'团队正在处理';
  let description='你可以查看已生成的文件，或展开执行过程了解进展。';
  if(recovering){title='团队正在自动调整';description='正在重试当前步骤或修复检查发现的问题，无需重复发送需求。';}
  if(run.stage==='save'&&active){title='正在保存应用';description='验证已通过，正在更新文件和预览。';}
  if(run.status==='awaiting_input'){title='有一项需要你的决定';description='请在确认卡中选择，团队会根据你的决定继续。';}
  if(run.status==='done'){title=run.result.version?`v${run.result.version} 已就绪`:'本次任务已完成';description='文件与预览已更新，可以继续体验或提出修改。';}
  if(run.status==='review'){title='候选应用已就绪';description='请到工作看板预览并选择要采用的版本。';}
  if(['error','interrupted','cancelled'].includes(run.status)){
    title=run.status==='error'?'本轮暂未完成':run.status==='cancelled'?'任务已停止':'任务已中断';
    description='已有版本和生成草稿已保留，可在工作看板继续任务。';
    if(/余额|预算|配额/.test(run.error))description='本次调用额度不足，请检查生成设置后再继续；已有成果会保留。';
    else if(/鉴权|密钥|not configured/i.test(run.error))description='模型连接需要检查，请更新生成设置后继续；已有成果会保留。';
    else if(/截断|输出.*完整/.test(run.error))description='这次修改未能完整生成，进度已保留；可继续任务或分步提出修改。';
    if(resumeVerification){title='代码已保留，验证暂未完成';description='验证服务未能连接，应用还没有通过验收。服务恢复后点击“继续验收”，会直接检查已有代码，无需重新生成或再次描述需求。';}
    if(resumeVerification&&qaProtocol){title='代码已保留，测试计划待纠正';description='验收报告或测试脚本尚未通过校验。点击“继续验收”，测试工程师会基于已保存的草稿接着处理；未执行的检查不会计为通过。';}
    if(resumeVerification&&qaTriage){title='检查记录待 QA 核实';description='问题的影响或测试依据仍需核实，尚未交开发返工。点击“继续验收”，测试工程师会接着核实；已有草稿与证据已保留。';}
  }
  return {active,recovering,title,description,resumeVerification};
}
