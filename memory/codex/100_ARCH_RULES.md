---
node_id: "MEM-2026-0002"
artifact_type: "rule"
access_tier: "restricted"
priority: "critical"
status: "verified"
created_at: "2026-10-16"
updated_at: "2026-10-16"
author:
  role: "architect"
  model: "deepseek-ai/deepseek-v4.1-flash"
reviewer:
  role: "challenger"
  model: "z-ai/glm-5.3"
  verdict: "APPROVED"
epistemic_profile:
  fact_count: 3
  inferred_count: 1
  hypothesis_count: 0
  unverified_count: 0
verification_oracle:
  type: "schema_check"
  command: "python3 schemas/schema_validator.py --file memory/codex/100_ARCH_RULES.md"
  expected_exit_code: 0
  falsifiable_criterion: "若 Agent 在未獲使用者互動授權下可透過 read/write/edit/bash 讀寫 ctx.cwd 以外之路徑，或可讀取 auth.json，則判定本防線失效。"
context_index:
  domain_code: "100"
  node_key: "100.ARCH-RULES.v1"
  facet_tags:
    - "Friday:Security:Hook:BoundaryGuard"
    - "PotoTypeV0:Architecture:Rules:Sandbox"
  keywords:
    - "Workspace Boundary Guard"
    - "SEC-BRAIN"
    - "SEC-CRED"
  summary_1line: "定義 Friday Harness 之工作區邊界護欄：鎖定 ctx.cwd、保護 .Friday 大腦核心 (SEC-BRAIN)、隔離金鑰 (SEC-CRED) 與攔截危險指令。"
topology:
  depends_on:
    - "MEM-2026-0001"
  supersedes: []
  conflicts_with: []
  verified_by:
    - "schemas/schema_validator.py"
  affected_paths:
    - "schemas/schema_validator.py"
    - "scripts/auto_update_map.py"
---

# 🛡️ `100.ARCH-RULES.v1` (MEM-2026-0002) — 系統架構與工作區邊界護欄規範

## 一、 工作區邊界鎖定鐵律 (Workspace Jail & Interactive Gate)

1. `[FACT]` Friday Agentic Harness 透過內嵌大腦 Extension (`.Friday/extensions/workspace-guard.ts`) 掛載 `pi.on("tool_call")` 與 `pi.on("user_bash")` 攔截器，預設將讀寫權限嚴格鎖定於開啟專案之工作目錄 (`ctx.cwd`，即專案根目錄 `<PROJECT_ROOT>`)，同時以 `SEC-BRAIN` 保護 `.Friday/` 核心不被自動竄改。
2. `[FACT]` 當任何工具 (`read`, `write`, `edit`, `grep`, `find`, `ls`, `bash`) 嘗試存取 `ctx.cwd` 以外之路徑時：
   - 若處於互動式 TUI 模式 (`ctx.hasUI === true`)，系統強制呼叫 `await ctx.ui.select()` 彈出視窗詢問使用者（允許單次 / 本次 Session 信任該目錄 / 拒絕攔截）。
   - 若處於非互動模式或子代理模式 (`ctx.hasUI === false`)，系統無條件回傳 `{ block: true, reason: ... }` 直接拒絕，確保背景子代理絕不越界。

## 二、 機密金鑰與毀滅性指令防護 (`SEC-CRED` & `SEC-CMD-V1`)

1. `[FACT]` 任何針對 `auth.json`、`.env` 或私密憑證檔之讀取與修改請求，無論位於工作區內外，一律由 `workspace-guard.ts` 強制阻斷 (`SEC-CRED`)。
2. `[INFERRED]` 透過在 `PI_CODING_AGENT_DIR` (`$(pwd)/.Friday`) 層級部署上述 Hook，可確保即使專案尚未執行 `/trust`，安全護欄依然隨大腦啟動 100% 強制生效。
