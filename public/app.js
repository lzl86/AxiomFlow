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
  model: "deepseek-ai/DeepSeek-V4-Pro",
  vision_model: "Qwen/Qwen2.5-VL-72B-Instruct",
  temperature: 0.3
};

function formatModelStatusText(conf) {
  const model = conf.model || 'deepseek-ai/DeepSeek-V4-Pro';
  const shortModel = model.includes('/') ? model.split('/').pop() : model;
  const vision = conf.vision_model;
  if (vision) {
    const shortVision = vision.includes('/') ? vision.split('/').pop() : vision;
    return `就绪 · 推理: ${shortModel} | 视觉: ${shortVision}`;
  }
  return `就绪 · 模型: ${shortModel}`;
}

// 画布视口平移与缩放（默认以 0.8 全景视角舒适展开，避免重叠卡片）
let pan = { x: 30, y: 20 };
let zoom = 0.8;
let isPanning = false;
let startPan = { x: 0, y: 0 };

// 拖拽与连线临时状态
let draggingNodeId = null;
let dragOffset = { x: 0, y: 0 };
let dragStartPos = { x: 0, y: 0 };
let isActuallyDragging = false;
let connectingSourceId = null;
let tempMousePos = { x: 0, y: 0 };
let unpluggingState = null; // 下游断线/拔除临时交互状态

// 拓扑图历史快照栈 (为连线剪除与节点调整提供 Ctrl+Z 毫秒级复原，杜绝突兀弹窗)
const graphHistory = [];
const MAX_GRAPH_HISTORY = 30;

function pushGraphHistory() {
  try {
    graphHistory.push(JSON.stringify({
      nodes: graph.nodes,
      edges: graph.edges
    }));
    if (graphHistory.length > MAX_GRAPH_HISTORY) graphHistory.shift();
  } catch (e) {
    console.warn('保存历史快照失败:', e);
  }
}

function undoGraph() {
  if (graphHistory.length === 0) {
    showToastNotification("已是最初状态，无更多可撤销操作");
    return;
  }
  const snapshotJson = graphHistory.pop();
  try {
    const snapshot = JSON.parse(snapshotJson);
    graph.nodes = snapshot.nodes || [];
    graph.edges = snapshot.edges || [];
    saveGraph();
    renderNodes();
    requestAnimationFrame(() => renderEdges());
    if (selectedNodeId) updateContextInspector();
    showToastNotification("↩️ 已成功撤销上一步操作 (连线与拓扑已复原)");
  } catch (err) {
    console.error('撤销失败:', err);
  }
}

// 统一非阻塞轻量 Toast 通知条与快速撤销通道
function showToastNotification(htmlText, onUndo = null) {
  let toast = document.getElementById('axiom-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'axiom-toast';
    document.body.appendChild(toast);
  }

  toast.innerHTML = `
    <div style="display: flex; align-items: center; gap: 12px;">
      <span>${htmlText}</span>
      ${onUndo ? `<button id="btn-toast-undo" style="background: rgba(99,102,241,0.25); border: 1px solid #818cf8; color: #c7d2fe; font-size: 11px; padding: 3px 8px; border-radius: 4px; cursor: pointer; transition: background 0.15s;">↩️ 撤销 (Ctrl+Z)</button>` : ''}
    </div>
  `;
  toast.className = 'axiom-toast show';

  if (onUndo) {
    const undoBtn = document.getElementById('btn-toast-undo');
    if (undoBtn) {
      undoBtn.onclick = (e) => {
        e.stopPropagation();
        onUndo();
        toast.className = 'axiom-toast';
      };
    }
  }

  toast.onmouseenter = () => clearTimeout(toast._hideTimer);
  toast.onmouseleave = () => {
    clearTimeout(toast._hideTimer);
    toast._hideTimer = setTimeout(() => { toast.className = 'axiom-toast'; }, 3000);
  };

  clearTimeout(toast._hideTimer);
  toast._hideTimer = setTimeout(() => {
    toast.className = 'axiom-toast';
  }, 7000);
}

// 概念询问上下文缓存
let inquiryParentNode = null;
let neighborhoodActiveContext = null;

const world = document.getElementById('canvas-world');
const svgEdges = document.getElementById('svg-edges');
const nodesContainer = document.getElementById('nodes-container');
const drawer = document.getElementById('drawer');
const inquiryModal = document.getElementById('inquiry-modal');
const settingsModal = document.getElementById('settings-modal');

