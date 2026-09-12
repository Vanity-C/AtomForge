/**
 * Agent orchestration for code generation.
 *
 * The agent answers with a short plan followed by file blocks delimited by
 * `<<<FILE path="...">>> ... <<<END>>>`. Parsing is incremental so the UI can
 * render the file tree while the model is still streaming.
 */
import {
  type ChatTurn,
  type GenerationProfile,
  runTextModel,
} from '@/lib/agent/modelProvider';

export interface GeneratedFile {
  path: string;
  language: string;
  content: string;
}

export interface ParsedAgentOutput {
  /** Prose written before the first file block — used as the chat reply. */
  narrative: string;
  files: GeneratedFile[];
  /** Path of the block currently being streamed, if any. */
  streamingPath: string | null;
}

const FILE_OPEN = /<<<FILE\s+path="([^"]+)"\s*>>>/g;
const FILE_END = '<<<END>>>';

export function languageOf(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'jsx' || ext === 'js') return 'jsx';
  if (ext === 'css') return 'css';
  if (ext === 'json') return 'json';
  if (ext === 'md') return 'markdown';
  if (ext === 'html') return 'html';
  return 'text';
}

function normalizePath(raw: string): string {
  return raw.trim().replace(/^\.\//, '').replace(/^\/+/, '');
}

function stripFence(content: string): string {
  let body = content.replace(/^\s*\n/, '');
  const fence = body.match(/^```[a-zA-Z]*\n([\s\S]*?)```\s*$/);
  if (fence) body = fence[1];
  return body.replace(/\s+$/, '');
}

/**
 * Parse a (possibly partial) model response into narrative text and files.
 * Safe to call on every stream chunk.
 */
export function parseAgentOutput(raw: string): ParsedAgentOutput {
  const files: GeneratedFile[] = [];
  let streamingPath: string | null = null;
  let narrativeEnd = raw.length;

  FILE_OPEN.lastIndex = 0;
  let match = FILE_OPEN.exec(raw);
  if (match) narrativeEnd = match.index;

  while (match) {
    const path = normalizePath(match[1]);
    const bodyStart = match.index + match[0].length;
    const endIdx = raw.indexOf(FILE_END, bodyStart);

    FILE_OPEN.lastIndex = bodyStart;
    const nextMatch = FILE_OPEN.exec(raw);

    const closed = endIdx !== -1 && (!nextMatch || endIdx < nextMatch.index);
    const bodyEnd = closed ? endIdx : nextMatch ? nextMatch.index : raw.length;
    const content = stripFence(raw.slice(bodyStart, bodyEnd));

    if (path) {
      files.push({ path, language: languageOf(path), content });
      if (!closed) streamingPath = path;
    }

    if (closed) {
      FILE_OPEN.lastIndex = endIdx + FILE_END.length;
      match = FILE_OPEN.exec(raw);
    } else {
      match = nextMatch;
    }
  }

  const narrative = raw
    .slice(0, narrativeEnd)
    .replace(/```[\s\S]*$/, '')
    .trim();

  return { narrative, files, streamingPath };
}

const SYSTEM_PROMPT = `你是 AtomForge 的应用生成智能体。你的任务是根据用户的自然语言需求，生成一个**可以直接在浏览器沙箱中运行的多文件 React 应用**。

## 输出格式（必须严格遵守）
1. 先用 3-6 行中文说明你的实现方案（做了什么页面、什么交互、什么数据结构），不要写代码。
2. 然后依次输出每个文件，每个文件必须用下面的标记包裹：

<<<FILE path="App.jsx">>>
（这里是完整文件内容，不要用 markdown 代码围栏）
<<<END>>>

3. 文件块之外不要写任何解释文字。不要输出 diff 或省略号，每个文件都必须是完整可运行的内容。

## 运行环境约束（非常重要，违反会导致应用无法运行）
- 运行时已全局提供 React 18（含所有 hooks）。**禁止** import 任何 npm 包（不能 import react、react-dom、lucide-react、axios 等）。
- 直接使用全局的 React、useState、useEffect、useMemo、useRef、useCallback、useReducer，无需 import。
- 允许在自己生成的文件之间相对引用，例如：\`import Header from './components/Header.jsx'\`（后缀可省略）。
- 必须有 \`App.jsx\`，并且使用 \`export default function App() { ... }\`。
- 样式：使用内联 style 或生成 \`styles.css\` 文件（会被自动注入页面）。不要使用 Tailwind class（沙箱内没有 Tailwind）。
- 需要持久化时使用 \`localStorage\`；需要图标时用 emoji 或内联 SVG。
- 禁止使用 TypeScript 语法（不要类型注解）。文件后缀只用 .jsx / .css。
- 不要访问外部网络接口，用本地 mock 数据即可。

## 质量要求
- 3-6 个文件，结构清晰：App.jsx + components/*.jsx + styles.css。
- 界面要完整可用：真实交互、空状态、hover 反馈、合理的留白与配色，不要占位符。
- 中文界面文案（除非用户要求英文）。
- 代码要能一次跑通：注意括号闭合、组件都有 export default、引用路径与文件名完全一致。`;

export interface GenerateParams {
  profile: GenerationProfile;
  /** Prior conversation, oldest first. */
  history: { role: 'user' | 'assistant'; content: string }[];
  /** The new user instruction. */
  instruction: string;
  /** Current project files, empty for the first generation. */
  currentFiles: GeneratedFile[];
  onUpdate: (parsed: ParsedAgentOutput, raw: string) => void;
  signal?: AbortSignal;
}

function describeFiles(files: GeneratedFile[]): string {
  if (!files.length) return '';
  const body = files
    .map((f) => `<<<FILE path="${f.path}">>>\n${f.content}\n<<<END>>>`)
    .join('\n');
  return `当前项目的全部文件如下，请在此基础上修改。输出时必须重新给出**所有**需要保留的文件的完整内容（未改动的文件也要原样输出），不要只输出改动片段。\n\n${body}`;
}

/** Run one agent turn and stream incremental parse results to the caller. */
export async function generateApp(params: GenerateParams): Promise<ParsedAgentOutput> {
  const { profile, history, instruction, currentFiles, onUpdate } = params;

  const messages: ChatTurn[] = [{ role: 'system', content: SYSTEM_PROMPT }];

  for (const turn of history.slice(-6)) {
    messages.push({
      role: turn.role,
      content: turn.content.slice(0, 4000),
    });
  }

  const context = describeFiles(currentFiles);
  messages.push({
    role: 'user',
    content: context ? `${context}\n\n---\n\n用户新需求：${instruction}` : instruction,
  });

  const raw = await runTextModel(messages, profile, {
    onChunk: (_delta, aggregated) => onUpdate(parseAgentOutput(aggregated), aggregated),
  }, params.signal);

  const parsed = parseAgentOutput(raw);
  if (parsed.streamingPath) throw new Error('模型输出不完整，请重试；上一版本未修改');
  if (!parsed.files.some(f => f.path === 'App.jsx' && /export\s+default\b/.test(f.content))) {
    throw new Error('生成结果缺少 App.jsx 默认导出组件，请重试');
  }
  if (parsed.files.length > 30 || new Set(parsed.files.map(f => f.path)).size !== parsed.files.length) {
    throw new Error('生成结果包含重复文件或文件过多，请缩小需求后重试');
  }
  for (const file of parsed.files) {
    if (file.path.includes('..') || !/^[\w./-]+\.(jsx|js|css)$/.test(file.path)) {
      throw new Error(`不支持的文件路径：${file.path}`);
    }
  }
  onUpdate(parsed, raw);
  return parsed;
}

/** Ask the model for a short project name from the first prompt. */
export async function suggestProjectName(
  instruction: string,
  profile: GenerationProfile,
): Promise<string> {
  try {
    const text = await runTextModel(
      [
        {
          role: 'system',
          content: '你是命名助手。根据需求给出一个 4-12 个字的中文项目名，只输出名称本身，不要标点和解释。',
        },
        { role: 'user', content: instruction },
      ],
      profile,
    );
    const name = text.trim().split('\n')[0].replace(/["'`。，,.]/g, '').slice(0, 24);
    return name || instruction.slice(0, 16);
  } catch {
    return instruction.slice(0, 16) || '未命名应用';
  }
}
