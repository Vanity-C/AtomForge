# AtomForge 工作台前端

React、TypeScript、Vite、Tailwind CSS 和 shadcn/ui。项目启动与交付入口参见仓库根目录 README。

- `src/pages/Index.tsx`：公开首页。
- `src/pages/Dashboard.tsx`：项目创建和管理。
- `src/components/`：工作台、智能体会话和预览组件。
- `scripts/test-*.mjs`：会话、生成状态和文件视图逻辑检查。
- `scripts/build-demo-guide.mjs`：将根目录 `docs/DEMO_V1.md` 生成为公开 HTML 说明。

本地开发运行 `pnpm install --frozen-lockfile`、`pnpm dev`，需要配套后端；完整运行优先使用根目录 Docker Compose。发布前运行 `pnpm exec tsc --noEmit`、`pnpm lint`、`node --test scripts/test-*.mjs` 和 `pnpm build`。
