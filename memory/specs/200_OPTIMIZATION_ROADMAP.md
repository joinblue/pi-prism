---
node_id: "MEM-2026-0007"
artifact_type: "spec"
access_tier: "standard"
priority: "critical"
status: "verified"
created_at: "2026-10-18"
updated_at: "2026-10-18"
author:
  role: "architect"
  model: "deepseek-ai/deepseek-v4.1-flash"
reviewer:
  role: "challenger"
  model: "z-ai/glm-5.3"
  verdict: "APPROVED"
epistemic_profile:
  fact_count: 6
  inferred_count: 2
  hypothesis_count: 0
  unverified_count: 0
verification_oracle:
  type: "schema_check"
  command: "python3 schemas/schema_validator.py --file memory/specs/200_OPTIMIZATION_ROADMAP.md"
  expected_exit_code: 0
  falsifiable_criterion: "若六大通用優化、三大自動化機制或三大防錯亂保險缺失任一項，則驗證失敗。"
context_index:
  domain_code: "200"
  node_key: "200.OPT-ROADMAP.v1"
  facet_tags:
    - "PotoTypeV0:Evolution:Roadmap:Spec"
    - "Friday:Optimization:SixStages:Spec"
  keywords:
    - "OPTIMIZATION_ROADMAP"
    - "Stage 1"
    - "Stage 6"
    - "SEC-PORTABILITY"
    - "AS-05"
    - "AS-06"
    - "dream"
    - "LEDGER"
  summary_1line: "PotoTypeV0 × Friday 六階段通用優化、固定主腦調度、防錯亂保險 (AS-05/AS-06/Drift Alert) 與 /dream 夢境記憶整理演進路線圖。"
topology:
  depends_on:
    - "000.SOUL.v1"
    - "100.ARCH-RULES.v1"
    - "200.ADR-001.v1"
    - "700.HARNESS-BLUEPRINT.v1"
    - "500.MODEL-APIKEY-SPEC.v1"
  supersedes: []
  conflicts_with: []
  verified_by:
    - "schemas/schema_validator.py"
  affected_paths:
    - ".Friday/models.json"
    - ".Friday/settings.json"
    - ".Friday/AGENTS.md"
    - ".Friday/extensions/model-router.ts"
    - ".Friday/extensions/workspace-guard.ts"
    - ".Friday/extensions/epistemic-gate.ts"
    - "schemas/schema_validator.py"
    - "scripts/auto_update_map.py"
---

# 🗺️ `200.OPT-ROADMAP.v1` (MEM-2026-0007) — 通用優化、防錯亂治理與自動化演進藍圖

1. `[FACT]` **100% 領域無關（Domain-Agnostic）原則**：嚴禁將任何特定專案業務（如量化回測指標、特定 NAS 路徑）寫入通用大腦，所有規則皆為軟體工程通用防禦。
2. `[FACT]` **逐項對齊、獨立驗證、獨立 Commit 原則**：完整涵蓋「**速度與固定主腦調度**」＋「**六大通用優化方向（4 項補強 + 2 項新增）**」＋「**全自動驗證與防錯亂連動 Hook**」＋「**`/dream` 夢境記憶整理機制**」。

---

## 一、 六大通用優化方向 × 防錯亂治理 × 自動化機制 完整對照盤點表

