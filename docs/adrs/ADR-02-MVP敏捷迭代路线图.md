# ADR-02: MVP 敏捷迭代与科研安全红线 (Iterative Roadmap & Architecture Invariants)

**日期**: 2026-09-03 (更新于 2026-09-07)  
**状态**: ✅ Accepted (已通过核心架构决议，MVP 3.5 已全面合流交付)  
**核心原则**: 渐进式实证突围 (Progressive Grounding) 与 极简零依赖原则 (Zero-Build Minimalism)

---

## 1. 背景与技术演进史 (Context & Evolution)

AxiomFlow 起初仅为一个极简的原型脚本工程（工作区 `Tree`）。在伴随实际科研论文（如《差分相衬显微成像中照明调制方法及应用研究》）的实证推演过程中，系统逐步完成了从“基础文本对话”向“多模态学术级科研工作台”的深度质变。

为确保系统在后续扩展中不偏离“严谨学术推演”轨道，特此确立自底向上的分阶段 MVP 路线与工程技术断言。

---

## 2. 阶段性 MVP 路线图 (The Phased Roadmap)

任何后续接手本工程的协同 AI 智能体或工程师，**必须严格沿着以下阶梯顺序递进推进**：

### 阶段 1: MVP 1.0 (单页画布与基础 DAG 问答) —— [✅ 已完成]
*   **主场模块**：`public/app.js`, `server.py`
*   **核心突破**：建立无向/有向 DAG 拓扑图谱，实现节点平移、缩放、多端口拉线，接入 OpenAI / Gemini 兼容格式的大语言模型生成接口。
*   **验收标准**：可在画布上自由新建节点，连线后右侧审查器能够实时预览拓扑上下文。

### 阶段 2: MVP 1.5 (分屏工作台与多课题持久化) —— [✅ 已完成]
*   **主场模块**：`server.py` (`/api/sessions`), `public/index.html`
*   **核心突破**：
    1. 引入 50:50 / 70% 宽屏无级拖拽分屏抽屉，实现“左图右书”的科研视窗；
    2. 实现 `sessions/` 多课题目录化独立存储与秒级无损切换，彻底解决数据串扰。
*   **验收标准**：新建课题、切换课题时画布状态丝滑切换，页面刷新后拓扑布局 100% 完整复原。

### 阶段 3: MVP 2.0 (178页超长论文虚拟连续滚动阅读器) —— [✅ 已完成]
*   **主场模块**：`public/app.js`, `public/style.css` (`#pdf-continuous-scroll`)
*   **核心突破**：
    1. 废除简陋的单页翻页 Canvas，重构为 **虚拟化懒加载连续滚动阅读器**；
    2. 基于 `IntersectionObserver` 实施视口前后 800px 预渲染，彻底化解 178 页超长论文导致浏览器爆显存崩溃的灾难；
    3. 注入基于视口物理滚动位置的 `onscroll` 活跃页码探测器，实现鼠标滚轮滑动与工具栏页码框毫秒级无感双向对齐。
*   **验收标准**：超长 PDF 论文 60FPS 顺畅平滑滚动，内存占用降低 80% 以上，划词选区与页码定位零偏差。

### 阶段 4: MVP 2.5 (Mathpix 级学术框选与多模态 LaTeX 自动反编译) —— [✅ 已完成]
*   **主场模块**：`server.py` (`/api/ocr-formula`), `public/app.js` (`setupPdfSnipper`, `transcribeFormula`)
*   **核心突破**：
    1. 突破字符流划词局限，开发支持连续滚动页面的高精度矩形拉框切片工具；
    2. 调用 Gemini 视觉大模型将高 DPI 像素切片反编译为标准的 LaTeX 数学公式（`$$...$$`）与变量物理定义；
    3. 配合 KaTeX 实现保真矢量学术排版。
*   **验收标准**：拉框后在画布上毫秒级生成带有原版视觉切片的实证卡片，1~3 秒内自动填充反编译好的 LaTeX 公式。

---

