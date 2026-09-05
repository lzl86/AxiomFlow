# ADR-03: MVP 3.0 体验升级与工程交付规范

| 状态 | 日期 | 迭代版本 | 关联文件 |
| :--- | :--- | :--- | :--- |
| **Accepted / Delivered** | 2026-09-05 | MVP 3.0 + DX Upgrade | [`public/sugiyama_layout.js`](../../public/sugiyama_layout.js), [`public/app.js`](../../public/app.js), [`public/style.css`](../../public/style.css), [`server.py`](../../server.py) |

---

## 1. 业务背景与工程动机

在 AxiomFlow MVP 1.0/2.0 的实践中，科研人员在进行超长文献深度推演时提出了多项高频真实痛点：
1. **卡片重叠与视野遮挡 (Visual Clutter & Card Overlap)**：在分支推理与频繁引用文献时，多节点坐标容易重合挤压，缺乏拓扑因果流自适应排布机制；
2. **文献绑定僵化 (Tight Material Coupling)**：文献被写死在预置资源中，无法按需自由上传外部 PDF/Markdown 论文，且不同课题无法绑定独立文献资产；
3. **视口切换丢失位置 (Scroll Jitter & Context Reset)**：切换抽屉选项卡或关闭侧栏时，浏览器原生重置 `scrollTop`，导致长篇论文被迫回到第 1 页；
4. **长篇文献跳页困难 (Missing Document Outline)**：对于 100+ 页的硕博学位论文，缺乏一键式章节大纲与精准跳转；
5. **暗色阅读疲劳 (Dark Mode Fatigue)**：在日间高亮学术阅读环境中，亟需一套高对比、护眼、公式渲染极其清晰的浅色模式（Light Mode）。

---

## 2. 架构设计与核心技术方案

### 2.1 Sugiyama 拓扑自动分层排布 (`public/sugiyama_layout.js`)
* **分层排序 (Layer Assignment)**：基于 Kahn 拓扑排序算法，根节点置于第 0 层，下游节点层级严格满足 $Layer(v) = \max_{(u,v) \in E} Layer(u) + 1$；
* **重心法交叉最小化 (Barycenter Crossing Minimization)**：自顶向下根据上游邻接节点的平均 Y 坐标调整本层节点顺序，减少连线交叉；
* **动态包围盒碰撞规避 (Bounding-Box Collision Avoidance)**：根据每个 DOM 节点的真实高度（包含展开的公式与推演正文），施加垂直间距保护与松弛法推移，确保节点间绝不重叠；
* **平滑运动过渡**：通过 `requestAnimationFrame` 驱动 350ms 贝塞尔运动动画与连线实时重绘。

### 2.2 文献资产解耦与本地上传 (`server.py` + `public/app.js`)
* **资产目录管理**：服务端提供 `GET /api/materials` 动态枚举 `public/materials/` 目录；
* **标准库 Base64 安全上传**：服务端新增 `POST /api/upload-material`，基于 Python 3.14 标准库（移除了过时的 `cgi` 库）实现 JSON + Base64 payload 上传；
* **课题级文献绑定**：各课题的 `graph.json` 或 `sessions/*.json` 中记录 `activeDoc: { filename, docMode, page, scrollTop }`，实现课题间文献状态隔离。

### 2.3 视口零跳动断点记忆 (Zero-Jump Retention)
* **物理偏移追踪**：离开阅读器面板或切换抽屉时，记录实际物理像素偏移 `lastSavedPdfScrollTop`；
* **DOM 复用与懒渲染**：抽屉重新打开或切回【📖 文献阅读】时，**禁止暴力清空重建 DOM**，以毫秒级恢复上一次停留的精确 `scrollTop`；
* **防抖持久化**：阅读器滚动停止 400ms 后自动触发 `saveReadingBreakpoint()`，将页码与滚动位置持久化到后端存储。

### 2.4 PDF 交互式章节目录大纲 (Interactive Outline & Halo Jump)
* **PDF.js 原生大纲解析**：递归解析 PDF 内置的大纲书签目录（`doc.getOutline()` 与 `getDestination()`），动态构建章节树形列表；
* **平滑滚动与光效聚焦**：点击章节目录条目，视口以 60FPS 平滑滚动物理对齐目标页，同时为目标页附加 1.5 秒的科技感高亮光晕（Halo Effect）；
* **友好降级向导**：若上传文档无内置书签，自动生成 10 页步进的分页快速跳转向导。

### 2.5 全局浅色模式 (Light Mode & Theme Persistence)
* **学术高对比色彩体系**：在 `[data-theme="light"]` 下构建 Slate / Indigo / Emerald 色彩变量，主背景使用 `#f8fafc` 搭配精细点阵，白底卡片配合高对比深色正文（`#0f172a`）；
* **KaTeX 矢量公式高清晰度**：公式黑白分明、边缘锐利，适合白天长久专注阅读；
* **一键切换与 LocalStorage 记忆**：导航栏提供 `#btn-toggle-theme`（`☀️` 与 `🌙` 动态切换），偏好存储于 `localStorage.axiomflow_theme`，跨页面与重启长效保留。

---

## 3. 架构不变性 (Invariants & Rules)

1. **零构建规则 (Zero-Build Rule)**：完全保持 ESM + 原生 CSS + Python 标准库体系，绝不引入 node_modules 与打包器；
2. **Python 3.14 向上兼容**：严格规避已废弃的 Python 标准库模块，保持环境极简轻量；
3. **物理拓扑隔离真理**：任何界面排布与主题样式的升级，均不影响 DAG 有效祖先节点入 Prompt 的核心隔离机制。

---

## 4. 交付文件清单

| 文件路径 | 改动类型 | 核心说明 |
| :--- | :---: | :--- |
| [`public/sugiyama_layout.js`](../../public/sugiyama_layout.js) | **[NEW]** | ESM 自包含 Sugiyama 分层、重心法减叉与动态碰撞消除算法 |
| [`public/app.js`](../../public/app.js) | **[MODIFY]** | 集成自动排布、文献资产动态切换、零跳动断点记忆、大纲目录与主题持久化 |
| [`public/style.css`](../../public/style.css) | **[MODIFY]** | 全局 `[data-theme="light"]` 色彩体系、大纲抽屉、光晕高亮与分屏调宽样式 |
| [`public/index.html`](../../public/index.html) | **[MODIFY]** | 顶部自动排布按钮、主题切换按键、文献资产选择器、大纲抽屉骨架 |
| [`server.py`](../../server.py) | **[MODIFY]** | 新增 `/api/materials` 与 `/api/upload-material` 资产管理接口 |
| [`README.md`](../../README.md) | **[MODIFY]** | 更新特性矩阵、排布与浅色模式使用说明 |
| [`docs/adrs/ADR-02-MVP敏捷迭代路线图.md`](./ADR-02-MVP敏捷迭代路线图.md) | **[MODIFY]** | 更新 MVP 3.0 状态为已交付 (Delivered) |