| 編號 | 盤點項目 | 現況狀態 | 具體缺失與待實作細節（100% 完整收錄） | 實際目標檔案 | 對應執行階段 |
| :--- | :--- | :---: | :--- | :--- | :---: |
| **優化 1** | **繁體中文強制規範** | 🟡 不夠完善 | 1. 在主腦與 **5 個子代理**強制規定「使用繁體中文思考 (`thinking`) 與回應」<br>2. 新增剛性條款：「執行任何 `bash` 指令前，必先以繁體中文說明目的與影響範圍」 | `.Friday/AGENTS.md`<br>`.Friday/agents/*.md` | **Stage 2** |
| **優化 2** | **高信噪比三段式通報協議** | 🔴 **完全沒有** | 1. 強制定義**【結論 / 邊界與異常 / 下一步行動】**極簡三段式結構<br>2. 明訂**「客觀數據與對照表格豁免行數限制」**（砍除無意義寒暄，保留硬核資訊） | `.Friday/AGENTS.md` | **Stage 2** |
| **優化 3** | **`workspace-guard.ts` 指令與路徑防禦升級** | 🟡 不夠完善 | 1. **引號感知（Quote-Aware）**：剝離單雙引號字串，避免 `echo "rm -rf /"` 誤判<br>2. **`$(...)` / 反引號 子殼層遞迴拆解**：防止把危險指令藏在子殼層繞過檢查<br>3. **唯讀指令豁免**：允許安全檢索（如 `grep`）讀取非機密設定而不誤殺<br>4. **鎖定 `schemas/` 防改鎖**：禁止 Agent 私自修改驗證規則開後門<br>5. **`SEC-PORTABILITY` 絕對路徑防洩漏攔截**：動態攔截 `write`/`edit` 寫入本機絕對路徑（`os.homedir()`、`/home/<user>`、`file:///`），當場退回要求改用相對路徑重寫<br>6. **自癒處方籤 (`RemediationPointer`)**：攔截時明確給出替代安全做法 | `.Friday/extensions/workspace-guard.ts` | **Stage 3** |
| **優化 4** | **Schema 處方籤、分級散文預算 & 隱私/版本互斥檢查** | 🟡 不夠完善 | 1. **依 `artifact_type` 分級之純散文行數預算（Tiered Prose Budget）**：`constitution`/`rule`/`adr` $\le 50$ 行、`spec`/`audit` $\le 160$ 行（表格、Mermaid 與程式碼區塊豁免）<br>2. **`AS-05` 路徑可攜性與隱私檢查**：掃描記憶節點內文，禁止出現本機絕對路徑（`/home/...` 或 `file:///`）<br>3. **`AS-06` 新舊版本互斥與過時狀態檢查**：被 `supersedes` 取代之舊節點必須降級為 `archived` 或 `deprecated`，防止新舊規範同時 `verified` 導致 Agent 錯亂<br>4. **YAML 處方籤骨架輸出**：當驗證未通過時，自動印出標準 YAML Frontmatter 修復範本 | `schemas/schema_validator.py` | **Stage 4** |
| **優化 5** | **`auto_update_map.py` 拓撲與死鏈自癒** | 🟡 不夠完善 | 1. **Markdown 死鏈自動修復 (`heal_dead_links`)**：檔案搬移後自動修正文內連結<br>2. **Python / TypeScript AST Import 依賴掃描**：自動解析真實程式碼依賴並寫入 `CONTEXT_INDEX.json` 與 `CONTEXT_MAP.md` | `scripts/auto_update_map.py` | **Stage 5** |
| **優化 6** | **唯一活躍台帳 `LEDGER.md` & 通用技能書** | 🔴 **完全沒有** | 1. 建立動態狀態檔 `memory/LEDGER.md`（嚴格限制上限 $\le 80$ 行，只留活躍工單，完工即歸檔）<br>2. 建立 `.Friday/skills/` 通用軟體工程技能書（如根因除錯、架構重構標準流程） | `memory/LEDGER.md`<br>`.Friday/skills/` | **Stage 2**<br>**Stage 6** |
| **自動化 A** | **極速反應修復 + 固定主腦調派專家架構** | 🟡 需重構 | 1. 移除慢速塞車模型，改用實測 `< 1s TTFT` 模型池，並將 `NVCF-POLL-SECONDS` 降至 `"30"`、預設 `thinkingLevel: "low"`<br>2. **固定主腦（Orchestrator）**負責任務解析，搭配確定性專家調派（不靠主腦每回合自我換腦，消除 KV Cache 失效與關鍵字誤判） | `.Friday/models.json`<br>`.Friday/settings.json`<br>`.Friday/extensions/model-router.ts`<br>`.Friday/agents/*.md` | **Stage 1** |
| **自動化 B** | **全自動驗證、過時隔離與源碼連動警報 Hook** | 🟡 半手動 (40%) | 1. **Active-Only 注入過濾**：`epistemic-gate.ts` 自動過濾 `archived`/`deprecated` 舊節點，防止載入過時資訊<br>2. **自動驗證與重編 Hook**：修改 `memory/` 自動執行 `schema_validator.py` 與 `auto_update_map.py`<br>3. **`affected_paths` 源碼變更連動警報（Code-to-Spec Drift Alert）**：修改受保護源碼時，自動提醒同步檢視對應 `spec` 藍圖節點 | `.Friday/extensions/epistemic-gate.ts` | **Stage 5** |
| **自動化 C** | **`/dream` 夢境記憶整理機制** | 🔴 **完全沒有 (0%)** | 1. **手動 `/dream [deep]`**：三階段睡眠記憶鞏固（NREM `scout` 篩選 Session 軌跡 ➔ REM `architect` 更新 `memory/LEDGER.md` 與提純至 `200_DECISIONS.md` ➔ `schema_validator.py` + `auto_update_map.py` 神諭驗收）<br>2. **退出微夢境 (`session_shutdown` Hook)**：離開 `pi` 時毫秒級刷新索引並寫入 3 行摘要至 `memory/episodic/SESSION_DIGEST.md` | `.Friday/extensions/epistemic-gate.ts`<br>`.Friday/prompts/dream.md`<br>`memory/episodic/SESSION_DIGEST.md` | **Stage 6** |

