/**
 * AxiomFlow 系统级微观物理可视化原语库 (System Domain Primitives)
 * 
 * 面向 CS:APP、计算机体系结构、操作系统核心机理的标准化 UI 原语。
 * 纯函数声明，零打包依赖，注入全局一致的高对比度学术风格。
 */

let primitivesStylesInjected = false;

function injectPrimitiveStyles() {
  if (primitivesStylesInjected) return;
  primitivesStylesInjected = true;

  const style = document.createElement('style');
  style.id = 'tracer-primitives-styles';
  style.textContent = `
    /* 代码展示盒 */
    .sp-code-box {
      background: #090d16;
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 6px;
      padding: 10px 12px;
      font-family: "JetBrains Mono", "Fira Code", Cascadia, Menlo, Consolas, monospace;
      font-size: 12px;
      line-height: 1.5;
      color: #e2e8f0;
      overflow-x: auto;
      white-space: pre-wrap;
      position: relative;
    }
    .sp-code-title {
      font-size: 10.5px;
      font-weight: 700;
      color: var(--accent-blue, #38bdf8);
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 6px;
    }

    /* 系统映射表 (三表联动、页表、Cache 行) */
    .sp-card {
      background: rgba(0, 0, 0, 0.25);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 6px;
      padding: 10px 12px;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .sp-card-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 4px;
    }
    .sp-card-title {
      font-size: 12px;
      font-weight: 700;
      color: #cbd5e1;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .sp-card-subtitle {
      font-size: 10.5px;
      color: var(--text-secondary, #94a3b8);
    }
    .sp-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 11.5px;
      text-align: left;
    }
    .sp-table th {
      color: var(--text-secondary, #94a3b8);
      font-weight: 600;
      border-bottom: 1px solid rgba(255, 255, 255, 0.12);
      padding: 5px 6px;
      font-size: 11px;
    }
    .sp-table td {
      padding: 5px 6px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.04);
      color: #e2e8f0;
    }
    .sp-table tr.active {
      background: rgba(56, 189, 248, 0.12);
      color: #7dd3fc;
    }
    .sp-table tr.active td {
      color: #7dd3fc;
      font-weight: 600;
    }
    .sp-table tr.leak {
      background: rgba(239, 68, 68, 0.15);
      color: #fca5a5;
    }
    .sp-table tr.leak td {
      color: #fca5a5;
      font-weight: 600;
    }

    /* 引用计数胶囊徽章 */
    .sp-refcnt-badge {
      display: inline-block;
      font-family: monospace;
      font-weight: 700;
      font-size: 11px;
      padding: 1px 7px;
      border-radius: 10px;
      background: #0284c7;
      color: #ffffff;
      min-width: 16px;
      text-align: center;
      transition: all 0.25s ease;
    }
    .sp-refcnt-badge.pulse {
      animation: sp-pulse 0.6s ease;
    }
    .sp-refcnt-badge.zero {
      background: #475569;
      color: #94a3b8;
    }
    .sp-refcnt-badge.warning {
      background: #ef4444;
      color: #ffffff;
      box-shadow: 0 0 8px rgba(239, 68, 68, 0.5);
    }
    @keyframes sp-pulse {
      0% { transform: scale(1); }
      50% { transform: scale(1.35); box-shadow: 0 0 12px #38bdf8; }
      100% { transform: scale(1); }
    }

    /* 状态机徽标 */
    .sp-fsm-badge {
      display: inline-block;
      font-size: 12px;
      font-weight: 700;
      font-family: monospace;
      padding: 3px 10px;
      border-radius: 4px;
      letter-spacing: 0.5px;
    }
    .sp-fsm-emerald { background: rgba(16, 185, 129, 0.2); color: #34d399; border: 1px solid #10b981; }
    .sp-fsm-sky { background: rgba(56, 189, 248, 0.2); color: #38bdf8; border: 1px solid #0284c7; }
    .sp-fsm-slate { background: rgba(148, 163, 184, 0.15); color: #cbd5e1; border: 1px solid #64748b; }
    .sp-fsm-red { background: rgba(239, 68, 68, 0.25); color: #fca5a5; border: 2px dashed #ef4444; }
    .sp-fsm-amber { background: rgba(245, 158, 11, 0.2); color: #fde68a; border: 1px solid #f59e0b; }

    /* 结论与反事实警告卡 */
    .sp-summary-card {
      font-size: 12.5px;
      line-height: 1.55;
      background: rgba(14, 165, 233, 0.08);
      border: 1px solid rgba(14, 165, 233, 0.25);
      border-left: 4px solid #0284c7;
      padding: 10px 14px;
      border-radius: 4px;
      color: var(--text-primary, #f1f5f9);
    }
    .sp-summary-card.warning {
      border-left-color: #ef4444;
      background: rgba(239, 68, 68, 0.12);
      border-color: rgba(239, 68, 68, 0.35);
      color: #fca5a5;
    }

    /* 地址拆解位域条带 */
    .sp-bitfield-container {
      display: flex;
      flex-direction: column;
      gap: 6px;
      background: rgba(0, 0, 0, 0.3);
      padding: 10px 12px;
      border-radius: 6px;
      border: 1px solid rgba(255, 255, 255, 0.08);
    }
    .sp-bitfield-strip {
      display: flex;
      width: 100%;
      height: 36px;
      border-radius: 4px;
      overflow: hidden;
      border: 1px solid rgba(255, 255, 255, 0.15);
    }
    .sp-bitfield-chunk {
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      font-family: monospace;
      font-size: 11px;
      font-weight: 700;
      color: #ffffff;
      border-right: 1px solid rgba(255, 255, 255, 0.2);
      transition: flex-grow 0.2s ease;
    }
    .sp-bitfield-chunk:last-child {
      border-right: none;
    }
    .sp-bitfield-chunk-label {
      font-size: 9px;
      opacity: 0.85;
      font-weight: 400;
    }

    /* 连续内存条带 */
    .sp-memory-tape {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 8px 10px;
      background: rgba(0, 0, 0, 0.25);
      border-radius: 6px;
      border: 1px solid rgba(255, 255, 255, 0.08);
      overflow-x: auto;
    }
    .sp-memory-block {
      padding: 6px 10px;
      border-radius: 4px;
      border: 1px solid rgba(255, 255, 255, 0.15);
      font-family: monospace;
      font-size: 11px;
      display: flex;
      flex-direction: column;
      align-items: center;
      min-width: 50px;
    }

    /* Light Theme Adaptations */
    [data-theme="light"] .sp-code-box {
      background: #f8fafc;
      border-color: #cbd5e1;
      color: #1e293b;
    }
    [data-theme="light"] .sp-card {
      background: #ffffff;
      border-color: #e2e8f0;
    }
    [data-theme="light"] .sp-card-title {
      color: #1e293b;
    }
    [data-theme="light"] .sp-table th {
      color: #64748b;
      border-bottom-color: #cbd5e1;
    }
    [data-theme="light"] .sp-table td {
      color: #1e293b;
      border-bottom-color: #f1f5f9;
    }
    [data-theme="light"] .sp-table tr.active {
      background: #e0f2fe;
      color: #0369a1;
    }
    [data-theme="light"] .sp-table tr.active td {
      color: #0369a1;
    }
    [data-theme="light"] .sp-summary-card {
      background: #f0f9ff;
      border-color: #bae6fd;
      color: #0369a1;
    }
    [data-theme="light"] .sp-summary-card.warning {
      background: #fef2f2;
      border-color: #fecaca;
      color: #b91c1c;
    }
  `;
  document.head.appendChild(style);
}

