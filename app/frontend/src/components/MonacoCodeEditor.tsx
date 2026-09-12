import { useEffect, useId, useRef, useState } from 'react';
import type { editor } from 'monaco-editor';
import { Loader2 } from 'lucide-react';
import type { GeneratedFile } from '@/lib/agent/codegen';

interface Props {
  files: GeneratedFile[];
  path: string;
  value: string;
  readOnly: boolean;
  canSave: boolean;
  wordWrap: boolean;
  command: { id: number; action: string } | null;
  onChange?: (value: string) => void;
  onSave?: () => void;
  onCursor: (position: { lineNumber: number; column: number }) => void;
  onReadyChange: (ready: boolean) => void;
}

export default function MonacoCodeEditor(props: Props) {
  const host = useRef<HTMLDivElement>(null);
  const latest = useRef(props);
  latest.current = props;
  const scope = useId();
  const runtime = useRef<Awaited<typeof import('@/lib/monaco')> | null>(null);
  const instance = useRef<editor.IStandaloneCodeEditor | null>(null);
  const models = useRef(new Map<string, editor.ITextModel>());
  const views = useRef(new Map<string, editor.ICodeEditorViewState>());
  const currentPath = useRef('');
  const syncing = useRef(false);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [visibleOnce, setVisibleOnce] = useState(false);
  useEffect(() => { props.onReadyChange(ready); }, [ready, props.onReadyChange]);

  useEffect(() => {
    if (!host.current) return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) {
        setVisibleOnce(true);
        observer.disconnect();
      }
    });
    observer.observe(host.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!visibleOnce) return;
    let cancelled = false;
    let dispose = () => {};
    setFailed(false);
    void import('@/lib/monaco').then((loaded) => {
      if (cancelled || !host.current) return;
      runtime.current = loaded;
      const { monaco } = loaded;
      const editor = monaco.editor.create(host.current, {
        model: null, automaticLayout: true, fontSize: 13, lineHeight: 22,
        fontFamily: "'JetBrains Mono', Consolas, 'Courier New', monospace",
        padding: { top: 14, bottom: 20 }, minimap: { enabled: false },
        scrollBeyondLastLine: false, smoothScrolling: true,
        bracketPairColorization: { enabled: true }, guides: { bracketPairs: true },
        folding: true, showFoldingControls: 'mouseover', tabSize: 2,
        readOnly: latest.current.readOnly, wordWrap: latest.current.wordWrap ? 'on' : 'off',
        fixedOverflowWidgets: true, ariaLabel: '文件内容',
      });
      instance.current = editor;
      const theme = () => monaco.editor.setTheme(document.documentElement.classList.contains('dark') ? 'vs-dark' : 'vs');
      theme();
      const observer = new MutationObserver(theme);
      observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
      const change = editor.onDidChangeModelContent(() => {
        if (!syncing.current && !latest.current.readOnly) latest.current.onChange?.(editor.getValue());
      });
      const cursor = editor.onDidChangeCursorPosition(({ position }) => latest.current.onCursor(position));
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
        if (latest.current.canSave && !latest.current.readOnly) latest.current.onSave?.();
      });
      dispose = () => {
        observer.disconnect(); change.dispose(); cursor.dispose(); editor.dispose();
        for (const model of models.current.values()) model.dispose();
        models.current.clear(); views.current.clear(); currentPath.current = '';
        instance.current = null;
      };
      setReady(true);
    }).catch(() => { if (!cancelled) { dispose(); setFailed(true); setReady(false); } });
    return () => { cancelled = true; dispose(); };
  }, [visibleOnce]);

  useEffect(() => {
    const editor = instance.current;
    const monaco = runtime.current?.monaco;
    if (!ready || !editor || !monaco) return;
    syncing.current = true;
    try {
      // Instance-scoped URIs keep undo histories and language services isolated between projects.
      for (const file of props.files) {
        const value = file.path === props.path ? props.value : file.content;
        let model = models.current.get(file.path);
        if (!model) {
          model = monaco.editor.createModel(value, undefined, monaco.Uri.from({ scheme: 'file', path: `/atomforge/${encodeURIComponent(scope)}/${file.path}` }));
          model.updateOptions({ tabSize: 2, insertSpaces: true });
          models.current.set(file.path, model);
        } else if (model.getValue() !== value) {
          // Version/source changes replace the baseline; ordinary typing never resets undo.
          model.setValue(value);
        }
      }
      if (currentPath.current !== props.path) {
        const view = editor.saveViewState();
        if (view) views.current.set(currentPath.current, view);
        editor.setModel(models.current.get(props.path) ?? null);
        const saved = views.current.get(props.path);
        if (saved) editor.restoreViewState(saved);
        currentPath.current = props.path;
        props.onCursor(editor.getPosition() ?? { lineNumber: 1, column: 1 });
      }
      for (const [path, model] of models.current) {
        if (!props.files.some(file => file.path === path)) {
          model.dispose(); models.current.delete(path); views.current.delete(path);
        }
      }
    } finally { syncing.current = false; }
  }, [ready, props.files, props.path, props.value, props.onCursor, scope]);

  useEffect(() => {
    instance.current?.updateOptions({ readOnly: props.readOnly, wordWrap: props.wordWrap ? 'on' : 'off' });
  }, [ready, props.readOnly, props.wordWrap]);

  useEffect(() => {
    if (!props.command || !instance.current) return;
    instance.current.focus();
    void instance.current.getAction(props.command.action)?.run();
  }, [props.command]);

  return <div className="relative h-full min-h-0" data-editor-state={failed ? 'fallback' : ready ? 'ready' : 'loading'}>
    <div ref={host} className="absolute inset-0" />
    {!ready && !failed && <div className="absolute inset-0 flex items-center justify-center gap-2 bg-card text-xs text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />正在准备代码编辑器…</div>}
    {failed && <div className="absolute inset-0 flex flex-col bg-card">
      <div role="status" className="border-b p-3 text-xs leading-relaxed text-muted-foreground">编辑器加载失败，仍可使用文本模式编辑和保存。网络恢复后，请先保存修改，再刷新页面重试。</div>
      <textarea aria-label="文件内容" className="code-surface min-h-0 flex-1 resize-none p-4 outline-none" wrap={props.wordWrap ? 'soft' : 'off'} value={props.value} readOnly={props.readOnly} spellCheck={false} onChange={e => props.onChange?.(e.target.value)} onKeyDown={e => { if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); if (props.canSave && !props.readOnly) props.onSave?.(); } }} />
    </div>}
  </div>;
}
