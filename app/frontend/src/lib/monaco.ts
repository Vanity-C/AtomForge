import * as monaco from 'monaco-editor';
import EditorWorker from 'monaco-editor/editor/editor.worker?worker';
import JsonWorker from 'monaco-editor/languages/features/json/json.worker?worker';
import CssWorker from 'monaco-editor/languages/features/css/css.worker?worker';
import HtmlWorker from 'monaco-editor/languages/features/html/html.worker?worker';
import TypeScriptWorker from 'monaco-editor/languages/features/typescript/ts.worker?worker';

// Bundle workers locally: editing must not depend on a third-party CDN.
self.MonacoEnvironment = {
  getWorker(_id, label) {
    if (label === 'json') return new JsonWorker();
    if (['css', 'scss', 'less'].includes(label)) return new CssWorker();
    if (['html', 'handlebars', 'razor'].includes(label)) return new HtmlWorker();
    if (['typescript', 'javascript'].includes(label)) return new TypeScriptWorker();
    return new EditorWorker();
  },
};

for (const defaults of [monaco.typescript.javascriptDefaults, monaco.typescript.typescriptDefaults]) {
  defaults.setCompilerOptions({
    allowJs: true, allowNonTsExtensions: true, target: monaco.typescript.ScriptTarget.ESNext,
    module: monaco.typescript.ModuleKind.ESNext, moduleResolution: monaco.typescript.ModuleResolutionKind.NodeJs,
    jsx: monaco.typescript.JsxEmit.ReactJSX, esModuleInterop: true,
  });
  // The browser has project sources, but not the project's node_modules/types.
  defaults.setDiagnosticsOptions({ noSemanticValidation: true, noSyntaxValidation: false });
}

export { monaco };
