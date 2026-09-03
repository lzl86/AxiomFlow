"""
ThoughtDAG <-> Antigravity Bridge CLI
用于在 Antigravity 智能体与本地 ThoughtDAG 画布之间进行无缝状态同步与任务处理。
"""

import sys
import json
import argparse
from pathlib import Path

# Windows console encoding guard
if sys.platform.startswith("win") and hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

GRAPH_FILE = Path(__file__).resolve().parent / "graph.json"

def load_graph():
    if not GRAPH_FILE.exists():
        return {"nodes": [], "edges": []}
    with open(GRAPH_FILE, "r", encoding="utf-8") as f:
        return json.load(f)

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
        print(f"  {status_flag} ({n.get('kind', 'node')}) #{n['id']}: {n.get('title', n.get('question', ''))}")
    if pending_count > 0:
        print(f"\n[!] 发现 {pending_count} 个等待 Antigravity 解答的节点！")
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

def main():
    parser = argparse.ArgumentParser(description="ThoughtDAG Antigravity Bridge")
    parser.add_argument("--status", action="store_true", help="查看当前画布状态")
    parser.add_argument("--pending", action="store_true", help="提取等待解答的节点")
    parser.add_argument("--answer", type=str, help="为指定节点写入答案 (配合 --node 使用)")
    parser.add_argument("--node", type=str, help="指定节点 ID")

    args = parser.parse_args()

    if args.status:
        list_status()
    elif args.pending:
        get_pending()
    elif args.answer and args.node:
        set_answer(args.node, args.answer)
    else:
        list_status()

if __name__ == "__main__":
    main()
