import { partitionContext, compilePrompt } from './context_compiler.js';
import { calculateSugiyamaLayout } from './sugiyama_layout.js';

// 全局数据状态
let graph = { nodes: [], edges: [] };
let currentSessionId = 'session_default';
let sessionsList = [];
let selectedNodeId = null;
let activeTab = 'inspector';
let lastMtime = 0;
let currentConfig = {
  api_base: "http://127.0.0.1:8046/v1",
  api_key: "",
  model: "gemini-3.8-flash-high"
};

// 画布视口平移与缩放（默认以 0.8 全景视角舒适展开，避免重叠卡片）
let pan = { x: 30, y: 20 };
let zoom = 0.8;
let isPanning = false;
let startPan = { x: 0, y: 0 };

// 拖拽与连线临时状态
let draggingNodeId = null;
let dragOffset = { x: 0, y: 0 };
let connectingSourceId = null;
let tempMousePos = { x: 0, y: 0 };

// 概念询问上下文缓存
let inquiryParentNode = null;

const world = document.getElementById('canvas-world');
const svgEdges = document.getElementById('svg-edges');
const nodesContainer = document.getElementById('nodes-container');
const drawer = document.getElementById('drawer');
const inquiryModal = document.getElementById('inquiry-modal');
const settingsModal = document.getElementById('settings-modal');

// 初始化
async function init() {
  initTheme();
  await loadConfig();
  await loadSessions();
  await loadGraph();
  setupEventListeners();
  initSelectionToolbar();
  updateZoomIndicator();
  renderNodes();
  requestAnimationFrame(() => renderEdges());
  startVersionPolling();
  await initDocumentSystem();
}

// ==========================================
// 主题管理 (浅色 / 深色模式及本地持久化)
// ==========================================
function initTheme() {
  const savedTheme = localStorage.getItem('axiomflow_theme') || 'dark';
  applyTheme(savedTheme);

  const btnToggleTheme = document.getElementById('btn-toggle-theme');
  if (btnToggleTheme) {
    btnToggleTheme.onclick = () => {
      const current = document.documentElement.getAttribute('data-theme') || 'dark';
      const nextTheme = current === 'light' ? 'dark' : 'light';
      applyTheme(nextTheme);
    };
  }
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('axiomflow_theme', theme);
  const themeIcon = document.getElementById('theme-icon');
  const btnToggleTheme = document.getElementById('btn-toggle-theme');
  if (themeIcon) {
    themeIcon.innerText = theme === 'light' ? '🌙' : '☀️';
  }
  if (btnToggleTheme) {
    btnToggleTheme.title = theme === 'light' ? '切换为深色模式' : '切换为浅色模式';
  }
}

// 加载配置
async function loadConfig() {
  try {
    const res = await fetch('/api/config');
    currentConfig = await res.json();
    updateStatus(`就绪 · 当前模型: ${currentConfig.model}`);
    const inquiryModelEl = document.getElementById('inquiry-model-name');
    if (inquiryModelEl) inquiryModelEl.innerText = currentConfig.model;
  } catch (e) {
    console.warn("加载配置失败:", e);
  }
}

// 从后端加载指定课题图谱
async function loadGraph() {
  try {
    const res = await fetch(`/api/graph?sessionId=${encodeURIComponent(currentSessionId)}`);
    graph = await res.json();
    if (!graph.nodes) graph.nodes = [];
    if (!graph.edges) graph.edges = [];
  } catch (err) {
    console.error('加载图谱失败:', err);
  }
}

