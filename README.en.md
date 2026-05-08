**ds-code**

*DeepSeek Terminal Coding Agent -- Built on pi-mono*

[Quick Start](#quick-start) | [Core Features](#core-features) | [Architecture](#architecture) | [Configuration](#configuration) | [Development](#development) | [中文](README.md)

---

## What Is This?

`dsCode` is an AI coding agent that runs in your terminal. Built on [pi-mono](https://github.com/badlogic/pi-mono), it provides a standalone `dsc` CLI tool that defaults to DeepSeek V4 models while supporting multi-model switching, cost-aware routing, Recursive Language Models (RLM), sub-agent orchestration, execution policy engine, and more.

`dsc` automatically configures DeepSeek as the default model provider, dynamically injects identity prompts based on the active model, and provides a smooth developer experience.

## Quick Start

### 1. Install

```bash
git clone https://github.com/yourorg/dsCode.git
cd dsCode
npm install --ignore-scripts
npm run build
```

### 2. Configure API Key

Choose one of three methods:

```bash
# Method 1: Environment variable (recommended)
export DEEPSEEK_API_KEY=sk-your-key-here

# Method 2: Config file
mkdir -p ~/.ds/agent
echo '{"apiKey":"sk-your-key-here"}' > ~/.ds/agent/config.json

# Method 3: CLI argument
dsc --api-key sk-your-key-here "your prompt"
```

> Get an API Key: [platform.deepseek.com/api_keys](https://platform.deepseek.com/api_keys)

### 3. Start Using

```bash
npx dsc                              # Interactive TUI mode
npx dsc "explain what this code does" # Single prompt
npx dsc --model deepseek-v4-flash     # Specify model
npx dsc --reasoning high "refactor"   # Set reasoning depth
npx dsc --mode yolo "add unit tests"  # Full auto mode (skip approvals)
```

---

## Core Features

### Cost-Aware System


| Feature                     | Description                                                                                                                                                           |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Built-in Pricing Engine** | Hardcoded DeepSeek V4 Pro/Flash rate tables with cache hit/miss differential pricing, automatically switches between promotional and base pricing by date             |
| **Cost Tracker**            | Per-turn token usage and cost records with history queries and session totals, displayed in CNY by default                                                            |
| **Smart Routing**           | Heuristic rules based on context length, message count, and tool types to auto-select Flash or Pro model, dynamically adjusts reasoning depth based on operation mode |


### Recursive Language Model (RLM)


| Feature                     | Description                                                                                                                                                                          |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **RLM Bridge**              | Handles oversized context by delegating large file content to a lightweight child model (default: `deepseek-v4-flash`), avoiding parent context window consumption                   |
| **Batch Queries**           | Supports `llm_query_batched` for submitting multiple analysis tasks in parallel                                                                                                      |
| **Python REPL Integration** | Optional: enable a Python sidecar process by setting the `RLM_PYTHON_SCRIPT` environment variable, communicating via JSON-RPC protocol. Requires a user-provided Python entry script |
| **Recursion Depth Control** | Configurable max recursion depth (default: 1) to prevent runaway consumption                                                                                                         |


### Sub-Agent Orchestration


| Feature                 | Description                                                                                                                   |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| **Role Types**          | 7 predefined roles: `general` / `explore` / `plan` / `review` / `implementer` / `verifier` / `custom`                         |
| **Concurrency Control** | Up to 20 concurrent sub-agents with resource leases to prevent file write conflicts                                           |
| **Structured Output**   | Summary / Evidence / Changes / Risks / Blockers format enforced via system prompts (prompt-based, not JSON Schema validation) |
| **Persistence**         | Sub-agent state serializable to JSON for session recovery                                                                     |
| **Tool Set**            | `agent_spawn` / `agent_wait` / `agent_message` / `agent_cancel` / `agent_list`                                                |


### Execution Policy Engine


| Feature                        | Description                                                                                                                         |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| **Layered Rules**              | Three-tier policy stack: `builtinDefault` < `agent` < `user`, deny rules take priority                                              |
| **Command Argument Awareness** | Built-in subcommand table for 150+ commands (e.g. `git status` vs `git push --force`), precise subcommand-level policy matching     |
| **Safe Defaults**              | Read-only commands (`ls`, `cat`, `git log`) trusted by default, dangerous commands (`rm -rf`, `git push --force`) denied by default |
| **Approval Flow**              | Unknown commands trigger approval requests with trust amendment suggestions                                                         |


### LSP Diagnostics Integration


| Feature                    | Description                                                                                                                    |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| **Edit Diagnostics**       | Fetches language server errors/warnings after file write/edit operations via extension hooks (requires `lspEnabled` in config) |
| **Multi-Language Support** | Built-in configurations for `typescript-language-server`, `pyright`, `rust-analyzer`                                           |
| **Error Appending**        | Diagnostic errors from edit operations are appended to tool results for the model to reference and fix in the next turn        |


### Resilient Sessions


| Feature                | Description                                                                                                                                            |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Side-Git Snapshots** | Automatically creates `git stash` snapshots before each turn (up to 50), without affecting the project repository                                      |
| **Snapshot Rollback**  | Restore to any historical state by `turnId` (slash commands `/snapshot-list`, `/snapshot-restore`)                                                     |
| **Compaction Advisor** | Provides compaction recommendations (`CompactionAdvice`) based on cache hit ratios and context utilization; actual compaction is performed by the host |


### Inherited from pi-mono

All core capabilities from pi-mono are fully preserved:

- File read/write, code editing, Bash command execution
- Interactive TUI / JSON / RPC operating modes
- Session save and restore
- Extension system (extensions / skills / themes)
- Multi-model support with Ctrl+P model switching
- Automatic project context file (AGENTS.md) loading

---

## Architecture

```
dsCode/
├── packages/
│   ├── ai/              @mariozechner/pi-ai          # Unified multi-model LLM API
│   ├── agent/           @mariozechner/pi-agent-core   # Agent runtime (tool calls, state)
│   ├── coding-agent/    @mariozechner/pi-coding-agent # Coding Agent CLI (pi command)
│   ├── tui/             @mariozechner/pi-tui          # Terminal UI library (diff rendering)
│   ├── ds-core/         @deepseek/ds-core             # DeepSeek core (pricing/RLM/subagent/policy/LSP/session)
│   └── ds-agent/        @deepseek/ds-agent            # dsc CLI entry point
└── ...
```

**Call chain:**

```
dsc CLI → Argument translation + identity prompt injection + API key detection
        → pi-coding-agent main()
        → Model resolution → DeepSeek V4 Pro/Flash
        → Agent Loop (tool call → approval → execution → feedback)
        → TUI rendering / JSON output / RPC service
```

---

## Execution Modes


| Mode      | Trigger       | Behavior                                                          |
| --------- | ------------- | ----------------------------------------------------------------- |
| **Plan**  | `--mode plan` | Read-only -- can only read files and search, no modifications     |
| **Agent** | Default       | Interactive -- write operations require user approval             |
| **YOLO**  | `--mode yolo` | Full auto -- all operations auto-approved, for trusted workspaces |


---

## Configuration

### Config File

Located at `~/.ds/agent/config.json`:

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

### Environment Variables


| Variable              | Description                                                        |
| --------------------- | ------------------------------------------------------------------ |
| `DEEPSEEK_API_KEY`    | DeepSeek API key                                                   |
| `DS_MODEL`            | Default model (overrides config file)                              |
| `DS_REASONING_EFFORT` | Default reasoning depth: `off` / `low` / `medium` / `high` / `max` |
| `DS_MODE`             | Default mode: `plan` / `agent` / `yolo`                            |
| `DS_DEBUG`            | Set to `1` to output debug info (shows arguments passed to pi)     |


### CLI Arguments

```
dsc [options] [prompt]

Options:
  --mode <plan|agent|yolo>    Execution mode (default: agent)
  --model <model>             Model name (default: deepseek-v4-pro)
  --reasoning <effort>        Reasoning depth: off|low|medium|high|max
  --api-key <key>             DeepSeek API Key
  --json                      JSON output mode
  --rpc                       RPC service mode
  -v, --version               Show version
  -h, --help                  Show help
```

---

## Models and Pricing


| Model               | Context Window | Input (Cache Hit) | Input (Cache Miss) | Output  |
| ------------------- | -------------- | ----------------- | ------------------ | ------- |
| `deepseek-v4-pro`   | 1M tokens      | ¥0.026/M          | ¥3.14/M            | ¥6.28/M |
| `deepseek-v4-flash` | 1M tokens      | ¥0.020/M          | ¥1.01/M            | ¥2.02/M |


> V4 Pro currently enjoys a 75% promotional discount, valid until May 31, 2026, 15:59 UTC.
> For latest pricing, see the [DeepSeek pricing page](https://api-docs.deepseek.com/quick_start/pricing).

---

## Package Overview


| Package          | npm Name                        | Description                                                                     |
| ---------------- | ------------------------------- | ------------------------------------------------------------------------------- |
| **ds-agent**     | `@deepseek/ds-agent`            | `dsc` CLI entry point, argument translation, DeepSeek configuration             |
| **ds-core**      | `@deepseek/ds-core`             | DeepSeek core library: pricing, routing, RLM, sub-agents, policy, LSP, sessions |
| **ai**           | `@mariozechner/pi-ai`           | Unified multi-model LLM API (OpenAI, Anthropic, Google, DeepSeek, etc.)         |
| **agent**        | `@mariozechner/pi-agent-core`   | Agent runtime: transport abstraction, tool calls, state management              |
| **coding-agent** | `@mariozechner/pi-coding-agent` | Interactive coding agent CLI                                                    |
| **tui**          | `@mariozechner/pi-tui`          | Terminal UI library (diff rendering)                                            |


---

## Development

### Requirements

- Node.js >= 20.0.0
- npm >= 9

### Build

```bash
npm install --ignore-scripts   # Install dependencies (skip native compilation)
npm run build                  # Build all packages in dependency order
```

Build order: `tui` -> `ai` -> `agent` -> `coding-agent` -> `ds-core` -> `ds-agent`

### Build Individual Package

```bash
cd packages/ds-core && npm run build
cd packages/ds-agent && npm run build
```

### Check

```bash
npm run check    # Lint + format + type check (requires build first)
```

### Run from Source

```bash
# Interactive mode
DEEPSEEK_API_KEY=sk-xxx npx dsc

# Debug mode (shows arguments passed to pi)
DS_DEBUG=1 DEEPSEEK_API_KEY=sk-xxx npx dsc --print "hello"
```

---

## Roadmap

- ~~Full ds-core capability integration into dsc CLI (pricing dashboard, RLM tools, sub-agent commands)~~ **Done**
- ~~Compaction advisor~~ **Done** (provides compaction timing recommendations; actual compaction is performed by the host)
- ~~Auto Mode: automatic Flash/Pro + reasoning depth selection~~ **Done** (heuristic routing + autoReasoning dynamic adjustment)
- Built-in RLM Python entry script (eliminate need for manual `RLM_PYTHON_SCRIPT` configuration)
- Prefix cache control optimization

---

## Acknowledgments

This project is built on [pi-mono](https://github.com/badlogic/pi-mono). Thanks to [@badlogic](https://github.com/badlogic) and all pi-mono contributors for their excellent work.

Reference project: [DeepSeek-TUI](https://github.com/Hmbown/DeepSeek-TUI)

---

## License

[MIT](LICENSE)