import type {StudioRun} from './studio';

export function runExperience(run: StudioRun) {
  const active=['queued','running'].includes(run.status);
  const latest=run.events.at(-1);
  const recovering=active&&(latest?.state==='recovering'||run.stage==='repair'||run.stage==='recovering');
  const roles:Record<string,string>={product:'Milo 正在梳理需求',design:'Luna 正在设计交互',architect:'Ollie 正在整理实现方案',engineer:'Neo 正在修改代码',qa:'Pip 正在验证功能'};
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
  }
  return {active,recovering,title,description};
}