// 初始化
async function init() {
  initTheme();
  setupEventListeners();
  initSelectionToolbar();
  updateZoomIndicator();
  await loadConfig();
  await loadSessions();
  await loadGraph();
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
    updateStatus(formatModelStatusText(currentConfig));
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

// 轮询检查后端变动 (保护用户交互状态，绝不在拖拽/输入时强行刷掉 DOM)
function startVersionPolling() {
  setInterval(async () => {
    try {
      if (draggingNodeId || isPanning || connectingSourceId) return;
      const activeEl = document.activeElement;
      if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA')) return;

      const res = await fetch(`/api/version?sessionId=${encodeURIComponent(currentSessionId)}`);
      const data = await res.json();
      if (lastMtime && data.mtime > lastMtime) {
        lastMtime = data.mtime;
        const oldNodeIds = new Set(graph.nodes.map(n => n.id));
        const resG = await fetch(`/api/graph?sessionId=${encodeURIComponent(currentSessionId)}`);
        const newGraph = await resG.json();
        graph = newGraph;
        renderNodes();
        requestAnimationFrame(() => renderEdges());
        if (selectedNodeId) updateContextInspector();
        loadSessionsListOnly();

        // 为新引入的硬件探针或源码实证注入 1.5 秒科技感光晕脉冲
        const newProbes = graph.nodes.filter(n => !oldNodeIds.has(n.id) && n.kind === 'hardware_probe');
        if (newProbes.length > 0) {
          setTimeout(() => {
            newProbes.forEach(np => {
              const el = document.querySelector(`.node[data-id="${np.id}"]`);
              if (el) {
                el.classList.add('probe-halo');
                setTimeout(() => el.classList.remove('probe-halo'), 3600);
              }
            });
            updateStatus(`检测到外部 GDB 硬件探针入图: ${newProbes[0].title || newProbes[0].id}`);
          }, 80);
        }
      } else if (!lastMtime) {
        lastMtime = data.mtime;
      }
    } catch (e) {
      // 忽略轮询网络抖动
    }
  }, 800);
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
  if (node.width) {
    div.style.width = `${node.width}px`;
  }

  const kindNames = {
    question: '探索课题',
    material: '文献实证',
    conclusion: '综合结论',
    source_code: '源码实证',
    hardware_probe: '硬件探针'
  };

  let statusBadge = '';
  if (isGenerating) {
    statusBadge = `<span style="color: #38bdf8; font-size: 11px;">推理中</span>`;
  } else if (node.status === 'pending') {
    statusBadge = `<span style="color: #f59e0b; font-size: 11px;">待生成</span>`;
  }

  const incomingCount = (graph.edges || []).filter(e => e.target === node.id).length;
  const inPortTitle = incomingCount > 0
    ? `流入依赖 (${incomingCount} 条) · 点击管理断线，或按住向左拖出以拔除连线`
    : `上下文流入 (在此释放连线)`;
  const inPortClass = incomingCount > 0 ? 'port in has-incoming' : 'port in';

  const anchorBadgeHtml = node.source_anchor ? `
    <div class="node-source-anchor-badge" onclick="window.jumpToNodeSourceAnchor('${node.id}', event)" title="点击直达文献原文物理页码并高亮切片">
      [${node.source_anchor.doc_name ? escapeHtml(node.source_anchor.doc_name).slice(0, 14) + '... · ' : ''}P.${node.source_anchor.page_range ? (node.source_anchor.page_range[0] + '-' + node.source_anchor.page_range[1]) : (node.source_anchor.target_page || '')} · 跳转查阅]
    </div>
  ` : '';

  div.innerHTML = `
    <div class="${inPortClass}" data-port="in" data-node="${node.id}" title="${inPortTitle}"></div>
    <div class="port out" data-port="out" data-node="${node.id}" title="上下文流出 (按住拖拽连线)"></div>
    <div class="node-header">
      <div class="node-title-group">
        <span class="node-badge badge-${node.kind}">${kindNames[node.kind] || node.kind}</span>
        <span class="node-title">${escapeHtml(node.title || '未命名节点')}</span>
      </div>
      <div style="display: flex; align-items: center; gap: 4px;">
        ${statusBadge}
        <button class="node-btn-icon node-btn-width" title="一键宽屏展开 / 恢复紧凑 (↔)">↔</button>
        <button class="node-btn-icon node-btn-expand" title="全屏学术阅读 (双击卡片也可进入)">⛶</button>
        <button class="node-btn-icon node-btn-del" title="删除节点">✕</button>
      </div>
    </div>
    <div class="node-content">
      ${node.kind === 'material' 
        ? `${node.imageUrl ? `<div style="margin-bottom: 8px; text-align: center; background: #ffffff; padding: 4px; border-radius: 5px; border: 1px solid rgba(255,255,255,0.2); box-shadow: 0 2px 8px rgba(0,0,0,0.5);"><img src="${node.imageUrl}" style="max-width: 100%; max-height: 180px; object-fit: contain; display: block; margin: 0 auto;" alt="原版公式切片"></div>` : ''}
           ${node.ocrStatus === 'pending' ? `<div style="font-size: 11px; color: #38bdf8; margin-bottom: 6px; display: flex; align-items: center; justify-content: space-between; background: rgba(56, 189, 248, 0.1); padding: 3px 6px; border-radius: 4px; border: 1px dashed rgba(56, 189, 248, 0.4);"><span>正在反编译公式...</span><button onclick="retryOcrFormula('${node.id}', event)" class="btn" style="padding: 1px 6px; font-size: 10px; background: rgba(56, 189, 248, 0.2); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.5);" title="若时间过长可点击重试">重试</button></div>` : ''}
           ${node.ocrStatus === 'failed' ? `<div style="font-size: 11px; color: #f87171; margin-bottom: 6px; display: flex; align-items: center; justify-content: space-between; background: rgba(239, 68, 68, 0.1); padding: 3px 6px; border-radius: 4px; border: 1px dashed rgba(239, 68, 68, 0.4);"><span>反编译未完成</span><button onclick="retryOcrFormula('${node.id}', event)" class="btn" style="padding: 1px 6px; font-size: 10px; background: rgba(239, 68, 68, 0.2); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.5);">重新解析</button></div>` : ''}
           <blockquote>${renderMarkdown(node.excerpt || node.content || '')}</blockquote>
           ${node.citation ? `<div class="citation-chip">出处: ${escapeHtml(node.citation)}</div>` : ''}`
        : node.kind === 'source_code'
        ? `<div class="code-block-wrapper" style="margin-top: 0; margin-bottom: 6px;">
             <div class="code-block-header">
               <span class="code-lang-tag">${escapeHtml((node.language || 'c').toUpperCase())}</span>
               <button class="code-copy-btn" onclick="copySnippetText('${node.id}', event)">复制</button>
             </div>
             <pre class="code-pre" style="max-height: 180px;">${highlightCode(node.code || node.content || '', node.language || 'c')}</pre>
           </div>
           ${node.citation ? `<div class="citation-chip">出处: ${escapeHtml(node.citation)}</div>` : ''}`
        : node.kind === 'hardware_probe'
        ? `${node.location ? `<div class="probe-loc-badge">断点: ${escapeHtml(node.location)}</div>` : ''}
           <div class="probe-grid-label"><span>16 通用寄存器快照</span><span style="color: #64748b; font-size: 10px;">x86-64</span></div>
           <div class="reg-grid" style="margin-bottom: 6px;">
             ${renderRegistersHtml(node.registers)}
           </div>
           ${node.disassembly ? `
             <div class="probe-grid-label"><span>反汇编指令流 ($pc)</span></div>
             <div class="disasm-box">${formatDisassemblyHtml(node.disassembly)}</div>
           ` : ''}
           ${node.notes ? `<div style="font-size: 11px; color: #94a3b8; margin-top: 6px; font-style: italic;">备注: ${escapeHtml(node.notes)}</div>` : ''}`
        : `${anchorBadgeHtml}
           <div class="card-question-text" style="font-weight: 600; color: var(--text-primary); line-height: 1.45; cursor: text;" title="点击可直接在右侧面板编辑问题">${renderMarkdown(node.question || '<em>(点击在此输入具体科研问题...)</em>')}</div>
           <div class="markdown-body" style="margin-top: 8px;">${isGenerating ? '<span style="color: #38bdf8;">模型正在深度严密推演中...</span>' : renderMarkdown(node.response || '(点击右侧请求生成)')}</div>`
      }
    </div>
    <div class="node-footer">
      <span>${node.kind === 'material' ? '客观事实锚点' : (node.kind === 'source_code' ? '源码公理锚点' : (node.kind === 'hardware_probe' ? '硬件物理快照' : '模型思考单元'))}</span>
      <div style="font-size: 10.5px; color: #64748b;">双击全屏</div>
      <div class="node-resize-handle" title="拖拽调整卡片宽度"></div>
    </div>
  `;

  // 单击选中（若点击的是问题文本，自动聚焦右侧输入框）
  div.addEventListener('click', (e) => {
    if (e.target.closest('.port, .node-btn-icon, button, a, input, textarea, select, .node-resize-handle')) return;
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
    if (e.target.closest('.port, .node-btn-icon, button, a, input, textarea, select, .node-resize-handle')) return;
    openCardFullscreen(node);
  });

  // 宽屏/紧凑切换按钮
  const widthBtn = div.querySelector('.node-btn-width');
  if (widthBtn) {
    widthBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      window.toggleNodeWidth(node.id, e);
    });
  }

  // 放大按钮
  const expandBtn = div.querySelector('.node-btn-expand');
  if (expandBtn) {
    expandBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openCardFullscreen(node);
    });
  }

  // 删除按钮
  const delBtn = div.querySelector('.node-btn-del');
  if (delBtn) {
    delBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteNode(node.id);
    });
  }

  // 自由调整卡片宽度拖拽手柄
  const resizeHandle = div.querySelector('.node-resize-handle');
  if (resizeHandle) {
    resizeHandle.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      e.preventDefault();
      const startX = e.clientX;
      const initialWidth = div.offsetWidth;
      div.style.transition = 'none';

      const onMouseMove = (moveEv) => {
        const deltaX = (moveEv.clientX - startX) / (zoom || 1);
        const newWidth = Math.max(300, Math.min(960, Math.round(initialWidth + deltaX)));
        div.style.width = newWidth + 'px';
        node.width = newWidth;
        updateConnectedEdges(node.id);
      };

      const onMouseUp = () => {
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
        div.style.transition = '';
        updateConnectedEdges(node.id);
        saveGraph();
      };

      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
    });
  }

  // 节点拖拽
  div.addEventListener('mousedown', (e) => {
    if (e.target.closest('.port, .node-btn-icon, button, a, input, textarea, select, .node-resize-handle')) return;
    draggingNodeId = node.id;
    dragStartPos = { x: e.clientX, y: e.clientY };
    isActuallyDragging = false;
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

// 渲染 SVG 连线 (结构变动时调用)
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
    <!-- 专用临时拖拽连线（避免频繁 DOM 创建与销毁） -->
    <path id="temp-connecting-path" class="edge-path" style="stroke: #38bdf8; stroke-dasharray: 5 5; pointer-events: none; display: none;"></path>
    <!-- 专用临时反向拔除/断线连线 -->
    <path id="temp-disconnecting-path" class="edge-path" style="stroke: #f43f5e; stroke-dasharray: 6 5; stroke-width: 3.2px; pointer-events: none; display: none; filter: drop-shadow(0 0 10px rgba(244, 63, 94, 0.85));"></path>
  `;

  (graph.edges || []).forEach(edge => {
    const sourceNode = graph.nodes.find(n => n.id === edge.source);
    const targetNode = graph.nodes.find(n => n.id === edge.target);
    if (!sourceNode || !targetNode) return;

    const start = getPortCenter(edge.source, true);
    const end = getPortCenter(edge.target, false);
    const pathD = calculateBezierPath(start.x, start.y, end.x, end.y);

    const isDashed = edge.kind === 'dashed';
    const marker = isDashed ? 'url(#arrow-dashed)' : 'url(#arrow)';

    const hitPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
    hitPath.setAttribute("d", pathD);
    hitPath.setAttribute("class", "edge-hitarea");
    hitPath.dataset.edgeId = edge.id;
    hitPath.dataset.source = edge.source;
    hitPath.dataset.target = edge.target;
    hitPath.dataset.id = edge.id;

    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", pathD);
    path.setAttribute("class", `edge-path ${isDashed ? 'dashed' : ''}`);
    path.setAttribute("marker-end", marker);
    path.dataset.edgeId = edge.id;
    path.dataset.source = edge.source;
    path.dataset.target = edge.target;
    path.dataset.id = edge.id;
    path.title = "点击直接剪断此依赖连线 (或在下游端口拔除)";

    // 鼠标悬停高亮同步
    hitPath.addEventListener("mouseenter", () => path.classList.add("edge-hover"));
    hitPath.addEventListener("mouseleave", () => path.classList.remove("edge-hover"));

    // 点击直接剪断（彻底根除突兀的原生 confirm 弹窗，支持 Ctrl+Z 毫秒级复原）
    hitPath.addEventListener("click", (e) => {
      e.stopPropagation();
      const sNode = graph.nodes.find(n => n.id === edge.source);
      const tNode = graph.nodes.find(n => n.id === edge.target);
      const sTitle = sNode ? (sNode.title || sNode.id) : edge.source;
      const tTitle = tNode ? (tNode.title || tNode.id) : edge.target;
      deleteEdge(edge.id);
      showToastNotification(`已剪断依赖：<strong>${escapeHtml(sTitle)}</strong> ➔ <strong>${escapeHtml(tTitle)}</strong>`, () => {
        undoGraph();
      });
    });

    svgEdges.appendChild(hitPath);
    svgEdges.appendChild(path);
  });

  if (connectingSourceId) {
    updateTempConnectingEdge();
  }
  if (unpluggingState && unpluggingState.isDragging) {
    updateDisconnectingEdge();
  }

  // 同步刷新各节点流入端口的连线状态与提示
  const targetCounts = {};
  (graph.edges || []).forEach(e => {
    targetCounts[e.target] = (targetCounts[e.target] || 0) + 1;
  });
  document.querySelectorAll('.port.in').forEach(p => {
    const nid = p.dataset.node;
    const count = targetCounts[nid] || 0;
    if (count > 0) {
      p.classList.add('has-incoming');
      p.title = `流入依赖 (${count} 条) · 点击管理断线，或按住向左拖出以拔除连线`;
    } else {
      p.classList.remove('has-incoming');
      p.title = '上下文流入 (在此释放连线)';
    }
  });

  // 保持当前选中的拓扑高亮状态
  if (selectedNodeId) {
    applyTopologyFocus(selectedNodeId);
  }
}

// 增量高效更新关联连线 (拖拽节点时 0 DOM 销毁，纯属性赋值，极速 120Hz 丝滑)
function updateConnectedEdges(nodeId) {
  if (!graph.edges || graph.edges.length === 0) return;

  for (let i = 0; i < graph.edges.length; i++) {
    const edge = graph.edges[i];
    if (edge.source === nodeId || edge.target === nodeId) {
      const start = getPortCenter(edge.source, true);
      const end = getPortCenter(edge.target, false);
      const pathD = calculateBezierPath(start.x, start.y, end.x, end.y);

      const hitPath = svgEdges.querySelector(`.edge-hitarea[data-edge-id="${edge.id}"]`);
      if (hitPath) hitPath.setAttribute("d", pathD);

      const path = svgEdges.querySelector(`.edge-path[data-edge-id="${edge.id}"]`);
      if (path) path.setAttribute("d", pathD);
    }
  }
}

// 增量更新临时连接线 (0 DOM 销毁)
function updateTempConnectingEdge() {
  const tempPath = document.getElementById('temp-connecting-path');
  if (!tempPath) return;

  if (connectingSourceId) {
    const start = getPortCenter(connectingSourceId, true);
    const pathD = calculateBezierPath(start.x, start.y, tempMousePos.x, tempMousePos.y);
    tempPath.setAttribute("d", pathD);
    tempPath.style.display = "block";
  } else {
    tempPath.style.display = "none";
  }
}

// 增量更新从下游拔除/断开连线的动态路径
function updateDisconnectingEdge() {
  const discPath = document.getElementById('temp-disconnecting-path');
  if (!discPath) return;

  if (unpluggingState && unpluggingState.isDragging) {
    let startX, startY;
    if (unpluggingState.pulledEdge) {
      // 只有一条入边时：从上游端口拔出悬空连线，末端跟随光标游动
      const sPt = getPortCenter(unpluggingState.pulledEdge.source, true);
      startX = sPt.x;
      startY = sPt.y;
    } else {
      // 多条入边时：从下游流入端口射出红色剪断激光线
      const tPt = getPortCenter(unpluggingState.targetId, false);
      startX = tPt.x;
      startY = tPt.y;
    }
    const pathD = calculateBezierPath(startX, startY, tempMousePos.x, tempMousePos.y);
    discPath.setAttribute("d", pathD);
    discPath.style.display = "block";
  } else {
    discPath.style.display = "none";
  }
}

function hideDisconnectingEdge() {
  const discPath = document.getElementById('temp-disconnecting-path');
  if (discPath) discPath.style.display = 'none';
  document.querySelectorAll('.edge-path.unplugging').forEach(el => el.classList.remove('unplugging'));
}

// 拓扑因果聚焦高亮算法 (拓扑降噪与上下文流视效)
function applyTopologyFocus(nodeId) {
  if (!nodeId) {
    document.querySelectorAll('.node').forEach(el => {
      el.classList.remove('topo-focus', 'topo-dim', 'selected');
    });
    document.querySelectorAll('.edge-path').forEach(el => {
      el.classList.remove('topo-focus', 'topo-dim');
    });
    return;
  }

  // 广度优先搜索：计算上游因果链路与下游依赖链路
  const upstream = new Set();
  const downstream = new Set();

  const queueUp = [nodeId];
  while (queueUp.length > 0) {
    const curr = queueUp.shift();
    (graph.edges || []).forEach(e => {
      if (e.target === curr && !upstream.has(e.source) && e.source !== nodeId) {
        upstream.add(e.source);
        queueUp.push(e.source);
      }
    });
  }

  const queueDown = [nodeId];
  while (queueDown.length > 0) {
    const curr = queueDown.shift();
    (graph.edges || []).forEach(e => {
      if (e.source === curr && !downstream.has(e.target) && e.target !== nodeId) {
        downstream.add(e.target);
        queueDown.push(e.target);
      }
    });
  }

  const focusedNodes = new Set([nodeId, ...upstream, ...downstream]);

  document.querySelectorAll('.node').forEach(el => {
    const nid = el.dataset.id;
    if (nid === nodeId) {
      el.classList.add('selected', 'topo-focus');
      el.classList.remove('topo-dim');
    } else if (focusedNodes.has(nid)) {
      el.classList.add('topo-focus');
      el.classList.remove('topo-dim', 'selected');
    } else {
      el.classList.remove('topo-focus', 'selected');
      el.classList.add('topo-dim');
    }
  });

  document.querySelectorAll('.edge-path').forEach(el => {
    const s = el.dataset.source;
    const t = el.dataset.target;
    if (s && t && focusedNodes.has(s) && focusedNodes.has(t)) {
      el.classList.add('topo-focus');
      el.classList.remove('topo-dim');
    } else {
      el.classList.remove('topo-focus');
      el.classList.add('topo-dim');
    }
  });
}

// 选中节点
function selectNode(id) {
  selectedNodeId = id;
  applyTopologyFocus(id);
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
        <span style="font-size: 11px; font-weight: 700; color: #818cf8; text-transform: uppercase;">课题即时编辑</span>
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
      ` : node.kind === 'source_code' ? `
        <div style="margin-bottom: 10px;">
          <label style="font-size: 11px; font-weight: 600; color: #94a3b8; display: block; margin-bottom: 4px;">编程语言：</label>
          <select id="node-edit-lang" class="inquiry-textarea" style="height: 32px; font-size: 12px; color: #38bdf8; font-weight: 600;">
            <option value="c" ${(node.language || 'c') === 'c' ? 'selected' : ''}>C / C++</option>
            <option value="assembly" ${(node.language || '') === 'assembly' ? 'selected' : ''}>x86-64 汇编 (Assembly)</option>
            <option value="python" ${(node.language || '') === 'python' ? 'selected' : ''}>Python</option>
            <option value="bash" ${(node.language || '') === 'bash' ? 'selected' : ''}>Shell / Bash</option>
            <option value="rust" ${(node.language || '') === 'rust' ? 'selected' : ''}>Rust</option>
            <option value="verilog" ${(node.language || '') === 'verilog' ? 'selected' : ''}>Verilog / 数字逻辑</option>
            <option value="other" ${(node.language || '') === 'other' ? 'selected' : ''}>其它语言</option>
          </select>
        </div>
        <div style="margin-bottom: 10px;">
          <label style="font-size: 11px; font-weight: 600; color: #94a3b8; display: block; margin-bottom: 4px;">源码正文：</label>
          <textarea id="node-edit-code" class="inquiry-textarea" rows="7" style="font-family: 'JetBrains Mono', 'Consolas', monospace; font-size: 11.5px; white-space: pre; line-height: 1.45;" placeholder="输入或修改源码...">${escapeHtml(node.code || node.content || '')}</textarea>
        </div>
        <div>
          <label style="font-size: 11px; font-weight: 600; color: #94a3b8; display: block; margin-bottom: 4px;">源码出处标签：</label>
          <input id="node-edit-citation" type="text" class="inquiry-textarea" style="height: 32px; font-size: 12px;" value="${escapeHtml(node.citation || '')}" placeholder="如: CS:APP3e 第 8.5.6 节 p.534">
        </div>
      ` : node.kind === 'hardware_probe' ? `
        <div style="margin-bottom: 8px;">
          <label style="font-size: 11px; font-weight: 600; color: #94a3b8; display: block; margin-bottom: 4px;">断点源码位置：</label>
          <input id="node-edit-location" type="text" class="inquiry-textarea" style="height: 32px; font-size: 12px;" value="${escapeHtml(node.location || '')}" placeholder="如: eval.c:28 (0x400da2)">
        </div>
        <div style="margin-bottom: 8px;">
          <label style="font-size: 11px; font-weight: 600; color: #94a3b8; display: block; margin-bottom: 4px;">断点调试备注：</label>
          <input id="node-edit-notes" type="text" class="inquiry-textarea" style="height: 32px; font-size: 12px;" value="${escapeHtml(node.notes || '')}">
        </div>
        <div>
          <label style="font-size: 11px; font-weight: 600; color: #94a3b8; display: block; margin-bottom: 4px;">反汇编指令流：</label>
          <textarea id="node-edit-disasm" class="inquiry-textarea" rows="4" style="font-family: 'JetBrains Mono', 'Consolas', monospace; font-size: 11px; white-space: pre;">${escapeHtml(node.disassembly || '')}</textarea>
        </div>
      ` : `
        <div>
          <label style="font-size: 11px; font-weight: 600; color: #94a3b8; display: block; margin-bottom: 4px;">待解答问题 / 探索指令：</label>
          <textarea id="node-edit-question" class="inquiry-textarea" rows="3" placeholder="在此输入你的具体科研问题、论证假设或推演指令...">${escapeHtml(node.question || '')}</textarea>
        </div>
      `}
    </div>

    <!-- 拓扑分流统计 -->
    <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; margin-bottom: 14px;">
      <div style="background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.25); border-radius: 8px; padding: 6px 4px; text-align: center;">
        <div style="font-size: 16px; font-weight: 700; color: #34d399;">${partition.materials.length}</div>
        <div style="font-size: 10px; color: #a7f3d0;">文献素材</div>
      </div>
      <div style="background: rgba(6, 182, 212, 0.1); border: 1px solid rgba(6, 182, 212, 0.25); border-radius: 8px; padding: 6px 4px; text-align: center;">
        <div style="font-size: 16px; font-weight: 700; color: #67e8f9;">${(partition.codes ? partition.codes.length : 0) + (partition.probes ? partition.probes.length : 0)}</div>
        <div style="font-size: 10px; color: #a5f3fc;">源码/探针</div>
      </div>
      <div style="background: rgba(99, 102, 241, 0.1); border: 1px solid rgba(99, 102, 241, 0.25); border-radius: 8px; padding: 6px 4px; text-align: center;">
        <div style="font-size: 16px; font-weight: 700; color: #818cf8;">${partition.references.length}</div>
        <div style="font-size: 10px; color: #c7d2fe;">隔离引用</div>
      </div>
      <div style="background: rgba(59, 130, 246, 0.1); border: 1px solid rgba(59, 130, 246, 0.25); border-radius: 8px; padding: 6px 4px; text-align: center;">
        <div style="font-size: 16px; font-weight: 700; color: #60a5fa;">${partition.chainTurns.length}</div>
        <div style="font-size: 10px; color: #bfdbfe;">主干轮数</div>
      </div>
    </div>

    <!-- 核心操作区（置顶优先展示，无需下滚查找） -->
    <div style="display: flex; flex-direction: column; gap: 8px; margin-bottom: 14px;">
      <button id="btn-trigger-generate" class="btn btn-primary" style="justify-content: center; padding: 10px; font-size: 13px; box-shadow: 0 4px 14px rgba(79, 70, 229, 0.4);">
        调用 ${escapeHtml(currentConfig.model)} 原地生成解答
      </button>
      
      <button id="btn-open-inquiry" class="btn" style="justify-content: center; background: rgba(16, 185, 129, 0.15); border-color: rgba(16, 185, 129, 0.4); color: #34d399; padding: 8px; font-size: 12.5px;">
        追问特定概念 / 展开新分支节点
      </button>

      ${node.imageUrl ? `
      <button id="btn-re-ocr" class="btn btn-secondary" style="justify-content: center; background: rgba(245, 158, 11, 0.15); border-color: rgba(245, 158, 11, 0.4); color: #fde68a; padding: 8px; font-size: 12.5px;" title="重新请求视觉模型解析截取图中的 LaTeX 公式与变量">
        反编译提取原图中的 LaTeX 公式与释义
      </button>
      ` : ''}
    </div>

    <div style="background: rgba(99, 102, 241, 0.08); border: 1px solid rgba(99, 102, 241, 0.2); border-radius: 6px; padding: 8px 10px; margin-bottom: 12px; font-size: 11.5px; line-height: 1.45; color: var(--text-primary);">
      <span style="color: #38bdf8; font-weight: 600;">物理拓扑隔离：</span>
      仅连入的有效祖先进入 Prompt，剪断分支在 HTTP 请求中被 100% 物理剥离。
    </div>

    <!-- 精准 Prompt 折叠查看区（小巧精悍，不挤占界面） -->
    <details open style="background: var(--bg-card); border: 1px solid var(--border-color); border-radius: 8px; padding: 10px;">
      <summary style="font-size: 12px; font-weight: 600; color: var(--text-secondary); cursor: pointer; display: flex; justify-content: space-between; align-items: center;">
        <span>接收的精准 Prompt 预估 (<span id="prompt-token-count">${compiled.estimatedTokens} tokens</span>)</span>
        <button id="btn-copy-prompt" class="btn" style="padding: 2px 8px; font-size: 10.5px;">复制纯净输入</button>
      </summary>
      <div class="prompt-preview-box" style="margin-top: 8px; max-height: 150px;">${escapeHtml(compiled.fullText)}</div>
    </details>
  `;

  // 标题实时编辑联动
  const titleInput = document.getElementById('node-edit-title');
  if (titleInput) {
    titleInput.oninput = (e) => {
      const liveNode = graph.nodes.find(n => n.id === node.id);
      if (liveNode) {
        liveNode.title = e.target.value.trim() || '未命名课题';
        const titleEl = document.querySelector(`.node[data-id="${node.id}"] .node-title`);
        if (titleEl) titleEl.innerText = liveNode.title;
      }
      debouncedSave();
    };
  }

  // 源码代码实时编辑联动
  const codeInput = document.getElementById('node-edit-code');
  if (codeInput) {
    codeInput.oninput = (e) => {
      const liveNode = graph.nodes.find(n => n.id === node.id);
      if (liveNode) {
        liveNode.code = e.target.value;
        const pre = document.querySelector(`.node[data-id="${node.id}"] .code-pre`);
        if (pre) pre.innerHTML = highlightCode(liveNode.code || '', liveNode.language || 'c');
      }
      debouncedSave();
    };
  }

  // 源码编程语言实时切换联动
  const langSelect = document.getElementById('node-edit-lang');
  if (langSelect) {
    langSelect.onchange = (e) => {
      const liveNode = graph.nodes.find(n => n.id === node.id);
      if (liveNode) {
        liveNode.language = e.target.value;
        const tag = document.querySelector(`.node[data-id="${node.id}"] .code-lang-tag`);
        if (tag) tag.innerText = (liveNode.language || 'c').toUpperCase();
        const pre = document.querySelector(`.node[data-id="${node.id}"] .code-pre`);
        if (pre) pre.innerHTML = highlightCode(liveNode.code || '', liveNode.language || 'c');
      }
      debouncedSave();
    };
  }

  // 硬件探针断点位置联动
  const locInput = document.getElementById('node-edit-location');
  if (locInput) {
    locInput.oninput = (e) => {
      const liveNode = graph.nodes.find(n => n.id === node.id);
      if (liveNode) {
        liveNode.location = e.target.value;
        const locBadge = document.querySelector(`.node[data-id="${node.id}"] .probe-loc-badge`);
        if (locBadge) locBadge.innerText = `断点: ${liveNode.location}`;
      }
      debouncedSave();
    };
  }

  // 硬件探针断点备注联动
  const notesInput = document.getElementById('node-edit-notes');
  if (notesInput) {
    notesInput.oninput = (e) => {
      const liveNode = graph.nodes.find(n => n.id === node.id);
      if (liveNode) liveNode.notes = e.target.value;
      debouncedSave();
    };
  }

  // 问题/探索指令实时编辑联动
  const questionInput = document.getElementById('node-edit-question');
  if (questionInput) {
    questionInput.oninput = (e) => {
      const liveNode = graph.nodes.find(n => n.id === node.id);
      if (liveNode) {
        liveNode.question = e.target.value;
        if (liveNode.status === 'done') {
          liveNode.status = 'pending';
        }
        const qEl = document.querySelector(`.node[data-id="${node.id}"] .card-question-text`);
        if (qEl) qEl.innerHTML = renderMarkdown(liveNode.question || '<em>(点击右侧输入问题...)</em>');
        // 实时重编译当前 Prompt 预估
        const p = partitionContext(node.id, graph.nodes, graph.edges);
        const c = compilePrompt(p);
        const promptBox = document.querySelector('.prompt-preview-box');
        if (promptBox) promptBox.innerText = c.fullText;
        const tokenSpan = document.getElementById('prompt-token-count');
        if (tokenSpan) tokenSpan.innerText = `${c.estimatedTokens} tokens`;
      }
      debouncedSave();
    };
  }

  // 文献摘录实时编辑联动
  const excerptInput = document.getElementById('node-edit-excerpt');
  if (excerptInput) {
    excerptInput.oninput = (e) => {
      const liveNode = graph.nodes.find(n => n.id === node.id);
      if (liveNode) {
        liveNode.excerpt = e.target.value;
        const bq = document.querySelector(`.node[data-id="${node.id}"] .node-content blockquote`);
        if (bq) bq.innerHTML = renderMarkdown(liveNode.excerpt || '');
      }
      debouncedSave();
    };
  }
  const citationInput = document.getElementById('node-edit-citation');
  if (citationInput) {
    citationInput.oninput = (e) => {
      const liveNode = graph.nodes.find(n => n.id === node.id);
      if (liveNode) {
        liveNode.citation = e.target.value;
        const chip = document.querySelector(`.node[data-id="${node.id}"] .citation-chip`);
        if (chip) chip.innerText = `出处: ${liveNode.citation}`;
      }
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
    btn.innerText = `正在调用 ${currentConfig.model} 深度推演中...`;
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
      updateStatus(`${currentConfig.model} 已为 #${node.id} 生成解答`);
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
  neighborhoodActiveContext = null;
  const banner = document.getElementById('inquiry-neighborhood-banner');
  if (banner) banner.style.display = 'none';

  const headingEl = document.getElementById('inquiry-modal-heading');
  if (headingEl) headingEl.innerText = '针对上游论断展开概念询问';

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
  const isNeighborhood = Boolean(neighborhoodActiveContext);
  let parentNode = inquiryParentNode;
  if (!parentNode && isNeighborhood) {
    parentNode = graph.nodes.length > 0 ? graph.nodes[0] : null;
  }
  if (!parentNode && !isNeighborhood) return;

  const textarea = document.getElementById('inquiry-question-input');
  const userQuestion = textarea.value.trim();

  if (!userQuestion) {
    alert("请输入你要询问或推演的问题！");
    return;
  }

  let newTitle = isNeighborhood ? "文献邻域研读" : "深入追问";
  const matched = userQuestion.match(/【([^】]+)】/);
  if (matched) {
    newTitle = isNeighborhood ? `邻域研读：${matched[1]}` : `概念追问：${matched[1]}`;
  } else {
    newTitle = userQuestion.slice(0, 18) + (userQuestion.length > 18 ? '...' : '');
  }

  const newId = `n_inquiry_${Date.now()}`;
  const shouldAutoAsk = document.getElementById('inquiry-auto-ask').checked;

  const posX = parentNode ? parentNode.x + 460 : 320;
  const posY = parentNode ? parentNode.y + (Math.random() * 60 - 30) : 220;

  const newNode = {
    id: newId,
    kind: 'question',
    title: newTitle,
    question: userQuestion,
    response: '',
    status: shouldAutoAsk ? 'generating' : 'idle',
    x: posX,
    y: posY
  };

  if (isNeighborhood && neighborhoodActiveContext) {
    newNode.source_anchor = {
      doc_name: neighborhoodActiveContext.doc_name,
      page_range: neighborhoodActiveContext.page_range,
      target_page: neighborhoodActiveContext.target_page,
      chapterTitle: neighborhoodActiveContext.chapterTitle
    };
  }

  graph.nodes.push(newNode);
  if (parentNode) {
    graph.edges.push({
      id: `e_${Date.now()}`,
      source: parentNode.id,
      target: newId,
      kind: 'solid'
    });
  }

  saveGraph();
  renderNodes();
  requestAnimationFrame(() => renderEdges());
  selectNode(newId);
  inquiryModal.style.display = 'none';

  const boundNeighborhoodCtx = neighborhoodActiveContext ? { ...neighborhoodActiveContext } : null;
  neighborhoodActiveContext = null;
  const banner = document.getElementById('inquiry-neighborhood-banner');
  if (banner) banner.style.display = 'none';

  if (shouldAutoAsk) {
    const partition = partitionContext(newId, graph.nodes, graph.edges);
    const compiled = compilePrompt(partition);
    updateStatus(`正在请求 ${currentConfig.model} 为新分支生成解答...`);

    try {
      const genPayload = {
        nodeId: newId,
        prompt: compiled.fullText,
        model: currentConfig.model,
        sessionId: currentSessionId
      };
      if (boundNeighborhoodCtx) {
        genPayload.neighborhood_context = boundNeighborhoodCtx;
        genPayload.source_anchor = newNode.source_anchor;
      }

      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(genPayload)
      });
      const data = await res.json();
      const liveNode = graph.nodes.find(n => n.id === newId) || newNode;
      if (data.ok) {
        liveNode.response = data.response;
        liveNode.status = 'done';
        if (data.mtime) lastMtime = data.mtime;
        updateStatus(`新分支 #${newId} 已生成`);
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

  function updateReadingProgressBar(el) {
    const line = document.getElementById('reader-progress-line');
    if (!line || !el) return;
    const maxScroll = el.scrollHeight - el.clientHeight;
    if (maxScroll <= 0) {
      line.style.width = '0%';
      return;
    }
    const pct = Math.min(100, Math.max(0, (el.scrollTop / maxScroll) * 100));
    line.style.width = `${pct}%`;
  }

  // 划词摘录监听 (Markdown 模式)
  const mdContainer = document.getElementById('paper-content');
  if (mdContainer) {
    mdContainer.onmouseup = () => {
      if (currentDocMode !== 'markdown') return;
      handleSelectionToolbar('paper-content', currentDocTitle);
    };
    mdContainer.onscroll = () => {
      saveReadingBreakpoint();
      updateReadingProgressBar(mdContainer);
    };
  }

  // PDF 划词摘录监听与滚动进度更新
  const pdfViewContainer = document.getElementById('pdf-view-container');
  if (pdfViewContainer) {
    pdfViewContainer.onmouseup = () => {
      if (currentDocMode !== 'pdf') return;
      handleSelectionToolbar('pdf-text-layer', `${currentDocTitle} (P.${currentPdfPageNum})`);
    };
    pdfViewContainer.onscroll = () => {
      updateReadingProgressBar(pdfViewContainer);
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
    opt.innerText = m.name;
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
    updateStatus(`正在上传文献《${file.name}》...`);
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
        updateStatus(`文献《${data.material.name}》已成功上传并绑定至当前课题`);
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
    treeContainer.innerHTML = '<div style="color: #64748b; padding: 12px; text-align: center;">该文献未包含书签目录，可点击右上角 [AI 骨架] 提取</div>';
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
      <div style="display: flex; align-items: center; gap: 4px; flex-shrink: 0;">
        ${item.pageNum ? `<button class="outline-item-probe" title="对该章节所在页 (P.${item.pageNum} ± 2) 执行邻域切片研读">探针</button>` : ''}
        ${item.pageNum ? `<span class="outline-page-badge">P.${item.pageNum}</span>` : ''}
      </div>
    `;

    const probeBtn = row.querySelector('.outline-item-probe');
    if (probeBtn) {
      probeBtn.onclick = (e) => {
        e.stopPropagation();
        openNeighborhoodInquiry(item.pageNum, item.title);
      };
    }

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
      <p style="margin-bottom: 8px; color: #cbd5e1;">该文献未内置书签大纲，可点击上方“AI 骨架”解析或按分页跳转：</p>
      <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 4px;">
        ${Array.from({ length: Math.min(10, Math.ceil(numPages / 10)) }, (_, i) => {
          const p = i === 0 ? 1 : i * 10;
          return `<button class="btn" style="padding: 3px 6px; font-size: 11px; justify-content: center;" onclick="window.jumpToOutlinePage(${p})">第 ${p} 页</button>`;
        }).join('')}
      </div>
    </div>
  `;
}

// 扁平大纲层级树嵌套算法
function buildNestedOutline(flatItems) {
  if (!flatItems || flatItems.length === 0) return [];
  const root = [];
  const stack = [];
  flatItems.forEach(raw => {
    const node = {
      title: raw.title ? raw.title.trim() : '未命名章节',
      pageNum: raw.page || raw.pageNum || null,
      items: []
    };
    const level = raw.level || 1;
    while (stack.length > 0 && stack[stack.length - 1].level >= level) {
      stack.pop();
    }
    if (stack.length === 0) {
      root.push(node);
    } else {
      stack[stack.length - 1].node.items.push(node);
    }
    stack.push({ level, node });
  });
  return root;
}

// 服务端原生/AI大纲骨架请求
async function requestAiOutline(aiFallback = false) {
  const treeContainer = document.getElementById('pdf-outline-tree');
  if (!treeContainer) return;
  const docSelector = document.getElementById('doc-selector');
  let docName = '';
  if (graph.activeDoc && (graph.activeDoc.name || graph.activeDoc.title)) {
    docName = graph.activeDoc.name || graph.activeDoc.title;
  }
  if (!docName && docSelector && docSelector.value) {
    docName = decodeURIComponent(docSelector.value.split('/').pop());
  }
  if (!docName) {
    updateStatus('请先在阅读器中载入文献资产');
    return;
  }
  treeContainer.innerHTML = '<div style="color: #64748b; padding: 12px; text-align: center;">正在通过服务端解析大纲骨架...</div>';
  try {
    const res = await fetch('/api/paper-outline', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ doc_name: docName, ai_fallback: aiFallback })
    });
    const data = await res.json();
    if (data.ok && data.outline && data.outline.length > 0) {
      currentPdfOutline = buildNestedOutline(data.outline);
      renderOutlineTree(currentPdfOutline);
      updateStatus(`大纲骨架已就绪 (${data.source === 'native' ? '原生书签' : (data.source === 'ai' ? 'AI 提取' : '文档结构')}, 共 ${data.outline.length} 项)`);
    } else {
      updateStatus('未能提取到大纲结构');
      if (currentPdfDoc) renderFallbackOutline(currentPdfDoc.numPages);
    }
  } catch (err) {
    console.error('提取大纲失败:', err);
    updateStatus(`提取大纲失败: ${err.message}`);
  }
}
window.requestAiOutline = requestAiOutline;