### 阶段 5: MVP 3.0 (工作台工效、阅读连续性、多态代码实证与拓扑分层排布 / Ergonomics, Persistence, Auto-Layout & Multi-Modal Grounding) —— [✅ 全部 5 项核心突破与验收标准已圆满交付]
*   **主场模块**：`public/sugiyama_layout.js`, `public/app.js`, `public/style.css`, `public/index.html`, `server.py`
*   **核心突破**：
    1. **文献资产解耦与断点记忆持久化 (Document Decoupling & Reading Persistence) [✅已交付]**：
       * **彻底解除论文硬编码**：将前端写死的特定论文名称彻底解耦，改造为基于会话元数据（`session.activeDoc`）的动态文献加载机制；支持自由上传 PDF/TXT/MD 等格式；
       * **会话级自定义文献绑定**：支持用户为不同课题独立上传或从资产目录切换不同的自定义文献资产，实现“一个课题对应一份目标文献资产”的清晰映射；
       * **视窗状态与断点无损复原 (Zero-Jump Retention)**：抽屉切换与折叠时物理 `scrollTop` 零跳动，离开前记录位置，重新切回时禁止暴力清空 DOM，跨会话毫秒级精确还原阅读进度。
    2. **DAG 画布拓扑自动分层整理 (Sugiyama Auto-Layout & Anti-Overlap) [✅已交付]**：
       * 引入经典有向无环图分层布局算法（Sugiyama Layout / Topological Rank Sorting）：基于 Kahn 拓扑排序计算层级，结合重心法（Barycentric Heuristic）最小化连线交叉；
       * 计算卡片物理包围盒（Bounding Box Collision），动态消除卡片层叠挤压，自左向右沿因果流向舒展排列，并由 `requestAnimationFrame` 驱动 350ms 贝塞尔平滑过渡动画与连线实时重绘。
    3. **PDF 交互式章节目录大纲与光效聚焦 (Interactive Outline & Halo Jump) [✅已交付]**：
       * 递归解析 PDF.js 原生大纲书签目录（`doc.getOutline()` 与 `getDestination()`），动态构建章节树形列表；
       * 点击章节目录，视口以 60FPS 平滑滚动物理对齐目标页，同时为目标页附加 1.5 秒的科技感高亮光晕（Halo Jump）；若文档无内置书签，自动降级生成分页快速跳转向导。
    4. **全局浅色模式与主题持久化 (Light Mode & Theme Persistence) [✅已交付]**：
       * 适配日间学术高对比度阅读色彩体系，在 `[data-theme="light"]` 下构建 Slate / Indigo / Emerald 变量，白底卡片搭配深色高清晰度正文，KaTeX 公式黑白锐利分明；
       * 导航栏提供 `☀️ / 🌙` 一键切换，偏好存储于 `localStorage.axiomflow_theme`，跨页面与重启长效保留。
    5. **源码与多态公理实证支持与硬件探针 (Source Code & GDB/NEMU Runtime Ingestion) [✅已交付]**：
       * **代码块渲染与指针防转义守卫**：卡片与审查器原生支持标准 Markdown 代码块（如 ` ```c `），注入暗色等宽代码高亮，严格保护 C/C++ 指针星号 `*` 与下划线 `_` 免遭 Markdown 解析器误转为斜体或加粗；
       * **剪贴板极速建卡通道**：支持直接从系统剪贴板一键将代码片段（如操作系统 `eval()` 进程与信号控制流）录入为合法的“源码公理实证节点”（快捷键 `Alt+C`）；
       * **微观机理推演 Prompt 解绑**：解构泛化学术提示词对微观机理的压制，在面对代码与底层系统调用推演时，自适应释放对并发竞态、内核信号掩码翻转、进程组拓扑等硬核底层微观机制的深度推导能力；
       * **GDB / NEMU 运行时动态调试探针通道 (Runtime GDB/MI & Trace Ingestion)**：通过 `antigravity_bridge.py` 注入轻量 GDB/MI 协议监听器，支持在 Linux 终端单步调试内核、用户程序或 NEMU 仿真器时，敲击自定义指令（如 `dump-to-tree`）一键将崩溃断点的反汇编指令段、16 个通用寄存器状态和栈顶物理内存 Dump 直接挂载为画布上的“真实硬件物理态实证卡片”，实测毫秒级（110~130ms）入图。
*   **验收标准**：
    1. **[✅ 已达标]** 在阅读器中可自由上传或切换为任意自定义 PDF，并在该长文中滚动至 P.68；刷新网页后，系统 100% 精确复原该文献并停留在 P.68，页面零跳动；
    2. **[✅ 已达标]** 画布上堆叠有 10+ 乱序摆放甚至重叠的卡片，点击“✨ 自动分层排布”，0.3 秒内自动舒展为整齐划一的因果层级网络；
    3. **[✅ 已达标]** 点击“📑 章节目录”展开大纲树，点击小节直接跳至目标页并高亮显示；点击主题按钮平滑切换浅色日间阅读模式；
    4. **[✅ 已达标]** 支持将一段 C 语言内核代码（如 CS:APP `eval()`）直接粘贴为实证卡片，卡片内等宽语法高亮正常；挂载课题后，大模型能沿着拓扑祖先准确剖析信号屏蔽时序与进程组隔离机制；
    5. **[✅ 已达标]** 终端 GDB 触发断点后，执行命令可将当前寄存器与内存快照在 1 秒内（实测 110~130ms）无缝推送至画布生成高亮实证节点。

---

### 阶段 6: MVP 3.5 (单文献/单工程宏微观分层研读引擎 / Hierarchical Macro-Skeleton & Neighborhood Deep-Dive) —— [✅ 全部 3 项核心突破与验收标准已圆满交付]
*   **主场模块**：`server.py` (`/api/paper-outline`, `/api/paper-neighborhood`, `/api/generate`), `public/app.js`, `public/index.html`, `public/style.css`
*   **核心突破**：
    1. **Stage 1 全局粗读（骨架成树·宏观全景导航）[✅ 已交付]**：
       * **原生 PDF 大纲递归解析与目录树抽屉**：通过 PDF.js `doc.getOutline()` 与 `getDestination()` 动态构建侧栏章节大纲树（`#pdf-outline-panel`），每级条目绑定精确物理页码徽标（`P.xx`）；对无书签文献提供分页快速跳转向导；
       * **长上下文大模型与原生 PDF 书签双模骨架**：后端 `/api/paper-outline` 深度解析 `pypdf` 原生书签树（实测 108 级即时直出），无内置书签时长文自适应回退至大模型结构化提炼；
    2. **Stage 2 视界对焦（靶向定位·邻域探针）[✅ 已交付]**：
       * **视界平滑卷动与目标页科技感光晕 (Halo Jump)**：点击大纲小节，视口 60FPS 垂直平滑滚动直达目标页（`scrollToPage`），并伴随 1.5 秒高亮光晕聚焦（`page-highlight`）；
       * **邻域高密度上下文缓冲带 (Neighborhood Buffer)**：后端 `/api/paper-neighborhood` 接口基于 `pypdf` 极速（~160ms）切片提取**目标页 $\pm 2$ 页**物理原文，前端大纲条目内嵌“探针”按钮与快捷弹窗，动态提取领域术语 Chip 并渲染字符统计；
    3. **Stage 3 显微研读（局部无幻觉推演与双向闭环）[✅ 已交付]**：
       * **物理切片硬约束注入**：在 `/api/generate` 中注入严格无幻觉物理切片约束，模型被精准锚定在切片原文事实中；
       * **图谱卡片来源徽章与原文反向直达**：生成的实证卡片顶部挂载 `[文献名... · P.xx-yy · 跳转查阅]` 交互徽章，在画布任意位置点击即可秒级唤起阅读器抽屉并平滑滚至目标物理页码高亮，达成“论点 ➔ 原文”严密双向闭环。
