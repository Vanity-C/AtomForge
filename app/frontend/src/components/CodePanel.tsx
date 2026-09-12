/** Shared source workbench for editable projects and read-only public shares. */
import { useMemo, useRef, useState, useEffect, useCallback } from 'react';
import { Braces, ChevronRight, FileCode2, FileJson, FileText, Folder, Palette, Save, Loader2, PanelLeftClose, PanelLeftOpen, Search, WrapText, RotateCcw, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from '@/components/ui/alert-dialog';
import MonacoCodeEditor from '@/components/MonacoCodeEditor';
import type { GeneratedFile } from '@/lib/agent/codegen';
import '@/styles/code-workbench.css';

function FileIcon({ path }: { path: string }) {
  const cls = 'h-3.5 w-3.5 shrink-0';
  if (/\.(css|scss|less)$/.test(path)) return <Palette className={`${cls} text-purple-500`} />;
  if (path.endsWith('.json')) return <FileJson className={`${cls} text-amber-600`} />;
  if (path.endsWith('.md')) return <FileText className={`${cls} text-muted-foreground`} />;
  if (/\.(jsx?|tsx?)$/.test(path)) return <FileCode2 className={`${cls} text-sky-600`} />;
  return <Braces className={`${cls} text-muted-foreground`} />;
}

const languages: Record<string, string> = { js: 'JavaScript', jsx: 'JavaScript JSX', ts: 'TypeScript', tsx: 'TypeScript JSX', css: 'CSS', scss: 'SCSS', less: 'Less', json: 'JSON', md: 'Markdown', html: 'HTML', py: 'Python', yml: 'YAML', yaml: 'YAML', sql: 'SQL', svg: 'XML' };

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
  onDiscard?: () => void;
}

