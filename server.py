import sys
import os
import json
import time
import base64
import re
import socket
import urllib.request
import urllib.error
import urllib.parse
from pathlib import Path
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from urllib.parse import urlparse

# Windows console encoding guard
if sys.platform.startswith("win") and hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

PORT = 8765
BASE_DIR = Path(__file__).resolve().parent
PUBLIC_DIR = BASE_DIR / "public"
MATERIALS_DIR = PUBLIC_DIR / "materials"
GRAPH_FILE = BASE_DIR / "graph.json"
CONFIG_FILE = BASE_DIR / "config.json"
SESSIONS_DIR = BASE_DIR / "sessions"
SESSIONS_INDEX_FILE = SESSIONS_DIR / "index.json"

MATERIALS_DIR.mkdir(parents=True, exist_ok=True)

DEFAULT_CONFIG = {
    "api_base": "https://api.siliconflow.cn/v1",
    "api_key": "",
    "model": "deepseek-ai/DeepSeek-V4-Pro",
    "vision_model": "Qwen/Qwen2.5-VL-72B-Instruct",
    "temperature": 0.3
}

def sanitize_api_base(url: str) -> str:
    """自动规范化反代与 API 基址：补全协议、补齐 /v1、剔除冗余 endpoint"""
    if not url:
        return ""
    url = str(url).strip()
    # 自动补全 http/https
    if not url.startswith("http://") and not url.startswith("https://"):
        if "127.0.0.1" in url or "localhost" in url:
            url = "http://" + url
        else:
            url = "https://" + url
    # 剔除末尾多余的 /chat/completions 或 /models
    url = re.sub(r"/chat/completions/?$", "", url)
    url = re.sub(r"/models/?$", "", url)
    url = url.rstrip("/")
    # 如果既没有以版本号（如 /v1, /v2, /compatible-mode/v1）结尾，也不是子路径，对于标准域名自动补齐 /v1
    parsed = urllib.parse.urlparse(url)
    if parsed.path == "" or parsed.path == "/":
        url = url.rstrip("/") + "/v1"
    return url

