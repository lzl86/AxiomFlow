/**
 * socket_lifecycle.js - AxiomFlow Explorable Sandbox
 * 
 * CS:APP Chapter 10 & 11: Concurrent Socket Descriptor Lifecycle & Kernel Reference Counting
 * Implements Bret Victor's "Explorable Explanations" paradigm.
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
  renderSummaryCard
} from './core/system_primitives.js';

// ==========================================
// 1. 物理机理时序步骤定义 (Steps Sequence)
// 依据 CS:APP 10.8, 11.4.9, 12.1.1 核心内核数据结构
// ==========================================

const STEPS = [
  {
    id: 0,
    title: "Step 0: 服务器初始态 (Server Initialization)",
    syscall: "// 服务器进程启动 (PID 1000)\nint listenfd, connfd;\nstruct sockaddr_storage clientaddr;",
    summary: "父进程 (PID 1000) 启动，内核为其分配 task_struct 和 files_struct。描述符表默认开启标准输入(0)、标准输出(1)、标准错误(2)。",
    parentFds: [
      { fd: 0, name: "stdin", target: "terminal_in" },
      { fd: 1, name: "stdout", target: "terminal_out" },
      { fd: 2, name: "stderr", target: "terminal_err" }
    ],
    childFds: null,
    openFiles: [
      { id: "terminal_in", type: "tty", name: "/dev/tty", refcnt: 1, info: "只读控制台" },
      { id: "terminal_out", type: "tty", name: "/dev/tty", refcnt: 1, info: "只写控制台" },
      { id: "terminal_err", type: "tty", name: "/dev/tty", refcnt: 1, info: "只写控制台" }
    ],
    tcpState: { state: "NONE", label: "尚未调用", desc: "尚未创建套接字" },
    highlight: "init"
  },
  {
    id: 1,
    title: "Step 1: 创建监听套接字 listenfd = socket()",
    syscall: "listenfd = socket(AF_INET, SOCK_STREAM, 0);\n// 内核分配可用最小描述符 fd 3",
    summary: "内核在打开文件表创建新条目，关联底层网络设备结构，refcnt 设为 1。返回描述符 3 (listenfd) 给父进程。",
    parentFds: [
      { fd: 0, name: "stdin", target: "terminal_in" },
      { fd: 1, name: "stdout", target: "terminal_out" },
      { fd: 2, name: "stderr", target: "terminal_err" },
      { fd: 3, name: "listenfd", target: "sock_listen", active: true }
    ],
    childFds: null,
    openFiles: [
      { id: "terminal_in", type: "tty", name: "/dev/tty", refcnt: 1, info: "只读控制台" },
      { id: "terminal_out", type: "tty", name: "/dev/tty", refcnt: 1, info: "只写控制台" },
      { id: "terminal_err", type: "tty", name: "/dev/tty", refcnt: 1, info: "只写控制台" },
      { id: "sock_listen", type: "socket", name: "Socket [*:8000]", refcnt: 1, info: "未绑定端点", active: true }
    ],
    tcpState: { state: "CLOSED", label: "CLOSED", desc: "套接字存在但尚未处于监听状态" },
    highlight: "socket"
  },
  {
    id: 2,
    title: "Step 2: 绑定与监听 bind() & listen()",
    syscall: "bind(listenfd, (SA*)&serveraddr, sizeof(serveraddr));\nlisten(listenfd, LISTENQ); // 将主动套接字转为被动监听套接字",
    summary: "bind() 将 listenfd 关联到本地 IP 和端口 8000；listen() 告知内核该套接字作为服务器接受连接请求，TCP 状态机迁移至 LISTEN。",
    parentFds: [
      { fd: 0, name: "stdin", target: "terminal_in" },
      { fd: 1, name: "stdout", target: "terminal_out" },
      { fd: 2, name: "stderr", target: "terminal_err" },
      { fd: 3, name: "listenfd", target: "sock_listen", active: true }
    ],
    childFds: null,
    openFiles: [
      { id: "terminal_in", type: "tty", name: "/dev/tty", refcnt: 1, info: "只读控制台" },
      { id: "terminal_out", type: "tty", name: "/dev/tty", refcnt: 1, info: "只写控制台" },
      { id: "terminal_err", type: "tty", name: "/dev/tty", refcnt: 1, info: "只写控制台" },
      { id: "sock_listen", type: "socket", name: "Socket [*:8000]", refcnt: 1, info: "全连接队列待命", active: true }
    ],
    tcpState: { state: "LISTEN", label: "LISTEN", desc: "被动等待客户端 SYN 握手" },
    highlight: "listen"
  },
  {
    id: 3,
    title: "Step 3: 接受客户端连接 accept()",
    syscall: "connfd = accept(listenfd, (SA*)&clientaddr, &clientlen);\n// 内核完成三次握手，从已完成队列出队",
    summary: "客户端发起三次握手。accept() 返回全新已连接描述符 connfd (fd 4)，其在打开文件表产生新条目，refcnt = 1，状态 ESTABLISHED。注意：listenfd 仍处于 LISTEN 状态等待下一个连接！",
    parentFds: [
      { fd: 0, name: "stdin", target: "terminal_in" },
      { fd: 1, name: "stdout", target: "terminal_out" },
      { fd: 2, name: "stderr", target: "terminal_err" },
      { fd: 3, name: "listenfd", target: "sock_listen" },
      { fd: 4, name: "connfd", target: "sock_conn", active: true }
    ],
    childFds: null,
    openFiles: [
      { id: "terminal_in", type: "tty", name: "/dev/tty", refcnt: 1, info: "只读控制台" },
      { id: "terminal_out", type: "tty", name: "/dev/tty", refcnt: 1, info: "只写控制台" },
      { id: "terminal_err", type: "tty", name: "/dev/tty", refcnt: 1, info: "只写控制台" },
      { id: "sock_listen", type: "socket", name: "Socket [*:8000]", refcnt: 1, info: "监听套接字" },
      { id: "sock_conn", type: "socket", name: "Socket [Client<->8000]", refcnt: 1, info: "已连接套接字", active: true }
    ],
    tcpState: { state: "ESTABLISHED", label: "ESTABLISHED", desc: "与客户端双向数据通道就绪" },
    highlight: "accept"
  },
  {
    id: 4,
    title: "Step 4: 并发派生 fork() [核心分水岭]",
    syscall: "if ((pid = fork()) == 0) {\n    /* 子进程 PID 1001 拷贝父进程文件描述符表 */\n}",
    summary: "fork() 创建子进程 (PID 1001)。子进程获得父进程描述符表的完整副本！关键物理机理：内核中所有被引用的已打开文件表项的引用计数 refcnt 全部递增！listenfd.refcnt 变为 2，connfd.refcnt 变为 2！",
    parentFds: [
      { fd: 0, name: "stdin", target: "terminal_in" },
      { fd: 1, name: "stdout", target: "terminal_out" },
      { fd: 2, name: "stderr", target: "terminal_err" },
      { fd: 3, name: "listenfd", target: "sock_listen" },
      { fd: 4, name: "connfd", target: "sock_conn" }
    ],
    childFds: [
      { fd: 0, name: "stdin", target: "terminal_in", active: true },
      { fd: 1, name: "stdout", target: "terminal_out", active: true },
      { fd: 2, name: "stderr", target: "terminal_err", active: true },
      { fd: 3, name: "listenfd", target: "sock_listen", active: true },
      { fd: 4, name: "connfd", target: "sock_conn", active: true }
    ],
    openFiles: [
      { id: "terminal_in", type: "tty", name: "/dev/tty", refcnt: 2, info: "父子共享控制台", refcntChanged: "+1" },
      { id: "terminal_out", type: "tty", name: "/dev/tty", refcnt: 2, info: "父子共享控制台", refcntChanged: "+1" },
      { id: "terminal_err", type: "tty", name: "/dev/tty", refcnt: 2, info: "父子共享控制台", refcntChanged: "+1" },
      { id: "sock_listen", type: "socket", name: "Socket [*:8000]", refcnt: 2, info: "父子均持有监听套接字", refcntChanged: "+1", active: true },
      { id: "sock_conn", type: "socket", name: "Socket [Client<->8000]", refcnt: 2, info: "父子均持有已连接套接字", refcntChanged: "+1", active: true }
    ],
    tcpState: { state: "ESTABLISHED", label: "ESTABLISHED", desc: "连接维持，由子进程准备处理请求" },
    highlight: "fork"
  },
  {
    id: 5,
    title: "Step 5: 子进程关闭监听描述符 child: close(listenfd)",
    syscall: "/* 在子进程分支 (pid == 0) 中执行 */\nclose(listenfd); // 子进程无需继续监听外部新连接",
    summary: "子进程释放其私有表中的 fd 3。sock_listen 的 refcnt 从 2 递减为 1。由于父进程仍持有 listenfd，内核不会释放监听端点，父进程继续监听其他并发连接。",
    parentFds: [
      { fd: 0, name: "stdin", target: "terminal_in" },
      { fd: 1, name: "stdout", target: "terminal_out" },
      { fd: 2, name: "stderr", target: "terminal_err" },
      { fd: 3, name: "listenfd", target: "sock_listen" },
      { fd: 4, name: "connfd", target: "sock_conn" }
    ],
    childFds: [
      { fd: 0, name: "stdin", target: "terminal_in" },
      { fd: 1, name: "stdout", target: "terminal_out" },
      { fd: 2, name: "stderr", target: "terminal_err" },
      { fd: 4, name: "connfd", target: "sock_conn", active: true }
    ],
    openFiles: [
      { id: "terminal_in", type: "tty", name: "/dev/tty", refcnt: 2, info: "父子共享控制台" },
      { id: "terminal_out", type: "tty", name: "/dev/tty", refcnt: 2, info: "父子共享控制台" },
      { id: "terminal_err", type: "tty", name: "/dev/tty", refcnt: 2, info: "父子共享控制台" },
      { id: "sock_listen", type: "socket", name: "Socket [*:8000]", refcnt: 1, info: "仅父进程持有监听", refcntChanged: "-1", active: true },
      { id: "sock_conn", type: "socket", name: "Socket [Client<->8000]", refcnt: 2, info: "父子均持有已连接套接字" }
    ],
    tcpState: { state: "ESTABLISHED", label: "ESTABLISHED", desc: "数据会话持续保持" },
    highlight: "child_close_listen"
  },
  {
    id: 6,
    title: "Step 6: 父进程关闭已连接描述符 parent: close(connfd) [关键断言]",
    syscall: (bug) => bug ? 
      "/* 【反事实错误分支】父进程遗漏了 close(connfd)！ */\n// parent: 忘记调用 close(connfd);\n// connfd 悬留在父进程描述符表中！" : 
      "/* 在父进程分支中执行 */\nclose(connfd); // 父进程释放其对已连接套接字的引用",
    summary: (bug) => bug ? 
      "【反事实严重隐患】父进程遗漏 close(connfd)！此时父进程继续循环执行 accept()，导致 connfd 的 refcnt 仍保持为 2。一旦子进程稍后退出，refcnt 将无法降为 0！" : 
      "【教学关键断言】父进程释放其 fd 4，connfd 的 refcnt 从 2 降为 1。关键机理：因为子进程依然持有引用 (refcnt = 1 > 0)，内核绝不会发送 TCP FIN 分节！客户端与服务端的连接丝毫不受影响！",
    parentFds: (bug) => bug ? [
      { fd: 0, name: "stdin", target: "terminal_in" },
      { fd: 1, name: "stdout", target: "terminal_out" },
      { fd: 2, name: "stderr", target: "terminal_err" },
      { fd: 3, name: "listenfd", target: "sock_listen" },
      { fd: 4, name: "connfd", target: "sock_conn", leak: true }
    ] : [
      { fd: 0, name: "stdin", target: "terminal_in" },
      { fd: 1, name: "stdout", target: "terminal_out" },
      { fd: 2, name: "stderr", target: "terminal_err" },
      { fd: 3, name: "listenfd", target: "sock_listen" }
    ],
    childFds: [
      { fd: 0, name: "stdin", target: "terminal_in" },
      { fd: 1, name: "stdout", target: "terminal_out" },
      { fd: 2, name: "stderr", target: "terminal_err" },
      { fd: 4, name: "connfd", target: "sock_conn", active: true }
    ],
    openFiles: (bug) => bug ? [
      { id: "terminal_in", type: "tty", name: "/dev/tty", refcnt: 2, info: "父子共享控制台" },
      { id: "terminal_out", type: "tty", name: "/dev/tty", refcnt: 2, info: "父子共享控制台" },
      { id: "terminal_err", type: "tty", name: "/dev/tty", refcnt: 2, info: "父子共享控制台" },
      { id: "sock_listen", type: "socket", name: "Socket [*:8000]", refcnt: 1, info: "父进程监听" },
      { id: "sock_conn", type: "socket", name: "Socket [Client<->8000]", refcnt: 2, info: "父子依然同时持有！refcnt 仍为 2！", leak: true }
    ] : [
      { id: "terminal_in", type: "tty", name: "/dev/tty", refcnt: 2, info: "父子共享控制台" },
      { id: "terminal_out", type: "tty", name: "/dev/tty", refcnt: 2, info: "父子共享控制台" },
      { id: "terminal_err", type: "tty", name: "/dev/tty", refcnt: 2, info: "父子共享控制台" },
      { id: "sock_listen", type: "socket", name: "Socket [*:8000]", refcnt: 1, info: "父进程监听" },
      { id: "sock_conn", type: "socket", name: "Socket [Client<->8000]", refcnt: 1, info: "仅子进程持有，refcnt=1", refcntChanged: "-1", active: true }
    ],
    tcpState: { state: "ESTABLISHED", label: "ESTABLISHED", desc: "子进程与客户端正在收发 HTTP/业务数据" },
    highlight: "parent_close_conn"
  },
  {
    id: 7,
    title: "Step 7: 会话终结与内核资源回收 child: close(connfd)",
    syscall: (bug) => bug ? 
      "/* 子进程服务完毕退出 */\nclose(connfd);\nexit(0);\n// 客户端永远收不到 EOF！连接挂起！" : 
      "/* 子进程服务完毕退出 */\nclose(connfd);\nexit(0);\n// refcnt 归零，内核自动触发 TCP FIN 四次挥手",
    summary: (bug) => bug ?
      "【灾难爆发】子进程关闭 fd 4 并退出，connfd.refcnt 从 2 减为 1 (而不是 0)！由于 refcnt > 0，Linux 内核判定还有进程在使用该连接，因此绝不会向客户端发送 FIN 包！客户端永远阻塞在 read() 上产生半死锁！同时父进程描述符持续泄露，很快耗尽描述符池 (EMFILE 崩溃)！" :
      "【优雅关闭】子进程完成任务调用 close(connfd)，connfd.refcnt 从 1 减为 0！内核发现引用计数归零，立即触发 TCP FIN 四次挥手，套接字平滑关闭，文件表项与内存 PCB 彻底回收！",
    parentFds: (bug) => bug ? [
      { fd: 0, name: "stdin", target: "terminal_in" },
      { fd: 1, name: "stdout", target: "terminal_out" },
      { fd: 2, name: "stderr", target: "terminal_err" },
      { fd: 3, name: "listenfd", target: "sock_listen" },
      { fd: 4, name: "connfd", target: "sock_conn", leak: true }
    ] : [
      { fd: 0, name: "stdin", target: "terminal_in" },
      { fd: 1, name: "stdout", target: "terminal_out" },
      { fd: 2, name: "stderr", target: "terminal_err" },
      { fd: 3, name: "listenfd", target: "sock_listen" }
    ],
    childFds: null,
    openFiles: (bug) => bug ? [
      { id: "terminal_in", type: "tty", name: "/dev/tty", refcnt: 1, info: "父进程持有" },
      { id: "terminal_out", type: "tty", name: "/dev/tty", refcnt: 1, info: "父进程持有" },
      { id: "terminal_err", type: "tty", name: "/dev/tty", refcnt: 1, info: "父进程持有" },
      { id: "sock_listen", type: "socket", name: "Socket [*:8000]", refcnt: 1, info: "父进程监听" },
      { id: "sock_conn", type: "socket", name: "Socket [Client<->8000]", refcnt: 1, info: "僵死泄漏! refcnt 永远为 1，内核不发 FIN!", leak: true }
    ] : [
      { id: "terminal_in", type: "tty", name: "/dev/tty", refcnt: 1, info: "父进程持有" },
      { id: "terminal_out", type: "tty", name: "/dev/tty", refcnt: 1, info: "父进程持有" },
      { id: "terminal_err", type: "tty", name: "/dev/tty", refcnt: 1, info: "父进程持有" },
      { id: "sock_listen", type: "socket", name: "Socket [*:8000]", refcnt: 1, info: "父进程持续监听" }
    ],
    tcpState: (bug) => bug ? 
      { state: "HALF_DEADLOCK", label: "半死锁 / 悬挂", desc: "客户端等 EOF 挂死，服务端无释放", isError: true } : 
      { state: "CLOSED", label: "TIME_WAIT -> CLOSED", desc: "四次挥手结束，PCB 安全释放" },
    highlight: "child_close_conn"
  }
];