export default function CodePanel({ files, activePath, onSelect, readOnly = false, streamingPath = null, draft, dirty = false, saving = false, onDraftChange, onSave, onDiscard }: CodePanelProps) {
  const [explorer, setExplorer] = useState(true);
  const [wordWrap, setWordWrap] = useState(false);
  const [editorReady, setEditorReady] = useState(false);
  const [cursor, setCursor] = useState({ lineNumber: 1, column: 1 });
  const [command, setCommand] = useState<{ id: number; action: string } | null>(null);
  const [openPaths, setOpenPaths] = useState<string[]>(() => activePath ? [activePath] : []);
  const [confirmClose, setConfirmClose] = useState<string | null>(null);
  const [discardThenClose, setDiscardThenClose] = useState<string | null>(null);
  const tabs = useRef<HTMLDivElement>(null);
  const groups = useMemo(() => {
    const map = new Map<string, GeneratedFile[]>();
    for (const file of files) {
      const dir = file.path.includes('/') ? file.path.slice(0, file.path.lastIndexOf('/')) : '';
      map.set(dir, [...(map.get(dir) ?? []), file]);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([dir, children]) => ({ dir, children: children.sort((a, b) => a.path.localeCompare(b.path)) }));
  }, [files]);
  // An empty selection means all tabs were closed, not "select the first file".
  const active = activePath ? files.find(file => file.path === activePath) ?? files[0] : undefined;
  useEffect(() => {
    setOpenPaths(previous => {
      const next = previous.filter(path => files.some(file => file.path === path));
      if (active?.path && !next.includes(active.path)) next.push(active.path);
      return next.length === previous.length && next.every((path, index) => path === previous[index]) ? previous : next;
    });
  }, [files, active?.path]);
  const openFiles = openPaths.flatMap(path => files.find(file => file.path === path) ?? []);
  const closeTab = useCallback((path: string) => {
    if (saving) return;
    const remaining = openFiles.filter(file => file.path !== path);
    if (path === active?.path) {
      const index = openFiles.findIndex(file => file.path === path);
      onSelect(remaining[Math.min(index, remaining.length - 1)]?.path ?? '');
    }
    setOpenPaths(previous => previous.filter(item => item !== path));
  }, [saving, openFiles, active?.path, onSelect]);
  // Wait until the parent has cleared its draft guard before selecting a neighbour.
  useEffect(() => {
    if (discardThenClose && !dirty && !saving) {
      setDiscardThenClose(null);
      closeTab(discardThenClose);
    }
  }, [discardThenClose, dirty, saving, closeTab]);
  const requestClose = (path: string) => {
    if (saving) return;
    if (path === active?.path && dirty) setConfirmClose(path);
    else closeTab(path);
  };
  const value = readOnly ? active?.content ?? '' : draft ?? active?.content ?? '';
  const canSave = !!active && dirty && !saving && !readOnly && !!onSave;
  const language = languages[active?.path.split('.').pop()?.toLowerCase() ?? ''] ?? 'Plain Text';
  useEffect(() => { tabs.current?.querySelector('[aria-pressed="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }, [active?.path]);
  const fileButton = (file: GeneratedFile) => <button key={file.path} type="button" title={file.path} disabled={saving} aria-label={`打开文件 ${file.path}`} aria-current={file.path === active?.path ? 'true' : undefined} className="workbench-file" onClick={() => { if (file.path !== active?.path) onSelect(file.path); }}>
    <FileIcon path={file.path} /><span className="truncate">{file.path.split('/').pop()}</span>
    {streamingPath === file.path ? <Loader2 className="ml-auto h-3 w-3 shrink-0 animate-spin" /> : file.path === active?.path && dirty ? <span className="workbench-dirty" /> : null}
  </button>;

  if (!files.length) return <div className="flex h-full flex-col items-center justify-center gap-2 bg-card p-8 text-center"><FileCode2 className="h-6 w-6 text-muted-foreground/60" /><p className="text-sm font-medium">代码还没有生成</p><p className="max-w-xs text-sm text-muted-foreground">智能体生成的每个文件都会出现在这里，你可以直接修改并保存为新版本。</p></div>;

  return <section className="code-workbench" aria-label="代码工作台">
    <div className="workbench-body">
      {explorer && <aside className="workbench-explorer" aria-label="资源管理器">
        <div className="workbench-explorer-heading"><span>资源管理器</span><span className="font-mono text-[10px]">{files.length}</span></div>
        <div className="scroll-slim min-h-0 flex-1 overflow-y-auto py-2">
          <div className="mb-2 flex items-center gap-1.5 px-3 text-[10px] font-semibold tracking-wider text-muted-foreground"><ChevronRight className="h-3 w-3 rotate-90" />项目文件</div>
          {groups.map(({ dir, children }) => dir ? <details key={dir} open className="workbench-folder"><summary title={dir}><ChevronRight className="workbench-chevron h-3 w-3 shrink-0" /><Folder className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /><span className="truncate">{dir}</span></summary><div className="pl-3">{children.map(fileButton)}</div></details> : <div key="root">{children.map(fileButton)}</div>)}
        </div>
        <div className="workbench-explorer-foot">{readOnly ? '当前源码仅供查看' : '修改后保存为项目新版本'}</div>
      </aside>}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="workbench-tabs" ref={tabs} aria-label="文件标签">
          {openFiles.map(file => <div key={file.path} className="workbench-tab" data-active={file.path === active?.path}>
            <button type="button" className="workbench-tab-select" title={file.path} disabled={saving} aria-label={`文件标签 ${file.path}`} aria-pressed={file.path === active?.path} onClick={() => { if (file.path !== active?.path) onSelect(file.path); }}><FileIcon path={file.path} /><span>{file.path.split('/').pop()}</span></button>
            <button type="button" className="workbench-tab-close" disabled={saving} aria-label={`关闭文件 ${file.path}`} title={file.path === active?.path && dirty ? '未保存 · 关闭文件' : '关闭文件'} onClick={() => requestClose(file.path)}>{file.path === active?.path && dirty && <span className="workbench-dirty" />}<X className="h-3 w-3" /></button>
          </div>)}
        </div>
        <div className="workbench-toolbar">
          <button className="workbench-icon" title={explorer ? '折叠资源管理器' : '展开资源管理器'} aria-label={explorer ? '折叠资源管理器' : '展开资源管理器'} onClick={() => setExplorer(value => !value)}>{explorer ? <PanelLeftClose /> : <PanelLeftOpen />}</button>
          <div className="workbench-breadcrumb" title={active?.path}>{active?.path.split('/').map((part, index) => <span key={index}>{index > 0 && <ChevronRight className="h-3 w-3 shrink-0" />}{part}</span>)}</div>
          <button className="workbench-icon" title="查找 / 替换（Ctrl+F / Ctrl+H）" aria-label="查找和替换" disabled={!editorReady || !active} onClick={() => setCommand({ id: Date.now(), action: 'actions.find' })}><Search /></button>
          <button className="workbench-icon" title="自动换行" aria-label="自动换行" aria-pressed={wordWrap} onClick={() => setWordWrap(value => !value)}><WrapText /></button>
          {!readOnly && onDiscard && <button className="workbench-icon" title="放弃当前修改" aria-label="放弃当前修改" disabled={!dirty || saving} onClick={() => { if (window.confirm('放弃当前文件未保存的修改？已保存的版本不会受影响。')) onDiscard(); }}><RotateCcw /></button>}
          {!readOnly && <Button size="sm" className="h-7 shrink-0 gap-1.5 px-2.5 text-[11px]" disabled={!canSave} onClick={onSave} title="保存为新版本（Ctrl+S / ⌘S）">{saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}{saving ? '正在保存' : '保存版本'}</Button>}
        </div>
        <div className={`min-h-0 flex-1${active ? '' : ' hidden'}`}>
          <MonacoCodeEditor files={files} path={active?.path ?? ''} value={value} readOnly={readOnly || saving || !active} canSave={canSave} wordWrap={wordWrap} command={command} onChange={onDraftChange} onSave={onSave} onCursor={setCursor} onReadyChange={setEditorReady} />
        </div>
        {!active && <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 text-muted-foreground"><FileCode2 className="h-9 w-9 opacity-30" /><p className="text-sm">从左侧选择文件，继续编辑</p>{!explorer && <Button variant="outline" size="sm" onClick={() => setExplorer(true)}>打开资源管理器</Button>}</div>}
      </div>
    </div>
    <footer className="workbench-status"><span className="flex items-center gap-1.5"><span className={`workbench-status-dot${dirty ? ' is-dirty' : ''}`} />{!active ? '未打开文件' : saving ? '正在保存…' : readOnly ? '只读' : dirty ? '有未保存的修改' : '已保存'}</span>{active && <><span className="ml-auto">行 {cursor.lineNumber}，列 {cursor.column}</span><span>UTF-8</span><span>{language}</span></>}</footer>
    <AlertDialog open={!!confirmClose} onOpenChange={open => { if (!open) setConfirmClose(null); }}>
      <AlertDialogContent>
        <AlertDialogHeader><AlertDialogTitle>文件还有未保存的修改</AlertDialogTitle><AlertDialogDescription>{confirmClose} 的修改尚未保存。你可以继续编辑并保存，或放弃这些修改后关闭标签。关闭标签不会删除项目文件。</AlertDialogDescription></AlertDialogHeader>
        <AlertDialogFooter><AlertDialogCancel>继续编辑</AlertDialogCancel>{onDiscard && <AlertDialogAction disabled={saving} onClick={() => { setDiscardThenClose(confirmClose); onDiscard(); }}>放弃修改并关闭</AlertDialogAction>}</AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </section>;
}
