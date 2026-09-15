"""Precise source evidence for rejected edits; never fuzzy-apply source code."""
from difflib import SequenceMatcher


class PatchConflictError(ValueError):
    def __init__(self, path, source, old, new, original_source=None):
        count=source.count(old)
        super().__init__(f'{path} 的 old 片段必须与当前代码精确且唯一匹配（实际匹配 {count} 次），请根据 patchConflict 中的真实源码重新定位')
        source=original_source if original_source is not None else source
        original_count=source.count(old)
        lines=source.splitlines(keepends=True)
        anchors=[]
        seed=next((line.strip()[:400] for line in old.splitlines() if len(line.strip())>=8),old[:400])
        if original_count:
            cursor=0
            for _ in range(min(original_count,3)):
                cursor=source.find(old,cursor)
                anchors.append(source.count('\n',0,cursor))
                cursor+=len(old)
        else:
            candidates=sorted(((SequenceMatcher(None,seed,line.strip()[:400],autojunk=True).ratio(),index)
                               for index,line in enumerate(lines) if line.strip()),reverse=True)[:3]
            anchors.extend(index for score,index in candidates if score>=.35)
        new_count=source.count(new) if new else 0
        if new and new_count==1:
            anchors.insert(0,source.count('\n',0,source.find(new)))
        snippets=[]
        for index in dict.fromkeys(anchors):
            start=max(0,index-2)
            end=min(len(lines),index+4)
            snippets.append({'start_line':start+1,'content':''.join(lines[start:end])[:2400]})
            if len(snippets)>=3:break
        self.details={'path':path,'old_occurrences':original_count,'failed_edit_occurrences':count,'new_occurrences':new_count,
                      'requested_old':old[:1500],'actual_source_snippets':snippets,
                      'all_edits_rolled_back':True,
                      'instruction':'本补丁未应用。以上为补丁应用前草稿，不是建议替换内容；failed_edit_occurrences 是按顺序暂存前面 edits 后的匹配数。old 必须原样且唯一匹配；如 new 已存在，核对是否已完成，不要重复修改或恢复旧代码。'}