// 邻域切片学术概念快速提取
function extractConceptsFromExcerpt(text) {
  if (!text) return [];
  const found = new Set();

  const bracketMatches = text.match(/[【《“"']([^【】《》“”"'\n\r]{2,20})[】》”"']/g) || [];
  bracketMatches.forEach(m => {
    const clean = m.replace(/[【】《》“”"']/g, '').trim();
    if (clean.length >= 2 && clean.length <= 16) found.add(clean);
  });

  const symbolMatches = text.match(/\b([A-Z]{2,6}|NA|OTF|PTF|ATF|PSF|DPC|QPI|TIE|DoP)\b/g) || [];
  symbolMatches.forEach(s => found.add(s));

  const termRegex = /([\u4e00-\u9fa5]{2,8}(?:成像|调制|相衬|显微|算法|矩阵|函数|积分|滤波器|衍射|光瞳|分辨率|相位|光强|波前|色差|照明|方程|卷积|反演|层析))/g;
  let match;
  while ((match = termRegex.exec(text)) !== null) {
    if (match[1] && match[1].length >= 3 && match[1].length <= 10) {
      found.add(match[1]);
    }
  }

  const stopWords = new Set(['本章小结', '实验结果', '研究内容', '国内外研究', '主要工作', '本节介绍']);
  const result = Array.from(found).filter(item => !stopWords.has(item));
  return result.slice(0, 10);
}

// 打开“文献邻域探针研读”对话框
async function openNeighborhoodInquiry(targetPage, chapterTitle = null) {
  const docSelector = document.getElementById('doc-selector');
  let docName = '';
  if (graph.activeDoc && (graph.activeDoc.name || graph.activeDoc.title)) {
    docName = graph.activeDoc.name || graph.activeDoc.title;
  }
  if (!docName && docSelector && docSelector.value) {
    docName = decodeURIComponent(docSelector.value.split('/').pop());
  }
  if (!docName) {
    alert('请先在文献阅读器中选择或载入文献资产！');
    return;
  }
  const page = targetPage || currentPdfPageNum || 1;
  updateStatus(`正在提取文献《${docName}》第 P.${page} 页前后邻域物理切片...`);

  try {
    const res = await fetch('/api/paper-neighborhood', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        doc_name: docName,
        page: page,
        window: 2
      })
    });
    const data = await res.json();
    if (!data.ok) {
      throw new Error(data.error || '提取切片失败');
    }

    neighborhoodActiveContext = {
      doc_name: data.doc_name,
      target_page: data.target_page,
      page_range: data.page_range,
      excerpt: data.excerpt,
      char_count: data.char_count,
      total_pages: data.total_pages,
      chapterTitle: chapterTitle
    };

    const headingEl = document.getElementById('inquiry-modal-heading');
    if (headingEl) headingEl.innerText = chapterTitle ? `针对章节【${chapterTitle}】展开邻域研读` : `针对第 P.${page} 页展开邻域研读`;

    const parentTitleEl = document.getElementById('inquiry-parent-title');
    if (parentTitleEl) parentTitleEl.innerText = `文献: ${data.doc_name} · 物理切片: P.${data.page_range[0]}-${data.page_range[1]}`;

    const banner = document.getElementById('inquiry-neighborhood-banner');
    if (banner) {
      banner.style.display = 'block';
      const targetEl = document.getElementById('neighborhood-banner-target');
      if (targetEl) targetEl.innerText = `P.${data.target_page} ± 2 (P.${data.page_range[0]}-${data.page_range[1]})`;
      const charsEl = document.getElementById('neighborhood-banner-chars');
      if (charsEl) charsEl.innerText = `${data.char_count.toLocaleString()} 字符`;
      const docEl = document.getElementById('neighborhood-banner-doc');
      if (docEl) docEl.innerText = `文献: ${data.doc_name}${chapterTitle ? ' · 章节: ' + chapterTitle : ''}`;
    }

    const concepts = extractConceptsFromExcerpt(data.excerpt);
    const chipsContainer = document.getElementById('concept-chips-container');
    chipsContainer.innerHTML = '';
    if (concepts.length === 0) {
      chipsContainer.innerHTML = '<span style="font-size: 11px; color: #64748b;">(未自动提取到特征词，请在下方自由输入)</span>';
    } else {
      concepts.forEach(c => {
        const chip = document.createElement('div');
        chip.className = 'neighborhood-concept-chip';
        chip.innerText = `+ ${c}`;
        chip.title = `点击填入关于【${c}】的探针问题`;
        chip.onclick = () => {
          const textarea = document.getElementById('inquiry-question-input');
          textarea.value = `基于文献 P.${data.page_range[0]}-${data.page_range[1]} 原文切片，深入剖析【${c}】的物理机理、数学推导与实验参数。`;
          textarea.focus();
        };
        chipsContainer.appendChild(chip);
      });
    }

    const textarea = document.getElementById('inquiry-question-input');
    const defaultTopic = chapterTitle || (concepts.length > 0 ? concepts[0] : `第 P.${page} 页核心推论`);
    textarea.value = `基于文献 P.${data.page_range[0]}-${data.page_range[1]} 物理原文切片，深入剖析【${defaultTopic}】的理论推导与实验实证结论。`;

    inquiryParentNode = null;
    if (selectedNodeId) {
      const liveSelected = graph.nodes.find(n => n.id === selectedNodeId);
      if (liveSelected) inquiryParentNode = liveSelected;
    }

    inquiryModal.style.display = 'flex';
    setTimeout(() => {
      textarea.focus();
    }, 100);

    updateStatus(`邻域切片 P.${data.page_range[0]}-${data.page_range[1]} 已挂载至研读探针`);
  } catch (err) {
    console.error('获取邻域切片失败:', err);
    alert(`获取文献邻域物理切片失败: ${err.message}`);
    updateStatus(`邻域切片提取失败: ${err.message}`);
  }
}
window.openNeighborhoodInquiry = openNeighborhoodInquiry;