// 保存图谱到当前课题
async function saveGraph() {
  try {
    const res = await fetch(`/api/graph?sessionId=${encodeURIComponent(currentSessionId)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(graph)
    });
    const data = await res.json();
    if (data.mtime) lastMtime = data.mtime;
  } catch (err) {
    console.error('保存图谱失败:', err);
  }
}

// 防抖自动存盘（用于文本输入即时联动）
let saveTimer = null;
function debouncedSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveGraph();
  }, 350);
}

// 轮询检查后端变动
function startVersionPolling() {
  setInterval(async () => {
    try {
      const res = await fetch(`/api/version?sessionId=${encodeURIComponent(currentSessionId)}`);
      const data = await res.json();
      if (lastMtime && data.mtime > lastMtime) {
        lastMtime = data.mtime;
        const resG = await fetch(`/api/graph?sessionId=${encodeURIComponent(currentSessionId)}`);
        const newGraph = await resG.json();
        graph = newGraph;
        renderNodes();
        requestAnimationFrame(() => renderEdges());
        if (selectedNodeId) updateContextInspector();
        loadSessionsListOnly();
      } else if (!lastMtime) {
        lastMtime = data.mtime;
      }
    } catch (e) {
      // 忽略轮询网络抖动
    }
  }, 1500);
}

// 屏幕坐标转画布世界坐标（消除顶部 54px 导航栏与缩放偏移）
function screenToWorld(clientX, clientY) {
  const container = document.getElementById('canvas-container');
  const rect = container.getBoundingClientRect();
  return {
    x: (clientX - rect.left - pan.x) / zoom,
    y: (clientY - rect.top - pan.y) / zoom
  };
}

// 获取端口精准数学中心
function getPortCenter(nodeId, isOut) {
  const node = graph.nodes.find(n => n.id === nodeId);
  if (!node) return { x: 0, y: 0 };

  const nodeEl = document.querySelector(`.node[data-id="${nodeId}"]`);
  if (!nodeEl) {
    return {
      x: node.x + (isOut ? 360 : 0),
      y: node.y + 100
    };
  }

  const portEl = nodeEl.querySelector(isOut ? '.port.out' : '.port.in');
  if (!portEl) {
    return {
      x: node.x + (isOut ? nodeEl.offsetWidth : 0),
      y: node.y + nodeEl.offsetHeight / 2
    };
  }

  return {
    x: node.x + portEl.offsetLeft + portEl.offsetWidth / 2,
    y: node.y + portEl.offsetTop + portEl.offsetHeight / 2
  };
}

// 渲染节点
function renderNodes() {
  world.style.transform = `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`;
  nodesContainer.innerHTML = '';

  graph.nodes.forEach(node => {
    const el = createNodeElement(node);
    nodesContainer.appendChild(el);
  });
}

// 创建单个节点 DOM
function createNodeElement(node) {
  const div = document.createElement('div');
  const isGenerating = node.status === 'generating';
  div.className = `node ${node.kind} ${node.id === selectedNodeId ? 'selected' : ''} ${node.status === 'pending' ? 'pending' : ''} ${isGenerating ? 'generating' : ''}`;
  div.style.left = `${node.x}px`;
  div.style.top = `${node.y}px`;
  div.dataset.id = node.id;

  const kindNames = {
    question: '探索课题',
    material: '文献实证',
    conclusion: '综合结论'
  };

  let statusBadge = `<span style="color: #64748b; font-size: 11px;">#${node.id}</span>`;
  if (isGenerating) {
    statusBadge = `<span style="color: #38bdf8; font-size: 11px;">⏳ 正在推理...</span>`;
  } else if (node.status === 'pending') {
    statusBadge = `<span style="color: #f59e0b; font-size: 11px;">● 待生成</span>`;
  }

  div.innerHTML = `
    <div class="port in" data-port="in" data-node="${node.id}" title="上下文流入 (在此释放连线)"></div>
    <div class="port out" data-port="out" data-node="${node.id}" title="上下文流出 (按住拖拽连线)"></div>
    <div class="node-header">
      <div class="node-title-group">
        <span class="node-badge badge-${node.kind}">${kindNames[node.kind] || node.kind}</span>
        <span class="node-title">${escapeHtml(node.title || '未命名节点')}</span>
      </div>
      <div style="display: flex; align-items: center; gap: 4px;">
        ${statusBadge}
        <button class="node-btn-icon node-btn-expand" title="全屏学术阅读 (双击卡片也可进入)">⛶</button>
        <button class="node-btn-icon node-btn-del" title="删除节点">✕</button>
      </div>
    </div>
    <div class="node-content">
      ${node.kind === 'material' 
        ? `${node.imageUrl ? `<div style="margin-bottom: 8px; text-align: center; background: #ffffff; padding: 4px; border-radius: 5px; border: 1px solid rgba(255,255,255,0.2); box-shadow: 0 2px 8px rgba(0,0,0,0.5);"><img src="${node.imageUrl}" style="max-width: 100%; max-height: 180px; object-fit: contain; display: block; margin: 0 auto;" alt="原版公式切片"></div>` : ''}
           ${node.ocrStatus === 'pending' ? `<div style="font-size: 11px; color: #38bdf8; margin-bottom: 6px; display: flex; align-items: center; justify-content: space-between; background: rgba(56, 189, 248, 0.1); padding: 3px 6px; border-radius: 4px; border: 1px dashed rgba(56, 189, 248, 0.4);"><span>⏳ 正在由 Gemini 反编译公式...</span><button onclick="retryOcrFormula('${node.id}', event)" class="btn" style="padding: 1px 6px; font-size: 10px; background: rgba(56, 189, 248, 0.2); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.5);" title="若时间过长可点击重试">重试</button></div>` : ''}
           ${node.ocrStatus === 'failed' ? `<div style="font-size: 11px; color: #f87171; margin-bottom: 6px; display: flex; align-items: center; justify-content: space-between; background: rgba(239, 68, 68, 0.1); padding: 3px 6px; border-radius: 4px; border: 1px dashed rgba(239, 68, 68, 0.4);"><span>⚠️ 反编译未完成</span><button onclick="retryOcrFormula('${node.id}', event)" class="btn" style="padding: 1px 6px; font-size: 10px; background: rgba(239, 68, 68, 0.2); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.5);">重新解析</button></div>` : ''}
           <blockquote>${renderMarkdown(node.excerpt || node.content || '')}</blockquote>
           ${node.citation ? `<div class="citation-chip">📖 ${escapeHtml(node.citation)}</div>` : ''}`
        : `<div class="card-question-text" style="font-weight: 600; color: var(--text-primary); line-height: 1.45; cursor: text;" title="点击可直接在右侧面板编辑问题">${renderMarkdown(node.question || '<em>(点击在此输入具体科研问题...)</em>')}</div>
           <div class="markdown-body" style="margin-top: 8px;">${isGenerating ? '<span style="color: #38bdf8;">🧠 大模型正在深度严密推演中...</span>' : renderMarkdown(node.response || '(点击右侧请求生成)')}</div>`
      }
    </div>
    <div class="node-footer">
      <span>${node.kind === 'material' ? '客观事实锚点' : '模型思考单元'}</span>
      <div style="font-size: 10.5px; color: #64748b;">双击全屏</div>
    </div>
  `;

  // 单击选中（若点击的是问题文本，自动聚焦右侧输入框）
  div.addEventListener('click', (e) => {
    if (e.target.closest('.port') || e.target.closest('.node-btn-icon')) return;
    selectNode(node.id);
    if (e.target.closest('.card-question-text')) {
      setTimeout(() => {
        const qInput = document.getElementById('node-edit-question');
        if (qInput) qInput.focus();
      }, 60);
    }
  });

  // 双击全屏阅读
  div.addEventListener('dblclick', (e) => {
    if (e.target.closest('.port') || e.target.closest('.node-btn-icon')) return;
    openCardFullscreen(node);
  });

  // 放大按钮
  div.querySelector('.node-btn-expand').addEventListener('click', (e) => {
    e.stopPropagation();
    openCardFullscreen(node);
  });

  // 删除按钮
  div.querySelector('.node-btn-del').addEventListener('click', (e) => {
    e.stopPropagation();
    deleteNode(node.id);
  });

  // 节点拖拽
  div.addEventListener('mousedown', (e) => {
    if (e.target.classList.contains('port') || e.target.classList.contains('node-btn-icon')) return;
    draggingNodeId = node.id;
    const worldPos = screenToWorld(e.clientX, e.clientY);
    dragOffset = {
      x: worldPos.x - node.x,
      y: worldPos.y - node.y
    };
    e.stopPropagation();
  });

  return div;
}

// 平滑自适应贝塞尔连线算法（彻底杜绝短间距下控制点反向穿插造成的诡异 S 型折线）
function calculateBezierPath(sx, sy, tx, ty) {
  const deltaX = tx - sx;
  if (deltaX >= 0) {
    // 正常向右流动：当两点极近（如 < 70px）时，拉力 dx 严格按间距缩放，控制点单调递增，曲线丝滑优美
    const dx = Math.min(Math.max(deltaX * 0.45, 12), 220);
    return `M ${sx} ${sy} C ${sx + dx} ${sy}, ${tx - dx} ${ty}, ${tx} ${ty}`;
  } else {
    // 逆向流动（回环/跨列反向依赖）：向外侧柔和环绕
    const offset = Math.max(50, Math.abs(deltaX) * 0.35);
    return `M ${sx} ${sy} C ${sx + offset} ${sy}, ${tx - offset} ${ty}, ${tx} ${ty}`;
  }
}

// 渲染 SVG 连线
function renderEdges() {
  svgEdges.innerHTML = `
    <defs>
      <marker id="arrow" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
        <path d="M 0 1 L 9 5 L 0 9 z" fill="#818cf8" />
      </marker>
      <marker id="arrow-dashed" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
        <path d="M 0 1 L 9 5 L 0 9 z" fill="#34d399" />
      </marker>
    </defs>
  `;

  graph.edges.forEach(edge => {
    const sourceNode = graph.nodes.find(n => n.id === edge.source);
    const targetNode = graph.nodes.find(n => n.id === edge.target);
    if (!sourceNode || !targetNode) return;

    const start = getPortCenter(edge.source, true);
    const end = getPortCenter(edge.target, false);

    const sx = start.x;
    const sy = start.y;
    const tx = end.x;
    const ty = end.y;

    const pathD = calculateBezierPath(sx, sy, tx, ty);

    const isDashed = edge.kind === 'dashed';
    const marker = isDashed ? 'url(#arrow-dashed)' : 'url(#arrow)';

    const hitPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
    hitPath.setAttribute("d", pathD);
    hitPath.setAttribute("class", "edge-hitarea");
    hitPath.addEventListener("click", (e) => {
      e.stopPropagation();
      if (confirm("是否剪断此连线？（剪断后该节点将从下游 AI 视野中物理切除）")) {
        deleteEdge(edge.id);
      }
    });

    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", pathD);
    path.setAttribute("class", `edge-path ${isDashed ? 'dashed' : ''}`);
    path.setAttribute("marker-end", marker);
    path.title = "点击可剪断该上下文依赖";

    svgEdges.appendChild(hitPath);
    svgEdges.appendChild(path);
  });

  // 临时拖拽线（使用世界坐标，严丝合缝跟随鼠标，防阻断端口点击）
  if (connectingSourceId) {
    const start = getPortCenter(connectingSourceId, true);
    const sx = start.x;
    const sy = start.y;
    const tx = tempMousePos.x;
    const ty = tempMousePos.y;
    const pathD = calculateBezierPath(sx, sy, tx, ty);

    const tempPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
    tempPath.setAttribute("d", pathD);
    tempPath.setAttribute("class", "edge-path");
    tempPath.style.stroke = "#38bdf8";
    tempPath.style.strokeDasharray = "5 5";
    tempPath.style.pointerEvents = "none";
    svgEdges.appendChild(tempPath);
  }
}

// 选中节点
function selectNode(id) {
  selectedNodeId = id;
  document.querySelectorAll('.node').forEach(el => {
    el.classList.toggle('selected', el.dataset.id === id);
  });
  openDrawer('inspector');
  updateContextInspector();
}

// 更新上下文审查器面板
function updateContextInspector() {
  const node = graph.nodes.find(n => n.id === selectedNodeId);
  const container = document.getElementById('inspector-content');
  if (!node) {
    container.innerHTML = `<div style="color: #64748b; padding: 20px;">未选择节点。在画布上点击任意节点查看。</div>`;
    return;
  }

  const partition = partitionContext(node.id, graph.nodes, graph.edges);
  const compiled = compilePrompt(partition);

  container.innerHTML = `
    <!-- 节点即时输入/编辑区 -->
    <div style="background: var(--bg-card); border: 1px solid var(--border-color); border-radius: 8px; padding: 12px 14px; margin-bottom: 14px; box-shadow: 0 4px 14px rgba(0, 0, 0, 0.08);">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
        <span style="font-size: 11px; font-weight: 700; color: #818cf8; text-transform: uppercase;">✏️ 课题即时编辑</span>
        <span style="font-size: 11px; color: #64748b; font-family: monospace;">ID: <code>${node.id}</code></span>
      </div>

      <div style="margin-bottom: 10px;">
        <label style="font-size: 11px; font-weight: 600; color: #94a3b8; display: block; margin-bottom: 4px;">课题标题：</label>
        <input id="node-edit-title" type="text" class="inquiry-textarea" style="height: 34px; font-size: 13px; font-weight: 600;" value="${escapeHtml(node.title || '')}" placeholder="输入课题简短标题...">
      </div>

      ${node.kind === 'material' ? `
        <div style="margin-bottom: 10px;">
          <label style="font-size: 11px; font-weight: 600; color: #94a3b8; display: block; margin-bottom: 4px;">文献证据正文：</label>
          <textarea id="node-edit-excerpt" class="inquiry-textarea" rows="3" placeholder="在此输入文献证据片段...">${escapeHtml(node.excerpt || node.content || '')}</textarea>
        </div>
        <div>
          <label style="font-size: 11px; font-weight: 600; color: #94a3b8; display: block; margin-bottom: 4px;">文献出处标签：</label>
          <input id="node-edit-citation" type="text" class="inquiry-textarea" style="height: 32px; font-size: 12px;" value="${escapeHtml(node.citation || '')}" placeholder="如: Liu et al., 2023, p.4">
        </div>
      ` : `
        <div>
          <label style="font-size: 11px; font-weight: 600; color: #94a3b8; display: block; margin-bottom: 4px;">待解答问题 / 探索指令：</label>
          <textarea id="node-edit-question" class="inquiry-textarea" rows="3" placeholder="在此输入你的具体科研问题、论证假设或推演指令...">${escapeHtml(node.question || '')}</textarea>
        </div>
      `}
    </div>

    <!-- 拓扑分流统计 -->
    <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-bottom: 14px;">
      <div style="background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.25); border-radius: 8px; padding: 8px; text-align: center;">
        <div style="font-size: 17px; font-weight: 700; color: #34d399;">${partition.materials.length}</div>
        <div style="font-size: 11px; color: #a7f3d0;">连入文献素材</div>
      </div>
      <div style="background: rgba(99, 102, 241, 0.1); border: 1px solid rgba(99, 102, 241, 0.25); border-radius: 8px; padding: 8px; text-align: center;">
        <div style="font-size: 17px; font-weight: 700; color: #818cf8;">${partition.references.length}</div>
        <div style="font-size: 11px; color: #c7d2fe;">隔离引用块</div>
      </div>
      <div style="background: rgba(59, 130, 246, 0.1); border: 1px solid rgba(59, 130, 246, 0.25); border-radius: 8px; padding: 8px; text-align: center;">
        <div style="font-size: 17px; font-weight: 700; color: #60a5fa;">${partition.chainTurns.length}</div>
        <div style="font-size: 11px; color: #bfdbfe;">主干对话轮数</div>
      </div>
    </div>

    <!-- 核心操作区（置顶优先展示，无需下滚查找） -->
    <div style="display: flex; flex-direction: column; gap: 8px; margin-bottom: 14px;">
      <button id="btn-trigger-generate" class="btn btn-primary" style="justify-content: center; padding: 10px; font-size: 13px; box-shadow: 0 4px 14px rgba(79, 70, 229, 0.4);">
        🚀 调用 ${escapeHtml(currentConfig.model)} 原地生成解答
      </button>
      
      <button id="btn-open-inquiry" class="btn" style="justify-content: center; background: rgba(16, 185, 129, 0.15); border-color: rgba(16, 185, 129, 0.4); color: #34d399; padding: 8px; font-size: 12.5px;">
        💡 追问特定概念 / 展开新分支节点
      </button>

      ${node.imageUrl ? `
      <button id="btn-re-ocr" class="btn btn-secondary" style="justify-content: center; background: rgba(245, 158, 11, 0.15); border-color: rgba(245, 158, 11, 0.4); color: #fde68a; padding: 8px; font-size: 12.5px;" title="重新请求 Gemini 多模态模型解析截取图中的 LaTeX 公式与变量">
        📐 提取/反编译原图中的 LaTeX 公式与释义
      </button>
      ` : ''}
    </div>

    <div style="background: rgba(99, 102, 241, 0.08); border: 1px solid rgba(99, 102, 241, 0.2); border-radius: 6px; padding: 8px 10px; margin-bottom: 12px; font-size: 11.5px; line-height: 1.45; color: var(--text-primary);">
      <span style="color: #38bdf8; font-weight: 600;">⚡ 物理级拓扑隔离：</span>
      仅连入的有效祖先进入 Prompt，剪断分支在 HTTP 请求中被 100% 物理剥离。
    </div>

    <!-- 精准 Prompt 折叠查看区（小巧精悍，不挤占界面） -->
    <details open style="background: var(--bg-card); border: 1px solid var(--border-color); border-radius: 8px; padding: 10px;">
      <summary style="font-size: 12px; font-weight: 600; color: var(--text-secondary); cursor: pointer; display: flex; justify-content: space-between; align-items: center;">
        <span>🔍 接收的精准 Prompt 预估 (<span id="prompt-token-count">${compiled.estimatedTokens} tokens</span>)</span>
        <button id="btn-copy-prompt" class="btn" style="padding: 2px 8px; font-size: 10.5px;">复制纯净输入</button>
      </summary>
      <div class="prompt-preview-box" style="margin-top: 8px; max-height: 150px;">${escapeHtml(compiled.fullText)}</div>
    </details>
  `;

  // 标题实时编辑联动
  const titleInput = document.getElementById('node-edit-title');
  if (titleInput) {
    titleInput.oninput = (e) => {
      node.title = e.target.value.trim() || '未命名课题';
      const titleEl = document.querySelector(`.node[data-id="${node.id}"] .node-title`);
      if (titleEl) titleEl.innerText = node.title;
      debouncedSave();
    };
  }

  // 问题/探索指令实时编辑联动
  const questionInput = document.getElementById('node-edit-question');
  if (questionInput) {
    questionInput.oninput = (e) => {
      node.question = e.target.value;
      if (node.status === 'done') {
        node.status = 'pending';
      }
      const qEl = document.querySelector(`.node[data-id="${node.id}"] .card-question-text`);
      if (qEl) qEl.innerHTML = renderMarkdown(node.question || '<em>(点击右侧输入问题...)</em>');
      // 实时重编译当前 Prompt 预估
      const p = partitionContext(node.id, graph.nodes, graph.edges);
      const c = compilePrompt(p);
      const promptBox = document.querySelector('.prompt-preview-box');
      if (promptBox) promptBox.innerText = c.fullText;
      const tokenSpan = document.getElementById('prompt-token-count');
      if (tokenSpan) tokenSpan.innerText = `${c.estimatedTokens} tokens`;
      debouncedSave();
    };
  }

  // 文献摘录实时编辑联动
  const excerptInput = document.getElementById('node-edit-excerpt');
  if (excerptInput) {
    excerptInput.oninput = (e) => {
      node.excerpt = e.target.value;
      const bq = document.querySelector(`.node[data-id="${node.id}"] .node-content blockquote`);
      if (bq) bq.innerHTML = renderMarkdown(node.excerpt || '');
      debouncedSave();
    };
  }
  const citationInput = document.getElementById('node-edit-citation');
  if (citationInput) {
    citationInput.oninput = (e) => {
      node.citation = e.target.value;
      const chip = document.querySelector(`.node[data-id="${node.id}"] .citation-chip`);
      if (chip) chip.innerText = `📖 ${node.citation}`;
      debouncedSave();
    };
  }

  document.getElementById('btn-copy-prompt').onclick = (e) => {
    e.stopPropagation();
    const p = partitionContext(node.id, graph.nodes, graph.edges);
    const c = compilePrompt(p);
    navigator.clipboard.writeText(c.fullText);
    alert("已复制编译好的精准上下文！");
  };

  document.getElementById('btn-trigger-generate').onclick = () => {
    generateAnswerForNode(node);
  };

  document.getElementById('btn-open-inquiry').onclick = () => {
    openConceptInquiryModal(node);
  };

  const btnReOcr = document.getElementById('btn-re-ocr');
  if (btnReOcr) {
    btnReOcr.onclick = () => {
      retryOcrFormula(node.id);
    };
  }
}

// 原地调用大模型生成答案
async function generateAnswerForNode(node) {
  const trimmedQ = (node.question || '').trim();
  if (!trimmedQ || trimmedQ === '请输入你的探索问题...') {
    alert("当前课题问题仍为空或处于占位符状态，请先在右侧输入具体的科研问题后再发起生成！");
    const qInput = document.getElementById('node-edit-question');
    if (qInput) qInput.focus();
    return;
  }

  // 发起前实时重新编译最新 Prompt（确保包含用户刚敲入的最新字符）
  const partition = partitionContext(node.id, graph.nodes, graph.edges);
  const compiled = compilePrompt(partition);
  const promptText = compiled.fullText;

  const btn = document.getElementById('btn-trigger-generate');
  if (btn) {
    btn.disabled = true;
    btn.innerText = `⏳ 正在调用 ${currentConfig.model} 深度推演中...`;
  }

  node.status = 'generating';
  renderNodes();
  requestAnimationFrame(() => renderEdges());
  updateStatus(`正在请求 ${currentConfig.model} 生成 #${node.id} ...`);

  try {
    const res = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nodeId: node.id,
        prompt: promptText,
        model: currentConfig.model,
        sessionId: currentSessionId
      })
    });
    const data = await res.json();
    const liveNode = graph.nodes.find(n => n.id === node.id) || node;
    if (data.ok) {
      liveNode.response = data.response;
      liveNode.status = 'done';
      if (data.mtime) lastMtime = data.mtime;
      updateStatus(`[完成] ${currentConfig.model} 已为 #${node.id} 生成解答`);
    } else {
      alert("生成失败: " + (data.error || "未知异常"));
      liveNode.status = 'idle';
    }
  } catch (err) {
    alert("网络异常: " + err.message);
    const liveNode = graph.nodes.find(n => n.id === node.id) || node;
    liveNode.status = 'idle';
  } finally {
    saveGraph();
    renderNodes();
    requestAnimationFrame(() => renderEdges());
    if (selectedNodeId === node.id) updateContextInspector();
  }
}

