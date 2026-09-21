"""
AxiomFlow <-> GDB / NEMU Runtime Probe & Antigravity Bridge
用于在 GDB 运行时调试器、硬件仿真器 (NEMU/QEMU) 与本地 AxiomFlow DAG 画布之间进行无缝状态探针注入与状态同步。

【使用方式 1：GDB 运行时自动注入】
在 Linux / GDB 终端单步调试时加载此脚本：
    (gdb) source antigravity_bridge.py
    (gdb) b eval
    (gdb) c
    (gdb) dump-to-tree "断点命中: eval() fork 返回子进程"
一键将反汇编指令流、16 个通用寄存器物理状态及栈顶物理内存 Dump 挂载至画布。

【使用方式 2：CLI 命令行与测试】
    python antigravity_bridge.py --mock-csapp-eval
    python antigravity_bridge.py --status
    python antigravity_bridge.py --pending
"""

import sys
import os
import json
import time
import argparse
import urllib.request
import urllib.error
from pathlib import Path

# Windows console encoding guard
if sys.platform.startswith("win") and hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

BASE_DIR = Path(__file__).resolve().parent
GRAPH_FILE = BASE_DIR / "graph.json"
DEFAULT_API_URL = "http://localhost:8765/api/probe/gdb-dump"

def load_graph():
    if not GRAPH_FILE.exists():
        return {"nodes": [], "edges": []}
    try:
        with open(GRAPH_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {"nodes": [], "edges": []}

def save_graph(graph):
    with open(GRAPH_FILE, "w", encoding="utf-8") as f:
        json.dump(graph, f, ensure_ascii=False, indent=2)

def list_status():
    graph = load_graph()
    nodes = graph.get("nodes", [])
    edges = graph.get("edges", [])
    print(f"[*] 当前画布共有 {len(nodes)} 个节点, {len(edges)} 条连线:")
    pending_count = 0
    for n in nodes:
        status_flag = "[PENDING]" if n.get("status") == "pending" else "[OK]"
        if n.get("status") == "pending":
            pending_count += 1
        kind = n.get('kind', 'node')
        title = n.get('title', n.get('question', ''))
        print(f"  {status_flag} ({kind}) #{n['id']}: {title}")
    if pending_count > 0:
        print(f"\n[!] 发现 {pending_count} 个等待解答的节点！")
    else:
        print("\n[OK] 所有节点均已处理完成。")

def get_pending():
    graph = load_graph()
    for n in graph.get("nodes", []):
        if n.get("status") == "pending":
            print(json.dumps({
                "id": n["id"],
                "title": n.get("title", ""),
                "question": n.get("question", ""),
                "compiledContext": n.get("compiledContext", "")
            }, ensure_ascii=False, indent=2))
            return
    print(json.dumps({}, ensure_ascii=False))

def set_answer(node_id, response_text):
    graph = load_graph()
    found = False
    for n in graph.get("nodes", []):
        if n.get("id") == node_id:
            n["response"] = response_text
            n["status"] = "done"
            found = True
            break
    if found:
        save_graph(graph)
        print(f"[+] 节点 #{node_id} 已成功写入推理结果并标记为完成！")
    else:
        print(f"[-] 未找到节点 #{node_id}")

def push_probe_to_server(payload, api_url=DEFAULT_API_URL):
    """向本地 AxiomFlow 服务推送硬件探针快照"""
    data_bytes = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        api_url,
        data=data_bytes,
        headers={"Content-Type": "application/json; charset=utf-8"}
    )
    try:
        t0 = time.time()
        with urllib.request.urlopen(req, timeout=5) as resp:
            elapsed_ms = int((time.time() - t0) * 1000)
            res = json.loads(resp.read().decode("utf-8"))
            if res.get("ok"):
                print(f"[+] [SUCCESS] 硬件探针在 {elapsed_ms}ms 内成功推入画布！")
                print(f"    节点 ID: #{res.get('nodeId')}")
                print(f"    标题: {res.get('node', {}).get('title')}")
                return True
            else:
                print(f"[-] 上报失败: {res.get('error')}")
                return False
    except urllib.error.URLError as ue:
        print(f"[-] 无法连接到本地服务 ({api_url}): {ue}")
        print("    请确保先在终端运行 python server.py 服务。")
        return False
    except Exception as e:
        print(f"[-] 推送硬件探针异常: {e}")
        return False

