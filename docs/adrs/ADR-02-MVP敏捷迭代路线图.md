# ADR-02: MVP 敏捷迭代与科研安全红线 (Iterative Roadmap & Architecture Invariants)

**日期**: 2026-09-03  
**状态**: ✅ Accepted (已通过核心架构决议)  
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

### 阶段 5: MVP 3.0 (工作台工效与阅读连续性 / Ergonomic Workbench & Reading Continuity) —— [🚀 当前核心目标]
*   **主场模块**：`public/app.js`, `public/style.css`, `public/index.html`, `server.py`
*   **核心突破**：
    1. **文献资产解耦与断点记忆持久化 (Document Decoupling & Reading Persistence)**：
       * **彻底解除论文硬编码**：将前端写死的特定论文名称（如王京凡博士论文）彻底解耦，改造为基于会话元数据（`session.activeDoc`）的动态文献加载机制；原博士论文作为系统预置的“示例文献 (Demo Case)”平滑降级保留；
       * **会话级自定义文献绑定**：支持用户为不同课题独立上传或从资产目录切换不同的自定义 PDF 论文，实现“一个课题对应一份目标文献资产”的清晰映射；
       * **视窗状态与断点无损复原**：实时监听物理滚动视口，将所选文献的当前活跃页码 (`currentPage`)、精确像素级滚动偏移 (`scrollTop`)、缩放比例 (`zoomLevel`) 与分屏抽屉宽度无感实时写入持久化存储；用户刷新浏览器、重启本地服务或在不同课题间切换时，文献阅读器毫秒级无损复原至上次离开的位置。
    2. **DAG 画布拓扑自动分层整理 (Sugiyama Auto-Layout & Anti-Overlap)**：
       * 引入经典有向无环图分层布局算法（Sugiyama Layout / Topological Rank Sorting），为复杂因果网赋予自适应规整力；
       * 一键理牌（Auto-Tidy）：自左向右（或自上向下）根据连线的因果流向将节点自动对齐排布为三列阵列：
         $$\text{左列 [客观文献实证]} \longrightarrow \text{中列 [探索课题与假设]} \longrightarrow \text{右列 [推演结论与衍生追问]}$$
       * 计算卡片物理边界包围盒（Bounding Box Collision），动态消除卡片层叠挤压，智能平滑连接折线，为后续海量知识节点构建秩序井然的视觉底座。
*   **验收标准**：
    1. 在阅读器中可自由上传或切换为任意自定义 PDF，并在该长文中滚动至 P.68；刷新网页后，系统 100% 精确复原该文献并停留在 P.68，页面不产生二次跳动；
    2. 画布上堆叠有 10+ 乱序摆放甚至重叠的卡片，点击“一键整理拓扑”，0.2 秒内自动舒展为整齐划一的三列因果层级网络。

### 阶段 6: MVP 3.5 (单文献宏微观分层研读引擎 / Hierarchical Macro-Skeleton & Neighborhood Deep-Dive) —— [顺延规划]
*   **主场模块**：`server.py` (`/api/paper-outline`, `/api/paper-neighborhood`), `public/app.js`, `public/index.html`
*   **核心突破**：
    1. **Stage 1 全局粗读（骨架成树·宏观全景导航）**：利用长上下文大模型快速提炼全文结构化章节、核心定理与公式索引，生成带有**物理页码强锚点**的可交互【全景大纲树】；
    2. **Stage 2 视界对焦（靶向定位·邻域探针）**：用户在阅读器或大纲中点击任意小节，阅读器平滑卷至目标页，系统自动划定**目标页 $\pm 2$ 页作为高密度上下文缓冲带（Neighborhood Buffer）**；
    3. **Stage 3 显微研读（局部无幻觉推演）**：针对该板块发起深度学术探究时，大模型被精准约束在该物理邻域的公式与参数中，彻底解决“全局记不住、局部看不细”的困境。
*   **验收标准**：可在阅读器侧边一键拉出章节大纲树，点击“2.2 弱物体近似”自动滚动至第 50 页并高亮；对该小节发起追问时，模型仅读取邻域上下文，1~2 秒内精准解答公式细节。

### 阶段 7: MVP 4.0 (多文献跨论文交叉比对 / Cross-Paper Graph & Theory Contradiction) —— [顺延规划]
*   **主场模块**：`public/materials/`, `server.py`, `public/app.js`
*   **核心突破**：
    1. **多文献库管理 (Multi-Document Shelf)**：支持在阅读器中自由切换或并排对比多篇不同的相关文献；
    2. **跨文献实证图谱融合 (Cross-Paper Fusion)**：基于 MVP 3.5 的章节大纲经纬度，将来自【论文 A 弱散射章节】与【论文 B 玻恩近似章节】的实证卡片同时连入同一个课题节点，由大模型进行交叉比对（Cross-Examination），自动挖掘理论冲突与学术空白。
*   **验收标准**：系统能同时容纳多份 PDF 资产，并在单一画布上完成跨文献的有向因果连线与学术异同辨析。

### 阶段 8: MVP 4.5 (数学与物理逆问题仿真求解 / Symbolic & Numeric Engine) —— [规划中]
*   **主场模块**：`server.py`, `computational_backend/`
*   **核心升级**：
    1. **符号数学求导 (SymPy Engine)**：针对节点中反编译提取出的 LaTeX 表达式，支持一键在后端调用 SymPy 进行解析求导与泰勒级数展开；
    2. **物理光场数值离散 (SciPy/NumPy)**：针对基尔霍夫衍射公式等复杂积分，支持一键运行轻量数值仿真，直接在卡片中输出物方与像方光斑对比热力图。
*   **验收标准**：学术卡片不仅能“讲道理”，还能“算结果”，打通大模型推理与确定性数值仿真的闭环。

### 阶段 9: MVP 5.0 (全自动化科研综述导出与离线私有沙盒 / Synthesizer & Privacy Sandbox) —— [终极目标]
*   **主场模块**：`exporter/latex_generator.py`, `local_engine/`
*   **核心升级**：
    1. **拓扑排序综述一键成稿**：根据因果图拓扑排序，一键生成 Overleaf / IEEE 格式的标准学术论文初稿 LaTeX 压缩包；
    2. **100% 纯本地开源视觉模型沙盒**：对接 Ollama/vLLM (InternVL2 / Qwen2-VL)，实现零外网调用的局域网物理保密推演。
*   **验收标准**：离线模式下一键点击“导出学术报告”，3 秒内生成排版完备的单篇学术报告 PDF/LaTeX。

---

## 3. 致后续开发 Agent 的强制技术约束 (Constraints & Invariants)

在后续的迭代中，**任何接手本工程的协同智能体必须无条件遵循以下工程铁律**：

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