// 提取节点文本中的关键学术概念
function extractConceptsFromNode(node) {
  const fullText = `${node.title || ''} ${node.question || ''} ${node.response || ''} ${node.excerpt || ''}`;
  const concepts = new Set();

  const quoteRegex = /[“"”'‘']([^“”"'\n]{2,20})[”"’']|[【《]([^【】《》\n]{2,20})[】》]/g;
  let match;
  while ((match = quoteRegex.exec(fullText)) !== null) {
    const term = (match[1] || match[2] || '').trim();
    if (term.length >= 2 && term.length <= 18) concepts.add(term);
  }

  const englishMatches = fullText.match(/\b([A-Z][a-zA-Z]*(?:\s+[a-zA-Z]+){0,3})\b/g) || [];
  englishMatches.forEach(term => {
    if (term.length >= 4 && term.length <= 25 && !['Turn', 'Section', 'TACL', 'Node'].includes(term)) {
      concepts.add(term);
    }
  });

  const vocab = [
    '自注意力', '注意力机制', '合理化偏差', '语义惯性', '中间丢失', '长上下文',
    '自回归概率', '物理隔离', 'DAG拓扑门禁', '长距依赖', '信息感知度', '先入为主',
    '反例边界', '假设推翻', '拓扑剪枝', '证据闭环'
  ];
  vocab.forEach(kw => {
    if (fullText.includes(kw)) concepts.add(kw);
  });

  if (node.title && node.title.includes('：')) {
    const sub = node.title.split('：')[1].trim();
    if (sub.length >= 2 && sub.length <= 16) concepts.add(sub);
  }

  return Array.from(concepts).slice(0, 8);
}

// 打开“概念询问与展开”对话框
function openConceptInquiryModal(node, initialConcept = null) {
  inquiryParentNode = node;
  document.getElementById('inquiry-parent-title').innerText = `来源节点: #${node.id} - ${node.title || node.question}`;

  const chipsContainer = document.getElementById('concept-chips-container');
  chipsContainer.innerHTML = '';

  const concepts = extractConceptsFromNode(node);
  if (initialConcept && !concepts.includes(initialConcept)) {
    concepts.unshift(initialConcept);
  }

  if (concepts.length === 0) {
    chipsContainer.innerHTML = `<span style="font-size: 11px; color: #64748b;">(未自动提取到特征词，请在下方自由输入)</span>`;
  } else {
    concepts.forEach(c => {
      const chip = document.createElement('div');
      chip.className = 'concept-chip';
      chip.innerText = `+ ${c}`;
      chip.title = `点击填入关于【${c}】的追问模板`;
      chip.onclick = () => {
        const textarea = document.getElementById('inquiry-question-input');
        textarea.value = `解释一下【${c}】的概念、核心含义与实际应用场景。`;
        textarea.focus();
      };
      chipsContainer.appendChild(chip);
    });
  }

  const textarea = document.getElementById('inquiry-question-input');
  if (initialConcept) {
    textarea.value = `解释一下【${initialConcept}】的概念、核心含义与实际应用场景。`;
  } else {
    textarea.value = concepts.length > 0 
      ? `解释一下【${concepts[0]}】的概念、核心含义与实际应用场景。`
      : '';
  }

  inquiryModal.style.display = 'flex';
  setTimeout(() => {
    textarea.focus();
  }, 100);
}

// 提交概念询问并生成新分支
async function submitConceptInquiry() {
  if (!inquiryParentNode) return;
  const textarea = document.getElementById('inquiry-question-input');
  const userQuestion = textarea.value.trim();

  if (!userQuestion) {
    alert("请输入你要询问或推演的问题！");
    return;
  }

  let newTitle = "深入追问";
  const matched = userQuestion.match(/【([^】]+)】/);
  if (matched) {
    newTitle = `概念追问：${matched[1]}`;
  } else {
    newTitle = userQuestion.slice(0, 16) + (userQuestion.length > 16 ? '...' : '');
  }

  const newId = `n_inquiry_${Date.now()}`;
  const shouldAutoAsk = document.getElementById('inquiry-auto-ask').checked;

  const newNode = {
    id: newId,
    kind: 'question',
    title: newTitle,
    question: userQuestion,
    response: '',
    status: shouldAutoAsk ? 'generating' : 'idle',
    x: inquiryParentNode.x + 460,
    y: inquiryParentNode.y + (Math.random() * 80 - 40)
  };

  graph.nodes.push(newNode);
  graph.edges.push({
    id: `e_${Date.now()}`,
    source: inquiryParentNode.id,
    target: newId,
    kind: 'solid'
  });

  saveGraph();
  renderNodes();
  requestAnimationFrame(() => renderEdges());
  selectNode(newId);
  inquiryModal.style.display = 'none';

  if (shouldAutoAsk) {
    const partition = partitionContext(newId, graph.nodes, graph.edges);
    const compiled = compilePrompt(partition);
    updateStatus(`正在请求 ${currentConfig.model} 为新分支生成解答...`);

    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nodeId: newId,
          prompt: compiled.fullText,
          model: currentConfig.model,
          sessionId: currentSessionId
        })
      });
      const data = await res.json();
      const liveNode = graph.nodes.find(n => n.id === newId) || newNode;
      if (data.ok) {
        liveNode.response = data.response;
        liveNode.status = 'done';
        if (data.mtime) lastMtime = data.mtime;
        updateStatus(`[完成] 新分支 #${newId} 已生成`);
      } else {
        liveNode.status = 'idle';
        alert("生成失败: " + data.error);
      }
    } catch (e) {
      const liveNode = graph.nodes.find(n => n.id === newId) || newNode;
      liveNode.status = 'idle';
      alert("请求异常: " + e.message);
    } finally {
      saveGraph();
      renderNodes();
      requestAnimationFrame(() => renderEdges());
      if (selectedNodeId === newId) updateContextInspector();
    }
  }
}

// 抽屉展开与选项卡切换 (保持上次阅读位置)
let lastSavedPdfScrollTop = 0;

function openDrawer(tab) {
  // 1. 若当前在阅读器中，先记住物理滚动位置
  const pdfViewContainer = document.getElementById('pdf-view-container');
  if (pdfViewContainer && currentDocMode === 'pdf' && pdfViewContainer.scrollTop > 0) {
    lastSavedPdfScrollTop = pdfViewContainer.scrollTop;
  }

  activeTab = tab;
  drawer.classList.add('open');
  if (tab === 'reader') {
    if (!drawer.style.width || drawer.style.width === '420px') {
      drawer.style.width = '50vw';
    }
    const btnHalf = document.getElementById('btn-drawer-half');
    const btnCompact = document.getElementById('btn-drawer-compact');
    const btnWide = document.getElementById('btn-drawer-wide');
    if (btnHalf) btnHalf.classList.add('active');
    if (btnCompact) btnCompact.classList.remove('active');
    if (btnWide) btnWide.classList.remove('active');
    
    // 切换进入文献阅读器时，无损恢复之前停留的精确滚动位置
    setTimeout(() => {
      if (currentDocMode === 'pdf' && currentPdfDoc && pdfViewContainer) {
        const targetScroll = lastSavedPdfScrollTop || (graph.activeDoc ? graph.activeDoc.scrollTop : 0);
        if (targetScroll > 0) {
          pdfViewContainer.scrollTop = targetScroll;
        } else if (currentPdfPageNum > 1) {
          scrollToPage(currentPdfPageNum, false);
        }
      }
    }, 50);
  }
  document.querySelectorAll('.drawer-tab').forEach(el => {
    el.classList.toggle('active', el.dataset.tab === tab);
  });
  document.getElementById('inspector-panel').style.display = tab === 'inspector' ? 'block' : 'none';
  document.getElementById('reader-panel').style.display = tab === 'reader' ? 'flex' : 'none';
}

// ==========================================
// 文献阅读器与文献资产解耦引擎 (PDF.js + Markdown)
// ==========================================

let currentDocMode = 'markdown'; // 'markdown' | 'pdf'
let currentPdfDoc = null;
let currentPdfPageNum = 1;
let currentPdfScale = 1.15;
let currentDocTitle = '文献原文';
let currentPdfUserScale = null; // null 表示自动满宽自适应 (Fit-Width)
let pdfSlotsMap = new Map();
let pdfPageObserver = null;
let pdfVisibilityObserver = null;
let materialsCatalog = [];
let isRestoringBreakpoint = false;
let breakpointSaveTimer = null;

// 初始化文献系统
async function initDocumentSystem() {
  if (window.pdfjsLib) {
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = './vendor/pdfjs/pdf.worker.min.js';
  }

  setupPdfControls();
  setupDrawerResizer();
  setupPdfSnipper();

  // 划词摘录监听 (Markdown 模式)
  const mdContainer = document.getElementById('paper-content');
  if (mdContainer) {
    mdContainer.onmouseup = () => {
      if (currentDocMode !== 'markdown') return;
      handleSelectionToolbar('paper-content', currentDocTitle);
    };
    mdContainer.onscroll = () => {
      saveReadingBreakpoint();
    };
  }

  // PDF 划词摘录监听
  const pdfViewContainer = document.getElementById('pdf-view-container');
  if (pdfViewContainer) {
    pdfViewContainer.onmouseup = () => {
      if (currentDocMode !== 'pdf') return;
      handleSelectionToolbar('pdf-text-layer', `${currentDocTitle} (P.${currentPdfPageNum})`);
    };
  }

  function handleSelectionToolbar(containerId, citationText) {
    const selection = window.getSelection();
    const selectedText = selection ? selection.toString().trim() : '';
    const toolbar = document.getElementById('extract-toolbar');
    if (selectedText.length >= 3) {
      toolbar.style.display = 'block';
      toolbar.dataset.text = selectedText;
      toolbar.dataset.citation = citationText;
    } else {
      toolbar.style.display = 'none';
    }
  }

  // 本地文件上传与解析
  const fileInput = document.getElementById('input-upload-file');
  if (fileInput) {
    fileInput.onchange = (e) => {
      if (e.target.files && e.target.files[0]) {
        handleUploadMaterialFile(e.target.files[0]);
      }
    };
  }

  // 支持拖拽文件到阅读面板
  const readerPanel = document.getElementById('reader-panel');
  if (readerPanel) {
    readerPanel.ondragover = (e) => {
      e.preventDefault();
      readerPanel.style.outline = '2px dashed #6366f1';
      readerPanel.style.outlineOffset = '-4px';
    };
    readerPanel.ondragleave = () => {
      readerPanel.style.outline = 'none';
    };
    readerPanel.ondrop = (e) => {
      e.preventDefault();
      readerPanel.style.outline = 'none';
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]) {
        handleUploadMaterialFile(e.dataTransfer.files[0]);
      }
    };
  }

  // 文献下拉切换监听
  const docSelector = document.getElementById('doc-selector');
  if (docSelector) {
    docSelector.onchange = async () => {
      const selectedOpt = docSelector.selectedOptions[0];
      if (!selectedOpt || !selectedOpt.value) return;
      const url = selectedOpt.value;
      const type = selectedOpt.dataset.type || (url.toLowerCase().endsWith('.pdf') ? 'pdf' : 'markdown');
      const name = selectedOpt.dataset.name || selectedOpt.innerText;
      const title = selectedOpt.dataset.title || name;
      await switchActiveDocument({ url, type, name, title }, true);
    };
  }

  await loadMaterialsCatalog();
  await restoreSessionActiveDoc();
}

// 获取文献库资产列表
async function loadMaterialsCatalog() {
  try {
    const res = await fetch('/api/materials');
    const data = await res.json();
    materialsCatalog = data.materials || [];
    renderDocSelectorOptions();
  } catch (e) {
    console.warn("获取文献列表异常:", e);
  }
}

function renderDocSelectorOptions() {
  const selector = document.getElementById('doc-selector');
  if (!selector) return;
  selector.innerHTML = '';

  if (materialsCatalog.length === 0) {
    selector.innerHTML = '<option value="">(资产库暂无文献)</option>';
    return;
  }

  const activeUrl = graph.activeDoc ? graph.activeDoc.url : '';
  materialsCatalog.forEach(m => {
    const opt = document.createElement('option');
    opt.value = m.url;
    opt.dataset.type = m.type;
    opt.dataset.name = m.name;
    opt.dataset.title = m.title;
    const icon = m.type === 'pdf' ? '📄' : '📝';
    opt.innerText = `${icon} ${m.name}`;
    if (activeUrl && (activeUrl === m.url || activeUrl.endsWith(encodeURIComponent(m.name)) || activeUrl.endsWith(m.name))) {
      opt.selected = true;
    }
    selector.appendChild(opt);
  });
}

// 切换当前活跃文献资产
async function switchActiveDocument(docInfo, resetProgress = false) {
  if (!docInfo || !docInfo.url) return;

  if (!graph.activeDoc) graph.activeDoc = {};
  graph.activeDoc.url = docInfo.url;
  graph.activeDoc.type = docInfo.type || (docInfo.url.toLowerCase().endsWith('.pdf') ? 'pdf' : 'markdown');
  graph.activeDoc.name = docInfo.name || docInfo.title;
  graph.activeDoc.title = docInfo.title || docInfo.name;

  if (resetProgress) {
    graph.activeDoc.currentPage = 1;
    graph.activeDoc.scrollTop = 0;
  }

  debouncedSave();
  renderDocSelectorOptions();

  if (graph.activeDoc.type === 'pdf') {
    await loadPdfDocument(graph.activeDoc.url, graph.activeDoc.title, graph.activeDoc);
  } else {
    await loadMarkdownDocument(graph.activeDoc.url, graph.activeDoc.title, graph.activeDoc);
  }
}

