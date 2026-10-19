# 💎 pi-prism (`P.R.I.S.M.`)

> **P.R.I.S.M.** — **P**ortable **R**ule-driven **I**ntelligence with **S**tructured **M**emory
>
> *A Domain-Agnostic, Anti-Sycophancy Meta-Harness & Portable Two-Layer Brain Architecture built on top of [`pi-coding-agent`](https://github.com/badlogic/pi-mono).*

---

## 🌟 Why `pi-prism`? (為什麼打造 P.R.I.S.M.？)

像稜鏡（**Prism**）將單一光束折射為清晰的光譜一樣，**`pi-prism`** 將單一、容易產生幻覺與盲從（Sycophancy）的 LLM，轉化為**受規則驅動（Rule-driven）、具備結構化記憶圖譜（Structured Memory）、且跨模型交叉驗證（Dialectical Verification）**的可攜式工程大腦。

傳統 AI Coding Agent 在專案規模擴大、跨越多個對話 Session 後，常陷入三大致命困境：
1. **盲目討好與自我催眠（Sycophancy & Self-Grading）**：同一個模型自己寫 Code、自己審核、自己誇獎自己通過。
2. **脈絡腐敗與記憶失憶（Context Rot & Drift）**：文件越寫越多、新舊規格衝突，Agent 載入過時資訊導致開發到一半邏輯錯亂。
3. **防護脆弱與環境綁定（Fragile Guardrails & Lock-in）**：缺乏確定性的工具鏈攔截，且大腦配置散落於系統全域目錄，無法隨專案版控帶走。

**`pi-prism`** 透過 **「兩層式可攜大腦（`.Friday` Runtime + `memory/` DAG 圖譜）」** 與 **「確定性驗證鐵三角」** 徹底解決上述問題。

---

## 🏛️ Core Architecture (核心架構四大支柱)

```mermaid
flowchart TB
    subgraph L1 ["Layer 1: Portable Brain Runtime (.Friday/)"]
        ORCH["Fixed Main Orchestrator<br/>(High-Reasoning Brain)"]
        WG["workspace-guard.ts<br/>(Quote-Aware AST & Boundary Guard)"]
        EG["epistemic-gate.ts<br/>(Progressive Disclosure & Drift Gate)"]
        MR["model-router.ts<br/>(Subagent Dispatch & /dream Consolidation)"]
    end

    subgraph L2 ["Layer 2: Structured Memory DAG (memory/ + schemas/)"]
        MAP["CONTEXT_MAP.md & CONTEXT_INDEX.json<br/>(Auto-Compiled DAG Index)"]
        NODES["Governed Memory Nodes<br/>(codex / specs / audits / adr / bugs / graveyard)"]
        ORACLE["schema_validator.py<br/>(External Deterministic Oracle)"]
    end

    ORCH --> WG & EG & MR
    EG -->|"Injects Verified Index"| MAP
    MAP --> NODES
    ORACLE -->|"Enforces Schema & Anti-Sycophancy"| NODES
```

### 1. Portable Two-Layer Brain (`P`ortable)
- **Layer 1 — 執行期神經中樞 ([`.Friday/`](.Friday/))**：封裝 Hooks、跨模型 Subagent 定義 ([`.Friday/agents/`](.Friday/agents/))、提示詞契約 ([`.Friday/prompts/`](.Friday/prompts/)) 與技能 ([`.Friday/skills/`](.Friday/skills/))。只需透過 `PI_CODING_AGENT_DIR=$(pwd)/.Friday pi` 即可在任何機器啟動完整大腦。
- **Layer 2 — 結構化記憶層 ([`memory/`](memory/))**：100% 隨 Git 版控的專案長期記憶，與執行期配置乾淨解耦。

### 2. Rule-Driven Guardrails & Anti-Sycophancy (`R`ule-driven `I`ntelligence)
- **反盲從跨模型互審（Anti-Sycophancy Invariant）**：在 `verified` 狀態的記憶與規格節點中，強制要求 **`author.model != reviewer.model`**（例如由不同模型家族分別撰寫與審查），嚴禁同模型自我背書。
- **外部獨立驗證器（[`schemas/schema_validator.py`](schemas/schema_validator.py)）**：LLM 絕不自己給自己打分數。所有 Frontmatter 契約、拓撲完整性、行數預算（Prose Line Budget）與測試預言機（Verification Oracle）皆由外部 Python 腳本決定性裁決。
- **語法感知安全護欄（[`workspace-guard.ts`](.Friday/extensions/workspace-guard.ts)）**：採用雙狀態引號感知剖析器（Quote-Aware Parser），精準攔截越界路徑（`BOUNDARY`）、機密讀取（`SEC-CRED`）、大腦自毀修改（`SEC-BRAIN`）與危險破壞指令（`SEC-CMD-V1`），並回傳具修復指引的 `RemediationPointer`。

### 3. Structured Epistemic Memory & `/dream` (`S`tructured `M`emory)
- **零漂移全文件 Schema 納管**：拒絕無結構的散落文件。所有架構規格、演進路線圖、ADR 與審計紀錄皆納管於 [`memory/`](memory/) 職責目錄，並由 [`scripts/auto_update_map.py`](scripts/auto_update_map.py) 自動編譯出 [`memory/codex/CONTEXT_MAP.md`](memory/codex/CONTEXT_MAP.md) 與 [`memory/index/CONTEXT_INDEX.json`](memory/index/CONTEXT_INDEX.json)（含 DAG 循環依賴與斷鏈偵測）。
- **認知誠實門閥（[`epistemic-gate.ts`](.Friday/extensions/epistemic-gate.ts)）**：強制區分 `[FACT]`（經工具驗證之事實）與 `[INFERRED]`（推論），並在每回合自動進行漸進式揭露（Progressive Disclosure）。
- **`/dream` 睡眠記憶固化（Memory Consolidation）**：將跨 Session 的瑣碎對話去蕪存菁，自動提煉為永久受 Schema 保護的記憶節點。

---

## 📂 Repository Structure (目錄結構)

```text
.
├── README.md                        # P.R.I.S.M. 專案總覽與快速啟動指南
├── .Friday/                         # [Layer 1] 可攜式 Agent 執行期大腦 (PI_CODING_AGENT_DIR)
│   ├── AGENTS.md                    # L0 全域精簡憲法 (Always-Loaded Entrypoint, <60 lines)
│   ├── settings.json                # 啟用之 Extensions、Prompts、Skills 與預設模型配置
│   ├── models.json                  # 多供應商/本地端模型註冊表 (不含任何明文 API Key)
│   ├── agents/                      # 固定職責之專業 Subagents (scout, architect, challenger, worker, auditor)
│   ├── extensions/                  # 三大核心 TypeScript Hooks
│   │   ├── workspace-guard.ts       # 邊界、憑證、大腦保護與 Shell 語法感知攔截器
│   │   ├── epistemic-gate.ts        # 漸進式記憶注入與認知誠實度檢查門閥
│   │   └── model-router.ts          # 動態路由、視覺自動分流與 /mode 角色/憑證管理中心
│   ├── prompts/                     # 結構化驗證與記憶寫入 Prompt 模板
│   └── skills/                      # 隨附技能包 (root-cause-debugging, safe-refactoring 等)
├── memory/                          # [Layer 2] 100% 受 Schema 納管的零漂移記憶圖譜
│   ├── LEDGER.md                    # 唯一活躍執行台帳 (<=80 lines)
│   ├── codex/                       # 000~200: 靈魂憲法、全域鐵律、核心決策與 CONTEXT_MAP.md
│   ├── specs/                       # 200~700: 六階段演進路線圖、模型指南與架構藍圖
│   ├── audits/                      # 600: 跨模型獨立驗證與審計報告
│   └── index/                       # 機器可讀之拓撲與 affected_paths 索引 (CONTEXT_INDEX.json)
├── schemas/
│   └── schema_validator.py          # 外部決定性驗證器 (Schema + DAG + Anti-Sycophancy + Oracle)
└── scripts/
    ├── auto_update_map.py           # DAG 拓撲檢查與 CONTEXT_MAP 自動編譯器
    └── test_friday_architecture.py  # 端到端架構自動化驗證套件
```

---

## 🚀 Quick Start (快速啟動指南)

### 1. 環境需求
- **Python 3.10+**（用於執行外部決定性驗證器與 DAG 索引編譯器）
- **Node.js 20+** 與 [`@earendil-works/pi-coding-agent`](https://pi.dev) CLI（`pi`）
  > 💡 **硬體相容性說明**：本架構之 Hooks、驗證器與子程序調度完全不依賴本地 GPU 或特定 CPU 指令集（在無 `AVX2` 的舊款 CPU 如 Intel i5-3570K 與最新世代硬體上皆可 100% 順暢運作）。

### 2. 設定 API Keys 與 OAuth 憑證（受 `.gitignore` 與 `SEC-CRED` 雙重保護）
本專案之 API Key 與訂閱 OAuth 憑證統一存放於 **`.Friday/auth.json`**（權限 `0600`，已被 `.gitignore` 排除且受 `workspace-guard.ts` 的 `SEC-CRED` 規則硬性保護，不會隨 `git push` 外洩）。完整多模型與多組 Key 分流設定請參閱：[`memory/specs/500_MODEL_APIKEY_GUIDE.md`](memory/specs/500_MODEL_APIKEY_GUIDE.md)。

- **方式 A（Google Cloud Vertex AI — 使用個人 Google 帳號 OAuth / 免靜態金鑰，推薦用於 `gemini-4-argon`）**：
  1. 在本機完成 Google Cloud SDK (`gcloud`) OAuth 授權並產生 ADC 憑證（`~/.config/gcloud/application_default_credentials.json`）：
     ```bash
     gcloud auth login --update-adc
     gcloud projects list   # 查詢你帳號下的 PROJECT_ID
     ```
  2. 啟動 `./friday`（或 `PI_CODING_AGENT_DIR=$(pwd)/.Friday pi`）後，在對話框綁定 GCP 專案與主腦模型：
     ```text
     /mode vertex <你的_PROJECT_ID> global
     /mode set orchestrator google-vertex/gemini-4-argon
     ```
- **方式 B（Claude Pro / Max 訂閱或 OpenAI ChatGPT 訂閱 — 內建瀏覽器 OAuth 登入）**：
  1. 啟動 `./friday` 後直接輸入 `/login`，選擇 **`Anthropic`**（或 `OpenAI`），透過彈出的瀏覽器登入訂閱帳號，Token 會自動寫入 `.Friday/auth.json`。
  2. 綁定主腦或專家角色模型：
     ```text
     /mode set orchestrator anthropic/claude-sonnet-4-5
     ```
- **方式 C（各供應商靜態 API Key — 如 NVIDIA NIM、Anthropic、Gemini AI Studio、OpenRouter 等）**：
  - 啟動 `./friday` 後輸入 `/mode` 進入 `2. 🔑 設定 Provider API Key`，或直接執行：
    ```text
    /mode key nvidia nvapi-...
    ```

### 3. 執行架構完整性與自動化測試
在啟動 Agent 前，先用外部決定性驗證器確認所有記憶節點、DAG 圖譜與 Hooks 皆處於 100% 健康狀態：
```bash
# 1. 驗證所有記憶節點 Schema、反盲從規則與執行 Verification Oracles
python3 schemas/schema_validator.py --run-oracle

# 2. 重新編譯記憶導覽圖並執行 DAG 循環/斷鏈檢查
python3 scripts/auto_update_map.py

# 3. 執行端到端架構測試套件
python3 scripts/test_friday_architecture.py
```

### 4. 掛載可攜式大腦並啟動 `pi`
在專案根目錄下直接執行 `./friday`（或 `PI_CODING_AGENT_DIR=$(pwd)/.Friday pi`）即可啟動：
```bash
./friday
```

啟動後可在 `pi` 互動介面中使用內建擴充指令：
- `/mode`：開啟**支援視窗捲動與依 Provider 分類篩選**的互動式管理選單（個別指定 `orchestrator` / `scout` / `architect` / `challenger` / `code` / `audit` / `vision` 模型、設定 Provider API Key / Vertex AI 專案、切換自動路由模式）。
- `/mode set <角色> <provider/model>`：直接將指定角色綁定至目標模型（例：`/mode set orchestrator google-vertex/gemini-4-argon`）。
- `/mode key <provider> <API_KEY>`：直接將指定供應商的 API Key 安全寫入 `.Friday/auth.json`（權限 `600`）。
- `/mode vertex <PROJECT_ID> [LOCATION]`：直接設定 GCP Vertex AI 的專案代號與區域至 `.Friday/auth.json`。
- `/mode status`：檢視所有角色目前綁定的模型與憑證認證狀態。

---

## 🗺️ Governed Blueprints & Evolution Roadmap (核心藍圖與演進路線圖)

本專案實踐 **「Dogfooding（自己吃自己的狗糧）」**——連專案自身的架構藍圖與開發路線圖，都嚴格遵循 Schema 契約存放在 [`memory/specs/`](memory/specs/) 中，由驗證器確保永不與程式碼脫節：

- 📘 **[`memory/specs/700_HARNESS_BLUEPRINT.md`](memory/specs/700_HARNESS_BLUEPRINT.md)** (`MEM-2026-0005`)：完整收錄八大架構設計契約與零漂移治理機制。
- 🔑 **[`memory/specs/500_MODEL_APIKEY_GUIDE.md`](memory/specs/500_MODEL_APIKEY_GUIDE.md)** (`MEM-2026-0006`)：固定主控大腦與多模型 API Key 注入規範。
- 🚀 **[`memory/specs/200_OPTIMIZATION_ROADMAP.md`](memory/specs/200_OPTIMIZATION_ROADMAP.md)** (`MEM-2026-0007`)：從 **V0 Baseline** 邁向全自動化的 **6 階段工程演進路線圖（Stage 1 ~ Stage 6）**。

---

## 📜 License

MIT License