---

## 二、 分階段實作與獨立測試驗收計畫（Step-by-Step Execution Plan）

### Stage 1：速度病根修復 ＋「固定主腦 (Orchestrator) + 專長模型可靠調派」
1. `[FACT]` **修改目標（涵蓋【自動化 A】）**：
   - [`.Friday/models.json`](../../.Friday/models.json)：將 `"NVCF-POLL-SECONDS"` 從 `"3600"` 改為 `"30"`。
   - [`.Friday/settings.json`](../../.Friday/settings.json)：設定預設思考層級 `"defaultThinkingLevel": "low"`。
   - [`.Friday/agents/*.md`](../../.Friday/agents/scout.md)：將 5 個專家子代理全面綁定實測 `< 1s TTFT` 的極速模型池：
     - 主腦（Main Orchestrator）：固定為 `nvidia/nemotron-3-super-120b-a12b`（TTFT `0.28s`，120B 旗艦推理）
     - `scout`（高速探索）：`nvidia/z-ai/glm-5.3-flash`（TTFT `0.60s`，1M Context）
     - `architect`（架構設計）：`nvidia/nvidia/nemotron-3-super-120b-a12b`（TTFT `0.28s`）
     - `challenger`（紅隊找碴）：`nvidia/nvidia/nemotron-3-nano-omni-30b-a3b-reasoning`（TTFT `0.39s`，異體跨模型推理）
     - `worker`（程式實作）：`nvidia/poolside/laguna-xs-2.1`（TTFT `0.28s`，程式碼專精）
     - `auditor`（神諭驗收）：`nvidia/z-ai/glm-5.3-flash`（TTFT `0.60s`）
   - [`.Friday/extensions/model-router.ts`](../../.Friday/extensions/model-router.ts)：廢除脆弱關鍵字換腦，改為 **固定主腦（Orchestrator-First）**，並新增零冷啟動的 **`dispatch_specialist`（專長模型即時派工工具）**；同時同步更新 [`500_MODEL_APIKEY_GUIDE.md`](500_MODEL_APIKEY_GUIDE.md) 與 [`700_HARNESS_BLUEPRINT.md`](700_HARNESS_BLUEPRINT.md) 內之模型表。

---

### Stage 2：繁體中文剛性規範 ＋ 高信噪比三段式通報 ＋ 唯一活躍台帳 `LEDGER.md`
1. `[FACT]` **修改目標（涵蓋【優化 1】＋【優化 2】＋【優化 6】）**：
   - [`.Friday/AGENTS.md`](../../.Friday/AGENTS.md)、[`.Friday/agents/*.md`](../../.Friday/agents/scout.md)：寫入強制繁體中文思考與回應條款、「執行 `bash` 前必先以繁中說明目的」、以及【結論 / 邊界與異常 / 下一步行動】三段式通報協議（客觀數據與表格豁免行數限制）。
   - 新增 `memory/LEDGER.md`（上限 $\le 80$ 行之唯一活躍工單台帳）與 `.Friday/skills/` 通用工程技能書。