// 恢复当前课题绑定的文献资产与断点
async function restoreSessionActiveDoc() {
  const activeDoc = graph.activeDoc;
  if (activeDoc && activeDoc.url) {
    renderDocSelectorOptions();
    if (activeDoc.type === 'pdf') {
      await loadPdfDocument(activeDoc.url, activeDoc.title || activeDoc.name, activeDoc);
    } else {
      await loadMarkdownDocument(activeDoc.url, activeDoc.title || activeDoc.name, activeDoc);
    }
  } else {
    // 寻找默认示例文献或首个文献
    const defaultItem = materialsCatalog.find(m => m.name.includes('王京凡') || m.type === 'pdf') || materialsCatalog[0];
    if (defaultItem) {
      await switchActiveDocument(defaultItem, false);
    } else {
      await loadMarkdownDocument('/materials/sample_paper.md', '文献原文：Lost in the Middle');
    }
  }
}

// 处理本地文献文件上传
async function handleUploadMaterialFile(file) {
  if (!file) return;
  try {
    updateStatus(`正在上传文献【${file.name}】...`);
    const reader = new FileReader();
    reader.onload = async (e) => {
      const base64Data = e.target.result.split(',')[1];
      const res = await fetch('/api/upload-material', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename: file.name,
          contentBase64: base64Data
        })
      });
      const data = await res.json();
      if (data.ok && data.material) {
        await loadMaterialsCatalog();
        await switchActiveDocument(data.material, true);
        openDrawer('reader');
        updateStatus(`✅ 文献【${data.material.name}】已成功上传并绑定至当前课题！`);
      } else {
        alert("上传文献失败: " + (data.error || "未知错误"));
      }
    };
    reader.readAsDataURL(file);
  } catch (e) {
    console.error("上传文献异常:", e);
    alert("上传异常: " + e.message);
  }
}

// 保存阅读断点状态（防抖无感写入图谱元数据）
function saveReadingBreakpoint() {
  if (isRestoringBreakpoint || !graph) return;
  clearTimeout(breakpointSaveTimer);
  breakpointSaveTimer = setTimeout(() => {
    if (!graph.activeDoc) graph.activeDoc = {};
    const viewContainer = document.getElementById('pdf-view-container');
    const mdContainer = document.getElementById('paper-content');

    if (currentDocMode === 'pdf' && viewContainer) {
      graph.activeDoc.currentPage = currentPdfPageNum;
      graph.activeDoc.scrollTop = viewContainer.scrollTop;
      graph.activeDoc.userScale = currentPdfUserScale;
    } else if (mdContainer) {
      graph.activeDoc.scrollTop = mdContainer.scrollTop;
    }
    graph.activeDoc.drawerWidth = drawer.style.width;
    debouncedSave();
  }, 300);
}

function switchDocMode(mode) {
  currentDocMode = mode;
  const mdContainer = document.getElementById('paper-content');
  const pdfWrapper = document.getElementById('pdf-view-wrapper');
  const pdfToolbar = document.getElementById('pdf-toolbar');

  if (mode === 'pdf') {
    if (mdContainer) mdContainer.style.display = 'none';
    if (pdfWrapper) pdfWrapper.style.display = 'flex';
    if (pdfToolbar) pdfToolbar.style.display = 'flex';
  } else {
    if (mdContainer) mdContainer.style.display = 'block';
    if (pdfWrapper) pdfWrapper.style.display = 'none';
    if (pdfToolbar) pdfToolbar.style.display = 'none';
  }
}

async function loadMarkdownDocument(url, docTitle, savedState = null) {
  const container = document.getElementById('paper-content');
  try {
    switchDocMode('markdown');
    currentDocTitle = docTitle;
    const res = await fetch(url);
    const text = await res.text();
    container.innerHTML = renderMarkdown(text);
    if (savedState && savedState.scrollTop) {
      container.scrollTop = savedState.scrollTop;
    }
    updateStatus(`已载入文献: ${docTitle}`);
  } catch (e) {
    container.innerText = "暂无文献内容，请上传文献或从下拉菜单选择文档。";
  }
}

let currentPdfOutline = [];

async function loadPdfDocument(source, docTitle, savedState = null) {
  if (!window.pdfjsLib) {
    alert("PDF 渲染引擎组件正在准备中，请刷新页面重试。");
    return;
  }

  try {
    updateStatus(`正在载入文献 PDF: ${docTitle} ...`);
    switchDocMode('pdf');
    currentDocTitle = docTitle;

    if (savedState && savedState.userScale) {
      currentPdfUserScale = savedState.userScale;
    }
    if (savedState && savedState.drawerWidth) {
      drawer.style.width = savedState.drawerWidth;
    }

    const loadingTask = window.pdfjsLib.getDocument(source);
    currentPdfDoc = await loadingTask.promise;
    
    const targetPage = (savedState && savedState.currentPage) ? savedState.currentPage : 1;
    currentPdfPageNum = targetPage;

    const countEl = document.getElementById('pdf-page-count');
    if (countEl) countEl.innerText = currentPdfDoc.numPages;

    const pageInput = document.getElementById('pdf-page-input');
    if (pageInput) {
      pageInput.value = targetPage;
      pageInput.max = currentPdfDoc.numPages;
    }

    await buildContinuousScrollLayout();

    // 毫秒级无损复原断点滚动位置
    if (savedState && (savedState.scrollTop || savedState.currentPage > 1)) {
      isRestoringBreakpoint = true;
      const viewContainer = document.getElementById('pdf-view-container');
      if (savedState.scrollTop && viewContainer) {
        viewContainer.scrollTop = savedState.scrollTop;
      } else {
        scrollToPage(targetPage, false);
      }
      setTimeout(() => { isRestoringBreakpoint = false; }, 350);
    }

    // 异步加载并解析 PDF 章节目录大纲
    loadPdfOutline(currentPdfDoc);

    updateStatus(`PDF 已成功载入，共 ${currentPdfDoc.numPages} 页（已恢复至上次阅读位置）`);
  } catch (err) {
    console.error("载入 PDF 失败:", err);
    updateStatus(`载入 PDF 异常: ${err.message}`);
  }
}

// 解析并渲染 PDF 章节大纲树
async function loadPdfOutline(doc) {
  const treeContainer = document.getElementById('pdf-outline-tree');
  if (!treeContainer) return;
  treeContainer.innerHTML = '<div style="color: #64748b; padding: 12px; text-align: center;">正在解析章节大纲...</div>';

  try {
    const rawOutline = await doc.getOutline();
    if (!rawOutline || rawOutline.length === 0) {
      renderFallbackOutline(doc.numPages);
      return;
    }

    currentPdfOutline = await resolveOutlineDestinations(doc, rawOutline);
    renderOutlineTree(currentPdfOutline);
  } catch (err) {
    console.warn("解析 PDF 目录大纲失败:", err);
    renderFallbackOutline(doc.numPages);
  }
}

async function resolveOutlineDestinations(doc, items) {
  const result = [];
  for (const item of items) {
    let targetPage = null;
    try {
      let dest = item.dest;
      if (typeof dest === 'string') {
        dest = await doc.getDestination(dest);
      }
      if (Array.isArray(dest) && dest[0]) {
        const pageIndex = await doc.getPageIndex(dest[0]);
        targetPage = pageIndex + 1;
      }
    } catch (e) {
      // 容错忽略目标页解析异常
    }

    let subItems = [];
    if (item.items && item.items.length > 0) {
      subItems = await resolveOutlineDestinations(doc, item.items);
    }

    result.push({
      title: item.title ? item.title.trim() : '未命名章节',
      pageNum: targetPage,
      items: subItems
    });
  }
  return result;
}

function renderOutlineTree(outlineItems) {
  const treeContainer = document.getElementById('pdf-outline-tree');
  if (!treeContainer) return;
  treeContainer.innerHTML = '';

  if (!outlineItems || outlineItems.length === 0) {
    treeContainer.innerHTML = '<div style="color: #64748b; padding: 12px; text-align: center;">该文献未包含书签目录</div>';
    return;
  }

  function createOutlineNode(item) {
    const wrap = document.createElement('div');
    wrap.className = 'outline-node-wrapper';

    const row = document.createElement('div');
    row.className = 'outline-item';
    if (item.pageNum === currentPdfPageNum) row.classList.add('active');
    row.dataset.page = item.pageNum || '';

    row.innerHTML = `
      <span class="outline-item-title" title="${escapeHtml(item.title)}">${escapeHtml(item.title)}</span>
      ${item.pageNum ? `<span class="outline-page-badge">P.${item.pageNum}</span>` : ''}
    `;

    row.onclick = (e) => {
      e.stopPropagation();
      if (item.pageNum) {
        jumpToOutlinePage(item.pageNum);
        document.querySelectorAll('.outline-item').forEach(el => el.classList.remove('active'));
        row.classList.add('active');
      }
    };

    wrap.appendChild(row);

    if (item.items && item.items.length > 0) {
      const subWrap = document.createElement('div');
      subWrap.className = 'outline-subitems';
      item.items.forEach(sub => {
        subWrap.appendChild(createOutlineNode(sub));
      });
      wrap.appendChild(subWrap);
    }

    return wrap;
  }

  const frag = document.createDocumentFragment();
  outlineItems.forEach(item => {
    frag.appendChild(createOutlineNode(item));
  });
  treeContainer.appendChild(frag);
}

function renderFallbackOutline(numPages) {
  const treeContainer = document.getElementById('pdf-outline-tree');
  if (!treeContainer) return;
  treeContainer.innerHTML = `
    <div style="padding: 10px 8px; color: #94a3b8; font-size: 11.5px; line-height: 1.5;">
      <p style="margin-bottom: 8px; color: #cbd5e1;">⚠️ 该 PDF 未内置书签大纲，可通过以下常用分页快速跳转：</p>
      <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 4px;">
        ${Array.from({ length: Math.min(10, Math.ceil(numPages / 10)) }, (_, i) => {
          const p = i === 0 ? 1 : i * 10;
          return `<button class="btn" style="padding: 3px 6px; font-size: 11px; justify-content: center;" onclick="window.jumpToOutlinePage(${p})">第 ${p} 页</button>`;
        }).join('')}
      </div>
    </div>
  `;
}

// 点击目录大纲平滑跳转并光效高亮目标页
function jumpToOutlinePage(pageNum) {
  if (!currentPdfDoc) return;
  scrollToPage(pageNum, true);

  // 光效高亮目标页 1.5 秒
  setTimeout(() => {
    const slot = document.getElementById(`pdf-slot-${pageNum}`);
    if (slot) {
      slot.classList.add('page-highlight');
      setTimeout(() => {
        slot.classList.remove('page-highlight');
      }, 1500);
    }
  }, 200);

  updateStatus(`已定位至文献第 ${pageNum} 页`);
  saveReadingBreakpoint();
}

window.jumpToOutlinePage = jumpToOutlinePage;


async function buildContinuousScrollLayout() {
  if (!currentPdfDoc) return;
  const scrollContainer = document.getElementById('pdf-continuous-scroll');
  const viewContainer = document.getElementById('pdf-view-container');
  if (!scrollContainer || !viewContainer) return;

  scrollContainer.innerHTML = '';
  pdfSlotsMap.clear();

  if (pdfPageObserver) pdfPageObserver.disconnect();
  if (pdfVisibilityObserver) pdfVisibilityObserver.disconnect();

  // 获取第 1 页以探知该文档的天然长宽比与基准尺寸
  const page1 = await currentPdfDoc.getPage(1);
  const unscaled = page1.getViewport({ scale: 1.0 });
  const containerWidth = Math.max(380, viewContainer.clientWidth - 40);
  const fitScale = containerWidth / unscaled.width;
  const effectiveScale = currentPdfUserScale || fitScale;

  const targetWidth = Math.round(unscaled.width * effectiveScale);
  const targetHeight = Math.round(unscaled.height * effectiveScale);

  const zoomLevel = document.getElementById('pdf-zoom-level');
  if (zoomLevel) {
    zoomLevel.innerText = currentPdfUserScale ? `${Math.round((effectiveScale / fitScale) * 100)}%` : '自适应';
  }

  // 构建全部页面的轻量占位插槽
  const fragment = document.createDocumentFragment();
  for (let p = 1; p <= currentPdfDoc.numPages; p++) {
    const slot = document.createElement('div');
    slot.className = 'pdf-page-slot';
    slot.id = `pdf-slot-${p}`;
    slot.dataset.page = p;
    slot.style.width = `${targetWidth}px`;
    slot.style.minHeight = `${targetHeight}px`;

    slot.innerHTML = `
      <div class="pdf-slot-placeholder" style="min-height: ${targetHeight}px;">
        <span>第 ${p} 页 · 滚动至此秒级加载...</span>
      </div>
      <canvas class="pdf-canvas" style="display: none;"></canvas>
      <div class="textLayer" style="display: none;"></div>
    `;

    fragment.appendChild(slot);
    pdfSlotsMap.set(p, {
      slot,
      page: null,
      rendered: false,
      rendering: false,
      scale: effectiveScale
    });
  }
  scrollContainer.appendChild(fragment);

  // 1. 视口预加载 Observer（前后提前预渲染 800px 范围内的页面）
  pdfPageObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const pageNum = parseInt(entry.target.dataset.page, 10);
        renderPageSlot(pageNum);
      }
    });
  }, {
    root: viewContainer,
    rootMargin: '800px 0px 800px 0px'
  });

  // 2. 活跃页码追踪：当用户滚轮滑动时，实时无损检测视口正中偏上的页面
  let scrollThrottleTimer = null;
  viewContainer.onscroll = () => {
    if (scrollThrottleTimer) return;
    scrollThrottleTimer = requestAnimationFrame(() => {
      scrollThrottleTimer = null;
      updateCurrentPageOnScroll();
    });
  };

  pdfSlotsMap.forEach((info) => {
    pdfPageObserver.observe(info.slot);
  });

  // 优先加载首屏第 1 页
  await renderPageSlot(1);
}

