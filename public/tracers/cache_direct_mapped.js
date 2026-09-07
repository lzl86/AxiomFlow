/**
 * 直接映射 Cache 命中与缺失单步推演 (CS:APP 第 6 章：存储器层次结构)
 * 
 * 基于 AxiomFlow Tracer Runtime & System Primitives 驱动
 * 纯原生 ES Module 规范，零构建开箱即用。
 */

import { createSteppedTracer } from './core/tracer_runtime.js';
import {
  escapeHtml,
  renderSyscallBox,
  renderMappingTable,
  renderRefcntBadge,
  renderFSMStatus,
  renderSummaryCard,
  renderAddressBitfield
} from './core/system_primitives.js';

// ==========================================
// 1. 物理机理时序步骤定义 (Steps Sequence)
// 8-bit 地址规范：Tag (4 bits) | Set Index (2 bits) | Block Offset (2 bits)
// 4 个 Cache 组 (Set 0~3)，每组 1 行 (Direct Mapped)，块大小 4 字节
// ==========================================

const STEPS = [
  {
    id: 0,
    title: "Step 0: 初始冷状态 (Cold Cache)",
    code: "// 系统启动 / 进程首次加载\\n// Cache 处于冷态，所有组的有效位 Valid 均为 0",
    summary: "初始状态下，Cache 中的所有槽位均未缓存任何物理内存数据。有效位 Valid 全部为 0，Tag 尚未绑定。",
    address: { hex: "0x00", tag: "0x0", set: "0", offset: "0" },
    fsm: { state: "INVALID", label: "COLD", theme: "slate" },
    lines: [
      { set: 0, valid: 0, tag: "-", data: "[空]", active: false },
      { set: 1, valid: 0, tag: "-", data: "[空]", active: false },
      { set: 2, valid: 0, tag: "-", data: "[空]", active: false },
      { set: 3, valid: 0, tag: "-", data: "[空]", active: false }
    ]
  },
  {
    id: 1,
    title: "Step 1: 首次访问 0x34 (冷缺失 Cold Miss)",
    code: "movb 0x34, %al  // 读取内存物理地址 0x34\\n// 0x34 = 0011 01 00 (Tag: 3, Set: 1, Offset: 0)",
    summary: "硬件解码地址：Set Index = 1，检查组 1。发现 Valid = 0，判定为【冷不命中 (Cold Miss)】。CPU 暂停并向内存总线发起块加载，将内存 [0x34~0x37] 载入组 1，置 Valid = 1，Tag = 0x3。",
    address: { hex: "0x34", tag: "0x3", set: "1", offset: "0" },
    fsm: { state: "MISS", label: "COLD MISS", theme: "red" },
    lines: [
      { set: 0, valid: 0, tag: "-", data: "[空]", active: false },
      { set: 1, valid: 1, tag: "0x3", data: "Mem[0x34..37]", active: true },
      { set: 2, valid: 0, tag: "-", data: "[空]", active: false },
      { set: 3, valid: 0, tag: "-", data: "[空]", active: false }
    ]
  },
  {
    id: 2,
    title: "Step 2: 空间局部性命中 0x35 (命中 Cache Hit)",
    code: "movb 0x35, %bl  // 读取临近地址 0x35\\n// 0x35 = 0011 01 01 (Tag: 3, Set: 1, Offset: 1)",
    summary: "解码地址：Set Index = 1，检查组 1。发现 Valid = 1 且 Tag 匹配 (0x3 == 0x3)，判定为【缓存命中 (Cache Hit)】！直接从 Cache 偏移 1 处瞬时读取字节，零内存等待开销！",
    address: { hex: "0x35", tag: "0x3", set: "1", offset: "1" },
    fsm: { state: "HIT", label: "CACHE HIT", theme: "emerald" },
    lines: [
      { set: 0, valid: 0, tag: "-", data: "[空]", active: false },
      { set: 1, valid: 1, tag: "0x3", data: "Mem[0x34..37]", active: true },
      { set: 2, valid: 0, tag: "-", data: "[空]", active: false },
      { set: 3, valid: 0, tag: "-", data: "[空]", active: false }
    ]
  },
  {
    id: 3,
    title: "Step 3: 访问 0x74 (冲突缺失与驱逐 Conflict Miss)",
    code: "movb 0x74, %cl  // 读取冲突地址 0x74\\n// 0x74 = 0111 01 00 (Tag: 7, Set: 1, Offset: 0)",
    summary: "解码地址：Set Index = 1，检查组 1。Valid = 1，但 Tag 不匹配 (0x7 != 0x3)！在直接映射 Cache 中，组 1 仅能容纳 1 行，必须强制驱逐原有 0x3 块，替换为 0x7 块！",
    address: { hex: "0x74", tag: "0x7", set: "1", offset: "0" },
    fsm: { state: "MISS", label: "CONFLICT MISS", theme: "amber" },
    lines: [
      { set: 0, valid: 0, tag: "-", data: "[空]", active: false },
      { set: 1, valid: 1, tag: "0x7", data: "Mem[0x74..77]", active: true },
      { set: 2, valid: 0, tag: "-", data: "[空]", active: false },
      { set: 3, valid: 0, tag: "-", data: "[空]", active: false }
    ]
  }
];