// 卡片文献切片点击直达跳转与高亮
window.jumpToNodeSourceAnchor = async function(nodeId, event) {
  if (event) event.stopPropagation();
  const node = graph.nodes.find(n => n.id === nodeId);
  if (!node || !node.source_anchor) return;
  const sa = node.source_anchor;

  const drawer = document.getElementById('drawer');
  if (drawer && !drawer.classList.contains('open')) {
    openDrawer('reader');
  } else {
    const readerTabBtn = document.querySelector('.drawer-tab[data-tab="reader"]');
    if (readerTabBtn) readerTabBtn.click();
  }

  const docItem = materialsCatalog.find(m => m.name === sa.doc_name || m.title === sa.doc_name);
  if (docItem && (!graph.activeDoc || graph.activeDoc.name !== docItem.name)) {
    await switchActiveDocument(docItem, false);
  }

  const targetPage = sa.target_page || (sa.page_range && sa.page_range[0]) || 1;
  setTimeout(() => {
    jumpToOutlinePage(targetPage);
  }, 160);
};

// 点击目录大纲平滑跳转并光效高亮目标页
function jumpToOutlinePage(pageNum) {
  if (!currentPdfDoc) return;
  scrollToPage(pageNum, true);

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

  // 1. 优先在当前页临近范围快速探测 (O(1) 毫秒级)
  const startP = Math.max(1, currentPdfPageNum - 3);
  const endP = Math.min(currentPdfDoc.numPages, currentPdfPageNum + 3);

  let found = false;
  for (let p = startP; p <= endP; p++) {
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
      found = true;
      break;
    }
  }

  // 2. 若发生大跨度跳跃，再全局查找
  if (!found) {
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
      textLayer.style.setProperty('--scale-factor', viewport.scale);
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
    const viewContainer = document.getElementById('pdf-view-container');
    const prevRatio = viewContainer && (viewContainer.scrollHeight > viewContainer.clientHeight)
      ? viewContainer.scrollTop / (viewContainer.scrollHeight - viewContainer.clientHeight)
      : 0;

    drawer.style.width = widthCss;
    updateSizeButtons(key);

    // 零跳变平滑调宽：基于相对滚动比率就地恢复，严禁暴力重构/清空 DOM
    setTimeout(() => {
      if (currentDocMode === 'pdf' && currentPdfDoc && viewContainer) {
        viewContainer.scrollTop = prevRatio * (viewContainer.scrollHeight - viewContainer.clientHeight);
      }
    }, 200);
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
  updateStatus(`事实素材已成功引入画布: ${citation}`);
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
      updateStatus('已开启框选模式：请用鼠标在论文公式或插图上按住左键拖拽拉框');
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
    updateStatus(`已截取第 ${targetPageNum} 页原版公式/插图入图，正在逆向提取 LaTeX 表达式...`);

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
  updateStatus(`正在请求视觉模型逆向提取公式与参数...`);

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
        updateStatus(`已成功将《${citation}》反编译为标准 LaTeX 公式与物理释义`);
      } else {
        targetNode.ocrStatus = 'failed';
        saveGraph();
        renderNodes();
        if (selectedNodeId === nodeId) updateContextInspector();
        updateStatus(`公式反编译未完成: ${data.error || '未能识别有效内容'}`);
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
    updateStatus(`网络连接或调用异常: ${err.message}`);
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
          <button class="session-action-btn btn-rename" title="重命名课题">改</button>
          <button class="session-action-btn btn-del" title="删除课题">删</button>
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
      if (graph.nodes.length > 0) {
        selectedNodeId = graph.nodes[0].id;
        updateContextInspector();
      } else {
        selectedNodeId = null;
      }
      renderNodes();
      requestAnimationFrame(() => renderEdges());
      closeSidebar();
      updateStatus(`就绪 · 新课题已建立: ${data.session.title}`);
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

  // 画布平移与点击空白处取消选中
  container.addEventListener('mousedown', (e) => {
    if (e.target.closest('.node') || e.target.closest('.port') || e.target.closest('.zoom-controls')) return;
    isPanning = true;
    startPan = { x: e.clientX - pan.x, y: e.clientY - pan.y };
  });

  container.addEventListener('click', (e) => {
    if (!e.target.closest('.port-in-popover') && !e.target.closest('.port.in')) {
      closePortPopover();
    }
    if (e.target.closest('.node') || e.target.closest('.port') || e.target.closest('.zoom-controls') || e.target.closest('.edge-hitarea')) return;
    selectedNodeId = null;
    applyTopologyFocus(null);
    updateContextInspector();
  });

  let mouseMoveRaf = null;
  window.addEventListener('mousemove', (e) => {
    if (!isPanning && !draggingNodeId && !connectingSourceId && !unpluggingState) return;

    if (isPanning) {
      pan.x = e.clientX - startPan.x;
      pan.y = e.clientY - startPan.y;
    } else if (draggingNodeId) {
      const dist = Math.hypot(e.clientX - dragStartPos.x, e.clientY - dragStartPos.y);
      if (dist > 3) isActuallyDragging = true;
      if (!isActuallyDragging) return;

      window.getSelection()?.removeAllRanges();
      const worldPos = screenToWorld(e.clientX, e.clientY);
      const node = graph.nodes.find(n => n.id === draggingNodeId);
      if (node) {
        node.x = worldPos.x - dragOffset.x;
        node.y = worldPos.y - dragOffset.y;
      }
    } else if (connectingSourceId) {
      tempMousePos = screenToWorld(e.clientX, e.clientY);
    } else if (unpluggingState) {
      const dist = Math.hypot(e.clientX - unpluggingState.startClientX, e.clientY - unpluggingState.startClientY);
      if (dist > 4) {
        unpluggingState.isDragging = true;
        tempMousePos = screenToWorld(e.clientX, e.clientY);
        if (unpluggingState.pulledEdge) {
          const origPath = svgEdges.querySelector(`.edge-path[data-edge-id="${unpluggingState.pulledEdge.id}"]`);
          if (origPath) origPath.classList.add('unplugging');
        }
      }
    }

    if (!mouseMoveRaf) {
      mouseMoveRaf = requestAnimationFrame(() => {
        mouseMoveRaf = null;
        if (isPanning) {
          world.style.transform = `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`;
        } else if (draggingNodeId && isActuallyDragging) {
          const node = graph.nodes.find(n => n.id === draggingNodeId);
          const nodeEl = document.querySelector(`.node[data-id="${draggingNodeId}"]`);
          if (node && nodeEl) {
            nodeEl.style.left = `${node.x}px`;
            nodeEl.style.top = `${node.y}px`;
            updateConnectedEdges(draggingNodeId);
          }
        } else if (connectingSourceId) {
          updateTempConnectingEdge();
        } else if (unpluggingState && unpluggingState.isDragging) {
          updateDisconnectingEdge();
        }
      });
    }
  });

  window.addEventListener('mouseup', (e) => {
    if (isPanning) isPanning = false;

    if (draggingNodeId) {
      const wasDragging = isActuallyDragging;
      draggingNodeId = null;
      isActuallyDragging = false;
      window.getSelection()?.removeAllRanges();
      const selToolbar = document.getElementById('selection-toolbar');
      if (selToolbar) selToolbar.style.display = 'none';
      if (wasDragging) saveGraph();
    }

    const rawTargetEl = (e.target && typeof e.target.closest === 'function')
      ? e.target
      : (typeof document.elementFromPoint === 'function' ? document.elementFromPoint(e.clientX, e.clientY) : null);

    if (connectingSourceId) {
      const portIn = rawTargetEl?.closest('.port.in');
      if (portIn) {
        const targetId = portIn.dataset.node;
        if (targetId && targetId !== connectingSourceId) {
          const exists = graph.edges.some(edge => edge.source === connectingSourceId && edge.target === targetId);
          if (!exists) {
            pushGraphHistory();
            graph.edges.push({
              id: `e_${Date.now()}`,
              source: connectingSourceId,
              target: targetId,
              kind: e.shiftKey ? 'dashed' : 'solid'
            });
            saveGraph();
            updateStatus(`已建立连线: ${connectingSourceId} -> ${targetId}`);
            if (selectedNodeId === targetId) updateContextInspector();
            renderEdges();
          }
        }
      }
      connectingSourceId = null;
      updateTempConnectingEdge();
    }

    if (unpluggingState) {
      const state = unpluggingState;
      unpluggingState = null;
      hideDisconnectingEdge();

      if (state.isDragging) {
        const dist = Math.hypot(e.clientX - state.startClientX, e.clientY - state.startClientY);
        if (dist > 15) {
          const dropPortIn = rawTargetEl?.closest('.port.in');
          const dropPortOut = rawTargetEl?.closest('.port.out');
          const dropNode = rawTargetEl?.closest('.node');

          // 1. 拖到其他下游节点的输入端口：连线改接 (Rewire)
          if (dropPortIn && state.pulledEdge) {
            const newTargetId = dropPortIn.dataset.node;
            if (newTargetId && newTargetId !== state.pulledEdge.source && newTargetId !== state.targetId) {
              pushGraphHistory();
              state.pulledEdge.target = newTargetId;
              saveGraph();
              renderEdges();
              showToastNotification(`连线已成功改接到新下游节点`, () => undoGraph());
              return;
            }
          }

          // 2. 拖到特定上游节点或其输出端口：精准剪断该特定上游依赖
          if (dropPortOut || (dropNode && dropNode.dataset.id !== state.targetId)) {
            const sourceId = dropPortOut ? dropPortOut.dataset.node : dropNode.dataset.id;
            const targetEdge = state.incoming.find(ed => ed.source === sourceId);
            if (targetEdge) {
              pushGraphHistory();
              const sNode = graph.nodes.find(n => n.id === targetEdge.source);
              const sTitle = sNode ? (sNode.title || sNode.id) : targetEdge.source;
              deleteEdge(targetEdge.id);
              showToastNotification(`已切除与【${escapeHtml(sTitle)}】的连线`, () => undoGraph());
              return;
            }
          }

          // 3. 甩到空白画布处松手：直接拔断！
          if (state.pulledEdge) {
            pushGraphHistory();
            const sNode = graph.nodes.find(n => n.id === state.pulledEdge.source);
            const sTitle = sNode ? (sNode.title || sNode.id) : state.pulledEdge.source;
            deleteEdge(state.pulledEdge.id);
            showToastNotification(`已从下游拔除并切断连线【${escapeHtml(sTitle)}】`, () => undoGraph());
            return;
          } else if (state.incoming.length > 1) {
            // 多条入边：根据鼠标拖拽矢量方向切除最匹配的那根
            const mouseWorld = screenToWorld(e.clientX, e.clientY);
            let closestEdge = null;
            let minDistance = Infinity;
            for (const ed of state.incoming) {
              const srcNode = graph.nodes.find(n => n.id === ed.source);
              if (srcNode) {
                const d = Math.hypot(srcNode.x - mouseWorld.x, srcNode.y - mouseWorld.y);
                if (d < minDistance) {
                  minDistance = d;
                  closestEdge = ed;
                }
              }
            }
            if (closestEdge) {
              pushGraphHistory();
              const sNode = graph.nodes.find(n => n.id === closestEdge.source);
              const sTitle = sNode ? (sNode.title || sNode.id) : closestEdge.source;
              deleteEdge(closestEdge.id);
              showToastNotification(`已根据拖拽方向拔除连线【${escapeHtml(sTitle)}】`, () => undoGraph());
              return;
            }
          }
        }
        renderEdges();
      } else {
        // 用户仅仅是单击了 .port.in：呼出精致的快速断线菜单气泡！
        renderEdges();
        showPortInPopover(state.targetId, e.clientX, e.clientY);
      }
    }
  });

  // 滚轮分流：光标在卡片内容区时放行原生滚动；仅在画布空白区缩放 (GPU 硬件加速，零重绘)
  container.addEventListener('wheel', (e) => {
    // 0. Shift + 滚轮 或在横向代码/反汇编容器上方：平滑驱动横向滚动 (优雅免拖滚动条)
    if (e.shiftKey) {
      const scrollableHoriz = e.target.closest('.code-pre, .disasm-box, .node-content');
      if (scrollableHoriz) {
        scrollableHoriz.scrollLeft += (e.deltaY || e.deltaX);
        e.preventDefault();
        return;
      }
    }

    // 1. 若光标处于卡片内容区上方，且未按住 Ctrl/Cmd 键强制缩放画布：
    // 直接放行给 Chromium 底层 Compositor 线程原生 120Hz 丝滑惯性滚动
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

    // 画布背景滚轮缩放 (纯 CSS Transform，避免重绘 SVG 连线)
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
  }, { passive: false });

  // 连线与下游断线触发
  container.addEventListener('mousedown', (e) => {
    closePortPopover();

    const portOut = e.target.closest('.port.out');
    if (portOut) {
      connectingSourceId = portOut.dataset.node;
      tempMousePos = screenToWorld(e.clientX, e.clientY);
      updateTempConnectingEdge();
      e.stopPropagation();
      return;
    }

    const portIn = e.target.closest('.port.in');
    if (portIn) {
      const targetId = portIn.dataset.node;
      const incoming = (graph.edges || []).filter(edge => edge.target === targetId);

      unpluggingState = {
        targetId,
        incoming,
        startClientX: e.clientX,
        startClientY: e.clientY,
        pulledEdge: incoming.length === 1 ? incoming[0] : null,
        isDragging: false
      };

      tempMousePos = screenToWorld(e.clientX, e.clientY);
      e.stopPropagation();
      return;
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

  const btnAddMaterial = document.getElementById('btn-add-material');
  if (btnAddMaterial) btnAddMaterial.onclick = () => openDrawer('reader');

  const btnAddCode = document.getElementById('btn-add-code');
  if (btnAddCode) btnAddCode.onclick = () => openCodeModal();

  const btnCloseCodeModal = document.getElementById('btn-close-code-modal');
  if (btnCloseCodeModal) btnCloseCodeModal.onclick = () => closeCodeModal();

  const btnCancelCodeModal = document.getElementById('btn-cancel-code-modal');
  if (btnCancelCodeModal) btnCancelCodeModal.onclick = () => closeCodeModal();

  const btnPasteClipboard = document.getElementById('btn-paste-clipboard');
  if (btnPasteClipboard) {
    btnPasteClipboard.onclick = async () => {
      try {
        const text = await navigator.clipboard.readText();
        const contentInput = document.getElementById('code-modal-content');
        if (contentInput && text) {
          contentInput.value = text;
          autoDetectCodeMeta(text);
          updateStatus("已从剪贴板粘贴源码！");
        }
      } catch (err) {
        alert("无法直接访问系统剪贴板，请使用 Ctrl+V 手动粘贴。");
      }
    };
  }

  const btnSubmitCodeModal = document.getElementById('btn-submit-code-modal');
  if (btnSubmitCodeModal) {
    btnSubmitCodeModal.onclick = () => {
      const title = (document.getElementById('code-modal-title')?.value || '').trim();
      const lang = (document.getElementById('code-modal-lang')?.value || 'c').trim();
      const citation = (document.getElementById('code-modal-citation')?.value || '').trim();
      const content = (document.getElementById('code-modal-content')?.value || '').trim();
      const targetId = document.getElementById('code-modal-target-node')?.value;

      if (!content) {
        alert("请在输入框中填入或粘贴源码内容！");
        return;
      }

      const newId = `n_code_${Date.now()}`;
      const screenCenter = screenToWorld(window.innerWidth / 3, window.innerHeight / 2.5);

      let x = Math.max(40, screenCenter.x - 180);
      let y = Math.max(40, screenCenter.y - 100);

      const targetNode = graph.nodes.find(n => n.id === targetId);
      if (targetNode) {
        x = Math.max(40, targetNode.x - 420);
        y = targetNode.y;
      }

      const newNode = {
        id: newId,
        kind: 'source_code',
        title: title || '源码公理实证片段',
        language: lang,
        code: content,
        citation: citation,
        status: 'idle',
        x,
        y,
        createdAt: Date.now()
      };

      graph.nodes.push(newNode);

      if (targetId && targetNode) {
        graph.edges.push({
          id: `e_${newId}_${targetId}`,
          source: newId,
          target: targetId,
          kind: 'solid'
        });
      }

      saveGraph();
      renderNodes();
      requestAnimationFrame(() => renderEdges());
      selectNode(newId);
      closeCodeModal();
      updateStatus(`已创建源码实证卡片 #${newId}！`);
    };
  }

  const btnToggleReader = document.getElementById('btn-toggle-reader');
  if (btnToggleReader) btnToggleReader.onclick = () => openDrawer('reader');

  const btnResetDemo = document.getElementById('btn-reset-demo');
  if (btnResetDemo) {
    btnResetDemo.onclick = async () => {
      if (confirm("是否重新加载科研工作流预置结构？")) {
        location.reload();
      }
    };
  }

  // ==========================================
  // 模型与接口调度设置中心 (双引擎 & 服务商预设)
  // ==========================================
  const PROVIDER_PRESETS = {
    localproxy: {
      name: '本地反代',
      api_base: 'http://127.0.0.1:8045/v1',
      model: 'gemini-3.8-flash-high',
      vision_model: 'gemini-3.8-flash-high',
      hint: '服务商：本地 Antigravity 代理 · 自动探测本地端口，无需配置第三方 Key',
      linkText: '',
      linkUrl: '#',
      defaultKey: 'sk-antigravity',
      models: [
        { id: 'gemini-3.8-flash-high', name: 'gemini-3.8-flash-high (Google 深度思考 · 推荐)' },
        { id: 'gemini-3.1-pro', name: 'gemini-3.1-pro (长上下文/深度逻辑)' },
        { id: 'gemini-2.5-flash', name: 'gemini-2.5-flash (极速响应)' },
        { id: 'claude-3-5-sonnet-20241022', name: 'claude-3-5-sonnet (代码与系统架构)' },
        { id: 'gpt-4o', name: 'gpt-4o (OpenAI 全模态旗舰)' }
      ],
      vision_models: [
        { id: 'gemini-3.8-flash-high', name: 'gemini-3.8-flash-high (高精度 LaTeX 公式 OCR · 推荐)' },
        { id: 'gemini-3.1-pro', name: 'gemini-3.1-pro (深度图表解析)' },
        { id: 'gpt-4o', name: 'gpt-4o (视觉解析)' }
      ]
    },
    siliconflow: {
      name: '硅基流动',
      api_base: 'https://api.siliconflow.cn/v1',
      model: 'deepseek-ai/DeepSeek-V4-Pro',
      vision_model: 'Qwen/Qwen2.5-VL-72B-Instruct',
      hint: '服务商：硅基流动 · 适用 DeepSeek-V4 Pro (推理) + Qwen2.5-VL-72B (视觉)',
      linkText: 'cloud.siliconflow.cn ↗',
      linkUrl: 'https://cloud.siliconflow.cn/account/ak',
      defaultKey: '',
      models: [
        { id: 'deepseek-ai/DeepSeek-V4-Pro', name: 'deepseek-ai/DeepSeek-V4-Pro (官方首选推演)' },
        { id: 'deepseek-ai/DeepSeek-R1', name: 'deepseek-ai/DeepSeek-R1 (深度长思维链)' },
        { id: 'deepseek-ai/DeepSeek-V3', name: 'deepseek-ai/DeepSeek-V3 (极速通用推理)' },
        { id: 'Qwen/Qwen2.5-72B-Instruct', name: 'Qwen/Qwen2.5-72B-Instruct (通义千问开源旗舰)' }
      ],
      vision_models: [
        { id: 'Qwen/Qwen2.5-VL-72B-Instruct', name: 'Qwen/Qwen2.5-VL-72B-Instruct (公式/插图解析 · 推荐)' },
        { id: 'Pro/Qwen/Qwen2.5-VL-7B-Instruct', name: 'Pro/Qwen/Qwen2.5-VL-7B-Instruct (极速轻量)' }
      ]
    },
    dashscope: {
      name: '阿里百炼',
      api_base: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      model: 'qwen3.8-max',
      vision_model: 'qwen-vl-max',
      hint: '服务商：阿里百炼 · 适用 Qwen3.8-Max (推理) + qwen-vl-max (视觉)',
      linkText: 'bailian.console.aliyun.com ↗',
      linkUrl: 'https://bailian.console.aliyun.com/?apiKey=1',
      defaultKey: '',
      models: [
        { id: 'qwen3.8-max', name: 'qwen3.8-max (百炼最新学术旗舰)' },
        { id: 'qwen-max', name: 'qwen-max (复杂学术长文)' },
        { id: 'qwen-plus', name: 'qwen-plus (高性价比加速)' },
        { id: 'deepseek-r1', name: 'deepseek-r1 (百炼托管 R1)' },
        { id: 'deepseek-v3', name: 'deepseek-v3 (百炼托管 V3)' }
      ],
      vision_models: [
        { id: 'qwen-vl-max', name: 'qwen-vl-max (旗舰视觉 OCR · 推荐)' },
        { id: 'qwen-vl-plus', name: 'qwen-vl-plus (极速视觉)' }
      ]
    },
    deepseek: {
      name: 'DeepSeek 官方',
      api_base: 'https://api.deepseek.com/v1',
      model: 'deepseek-chat',
      vision_model: '',
      hint: '服务商：DeepSeek 开放平台 · 适用 deepseek-chat / deepseek-reasoner',
      linkText: 'platform.deepseek.com ↗',
      linkUrl: 'https://platform.deepseek.com/api_keys',
      defaultKey: '',
      models: [
        { id: 'deepseek-chat', name: 'deepseek-chat (DeepSeek-V3 极速通用)' },
        { id: 'deepseek-reasoner', name: 'deepseek-reasoner (DeepSeek-R1 深度长思维链)' }
      ],
      vision_models: [
        { id: '', name: '自动回退 (DeepSeek 官方无多模态，由主引擎/本地代理处理)' }
      ]
    },
    openai: {
      name: 'OpenAI 官方',
      api_base: 'https://api.openai.com/v1',
      model: 'gpt-4o',
      vision_model: 'gpt-4o',
      hint: '服务商：OpenAI 官方 · 适用 GPT-4o / o1 / o3-mini',
      linkText: 'platform.openai.com ↗',
      linkUrl: 'https://platform.openai.com/api-keys',
      defaultKey: '',
      models: [
        { id: 'gpt-4o', name: 'gpt-4o (全能旗舰 · 推荐)' },
        { id: 'gpt-4o-mini', name: 'gpt-4o-mini (轻量极速)' },
        { id: 'o1', name: 'o1 (长思维链高难度推理)' },
        { id: 'o3-mini', name: 'o3-mini (数理逻辑极速推理)' }
      ],
      vision_models: [
        { id: 'gpt-4o', name: 'gpt-4o (高精度视觉 OCR · 推荐)' },
        { id: 'gpt-4o-mini', name: 'gpt-4o-mini (轻量视觉)' }
      ]
    }
  };

  function getSavedProviderKeys() {
    try {
      return JSON.parse(localStorage.getItem('axiomflow_provider_keys') || '{}');
    } catch (e) {
      return {};
    }
  }

  function saveProviderKey(providerKey, keyVal) {
    if (!providerKey) return;
    const keys = getSavedProviderKeys();
    keys[providerKey] = (keyVal || '').trim();
    localStorage.setItem('axiomflow_provider_keys', JSON.stringify(keys));
  }

  let currentActiveProvider = 'localproxy';

  // 专属服务商模型下拉渲染引擎
  function populateModelOptions(pKey, targetModel, targetVision, fetchedOnlineModels = null) {
    const preset = PROVIDER_PRESETS[pKey] || PROVIDER_PRESETS.localproxy;
    const modelSelect = document.getElementById('cfg-model-select');
    const visionSelect = document.getElementById('cfg-vision-model-select');
    const modelBadge = document.getElementById('cfg-model-badge');
    const customBox = document.getElementById('cfg-custom-model-box');
    const customInput = document.getElementById('cfg-custom-model-input');

    if (modelBadge) {
      modelBadge.innerText = `${preset.name} 专属模型库`;
    }

    if (modelSelect) {
      let html = '';
      
      // 1. 服务商专属官方推荐模型
      html += `<optgroup label="${preset.name} 推荐模型">`;
      (preset.models || []).forEach(m => {
        html += `<option value="${escapeHtml(m.id)}">${escapeHtml(m.name)}</option>`;
      });
      html += `</optgroup>`;

      // 2. 在线探测发现的实时模型 (若有)
      if (fetchedOnlineModels && fetchedOnlineModels.length > 0) {
        html += `<optgroup label="在线探测发现模型 (${fetchedOnlineModels.length} 个)">`;
        fetchedOnlineModels.forEach(mid => {
          html += `<option value="${escapeHtml(mid)}">${escapeHtml(mid)}</option>`;
        });
        html += `</optgroup>`;
      }

      // 3. 自定义输入兜底
      html += `<optgroup label="自定义输入">
        <option value="__custom__">自定义模型名称...</option>
      </optgroup>`;

      modelSelect.innerHTML = html;

      // 选中项智能匹配
      const wantModel = targetModel || preset.model;
      let matched = false;
      for (const opt of modelSelect.options) {
        if (opt.value === wantModel) {
          modelSelect.value = wantModel;
          matched = true;
          break;
        }
      }
      if (matched) {
        if (customBox) customBox.style.display = 'none';
      } else {
        modelSelect.value = '__custom__';
        if (customBox) customBox.style.display = 'block';
        if (customInput) customInput.value = wantModel;
      }
    }

    if (visionSelect) {
      let vHtml = `<option value="">自动路由 (根据主模型与服务商自适应)</option>`;
      if (preset.vision_models && preset.vision_models.length > 0) {
        vHtml += `<optgroup label="${preset.name} 推荐多模态视觉">`;
        preset.vision_models.forEach(vm => {
          if (vm.id) {
            vHtml += `<option value="${escapeHtml(vm.id)}">${escapeHtml(vm.name)}</option>`;
          }
        });
        vHtml += `</optgroup>`;
      }
      visionSelect.innerHTML = vHtml;
      visionSelect.value = targetVision !== undefined ? targetVision : (preset.vision_model || '');
    }
  }

  function updatePresetButtonsState(api_base) {
    const cleanBase = (api_base || '').trim().replace(/\/+$/, '');
    let matchedKey = null;
    document.querySelectorAll('.btn-preset-provider').forEach(btn => {
      const pKey = btn.dataset.provider;
      const p = PROVIDER_PRESETS[pKey];
      if (p && cleanBase === p.api_base.replace(/\/+$/, '')) {
        btn.classList.add('active');
        matchedKey = pKey;
      } else {
        btn.classList.remove('active');
      }
    });
    if (matchedKey) {
      currentActiveProvider = matchedKey;
      updateProviderHintBar(matchedKey);
    }
  }

  function updateProviderHintBar(pKey) {
    const preset = PROVIDER_PRESETS[pKey];
    const hintBar = document.getElementById('cfg-provider-hint-bar');
    const hintText = document.getElementById('cfg-provider-hint-text');
    const hintLink = document.getElementById('cfg-provider-link');
    const keyStatus = document.getElementById('cfg-key-status');
    if (!preset || !hintBar) return;

    if (hintText) hintText.innerText = preset.hint;
    if (hintLink) {
      hintLink.innerText = preset.linkText;
      hintLink.href = preset.linkUrl;
      hintLink.style.display = preset.linkUrl === '#' ? 'none' : 'inline-flex';
    }
    if (keyStatus) {
      if (pKey === 'localproxy') {
        keyStatus.innerText = '免配 Key (自动就绪)';
        keyStatus.style.color = '#38bdf8';
      } else {
        const savedKeys = getSavedProviderKeys();
        const currentInputKey = (document.getElementById('cfg-api-key')?.value || '').trim();
        const hasKey = !!(savedKeys[pKey] || currentInputKey || (currentConfig.api_key && currentConfig.api_base?.includes(pKey)));
        keyStatus.innerText = hasKey ? '已记忆本地私钥' : '请粘贴 Key';
        keyStatus.style.color = hasKey ? '#10b981' : '#f59e0b';
      }
    }
  }

  // 服务商快捷预设按钮点击
  document.querySelectorAll('.btn-preset-provider').forEach(btn => {
    btn.onclick = () => {
      const pKey = btn.dataset.provider;
      const preset = PROVIDER_PRESETS[pKey];
      if (!preset) return;

      currentActiveProvider = pKey;
      document.getElementById('cfg-api-base').value = preset.api_base;

      // 智能恢复该服务商已保存的专属 Key
      const savedKeys = getSavedProviderKeys();
      const apiKeyInput = document.getElementById('cfg-api-key');
      if (apiKeyInput) {
        if (savedKeys[pKey]) {
          apiKeyInput.value = savedKeys[pKey];
        } else if (pKey === 'localproxy') {
          apiKeyInput.value = 'sk-antigravity';
        } else {
          apiKeyInput.value = '';
        }
      }

      // 动态适配该服务商专属模型目录
      populateModelOptions(pKey, preset.model, preset.vision_model);

      // 重置连通性状态框
      const testStatusEl = document.getElementById('cfg-test-status');
      if (testStatusEl) testStatusEl.style.display = 'none';

      updatePresetButtonsState(preset.api_base);
      updateProviderHintBar(pKey);
    };
  });

  // 主模型下拉选择与自定义输入框联动
  const modelSelectEl = document.getElementById('cfg-model-select');
  const customBoxEl = document.getElementById('cfg-custom-model-box');
  const customInputEl = document.getElementById('cfg-custom-model-input');
  if (modelSelectEl) {
    modelSelectEl.onchange = () => {
      if (modelSelectEl.value === '__custom__') {
        if (customBoxEl) customBoxEl.style.display = 'block';
        if (customInputEl) customInputEl.focus();
      } else {
        if (customBoxEl) customBoxEl.style.display = 'none';
      }
    };
  }

  // 温度采样语义提示
  const updateTempSemanticHint = (v) => {
    const hintEl = document.getElementById('cfg-temp-hint');
    const val = parseFloat(v);
    if (!hintEl) return;
    if (val <= 0.15) {
      hintEl.innerText = '严格确定性证明 (代码/数学贪心采样)';
      hintEl.style.color = '#38bdf8';
    } else if (val <= 0.45) {
      hintEl.innerText = '均衡学术论证 (默认推荐)';
      hintEl.style.color = '#34d399';
    } else {
      hintEl.innerText = '启发式发散探索 (高创造性)';
      hintEl.style.color = '#f59e0b';
    }
  };

  // 温度滑块与数值显示联动
  const tempSlider = document.getElementById('cfg-temperature');
  const tempVal = document.getElementById('cfg-temp-value');
  if (tempSlider && tempVal) {
    tempSlider.oninput = () => {
      tempVal.innerText = tempSlider.value;
      updateTempSemanticHint(tempSlider.value);
    };
  }

  // 探测在线模型按钮
  const btnFetchModels = document.getElementById('btn-fetch-models');
  if (btnFetchModels) {
    btnFetchModels.onclick = async () => {
      const api_base = (document.getElementById('cfg-api-base')?.value || '').trim();
      const api_key = (document.getElementById('cfg-api-key')?.value || '').trim() || currentConfig.api_key || '';
      if (!api_base) {
        alert("请先填写接口基址 (API Base)");
        return;
      }
      btnFetchModels.disabled = true;
      btnFetchModels.innerText = '探测中...';
      try {
        const res = await fetch('/api/fetch-models', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ api_base, api_key })
        });
        const data = await res.json();
        if (data.ok && data.models && data.models.length > 0) {
          const curModel = modelSelectEl ? modelSelectEl.value : currentConfig.model;
          const curVision = document.getElementById('cfg-vision-model-select')?.value || currentConfig.vision_model;
          populateModelOptions(currentActiveProvider, curModel, curVision, data.models);
          updateStatus(`探测成功，已拉取 ${data.models.length} 个在线模型`);
        } else {
          alert(`未能自动获取模型列表: ${data.error || '远端未开放 /v1/models 标准接口'}`);
        }
      } catch (err) {
        alert(`探测请求异常: ${err.message}`);
      } finally {
        btnFetchModels.disabled = false;
        btnFetchModels.innerText = '探测在线模型';
      }
    };
  }

  // 密码显示/隐藏切换
  const btnToggleKey = document.getElementById('btn-toggle-key-visibility');
  const apiKeyInput = document.getElementById('cfg-api-key');
  if (btnToggleKey && apiKeyInput) {
    btnToggleKey.onclick = () => {
      const isPassword = apiKeyInput.type === 'password';
      apiKeyInput.type = isPassword ? 'text' : 'password';
      btnToggleKey.innerText = isPassword ? '显' : '隐';
    };
  }

  // 连通性测试
  const btnTestConn = document.getElementById('btn-test-connection');
  const testStatusEl = document.getElementById('cfg-test-status');
  if (btnTestConn && testStatusEl) {
    btnTestConn.onclick = async () => {
      const api_base = document.getElementById('cfg-api-base').value.trim();
      let model = modelSelectEl ? modelSelectEl.value : 'gemini-3.8-flash-high';
      if (model === '__custom__') {
        model = (customInputEl?.value || '').trim() || 'gemini-3.8-flash-high';
      }
      const api_key = (apiKeyInput?.value || '').trim() || currentConfig.api_key || '';
      const temperature = parseFloat(tempSlider?.value || '0.3');

      if (!api_base) {
        alert("请输入接口基址 (API Base)");
        return;
      }

      btnTestConn.disabled = true;
      btnTestConn.innerHTML = '<span>探测中...</span>';
      testStatusEl.style.display = 'block';
      testStatusEl.style.background = 'rgba(99, 102, 241, 0.12)';
      testStatusEl.style.border = '1px solid rgba(99, 102, 241, 0.3)';
      testStatusEl.style.color = '#c7d2fe';
      testStatusEl.innerText = `正在向 ${api_base} 发送探测请求 (模型: ${model}, 采样温度: ${temperature})...`;

      try {
        const res = await fetch('/api/test-connection', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ api_base, api_key, model, temperature })
        });
        const data = await res.json();
        if (data.ok) {
          testStatusEl.style.background = 'rgba(16, 185, 129, 0.12)';
          testStatusEl.style.border = '1px solid rgba(16, 185, 129, 0.4)';
          testStatusEl.style.color = '#34d399';
          testStatusEl.innerText = `${data.message} (实测采样温度: ${temperature})`;
          if (api_key && currentActiveProvider) {
            saveProviderKey(currentActiveProvider, api_key);
            updateProviderHintBar(currentActiveProvider);
          }
        } else {
          testStatusEl.style.background = 'rgba(239, 68, 68, 0.12)';
          testStatusEl.style.border = '1px solid rgba(239, 68, 68, 0.4)';
          testStatusEl.style.color = '#f87171';
          testStatusEl.innerText = data.error;
        }
      } catch (err) {
        testStatusEl.style.background = 'rgba(239, 68, 68, 0.12)';
        testStatusEl.style.border = '1px solid rgba(239, 68, 68, 0.4)';
        testStatusEl.style.color = '#f87171';
        testStatusEl.innerText = `请求异常: ${err.message}`;
      } finally {
        btnTestConn.disabled = false;
        btnTestConn.innerHTML = '<span>测试连接</span>';
      }
    };
  }

  // 打开设置弹窗
  const openSettingsHandler = () => {
    const apiBase = currentConfig.api_base || 'http://127.0.0.1:8045/v1';
    document.getElementById('cfg-api-base').value = apiBase;

    // 智能识别服务商
    let matchedPKey = 'localproxy';
    for (const [pk, p] of Object.entries(PROVIDER_PRESETS)) {
      if (apiBase.includes(p.api_base.replace(/\/+$/, ''))) {
        matchedPKey = pk;
        break;
      }
    }
    currentActiveProvider = matchedPKey;

    const savedKeys = getSavedProviderKeys();
    if (apiKeyInput) {
      if (savedKeys[matchedPKey]) {
        apiKeyInput.value = savedKeys[matchedPKey];
      } else if (currentConfig.api_key && currentConfig.api_key !== 'sk-antigravity') {
        apiKeyInput.value = currentConfig.api_key;
      } else if (matchedPKey === 'localproxy') {
        apiKeyInput.value = 'sk-antigravity';
      } else {
        apiKeyInput.value = '';
      }
    }

    // 动态渲染专属模型
    const model = currentConfig.model || 'gemini-3.8-flash-high';
    const vision = currentConfig.vision_model || '';
    populateModelOptions(matchedPKey, model, vision);

    // 渲染温度与语义提示
    if (tempSlider && tempVal) {
      const t = currentConfig.temperature !== undefined ? currentConfig.temperature : 0.3;
      tempSlider.value = t;
      tempVal.innerText = t;
      updateTempSemanticHint(t);
    }

    if (testStatusEl) testStatusEl.style.display = 'none';

    updatePresetButtonsState(apiBase);
    settingsModal.style.display = 'flex';
  };

  const btnOpenSettings = document.getElementById('btn-open-settings');
  if (btnOpenSettings) btnOpenSettings.onclick = openSettingsHandler;

  const btnStatusPill = document.getElementById('btn-status-pill');
  if (btnStatusPill) btnStatusPill.onclick = openSettingsHandler;

  document.getElementById('btn-close-settings').onclick = () => {
    settingsModal.style.display = 'none';
  };

  document.getElementById('btn-cancel-settings').onclick = () => {
    settingsModal.style.display = 'none';
  };

  document.getElementById('btn-save-settings').onclick = async () => {
    const api_base = document.getElementById('cfg-api-base').value.trim();
    let model = modelSelectEl ? modelSelectEl.value : 'deepseek-ai/DeepSeek-V4-Pro';
    if (model === '__custom__') {
      model = (customInputEl?.value || '').trim() || 'deepseek-ai/DeepSeek-V4-Pro';
    }
    const vision_model = (document.getElementById('cfg-vision-model-select')?.value || '').trim();
    const api_key = (apiKeyInput?.value || '').trim();
    const temperature = parseFloat(tempSlider?.value || '0.3');

    // 记忆该服务商的 Key
    if (currentActiveProvider && api_key) {
      saveProviderKey(currentActiveProvider, api_key);
    }

    const payload = { api_base, model, vision_model, temperature };
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
        updateStatus(formatModelStatusText(currentConfig));
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

  // 概念追问与邻域研读弹窗控制
  const btnCloseInquiry = document.getElementById('btn-close-inquiry');
  if (btnCloseInquiry) btnCloseInquiry.onclick = () => {
    inquiryModal.style.display = 'none';
    neighborhoodActiveContext = null;
    const banner = document.getElementById('inquiry-neighborhood-banner');
    if (banner) banner.style.display = 'none';
  };
  const btnCancelInquiry = document.getElementById('btn-cancel-inquiry');
  if (btnCancelInquiry) btnCancelInquiry.onclick = () => {
    inquiryModal.style.display = 'none';
    neighborhoodActiveContext = null;
    const banner = document.getElementById('inquiry-neighborhood-banner');
    if (banner) banner.style.display = 'none';
  };
  const btnSubmitInquiry = document.getElementById('btn-submit-inquiry');
  if (btnSubmitInquiry) btnSubmitInquiry.onclick = () => { submitConceptInquiry(); };

  // 顶栏与大纲中的邻域研读与AI骨架触发器
  const btnNeighborhoodProbe = document.getElementById('btn-neighborhood-probe');
  if (btnNeighborhoodProbe) {
    btnNeighborhoodProbe.onclick = () => {
      openNeighborhoodInquiry(currentPdfPageNum, null);
    };
  }
  const btnAiOutline = document.getElementById('btn-ai-outline');
  if (btnAiOutline) {
    btnAiOutline.onclick = () => {
      requestAiOutline(true);
    };
  }

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
    // 全局 Ctrl+Z / Cmd+Z 撤销（非输入框内生效）
    if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z') && !e.shiftKey) {
      const activeEl = document.activeElement;
      if (!activeEl || (activeEl.tagName !== 'INPUT' && activeEl.tagName !== 'TEXTAREA' && !activeEl.isContentEditable)) {
        e.preventDefault();
        undoGraph();
        return;
      }
    }

    if ((e.ctrlKey || e.metaKey) && (e.key === 'b' || e.key === 'B')) {
      e.preventDefault();
      toggleSidebar();
    }
    if (e.altKey && (e.key === 'c' || e.key === 'C')) {
      e.preventDefault();
      openCodeModal();
    }
    if (e.key === 'Escape') {
      closePortPopover();
      if (unpluggingState) {
        unpluggingState = null;
        hideDisconnectingEdge();
        renderEdges();
      }
      if (connectingSourceId) {
        connectingSourceId = null;
        updateTempConnectingEdge();
      }
      const sidebar = document.getElementById('sidebar-sessions');
      if (sidebar && sidebar.classList.contains('open')) closeSidebar();
      if (cardModal && cardModal.style.display === 'flex') cardModal.style.display = 'none';
      if (inquiryModal && inquiryModal.style.display === 'flex') inquiryModal.style.display = 'none';
      if (settingsModal && settingsModal.style.display === 'flex') settingsModal.style.display = 'none';
      const codeModal = document.getElementById('code-modal');
      if (codeModal && codeModal.style.display === 'flex') closeCodeModal();
    }
  });
}

