# PR #1 代码评审与体验回归反馈 (Code Review & Regression Feedback)

> **评审对象**: PR #1 (`feat/mvp3-layout-persistence-theme`)  
> **提交作者**: @Shengxuan2513  
> **评审结论**: **Approved & Merged with Minor Follow-ups** (核心架构已合入 `main`，以下 4 点用户体验细节建议在后续 PR #2 中修补优化)  
> **测试环境**: Windows 11 / Chrome 128 / 本地服务 `http://localhost:8765`  
> **测试文献**: `王京凡-博士学位论文-差分相衬显微成像方法及应用研究.pdf` (178 页硕博论文实测)

---

## 总体评价 (Overall Evaluation)

感谢 @Shengxuan2513 的高质量交付！PR #1 为 AxiomFlow 带来了极为扎实的三大核心能力跃升：
1. **Sugiyama 拓扑自动分层排布**：因果图流向清晰、重心法平滑过渡与包围盒动态防重叠效果优异；
2. **文献资产动态解耦与大纲目录**：本地 PDF/MD 论文热上传与章节大纲目录（TOC Jump）极大提升了百页长篇学术论文的检索效率；
3. **全局浅色学术护眼模式**：点阵白底卡片与高对比度 Slate 配色，显著减轻了长时间学术深读的视觉疲劳。

在对合并后的 `main` 分支（Commit `8e96cb3`）进行端到端长链路实测时，发现了 4 处影响学术专注度的交互/渲染细节缺陷。现整理出精准的代码级定位与改进建议，供后续迭代直接参考复用：

---

## 缺陷清单与代码级改进建议

### 1. [PDF.js 文本层] 页面内包含复杂数学公式时划词选区严重偏移/拉伸形变

* **现象描述**:
  在 PDF 连续滚动阅读模式下，划选纯文字段落时表现正常；但当光标划选经过包含复杂数学公式（如分式、矩阵、求和符号 $\sum$、逆问题解析解等，见《差分相衬》第 49 页/第 69 槽位）时，高亮选区矩形出现剧烈的竖向拉伸、错位漂移与散碎断裂，无法精准圈选目标文字。
* **复现参考**:
  选取包含以下公式的段落：“同样可以通过求解以下逆问题获得样品的散射势... $\min \sum ...$”，鼠标划选时蓝色高亮块向下大面积散开拉扯。
* **代码根因 (Root Cause)**:
  1. **遗漏 TextLayer 的 `--scale-factor` CSS 变量注入**：  
     现代 PDF.js（v3/v4）的 `pdf_viewer.min.css` 强依赖容器上的 `--scale-factor` 计算字符盒跨度与字体对齐。在 [`public/app.js:1460-1470`](file:///d:/NJU_Archive/项目/Tree/public/app.js#L1460-L1470) 的 `renderPageSlot()` 中，为 `textLayer` 设置了像素宽高，但未向 style 注入 `--scale-factor`：
     ```javascript
     // 缺失 scale-factor 声明
     textLayer.style.width = canvas.style.width;
     textLayer.style.height = canvas.style.height;
     ```
  2. **透明文本层中公式符号字符盒（Glyph Bounding Box）过高**：  
     由 LaTeX 编译的 PDF 矢量公式在 TextLayer 中会生成带有极大字号或多层 `matrix(...)` 变换的 transparent span。鼠标原生拖拽框选一旦接触到公式 span，浏览器 selection 会将其整块高亮，造成数十像素的异常竖向跨度。
* **推荐修复代码 (Diff)**:

在 [`public/app.js`](file:///d:/NJU_Archive/项目/Tree/public/app.js) 的 `renderPageSlot` 函数中补齐 CSS 变量：
```diff
--- a/public/app.js
+++ b/public/app.js
@@ -1460,6 +1460,7 @@ async function renderPageSlot(pageNum) {
     if (textLayer) {
       textLayer.innerHTML = '';
       textLayer.style.width = canvas.style.width;
       textLayer.style.height = canvas.style.height;
+      textLayer.style.setProperty('--scale-factor', viewport.scale);
       const textContent = await page.getTextContent();
       if (window.pdfjsLib && window.pdfjsLib.renderTextLayer) {
```

并在 [`public/style.css`](file:///d:/NJU_Archive/项目/Tree/public/style.css) 的 `.pdf-page-slot .textLayer` 中强化文本层基准线与字符盒裁剪：
```diff
--- a/public/style.css
+++ b/public/style.css
@@ -1225,6 +1225,8 @@
 .pdf-page-slot .textLayer {
   position: absolute;
   top: 0;
   left: 0;
   right: 0;
   bottom: 0;
   overflow: hidden;
   opacity: 1;
   line-height: 1;
+  transform-origin: 0 0;
+  caret-color: #6366f1;
   user-select: text !important;
 }
```

> **产品交互提示**: 对于大段复杂公式，建议在界面引导中鼓励用户使用上方提供的 **【✂️ 框选公式/图表】** 截图工具直接截取矢量切片入图；纯文本划词则聚焦于自然语言引文。

---

### 2. [样式与无障碍] 浅色学术模式下工具栏按钮字体对比度不足（看不清）

* **现象描述**:
  在点击导航栏切换至日间浅色模式（`data-theme="light"`）后，PDF 阅读器上方工具栏中的核心操作按钮——`[📜 连续阅读]` 与 `[✂️ 框选公式/图表]` 的文字在白底上颜色极淡，近乎隐形，视觉可读性差。
* **代码根因 (Root Cause)**:
  在 [`public/index.html:158-161`](file:///d:/NJU_Archive/项目/Tree/public/index.html#L158-L161) 中，这两个按钮直接写死了暗色系下的高亮浅色（淡紫色 `#c7d2fe` 与浅黄色 `#fde68a`）：
  ```html
  <button id="btn-pdf-scroll-mode" ... style="... color: #c7d2fe; ...">📜 连续阅读</button>
  <button id="btn-pdf-snip" ... style="... color: #fde68a; ...">✂️ 框选公式/图表</button>
  ```
  在暗色底（`#0f172a`）下尚可辨认，但在浅色底（`#ffffff` / `#f8fafc`）下，文本与底色的对比度低于 1.5:1，严重违反 WCAG 2.1 AA 标准（至少需要 4.5:1）。
* **推荐修复代码 (Diff)**:

在 [`public/style.css`](file:///d:/NJU_Archive/项目/Tree/public/style.css) 的 `[data-theme="light"]` 作用域下覆盖这两个按钮的配色，注入深度靛蓝（Indigo-700）与深度琥珀（Amber-700）：
```diff
--- a/public/style.css
+++ b/public/style.css
@@ -1705,3 +1705,17 @@
 [data-theme="light"] .drawer-size-btn.active {
   background: #6366f1;
   color: #ffffff;
 }
+
+/* 浅色模式下 PDF 工具栏高亮按钮对比度加深守卫 */
+[data-theme="light"] #btn-pdf-scroll-mode {
+  background: rgba(99, 102, 241, 0.12) !important;
+  color: #4338ca !important; /* 经典深靛蓝，对比度 > 6:1 */
+  border-color: rgba(99, 102, 241, 0.45) !important;
+}
+
+[data-theme="light"] #btn-pdf-snip {
+  background: rgba(217, 119, 6, 0.12) !important;
+  color: #b45309 !important; /* 经典深琥珀色，对比度 > 5:1 */
+  border-color: rgba(217, 119, 6, 0.45) !important;
+}
```

---

### 3. [视窗状态机] 点击 [紧凑] / [70%] 切换抽屉分屏宽度时摧毁滚动位置 (Scroll Reset)

* **现象描述**:
  当读者阅读长篇论文到第 70 页中段时，点击抽屉顶部的分屏调宽按钮（`[◧ 紧凑]`、`[◫ 50%半屏]` 或 `[◰ 70%]`），阅读器页面发生白屏闪烁，阅读位置被强行重置回到文档起始处或跳动到该页的最顶部，破坏了沉浸式阅读连续性。
* **代码根因 (Root Cause)**:
  查看 [`public/app.js:1584-1593`](file:///d:/NJU_Archive/项目/Tree/public/app.js#L1584-L1593) 中 `setupDrawerResizer` 的宽度切换逻辑：
  ```javascript
  function setDrawerWidth(widthCss, key) {
    drawer.style.width = widthCss;
    updateSizeButtons(key);
    // 重新计算并铺满所有页面
    setTimeout(() => {
      if (currentDocMode === 'pdf' && currentPdfDoc) {
        buildContinuousScrollLayout().then(() => scrollToPage(currentPdfPageNum, false));
      }
    }, 180);
  }
  ```
  以及 [`public/app.js:1324`](file:///d:/NJU_Archive/项目/Tree/public/app.js#L1324) 中：
  ```javascript
  async function buildContinuousScrollLayout() {
    ...
    scrollContainer.innerHTML = ''; // 暴力清空了所有已加载的页面 DOM！
    pdfSlotsMap.clear();
  ```
  1. **DOM 暴力清空**：`scrollContainer.innerHTML = ''` 会在瞬间让浏览器视口的 `scrollTop` 坍塌归零；
  2. **页内精确偏移丢失**：随后的 `scrollToPage()` 只能 `scrollIntoView({ block: 'start' })` 对齐目标页顶部，丢失了读者停留在该页 50% 或 80% 处的相对阅读进度；
  3. **定时器与 CSS 过渡竞态**：抽屉在 CSS 中配置了 `transition: width 0.15s ease`，180ms 时 DOM 尚未完全稳定，频繁触发布局重构导致白屏与计算失真。
* **推荐修复方案 (Zero-Jump Resizing)**:
  - **原则 1：仅动态缩放样式，严禁清空重建 DOM**。调整抽屉宽度并不需要销毁 DOM，只需调整 slot 的 CSS 宽度或在缩放比改变时就地更新；
  - **原则 2：基于相对比例或当前阅读锚点无损恢复**。
    在执行宽屏切换前记录精确的相对滚动比率：
    ```javascript
    function setDrawerWidth(widthCss, key) {
      const viewContainer = document.getElementById('pdf-view-container');
      const prevRatio = viewContainer && viewContainer.scrollHeight > 0
        ? viewContainer.scrollTop / (viewContainer.scrollHeight - viewContainer.clientHeight || 1)
        : 0;

      drawer.style.width = widthCss;
      updateSizeButtons(key);

      setTimeout(() => {
        if (currentDocMode === 'pdf' && currentPdfDoc && viewContainer) {
          // 不调用清空 innerHTML 的 buildContinuousScrollLayout
          // 仅恢复对应的相对物理进度，实现真正零感知平滑调宽
          viewContainer.scrollTop = prevRatio * (viewContainer.scrollHeight - viewContainer.clientHeight);
        }
      }, 200);
    }
    ```

---

### 4. [课题会话元数据] 新建研究课题时填写的名称未同步作为初始根节点标题

* **现象描述**:
  在顶部导航栏点击“+”新建课题，输入课题名称（例如 `Transformer`），创建成功后，左侧课题选择器虽然正确显示了 `Transformer`，但画布中央自动生成的第一个探索问题卡片，以及右侧“上下文审查器”中的标题输入框，依然显示为占位符 `新探索课题`（见截图 3），两者未打通。
* **代码根因 (Root Cause)**:
  1. [`server.py:301-306`](file:///d:/NJU_Archive/项目/Tree/server.py#L301-L306) 在处理 `/api/sessions/new` 时，初始图的 `nodes` 数组为空：
     ```python
     initial_graph = {
         "version": "1.0.0",
         "project": title,
         "nodes": [],  # 此时为空数组
         "edges": []
     }
     ```
  2. [`public/app.js:2124-2129`](file:///d:/NJU_Archive/项目/Tree/public/app.js#L2124-L2129) 在新建课题成功后检测到 `graph.nodes.length === 0`，自动调用了 `btn-add-question.click()`：
     ```javascript
     if (graph.nodes.length === 0) {
       setTimeout(() => {
         const btnAddQ = document.getElementById('btn-add-question');
         if (btnAddQ) btnAddQ.click(); // 自动模拟点击“+ 新增科研问题”
       }, 300);
     }
     ```
  3. 而在 [`public/app.js:2324-2328`](file:///d:/NJU_Archive/项目/Tree/public/app.js#L2324-L2328) 中，`btn-add-question.onclick` 的标题是写死的硬编码：
     ```javascript
     graph.nodes.push({
       id: newId,
       kind: 'question',
       title: '新探索课题', // <--- 硬编码占位符，没有取到当前课题的 session.title
       ...
     });
     ```
* **推荐修复代码 (Diff)**:

在 [`server.py`](file:///d:/NJU_Archive/项目/Tree/server.py) 中，创建新课题时直接以传入的课题名称作为初始根节点的标题与核心问题骨架：
```diff
--- a/server.py
+++ b/server.py
@@ -300,8 +300,19 @@ class AxiomFlowHandler(SimpleHTTPRequestHandler):
                 
                 initial_graph = {
                     "version": "1.0.0",
                     "project": title,
-                    "nodes": [],
+                    "nodes": [
+                        {
+                            "id": f"n_q_{int(time.time() * 1000)}",
+                            "kind": "question",
+                            "title": title,
+                            "question": "",
+                            "response": "",
+                            "status": "idle",
+                            "x": 240,
+                            "y": 160
+                        }
+                    ],
                     "edges": []
                 }
                 with open(new_file, "w", encoding="utf-8") as f:
@@ -314,7 +325,7 @@ class AxiomFlowHandler(SimpleHTTPRequestHandler):
                     "title": title,
                     "createdAt": int(time.time() * 1000),
                     "updatedAt": int(time.time() * 1000),
-                    "nodeCount": 0
+                    "nodeCount": 1
                 }
```
并在 [`public/app.js`](file:///d:/NJU_Archive/项目/Tree/public/app.js) 的 `handleCreateNewSession` 中取消对空图的 `btnAddQ.click()` 模拟点击，彻底避免双重创建与占位符覆盖。

---

## 协作与后续建议 (Next Steps)

1. **反馈送达**: 本评审意见已完整形成独立文档。您可以将上述内容或其中的 Diff 片段直接作为评论回复给 PR 提交者或开出新 Issue（例如 `Issue #2: UX details polish for continuous PDF & session naming`）。
2. **快速打补丁 (Patch)**: 如果需要立即在本地与主分支上消除这 4 项缺陷，我们可以直接在当前工作区应用上述修改并通过单元回归验证后一键推送到远程仓库。