// 转义 HTML 字符
export function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * 渲染系统调用/汇编代码块
 */
export function renderSyscallBox(code, options = {}) {
  injectPrimitiveStyles();
  const { title = '系统调用 / 执行流' } = options;
  return `
    <div class="sp-code-box">
      ${title ? `<div class="sp-code-title">${escapeHtml(title)}</div>` : ''}
      <code>${escapeHtml(code)}</code>
    </div>
  `;
}

/**
 * 渲染通用物理映射表 (Descriptor Table, Open File Table, Page Table, etc.)
 */
export function renderMappingTable(options = {}) {
  injectPrimitiveStyles();
  const {
    title = '内核映射表',
    subtitle = '',
    headers = [],
    rows = [],
    emptyText = '无活跃条目'
  } = options;

  let headersHtml = headers.map(h => `<th>${escapeHtml(h)}</th>`).join('');
  let rowsHtml = '';

  if (!rows || rows.length === 0) {
    rowsHtml = `<tr><td colspan="${headers.length || 1}" style="text-align: center; color: #64748b; padding: 12px;">${escapeHtml(emptyText)}</td></tr>`;
  } else {
    rowsHtml = rows.map(r => {
      const isRowActive = r.active;
      const isRowLeak = r.leak;
      const trClass = isRowLeak ? 'leak' : (isRowActive ? 'active' : '');
      const cellsHtml = (r.cells || []).map(c => `<td>${c}</td>`).join('');
      return `<tr class="${trClass}">${cellsHtml}</tr>`;
    }).join('');
  }

  return `
    <div class="sp-card">
      <div class="sp-card-header">
        <span class="sp-card-title">${escapeHtml(title)}</span>
        ${subtitle ? `<span class="sp-card-subtitle">${escapeHtml(subtitle)}</span>` : ''}
      </div>
      <table class="sp-table">
        <thead><tr>${headersHtml}</tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    </div>
  `;
}