// 下游流入端口快速断线与依赖管理气泡
function showPortInPopover(targetId, clientX, clientY) {
  closePortPopover();

  const targetNode = graph.nodes.find(n => n.id === targetId);
  if (!targetNode) return;

  const incoming = (graph.edges || []).filter(e => e.target === targetId);
  const popover = document.createElement('div');
  popover.className = 'port-in-popover';
  popover.id = 'port-in-popover';

  if (incoming.length === 0) {
    popover.innerHTML = `
      <div class="port-in-popover-title">
        <span>流入上下文</span>
        <button class="popover-close-btn" style="background:none;border:none;color:#94a3b8;cursor:pointer;font-size:12px;">✕</button>
      </div>
      <div style="font-size: 11.5px; color: #94a3b8; padding: 4px 6px;">该节点暂无流入依赖。<br>可从上游节点右侧端口拖线接入。</div>
    `;
  } else {
    let itemsHtml = '';
    incoming.forEach(ed => {
      const srcNode = graph.nodes.find(n => n.id === ed.source);
      const srcTitle = srcNode ? (srcNode.title || srcNode.id) : ed.source;
      itemsHtml += `
        <div class="port-in-popover-item" data-edge-id="${ed.id}">
          <span style="font-size: 11.5px; color: #cbd5e1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 170px;" title="${escapeHtml(srcTitle)}">
            ${escapeHtml(srcTitle)}
          </span>
          <button class="btn-cut" data-edge-id="${ed.id}">剪断</button>
        </div>
      `;
    });

    const cutAllBtn = incoming.length > 1 ? `
      <div style="margin-top: 6px; padding-top: 6px; border-top: 1px solid rgba(255,255,255,0.08); text-align: right;">
        <button id="btn-popover-cut-all" style="background: rgba(244,63,94,0.15); border: 1px solid rgba(244,63,94,0.4); color: #f43f5e; font-size: 11px; padding: 3px 8px; border-radius: 4px; cursor: pointer;">✕ 剪断全部流入依赖</button>
      </div>
    ` : '';

    popover.innerHTML = `
      <div class="port-in-popover-title">
        <span>流入依赖 (${incoming.length} 条)</span>
        <button class="popover-close-btn" style="background:none;border:none;color:#94a3b8;cursor:pointer;font-size:12px;">✕</button>
      </div>
      <div class="port-in-popover-list">
        ${itemsHtml}
      </div>
      ${cutAllBtn}
    `;
  }

  document.body.appendChild(popover);

  // 计算自适应居中或对齐位置
  const rect = popover.getBoundingClientRect();
  let left = clientX - rect.width - 14;
  let top = clientY - rect.height / 2;
  if (left < 10) left = clientX + 20;
  if (top < 10) top = 10;
  if (top + rect.height > window.innerHeight - 10) top = window.innerHeight - rect.height - 10;

  popover.style.left = `${left}px`;
  popover.style.top = `${top}px`;

  // 绑定关闭与剪切操作
  popover.querySelector('.popover-close-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    closePortPopover();
  });

  popover.querySelectorAll('.btn-cut, .port-in-popover-item').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const edgeId = el.dataset.edgeId;
      if (edgeId) {
        const ed = (graph.edges || []).find(x => x.id === edgeId);
        const sNode = ed ? graph.nodes.find(n => n.id === ed.source) : null;
        const sTitle = sNode ? (sNode.title || sNode.id) : '上游';
        pushGraphHistory();
        deleteEdge(edgeId);
        closePortPopover();
        showToastNotification(`已剪断与【${escapeHtml(sTitle)}】的依赖连线`, () => undoGraph());
      }
    });
  });

  const btnCutAll = popover.querySelector('#btn-popover-cut-all');
  if (btnCutAll) {
    btnCutAll.addEventListener('click', (e) => {
      e.stopPropagation();
      pushGraphHistory();
      const edgesToDelete = incoming.map(ed => ed.id);
      edgesToDelete.forEach(id => deleteEdge(id));
      closePortPopover();
      showToastNotification(`已剪断该节点的全部 ${edgesToDelete.length} 条流入依赖`, () => undoGraph());
    });
  }
}

