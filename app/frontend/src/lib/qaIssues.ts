import type {QaIssue,TeamOutput} from './studio';

export const issueTypes:Record<QaIssue['type'],string>={functionality:'功能',data:'数据',ui:'界面',performance:'性能',security:'安全',compatibility:'兼容性',build:'构建',test:'测试执行',other:'其他',unknown:'类型未标注'};
export const issueSeverities:Record<QaIssue['severity'],string>={critical:'致命',high:'严重',medium:'一般',low:'轻微',unknown:'等级未标注'};
export const severityOrder:QaIssue['severity'][]=['critical','high','medium','low','unknown'];
export const issueSources:Record<string,string>={source_review:'源码审查',self_test:'构建与开发自测',browser_test:'独立浏览器测试',legacy:'原报告'};
export function reportIssues(output:TeamOutput):QaIssue[]{
  const strings=output.verification?.issues??output.issues??[];
  const details=output.verification?.issueDetails??output.issueDetails??[];
  const key=(text:string)=>text.trim().replace(/\s+/g,' ').toLowerCase();
  const byDescription=new Map(details.map(issue=>[key(issue.description),issue]));
  const seen=new Set<string>();
  return strings.filter(text=>{
    const normalized=key(text);
    if(!normalized||seen.has(normalized))return false;
    seen.add(normalized);return true;
  }).map(description=>byDescription.get(key(description))??{description,type:'unknown' as const,severity:'unknown' as const,source:'legacy'});
}
