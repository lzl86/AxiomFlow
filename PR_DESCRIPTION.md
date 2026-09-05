# PR: ✨ feat(mvp3): 实现 Sugiyama 拓扑自动分层排布、文献资产解耦、断点无损记忆、章节目录大纲与浅色模式

## 📌 概述 (Overview)

本 PR 全面推进并交付了 **AxiomFlow MVP 3.0** 及 **MVP 3.5 Stage 1** 阶段的核心体验与工效升级，彻底解决了长篇文献深度研读与复杂因果图谱推演中的卡片挤压、视口跳动、文献绑定僵化及日间高光学术阅读疲劳等核心痛点。

---

## 🚀 核心交付特性 (Key Deliverables)

### 1. 🌐 Sugiyama 拓扑因果自动分层排布 (`public/sugiyama_layout.js`)
* **分层排序 (Layer Assignment)**：基于 Kahn 拓扑排序算法，根节点置于第 0 层，下游节点层级严格满足 $Layer(v) = \max_{(u,v) \in E} Layer(u) + 1$；
* **重心法交叉最小化 (Barycenter Crossing Minimization)**：自顶向下根据上游邻接节点的平均 Y 坐标调整本层节点顺序，减少连线交叉；
* **动态包围盒碰撞规避 (Bounding-Box Collision Avoidance)**：根据每个 DOM 节点的真实高度（包含展开的公式与推演正文），施加垂直间距保护与松弛法推移，确保节点间绝不重叠；
* **平滑运动过渡**：通过 `requestAnimationFrame` 驱动 350ms 贝塞尔运动动画与连线实时重绘。

### 2. 📂 文献资产解耦与本地安全上传 (`server.py` + `public/app.js`)
* **资产目录管理**：服务端提供 `GET /api/materials` 动态枚举 `public/materials/` 目录；
* **Python 3.14 标准库兼容**：服务端新增 `POST /api/upload-material`，基于标准库实现 JSON + Base64 payload 上传；
* **课题级文献绑定**：各课题的会话元数据中记录 `activeDoc: { filename, docMode, page, scrollTop }`，实现课题间文献状态隔离。

### 3. 🎯 视口零跳动断点记忆 (Zero-Jump Retention)
* **物理偏移追踪**：离开阅读器面板或切换抽屉时，记录实际物理像素偏移 `lastSavedPdfScrollTop`；
* **DOM 复用与懒渲染**：抽屉重新打开或切回【📖 文献阅读】时，**禁止暴力清空重建 DOM**，以毫秒级恢复上一次停留的精确 `scrollTop`；
* **防抖持久化**：阅读器滚动停止 400ms 后自动触发 `saveReadingBreakpoint()`，将页码与滚动位置持久化到后端存储。

### 4. 📑 PDF 交互式章节目录大纲与光效聚焦 (Interactive Outline & Halo Jump)
* **PDF.js 原生大纲解析**：递归解析 PDF 内置的大纲书签目录（`doc.getOutline()` 与 `getDestination()`），动态构建章节树形列表；
* **平滑滚动与光效聚焦**：点击章节目录条目，视口以 60FPS 平滑滚动物理对齐目标页，同时为目标页附加 1.5 秒的科技感高亮光晕（Halo Effect）；
* **友好降级向导**：若上传文档无内置书签，自动生成 10 页步进的分页快速跳转向导。

### 5. ☀️ 全局浅色模式与主题持久化 (Light Mode & Theme Persistence)
* **学术高对比色彩体系**：在 `[data-theme="light"]` 下构建 Slate / Indigo / Emerald 色彩变量，主背景使用 `#f8fafc` 搭配精细点阵，白底卡片配合高对比深色正文（`#0f172a`）；
* **KaTeX 矢量公式高清晰度**：公式黑白分明、边缘锐利，适合白天长久专注阅读；
* **一键切换与 LocalStorage 记忆**：导航栏提供 `#btn-toggle-theme`（`☀️` 与 `🌙` 动态切换），偏好存储于 `localStorage.axiomflow_theme`，跨页面与重启长效保留。

---

## 🛠️ 文件变更清单 (Changed Files)

| 文件路径 | 改动类型 | 核心说明 |
| :--- | :---: | :--- |
| `public/sugiyama_layout.js` | **NEW** | ESM 自包含 Sugiyama 分层、重心法减叉与动态碰撞消除算法 |
| `public/app.js` | **MODIFY** | 集成自动排布、文献资产动态切换、零跳动断点记忆、大纲目录与主题持久化 |
| `public/style.css` | **MODIFY** | 全局 `[data-theme="light"]` 色彩体系、大纲抽屉、光晕高亮与分屏调宽样式 |
| `public/index.html` | **MODIFY** | 顶部自动排布按钮、主题切换按键、文献资产选择器、大纲抽屉骨架 |
| `server.py` | **MODIFY** | 新增 `/api/materials` 与 `/api/upload-material` 资产管理接口 |
| `README.md` | **MODIFY** | 更新特性矩阵、排布与浅色模式使用说明 |
| `docs/adrs/ADR-02-MVP敏捷迭代路线图.md` | **MODIFY** | 更新 MVP 3.0 状态为已交付 (Delivered) |
| `docs/adrs/ADR-03-MVP3.0与用户体验升级交付说明.md` | **NEW** | 新增架构决策与交付验收技术规范 |

---

## 🧪 验证与测试 (Verification)

* **自动化测试**：执行本地验证套件，静态资源路由 HTTP 200，样式与主题持久化检测 100% 通过；
* **排布与动画**：在包含 10+ 节点的复杂因果图中触发排布，0.3s 内规整无碰撞；
* **阅读断点**：178 页超长学位论文随意滚动并切换选项卡/抽屉，毫秒级无损复原目标页；
* **深浅切换**：在日间高亮与夜间暗光下切换主题，所有组件与 KaTeX 公式渲染正常。