function updateCurrentPageOnScroll() {
  if (!currentPdfDoc || currentDocMode !== 'pdf') return;
  const viewContainer = document.getElementById('pdf-view-container');
  if (!viewContainer) return;

  const containerRect = viewContainer.getBoundingClientRect();
  const probeY = containerRect.top + 80;

  for (let p = 1; p <= currentPdfDoc.numPages; p++) {
    const slot = document.getElementById(`pdf-slot-${p}`);
    if (!slot) continue;
    const r = slot.getBoundingClientRect();
    if (r.top <= probeY && r.bottom >= probeY) {
      if (currentPdfPageNum !== p) {
        currentPdfPageNum = p;
        const pageInput = document.getElementById('pdf-page-input');
        if (pageInput && document.activeElement !== pageInput) {
          pageInput.value = p;
        }
      }
      break;
    }
  }
}

async function renderPageSlot(pageNum) {
  const item = pdfSlotsMap.get(pageNum);
  if (!item || item.rendered || item.rendering || !currentPdfDoc) return;
  item.rendering = true;

  try {
    const page = await currentPdfDoc.getPage(pageNum);
    item.page = page;

    const slot = item.slot;
    const canvas = slot.querySelector('.pdf-canvas');
    const textLayer = slot.querySelector('.textLayer');
    const placeholder = slot.querySelector('.pdf-slot-placeholder');
    const context = canvas.getContext('2d');

    const outputScale = window.devicePixelRatio || 1;
    const viewport = page.getViewport({ scale: item.scale });

    canvas.width = Math.floor(viewport.width * outputScale);
    canvas.height = Math.floor(viewport.height * outputScale);
    canvas.style.width = Math.floor(viewport.width) + 'px';
    canvas.style.height = Math.floor(viewport.height) + 'px';

    slot.style.width = canvas.style.width;
    slot.style.minHeight = canvas.style.height;

    const transform = outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : null;
    await page.render({ canvasContext: context, transform, viewport }).promise;

    if (textLayer) {
      textLayer.innerHTML = '';
      textLayer.style.width = canvas.style.width;
      textLayer.style.height = canvas.style.height;
      const textContent = await page.getTextContent();
      if (window.pdfjsLib && window.pdfjsLib.renderTextLayer) {
        window.pdfjsLib.renderTextLayer({
          textContentSource: textContent,
          container: textLayer,
          viewport: viewport
        });
      }
    }

    if (placeholder) placeholder.style.display = 'none';
    canvas.style.display = 'block';
    if (textLayer) textLayer.style.display = 'block';

    item.rendered = true;
  } catch (err) {
    console.error(`渲染第 ${pageNum} 页异常:`, err);
  } finally {
    item.rendering = false;
  }
}

function scrollToPage(num, smooth = true) {
  if (!currentPdfDoc) return;
  let target = parseInt(num, 10);
  if (isNaN(target) || target < 1) target = 1;
  if (target > currentPdfDoc.numPages) target = currentPdfDoc.numPages;

  currentPdfPageNum = target;
  const pageInput = document.getElementById('pdf-page-input');
  if (pageInput) pageInput.value = target;

  const slot = document.getElementById(`pdf-slot-${target}`);
  if (slot) {
    slot.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'start' });
    renderPageSlot(target);
  }
}

function setupPdfControls() {
  const btnPrev = document.getElementById('pdf-prev');
  const btnNext = document.getElementById('pdf-next');
  const pageInput = document.getElementById('pdf-page-input');
  const zoomIn = document.getElementById('pdf-zoom-in');
  const zoomOut = document.getElementById('pdf-zoom-out');

  if (btnPrev) {
    btnPrev.onclick = () => {
      if (currentPdfPageNum <= 1) return;
      scrollToPage(currentPdfPageNum - 1);
    };
  }

  if (btnNext) {
    btnNext.onclick = () => {
      if (!currentPdfDoc || currentPdfPageNum >= currentPdfDoc.numPages) return;
      scrollToPage(currentPdfPageNum + 1);
    };
  }

  if (pageInput) {
    pageInput.onchange = () => {
      scrollToPage(pageInput.value);
    };
    pageInput.onkeydown = (e) => {
      if (e.key === 'Enter') scrollToPage(pageInput.value);
    };
  }

  if (zoomIn) {
    zoomIn.onclick = () => {
      const base = currentPdfUserScale || 1.0;
      currentPdfUserScale = Math.min(base * 1.15, 2.6);
      buildContinuousScrollLayout().then(() => scrollToPage(currentPdfPageNum, false));
    };
  }

  if (zoomOut) {
    zoomOut.onclick = () => {
      const base = currentPdfUserScale || 1.0;
      currentPdfUserScale = Math.max(base / 1.15, 0.45);
      buildContinuousScrollLayout().then(() => scrollToPage(currentPdfPageNum, false));
    };
  }

  // 章节目录面板展开与收起
  const btnToggleOutline = document.getElementById('btn-toggle-outline');
  const outlinePanel = document.getElementById('pdf-outline-panel');
  const btnCloseOutline = document.getElementById('btn-close-outline');

  if (btnToggleOutline && outlinePanel) {
    btnToggleOutline.onclick = () => {
      const isVisible = outlinePanel.style.display === 'flex';
      outlinePanel.style.display = isVisible ? 'none' : 'flex';
      btnToggleOutline.classList.toggle('active', !isVisible);
    };
  }

  if (btnCloseOutline && outlinePanel) {
    btnCloseOutline.onclick = () => {
      outlinePanel.style.display = 'none';
      if (btnToggleOutline) btnToggleOutline.classList.remove('active');
    };
  }
}

// 抽屉分屏调宽器 (50%半屏 / 70%宽屏 / 紧凑 + 自由鼠标拖拽)
function setupDrawerResizer() {
  const drawer = document.getElementById('drawer');
  const resizer = document.getElementById('drawer-resizer');
  const btnCompact = document.getElementById('btn-drawer-compact');
  const btnHalf = document.getElementById('btn-drawer-half');
  const btnWide = document.getElementById('btn-drawer-wide');
  if (!resizer || !drawer) return;

  function updateSizeButtons(activeKey) {
    if (btnCompact) btnCompact.classList.toggle('active', activeKey === 'compact');
    if (btnHalf) btnHalf.classList.toggle('active', activeKey === 'half');
    if (btnWide) btnWide.classList.toggle('active', activeKey === 'wide');
  }

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

  if (btnCompact) btnCompact.onclick = () => setDrawerWidth('420px', 'compact');
  if (btnHalf) btnHalf.onclick = () => setDrawerWidth('50vw', 'half');
  if (btnWide) btnWide.onclick = () => setDrawerWidth('70vw', 'wide');

  // 双击手柄快速在 50% 半屏与紧凑宽度之间切换
  resizer.ondblclick = () => {
    const isHalf = drawer.style.width === '50vw' || !drawer.style.width;
    if (isHalf) {
      setDrawerWidth('420px', 'compact');
    } else {
      setDrawerWidth('50vw', 'half');
    }
  };

  // 鼠标横向拖拽调节分屏比例
  let isDragging = false;
  resizer.onmousedown = (e) => {
    e.preventDefault();
    isDragging = true;
    drawer.classList.add('resizing');
    resizer.classList.add('active');

    const onMouseMove = (ev) => {
      if (!isDragging) return;
      const newWidth = Math.max(380, Math.min(window.innerWidth * 0.85, window.innerWidth - ev.clientX));
      drawer.style.width = `${newWidth}px`;
      updateSizeButtons(null);
    };

    const onMouseUp = () => {
      if (!isDragging) return;
      isDragging = false;
      drawer.classList.remove('resizing');
      resizer.classList.remove('active');
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      if (currentDocMode === 'pdf' && currentPdfDoc) {
        buildContinuousScrollLayout().then(() => scrollToPage(currentPdfPageNum, false));
      }
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  };
}

// 划词摘录
window.extractSelectedToCanvas = () => {
  const toolbar = document.getElementById('extract-toolbar');
  const text = toolbar.dataset.text;
  const citation = toolbar.dataset.citation || (
    currentDocMode === 'pdf'
      ? `${currentDocTitle} (P.${currentPdfPageNum})`
      : `${currentDocTitle} (实证摘录)`
  );
  if (!text) return;

  const newId = `n_mat_${Date.now()}`;
  const newNode = {
    id: newId,
    kind: 'material',
    title: `摘录事实: ${text.slice(0, 18)}...`,
    excerpt: text,
    citation: citation,
    status: 'done',
    x: 80 + Math.random() * 40,
    y: 80 + Math.random() * 80
  };

  graph.nodes.push(newNode);
  saveGraph();
  renderNodes();
  requestAnimationFrame(() => renderEdges());
  selectNode(newId);
  toolbar.style.display = 'none';
  window.getSelection()?.removeAllRanges();
  updateStatus(`[已摘录] 事实素材已引入画布: ${citation}`);
};

// 整篇文档或当前页一键存为实证节点
window.importEntireDocumentAsMaterial = async () => {
  let title = currentDocTitle;
  let content = '';

  if (currentDocMode === 'pdf') {
    if (!currentPdfDoc) return;
    const page = await currentPdfDoc.getPage(currentPdfPageNum);
    const textContent = await page.getTextContent();
    content = textContent.items.map(item => item.str).join(' ');
    title = `${currentDocTitle} (第 ${currentPdfPageNum} 页)`;
  } else {
    const container = document.getElementById('paper-content');
    content = container?.innerText?.trim() || '';
  }

  if (!content) {
    alert("当前文献内容为空，无法导入。");
    return;
  }

  const newId = `n_mat_${Date.now()}`;
  const newNode = {
    id: newId,
    kind: 'material',
    title: `实证锚点: ${title.slice(0, 24)}...`,
    excerpt: content.slice(0, 800) + (content.length > 800 ? '...' : ''),
    content: content,
    citation: title,
    status: 'done',
    x: 100 + Math.random() * 40,
    y: 100 + Math.random() * 60
  };

  graph.nodes.push(newNode);
  saveGraph();
  renderNodes();
  requestAnimationFrame(() => renderEdges());
  selectNode(newId);
  updateStatus(`已成功将【${title}】作为客观事实锚点引入画布！`);
};

// ==========================================
// 论文原版公式与图表矩形拉框截图工具 (Mathpix 级交互)
// ==========================================

function setupPdfSnipper() {
  const btnSnip = document.getElementById('btn-pdf-snip');
  const snipOverlay = document.getElementById('pdf-snip-overlay');
  const snipBox = document.getElementById('pdf-snip-box');
  const viewContainer = document.getElementById('pdf-view-container');
  if (!btnSnip || !snipOverlay || !snipBox) return;

  let isSnipActive = false;
  let isDrawing = false;
  let startX = 0;
  let startY = 0;

  function toggleSnip(active) {
    isSnipActive = active;
    if (isSnipActive) {
      btnSnip.style.background = '#f59e0b';
      btnSnip.style.color = '#000';
      btnSnip.style.fontWeight = 'bold';
      const scrollHeight = viewContainer ? viewContainer.scrollHeight : 2000;
      snipOverlay.style.height = `${scrollHeight}px`;
      snipOverlay.style.display = 'block';
      updateStatus('✂️ 已开启框选模式：请用鼠标在论文公式或插图上按住左键拖拽拉框！');
    } else {
      btnSnip.style.background = 'rgba(245, 158, 11, 0.15)';
      btnSnip.style.color = '#fde68a';
      btnSnip.style.fontWeight = 'normal';
      snipOverlay.style.display = 'none';
      snipBox.style.display = 'none';
    }
  }

  btnSnip.onclick = () => toggleSnip(!isSnipActive);

  snipOverlay.onmousedown = (e) => {
    e.preventDefault();
    isDrawing = true;
    const rect = snipOverlay.getBoundingClientRect();
    startX = e.clientX - rect.left;
    startY = e.clientY - rect.top;
    snipBox.style.left = `${startX}px`;
    snipBox.style.top = `${startY}px`;
    snipBox.style.width = '0px';
    snipBox.style.height = '0px';
    snipBox.style.display = 'block';
  };

  snipOverlay.onmousemove = (e) => {
    if (!isDrawing) return;
    const rect = snipOverlay.getBoundingClientRect();
    const currentX = e.clientX - rect.left;
    const currentY = e.clientY - rect.top;

    const x = Math.min(startX, currentX);
    const y = Math.min(startY, currentY);
    const w = Math.abs(currentX - startX);
    const h = Math.abs(currentY - startY);

    snipBox.style.left = `${x}px`;
    snipBox.style.top = `${y}px`;
    snipBox.style.width = `${w}px`;
    snipBox.style.height = `${h}px`;
  };

  snipOverlay.onmouseup = async (e) => {
    if (!isDrawing) return;
    isDrawing = false;

    const rect = snipOverlay.getBoundingClientRect();
    const currentX = e.clientX - rect.left;
    const currentY = e.clientY - rect.top;

    const x = Math.min(startX, currentX);
    const y = Math.min(startY, currentY);
    const w = Math.abs(currentX - startX);
    const h = Math.abs(currentY - startY);

    if (w < 18 || h < 12) {
      snipBox.style.display = 'none';
      return;
    }

    // 寻找截取框中心点落在哪一个页面插槽内
    const centerY = y + h / 2;
    let targetSlot = null;
    let targetPageNum = currentPdfPageNum;

    for (const [p, item] of pdfSlotsMap.entries()) {
      const top = item.slot.offsetTop;
      const bottom = top + item.slot.offsetHeight;
      if (centerY >= top && centerY <= bottom) {
        targetSlot = item.slot;
        targetPageNum = p;
        break;
      }
    }

    if (!targetSlot) {
      targetSlot = document.getElementById(`pdf-slot-${currentPdfPageNum}`);
    }

    const canvas = targetSlot ? targetSlot.querySelector('.pdf-canvas') : null;
    if (!canvas || !canvas.clientWidth) {
      alert("目标页面画布尚未完成渲染，请滚动至该页稍候重试。");
      toggleSnip(false);
      return;
    }

    // 计算相对于目标页面插槽的局部截取坐标
    const slotTop = targetSlot.offsetTop;
    const slotLeft = targetSlot.offsetLeft;
    const relX = Math.max(0, x - slotLeft);
    const relY = Math.max(0, y - slotTop);
    const relW = Math.min(w, canvas.clientWidth - relX);
    const relH = Math.min(h, canvas.clientHeight - relY);

    const scaleX = canvas.width / canvas.clientWidth;
    const scaleY = canvas.height / canvas.clientHeight;

    const cropX = Math.round(relX * scaleX);
    const cropY = Math.round(relY * scaleY);
    const cropW = Math.round(relW * scaleX);
    const cropH = Math.round(relH * scaleY);

    const offscreen = document.createElement('canvas');
    offscreen.width = cropW;
    offscreen.height = cropH;
    const offCtx = offscreen.getContext('2d');
    offCtx.drawImage(canvas, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);

    const dataUrl = offscreen.toDataURL('image/png');
    const citation = `${currentDocTitle} (P.${targetPageNum} 视觉切片)`;
    const newId = `n_snip_${Date.now()}`;

    const newNode = {
      id: newId,
      kind: 'material',
      title: `公式/图表实证: P.${targetPageNum}`,
      imageUrl: dataUrl,
      excerpt: `![公式切片](${dataUrl})`,
      content: `![公式切片](${dataUrl})`,
      citation: citation,
      status: 'done',
      ocrStatus: 'pending',
      x: 80 + Math.random() * 40,
      y: 80 + Math.random() * 80
    };

    graph.nodes.push(newNode);
    saveGraph();
    renderNodes();
    requestAnimationFrame(() => renderEdges());
    selectNode(newId);

    toggleSnip(false);
    updateStatus(`✂️ 已截取第 ${targetPageNum} 页原版公式/插图入图！正在由 Gemini 多模态自动提取 LaTeX 表达式...`);

    // 自动调用大模型多模态公式反编译与变量解析
    transcribeFormula(newNode, dataUrl, citation);
  };
}

window.retryOcrFormula = (nodeId, event) => {
  if (event) event.stopPropagation();
  const target = graph.nodes.find(n => n.id === nodeId);
  if (!target || !target.imageUrl) {
    alert("该节点未包含有效的截取图像。");
    return;
  }
  transcribeFormula(target.id, target.imageUrl, target.citation || target.title);
};

async function transcribeFormula(nodeOrId, imageUrl, citation) {
  const nodeId = typeof nodeOrId === 'string' ? nodeOrId : nodeOrId.id;
  const liveNode = graph.nodes.find(n => n.id === nodeId);
  if (liveNode) {
    liveNode.ocrStatus = 'pending';
    if (!liveNode.imageUrl && imageUrl) liveNode.imageUrl = imageUrl;
    renderNodes();
    if (selectedNodeId === nodeId) updateContextInspector();
  }
  updateStatus(`⏳ 正在请求 Gemini 多模态视觉模型逆向提取公式与参数...`);

  try {
    const res = await fetch('/api/ocr-formula', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageUrl, citation })
    });
    const data = await res.json();
    const targetNode = graph.nodes.find(n => n.id === nodeId);
    if (targetNode) {
      if (data.ok && data.analysis) {
        targetNode.ocrStatus = 'done';
        targetNode.content = data.analysis;
        targetNode.excerpt = data.analysis;
        saveGraph();
        renderNodes();
        if (selectedNodeId === nodeId) updateContextInspector();
        updateStatus(`✨ 已成功将【${citation}】反编译为标准 LaTeX 公式与物理释义！`);
      } else {
        targetNode.ocrStatus = 'failed';
        saveGraph();
        renderNodes();
        if (selectedNodeId === nodeId) updateContextInspector();
        updateStatus(`⚠️ 公式反编译未完成: ${data.error || '未能识别有效内容'}`);
      }
    }
  } catch (err) {
    console.error("公式解析异常:", err);
    const targetNode = graph.nodes.find(n => n.id === nodeId);
    if (targetNode) {
      targetNode.ocrStatus = 'failed';
      saveGraph();
      renderNodes();
      if (selectedNodeId === nodeId) updateContextInspector();
    }
    updateStatus(`⚠️ 网络连接或调用异常: ${err.message}`);
  }
}



