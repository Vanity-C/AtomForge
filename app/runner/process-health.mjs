import {readFileSync} from 'node:fs';

export function processHealth(read=path=>readFileSync(path,'utf8')) {
  for(const base of ['/sys/fs/cgroup','/sys/fs/cgroup/pids']) {
    try {
      const current=Number(read(base+'/pids.current').trim());
      const limit=Number(read(base+'/pids.max').trim());
      if(!Number.isFinite(current)||!Number.isFinite(limit)||limit<=0)continue;
      return {current,limit,pressure:current>=limit*.85};
    } catch { /* Non-Linux and unlimited controllers have no PID budget. */ }
  }
  return {current:null,limit:null,pressure:false};
}
