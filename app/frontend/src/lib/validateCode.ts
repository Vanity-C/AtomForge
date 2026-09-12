import type { GeneratedFile } from '@/lib/agent/codegen';

interface Compiler { transform: (code: string, options: Record<string, unknown>) => unknown; }
let loading: Promise<Compiler> | undefined;
function compiler(): Promise<Compiler> {
  if (!loading) loading = new Promise<Compiler>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = '/preview-vendor/babel.js';
    script.onload = () => resolve((window as unknown as {Babel: Compiler}).Babel);
    script.onerror = () => { loading = undefined; reject(new Error('代码检查器加载失败，请刷新后重试')); };
    document.head.appendChild(script);
  });
  return loading;
}
export async function validateCode(files: GeneratedFile[]) {
  const babel = await compiler();
  for (const file of files.filter(f => /\.(jsx|js|tsx|ts)$/.test(f.path))) {
    babel.transform(file.content, {presets:['react', ...(/\.tsx?$/.test(file.path)?['typescript']:[])], plugins:['transform-modules-commonjs'], filename:file.path});
  }
}