async function loadSessions() {
  try {
    const res = await fetch('/api/sessions');
    const data = await res.json();
    sessionsList = data.sessions || [];
    currentSessionId = data.activeId || (sessionsList[0] ? sessionsList[0].id : 'session_default');
    updateCurrentSessionBadge();
    renderSessionsList();
  } catch (e) {
    console.warn("加载课题会话列表失败:", e);
  }
}

async function loadSessionsListOnly() {
  try {
    const res = await fetch('/api/sessions');
    const data = await res.json();
    sessionsList = data.sessions || [];
    updateCurrentSessionBadge();
    renderSessionsList();
  } catch (e) {
    // 静默失败
  }
}

function updateCurrentSessionBadge() {
  const titleEl = document.getElementById('current-session-title');
  const currentSess = sessionsList.find(s => s.id === currentSessionId);
  if (titleEl) {
    titleEl.innerText = currentSess ? (currentSess.title || '未命名课题') : '课题管理';
  }
  const summaryEl = document.getElementById('sessions-summary');
  if (summaryEl) {
    summaryEl.innerText = `共 ${sessionsList.length} 个研究课题`;
  }
}

function renderSessionsList() {
  const listEl = document.getElementById('sessions-list');
  if (!listEl) return;
  listEl.innerHTML = '';

  sessionsList.forEach(s => {
    const item = document.createElement('div');
    item.className = `session-item ${s.id === currentSessionId ? 'active' : ''}`;
    item.dataset.id = s.id;

    const dateStr = s.updatedAt ? new Date(s.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';

    item.innerHTML = `
      <div class="session-item-header">
        <span class="session-item-title" title="${escapeHtml(s.title)}">${escapeHtml(s.title)}</span>
        <div class="session-actions">
          <button class="session-action-btn btn-rename" title="重命名课题">✏️</button>
          <button class="session-action-btn btn-del" title="删除课题">🗑️</button>
        </div>
      </div>
      <div class="session-item-meta">
        <span class="session-node-tag">${s.nodeCount || 0} 个节点</span>
        <span>${dateStr}</span>
      </div>
    `;

    item.addEventListener('click', (e) => {
      if (e.target.closest('.session-actions')) return;
      if (s.id !== currentSessionId) {
        switchSession(s.id);
      }
    });

    const btnRename = item.querySelector('.btn-rename');
    if (btnRename) {
      btnRename.addEventListener('click', (e) => {
        e.stopPropagation();
        handleRenameSession(s.id, s.title);
      });
    }

    const btnDel = item.querySelector('.btn-del');
    if (btnDel) {
      btnDel.addEventListener('click', (e) => {
        e.stopPropagation();
        handleDeleteSession(s.id, s.title);
      });
    }

    listEl.appendChild(item);
  });
}

function toggleSidebar() {
  const sidebar = document.getElementById('sidebar-sessions');
  const backdrop = document.getElementById('sidebar-backdrop');
  if (!sidebar) return;
  if (sidebar.classList.contains('open')) {
    closeSidebar();
  } else {
    openSidebar();
  }
}

function openSidebar() {
  const sidebar = document.getElementById('sidebar-sessions');
  const backdrop = document.getElementById('sidebar-backdrop');
  if (sidebar) sidebar.classList.add('open');
  if (backdrop) backdrop.style.display = 'block';
  renderSessionsList();
}

function closeSidebar() {
  const sidebar = document.getElementById('sidebar-sessions');
  const backdrop = document.getElementById('sidebar-backdrop');
  if (sidebar) sidebar.classList.remove('open');
  if (backdrop) backdrop.style.display = 'none';
}

function isGeneratingAnyNode() {
  return graph.nodes && graph.nodes.some(n => n.status === 'generating');
}

async function switchSession(sessionId) {
  if (isGeneratingAnyNode()) {
    if (!confirm("当前课题中尚有节点在模型生成中，切换后后台仍会完成写入，确定切换吗？")) return;
  }
  await saveGraph();

  try {
    updateStatus("正在切换课题...");
    const res = await fetch('/api/sessions/switch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId })
    });
    const data = await res.json();
    if (data.ok) {
      currentSessionId = sessionId;
      lastMtime = 0;
      await loadGraph();
      await loadSessions();
      await restoreSessionActiveDoc();
      selectedNodeId = null;
      renderNodes();
      requestAnimationFrame(() => {
        renderEdges();
        fitView();
      });
      closeSidebar();
      updateStatus(`就绪 · 已切换至课题: ${document.getElementById('current-session-title')?.innerText || ''}`);
    }
  } catch (e) {
    console.error("切换课题失败:", e);
    alert("切换课题失败: " + e.message);
  }
}

async function handleCreateNewSession() {
  const title = prompt("请输入新研究课题名称（例如：量子纠缠与贝尔不等式、Transformer注意力机制等）：", "新探索课题");
  if (title === null) return;
  
  await saveGraph();

  try {
    updateStatus("正在创建新课题...");
    const res = await fetch('/api/sessions/new', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: title.trim() })
    });
    const data = await res.json();
    if (data.ok) {
      currentSessionId = data.activeId;
      lastMtime = 0;
      await loadGraph();
      await loadSessions();
      await restoreSessionActiveDoc();
      selectedNodeId = null;
      renderNodes();
      requestAnimationFrame(() => renderEdges());
      closeSidebar();
      updateStatus(`就绪 · 新课题已建立: ${data.session.title}`);

      // 贴心弹窗：自动引导用户在空白画布上输入首个问题
      if (graph.nodes.length === 0) {
        setTimeout(() => {
          const btnAddQ = document.getElementById('btn-add-question');
          if (btnAddQ) btnAddQ.click();
        }, 300);
      }
    }
  } catch (e) {
    console.error("创建新课题失败:", e);
    alert("创建新课题失败: " + e.message);
  }
}

async function handleRenameSession(sessionId, oldTitle) {
  const newTitle = prompt("重命名研究课题名称：", oldTitle);
  if (!newTitle || newTitle.trim() === oldTitle) return;

  try {
    const res = await fetch('/api/sessions/rename', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, title: newTitle.trim() })
    });
    const data = await res.json();
    if (data.ok) {
      await loadSessions();
      if (sessionId === currentSessionId) {
        const titleEl = document.getElementById('current-session-title');
        if (titleEl) titleEl.innerText = newTitle.trim();
      }
    }
  } catch (e) {
    console.error("重命名课题失败:", e);
  }
}

async function handleDeleteSession(sessionId, title) {
  if (sessionsList.length <= 1) {
    alert("至少保留一个研究课题，无法删除最后一个课题。");
    return;
  }
  if (!confirm(`确定要彻底删除研究课题【${title}】吗？该操作不可撤销。`)) return;

  try {
    const res = await fetch('/api/sessions/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId })
    });
    const data = await res.json();
    if (data.ok) {
      if (sessionId === currentSessionId) {
        currentSessionId = data.activeId;
        lastMtime = 0;
        await loadGraph();
        selectedNodeId = null;
        renderNodes();
        requestAnimationFrame(() => renderEdges());
      }
      await loadSessions();
    }
  } catch (e) {
    console.error("删除课题失败:", e);
    alert("删除课题失败: " + e.message);
  }
}