---

### Stage 3：`workspace-guard.ts` 引號感知、子殼層拆解、唯讀豁免、Schema 防改鎖、`SEC-PORTABILITY` 絕對路徑攔截與自癒處方籤
1. `[FACT]` **修改目標（涵蓋【優化 3】＋【優化 4 防改鎖】）**：
   - [`.Friday/extensions/workspace-guard.ts`](../../.Friday/extensions/workspace-guard.ts)：實作引號字串剝離（Quote-Aware Stripping）、`$(...)` 與反引號子殼層遞迴拆解、唯讀指令豁免、`schemas/` 防改鎖、**`SEC-PORTABILITY` 本機絕對路徑寫入攔截**，以及結構化 `RemediationPointer`（自癒處方籤）。

---

### Stage 4：`schema_validator.py` 分級散文預算 ＋ `AS-05` 路徑隱私檢查 ＋ `AS-06` 新舊互斥檢查 ＋ 自動 YAML 處方籤骨架
1. `[FACT]` **修改目標（涵蓋【優化 4】）**：
   - [`schemas/schema_validator.py`](../../schemas/schema_validator.py)：
     1. **依 `artifact_type` 分級之純散文行數預算（Tiered Prose Line Budget）**：扣除 YAML 檔頭、Markdown 表格、Mermaid 圖表與程式碼區塊後，`constitution`/`rule`/`adr` 限制 $\le 50$ 行、`spec`/`audit` 限制 $\le 160$ 行。
     2. **`AS-05` 路徑可攜性與隱私檢查**：掃描記憶節點內文，禁止 `/home/<user>/`、`/Users/<user>/` 或 `file:///` 本機絕對路徑。
     3. **`AS-06` 新舊版本互斥與過時狀態檢查**：當節點宣告 `supersedes: [OLD_ID]` 時，檢查 `OLD_ID` 狀態必須為 `archived` 或 `deprecated`；且 `conflicts_with` 節點不得同時為 `verified`。
     4. **自動 YAML 處方籤骨架（Prescription Skeleton）**：退件時直接輸出合法 YAML 檔頭與必備章節修復範本。

---

### Stage 5：`auto_update_map.py` 死鏈/AST 自癒 ＋ `epistemic-gate.ts` 全自動驗證、過時隔離與源碼變更連動警報 Hook
1. `[INFERRED]` **修改目標（涵蓋【優化 5】＋【自動化 B】）**：
   - [`scripts/auto_update_map.py`](../../scripts/auto_update_map.py)：新增 Markdown 死鏈自動修復（`heal_dead_links`）與 Python/TS AST Import 依賴掃描。
   - [`.Friday/extensions/epistemic-gate.ts`](../../.Friday/extensions/epistemic-gate.ts)：
     1. **過時節點自動隔離（Active-Only Injection）**：注入 System Prompt 時自動排除 `archived` 與 `deprecated` 節點。
     2. **全自動驗證與重編 Hook**：監聽 `write`/`edit` 修改 `memory/` 時，自動執行 `schema_validator.py` 與 `auto_update_map.py`，失敗時將處方籤注入 Tool Result 強迫當回合自癒。
     3. **`affected_paths` 源碼變更連動警報（Code-to-Spec Drift Alert）**：修改受保護源碼時，自動比對 `CONTEXT_INDEX.json` 提醒同步更新對應 `spec` 藍圖節點。

---

### Stage 6：`/dream` 夢境記憶整理機制（三階段睡眠記憶鞏固 ＋ 退出微夢境）
1. `[INFERRED]` **修改目標（涵蓋【自動化 C】）**：
   - [`.Friday/extensions/epistemic-gate.ts`](../../.Friday/extensions/epistemic-gate.ts) & `.Friday/prompts/dream.md`：實作 `/dream` 三階段睡眠記憶鞏固（NREM `scout` 篩選 ➔ REM `architect` 更新 `LEDGER.md` 與 `200_DECISIONS.md` ➔ Python 神諭驗收），以及 `session_shutdown` 退出微夢境自動寫入 `memory/episodic/SESSION_DIGEST.md`。