function closePortPopover() {
  const p = document.getElementById('port-in-popover');
  if (p) p.remove();
}

function openCodeModal() {
  const modal = document.getElementById('code-modal');
  if (!modal) return;
  const titleInput = document.getElementById('code-modal-title');
  const citationInput = document.getElementById('code-modal-citation');
  const contentInput = document.getElementById('code-modal-content');
  const targetSelect = document.getElementById('code-modal-target-node');
  
  if (titleInput) titleInput.value = '';
  if (citationInput) citationInput.value = '';
  if (contentInput) contentInput.value = '';

  if (targetSelect) {
    targetSelect.innerHTML = '<option value="">(暂不连线，作为独立公理实证卡片入图)</option>';
    graph.nodes.forEach(n => {
      if (n.kind === 'question' || n.kind === 'conclusion') {
        const opt = document.createElement('option');
        opt.value = n.id;
        opt.innerText = n.title || n.question || n.id;
        if (n.id === selectedNodeId) opt.selected = true;
        targetSelect.appendChild(opt);
      }
    });
  }

  // 尝试自动读取系统剪贴板
  if (navigator.clipboard && typeof navigator.clipboard.readText === 'function') {
    navigator.clipboard.readText().then(clipText => {
      if (clipText && clipText.trim() && contentInput && !contentInput.value) {
        contentInput.value = clipText.trim();
        autoDetectCodeMeta(clipText.trim());
      }
    }).catch(() => {});
  }

  modal.style.display = 'flex';
  setTimeout(() => {
    if (contentInput && contentInput.value) {
      if (titleInput) titleInput.focus();
    } else if (contentInput) {
      contentInput.focus();
    }
  }, 60);
}