// 交互事件监听器
function setupEventListeners() {
  const container = document.getElementById('canvas-container');

  // 画布平移
  container.addEventListener('mousedown', (e) => {
    if (e.target.closest('.node') || e.target.closest('.port')) return;
    isPanning = true;
    startPan = { x: e.clientX - pan.x, y: e.clientY - pan.y };
  });

  window.addEventListener('mousemove', (e) => {
    if (isPanning) {
      pan.x = e.clientX - startPan.x;
      pan.y = e.clientY - startPan.y;
      world.style.transform = `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`;
      return;
    }

    if (draggingNodeId) {
      window.getSelection()?.removeAllRanges();
      const node = graph.nodes.find(n => n.id === draggingNodeId);
      const nodeEl = document.querySelector(`.node[data-id="${draggingNodeId}"]`);
      if (node && nodeEl) {
        const worldPos = screenToWorld(e.clientX, e.clientY);
        node.x = worldPos.x - dragOffset.x;
        node.y = worldPos.y - dragOffset.y;
        nodeEl.style.left = `${node.x}px`;
        nodeEl.style.top = `${node.y}px`;
        renderEdges();
      }
      return;
    }

    if (connectingSourceId) {
      tempMousePos = screenToWorld(e.clientX, e.clientY);
      renderEdges();
    }
  });

  window.addEventListener('mouseup', (e) => {
    if (isPanning) isPanning = false;

    if (draggingNodeId) {
      draggingNodeId = null;
      window.getSelection()?.removeAllRanges();
      const selToolbar = document.getElementById('selection-toolbar');
      if (selToolbar) selToolbar.style.display = 'none';
      saveGraph();
    }

    if (connectingSourceId) {
      const portIn = e.target.closest('.port.in');
      if (portIn) {
        const targetId = portIn.dataset.node;
        if (targetId && targetId !== connectingSourceId) {
          const exists = graph.edges.some(edge => edge.source === connectingSourceId && edge.target === targetId);
          if (!exists) {
            graph.edges.push({
              id: `e_${Date.now()}`,
              source: connectingSourceId,
              target: targetId,
              kind: e.shiftKey ? 'dashed' : 'solid'
            });
            saveGraph();
            updateStatus(`已建立连线: ${connectingSourceId} -> ${targetId}`);
            if (selectedNodeId === targetId) updateContextInspector();
          }
        }
      }
      connectingSourceId = null;
      renderEdges();
    }
  });

  // 滚轮分流：光标在卡片内容区时完全放行浏览器原生 GPU 硬件加速平滑滚动；仅在画布空白区缩放
  container.addEventListener('wheel', (e) => {
    // 1. 若光标处于卡片内容区上方，且未按住 Ctrl/Cmd 键强制缩放画布：
    // 绝对不调用 e.preventDefault()，直接放行给 Chromium 底层 Compositor 线程原生 120Hz 丝滑惯性滚动
    if (e.target.closest('.node-content') && !e.ctrlKey && !e.metaKey) {
      return;
    }

    // 2. 若光标在卡片头部或底栏等边缘，平滑驱动该卡片内容区滚动
    const nodeEl = e.target.closest('.node');
    if (nodeEl && !e.ctrlKey && !e.metaKey) {
      const contentEl = nodeEl.querySelector('.node-content');
      if (contentEl) {
        contentEl.scrollBy({ top: e.deltaY, behavior: 'smooth' });
        e.preventDefault();
        return;
      }
    }

    // 画布背景滚轮缩放
    e.preventDefault();
    const rect = container.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    const zoomFactor = 1.08;
    const oldZoom = zoom;
    if (e.deltaY < 0) {
      zoom = Math.min(zoom * zoomFactor, 2.5);
    } else {
      zoom = Math.max(zoom / zoomFactor, 0.4);
    }
    pan.x = mouseX - (mouseX - pan.x) * (zoom / oldZoom);
    pan.y = mouseY - (mouseY - pan.y) * (zoom / oldZoom);
    world.style.transform = `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`;
    updateZoomIndicator();
    renderEdges();
  }, { passive: false });

  // 连线从输出端口触发
  container.addEventListener('mousedown', (e) => {
    const portOut = e.target.closest('.port.out');
    if (portOut) {
      connectingSourceId = portOut.dataset.node;
      tempMousePos = screenToWorld(e.clientX, e.clientY);
      renderEdges();
      e.stopPropagation();
    }
  });

  // 顶部操作按钮
  const btnAutoLayout = document.getElementById('btn-auto-layout');
  if (btnAutoLayout) {
    btnAutoLayout.onclick = () => applySugiyamaLayout(true);
  }

  document.getElementById('btn-add-question').onclick = () => {
    const newId = `n_q_${Date.now()}`;
    const screenCenter = screenToWorld(window.innerWidth / 3, window.innerHeight / 2.5);
    graph.nodes.push({
      id: newId,
      kind: 'question',
      title: '新探索课题',
      question: '',
      response: '',
      status: 'idle',
      x: Math.max(40, screenCenter.x - 160),
      y: Math.max(40, screenCenter.y - 80)
    });
    saveGraph();
    renderNodes();
    requestAnimationFrame(() => renderEdges());
    selectNode(newId);
    setTimeout(() => {
      const qInput = document.getElementById('node-edit-question');
      if (qInput) {
        qInput.focus();
        qInput.placeholder = "请在此直接输入你的具体科研探索问题...";
      }
    }, 150);
    updateStatus("已新建课题节点！请在右侧面板直接输入问题与标题。");
  };

  document.getElementById('btn-add-material').onclick = () => {
    openDrawer('reader');
  };

  document.getElementById('btn-toggle-reader').onclick = () => {
    openDrawer('reader');
  };

  document.getElementById('btn-reset-demo').onclick = async () => {
    if (confirm("是否重新加载科研工作流预置结构？")) {
      location.reload();
    }
  };

  // 设置弹窗
  document.getElementById('btn-open-settings').onclick = () => {
    document.getElementById('cfg-api-base').value = currentConfig.api_base || 'http://127.0.0.1:8046/v1';
    document.getElementById('cfg-model-select').value = currentConfig.model || 'gemini-3.8-flash-high';
    settingsModal.style.display = 'flex';
  };

  document.getElementById('btn-close-settings').onclick = () => {
    settingsModal.style.display = 'none';
  };

  document.getElementById('btn-cancel-settings').onclick = () => {
    settingsModal.style.display = 'none';
  };

  document.getElementById('btn-save-settings').onclick = async () => {
    const api_base = document.getElementById('cfg-api-base').value.trim();
    const model = document.getElementById('cfg-model-select').value;
    const api_key = document.getElementById('cfg-api-key').value.trim();

    const payload = { api_base, model };
    if (api_key) payload.api_key = api_key;

    try {
      const res = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const d = await res.json();
      if (d.ok) {
        currentConfig = d.config;
        updateStatus(`已更新配置 · 模型: ${currentConfig.model}`);
        const inquiryModelEl = document.getElementById('inquiry-model-name');
        if (inquiryModelEl) inquiryModelEl.innerText = currentConfig.model;
        if (selectedNodeId) updateContextInspector();
        settingsModal.style.display = 'none';
      }
    } catch (e) {
      alert("保存失败: " + e.message);
    }
  };

  document.querySelectorAll('.drawer-tab').forEach(el => {
    el.onclick = () => openDrawer(el.dataset.tab);
  });

  document.getElementById('btn-close-drawer').onclick = () => {
    drawer.classList.remove('open');
  };

  // 缩放控制按钮
  const zoomInBtn = document.getElementById('btn-zoom-in');
  if (zoomInBtn) {
    zoomInBtn.onclick = () => {
      zoom = Math.min(zoom * 1.15, 2.5);
      world.style.transform = `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`;
      updateZoomIndicator();
      renderEdges();
    };
  }

  const zoomOutBtn = document.getElementById('btn-zoom-out');
  if (zoomOutBtn) {
    zoomOutBtn.onclick = () => {
      zoom = Math.max(zoom / 1.15, 0.4);
      world.style.transform = `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`;
      updateZoomIndicator();
      renderEdges();
    };
  }

  const zoomFitBtn = document.getElementById('btn-zoom-fit');
  if (zoomFitBtn) {
    zoomFitBtn.onclick = () => fitView();
  }

  const zoomLayoutBtn = document.getElementById('btn-zoom-layout');
  if (zoomLayoutBtn) {
    zoomLayoutBtn.onclick = () => applySugiyamaLayout(true);
  }

  // 概念追问弹窗控制
  document.getElementById('btn-close-inquiry').onclick = () => {
    inquiryModal.style.display = 'none';
  };
  document.getElementById('btn-cancel-inquiry').onclick = () => {
    inquiryModal.style.display = 'none';
  };
  document.getElementById('btn-submit-inquiry').onclick = () => {
    submitConceptInquiry();
  };

  // 全屏卡片阅读弹窗控制
  const cardModal = document.getElementById('card-modal');
  const closeCardBtn = document.getElementById('btn-close-card-modal');
  if (closeCardBtn) {
    closeCardBtn.onclick = () => {
      cardModal.style.display = 'none';
    };
  }
  if (cardModal) {
    cardModal.addEventListener('click', (e) => {
      if (e.target === cardModal) cardModal.style.display = 'none';
    });
  }

  // 课题管理边栏交互控制
  const btnToggleSidebar = document.getElementById('btn-toggle-sidebar');
  const sessionBadge = document.getElementById('session-badge');
  const btnCloseSidebar = document.getElementById('btn-close-sidebar');
  const sidebarBackdrop = document.getElementById('sidebar-backdrop');
  const btnNewSession = document.getElementById('btn-new-session');

  if (btnToggleSidebar) btnToggleSidebar.onclick = () => toggleSidebar();
  if (sessionBadge) sessionBadge.onclick = () => toggleSidebar();
  if (btnCloseSidebar) btnCloseSidebar.onclick = () => closeSidebar();
  if (sidebarBackdrop) sidebarBackdrop.onclick = () => closeSidebar();
  if (btnNewSession) btnNewSession.onclick = () => handleCreateNewSession();

  // 全局快捷键与 Esc 键
  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && (e.key === 'b' || e.key === 'B')) {
      e.preventDefault();
      toggleSidebar();
    }
    if (e.key === 'Escape') {
      const sidebar = document.getElementById('sidebar-sessions');
      if (sidebar && sidebar.classList.contains('open')) closeSidebar();
      if (cardModal && cardModal.style.display === 'flex') cardModal.style.display = 'none';
      if (inquiryModal && inquiryModal.style.display === 'flex') inquiryModal.style.display = 'none';
      if (settingsModal && settingsModal.style.display === 'flex') settingsModal.style.display = 'none';
    }
  });
}

// 初始化划词快捷工具栏 (划线复制、追问概念、存为实证)
function initSelectionToolbar() {
  const toolbar = document.getElementById('selection-toolbar');
  const btnCopy = document.getElementById('sel-btn-copy');
  const btnInquiry = document.getElementById('sel-btn-inquiry');
  const btnMaterial = document.getElementById('sel-btn-material');
  if (!toolbar || !btnCopy) return;

  let currentSelectionText = '';
  let currentSelectionNodeId = null;

  function handleSelection() {
    const selection = window.getSelection();
    const text = selection ? selection.toString().trim() : '';

    if (!text || text.length === 0) {
      toolbar.style.display = 'none';
      return;
    }

    // 确定选区元素范围
    const anchorNode = selection.anchorNode;
    const containerEl = anchorNode ? (anchorNode.nodeType === 1 ? anchorNode : anchorNode.parentElement) : null;
    if (!containerEl) {
      toolbar.style.display = 'none';
      return;
    }

    // 仅在全屏学术阅读模态框、审查器面板与文献抽屉中激活划词快捷菜单
    const validContainer = containerEl.closest('.card-modal-body, #inspector-content, #paper-content');
    if (!validContainer) {
      toolbar.style.display = 'none';
      return;
    }

    const nodeCard = containerEl.closest('.node');
    const cardModal = containerEl.closest('#card-modal');
    if (nodeCard) {
      currentSelectionNodeId = nodeCard.dataset.id;
    } else if (cardModal) {
      const idEl = document.getElementById('modal-card-id');
      currentSelectionNodeId = idEl ? idEl.innerText.replace('#', '') : selectedNodeId;
    } else {
      currentSelectionNodeId = selectedNodeId;
    }

    currentSelectionText = text;

    try {
      const range = selection.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) {
        toolbar.style.display = 'none';
        return;
      }

      const posX = Math.max(100, Math.min(window.innerWidth - 100, rect.left + rect.width / 2));
      let posY = rect.top;

      toolbar.style.display = 'flex';
      toolbar.style.left = `${posX}px`;
      toolbar.style.top = `${posY}px`;

      btnCopy.innerHTML = `<span class="sel-icon">📋</span> 复制`;
      btnCopy.classList.remove('copied');
    } catch (e) {
      toolbar.style.display = 'none';
    }
  }

  // 监听划词事件（mouseup 与 keyup）
  document.addEventListener('mouseup', (e) => {
    if (toolbar.contains(e.target)) return;
    setTimeout(handleSelection, 50);
  });

  document.addEventListener('keyup', (e) => {
    if (e.key === 'Shift' || e.key.startsWith('Arrow')) {
      setTimeout(handleSelection, 50);
    }
  });

  // 复制按钮点击 (优先 Clipboard API，失败自动降级到 execCommand)
  btnCopy.onclick = async (e) => {
    e.stopPropagation();
    let copied = false;
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(currentSelectionText);
        copied = true;
      }
    } catch (err) {
      console.warn("Clipboard API 降级:", err);
    }

    if (!copied) {
      try {
        const ta = document.createElement('textarea');
        ta.value = currentSelectionText;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        copied = document.execCommand('copy');
        document.body.removeChild(ta);
      } catch (err2) {
        console.error("execCommand 复制异常:", err2);
      }
    }

    btnCopy.innerHTML = `<span class="sel-icon">✓</span> 已复制!`;
    btnCopy.classList.add('copied');
    updateStatus(`已划线复制 ${currentSelectionText.length} 字到剪贴板`);
    setTimeout(() => {
      toolbar.style.display = 'none';
    }, 900);
  };

  // 深入追问此概念
  btnInquiry.onclick = (e) => {
    e.stopPropagation();
    toolbar.style.display = 'none';
    const cardModal = document.getElementById('card-modal');
    if (cardModal) cardModal.style.display = 'none';

    const node = graph.nodes.find(n => n.id === currentSelectionNodeId) || graph.nodes.find(n => n.id === selectedNodeId);
    if (node) {
      selectNode(node.id);
      openConceptInquiryModal(node, currentSelectionText);
    } else {
      alert("请先选择一个上游课题节点！");
    }
  };

  // 存为文献实证节点
  btnMaterial.onclick = (e) => {
    e.stopPropagation();
    toolbar.style.display = 'none';
    const sourceNode = graph.nodes.find(n => n.id === currentSelectionNodeId) || graph.nodes.find(n => n.id === selectedNodeId);
    
    const newId = `n_mat_${Date.now()}`;
    const posX = sourceNode ? sourceNode.x + 400 : 200;
    const posY = sourceNode ? sourceNode.y + 60 : 200;

    const newMat = {
      id: newId,
      kind: 'material',
      title: currentSelectionText.slice(0, 14) + (currentSelectionText.length > 14 ? '...' : ''),
      excerpt: currentSelectionText,
      citation: sourceNode ? `提取自 #${sourceNode.id} (${sourceNode.title || ''})` : '用户摘录实证',
      x: posX,
      y: posY
    };

    graph.nodes.push(newMat);
    if (sourceNode) {
      graph.edges.push({
        id: `e_${newId}_${sourceNode.id}`,
        source: newId,
        target: sourceNode.id,
        kind: 'dashed'
      });
    }

    saveGraph();
    renderNodes();
    requestAnimationFrame(() => renderEdges());
    selectNode(newId);
    updateStatus(`已将划选文本存为新文献实证 #${newId}`);
  };

  // 点击空白或滚动时隐藏
  window.addEventListener('mousedown', (e) => {
    if (!toolbar.contains(e.target)) {
      toolbar.style.display = 'none';
    }
  });

  window.addEventListener('scroll', () => {
    toolbar.style.display = 'none';
  }, true);
}

