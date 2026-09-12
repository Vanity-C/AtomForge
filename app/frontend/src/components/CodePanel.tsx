/**
 * File tree + code editor panel.
 *
 * Used by the workspace (editable) and by the public share page (read-only).
 */
import { useMemo } from 'react';
import {
  Braces,
  FileCode2,
  FileJson,
  FileText,
  Palette,
  Save,
  Loader2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import type { GeneratedFile } from '@/lib/agent/codegen';

function FileIcon({ path }: { path: string }) {
  const cls = 'h-3.5 w-3.5 shrink-0';
  if (path.endsWith('.css')) return <Palette className={`${cls} text-[hsl(300_40%_45%)]`} />;
  if (path.endsWith('.json')) return <FileJson className={`${cls} text-[hsl(35_65%_42%)]`} />;
  if (path.endsWith('.md')) return <FileText className={`${cls} text-muted-foreground`} />;
  if (/\.(jsx|js)$/.test(path)) return <FileCode2 className={`${cls} text-primary`} />;
  return <Braces className={`${cls} text-muted-foreground`} />;
}

interface TreeGroup {
  dir: string;
  files: GeneratedFile[];
}

function groupFiles(files: GeneratedFile[]): TreeGroup[] {
  const map = new Map<string, GeneratedFile[]>();
  for (const file of files) {
    const idx = file.path.lastIndexOf('/');
    const dir = idx === -1 ? '' : file.path.slice(0, idx);
    if (!map.has(dir)) map.set(dir, []);
    map.get(dir)!.push(file);
  }
  return Array.from(map.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([dir, group]) => ({
      dir,
      files: group.sort((a, b) => a.path.localeCompare(b.path)),
    }));
}

export interface CodePanelProps {
  files: GeneratedFile[];
  activePath: string;
  onSelect: (path: string) => void;
  readOnly?: boolean;
  streamingPath?: string | null;
  draft?: string;
  dirty?: boolean;
  saving?: boolean;
  onDraftChange?: (value: string) => void;
  onSave?: () => void;
}

export default function CodePanel({
  files,
  activePath,
  onSelect,
  readOnly = false,
  streamingPath = null,
  draft,
  dirty = false,
  saving = false,
  onDraftChange,
  onSave,
}: CodePanelProps) {
  const groups = useMemo(() => groupFiles(files), [files]);
  const active = files.find((f) => f.path === activePath) ?? files[0];
  const value = readOnly ? (active?.content ?? '') : (draft ?? active?.content ?? '');
  const lineCount = value ? value.split('\n').length : 1;

  if (!files.length) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 bg-card p-8 text-center">
        <FileCode2 className="h-6 w-6 text-muted-foreground/60" />
        <p className="text-sm font-medium">代码还没有生成</p>
        <p className="max-w-xs text-sm text-muted-foreground">
          智能体生成的每个文件都会出现在这里，你可以直接修改并保存为新版本。
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0">
      <div className="scroll-slim w-32 shrink-0 overflow-y-auto border-r border-border bg-sidebar py-2 sm:w-48">
        <p className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          文件
        </p>
        {groups.map((group) => (
          <div key={group.dir || 'root'} className="pb-1">
            {group.dir ? (
              <p className="truncate px-3 py-1 font-mono text-[11px] text-muted-foreground">
                {group.dir}/
              </p>
            ) : null}
            {group.files.map((file) => {
              const isActive = file.path === active?.path;
              const name = file.path.split('/').pop();
              return (
                <button
                  key={file.path}
                  type="button"
                  onClick={() => onSelect(file.path)}
                  className={`flex w-full items-center gap-2 py-1.5 pr-2 text-left font-mono text-xs transition-colors duration-150 ease-out-quart ${
                    group.dir ? 'pl-6' : 'pl-3'
                  } ${
                    isActive
                      ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
                      : 'text-sidebar-foreground hover:md:bg-sidebar-accent/60'
                  }`}
                >
                  <FileIcon path={file.path} />
                  <span className="truncate">{name}</span>
                  {streamingPath === file.path ? (
                    <Loader2 className="ml-auto h-3 w-3 animate-spin text-primary" />
                  ) : null}
                </button>
              );
            })}
          </div>
        ))}
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-card px-3 py-2">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate font-mono text-xs text-foreground">{active?.path}</span>
            {readOnly ? (
              <Badge variant="secondary" className="h-5 px-1.5 text-[10px] font-normal">
                只读
              </Badge>
            ) : dirty ? (
              <Badge className="h-5 bg-accent px-1.5 text-[10px] font-normal text-accent-foreground hover:bg-accent">
                未保存
              </Badge>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            <span className="tnum hidden text-[11px] text-muted-foreground sm:inline">
              {lineCount} 行
            </span>
            {!readOnly ? (
              <Button
                size="sm"
                className="h-7 gap-1.5 px-2.5 text-xs"
                disabled={!dirty || saving}
                onClick={onSave}
              >
                {saving ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Save className="h-3.5 w-3.5" />
                )}
                保存为新版本
              </Button>
            ) : null}
          </div>
        </div>

        <div className="relative flex min-h-0 flex-1">
          <div
            aria-hidden
            className="code-surface scroll-slim shrink-0 select-none overflow-hidden border-r border-border/70 px-2 py-3 text-right"
            style={{ color: 'hsl(var(--code-gutter))' }}
          >
            {Array.from({ length: lineCount }, (_, i) => (
              <div key={i} className="tnum">
                {i + 1}
              </div>
            ))}
          </div>
          <textarea
            value={value}
            readOnly={readOnly}
            spellCheck={false}
            onChange={(e) => onDraftChange?.(e.target.value)}
            aria-label="文件内容"
            className="code-surface scroll-slim min-h-0 min-w-0 flex-1 resize-none border-0 px-3 py-3 outline-none focus-visible:ring-0"
          />
        </div>
      </div>
    </div>
  );
}