function closeCodeModal() {
  const modal = document.getElementById('code-modal');
  if (modal) modal.style.display = 'none';
}

function autoDetectCodeMeta(text) {
  const titleInput = document.getElementById('code-modal-title');
  const citationInput = document.getElementById('code-modal-citation');
  const langSelect = document.getElementById('code-modal-lang');

  if (/void\s+eval\b|fork\(\)|sigprocmask|setpgid/i.test(text)) {
    if (titleInput && !titleInput.value) titleInput.value = 'CS:APP eval() 进程组与信号掩码实现';
    if (citationInput && !citationInput.value) citationInput.value = 'CS:APP3e 第 8.5.6 节 p.534 (csapp/eval.c)';
    if (langSelect) langSelect.value = 'c';
  } else if (/%rax|movq|pushq|callq|\$0x/i.test(text)) {
    if (titleInput && !titleInput.value) titleInput.value = 'x86-64 汇编指令流片段';
    if (langSelect) langSelect.value = 'assembly';
  } else if (/def\s+\w+\(|import\s+\w+/i.test(text)) {
    if (titleInput && !titleInput.value) titleInput.value = 'Python 算法实现片段';
    if (langSelect) langSelect.value = 'python';
  }
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

      btnCopy.innerText = '复制';
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

    btnCopy.innerText = '已复制';
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

  // 快捷键 E (存为实证) 与 Q (追问概念)
  document.addEventListener('keydown', (e) => {
    const activeEl = document.activeElement;
    if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.isContentEditable)) {
      return;
    }

    if (toolbar.style.display === 'flex' && currentSelectionText) {
      if (e.key === 'e' || e.key === 'E') {
        e.preventDefault();
        btnMaterial.click();
      } else if (e.key === 'q' || e.key === 'Q') {
        e.preventDefault();
        btnInquiry.click();
      }
    }
  });
}