// ==========================================
// 2. 导出标准微观沙盒挂载器
// ==========================================

export const mountTracer = createSteppedTracer({
  id: 'socket_lifecycle',
  title: '并发套接字生命周期单步器 (CS:APP 第 11 章)',
  subtitle: 'CS:APP 第 10 & 11 章 · 三级内核表（描述符表 / 打开文件表 / TCP套接字）动态演进',
  steps: STEPS,
  whatIf: {
    label: '反事实推演：父进程遗漏 close(connfd)',
    desc: '开启后模拟父进程漏调 close(connfd) 引发的内核描述符泄漏与半死锁',
    default: false
  },
  renderView: (viewContainer, currentStep, state) => {
    const bug = state.isWhatIf;

    // 解析当前步骤数据
    const syscall = typeof currentStep.syscall === 'function' ? currentStep.syscall(bug) : currentStep.syscall;
    const summary = typeof currentStep.summary === 'function' ? currentStep.summary(bug) : currentStep.summary;
    const parentFds = typeof currentStep.parentFds === 'function' ? currentStep.parentFds(bug) : currentStep.parentFds;
    const childFds = typeof currentStep.childFds === 'function' ? currentStep.childFds(bug) : currentStep.childFds;
    const openFiles = typeof currentStep.openFiles === 'function' ? currentStep.openFiles(bug) : currentStep.openFiles;
    const tcpState = typeof currentStep.tcpState === 'function' ? currentStep.tcpState(bug) : currentStep.tcpState;

    // 1. 父进程描述符行
    const parentRows = parentFds.map(item => ({
      active: item.active,
      leak: item.leak,
      cells: [
        item.fd,
        escapeHtml(item.name),
        `<code>${escapeHtml(item.target)}</code>`
      ]
    }));

    // 2. 子进程描述符行
    let childRows = [];
    let childEmptyNotice = '';
    if (childFds) {
      childRows = childFds.map(item => ({
        active: item.active,
        cells: [
          item.fd,
          escapeHtml(item.name),
          `<code>${escapeHtml(item.target)}</code>`
        ]
      }));
    } else if (currentStep.id >= 4) {
      childEmptyNotice = '<div style="font-size: 11px; color: var(--text-secondary); text-align: center; padding: 6px 0;">子进程已调用 exit(0) 退出并释放自身描述符表</div>';
    }

    // 3. 打开文件表行
    const openFileRows = openFiles.map(item => ({
      active: item.active,
      leak: item.leak,
      cells: [
        `<code>${escapeHtml(item.id)}</code>`,
        escapeHtml(item.name),
        renderRefcntBadge(item.refcnt, {
          pulse: !!item.refcntChanged,
          isLeak: item.leak
        }),
        escapeHtml(item.info)
      ]
    }));

    viewContainer.innerHTML = `
      ${renderSyscallBox(syscall, { title: '系统调用跟踪区' })}

      <div style="display: grid; grid-template-columns: 1.2fr 1.8fr 1fr; gap: 10px;">
        <!-- 卡片 1：进程描述符表 -->
        <div style="display: flex; flex-direction: column; gap: 8px;">
          ${renderMappingTable({
            title: '父进程描述符表 (PID 1000)',
            subtitle: 'task_struct.files',
            headers: ['fd', '名字', '指向文件表'],
            rows: parentRows
          })}
          ${childFds ? renderMappingTable({
            title: '子进程描述符表 (PID 1001)',
            subtitle: 'worker 副本',
            headers: ['fd', '名字', '指向文件表'],
            rows: childRows
          }) : childEmptyNotice}
        </div>

        <!-- 卡片 2：内核已打开文件表 -->
        <div>
          ${renderMappingTable({
            title: '内核已打开文件表 (Open File Table)',
            subtitle: 'refcnt 核心指标',
            headers: ['表项 ID', '对象名称', '引用', '物理说明'],
            rows: openFileRows
          })}
        </div>

        <!-- 卡片 3：TCP 状态机与物理连接 -->
        <div style="display: flex; flex-direction: column; gap: 8px;">
          <div class="sp-card" style="align-items: center; justify-content: center; text-align: center; min-height: 120px;">
            <div style="font-size: 11px; color: var(--text-secondary); margin-bottom: 6px;">TCP 状态机与 PCB</div>
            ${renderFSMStatus(tcpState.state, {
              label: tcpState.label,
              theme: tcpState.isError ? 'red' : (tcpState.state === 'ESTABLISHED' ? 'sky' : (tcpState.state === 'LISTEN' ? 'emerald' : 'slate'))
            })}
            <div style="font-size: 11px; color: var(--text-primary); margin-top: 8px; font-weight: 500;">
              ${escapeHtml(tcpState.desc)}
            </div>
          </div>
          <div style="font-size: 10.5px; color: var(--text-secondary); line-height: 1.4; background: rgba(0,0,0,0.2); padding: 6px 8px; border-radius: 4px; border: 1px solid rgba(255,255,255,0.06);">
            <strong>内核规则：</strong>只有当已打开文件表中的 <code>refcnt</code> 减至 0 时，协议栈才会向对端发送 TCP FIN 并销毁 PCB。
          </div>
        </div>
      </div>

      ${renderSummaryCard({
        text: summary,
        isWarning: tcpState.isError
      })}

      ${bug ? renderSummaryCard({
        text: "<strong>反事实机理警告：</strong> 父进程在 fork 后若未显式执行 close(connfd)，connfd 在打开文件表的 refcnt 将无法归零。当子进程完成交互退出时，内核由于 refcnt > 0 不会发送 FIN，造成客户端对端长久假死，父进程描述符持续泄露直至 EMFILE。",
        isWarning: true
      }) : ''}
    `;
  }
});