def analyze_api_exception(e: Exception, api_base: str, model: str) -> dict:
    """深度解析 API 与反向代理异常，提供人类可读的学术级诊断建议"""
    err_str = str(e)
    res = {
        "ok": False,
        "error_type": "generic",
        "error": err_str,
        "diagnostics": [],
        "api_base": api_base,
        "model": model
    }
    
    if isinstance(e, urllib.error.HTTPError):
        status_code = e.code
        body_detail = ""
        try:
            raw_body = e.read().decode("utf-8")
            err_json = json.loads(raw_body)
            if "error" in err_json and isinstance(err_json["error"], dict):
                body_detail = err_json["error"].get("message", "")
            elif "message" in err_json:
                body_detail = err_json.get("message", "")
        except Exception:
            pass
        
        if status_code == 401:
            res["error_type"] = "auth_failed"
            res["error"] = "API 密钥认证失败 (401 Unauthorized)"
            res["diagnostics"] = [
                "请检查【API Key】是否已正确填入，且无多余首尾空格",
                "若使用反代/中转服务，请确认该 Key 在中转站内已激活且额度充足",
                body_detail and f"服务商反馈: {body_detail}"
            ]
        elif status_code == 404:
            res["error_type"] = "model_not_found"
            res["error"] = f"模型或接口路径未找到 (404 Not Found)"
            res["diagnostics"] = [
                f"当前反代服务商可能未接入【{model}】，请在配置中手动输入反代支持的模型名（如 gpt-4o, deepseek-chat 等）",
                f"检查反代地址【{api_base}】路径是否需包含 /v1",
                body_detail and f"服务商反馈: {body_detail}"
            ]
        elif status_code == 429:
            res["error_type"] = "rate_limit"
            res["error"] = "请求被限频或账户额度耗尽 (429 Too Many Requests)"
            res["diagnostics"] = [
                "当前 API Key 的额度已用尽，或请求并发频率超过了服务商限制",
                body_detail and f"服务商反馈: {body_detail}"
            ]
        elif status_code in (502, 503, 504):
            res["error_type"] = "proxy_gateway_error"
            res["error"] = f"反代上游网关异常 (HTTP {status_code})"
            res["diagnostics"] = [
                "反向代理服务器已连通，但其后端大模型服务商超时未响应",
                "建议稍后重试，或在配置中切换至其他可用模型/服务商"
            ]
        else:
            res["error"] = f"服务商返回 HTTP {status_code}: {body_detail or err_str}"
            res["diagnostics"] = [body_detail or "请根据状态码核对反代网关日志"]
            
    elif isinstance(e, urllib.error.URLError) or "WinError 10061" in err_str or "ConnectionRefused" in err_str or "积极拒绝" in err_str:
        res["error_type"] = "connection_refused"
        is_local = "127.0.0.1" in api_base or "localhost" in api_base
        if is_local:
            res["error"] = f"本地反代/服务未启动 (目标计算机积极拒绝连接 [10061])"
            res["diagnostics"] = [
                f"系统尝试连接本地反代地址【{api_base}】，但本地端口未开启监听",
                "若使用本地 OneAPI / NewAPI / 本地网关，请确认程序已运行（默认通常为 http://127.0.0.1:3000/v1）",
                "若使用在线中转反代，请前往【⚙️ 引擎配置】将地址改为反代商提供的真实 HTTPS URL（如 https://api.xxx.com/v1）"
            ]
        else:
            res["error"] = f"无法连接至反代服务器【{api_base}】"
            res["diagnostics"] = [
                "请检查反代域名或 IP 拼写是否正确",
                "请检查网络连接是否正常，或反代服务器是否处于维护中"
            ]
    elif "timed out" in err_str.lower() or isinstance(e, socket.timeout):
        res["error_type"] = "timeout"
        res["error"] = f"连接反代服务器超时 (Timeout)"
        res["diagnostics"] = [
            f"请求地址【{api_base}】在设定时间内未响应",
            "反代服务器网络延迟可能过高，或需检查代理与防火墙设置"
        ]
    else:
        res["error"] = f"请求失败: {err_str}"
        res["diagnostics"] = [
            "请前往右上角【⚙️ 引擎与密钥配置】重新核对反代基址与密钥",
            "点击【⚡ 测试连接】进行实时连通性诊断"
        ]
        
    res["diagnostics"] = [d for d in res["diagnostics"] if d]
    return res

def resolve_vision_model(conf):
    """
    智能解析多模态视觉模型 (双引擎分发):
    1. 若显式配置了 vision_model, 优先采用;
    2. 若主模型本身具备视觉多模态能力 (Gemini, GPT-4o, Claude 等), 沿用主模型;
    3. 若主模型为纯文本推理模型 (DeepSeek-V4 Pro, DeepSeek-R1, Qwen3.8-Max 等),
       按当前 api_base 智能路由至服务商最佳视觉多模态模型 (Qwen2.5-VL-72B / qwen-vl-max / Gemini 3.8 Flash).
    """
    vision_model = conf.get("vision_model", "").strip() if conf.get("vision_model") else ""
    if vision_model:
        return vision_model
    
    main_model = conf.get("model", "deepseek-ai/DeepSeek-V4-Pro").strip()
    main_lower = main_model.lower()
    
    # 判断主模型是否具备原生视觉多模态能力
    is_vision_capable = any(k in main_lower for k in ["gemini", "gpt-4o", "gpt-4.5", "claude-3", "claude-opus", "vl", "vision", "omni", "4v"])
    is_pure_text_reasoner = any(k in main_lower for k in ["r1", "reasoner", "deepseek-chat", "v4-pro", "deepseek-v3", "deepseek-v4", "qwen3.8-max", "qwen-max", "qwen-plus"])
    
    if is_vision_capable and not is_pure_text_reasoner:
        return main_model
    
    api_base = conf.get("api_base", "").lower()
    if "siliconflow" in api_base:
        return "Qwen/Qwen2.5-VL-72B-Instruct"
    elif "dashscope" in api_base or "aliyuncs" in api_base:
        return "qwen-vl-max"
    elif "openai.com" in api_base:
        return "gpt-4o"
    else:
        return "gemini-3.8-flash-high"

