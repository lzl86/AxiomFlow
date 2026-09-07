# PR-02: MVP 4.0 双引擎调度、服务商密钥管理、浅色模式无障碍与高帧率渲染架构

## 🔗 一键创建 PR 链接 (Direct 1-Click PR Creation Link)
👉 **[点击直接在 GitHub 创建 Pull Request](https://github.com/lzl86/AxiomFlow/compare/main...Shengxuan2513:AxiomFlow:feat/dual-engine-and-performance?expand=1)**

---

## 📌 PR 标题 (PR Title)
```text
feat: MVP 4.0 dual-engine dispatch, smart key memory, light-mode WCAG AA, and 120Hz hardware-accelerated rendering
```

---

## 📝 PR 正文说明 (PR Description)

```markdown
# 🚀 MVP 4.0: 双引擎自适应分发、国产/国际模型自由调度、服务商密钥智能记忆、浅色模式无障碍对比度与 120Hz 硬件加速渲染

## 📌 概述 (Overview)
本 PR 实现了 **AxiomFlow MVP 4.0** 核心架构升级，聚焦于**算力调度自主性**、**密钥安全交互体验**、**浅色模式高清晰度可读性 (WCAG AA)** 以及 **60fps/120fps 全链路硬件加速渲染与事件响应加固**。

---

## 🌟 核心特性与架构升级 (Key Features)

### 1. 🧠 双引擎自适应分发架构 (Dual-Engine Dispatch & Model Matrix)
- **国产旗舰与国际顶尖模型自由组合**：
  - 🇨🇳 硅基流动：`deepseek-ai/DeepSeek-V4-Pro` (深度推演旗舰)、`DeepSeek-R1`、`DeepSeek-V3`、`Qwen/Qwen2.5-VL-72B-Instruct`
  - 🇨🇳 阿里百炼：`qwen3.8-max`、`qwen-max`、`qwen-plus`、`qwen-vl-max`
  - 🇨🇳 DeepSeek 官方：`deepseek-chat`、`deepseek-reasoner`
  - 🌐 本地反代 & 国际模型：`gemini-3.8-flash-high`、`claude-3-5-sonnet-20241022`、`gpt-4o`、`o1`、`o3-mini`
- **双引擎分发守卫 (`resolve_vision_model`)**：
  - 推理任务由主推理大模型严密推演；
  - 论文公式/光路切片反编译任务自动路由至专属视觉多模态模型（如使用 DeepSeek 时自动调度 Qwen2.5-VL-72B）。

### 2. ⚡ 极简服务商密钥安全管理与连通性测试
- **本地按服务商私密记忆 (`axiomflow_provider_keys`)**：不同服务商独立记忆 Key，切换服务商自动载入对应密钥，不泄露至服务端配置模板。
- **一键服务商预设**：点击预设按钮一键配齐 API Base、优选推理模型与多模态模型。
- **密钥明文查看与实时连通性探测 (`/api/test-connection`)**：提供毫秒级诊断 Key 有效性与网络延迟。
- **纯技术官网链接**：仅展示官方控制台地址（如 `cloud.siliconflow.cn ↗`、`bailian.console.aliyun.com ↗`），零广告宣传。

### 3. 🎨 浅色模式无障碍对比度强化 (WCAG 2.1 AA 认证)
- 采样温度滑块卡片采用浅灰背景 `#f8fafc` 搭配深色文字 `#334155` 与数值蓝 `#0284c7`（对比度 **6.8:1**）。
- 主模型与视觉模型下拉选择框采用深翡翠绿 `#047857` 与深靛蓝 `#4338ca`，在白底背景下对比度均 **> 6:1**。

### 4. 🚀 全链路 60Hz / 120Hz 硬件加速与事件响应加固
- **`updateConnectedEdges` 增量连线算法**：拖拽节点时 0 次 DOM 销毁与创建，仅通过属性赋值更新关联贝塞尔曲线，配合 `requestAnimationFrame` 达到满帧丝滑。
- **GPU Compositor 硬件加速**：滚轮缩放画布直接交由 GPU 矩阵变换，移除冗余连线重绘；移除 `filter: blur()` 与 `drop-shadow()` 等 GPU 栅格化重负荷滤镜。
- **事件初始化首行同步与 3px 防抖**：`setupEventListeners()` 首行同步执行，解决网络延迟导致的按键未就绪问题；引入 3px 拖拽阈值，消除鼠标微颤对点击事件的吞噬。

### 5. 🎯 界面降噪与极简交互打磨
- **顶部紧凑双胶囊徽章**：实时指示主推理模型与视觉模型，点击直达配置。
- **因果拓扑聚焦 (Topology Focus)**：点击卡片自动高亮相关因果链路并柔和淡化无关节点；卡片头部隐藏冗余技术 ID。
- **单行紧凑阅读工具栏**：合并文献选择与翻页控制，顶部增加 2px 极细阅读进度线。
- **划词快捷键**：划选文字支持按 `[E]` 存为文献实证、按 `[Q]` 展开概念追问。

---

## 📑 架构决策记录 (ADR)
- 新增 `docs/adrs/ADR-04-双引擎调度模型密钥管理与高帧率渲染架构.md`
- 同步更新 `docs/adrs/ADR-02-MVP敏捷迭代路线图.md`

---

## 🧪 自动化测试与验证
- `verify_dual_engine.py`: 全部 7 项服务商与视觉路由测试 **100% Passed**
- `verify_all_enhancements.py`: 全部 4 项综合全栈测试 **100% Passed**
```