def push_mock_csapp_eval(api_url=DEFAULT_API_URL, target_node_id=None):
    """模拟 CS:APP eval() 在 fork() 之后子进程断点的物理真实寄存器与内存快照"""
    payload = {
        "title": "GDB 断点探针 · eval.c:28 (0x400da2)",
        "location": "eval.c:28 ($pc=0x400da2)",
        "registers": {
            "rax": "0x0000000000000000",
            "rbx": "0x0000000000401200",
            "rcx": "0x00007ffff7fa5d80",
            "rdx": "0x00007fffffffe200",
            "rsi": "0x00007fffffffe190",
            "rdi": "0x0000000000000000",
            "rbp": "0x00007fffffffe240",
            "rsp": "0x00007fffffffe1a0",
            "r8":  "0x0000000000000001",
            "r9":  "0x0000000000000000",
            "r10": "0x0000000000000008",
            "r11": "0x0000000000000246",
            "r12": "0x0000000000400840",
            "r13": "0x00007fffffffe340",
            "r14": "0x0000000000000000",
            "r15": "0x0000000000000000",
            "rip": "0x0000000000400da2",
            "eflags": "0x00000246 [PF ZF IF]"
        },
        "disassembly": (
            "0x400d98 <eval+88>:  callq  0x400920 <fork@plt>\n"
            "=> 0x400d9d <eval+93>:  test   %eax,%eax\n"
            "   0x400d9f <eval+95>:  jne    0x400dc4 <eval+132>\n"
            "   0x400da1 <eval+97>:  mov    -0x40(%rbp),%rsi\n"
            "   0x400da5 <eval+101>: mov    $0x2,%edi\n"
            "   0x400daa <eval+106>: callq  0x400980 <sigprocmask@plt>\n"
            "   0x400daf <eval+111>: xor    %esi,%esi\n"
            "   0x400db1 <eval+113>: xor    %edi,%edi\n"
            "   0x400db3 <eval+115>: callq  0x4009c0 <setpgid@plt>\n"
            "   0x400db8 <eval+120>: mov    -0x20(%rbp),%rdi\n"
            "   0x400dbc <eval+124>: callq  0x400a00 <execve@plt>"
        ),
        "stack": (
            "0x7fffffffe1a0:  0x0000000000401200  0x00007fffffffe2b0\n"
            "0x7fffffffe1b0:  0x0000000000000000  0x0000000000000002\n"
            "0x7fffffffe1c0:  0x0000000000000000  0x00007ffff7fa5d80\n"
            "0x7fffffffe1d0:  0x00007fffffffe240  0x0000000000400da2"
        ),
        "notes": "fork() 返回子进程 (rax=0)，子进程即将恢复原信号掩码 prev_one 并执行 setpgid(0, 0)",
        "targetNodeId": target_node_id
    }
    print("[*] 正在向 AxiomFlow 发送 CS:APP eval() 真实 GDB 断点探针...")
    return push_probe_to_server(payload, api_url)

# ==========================================
# GDB Python 内部加载与自定义命令注册
# ==========================================
try:
    import gdb
    IN_GDB = True
except ImportError:
    IN_GDB = False

if IN_GDB:
    class DumpToTreeCommand(gdb.Command):
        """将当前断点的寄存器、反汇编及堆栈快照直接推入 AxiomFlow DAG 画布
        用法:
            dump-to-tree [可选备注说明]
        """
        def __init__(self):
            super(DumpToTreeCommand, self).__init__("dump-to-tree", gdb.COMMAND_USER)

        def invoke(self, arg, from_tty):
            note = arg.strip() if arg else ""
            try:
                frame = gdb.selected_frame()
                sal = frame.find_sal()
                location = f"{sal.symtab.filename}:{sal.line}" if (sal and sal.symtab) else f"0x{frame.pc():x}"
            except Exception:
                location = "unknown_location"

            # 抓取 16 个通用寄存器
            registers = {}
            reg_names = ["rax", "rbx", "rcx", "rdx", "rsi", "rdi", "rbp", "rsp", "r8", "r9", "r10", "r11", "r12", "r13", "r14", "r15", "rip", "eflags"]
            for r in reg_names:
                try:
                    val = gdb.parse_and_eval(f"${r}")
                    registers[r] = f"0x{int(val):016x}" if int(val) > 0xffff else f"0x{int(val):x}"
                except Exception:
                    pass

            # 抓取反汇编
            disassembly = ""
            try:
                disassembly = gdb.execute("x/10i $pc-4", to_string=True)
            except Exception:
                try:
                    disassembly = gdb.execute("x/8i $pc", to_string=True)
                except Exception:
                    pass

            # 抓取栈顶
            stack = ""
            try:
                stack = gdb.execute("x/8gx $rsp", to_string=True)
            except Exception:
                pass

            payload = {
                "title": f"GDB 硬件探针 · {location}",
                "location": location,
                "registers": registers,
                "disassembly": disassembly.strip(),
                "stack": stack.strip(),
                "notes": note
            }
            push_probe_to_server(payload)

    # 注册 GDB 命令
    DumpToTreeCommand()
    print("[+] [AxiomFlow] GDB 探针插件已激活！输入指令 `dump-to-tree [备注]` 即可一键推入画布。")

def main():
    parser = argparse.ArgumentParser(description="AxiomFlow GDB Probe & Bridge CLI")
    parser.add_argument("--status", action="store_true", help="查看当前画布状态")
    parser.add_argument("--pending", action="store_true", help="提取等待解答的节点")
    parser.add_argument("--answer", type=str, help="为指定节点写入答案 (配合 --node 使用)")
    parser.add_argument("--node", type=str, help="指定节点 ID")
    parser.add_argument("--mock-csapp-eval", action="store_true", help="推送 CS:APP eval() 经典子进程断点硬件探针")
    parser.add_argument("--target", type=str, help="指定连线的目标课题节点 ID (配合 --mock-csapp-eval 或 probe 使用)")
    parser.add_argument("--url", type=str, default=DEFAULT_API_URL, help="AxiomFlow 探针 API 地址")

    args = parser.parse_args()

    if args.mock_csapp_eval:
        push_mock_csapp_eval(api_url=args.url, target_node_id=args.target)
    elif args.status:
        list_status()
    elif args.pending:
        get_pending()
    elif args.answer and args.node:
        set_answer(args.node, args.answer)
    else:
        list_status()

if __name__ == "__main__":
    main()