/**
 * 渲染引用计数徽章
 */
export function renderRefcntBadge(count, options = {}) {
  injectPrimitiveStyles();
  const { pulse = false, isLeak = false } = options;
  let cls = 'sp-refcnt-badge';
  if (pulse) cls += ' pulse';
  if (count === 0) cls += ' zero';
  if (isLeak) cls += ' warning';
  return `<span class="${cls}">${count}</span>`;
}

/**
 * 渲染有限状态机徽标
 */
export function renderFSMStatus(state, options = {}) {
  injectPrimitiveStyles();
  const { theme = 'sky', label = state } = options;
  let colorClass = 'sp-fsm-sky';
  if (theme === 'emerald' || state === 'LISTEN' || state === 'HIT') colorClass = 'sp-fsm-emerald';
  if (theme === 'slate' || state === 'CLOSED' || state === 'INVALID') colorClass = 'sp-fsm-slate';
  if (theme === 'red' || state === 'ERROR' || state === 'MISS' || state === 'FAULT') colorClass = 'sp-fsm-red';
  if (theme === 'amber' || state === 'DIRTY' || state === 'PENDING') colorClass = 'sp-fsm-amber';
  return `<span class="sp-fsm-badge ${colorClass}">${escapeHtml(label)}</span>`;
}

/**
 * 渲染物理断言与教学总结卡片
 */
export function renderSummaryCard(options = {}) {
  injectPrimitiveStyles();
  const { text = '', isWarning = false, badge = null } = options;
  return `
    <div class="sp-summary-card ${isWarning ? 'warning' : ''}">
      ${badge ? `<div style="margin-bottom: 4px;">${badge}</div>` : ''}
      <div>${text}</div>
    </div>
  `;
}

/**
 * 渲染物理地址/位域拆分条带 (Cache Tag/Index/Offset, Page Table VPN/VPO)
 */
export function renderAddressBitfield(options = {}) {
  injectPrimitiveStyles();
  const {
    addressHex = '0x00000000',
    title = '地址解码与位域映射 (Bitfield Breakdown)',
    fields = []
  } = options;

  const chunksHtml = fields.map(f => {
    const flexVal = f.bits || 1;
    const bg = f.bg || '#0284c7';
    return `
      <div class="sp-bitfield-chunk" style="flex: ${flexVal}; background: ${bg};" title="${escapeHtml(f.desc || '')}">
        <span>${escapeHtml(f.name)} (${f.bits}b)</span>
        <span class="sp-bitfield-chunk-label">${escapeHtml(f.valHex || '')}</span>
      </div>
    `;
  }).join('');

  return `
    <div class="sp-bitfield-container">
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <span style="font-size: 11.5px; font-weight: 700; color: #cbd5e1;">${escapeHtml(title)}</span>
        <span style="font-family: monospace; font-size: 12px; font-weight: 700; color: #38bdf8;">${escapeHtml(addressHex)}</span>
      </div>
      <div class="sp-bitfield-strip">
        ${chunksHtml}
      </div>
    </div>
  `;
}