// 打开单卡片沉浸式全屏学术阅读
function openCardFullscreen(node) {
  const modal = document.getElementById('card-modal');
  if (!modal) return;

  const kindNames = {
    material: '文献实证',
    question: '探索课题',
    conclusion: '综合结论'
  };

  const badgeEl = document.getElementById('modal-card-badge');
  badgeEl.className = `node-badge badge-${node.kind}`;
  badgeEl.innerText = kindNames[node.kind] || node.kind;

  document.getElementById('modal-card-title').innerText = node.title || '学术节点详情';
  document.getElementById('modal-card-id').innerText = `#${node.id}`;

  const bodyEl = document.getElementById('modal-card-body');
  if (node.kind === 'material') {
    bodyEl.innerHTML = `
      <blockquote style="font-size: 15px; line-height: 1.8; color: #a7f3d0; border-left: 4px solid #34d399; padding-left: 14px; background: rgba(16, 185, 129, 0.08); border-radius: 0 8px 8px 0;">
        ${renderMarkdown(node.excerpt || node.content || '')}
      </blockquote>
      ${node.citation ? `<div class="citation-chip" style="margin-top: 16px; font-size: 12.5px; padding: 4px 12px;">📖 证据出处: ${escapeHtml(node.citation)}</div>` : ''}
    `;
  } else {
    bodyEl.innerHTML = `
      <div style="background: rgba(99, 102, 241, 0.08); border-left: 4px solid #6366f1; border-radius: 0 8px 8px 0; padding: 14px 18px; margin-bottom: 20px;">
        <div style="font-size: 11px; font-weight: 600; color: #a5b4fc; text-transform: uppercase; margin-bottom: 6px;">探索课题 / 问题假设 (Question)</div>
        <div style="font-size: 15px; font-weight: 600; color: var(--text-primary); line-height: 1.55;">${renderMarkdown(node.question || '')}</div>
      </div>
      <div style="font-size: 11px; font-weight: 600; color: #94a3b8; text-transform: uppercase; margin-bottom: 10px; display: flex; justify-content: space-between; align-items: center;">
        <span>大模型严密推演与学术论证 (Response)</span>
        ${node.status === 'done' ? '<span style="color: #34d399;">● 推演已完成</span>' : '<span style="color: #f59e0b;">● 待生成</span>'}
      </div>
      <div class="markdown-body" style="font-size: 13.5px; line-height: 1.75;">
        ${node.response ? renderMarkdown(node.response) : '<p style="color: #64748b; font-style: italic;">(该节点暂未生成解答，可在右侧审查器中调用 Gemini 3.8 进行推演)</p>'}
      </div>
    `;
  }

  // 拓扑因果关系追踪
  const incomingEdges = graph.edges.filter(e => e.target === node.id);
  const outgoingEdges = graph.edges.filter(e => e.source === node.id);
  const topoEl = document.getElementById('modal-card-topology');
  topoEl.innerHTML = `
    <span><strong>连入上游依赖:</strong> ${incomingEdges.length > 0 ? incomingEdges.map(e => `<code>#${e.source}</code>`).join('、') : '<span style="color:#64748b">无 (图根节点)</span>'}</span>
    <span><strong>流向下游节点:</strong> ${outgoingEdges.length > 0 ? outgoingEdges.map(e => `<code>#${e.target}</code>`).join('、') : '<span style="color:#64748b">无 (图叶节点)</span>'}</span>
  `;

  // 复制卡片全文
  document.getElementById('modal-btn-copy').onclick = () => {
    const fullText = `# ${node.title || node.id}\n\n` +
      (node.question ? `**课题问题**: ${node.question}\n\n` : '') +
      (node.excerpt ? `> ${node.excerpt}\n\n出处: ${node.citation || ''}\n\n` : '') +
      (node.response ? `### 推演结论\n\n${node.response}` : '');
    navigator.clipboard.writeText(fullText);
    alert("已将卡片 Markdown 全文复制到剪贴板！");
  };

  modal.style.display = 'flex';
}

// Sugiyama 拓扑自动分层排布（一键理牌与防重叠）
function applySugiyamaLayout(autoFit = true) {
  if (!graph.nodes || graph.nodes.length === 0) {
    updateStatus("当前画布无节点可整理");
    return;
  }
  updateStatus("正在执行 Sugiyama 拓扑自动分层排布...");

  const domHeightsMap = {};
  graph.nodes.forEach(n => {
    const el = document.querySelector(`.node[data-id="${n.id}"]`);
    if (el) {
      domHeightsMap[n.id] = el.offsetHeight;
    }
  });

  const layoutResult = calculateSugiyamaLayout(graph.nodes, graph.edges, {
    nodeWidth: 360,
    hGap: 140,
    vGap: 38,
    startX: 60,
    startY: 60,
    domHeightsMap
  });

  const positions = layoutResult.positions;
  graph.nodes.forEach(n => {
    const pos = positions[n.id];
    if (pos) {
      n.x = pos.x;
      n.y = pos.y;
      const el = document.querySelector(`.node[data-id="${n.id}"]`);
      if (el) {
        el.classList.add('smooth-moving');
        el.style.left = `${n.x}px`;
        el.style.top = `${n.y}px`;
      }
    }
  });

  let startAnimTime = performance.now();
  function animateEdges() {
    renderEdges();
    if (performance.now() - startAnimTime < 380) {
      requestAnimationFrame(animateEdges);
    } else {
      document.querySelectorAll('.node.smooth-moving').forEach(el => el.classList.remove('smooth-moving'));
      renderEdges();
      saveGraph();
      if (autoFit) fitView();
      updateStatus("✨ 拓扑已自动规整为因果分层网络！");
    }
  }
  requestAnimationFrame(animateEdges);
}

// 自动全景居中适配视口（防右侧抽屉遮挡）
function fitView() {
  if (!graph.nodes || graph.nodes.length === 0) return;
  const isDrawerOpen = drawer.classList.contains('open');
  const drawerW = isDrawerOpen ? 440 : 0;
  const availW = window.innerWidth - drawerW - 60;
  const availH = window.innerHeight - 54 - 60;

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  graph.nodes.forEach(n => {
    minX = Math.min(minX, n.x);
    minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x + 360);
    maxY = Math.max(maxY, n.y + 240);
  });

  const graphW = Math.max(100, maxX - minX);
  const graphH = Math.max(100, maxY - minY);

  const scaleX = availW / graphW;
  const scaleY = availH / graphH;
  zoom = Math.min(Math.max(Math.min(scaleX, scaleY), 0.45), 1.0);

  pan.x = 30 - minX * zoom + Math.max(0, (availW - graphW * zoom) / 2);
  pan.y = 20 - minY * zoom + Math.max(0, (availH - graphH * zoom) / 2);

  world.style.transform = `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`;
  updateZoomIndicator();
  renderEdges();
}

function updateZoomIndicator() {
  const el = document.getElementById('zoom-indicator');
  if (el) el.innerText = `${Math.round(zoom * 100)}%`;
}

function deleteNode(id) {
  if (confirm(`确定删除节点 #${id} 吗？`)) {
    graph.nodes = graph.nodes.filter(n => n.id !== id);
    graph.edges = graph.edges.filter(e => e.source !== id && e.target !== id);
    if (selectedNodeId === id) selectedNodeId = null;
    saveGraph();
    renderNodes();
    requestAnimationFrame(() => renderEdges());
  }
}

function deleteEdge(id) {
  graph.edges = graph.edges.filter(e => e.id !== id);
  saveGraph();
  renderEdges();
  if (selectedNodeId) updateContextInspector();
  updateStatus("连线已剪除，上下文已物理阻断！");
}

function updateStatus(text) {
  const el = document.getElementById('status-text');
  if (el) el.innerText = text;
}

function renderMarkdown(text) {
  if (!text) return '';

  const mathTokens = [];

  // 1. 提取并预渲染块级公式: $$...$$ 或 \[...\]
  let processed = text
    .replace(/\$\$([\s\S]+?)\$\$/g, (match, expr) => {
      const id = `@@KATEXDISP${mathTokens.length}@@`;
      let rendered = match;
      if (window.katex) {
        try {
          rendered = `<div class="math-display">${window.katex.renderToString(expr.trim(), { displayMode: true, throwOnError: false })}</div>`;
        } catch (e) {
          console.warn(e);
        }
      }
      mathTokens.push({ id, html: rendered });
      return id;
    })
    .replace(/\\\[([\s\S]+?)\\\]/g, (match, expr) => {
      const id = `@@KATEXDISP${mathTokens.length}@@`;
      let rendered = match;
      if (window.katex) {
        try {
          rendered = `<div class="math-display">${window.katex.renderToString(expr.trim(), { displayMode: true, throwOnError: false })}</div>`;
        } catch (e) {
          console.warn(e);
        }
      }
      mathTokens.push({ id, html: rendered });
      return id;
    });

  // 2. 提取并预渲染行内公式: $...$ 或 \(...\)
  processed = processed
    .replace(/\\\(([\s\S]+?)\\\)/g, (match, expr) => {
      const id = `@@KATEXINL${mathTokens.length}@@`;
      let rendered = match;
      if (window.katex) {
        try {
          rendered = window.katex.renderToString(expr.trim(), { displayMode: false, throwOnError: false });
        } catch (e) {
          console.warn(e);
        }
      }
      mathTokens.push({ id, html: rendered });
      return id;
    })
    .replace(/(?<!\\)\$([^\$\n]+?)(?<!\\)\$/g, (match, expr) => {
      // 过滤纯货币符号（如 $100）
      if (/^\s*\d+([.,]\d+)?\s*$/.test(expr)) return match;
      const id = `@@KATEXINL${mathTokens.length}@@`;
      let rendered = match;
      if (window.katex) {
        try {
          rendered = window.katex.renderToString(expr.trim(), { displayMode: false, throwOnError: false });
        } catch (e) {
          console.warn(e);
        }
      }
      mathTokens.push({ id, html: rendered });
      return id;
    });

  // 3. 执行 marked Markdown 解析（@@...@@ 绝不会被 marked 误判为粗体或斜体）
  let html = processed;
  if (window.marked && typeof window.marked.parse === 'function') {
    try {
      html = window.marked.parse(processed, {
        breaks: true,
        gfm: true
      });
    } catch (e) {
      console.warn("Markdown parse error:", e);
      html = escapeHtml(processed).replace(/\n/g, '<br/>');
    }
  } else {
    html = escapeHtml(processed).replace(/\n/g, '<br/>');
  }

  // 4. 将预渲染好的 KaTeX 纯净 HTML 节点安全还原回流
  mathTokens.forEach(({ id, html: mathHtml }) => {
    html = html.split(id).join(mathHtml);
  });

  return html;
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

init();
