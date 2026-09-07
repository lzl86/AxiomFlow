#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
AxiomFlow Zero-Build Explorable Tracer Scaffold Generator
命令行脚手架工具：依据标准 ESM 规范与运行时底座，秒级生成新的可探索微观沙盒骨架。
"""

import sys
import os
import argparse
from pathlib import Path

# Windows 终端 UTF-8 编码守卫
if sys.platform.startswith("win") and hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

TRACER_TEMPLATE = """/**
 * {title}
 * {subtitle}
 *
 * 基于 AxiomFlow Tracer Runtime & System Primitives 驱动
 * 纯原生 ES Module 规范，零构建开箱即用。
 */

import {{ createSteppedTracer }} from './core/tracer_runtime.js';
import {{
  escapeHtml,
  renderSyscallBox,
  renderMappingTable,
  renderRefcntBadge,
  renderFSMStatus,
  renderSummaryCard,
  renderAddressBitfield
}} from './core/system_primitives.js';

// ==========================================
// 1. 物理机理时序步骤定义 (Steps Sequence)
// ==========================================

const STEPS = [
  {{
    id: 0,
    title: "Step 0: 系统初始状态",
    code: "// 初始化硬件/内核数据结构\\nint status = 0;",
    summary: "展示系统启动或操作前夕的基准物理状态。",
    fsm: {{ state: "INIT", label: "INIT", theme: "slate" }},
    tableRows: [
      {{ cells: ["0", "Entry 0", "Ready", renderRefcntBadge(1)], active: false }}
    ]
  }},
  {{
    id: 1,
    title: "Step 1: 核心操作执行",
    code: "// 执行第一阶段状态转移\\nstatus = 1;",
    summary: "关键操作触发，表项状态与状态机发生跃迁更新。",
    fsm: {{ state: "RUNNING", label: "RUNNING", theme: "sky" }},
    tableRows: [
      {{ cells: ["0", "Entry 0", "Busy", renderRefcntBadge(2, {{ pulse: true }})], active: true }}
    ]
  }},
  {{
    id: 2,
    title: "Step 2: 状态收敛与终结",
    code: "// 操作完成，资源回收\\nstatus = 0;",
    summary: "验证教学断言：正常状态下资源被安全回收，无泄漏。",
    fsm: {{ state: "CLOSED", label: "CLOSED", theme: "emerald" }},
    tableRows: [
      {{ cells: ["0", "Entry 0", "Closed", renderRefcntBadge(0)], active: false }}
    ]
  }}
];

// ==========================================
// 2. 导出标准微观沙盒挂载器
// ==========================================

export const mountTracer = createSteppedTracer({{
  id: '{tracer_id}',
  title: '{title}',
  subtitle: '{subtitle}',
  steps: STEPS,
  whatIf: {{
    label: '反事实推演：异常/泄漏分支',
    desc: '开启后模拟异常未回收或资源竞争分支',
    default: false
  }},
  renderView: (viewContainer, currentStep, state) => {{
    const isWhatIf = state.isWhatIf;
    
    // 若开启反事实推演且处于收尾步骤，模拟异常分支
    let isWarning = false;
    let summaryText = currentStep.summary;
    let tableRows = currentStep.tableRows;
    let fsm = currentStep.fsm;

    if (isWhatIf && currentStep.id === 2) {{
      isWarning = true;
      summaryText = "【反事实异常爆发】未执行显式回收，引用计数未归零，引发资源持久泄漏与半死锁！";
      fsm = {{ state: "ERROR", label: "LEAK", theme: "red" }};
      tableRows = [
        {{ cells: ["0", "Entry 0", "LEAKED", renderRefcntBadge(1, {{ isLeak: true }})], leak: true }}
      ];
    }}

    viewContainer.innerHTML = `
      ${{renderSyscallBox(currentStep.code, {{ title: '执行代码 / 硬件时序' }})}}

      <div style="display: grid; grid-template-columns: 2fr 1fr; gap: 10px;">
        <div>
          ${{renderMappingTable({{
            title: '核心状态表',
            headers: ['ID', '条目描述', '状态', '引用'],
            rows: tableRows
          }})}}
        </div>
        <div style="display: flex; flex-direction: column; gap: 10px;">
          <div class="sp-card" style="align-items: center; justify-content: center; text-align: center; min-height: 80px;">
            <div style="font-size: 11px; color: var(--text-secondary); margin-bottom: 4px;">状态机跃迁</div>
            ${{renderFSMStatus(fsm.state, {{ label: fsm.label, theme: fsm.theme }})}}
          </div>
        </div>
      </div>

      ${{renderSummaryCard({{
        text: summaryText,
        isWarning: isWarning
      }})}}
    `;
  }}
}});
"""

def main():
    parser = argparse.ArgumentParser(description="AxiomFlow Tracer Scaffold Generator")
    parser.add_argument("--name", required=True, help="沙盒标识符 (如 cache_direct_mapped)")
    parser.add_argument("--title", required=True, help="沙盒主标题")
    parser.add_argument("--subtitle", default="", help="沙盒副标题 / 教学断言")
    parser.add_argument("--out-dir", default="public/tracers", help="输出目录 (默认 public/tracers)")
    args = parser.parse_args()

    clean_name = args.name.lower().replace("-", "_").replace(".js", "")
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    target_file = out_dir / f"{clean_name}.js"
    if target_file.exists():
        print(f"[-] [WARN] 目标文件已存在: {target_file}")
        confirm = input("是否覆盖？(y/N): ").strip().lower()
        if confirm != 'y':
            print("[-] 已取消操作。")
            return 0

    content = TRACER_TEMPLATE.format(
        tracer_id=clean_name,
        title=args.title,
        subtitle=args.subtitle
    )

    with open(target_file, "w", encoding="utf-8") as f:
        f.write(content)

    print(f"[+] [OK] 成功生成微观沙盒模块: {target_file}")
    print(f"[*] 可直接在前端通过 import('/tracers/{clean_name}.js') 原生挂载。")
    return 0

if __name__ == "__main__":
    sys.exit(main())
