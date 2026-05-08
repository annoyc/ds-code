**ds-code**

*DeepSeek 终端编程智能体 —— 基于 pi-mono 构建的 AI Coding Agent*

[快速开始](#快速开始) • [核心特性](#核心特性) • [架构概览](#架构概览) • [配置](#配置) • [开发指南](#开发指南) • [English](README.en.md)

---

## 这是什么？

`dsCode` 是一个运行在终端中的 AI 编程智能体。它基于 [pi-mono](https://github.com/badlogic/pi-mono) 构建，提供了独立的 `dsc` 命令行工具，默认使用 DeepSeek V4 系列模型，同时支持多模型切换，并提供成本感知路由、递归语言模型（RLM）、子智能体编排、执行策略引擎等能力。

`dsc` 会自动配置 DeepSeek 作为默认模型提供商，根据实际使用的模型动态注入身份提示词，并提供中文友好的配置和错误提示。

## 快速开始

### 1. 安装

```bash
git clone https://github.com/yourorg/dsCode.git
cd dsCode
npm install --ignore-scripts
npm run build
```

### 2. 配置 API Key

三种方式任选其一：

```bash
# 方式 1: 环境变量（推荐）
export DEEPSEEK_API_KEY=sk-your-key-here

# 方式 2: 配置文件
mkdir -p ~/.ds/agent
echo '{"apiKey":"sk-your-key-here"}' > ~/.ds/agent/config.json

# 方式 3: 命令行参数
dsc --api-key sk-your-key-here "你的提示词"
```

> 获取 API Key: [platform.deepseek.com/api_keys](https://platform.deepseek.com/api_keys)

### 3. 开始使用

```bash
npx dsc                              # 交互式 TUI 模式
npx dsc "解释这段代码的作用"            # 单次提示
npx dsc --model deepseek-v4-flash     # 指定模型
npx dsc --reasoning high "重构这个函数" # 指定推理深度
npx dsc --mode yolo "添加单元测试"      # 全自动模式（跳过审批）
```

---

## 核心特性

### 成本感知系统


| 特性         | 说明                                                         |
| ---------- | ---------------------------------------------------------- |
| **内置定价引擎** | 硬编码 DeepSeek V4 Pro/Flash 费率表，支持缓存命中/未命中差异定价，按日期自动切换折扣期与原价 |
| **成本追踪器**  | 逐轮 token 使用量与费用记录，支持历史查询与会话累计，默认人民币（CNY）显示                 |
| **智能路由**   | 基于上下文长度、消息数和工具类型的启发式规则自动选择 Flash 或 Pro 模型，按操作模式动态调整推理深度    |


### 递归语言模型 - RLM


| 特性                 | 说明                                                                                     |
| ------------------ | -------------------------------------------------------------------------------------- |
| **RLM Bridge**     | 处理超长上下文：将大文件内容委托给轻量子模型（默认 `deepseek-v4-flash`）分析，避免消耗父模型上下文窗口                          |
| **批量查询**           | 支持 `llm_query_batched`，一次性提交多个分析任务并行处理                                                 |
| **Python REPL 集成** | 可选功能：通过设置 `RLM_PYTHON_SCRIPT` 环境变量启用 Python 侧车进程，经 JSON-RPC 协议扩展分析能力。需自行提供 Python 入口脚本 |
| **递归深度控制**         | 可配置最大递归深度（默认 1），防止无限递归消耗                                                               |


### 子智能体编排


| 特性        | 说明                                                                                          |
| --------- | ------------------------------------------------------------------------------------------- |
| **角色类型**  | 7 种预定义角色：`general` / `explore` / `plan` / `review` / `implementer` / `verifier` / `custom`  |
| **并发控制**  | 最多 20 个并发子智能体，带资源租约避免文件写冲突                                                                  |
| **结构化输出** | 通过系统提示词约束 Summary / Evidence / Changes / Risks / Blockers 格式（prompt-based，非 JSON Schema 校验） |
| **持久化**   | 子智能体状态可序列化到 JSON，支持会话恢复                                                                     |
| **工具集**   | `agent_spawn` / `agent_wait` / `agent_message` / `agent_cancel` / `agent_list`              |


### 执行策略引擎


| 特性         | 说明                                                                   |
| ---------- | -------------------------------------------------------------------- |
| **分层规则**   | 三层策略叠加：`builtinDefault` < `agent` < `user`，拒绝规则优先                    |
| **命令参数感知** | 内置 150+ 条命令的子命令表（如 `git status` vs `git push --force`），精确到子命令级别的策略匹配 |
| **安全默认值**  | 只读命令（`ls`、`cat`、`git log`）默认信任，危险命令（`rm -rf`、`git push --force`）默认拒绝 |
| **审批流**    | 未知命令触发审批请求，可附带信任修正建议                                                 |


### LSP 诊断集成


| 特性         | 说明                                                           |
| ---------- | ------------------------------------------------------------ |
| **文件编辑诊断** | 文件写入/编辑后通过扩展钩子获取语言服务器的错误/警告信息（需在配置中启用 `lspEnabled`）          |
| **多语言支持**  | 内置 `typescript-language-server`、`pyright`、`rust-analyzer` 配置 |
| **错误追加**   | 编辑操作产生的诊断错误会追加到工具结果中，供模型在下一轮参考并修复                            |


### 韧性会话


| 特性              | 说明                                                                |
| --------------- | ----------------------------------------------------------------- |
| **Side-Git 快照** | 每轮对话前自动创建 `git stash` 快照（上限 50 个），不影响项目仓库                         |
| **快照回滚**        | 支持按 `turnId` 恢复到任意历史状态（斜杠命令 `/snapshot-list`、`/snapshot-restore`） |
| **压缩建议器**       | 基于缓存命中率和上下文利用率提供压缩建议（`CompactionAdvice`），由宿主决定是否执行压缩              |


### 继承自 pi-mono

所有 pi-mono 的核心能力均完整保留：

- 文件读写、代码编辑、Bash 命令执行
- 交互式 TUI / JSON / RPC 三种运行模式
- 会话保存与恢复
- 扩展系统（extensions / skills / themes）
- 多模型支持与 Ctrl+P 模型切换
- 项目上下文文件（AGENTS.md）自动加载

---

## 架构概览

```
dsCode/
├── packages/
│   ├── ai/              @mariozechner/pi-ai          # 统一多模型 LLM API
│   ├── agent/           @mariozechner/pi-agent-core   # Agent 运行时（工具调用、状态管理）
│   ├── coding-agent/    @mariozechner/pi-coding-agent # 编程 Agent CLI（pi 命令）
│   ├── tui/             @mariozechner/pi-tui          # 终端 UI 库（差分渲染）
│   ├── ds-core/         @deepseek/ds-core             # DeepSeek 核心库（定价/RLM/子智能体/策略/LSP/会话）
│   └── ds-agent/        @deepseek/ds-agent            # dsc CLI 入口
└── ...
```

**调用链路：**

```
dsc CLI → 参数转换 + 身份提示词注入 + API Key 检测
        → pi-coding-agent main()
        → 模型解析 → DeepSeek V4 Pro/Flash
        → Agent Loop（工具调用 → 审批 → 执行 → 反馈）
        → TUI 渲染 / JSON 输出 / RPC 服务
```

---

## 运行模式


| 模式        | 触发方式          | 行为                        |
| --------- | ------------- | ------------------------- |
| **Plan**  | `--mode plan` | 只读模式 —— 只能读取文件和搜索，不做任何修改  |
| **Agent** | 默认            | 交互模式 —— 写操作需要用户审批         |
| **YOLO**  | `--mode yolo` | 全自动模式 —— 所有操作自动执行，适合可信工作区 |


---

## 配置

### 配置文件

配置文件位于 `~/.ds/agent/config.json`：

```json
{
  "model": "deepseek-v4-pro",
  "reasoningEffort": "medium",
  "mode": "agent",
  "autoModel": true,
  "autoReasoning": true,
  "costCurrency": "cny",
  "lspEnabled": false,
  "apiKey": "sk-your-key-here",
  "execPolicy": {
    "trustedPrefixes": ["npm test", "cargo build"],
    "deniedPrefixes": ["rm -rf /"]
  }
}
```

### 环境变量


| 变量                    | 说明                                               |
| --------------------- | ------------------------------------------------ |
| `DEEPSEEK_API_KEY`    | DeepSeek API 密钥                                  |
| `DS_MODEL`            | 默认模型（覆盖配置文件）                                     |
| `DS_REASONING_EFFORT` | 默认推理深度：`off` / `low` / `medium` / `high` / `max` |
| `DS_MODE`             | 默认模式：`plan` / `agent` / `yolo`                   |
| `DS_DEBUG`            | 设为 `1` 输出调试信息（显示传递给 pi 的参数）                      |


### 命令行参数

```
dsc [选项] [提示词]

选项：
  --mode <plan|agent|yolo>    执行模式（默认: agent）
  --model <model>             模型名称（默认: deepseek-v4-pro）
  --reasoning <effort>        推理深度: off|low|medium|high|max
  --api-key <key>             DeepSeek API Key
  --json                      JSON 输出模式
  --rpc                       RPC 服务模式
  -v, --version               显示版本
  -h, --help                  显示帮助
```

---

## 模型与定价


| 模型                  | 上下文窗口     | 输入（缓存命中） | 输入（缓存未命中） | 输出      |
| ------------------- | --------- | -------- | --------- | ------- |
| `deepseek-v4-pro`   | 1M tokens | ¥0.025/M | ¥3.0/M    | ¥6.0/M  |
| `deepseek-v4-flash` | 1M tokens | ¥0.020/M | ¥1.0/M    | ¥2.0/M  |


> V4 Pro 目前享受 75% 限时折扣，有效期至 2026 年 5 月 31 日 15:59 UTC。
> 最新价格请查阅 [DeepSeek 官方定价页](https://api-docs.deepseek.com/zh-cn/quick_start/pricing)。

---

## 包一览


| 包名               | npm 包名                          | 说明                                                |
| ---------------- | ------------------------------- | ------------------------------------------------- |
| **ds-agent**     | `@deepseek/ds-agent`            | `dsc` 命令行入口，参数转换与 DeepSeek 配置                     |
| **ds-core**      | `@deepseek/ds-core`             | DeepSeek 核心库：定价、路由、RLM、子智能体、策略、LSP、会话             |
| **ai**           | `@mariozechner/pi-ai`           | 统一多模型 LLM API（OpenAI、Anthropic、Google、DeepSeek 等） |
| **agent**        | `@mariozechner/pi-agent-core`   | Agent 运行时：传输抽象、工具调用、状态管理                          |
| **coding-agent** | `@mariozechner/pi-coding-agent` | 交互式编程 Agent CLI                                   |
| **tui**          | `@mariozechner/pi-tui`          | 终端 UI 库（差分渲染）                                     |


---

## 开发指南

### 环境要求

- Node.js >= 20.0.0
- npm >= 9

### 构建

```bash
npm install --ignore-scripts   # 安装依赖（跳过原生编译）
npm run build                  # 按依赖顺序构建所有包
```

构建顺序：`tui` → `ai` → `agent` → `coding-agent` → `ds-core` → `ds-agent`

### 单独构建某个包

```bash
cd packages/ds-core && npm run build
cd packages/ds-agent && npm run build
```

### 检查

```bash
npm run check    # Lint + 格式化 + 类型检查（需要先 build）
```

### 从源码运行

```bash
# 交互模式
DEEPSEEK_API_KEY=sk-xxx npx dsc

# 调试模式（显示传递给 pi 的参数）
DS_DEBUG=1 DEEPSEEK_API_KEY=sk-xxx npx dsc --print "hello"
```

---

## 路线图

- ~~ds-core 能力全面集成到 dsc CLI（定价仪表盘、RLM 工具、子智能体命令）~~ **已完成**
- ~~缓存感知压缩建议器~~ **已完成**（提供压缩时机建议，实际压缩由宿主执行）
- ~~Auto Mode：自动选择 Flash/Pro + 推理深度~~ **已完成**（启发式路由 + autoReasoning 动态调整）
- RLM Python 入口脚本（内置默认脚本，无需手动配置 `RLM_PYTHON_SCRIPT`）
- 前缀缓存控制优化

---

## 致谢

本项目基于 [pi-mono](https://github.com/badlogic/pi-mono) 构建，感谢 [@badlogic](https://github.com/badlogic) 及所有 pi-mono 贡献者的出色工作。

参考项目：[DeepSeek-TUI](https://github.com/Hmbown/DeepSeek-TUI)

---

## 许可证

[MIT](LICENSE)