// 打开单卡片沉浸式全屏学术阅读
function openCardFullscreen(node) {
  const modal = document.getElementById('card-modal');
  if (!modal) return;

  const kindNames = {
    material: '文献实证',
    question: '探索课题',
    conclusion: '综合结论',
    source_code: '源码实证',
    hardware_probe: '硬件探针'
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
      ${node.citation ? `<div class="citation-chip" style="margin-top: 16px; font-size: 12.5px; padding: 4px 12px;">证据出处: ${escapeHtml(node.citation)}</div>` : ''}
    `;
  } else if (node.kind === 'source_code') {
    bodyEl.innerHTML = `
      <div class="code-block-wrapper" style="margin-top: 0;">
        <div class="code-block-header">
          <span class="code-lang-tag">${escapeHtml((node.language || 'c').toUpperCase())}</span>
          <button class="code-copy-btn" onclick="copySnippetText('${node.id}', event)">复制代码片段</button>
        </div>
        <pre class="code-pre" style="max-height: 480px; font-size: 13px;">${highlightCode(node.code || node.content || '', node.language || 'c')}</pre>
      </div>
      ${node.citation ? `<div class="citation-chip" style="margin-top: 16px; font-size: 12.5px; padding: 4px 12px;">源码出处: ${escapeHtml(node.citation)}</div>` : ''}
    `;
  } else if (node.kind === 'hardware_probe') {
    bodyEl.innerHTML = `
      ${node.location ? `<div class="probe-loc-badge" style="font-size: 13px; padding: 4px 10px; margin-bottom: 14px;">断点源码位置: ${escapeHtml(node.location)}</div>` : ''}
      <div style="margin-bottom: 14px;">
        <div class="probe-grid-label" style="font-size: 12px; margin-bottom: 6px;">16 个通用寄存器物理状态 (x86-64)</div>
        <div class="reg-grid" style="grid-template-columns: repeat(4, 1fr); padding: 10px; gap: 8px;">
          ${renderRegistersHtml(node.registers)}
        </div>
      </div>
      ${node.disassembly ? `
        <div style="margin-bottom: 14px;">
          <div class="probe-grid-label" style="font-size: 12px; margin-bottom: 6px;">反汇编指令流 ($pc)</div>
          <div class="disasm-box" style="max-height: 220px; font-size: 12px;">${formatDisassemblyHtml(node.disassembly)}</div>
        </div>
      ` : ''}
      ${node.stack ? `
        <div style="margin-bottom: 14px;">
          <div class="probe-grid-label" style="font-size: 12px; margin-bottom: 6px;">栈顶物理内存 Dump ($rsp)</div>
          <pre class="code-pre" style="max-height: 180px; font-size: 11.5px; background: rgba(0,0,0,0.3); border-radius: 4px; padding: 8px;">${escapeHtml(String(node.stack).replace(/\\r\\n|\\n|\\r/g, '\n'))}</pre>
        </div>
      ` : ''}
      ${node.notes ? `<div style="font-size: 12.5px; color: #94a3b8; font-style: italic; margin-top: 10px;">调试断点备注: ${escapeHtml(node.notes)}</div>` : ''}
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
      (node.code ? `\`\`\`${node.language || 'c'}\n${node.code}\n\`\`\`\n\n出处: ${node.citation || ''}\n\n` : '') +
      (node.disassembly ? `### 反汇编\n\`\`\`assembly\n${node.disassembly}\n\`\`\`\n\n` : '') +
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
  const domWidthsMap = {};
  graph.nodes.forEach(n => {
    const el = document.querySelector(`.node[data-id="${n.id}"]`);
    if (el) {
      domHeightsMap[n.id] = el.offsetHeight;
      domWidthsMap[n.id] = el.offsetWidth;
    }
  });

  const layoutResult = calculateSugiyamaLayout(graph.nodes, graph.edges, {
    nodeWidth: 360,
    hGap: 140,
    vGap: 38,
    startX: 60,
    startY: 60,
    domHeightsMap,
    domWidthsMap
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
      updateStatus("拓扑已自动规整为因果分层网络");
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
  // 实时更新顶部导航栏双模型调度胶囊状态
  const reasoningEl = document.getElementById('status-reasoning-name');
  if (reasoningEl && currentConfig.model) {
    const raw = currentConfig.model;
    const shortName = raw.includes('/') ? raw.split('/').pop() : raw;
    reasoningEl.innerText = shortName;
  }
  const visionEl = document.getElementById('status-vision-name');
  if (visionEl) {
    const raw = currentConfig.vision_model || '自动路由';
    const shortName = raw.includes('/') ? raw.split('/').pop() : raw;
    visionEl.innerText = shortName;
  }

  const el = document.getElementById('status-text');
  if (el) el.innerText = text;
}

/**
 * 轻量零构建原生语法高亮器
 * 覆盖 C/C++, x86-64 汇编, Python, Bash, JSON
 */
function highlightCode(code, lang = 'c') {
  if (!code) return '';
  const safeLang = (lang || 'c').toLowerCase().trim();
  let str = escapeHtml(code);

  if (safeLang === 'c' || safeLang === 'cpp' || safeLang === 'c++') {
    const comments = [];
    str = str.replace(/(\/\*[\s\S]*?\*\/|\/\/[^\n]*)/g, (m) => {
      const id = `___COMM${comments.length}___`;
      comments.push(`<span class="tok-comm">${m}</span>`);
      return id;
    });

    const strings = [];
    str = str.replace(/("(\\"|[^"])*?"|'(\\'|[^'])*?')/g, (m) => {
      const id = `___STR${strings.length}___`;
      strings.push(`<span class="tok-str">${m}</span>`);
      return id;
    });

    str = str.replace(/(#\s*(?:include|define|undef|ifdef|ifndef|if|else|elif|endif|pragma)[^\n]*)/g, '<span class="tok-macro">$1</span>');

    const keywords = /\b(return|if|else|switch|case|default|while|do|for|break|continue|goto|sizeof)\b/g;
    str = str.replace(keywords, '<span class="tok-kw">$1</span>');

    const types = /\b(int|char|void|pid_t|sigset_t|size_t|ssize_t|bool|float|double|long|short|unsigned|signed|struct|union|enum|typedef|const|static|volatile|auto|register|uint8_t|uint16_t|uint32_t|uint64_t|int8_t|int16_t|int32_t|int64_t)\b/g;
    str = str.replace(types, '<span class="tok-type">$1</span>');

    const sysCalls = /\b(sigprocmask|Sigprocmask|sigemptyset|sigfillset|sigaddset|sigdelset|sigismember|fork|Fork|execve|Execve|waitpid|Waitpid|kill|Kill|setpgid|Setpgid|signal|Signal|pause|sleep|alarm|printf|fprintf|sprintf|malloc|free|exit)\b/g;
    str = str.replace(sysCalls, '<span class="tok-fn">$1</span>');

    str = str.replace(/\b(0x[0-9a-fA-F]+|\d+)\b/g, '<span class="tok-num">$1</span>');

    strings.forEach((s, i) => { str = str.replace(`___STR${i}___`, s); });
    comments.forEach((c, i) => { str = str.replace(`___COMM${i}___`, c); });
    return str;
  } else if (safeLang === 'assembly' || safeLang === 'asm' || safeLang === 'x86' || safeLang === 'x86_64') {
    str = str.replace(/\b(movq|movl|movw|movb|pushq|popq|callq|call|retq|ret|jmp|je|jne|js|jns|jg|jge|jl|jle|ja|jae|jb|jbe|test|testq|testl|cmp|cmpq|cmpl|addq|addl|subq|subl|leaq|leal|xorq|xorl|andq|andl|orq|orl|nop|syscall|int)\b/gi, '<span class="tok-kw">$1</span>');
    str = str.replace(/(%[a-z0-9]+)/gi, '<span class="tok-reg">$1</span>');
    str = str.replace(/(\$(?:0x[0-9a-fA-F]+|\d+))/g, '<span class="tok-num">$1</span>');
    str = str.replace(/(#[^\n]*|\/\/[^\n]*)/g, '<span class="tok-comm">$1</span>');
    return str;
  } else if (safeLang === 'python' || safeLang === 'py') {
    str = str.replace(/(#[^\n]*)/g, '<span class="tok-comm">$1</span>');
    str = str.replace(/("(\\"|[^"])*?"|'(\\'|[^'])*?')/g, '<span class="tok-str">$1</span>');
    str = str.replace(/\b(def|class|import|from|return|if|elif|else|while|for|in|try|except|finally|with|as|pass|break|continue|lambda|yield|async|await|None|True|False|is|not|and|or)\b/g, '<span class="tok-kw">$1</span>');
    str = str.replace(/\b(0x[0-9a-fA-F]+|\d+)\b/g, '<span class="tok-num">$1</span>');
    return str;
  } else if (safeLang === 'bash' || safeLang === 'sh' || safeLang === 'shell') {
    str = str.replace(/(#[^\n]*)/g, '<span class="tok-comm">$1</span>');
    str = str.replace(/("(\\"|[^"])*?"|'(\\'|[^'])*?')/g, '<span class="tok-str">$1</span>');
    str = str.replace(/\b(echo|cd|ls|export|source|if|then|fi|elif|else|for|in|do|done|while|case|esac|exit|set|shift)\b/g, '<span class="tok-kw">$1</span>');
    return str;
  }

  return str;
}

window.copyRawCodeBlock = function(btn, event) {
  if (event) event.stopPropagation();
  const wrapper = btn.closest('.code-block-wrapper');
  if (!wrapper) return;
  const stash = wrapper.querySelector('.raw-code-stash');
  const text = stash ? stash.value : wrapper.querySelector('.code-pre').innerText;
  navigator.clipboard.writeText(text).then(() => {
    const old = btn.innerText;
    btn.innerText = '已复制';
    btn.style.color = '#34d399';
    setTimeout(() => {
      btn.innerText = old;
      btn.style.color = '';
    }, 1500);
  }).catch(() => {
    alert("复制失败，请手动选择复制。");
  });
};

window.copySnippetText = function(nodeId, event) {
  if (event) event.stopPropagation();
  const node = graph.nodes.find(n => n.id === nodeId);
  if (!node) return;
  const text = node.code || node.content || '';
  navigator.clipboard.writeText(text).then(() => {
    updateStatus("已复制源码片段至剪贴板！");
  }).catch(() => {
    alert("复制失败，请手动选择复制。");
  });
};

window.toggleCodeWrap = function(btn, nodeId, event) {
  if (event) event.stopPropagation();
  const node = graph.nodes.find(n => n.id === nodeId);
  if (!node) return;
  node.isWrap = !node.isWrap;
  const card = document.querySelector(`.node[data-id="${nodeId}"]`);
  if (card) {
    const pre = card.querySelector('.code-pre');
    if (pre) {
      pre.classList.toggle('wrap-lines', !!node.isWrap);
    }
  }
  if (btn) {
    btn.classList.toggle('active', !!node.isWrap);
  }
  updateConnectedEdges(nodeId);
  saveGraph();
  updateStatus(node.isWrap ? "已开启源码自适应折行" : "已恢复源码单行代码流");
};

window.toggleDisasmWrap = function(btn, nodeId, event) {
  if (event) event.stopPropagation();
  const node = graph.nodes.find(n => n.id === nodeId);
  if (!node) return;
  node.isDisasmWrap = !node.isDisasmWrap;
  const card = document.querySelector(`.node[data-id="${nodeId}"]`);
  if (card) {
    const disasmBox = card.querySelector('.disasm-box');
    if (disasmBox) {
      disasmBox.classList.toggle('wrap-lines', !!node.isDisasmWrap);
    }
  }
  if (btn) {
    btn.classList.toggle('active', !!node.isDisasmWrap);
  }
  updateConnectedEdges(nodeId);
  saveGraph();
  updateStatus(node.isDisasmWrap ? "已开启反汇编自适应折行" : "已恢复反汇编单行指令流");
};

window.toggleNodeWidth = function(nodeId, event) {
  if (event) event.stopPropagation();
  const node = graph.nodes.find(n => n.id === nodeId);
  if (!node) return;
  const card = document.querySelector(`.node[data-id="${nodeId}"]`);
  if (!card) return;

  const defaultWidth = (node.kind === 'source_code' || node.kind === 'hardware_probe') ? 440 : 360;
  const expandedWidth = 580;

  const currentW = node.width || card.offsetWidth || defaultWidth;
  let newW = defaultWidth;
  if (currentW < 520) {
    newW = expandedWidth;
  } else {
    newW = defaultWidth;
  }

  node.width = newW;
  card.style.width = newW + 'px';
  updateConnectedEdges(node.id);
  saveGraph();
  updateStatus(newW > defaultWidth ? "已展开宽屏卡片模式 (580px)" : "已恢复紧凑卡片宽度");
};

function renderRegistersHtml(regs) {
  if (!regs) return '<div style="color: #64748b; font-size: 10px; grid-column: span 2;">(无寄存器数据)</div>';
  let entries = [];
  if (typeof regs === 'object' && !Array.isArray(regs)) {
    entries = Object.entries(regs);
  } else if (typeof regs === 'string') {
    const lines = regs.split(/\r?\n|\s{2,}/);
    lines.forEach(l => {
      const match = l.match(/([%a-zA-Z0-9_]+)[:=\s]+(0x[0-9a-fA-F]+|\d+)/);
      if (match) entries.push([match[1], match[2]]);
    });
  }
  if (entries.length === 0) {
    return `<div style="color: #94a3b8; font-size: 10px; grid-column: span 2;">${escapeHtml(String(regs))}</div>`;
  }
  return entries.slice(0, 16).map(([name, val]) => `
    <div class="reg-item">
      <span class="reg-name">${escapeHtml(name.replace(/^%/, ''))}</span>
      <span class="reg-val">${escapeHtml(String(val))}</span>
    </div>
  `).join('');
}

function formatDisassemblyHtml(disasm) {
  if (!disasm) return '';
  // 规范化换行：自适应兼容真实换行符 (\n) 与 JSON 序列化误转义的字面量 ("\\n")
  let text = String(disasm);
  text = text.replace(/\\r\\n|\\n|\\r/g, '\n');
  const lines = text.split(/\r?\n/);
  return lines.map(line => {
    const isTarget = line.includes('=>') || line.trim().startsWith('->');
    const safeLine = escapeHtml(line);
    if (isTarget) {
      return `<span class="disasm-active-line">${safeLine}</span>`;
    }
    return safeLine;
  }).join('\n');
}

function renderMarkdown(text) {
  if (!text) return '';

  const codeBlocks = [];
  const inlineCodes = [];
  const mathTokens = [];

  // 1. 优先提取并隔离块级代码: ```lang\n...\n``` (防止 * / _ / $ 误转)
  let processed = text.replace(/```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g, (match, lang, code) => {
    const id = `@@FENCEDCODE_${codeBlocks.length}@@`;
    codeBlocks.push({ lang: lang || 'c', code });
    return id;
  });

  // 2. 提取并隔离行内代码: `...`
  processed = processed.replace(/`([^`\n]+?)`/g, (match, code) => {
    const id = `@@INLINECODE_${inlineCodes.length}@@`;
    inlineCodes.push(code);
    return id;
  });

  // 3. 提取并预渲染块级公式: $$...$$ 或 \[...\]
  processed = processed
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

  // 4. 提取并预渲染行内公式: $...$ 或 \(...\)
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

  // 5. 执行 marked Markdown 解析（@@...@@ 绝不会被 marked 误判为粗体、斜体或指针转义）
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

  // 6. 还原块级代码与语法高亮
  codeBlocks.forEach(({ lang, code }, idx) => {
    const id = `@@FENCEDCODE_${idx}@@`;
    const snippetId = `snippet_${Date.now()}_${idx}`;
    const highlighted = highlightCode(code.trim(), lang);
    const codeHtml = `
      <div class="code-block-wrapper" id="${snippetId}">
        <div class="code-block-header">
          <span class="code-lang-tag">${escapeHtml((lang || 'code').toUpperCase())}</span>
          <button class="code-copy-btn" onclick="copyRawCodeBlock(this, event)">复制</button>
        </div>
        <pre class="code-pre"><code>${highlighted}</code></pre>
        <textarea class="raw-code-stash" style="display: none;">${escapeHtml(code)}</textarea>
      </div>
    `;
    html = html.split(id).join(codeHtml);
  });

  // 7. 还原行内代码
  inlineCodes.forEach((code, idx) => {
    const id = `@@INLINECODE_${idx}@@`;
    const inlineHtml = `<code class="inline-code-badge">${escapeHtml(code)}</code>`;
    html = html.split(id).join(inlineHtml);
  });

  // 8. 将预渲染好的 KaTeX 纯净 HTML 节点安全还原回流
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