def get_config():
    if not CONFIG_FILE.exists():
        with open(CONFIG_FILE, "w", encoding="utf-8") as f:
            json.dump(DEFAULT_CONFIG, f, ensure_ascii=False, indent=2)
        return DEFAULT_CONFIG.copy()
    try:
        with open(CONFIG_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return DEFAULT_CONFIG.copy()

def init_sessions_storage():
    """初始化多会话目录，无损迁移既有 graph.json 为第一个默认课题"""
    SESSIONS_DIR.mkdir(exist_ok=True)
    if not SESSIONS_INDEX_FILE.exists():
        default_session_id = "session_default"
        default_title = "定量相位成像与光场反演"
        default_file = SESSIONS_DIR / f"{default_session_id}.json"
        
        node_count = 0
        if GRAPH_FILE.exists():
            try:
                with open(GRAPH_FILE, "r", encoding="utf-8") as f:
                    graph_data = json.load(f)
                for n in graph_data.get("nodes", []):
                    if n.get("title") and n.get("title") != "未命名课题":
                        default_title = n.get("title")
                        break
                node_count = len(graph_data.get("nodes", []))
                with open(default_file, "w", encoding="utf-8") as f:
                    json.dump(graph_data, f, ensure_ascii=False, indent=2)
            except Exception as e:
                print("[!] 迁移既有图谱至会话存储异常:", e)
        
        if not default_file.exists():
            with open(default_file, "w", encoding="utf-8") as f:
                json.dump({"nodes": [], "edges": []}, f, ensure_ascii=False, indent=2)

        index_data = {
            "activeId": default_session_id,
            "sessions": [
                {
                    "id": default_session_id,
                    "title": default_title,
                    "createdAt": int(time.time() * 1000),
                    "updatedAt": int(time.time() * 1000),
                    "nodeCount": node_count
                }
            ]
        }
        with open(SESSIONS_INDEX_FILE, "w", encoding="utf-8") as f:
            json.dump(index_data, f, ensure_ascii=False, indent=2)

def get_sessions_index():
    init_sessions_storage()
    try:
        with open(SESSIONS_INDEX_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {"activeId": "session_default", "sessions": []}

def save_sessions_index(data):
    init_sessions_storage()
    with open(SESSIONS_INDEX_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

def get_session_file(session_id=None):
    init_sessions_storage()
    if not session_id:
        idx = get_sessions_index()
        session_id = idx.get("activeId", "session_default")
    return SESSIONS_DIR / f"{session_id}.json"

def sync_active_to_legacy_graph(session_id=None):
    sf = get_session_file(session_id)
    if sf.exists():
        try:
            with open(sf, "r", encoding="utf-8") as rf:
                content = rf.read()
            with open(GRAPH_FILE, "w", encoding="utf-8") as wf:
                wf.write(content)
        except Exception:
            pass

class ThoughtDAGHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(PUBLIC_DIR), **kwargs)

    def do_GET(self):
        parsed = urlparse(self.path)
        query = urllib.parse.parse_qs(parsed.query)

        if parsed.path == "/api/sessions":
            idx = get_sessions_index()
            # 实时同步统计各课题节点数量
            for s in idx.get("sessions", []):
                sf = SESSIONS_DIR / f"{s['id']}.json"
                if sf.exists():
                    try:
                        with open(sf, "r", encoding="utf-8") as f:
                            g = json.load(f)
                        s["nodeCount"] = len(g.get("nodes", []))
                    except Exception:
                        pass
            save_sessions_index(idx)
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(json.dumps(idx).encode("utf-8"))
            return

        elif parsed.path == "/api/graph":
            req_session_id = query.get("sessionId", [None])[0]
            target_file = get_session_file(req_session_id)
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            if target_file.exists():
                try:
                    with open(target_file, "r", encoding="utf-8") as f:
                        data = f.read()
                    self.wfile.write(data.encode("utf-8"))
                except Exception as e:
                    self.wfile.write(json.dumps({"error": str(e)}).encode("utf-8"))
            else:
                self.wfile.write(json.dumps({"nodes": [], "edges": []}).encode("utf-8"))
            return

        elif parsed.path == "/api/version":
            req_session_id = query.get("sessionId", [None])[0]
            target_file = get_session_file(req_session_id)
            mtime = target_file.stat().st_mtime if target_file.exists() else 0
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(json.dumps({"mtime": mtime}).encode("utf-8"))
            return

        elif parsed.path == "/api/config":
            conf = get_config()
            safe_conf = dict(conf)
            if safe_conf.get("api_key") and len(safe_conf["api_key"]) > 10:
                safe_conf["masked_key"] = safe_conf["api_key"][:6] + "..." + safe_conf["api_key"][-4:]
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(json.dumps(safe_conf).encode("utf-8"))
            return

        elif parsed.path == "/api/models":
            conf = get_config()
            api_base = conf.get("api_base", "http://127.0.0.1:8046/v1")
            api_key = conf.get("api_key", "")
            try:
                models_url = f"{api_base}/models"
                req = urllib.request.Request(models_url, headers={"Authorization": f"Bearer {api_key}"})
                with urllib.request.urlopen(req, timeout=5) as res:
                    data = json.loads(res.read().decode("utf-8"))
                    models = [m.get("id") for m in data.get("data", [])]
                self.send_response(200)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(json.dumps({"models": models}).encode("utf-8"))
            except Exception as e:
                self.send_response(200)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(json.dumps({
                    "models": [
                        "deepseek-ai/DeepSeek-V4-Pro",
                        "deepseek-ai/DeepSeek-R1",
                        "deepseek-ai/DeepSeek-V3",
                        "deepseek-reasoner",
                        "deepseek-chat",
                        "qwen3.8-max",
                        "qwen-max",
                        "qwen-plus",
                        "Qwen/Qwen2.5-VL-72B-Instruct",
                        "qwen-vl-max",
                        "gemini-3.8-flash-high",
                        "gemini-3.8-flash-medium",
                        "gemini-2.5-pro",
                        "claude-3-5-sonnet-20241022",
                        "claude-opus-4-5-thinking",
                        "gpt-4o",
                        "o1",
                        "o3-mini"
                    ],
                    "warning": str(e)
                }).encode("utf-8"))
            return

        elif parsed.path == "/api/materials":
            materials_list = []
            if MATERIALS_DIR.exists():
                for f in sorted(MATERIALS_DIR.iterdir(), key=lambda x: x.stat().st_mtime, reverse=True):
                    if f.is_file() and not f.name.startswith("."):
                        ext = f.suffix.lower()
                        file_type = "pdf" if ext == ".pdf" else ("markdown" if ext in [".md", ".markdown", ".txt"] else "other")
                        materials_list.append({
                            "name": f.name,
                            "title": f.stem,
                            "url": f"/materials/{urllib.parse.quote(f.name)}",
                            "type": file_type,
                            "size": f.stat().st_size,
                            "mtime": int(f.stat().st_mtime * 1000)
                        })
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(json.dumps({"materials": materials_list}, ensure_ascii=False).encode("utf-8"))
            return

        return super().do_GET()

    def do_POST(self):
        parsed = urlparse(self.path)
        content_length = int(self.headers.get("Content-Length", 0))
        post_data = self.rfile.read(content_length)

        if parsed.path == "/api/upload-material":
            try:
                req_data = json.loads(post_data.decode("utf-8"))
                filename = req_data.get("filename", "").strip()
                content_base64 = req_data.get("contentBase64", "")
                if not filename:
                    raise ValueError("文件名不能为空")
                
                safe_name = os.path.basename(filename).replace("/", "").replace("\\", "").replace("..", "")
                if not safe_name:
                    safe_name = f"document_{int(time.time())}.pdf"
                
                target_path = MATERIALS_DIR / safe_name
                raw_bytes = base64.b64decode(content_base64)
                with open(target_path, "wb") as wf:
                    wf.write(raw_bytes)
                
                ext = target_path.suffix.lower()
                file_type = "pdf" if ext == ".pdf" else ("markdown" if ext in [".md", ".markdown", ".txt"] else "other")
                
                res_meta = {
                    "ok": True,
                    "material": {
                        "name": safe_name,
                        "title": target_path.stem,
                        "url": f"/materials/{urllib.parse.quote(safe_name)}",
                        "type": file_type,
                        "size": len(raw_bytes),
                        "mtime": int(time.time() * 1000)
                    }
                }
                self.send_response(200)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(json.dumps(res_meta, ensure_ascii=False).encode("utf-8"))
            except Exception as e:
                self.send_response(500)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(json.dumps({"ok": False, "error": str(e)}).encode("utf-8"))
            return

        elif parsed.path == "/api/sessions/new":
            try:
                req = json.loads(post_data.decode("utf-8")) if post_data else {}
                title = req.get("title", "").strip() or f"新研究课题 #{int(time.time()) % 10000}"
                new_id = f"session_{int(time.time() * 1000)}"
                new_file = SESSIONS_DIR / f"{new_id}.json"
                
                initial_graph = {
                    "version": "1.0.0",
                    "project": title,
                    "annotations": [],
                    "nodes": [
                        {
                            "id": f"n_q_{int(time.time() * 1000)}",
                            "kind": "question",
                            "title": title,
                            "question": "",
                            "response": "",
                            "status": "idle",
                            "x": 240,
                            "y": 160
                        }
                    ],
                    "edges": []
                }
                with open(new_file, "w", encoding="utf-8") as f:
                    json.dump(initial_graph, f, ensure_ascii=False, indent=2)
                
                idx = get_sessions_index()
                new_session_meta = {
                    "id": new_id,
                    "title": title,
                    "createdAt": int(time.time() * 1000),
                    "updatedAt": int(time.time() * 1000),
                    "nodeCount": 1
                }
                idx["sessions"].insert(0, new_session_meta)
                idx["activeId"] = new_id
                save_sessions_index(idx)
                sync_active_to_legacy_graph(new_id)

                self.send_response(200)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(json.dumps({"ok": True, "activeId": new_id, "session": new_session_meta}).encode("utf-8"))
            except Exception as e:
                self.send_response(500)
                self.send_header("Content-Type", "application/json")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(json.dumps({"error": str(e)}).encode("utf-8"))
            return

        elif parsed.path == "/api/sessions/switch":
            try:
                req = json.loads(post_data.decode("utf-8"))
                target_id = req.get("sessionId")
                idx = get_sessions_index()
                target_sess = next((s for s in idx.get("sessions", []) if s["id"] == target_id), None)
                if not target_sess:
                    raise ValueError("未找到指定的课题")
                idx["activeId"] = target_id
                save_sessions_index(idx)
                sync_active_to_legacy_graph(target_id)
                self.send_response(200)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(json.dumps({"ok": True, "activeId": target_id, "session": target_sess}).encode("utf-8"))
            except Exception as e:
                self.send_response(500)
                self.send_header("Content-Type", "application/json")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(json.dumps({"error": str(e)}).encode("utf-8"))
            return

        elif parsed.path == "/api/sessions/rename":
            try:
                req = json.loads(post_data.decode("utf-8"))
                sess_id = req.get("sessionId")
                new_title = req.get("title", "").strip()
                if not new_title:
                    raise ValueError("标题不能为空")
                idx = get_sessions_index()
                target_sess = next((s for s in idx.get("sessions", []) if s["id"] == sess_id), None)
                if not target_sess:
                    raise ValueError("未找到指定的课题")
                target_sess["title"] = new_title
                target_sess["updatedAt"] = int(time.time() * 1000)
                save_sessions_index(idx)

                # 同时同步该图谱内部 project 属性
                sf = SESSIONS_DIR / f"{sess_id}.json"
                if sf.exists():
                    try:
                        with open(sf, "r", encoding="utf-8") as f:
                            g = json.load(f)
                        g["project"] = new_title
                        with open(sf, "w", encoding="utf-8") as f:
                            json.dump(g, f, ensure_ascii=False, indent=2)
                    except Exception:
                        pass

                self.send_response(200)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(json.dumps({"ok": True, "session": target_sess}).encode("utf-8"))
            except Exception as e:
                self.send_response(500)
                self.send_header("Content-Type", "application/json")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(json.dumps({"error": str(e)}).encode("utf-8"))
            return

        elif parsed.path == "/api/sessions/delete":
            try:
                req = json.loads(post_data.decode("utf-8"))
                del_id = req.get("sessionId")
                idx = get_sessions_index()
                sessions = idx.get("sessions", [])
                if len(sessions) <= 1:
                    raise ValueError("至少需要保留一个研究课题，无法删除最后一个课题")
                
                idx["sessions"] = [s for s in sessions if s["id"] != del_id]
                del_file = SESSIONS_DIR / f"{del_id}.json"
                if del_file.exists():
                    try:
                        del_file.unlink()
                    except Exception as fe:
                        print("删除会话文件异常:", fe)
                
                if idx["activeId"] == del_id:
                    idx["activeId"] = idx["sessions"][0]["id"]
                
                save_sessions_index(idx)
                sync_active_to_legacy_graph(idx["activeId"])

                self.send_response(200)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(json.dumps({"ok": True, "activeId": idx["activeId"], "sessions": idx["sessions"]}).encode("utf-8"))
            except Exception as e:
                self.send_response(500)
                self.send_header("Content-Type", "application/json")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(json.dumps({"error": str(e)}).encode("utf-8"))
            return

        elif parsed.path == "/api/graph":
            try:
                incoming_graph = json.loads(post_data.decode("utf-8"))
                query = urllib.parse.parse_qs(parsed.query)
                req_session_id = query.get("sessionId", [None])[0]
                target_file = get_session_file(req_session_id)

                # 智能合并守卫：绝不让客户端过期的空 response 覆盖服务端已持久化的高价值推演答案
                if target_file.exists():
                    try:
                        with open(target_file, "r", encoding="utf-8") as f:
                            disk_graph = json.load(f)
                        disk_nodes_map = {n.get("id"): n for n in disk_graph.get("nodes", [])}
                        for in_node in incoming_graph.get("nodes", []):
                            nid = in_node.get("id")
                            disk_node = disk_nodes_map.get(nid)
                            if disk_node and disk_node.get("status") == "done" and disk_node.get("response"):
                                if not in_node.get("response"):
                                    in_node["response"] = disk_node["response"]
                                    in_node["status"] = "done"
                    except Exception as me:
                        print("合并守卫跳过:", me)

                with open(target_file, "w", encoding="utf-8") as f:
                    json.dump(incoming_graph, f, ensure_ascii=False, indent=2)

                # 如果保存的是当前活跃课题，同步镜像到根目录 graph.json
                idx = get_sessions_index()
                active_id = idx.get("activeId")
                curr_id = req_session_id or active_id
                if curr_id == active_id:
                    sync_active_to_legacy_graph(active_id)
                
                # 更新元数据
                for s in idx.get("sessions", []):
                    if s["id"] == curr_id:
                        s["nodeCount"] = len(incoming_graph.get("nodes", []))
                        s["updatedAt"] = int(time.time() * 1000)
                        # 如果是首个节点且标题有意义，自动更新会话标题
                        nodes = incoming_graph.get("nodes", [])
                        if len(nodes) > 0 and s["title"].startswith("新研究课题"):
                            first_title = nodes[0].get("title")
                            if first_title:
                                s["title"] = first_title
                        break
                save_sessions_index(idx)

                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(json.dumps({"ok": True, "mtime": target_file.stat().st_mtime}).encode("utf-8"))
            except Exception as e:
                self.send_response(500)
                self.send_header("Content-Type", "application/json")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(json.dumps({"error": str(e)}).encode("utf-8"))
            return

        elif parsed.path == "/api/config":
            try:
                new_conf = json.loads(post_data.decode("utf-8"))
                if "api_base" in new_conf:
                    new_conf["api_base"] = sanitize_api_base(new_conf["api_base"])
                conf = get_config()
                conf.update(new_conf)
                with open(CONFIG_FILE, "w", encoding="utf-8") as f:
                    json.dump(conf, f, ensure_ascii=False, indent=2)
                self.send_response(200)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(json.dumps({"ok": True, "config": conf}, ensure_ascii=False).encode("utf-8"))
            except Exception as e:
                self.send_response(500)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(json.dumps({"ok": False, "error": str(e)}, ensure_ascii=False).encode("utf-8"))
            return

        elif parsed.path == "/api/test-connection":
            req_data = {}
            api_base = ""
            model = "deepseek-ai/DeepSeek-V4-Pro"
            try:
                req_data = json.loads(post_data.decode("utf-8")) if post_data else {}
                api_base = sanitize_api_base(req_data.get("api_base") or "")
                api_key = (req_data.get("api_key") or "").strip()
                model = (req_data.get("model") or "deepseek-ai/DeepSeek-V4-Pro").strip()

                if not api_base:
                    raise ValueError("接口基址 (API Base) 不能为空，请填写反代或服务商地址")

                start_time = time.time()
                chat_url = f"{api_base}/chat/completions"
                payload = {
                    "model": model,
                    "messages": [{"role": "user", "content": "ping"}],
                    "max_tokens": 5,
                    "temperature": 0.1
                }
                req = urllib.request.Request(
                    chat_url,
                    data=json.dumps(payload).encode("utf-8"),
                    headers={
                        "Authorization": f"Bearer {api_key}" if api_key else "",
                        "Content-Type": "application/json"
                    }
                )
                with urllib.request.urlopen(req, timeout=15) as res:
                    res.read()
                    latency_ms = int((time.time() - start_time) * 1000)

                self.send_response(200)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(json.dumps({
                    "ok": True,
                    "latency_ms": latency_ms,
                    "model": model,
                    "sanitized_api_base": api_base,
                    "message": f"连接成功！响应延迟: {latency_ms}ms · 模型【{model}】就绪"
                }, ensure_ascii=False).encode("utf-8"))
            except Exception as e:
                diag = analyze_api_exception(e, api_base or (req_data.get("api_base") or ""), model)
                self.send_response(200)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(json.dumps(diag, ensure_ascii=False).encode("utf-8"))
            return

        elif parsed.path == "/api/generate":
            req_data = {}
            api_base = ""
            model = ""
            try:
                req_data = json.loads(post_data.decode("utf-8"))
                node_id = req_data.get("nodeId")
                prompt = req_data.get("prompt", "")
                conf = get_config()
                model = req_data.get("model") or conf.get("model", "deepseek-ai/DeepSeek-V4-Pro")
                api_base = sanitize_api_base(conf.get("api_base", "https://api.siliconflow.cn/v1"))
                api_key = conf.get("api_key", "").strip()
                temp = conf.get("temperature", 0.3)
                req_session_id = req_data.get("sessionId")
                target_file = get_session_file(req_session_id)

                chat_url = f"{api_base}/chat/completions"
                payload = {
                    "model": model,
                    "messages": [
                        {
                            "role": "system",
                            "content": "你是一位善于化繁为简、生动清晰的学术助手。在解答概念时，请以通俗易懂、重点突出、深入浅出的语言系统解释其核心概念、定义内涵与实际应用，帮助读者快速建立直观理解。除非用户明确要求数学推导，否则无需展开冗长繁复的数学公式与底层微观机理推演。如果提供了上游推演上下文或文献素材，请保持概念的一致性与严谨性。"
                        },
                        {
                            "role": "user",
                            "content": prompt
                        }
                    ],
                    "temperature": temp
                }

                req = urllib.request.Request(
                    chat_url,
                    data=json.dumps(payload).encode("utf-8"),
                    headers={
                        "Authorization": f"Bearer {api_key}" if api_key else "",
                        "Content-Type": "application/json"
                    }
                )

                with urllib.request.urlopen(req, timeout=120) as res:
                    res_json = json.loads(res.read().decode("utf-8"))
                    answer_text = res_json["choices"][0]["message"]["content"]

                # 自动将解答写入当前课题文件并持久化
                if target_file.exists():
                    with open(target_file, "r", encoding="utf-8") as f:
                        graph = json.load(f)
                    
                    found = False
                    for n in graph.get("nodes", []):
                        if n.get("id") == node_id:
                            n["response"] = answer_text
                            n["status"] = "done"
                            found = True
                            break
                    
                    if found:
                        with open(target_file, "w", encoding="utf-8") as f:
                            json.dump(graph, f, ensure_ascii=False, indent=2)

                sync_active_to_legacy_graph(req_session_id)

                self.send_response(200)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(json.dumps({
                    "ok": True,
                    "nodeId": node_id,
                    "response": answer_text,
                    "model": model,
                    "mtime": target_file.stat().st_mtime
                }, ensure_ascii=False).encode("utf-8"))
            except Exception as e:
                diag = analyze_api_exception(e, api_base or "未设置", model or "未指定")
                self.send_response(200)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(json.dumps(diag, ensure_ascii=False).encode("utf-8"))
            return

        elif parsed.path == "/api/ask":
            try:
                req = json.loads(post_data.decode("utf-8"))
                node_id = req.get("nodeId")
                req_session_id = req.get("sessionId")
                target_file = get_session_file(req_session_id)
                if target_file.exists():
                    with open(target_file, "r", encoding="utf-8") as f:
                        graph = json.load(f)
                    
                    found = False
                    for n in graph.get("nodes", []):
                        if n.get("id") == node_id:
                            n["status"] = "pending"
                            n["compiledContext"] = req.get("compiledContext")
                            found = True
                            break
                    
                    if found:
                        with open(target_file, "w", encoding="utf-8") as f:
                            json.dump(graph, f, ensure_ascii=False, indent=2)

                    self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(json.dumps({"ok": True, "nodeId": node_id}).encode("utf-8"))
            except Exception as e:
                self.send_response(500)
                self.send_header("Content-Type", "application/json")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(json.dumps({"error": str(e)}).encode("utf-8"))
            return

        elif parsed.path == "/api/ocr-formula":
            api_base = ""
            model = ""
            try:
                req_data = json.loads(post_data.decode("utf-8"))
                image_url = req_data.get("imageUrl")
                citation = req_data.get("citation", "文献截框")
                
                conf = get_config()
                api_base = sanitize_api_base(conf.get("api_base", "https://api.siliconflow.cn/v1"))
                api_key = conf.get("api_key", "").strip()
                # 智能解析视觉模型 (支持双引擎分发)
                model = resolve_vision_model(conf)
                
                system_prompt = (
                    "你是一个精通学术论文、数学公式与光学成像理论的高级科研助手。\n"
                    "请仔细解析用户提供的论文剪裁图片：\n"
                    "1. 若包含数学公式：请输出标准严密的 LaTeX 表达式（单独一行使用 $$...$$ 格式），并逐一解释公式中各个关键物理符号的含义；\n"
                    "2. 若包含光学光路图、系统架构或曲线图：请简述其工作机制或实验物理结论；\n"
                    "3. 保持输出极简、专业、学术严密，严禁寒暄。"
                )
                
                payload = {
                    "model": model,
                    "temperature": 0.2,
                    "messages": [
                        {"role": "system", "content": system_prompt},
                        {
                            "role": "user",
                            "content": [
                                {"type": "text", "text": f"请解析以下截取自【{citation}】的公式/图表内容："},
                                {"type": "image_url", "image_url": {"url": image_url}}
                            ]
                        }
                    ]
                }
                
                req_body = json.dumps(payload).encode("utf-8")
                url = f"{api_base}/chat/completions"
                req = urllib.request.Request(
                    url,
                    data=req_body,
                    headers={
                        "Content-Type": "application/json",
                        "Authorization": f"Bearer {api_key}" if api_key else ""
                    }
                )
                
                with urllib.request.urlopen(req, timeout=45) as resp:
                    resp_data = json.loads(resp.read().decode("utf-8"))
                    answer = resp_data["choices"][0]["message"]["content"]
                    
                self.send_response(200)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(json.dumps({"ok": True, "analysis": answer, "model_used": model}, ensure_ascii=False).encode("utf-8"))
            except Exception as e:
                print("OCR Formula 异常:", e)
                diag = analyze_api_exception(e, api_base or "未设置", model or "未指定")
                self.send_response(200)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(json.dumps(diag, ensure_ascii=False).encode("utf-8"))
            return

        self.send_response(404)
        self.end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.end_headers()

def run_server():
    init_sessions_storage()
    server_address = ("", PORT)
    httpd = ThreadingHTTPServer(server_address, ThoughtDAGHandler)
    print(f"[+] ThoughtDAG 多会话本地服务已就绪: http://localhost:{PORT}")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n[-] 服务已停止。")
        httpd.server_close()

if __name__ == "__main__":
    run_server()