// ==========================================
// 2. 导出标准微观沙盒挂载器
// ==========================================

export const mountTracer = createSteppedTracer({
  id: 'cache_direct_mapped',
  title: '直接映射 Cache 命中与缺失单步推演',
  subtitle: 'CS:APP 第 6 章：8-bit 体系结构下 Tag / Set Index / Offset 硬件地址解码与行替换机制',
  steps: STEPS,
  whatIf: {
    label: '反事实推演：交替读 0x34 与 0x74 触发颠簸 (Thrashing)',
    desc: '模拟内层循环交替访问同组不同 Tag 的数组，引发 100% 冲突缺失',
    default: false
  },
  renderView: (viewContainer, currentStep, state) => {
    const isWhatIf = state.isWhatIf;
    
    let isWarning = false;
    let summaryText = currentStep.summary;
    let lines = currentStep.lines;
    let fsm = currentStep.fsm;

    if (isWhatIf && currentStep.id === 3) {
      isWarning = true;
      summaryText = "【反事实性能灾难·Cache 颠簸 (Thrashing)】程序在循环中交替访问 0x34 与 0x74。由于两地址的 Set Index 均为 1，它们在直接映射 Cache 中不断相互驱逐，导致缓存命中率直接暴跌至 0%！CPI 剧增 20 倍！";
      fsm = { state: "ERROR", label: "THRASHING (0% HIT)", theme: "red" };
    }

    const tableRows = lines.map(line => {
      const validBadge = line.valid 
        ? `<span style="color: #34d399; font-weight: bold;">1 (有效)</span>` 
        : `<span style="color: #64748b;">0 (无效)</span>`;
      return {
        active: line.active,
        cells: [
          `Set ${line.set}`,
          validBadge,
          `<span style="font-family: monospace; color: #38bdf8;">${escapeHtml(line.tag)}</span>`,
          `<span style="font-family: monospace; color: #cbd5e1;">${escapeHtml(line.data)}</span>`
        ]
      };
    });

    const bitfields = [
      { name: "Tag 标记", bits: 4, valHex: currentStep.address.tag, bg: "#0284c7", desc: "用于匹配当前组内是否为目标块" },
      { name: "Set 组索引", bits: 2, valHex: "Set " + currentStep.address.set, bg: "#6366f1", desc: "决定硬件寻址哪一个 Cache 组" },
      { name: "Offset 块内偏", bits: 2, valHex: "+" + currentStep.address.offset + "B", bg: "#10b981", desc: "决定从 4 字节块中提取哪一个字节" }
    ];

    viewContainer.innerHTML = `
      ${renderSyscallBox(currentStep.code, { title: 'CPU 机器指令 / 内存总线事务' })}

      ${renderAddressBitfield({
        addressHex: currentStep.address.hex,
        title: 'CPU 地址总线解码 (8-bit Address Breakdown)',
        fields: bitfields
      })}

      <div style="display: grid; grid-template-columns: 2fr 1fr; gap: 10px;">
        <div>
          ${renderMappingTable({
            title: 'S=4, E=1, B=4 直接映射 Cache 阵列',
            subtitle: '4 组 · 每组 1 行 · 块大小 4 字节',
            headers: ['组索引 (Set)', '有效位 (Valid)', 'Tag 标记', '数据块 (Block Data)'],
            rows: tableRows
          })}
        </div>
        <div style="display: flex; flex-direction: column; gap: 10px;">
          <div class="sp-card" style="align-items: center; justify-content: center; text-align: center; min-height: 100px;">
            <div style="font-size: 11px; color: var(--text-secondary); margin-bottom: 6px;">硬件命中状态机</div>
            ${renderFSMStatus(fsm.state, { label: fsm.label, theme: fsm.theme })}
            <div style="font-size: 10.5px; color: #94a3b8; margin-top: 8px;">
              ${fsm.state === 'HIT' ? '单周期 L1 命中返回' : (fsm.state === 'INVALID' ? '等待总线请求' : '总线阻塞，开销 100+ 周期')}
            </div>
          </div>
        </div>
      </div>

      ${renderSummaryCard({
        text: summaryText,
        isWarning: isWarning
      })}
    `;
  }
});