*   **验收标准**：
    1. **[✅ 已达标]** 可在阅读器侧边一键拉出章节大纲树，点击“2.3 差分相衬显微成像实验结果”自动平滑滚动至第 49 页并激发光晕高亮；
    2. **[✅ 已达标]** 针对任意小节点击“探针”发起追问时，模型自动绑定目标页 $\pm 2$ 页的邻域上下文，1~2 秒内精准解答公式细节与学术内涵；卡片上点击来源徽章可反向毫秒级定位原文并触发光效脉冲。

### 阶段 7: MVP 4.0 (双引擎自主调度、多文献融合与外部认知资产双向水合 / Obsidian 与 Web AI 对话流) —— [✅ 双引擎与高帧率渲染已交付(PR #2)，参见 ADR-04；多源水合顺延演进中]
*   **主场模块**：`public/materials/`, `server.py` (`/api/test-connection`, `/api/hydrate`, `/api/upload-material`), `public/app.js`
*   **核心突破**：
    1. **双引擎自适应分发、密钥安全管理与 120Hz 硬件加速 [✅ PR #2 已交付，参见 ADR-04]**：
       * **双引擎路由解耦**：深度推理大模型（DeepSeek-V4 Pro / R1, Qwen3.8-Max 等）与视觉模型（Qwen2.5-VL-72B, qwen-vl-max 等）解耦，`resolve_vision_model` 守卫自动分发截框公式 OCR；
       * **服务商密钥隔离记忆**：`localStorage.axiomflow_provider_keys` 按服务商安全记忆，提供 `/api/test-connection` 毫秒级探测；
       * **120Hz 硬件加速与因果聚焦**：`updateConnectedEdges` 增量连线算法（0 DOM 销毁）与 GPU 矩阵缩放；拓扑因果聚焦（Topology Focus）智能高亮直接依赖链；
    2. **多文献库管理 (Multi-Document Shelf) [✅ 基础上传与切换底座已由 PR #1 交付]**：支持在阅读器中自由上传本地 PDF/MD 文献（`POST /api/upload-material`），并通过下拉选择器自由切换，文献与课题会话（`session.activeDoc`）实现解耦隔离；后续进阶双栏并排比对；
    3. **跨文献实证图谱融合 (Cross-Paper Fusion)**：基于 MVP 3.5 的章节大纲经纬度，将来自【论文 A 弱散射章节】与【论文 B 玻恩近似章节】的实证卡片同时连入同一个课题节点，由大模型进行交叉比对（Cross-Examination），自动挖掘理论冲突与学术空白；
    4. **Obsidian 静态知识库与动态 DAG 画布双向水合 (Bidirectional Obsidian Hydration Pipeline)**：
       * **静态笔记 $\to$ 动态 DAG 拓扑反演**：输入任一 Obsidian 概念（如 `[[虚拟内存]]`），后端自动扫描解析其入链与出链依赖，在画布上一键展开为包含前置公理与衍生结论的局部因果子图；
       * **动态推演 $\to$ 结构化笔记结晶**：画布探究完成后，支持将当前有效祖先推演链路一键结晶导出为符合 Obsidian 规范、携带标准 Wikilinks 与学术锚点的复盘 Markdown 笔记，实现知识资产沉淀闭环。
    5. **外部 AI 对话记录水合与问答因果拓扑化 (Web AI Chat Markdown Ingestion & Multi-Turn Decomposition)**：
       * **跨平台科研探索接力与标准防腐层 (Anti-Corruption Layer)**：
         * 用户在网页端（Gemini / Claude / ChatGPT）进行前沿发散探讨后，借助成熟浏览器扩展（如 *AI Exporter*）导出标准化 Markdown；
         * 贯彻架构防腐层原则：彻底解耦外部网页频繁变动的脆弱 DOM 结构与严苛的 CSP 跨域限制，AxiomFlow 仅以纯净 Markdown 为契约资产，零爬虫负担，零网络跨域风险；
       * **双通道极速入图交互 (Dual-Channel Unified Ingestion)**：
         * **通道 1：Edge 下载托盘/本地文件拖拽 (Drag & Drop)**：点击插件 `[MD]` 下载后，无需翻找系统目录，直接从浏览器右上角下载托盘（`↓`）将 `.md` 文件拖入画布空白处释放；画布自动捕获文件流并提取文件名作为课题分支主题；
         * **通道 2：系统剪贴板极速识别 (Clipboard Paste / Ctrl+V)**：点击插件的 `Copy` 按钮（或手动复制对话文本），切回 AxiomFlow 画布直接按下 `Ctrl+V`；画布全局监听器一旦嗅探到多轮会话特征，瞬时触发拓扑转化确认；
       * **多轮会话结构化解构引擎 (Turn-based Parsing Engine)**：
         * 正则嗅探会话中的角色标记（如 `# User` / `**Prompt:**` 与 `**Gemini:**`）、模型版本元信息（如 `Gemini 1.5 Pro` / `3.1 Pro`）与时间戳；
         * 自动解构为规范因果拓扑单元：提问映射为 `Question`（探索课题卡片），回答映射为 `Conclusion`（结论卡片），内嵌的代码块自动剥离为独立的 `source_code`（源码公理实证卡片）；
         * 自动构建有向因果链条：`Q1 ➔ A1 ➔ Q2 ➔ A2`，若对话中存在分支追问则自适应分叉成树；
       * **原地入图与 Sugiyama 自动舒展**：导入完成后自动触发 Sugiyama 拓扑自动分层排布，用户可直接对导入内容剪除冗余分支、接入本地文献邻域切片，完成从“网页端发散提问”到“本地因果实证深推”的平滑过渡。
*   **验收标准**：
    1. **[✅ 已达标]** 切换至 DeepSeek-V4 Pro 推理时，框选公式切片能自动交由 Qwen2.5-VL-72B 解析；点击连通性测试 1 秒内回显延迟；画布节点拖拽达到 60~120fps 丝滑；
    2. **[⏳ 顺延中]** 系统能同时容纳多份 PDF 资产，并在单一画布上完成跨文献的有向因果连线与学术异同辨析；
    3. **[⏳ 顺延中]** 输入本地 Obsidian 笔记路径后，可在 0.5 秒内将其概念网水合展开为可视化的 DAG 推演分支；推演完毕可一键回写生成新笔记；
    4. **[⏳ 规划中]** 支持将插件导出的 `.md` 文件从 Edge 下载托盘直接拖入画布，或点击插件 `Copy` 按钮后在画布直接按 `Ctrl+V` 粘贴；系统在 1 秒内完成多轮问答语法解构，自动生成对齐父子因果逻辑的卡片网络，且节点沿因果流向整齐排布、零重叠。

### 阶段 8: MVP 4.5 (数学物理数值仿真、形式化求解与微观系统原生沙盒 / Symbolic, Numeric, Formal & System Tracers) —— [规划中]
*   **主场模块**：`server.py` (`/api/execute-tracer`, `/api/z3-solve`), `computational_backend/`, `public/app.js`
*   **核心升级**：
    1. **符号数学求导 (SymPy Engine)**：针对节点中反编译提取出的 LaTeX 表达式，支持一键在后端调用 SymPy 进行解析求导与泰勒级数展开；
    2. **物理光场数值离散 (SciPy/NumPy)**：针对基尔霍夫衍射公式等复杂积分，支持一键运行轻量数值仿真，直接在卡片中输出物方与像方光斑对比热力图；
    3. **微观系统状态转移追踪器 (Micro-Architecture & Cache State Tracers / Explorable Sandbox)**：
       * **原生零构建可交互微部件 (Zero-Build DOM/SVG Explorable Widgets)**：贯彻 Bret Victor 的“可探索解释 (Explorable Explanations)”范式，彻底终结静态文本，支持节点生成并原地运行轻量级、确定性的 Python/JS 状态机追踪器，支持双手直接在卡片内拖动参数滑块进行微观硬件推演；
       * **流水线周期演进追踪器 (Y86-64 Pipeline Tracer)**：针对处理器体系结构（如 CS:APP 第 4 章），支持在卡片中单步运行 5 级流水线时序模拟，逐周期动态打印：
         `[Cycle 1] Fetch: 0x4000 | Decode: NOP | Exec: NOP | Hazard: Stall`
         自动展示数据转发（Forwarding）路径、分支预测错误与气泡（Bubble）插入过程，将人类大脑从“在脑中模拟 5 级寄存器变化的低效虚拟机”中彻底解放，专注于高层时序权衡（Trade-offs）；
       * **Cache 组相联状态转移追踪器 (Cache Associativity Simulator)**：针对存储器层次结构（如 CS:APP 第 6 章），动态切分物理地址位段（Tag / Set Index / Block Offset），单步追踪内存访问流的 Hit / Cold Miss / Conflict Miss 及 LRU 淘汰链；支持用户在卡片内微调相联度 $E$ 和块大小 $B$，毫秒级重绘冲突颠簸状态；
       * **反事实假设检验 (What-if Counterfactuals)**：支持用户在节点内直接修改微架构控制信号或硬件参数，即时对比时序差分（State Diff），实现“零脑力内耗、秒级感知硬件物理边界”；
    4. **SMT / Z3 形式化不变量约束求解探针 (Formal Invariant & Z3 Prover Engine)**：
       * 后端集成 Z3 求解器，专门针对底层位级算法（如 Data Lab 的 `bitAnd`, `howManyBits`）与状态机互斥不变量；
       * 支持在 100 毫秒内对用户实现与标准形式化规格进行全空间（$2^{32}$）数学等价性证明；若存在逻辑缺陷，直接反向求解并输出全空间唯一的“最小破坏性反例输入（Minimal Failing Counterexample）”，彻底取代低效盲目的人肉穷举测试。
*   **验收标准**：
    1. 学术卡片不仅能“讲道理”，还能“算结果”，打通大模型推理与确定性数值仿真的闭环；
    2. 在画布上点击“运行微架构追踪”，卡片能在 0.1 秒内输出周期级的五级流水线时序图或 Cache 状态转移对账表；修改参数（如 $E=1 \to E=2$）后，冲突判定与时序波形毫秒级实时重绘；
    3. 针对任意位运算函数，点击“Z3 形式化验证”，能在 0.2 秒内输出严格数学证明或定位到导致溢出的具体 32 位十六进制反例值。

### 阶段 9: MVP 5.0 (全自动化科研综述导出、拓扑间隔复习与离线私有沙盒 / Synthesizer, Topological Spaced-Repetition & Privacy Sandbox) —— [终极目标]
*   **主场模块**：`exporter/latex_generator.py`, `local_engine/`, `public/app.js` (`review_mode`)
*   **核心升级**：
    1. **拓扑排序综述一键成稿**：根据因果图拓扑排序，一键生成 Overleaf / IEEE 格式的标准学术论文初稿 LaTeX 压缩包；
    2. **基于 DAG 机制有向边的拓扑间隔复习引擎 (Topological Edge-FSRS Spaced Repetition)**：
       * 颠覆传统 Anki 针对孤立事实卡片的浅层死记硬背模型，将复习单元从“单点卡片”升维至“因果有向边（Causal Edges）”；
       * 系统定期对画布因果链发起主动遮蔽探问（例如隐去直接映射 Cache 到消除冲突之间的关键推演边），逼迫大脑提取底层的微观硬件机制与物理转移条件，形成网络状抗遗忘骨架；
    3. **100% 纯本地开源视觉模型沙盒**：对接 Ollama/vLLM (InternVL2 / Qwen2-VL)，实现零外网调用的局域网物理保密推演。
*   **验收标准**：
    1. 离线模式下一键点击“导出学术报告”，3 秒内生成排版完备的单篇学术报告 PDF/LaTeX；
    2. 开启“拓扑复习模式”，系统能精准遮蔽关键因果依赖边，根据答辩反馈动态调整各机制节点的遗忘复现间隔。

---

## 3. 致后续开发 Agent 的强制技术约束 (Constraints & Invariants)


### 约束 1：异步对象动态寻址强一致性 (Node ID Mutation Invariant)
* **教训总结**：在调用多模态 OCR 等长耗时（>10s）异步接口时，前端定时轮询或用户交互会重新实例化全局 `graph` 数组。若闭包内持有的是发起前的旧对象引用（`node.ocrStatus = 'done'`），会导致更新丢失并引发界面“正在反编译”永久卡死。
* **强制规范**：**在任何异步回调执行赋值或触发 `saveGraph()` 之前，必须通过 `graph.nodes.find(n => n.id === targetId)` 重新获取当前活动图谱中的活对象**！

### 约束 2：CSS Flexbox 滚动容器防御 (The min-height: 0 Invariant)
* **教训总结**：在纵向列式 Flex 容器嵌套中（如 `.drawer -> #reader-panel -> #pdf-view-container`），若未显式声明 `min-height: 0`，浏览器默认将其计算为 `min-height: auto`，导致容器被 178 页画纸无限撑大，无法触发内部滚动条。
* **强制规范**：所有作为纵向滚动视口的 Flexbox 子容器，必须严格声明：
  ```css
  flex: 1 1 0 !important;
  min-height: 0 !important;
  overflow-y: auto !important;
  ```

### 约束 3：零打包与无依赖构建底线 (Zero-Build Invariant)
* 绝对禁止在 `public/` 下引入 Webpack / Vite / React / Vue 等重型工程脚手架；
* 保持原生 ESM 或自包含 IIFE 脚本交付，离线静态资产放置于 `public/vendor/`；
* 保持单文件 `python server.py` 开箱即用的工业极简美学。

### 约束 4：GitHub GFM 排版语法准则 (Clean Markdown Invariant)
* **块级公式**：GitHub MathJax 要求块级公式的 `$$` **必须独立占据首尾单独行**，严禁使用单行 `$$formula$$`；
* **Mermaid 流程图**：连线标签管道符内部 `-->|文本|` **严禁包裹英文双引号 `"`**，否则会触发 GitHub `Unable to render rich display` 解析崩溃；
* 优先使用标准自适应居中 HTML 容器排版多级工作流卡片。

### 约束 5：纯净学术排版与自然交互规范 (Zero Decorative Emojis & Natural UX Invariant)
* **教训总结**：
  1. 在学术推演与科研研读界面中，随意堆砌 `🤖`、`📖`、`🔬`、`📑`、`💡`、`🧠`、`⏳` 等无意义装饰性 Emoji 会严重破坏学术严肃感与视觉专注度；
  2. 在去除 Emoji 时，若机械性地采用 `[就绪]`、`[完成]`、`[提示]`、`[错误]` 等方括号标签做生硬语法替换，会割裂中文自然语感。
* **强制规范**：
  1. **UI 元素与状态指示**：全面剔除无意义装饰性 Emoji，按钮与标签采用极简规范文字（如 `整理排版`、`+ 科研问题`、`复制`、`探针`）；功能性日月切换（`☀️` / `🌙`）作为直观功能指示予以特化保留；
  2. **通知与状态流**：状态栏与 Toast 通知必须采用地道、自然的现代学术/工程中文句式（如 `文献《...》已成功上传并绑定至当前课题`、`大纲骨架已就绪`、`事实素材已成功引入画布`），严禁前缀机械方括号标签。

### 约束 6：因果剪断无感化与无模态交互准则 (Non-Modal Pruning & Downstream Unplug Invariant)
* **教训总结**：传统的 `confirm("确认断开连线吗？")` 浏览器原生弹窗会强行打断用户的推演思考心流，且从上游向后追踪断开不符合因果反向推演直觉。
* **强制规范**：
  1. **无阻塞操作**：连线剪断严禁使用任何阻塞式确认模态框（Modal）；
  2. **下游流入端口直觉拔线**：支持用户直接在下游节点的输入端口（`.port.in`）进行管理——单击唤出流入依赖快速管理气泡（Port Popover），或向左反向拖拽即可物理拔除连线；
  3. **非阻塞撤销联动**：连线拔除后通过底部轻量 Toast 提供“撤销”按钮，并与全局 `Ctrl+Z` 历史撤销栈严格联动，兼顾极速操作与容错安全。
