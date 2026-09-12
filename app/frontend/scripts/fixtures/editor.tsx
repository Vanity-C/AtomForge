// Isolated browser fixture: never reads or writes a user's project or credentials.
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import CodePanel from '../../src/components/CodePanel';
import '../../src/index.css';

const initial = [
  { path: 'App.jsx', content: 'const greeting = "hello";\nexport default function App() {\n  return <main>{greeting}</main>;\n}\n' },
  { path: 'src/styles.css', content: 'body {\n  color: red;\n}\n' },
  { path: 'config.json', content: '{"name": "test"}\n' },
  { path: 'index.html', content: '<main>Hello</main>' },
];
function Fixture() {
  const [files, setFiles] = useState(initial);
  const [path, setPath] = useState('App.jsx');
  const [draft, setDraft] = useState<string | null>(null);
  const [version, setVersion] = useState(1);
  const [saving, setSaving] = useState(false);
  const [readOnly, setReadOnly] = useState(false);
  const [mounted, setMounted] = useState(true);
  const [visible, setVisible] = useState(false);
  const [message, setMessage] = useState('');
  const [fail, setFail] = useState(false);
  const active = files.find(file => file.path === path);
  const dirty = draft !== null && !!active && draft !== active.content;
  return <>
    <div className="flex gap-5 p-3">
      <button onClick={() => setVisible(v => !v)}>显示文件</button>
      <button onClick={() => setReadOnly(v => !v)}>切换只读</button>
      <button onClick={() => setMounted(v => !v)}>重新挂载</button>
      <button onClick={() => setFail(v => !v)}>模拟保存失败</button>
      <button onClick={() => document.documentElement.classList.toggle('dark')}>切换主题</button>
      <output data-testid="version">v{version}</output><output data-testid="message">{message}</output>
    </div>
    <output data-testid="draft" hidden>{draft}</output>
    <output data-testid="saved" hidden>{active?.content}</output>
    <div style={{ display: visible ? 'block' : 'none', height: 700 }}>
      {mounted && <CodePanel files={files} activePath={path} readOnly={readOnly} draft={draft ?? active?.content ?? ''} dirty={dirty} saving={saving} onDraftChange={setDraft} onDiscard={() => setDraft(null)} onSelect={next => { if (dirty) { setMessage('请先保存'); return; } setPath(next); setDraft(null); }} onSave={async () => {
        if (saving || !dirty) return;
        setSaving(true);
        await new Promise(resolve => setTimeout(resolve, 400));
        if (fail) setMessage('保存失败');
        else { setFiles(files.map(file => file.path === path ? { ...file, content: draft! } : file)); setDraft(null); setVersion(v => v + 1); }
        setSaving(false);
      }} />}
    </div>
  </>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><Fixture /></React.StrictMode>);
