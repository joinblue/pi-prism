---
node_id: "MEM-2026-0015"
artifact_type: "spec"
access_tier: "standard"
priority: "critical"
status: "verified"
created_at: "2026-10-30"
updated_at: "2026-10-30"
author:
  role: "architect"
  model: "google-vertex/gemini-4-argon"
reviewer:
  role: "challenger"
  model: "nvidia/nemotron-3-ultra-550b-a55b"
  verdict: "APPROVED"
epistemic_profile:
  fact_count: 5
  inferred_count: 4
  hypothesis_count: 0
  unverified_count: 0
verification_oracle:
  type: "schema_check"
  command: "python3 schemas/schema_validator.py --file memory/specs/640_MODULAR_PLUGIN_AND_HOOK_BLUEPRINT.md"
  expected_exit_code: 0
  falsifiable_criterion: "若本藍圖違反 Schema 散文預算，或未明確定義圖書館/公文雙層 Schema 擴充、雙腦絲滑代讀與 Teamwork 分工矩陣，則本節點判定無效。"
context_index:
  domain_code: "300"
  node_key: "300.LIBRARY-WIKI-AND-SEAMLESS-ROUTER.v1"
  facet_tags:
    - "Friday:Memory:LibraryWiki:Blueprint"
    - "Friday:Routing:SeamlessOffload:Spec"
    - "PiPrism:Teamwork:MultiTierExecution:Plan"
  keywords:
    - "Library Schema Extensibility"
    - "Official Document vs Wiki"
    - "Taxonomy Registry"
    - "Seamless Read Offload"
    - "Dream Consolidation"
    - "AGY Teamwork Matrix"
  summary_1line: "圖書館/公文 Schema 擴充與雙腦絲滑分派總藍圖：確立記憶圖書館與 Wiki 為核心主題、改造無感透明代讀 Router 並定義 AGY Teamwork 分層派工矩陣。"
topology:
  depends_on:
    - "000.SOUL.v1"
    - "100.ARCH-RULES.v1"
    - "200.OPT-ROADMAP.v1"
    - "500.HARNESS-DETAX.v1"
    - "700.HARNESS-BLUEPRINT.v1"
  supersedes: []
  conflicts_with: []
  verified_by:
    - "schemas/schema_validator.py"
    - "scripts/test_friday_architecture.py"
  affected_paths:
    - ".Friday/extensions/epistemic-gate.ts"
    - ".Friday/extensions/model-router.ts"
    - ".Friday/extensions/workspace-guard.ts"
    - ".Friday/extensions/subagent/index.ts"
    - "schemas/artifact_header.schema.json"
    - "schemas/context_node.schema.json"
    - "schemas/schema_validator.py"
    - "scripts/auto_update_map.py"
    - "scripts/sync_doc_metadata.py"
---

# 🏛️ `300.LIBRARY-WIKI-AND-SEAMLESS-ROUTER.v1` (MEM-2026-0015) — 圖書館/公文 Schema 擴充、Wiki 圖譜演進與雙腦絲滑分派總藍圖

## 一、 核心定位重校準與現況誠實盤點 (Anti-Sycophancy Reality Check)

1. `[FACT]` **專案主從關係確立（Memory 為核、Guard 為盾、Router 為幕僚）**：本專案之真正核心價值為**「可擴充之圖書館/公文條目 Schema 分類系統 + 自動化雙向連結 Wiki 知識庫 (`Memory`)」**；`workspace-guard.ts` (`Guard`) 係為維護館藏秩序與邊界安全而存在，而 `model-router.ts` (`Router`) 則是為了保護主腦小容量 Context 並執行跨模型審稿而服務，單拆 Router 並無獨立開源優勢。
2. `[FACT]` **現行 `Memory` 僅完成約 35%（有安檢門而無圖書館擴充與 Wiki 生態）**：
   - `schemas/artifact_header.schema.json` 將所有文件死鎖為 5 種工程類型（`constitution`, `rule`, `adr`, `spec`, `audit`），且強制每篇文件皆須具備跨模型 `reviewer`、`verification_oracle` 與精確 `[FACT]` 計數，缺乏輕量「Wiki 知識條目 / 研究筆記」分級。
   - `schemas/context_node.schema.json` 之 `domain_code` (`000`–`900`) 硬編碼為框架自身模組，缺乏可外掛之領域分類表 (`TAXONOMY.json`)。
   - `.Friday/extensions/epistemic-gate.ts` 於啟動時將 `CONTEXT_INDEX.json` 全量單行摘要塞入 `systemPrompt`，缺乏分層目錄檢索與 `[[WikiLink]]` 雙向圖譜導覽；且 `200.OPT-ROADMAP.v1` 規劃之 `/dream` 記憶沉澱與自動編目完成度為 `0%`。
3. `[FACT]` **現行 `Router` 體積過胖（`3,010` 行）且讀取攔截造成「二次回合懲罰」**：
   - `.Friday/extensions/model-router.ts` 第 1168 行之 `Token Offload Gate` 在雙腦模式 (`hybrid-synergy`) 或省流模式攔截大檔/多檔 `read` 時，直接回傳 `{ block: true, reason: "禁止直接讀取..." }` 報錯。
   - 此設計迫使上下文容量較小之雙腦主腦先吞下一段報錯文字、浪費一整輪思考，下一輪才重新發起 `dispatch_specialist(scout)`，造成嚴重卡頓與框架稅。
4. `[FACT]` **Pi Extension 內嵌式 Hook 與外部 Python 腳本之實體分工**：
   - **Pre-Tool 攔截層**：`.Friday/extensions/workspace-guard.ts`（純 TS 內嵌，負責 `BOUNDARY`、`SEC-CMD`、`SEC-CRED`、`SEC-BRAIN`、`SEC-DOC-GOVERNANCE`）與 `model-router.ts`（負責讀取配額分流）。
   - **Post-Tool 圖書館編目層**：`.Friday/extensions/epistemic-gate.ts` 監聽 `tool_result`，寫入 `memory/**/*.md` 後自動調用外部 `scripts/sync_doc_metadata.py`、`schemas/schema_validator.py` 與 `scripts/auto_update_map.py`。
5. `[FACT]` **跨模組硬耦合點 (`C1`–`C3`)**：`model-router.ts` 第 32 行寫死 `import { ... } from "./epistemic-gate.js"`，且在 `dispatch_specialist` 中無條件輸出 `CONTEXT_INDEX.json=missing` 快照，需改為執行期軟橋接以確保模組邊界乾淨。
6. `[INFERRED]` **核心重構戰略**：停止盲目擴充 Router 外圍噱頭，將工程火力集中於 **(1) 補齊 `Memory` 圖書館分類擴充、公文/Wiki 雙軌 Schema、分層檢索與 `/dream` 自動編目（70% 核心價值）**，以及 **(2) 將 `Router` 讀取攔截升級為「無感透明代讀 (`Seamless Read Offload`)」並消腫解耦（30% 體驗優化）**。

---

## 二、 主角升級藍圖：`Memory` 圖書館/公文雙軌 Schema × 可擴充分類學 × Wiki 自動編目

| 核心支柱 | 現況痛點與行號座標 | 目標架構設計 (`Library & Wiki Architecture v2`) | 目標修改檔案 |
| :--- | :--- | :--- | :--- |
| **M1. 公文 vs. Wiki 雙軌分級 Schema**<br>*(Tiered Document & Wiki Schemas)* | `schemas/artifact_header.schema.json` (`L7–L36`) 與 `schemas/schema_validator.py` (`L47–L53`, `L353–L408`) 將所有 `.md` 死鎖為 5 種重型公文，強制雙模型 `author != reviewer` 簽核與 `>=2` 個 `[FACT]`，日常 Wiki/SOP 建檔摩擦極高。 | 將館藏分為兩大軌：<br>1. **正式公文軌 (`OFFICIAL_TYPES`: `constitution`, `rule`, `adr`, `spec`, `audit`)**：維持嚴格跨模型 `reviewer` (`AS-01`)、`verification_oracle`、必填 `[FACT]` 門檻 (`AS-02`) 與緊湊散文預算。<br>2. **圖書館 Wiki 軌 (`WIKI_TYPES`: `wiki`, `note`, `sop`, `glossary`, `digest`)**：免除跨模型雙審鎖與必填 `[FACT]` 下限（允許 `0` 個標籤；若有標註仍驗算計數誠實度），散文預算放寬為 `200–250` 行，支援單人即時入庫。<br>3. **`Guard` 館藏秩序守門 (`workspace-guard.ts` `L600–L625`)**：保護公文館（`memory/codex`, `memory/adr`, `memory/specs`, `memory/audits`）與安全邊界，對開架閱覽區 `memory/wiki/**` 放行單一 Agent 即時讀寫。 | `schemas/artifact_header.schema.json`<br>`schemas/schema_validator.py`<br>`scripts/sync_doc_metadata.py`<br>`.Friday/extensions/workspace-guard.ts` |
| **M2. 可配置圖書館分類表**<br>*(Extensible Taxonomy Registry)* | `schemas/context_node.schema.json` (`L22–L31`) 與 `scripts/auto_update_map.py` (`L27–L38`) 將 `domain_code` 寫死為 `000\|100\|200\|300\|900`，無法插拔擴充子領域或跨專案移植。 | 建立 `memory/index/TAXONOMY.json`（杜威十進位可插拔分類表）：<br>• 解除 `000\|100\|200\|300\|900` 硬編碼，支援任意 `[0-9]{3}` 主分類（`000`–`900`）與子分類（如 `310` 圖譜筆記、`510` 模型路由），定義 `title`、`track_default` (`official\|wiki\|both`) 與 `always_pin`。<br>• 若專案未提供 `TAXONOMY.json`，自動退回內建預設分類表，確保向下相容。 | `memory/index/TAXONOMY.json`<br>`schemas/context_node.schema.json`<br>`schemas/schema_validator.py`<br>`scripts/auto_update_map.py` |
| **M3. Wiki 雙向連結與兩階段目錄檢索**<br>*(Wiki Graph & Two-Stage Catalog)* | `.Friday/extensions/epistemic-gate.ts` (`L19–L83`) 開局將全量節點塞入 `systemPrompt`，館藏增長時易塞爆 Context；且缺乏 `[[WikiLink]]` 正反向連結圖譜。 | 1. **雙向連結 (`outbound_links` & `backlinks`)**：`auto_update_map.py` (`L195–L311`) 解析內文 `[[node_key]]` 與 `[[MEM-YYYY-XXXX]]`，自動於 `CONTEXT_INDEX.json` 建立正向 `outbound_links`、反向 `backlinks` 與各領域 `domain_stats`。<br>2. **兩階段館藏檢索 (`Two-Stage Catalog` + `query_library`)**：當有效節點 `<= 25` (`CATALOG_STAGE2_THRESHOLD = 25`) 時注入單行摘要；當 `> 25` 時僅注入 `always_pin: true` 核心憲法（`000`/`100`）與各領域統計摘要（固定 `<= 20` 行），並由 `epistemic-gate.ts` 註冊 `query_library` 工具供按需精準翻書。 | `schemas/context_node.schema.json`<br>`scripts/auto_update_map.py`<br>`.Friday/extensions/epistemic-gate.ts` |
| **M4. 自動取號編目與 `/dream` 記憶沉澱**<br>*(Auto-Cataloging & Dream Consolidation)* | 手寫 YAML 標頭與算流水號容易出錯；`200.OPT-ROADMAP.v1` 規劃之 `/dream` 自動編目完成度為 `0%`。 | 1. **自動取號編目 (`scripts/sync_doc_metadata.py --init`)**：掃描 `memory/**/*.md` 現有流水號（排除 `0099`/`0100` 測試哨兵），自動核發下一個 `MEM-YYYY-XXXX`，生成合規 YAML 標頭並將草稿歸檔至 `memory/wiki/`。<br>2. **`/dream` 記憶沉澱指令**：於 `epistemic-gate.ts` 與 `.Friday/prompts/dream.md` 實作 `/dream`，自動掃描 `scratch/` 草稿與未索引筆記，呼叫 `sync_doc_metadata.py --init` 與 `auto_update_map.py` 完成入庫、圖譜重算與 `LEDGER.md` 更新。 | `scripts/sync_doc_metadata.py`<br>`.Friday/extensions/epistemic-gate.ts`<br>`.Friday/prompts/dream.md` |

---

## 三、 配角絲滑化藍圖：`Router` 雙腦透明代讀與模組邊界解耦

| 優化項目 | 舊版卡頓做法（高框架稅與行號座標） | 絲滑化目標設計 (`Zero-Friction Offload & Loose Coupling`) | 目標修改檔案 |
| :--- | :--- | :--- | :--- |
| **R1. 雙腦模式「攔截即透明代讀」**<br>*(Seamless Read Auto-Offload)* | `.Friday/extensions/model-router.ts` (`L1115–L1184`) 之 `Token Offload Gate` 在主腦 `read` 超標時直接 `return { block: true, reason: ... }`，連帶明確指定 `offset` + `limit <= 350` 的分段讀取也遭誤殺，逼主腦多花一輪 Turn 重試。 | **雙分支絲滑分流（0 死胡同報錯、單一 Turn 內完成）**：<br>1. **Case A（帶明確 `offset` / `limit <= 350` 分段讀取直接放行）**：當 `read` 帶有明確 `limit <= 350`（含 `offset` + `limit <= 350`）時，直接 `return undefined` 放行且不計入未分段違規懲罰。<br>2. **Case B（無 `limit` 且檔案 `> 350` 行或超配額之同 Turn 透明代讀）**：攔截當下於同一個 Turn 內透過 in-process AST/Regex 結構提取與 `scout` 摘要，回傳**「檔案結構大綱 + 前 60 行關鍵預覽 + 建議分段讀取座標 (`offset`/`limit`)」**。 | `.Friday/extensions/model-router.ts` |
| **R2. `/prism` 定位收斂與跨模組鬆耦合**<br>*(Internal Console & Epistemic Bridge)* | `model-router.ts` (`L32`) 頂部寫死 `import { ... } from "./epistemic-gate.js"`，且無條件輸出 `CONTEXT_INDEX.json=missing`；`/prism` 存在過度產品化風險。 | 1. **`/prism` 定位決策**：明確維持為框架內部輕量自用調音台（管理雙腦角色、模型池與代讀閾值），不開發肥大獨立 UI 或外部產品。<br>2. **`globalThis.__fridayEpistemicBridge` 鬆耦合通訊**：拔除 `model-router.ts` 第 32 行靜態 `import`，改由 `epistemic-gate.ts` 註冊全域橋接物件；各插件透過 Optional Chaining 呼叫，若無 `memory/codex` 或 `epistemic-gate.ts` 則靜默退化。 | `.Friday/extensions/model-router.ts`<br>`.Friday/extensions/epistemic-gate.ts`<br>`.Friday/extensions/workspace-guard.ts` |

---

## 四、 四大工作包可執行實作規格與設計決策 (WP-1 ~ WP-4 Executable Specifications)

### 4.1 `WP-1` 圖書館/公文雙軌 Schema 與自動取號編目（主角 `Memory` × 守門員 `Guard`）

| 規格維度 | 目標檔案與座標 | 可執行設計決策與驗收邏輯 |
| :--- | :--- | :--- |
| **WP1-S1. 雙軌型別與條件必填 Schema** | `schemas/artifact_header.schema.json` (`L7–L36`) | 擴充 `artifact_type.enum` 為 10 類：公文軌 `OFFICIAL_TYPES = ["constitution", "rule", "adr", "spec", "audit"]` 與圖書館軌 `WIKI_TYPES = ["wiki", "note", "sop", "glossary", "digest"]`。頂層 `required` 僅保留共通核心欄位，透過 `allOf` + `if/then` 僅對 `OFFICIAL_TYPES` 強制要求 `access_tier`, `priority`, `reviewer`, `epistemic_profile`, `verification_oracle`。 |
| **WP1-S2. 雙軌審查、標籤與散文預算分流** | `schemas/schema_validator.py` (`L47–L53`, `L353–L420`) | 1. **`AS-01`（雙模型異構審查）**：`OFFICIAL_TYPES` 強制 `author.model != reviewer.model` 且 `status == "verified"` 時 `verdict == "APPROVED"`；`WIKI_TYPES` 豁免 `reviewer` 必填與異構模型限制，允許單一 Agent 自審或省略 `reviewer`。<br>2. **`AS-02`（認識論標籤誠實度）**：`OFFICIAL_TYPES` 維持既有 `[FACT]` 最低數量門檻；`WIKI_TYPES` 允許 `0` 個 `[FACT]`/`[INFERRED]` 標籤（免除日常筆記算標籤摩擦），惟若內文含標籤或標頭宣告 `epistemic_profile` 時仍須通過數量一致性驗算。<br>3. **`PROSE_LINE_BUDGETS`**：公文軌維持 `constitution: 50`, `rule: 50`, `adr: 50`, `spec: 160`, `audit: 160`；圖書館軌放寬為 `wiki: 200`, `note: 200`, `sop: 200`, `glossary: 250`, `digest: 200`。 |
| **WP1-S3. 自動取號與草稿立案編目器** | `scripts/sync_doc_metadata.py` (`L217–L390`) | 新增 `--init` 模式（支援 `--file <path> --init [--type wiki\|note\|sop\| glossary\|digest\|spec\|adr] [--domain 310] [--node-key ...] [--title "..."]`）：<br>1. 掃描 `memory/**/*.md` 之 `node_id`，解析當年度流水號並排除測試哨兵號段（`>= 0099` 如 `0099`, `0100`），自動核發 `max_active_seq + 1`。<br>2. 若輸入檔位於 `scratch/` 且屬 `WIKI_TYPES`，自動搬移或輸出至 `memory/wiki/<slug>.md`，注入合規雙軌 YAML Frontmatter，並串接 Phase 1A（標籤與日期同步）與 Phase 1B（`schema_validator.py` 驗證）。 |
| **WP1-S4. `Guard` 退居館藏秩序守門員** | `.Friday/extensions/workspace-guard.ts` (`L600–L625`) | 重構 `SEC-DOC-GOVERNANCE`：<br>1. **公文館嚴格保護**：對 `memory/codex/`, `memory/adr/`, `memory/specs/`, `memory/audits/`（先檢查 `fs.existsSync(path.join(cwd, "memory/codex"))`）維持公文級變更保護與跨模型審核要求。<br>2. **開架圖書館放行**：對 `memory/wiki/**` 放行單一 Agent 即時建立與更新（僅驗證基本 YAML 標頭存在性與 `SEC-PORTABILITY` 路徑可攜性，不阻斷單人寫入）。 |

```json
// [WP-1] schemas/artifact_header.schema.json — 雙軌條件必填 Schema 核心結構
{
  "properties": {
    "artifact_type": {
      "type": "string",
      "enum": [
        "constitution", "rule", "adr", "spec", "audit",
        "wiki", "note", "sop", "glossary", "digest"
      ]
    }
  },
  "required": [
    "node_id", "artifact_type", "status",
    "created_at", "updated_at", "author",
    "context_index", "topology"
  ],
  "allOf": [
    {
      "if": {
        "properties": {
          "artifact_type": { "enum": ["constitution", "rule", "adr", "spec", "audit"] }
        }
      },
      "then": {
        "required": [
          "access_tier", "priority", "reviewer",
          "epistemic_profile", "verification_oracle"
        ]
      }
    }
  ]
}
```

```python
# [WP-1] schemas/schema_validator.py & scripts/sync_doc_metadata.py — 雙軌常數與自動取號契約
OFFICIAL_TYPES = {"constitution", "rule", "adr", "spec", "audit"}
WIKI_TYPES = {"wiki", "note", "sop", "glossary", "digest"}

PROSE_LINE_BUDGETS = {
    "constitution": 50, "rule": 50, "adr": 50, "spec": 160, "audit": 160,
    "wiki": 200, "note": 200, "sop": 200, "glossary": 250, "digest": 200,
}

def allocate_next_node_id(memory_root: Path, year: int = 2026) -> str:
    """掃描 memory/**/*.md 現有 node_id，忽略 >= 99 之測試哨兵節點，核發下一個連續流水號。"""
    active_seqs = [
        int(m.group(2)) for md in memory_root.rglob("*.md")
        if (m := re.search(r'^node_id:\s*["\']?MEM-(\d{4})-(\d{4})["\']?', md.read_text(encoding="utf-8"), re.M))
        and int(m.group(1)) == year and int(m.group(2)) < 99
    ]
    next_seq = (max(active_seqs) + 1) if active_seqs else 1
    return f"MEM-{year}-{next_seq:04d}"
```

---

### 4.2 `WP-2` Wiki 雙向圖譜、可插拔分類法與兩階段館藏檢索（主角 `Memory`）

| 規格維度 | 目標檔案與座標 | 可執行設計決策與驗收邏輯 |
| :--- | :--- | :--- |
| **WP2-S1. 可插拔十進位分類表 (`TAXONOMY.json`)** | `memory/index/TAXONOMY.json`<br>`schemas/context_node.schema.json` (`L22–L31`)<br>`scripts/auto_update_map.py` (`L27–L38`) | 1. 將 `context_node.schema.json` 之 `domain_code` 由固定 `enum` 改為正則 `"pattern": "^[0-9]{3}$"`，並在 `topology.properties` 新增選填陣列 `outbound_links` 與 `backlinks`。<br>2. 建立 `memory/index/TAXONOMY.json` 定義主分類（`000`–`900`）與子分類（如 `310`, `510`）；`schema_validator.py` 與 `auto_update_map.py` 動態讀取 `TAXONOMY.json` 驗證 `domain_code`（若檔案不存在則 fallback 至內建預設表）。 |
| **WP2-S2. 雙向 Wiki 圖譜 (`outbound_links` / `backlinks`)** | `scripts/auto_update_map.py` (`L195–L311`) | 於 `_compile_index_subset` 掃描各節點 Markdown 內文（排除 fenced code blocks），以 `WIKILINK_RE = re.compile(r"\[\[([A-Za-z0-9_.-]+)(?:\|[^\]]+)?\]\]")` 擷取 `[[node_key]]` 或 `[[MEM-YYYY-XXXX]]`，正規化為目標 `node_key`，合併 `topology.depends_on` 後寫入各節點之 `outbound_links`，並反向聚合生成 `backlinks` 與各分類統計 `domain_stats`。 |
| **WP2-S3. `/dream` 自動編目與記憶沉澱** | `.Friday/extensions/epistemic-gate.ts`<br>`.Friday/prompts/dream.md` | 於 `epistemic-gate.ts` 註冊 `/dream` 指令（讀取 `.Friday/prompts/dream.md` 作為執行契約）：<br>1. 自動盤點 `scratch/*.md` 與 `memory/wiki/*.md` 中尚未編目之草稿，呼叫 `python3 scripts/sync_doc_metadata.py --file <draft> --init --type wiki` 完成取號與標頭注入。<br>2. 補齊內文 `[[node_key]]` 雙向連結與分類標籤，並執行 `python3 scripts/auto_update_map.py` 刷新 `CONTEXT_INDEX.json` 與 `memory/LEDGER.md`。 |
| **WP2-S4. 兩階段目錄檢索與 `query_library` 工具** | `.Friday/extensions/epistemic-gate.ts` (`L19–L112`) | 1. **Stage 1 (`buildProgressiveContextSummary`)**：設定閾值 `CATALOG_STAGE2_THRESHOLD = 25`。當有效節點數 `<= 25` 時維持輸出全量單行摘要；當 `> 25` 時僅固定輸出 `always_pin: true`（`000`/`100` 核心憲法與護欄）之單行摘要 + `TAXONOMY.json` 各領域節點計數表（控制在 `<= 20` 行），提示主腦使用 `query_library`。<br>2. **Stage 2 (`query_library` Tool)**：支援依 `query`（關鍵字）、`domain`（領域碼）、`artifact_type`、`node_key`、`tag`、`include_backlinks` 與 `limit` 檢索 `CONTEXT_INDEX.json`，秒級回傳匹配節點之完整元資料、`summary_1line`、`outbound_links`、`backlinks` 與檔案路徑。 |

```json
// [WP-2] memory/index/TAXONOMY.json — 可插拔圖書館十進位分類表標準結構
{
  "schema_version": "1.0.0",
  "description": "Pluggable Dewey-style Epistemic Library Taxonomy for PotoTypeV0",
  "domains": {
    "000": { "title": "Core Constitution & Soul (核心憲法與靈魂)", "track_default": "official", "always_pin": true },
    "100": { "title": "System Architecture & Security Guardrails (系統架構與安全護欄)", "track_default": "official", "always_pin": true },
    "200": { "title": "Optimization Roadmap & Epistemic Governance (優化藍圖與認識論治理)", "track_default": "official", "always_pin": false },
    "300": { "title": "Core Domain Logic & Modules (核心領域邏輯與模組)", "track_default": "both", "always_pin": false },
    "310": { "title": "Library Wiki & Knowledge Graph Notes (知識庫 Wiki 與圖譜筆記)", "track_default": "wiki", "always_pin": false },
    "400": { "title": "Data Schemas & Storage Protocols (資料綱要與儲存協定)", "track_default": "both", "always_pin": false },
    "500": { "title": "Agentic Harness & Prompt Contracts (代理控制軛與提示詞契約)", "track_default": "official", "always_pin": false },
    "510": { "title": "Model Pool & Routing Strategy (模型池與路由策略)", "track_default": "both", "always_pin": false },
    "600": { "title": "Verification Oracles & Testing (驗證神諭與測試基準)", "track_default": "both", "always_pin": false },
    "700": { "title": "Operations, Telemetry & Runtime (維運、遙測與執行期治理)", "track_default": "both", "always_pin": false },
    "800": { "title": "External Integrations & Tooling (外部整合與工具鏈)", "track_default": "wiki", "always_pin": false },
    "900": { "title": "Audits, Postmortems & Historical Ledgers (審計、事後檢討與歷史帳本)", "track_default": "both", "always_pin": false }
  }
}
```

```typescript
// [WP-2] .Friday/extensions/epistemic-gate.ts — 兩階段目錄與 query_library 工具介面規格
export const CATALOG_STAGE2_THRESHOLD = 25;

export interface QueryLibraryParams {
  query?: string;          // 模糊匹配 node_key, summary_1line, keywords
  domain?: string;         // 過濾 3 碼分類 (如 "300", "310")
  artifact_type?: string;  // 過濾公文或 Wiki 類型 (如 "wiki", "spec")
  node_key?: string;       // 精確或前綴匹配節點 Key (如 "000.SOUL.v1")
  tag?: string;            // 過濾 facet_tags
  include_backlinks?: boolean; // 是否附帶 outbound_links 與 backlinks 圖譜邊 (預設 true)
  limit?: number;          // 回傳筆數上限 (預設 10, 最大 50)
}
```

---

### 4.3 `WP-3` 雙腦絲滑攔截分流與跨模組鬆耦合（助手 `Router`）

| 規格維度 | 目標檔案與座標 | 可執行設計決策與驗收邏輯 |
| :--- | :--- | :--- |
| **WP3-S1. 分段讀取直接放行 (`Case A: Bounded Slice Pass-Through`)** | `.Friday/extensions/model-router.ts` (`L1115–L1145`) | 當 `event.toolName === "read"` 且呼叫端明確傳入 `limit` 參數（且 `Number(limit) > 0 && Number(limit) <= 350`，無論是否搭配 `offset`）時，判定為主腦已按座標精準分段調閱，**直接 `return undefined` 無條件放行**，不計入未分段大檔違規次數，亦不觸發 `block: true`。 |
| **WP3-S2. 未分段大檔同 Turn 透明代讀 (`Case B: In-Flight Auto-Offload`)** | `.Friday/extensions/model-router.ts` (`L1146–L1184`) | 當 `read` 未帶 `limit`（或 `limit > 350`）且目標檔案總行數 `> 350` 行（或單輪未分段讀取超過 `maxReadsPerTurn`）時，**禁止回傳純報錯文字**；於攔截當下在同一個 Turn 內同步執行 `buildSeamlessReadOffloadPayload(absPath, totalLines)`：<br>1. **In-Process 結構大綱提取**：以高速 Regex/AST 掃描檔案中所有類別、函式、介面、`export` 與 Markdown 標題之精確行號座標 (`L<start>-L<end>`)。<br>2. **前段關鍵預覽與 `scout` 摘要**：附帶檔案前 `60` 行預覽（及雙腦模式下可選之高速 `scout` 重點摘要）。<br>3. **精確分段座標導引**：產生可直接複製呼叫之 `read(path, offset=1, limit=300)` 分段座標建議，讓主腦於同一輪即掌握全貌，下一動直接按座標精準切片。 |
| **WP3-S3. `/prism` 定位收斂與 `FridayEpistemicBridge` 鬆耦合** | `.Friday/extensions/model-router.ts` (`L32`)<br>`.Friday/extensions/epistemic-gate.ts` (`L93–L112`) | 1. **`/prism` 定位**：維持為 PotoTypeV0 框架內部輕量調音台，不擴張為肥大獨立產品。<br>2. **拔除跨檔靜態 `import`**：刪除 `model-router.ts` 第 32 行 `import { clearSessionPinnedContextSummaries, getSessionPinnedContextSummary } from "./epistemic-gate.js"`。<br>3. **執行期軟橋接**：由 `epistemic-gate.ts` 於載入時掛載 `globalThis.__fridayEpistemicBridge`；`model-router.ts` 透過 `globalThis.__fridayEpistemicBridge?.getSessionPinnedContextSummary(...)` 取用記憶摘要，若專案無 `memory/codex` 或未載入 `epistemic-gate` 則靜默回傳 `null`（不再輸出 `CONTEXT_INDEX.json=missing` 噪音）。 |

```typescript
// [WP-3] .Friday/extensions/epistemic-gate.ts & model-router.ts — 全域鬆耦合橋接與絲滑代讀規格
export interface FridayEpistemicBridge {
  getSessionPinnedContextSummary: (sessionKey: string, cwd: string, forceRefresh?: boolean) => string | null;
  clearSessionPinnedContextSummaries: () => void;
  queryLibrary?: (params: Record<string, unknown>, cwd: string) => string;
}

declare global {
  // eslint-disable-next-line no-var
  var __fridayEpistemicBridge: FridayEpistemicBridge | undefined;
}

// .Friday/extensions/model-router.ts (Token Offload Gate L1115-L1184 核心分流邏輯)
const MAX_DIRECT_READ_LINES = 350;
const reqOffset = typeof event.input?.offset === "number" ? event.input.offset : undefined;
const reqLimit = typeof event.input?.limit === "number" ? event.input.limit : undefined;

// Case A: 帶明確 limit <= 350 (含 offset + limit) 之分段讀取 -> 直接放行，0 懲罰
if (reqLimit !== undefined && reqLimit > 0 && reqLimit <= MAX_DIRECT_READ_LINES) {
  return undefined;
}

// Case B: 未帶 limit 且檔案 > 350 行 (或超過單輪配額) -> 同 Turn 內回傳結構大綱 + 前 60 行預覽 + 分段座標
if (fileLineCount > MAX_DIRECT_READ_LINES || turnReadCount > maxReadsPerTurn) {
  const offloadDigest = buildSeamlessReadOffloadDigest(resolvedPath, fileContent, fileLineCount);
  return {
    block: true,
    reason: offloadDigest, // 內含 [Seamless Read Auto-Offload] 結構索引(行號座標) + Head Preview(L1-L60) + 建議 offset/limit 切片指令
  };
}
```

---

### 4.4 `WP-4` AGY Teamwork 分層派工矩陣與 E2E 驗收標準 (Verification & Test Plan)

| 工作包代號 | 負責角色與建議模型層級 (`Model Tier`) | 獨佔修改檔案清單 (Disjoint File Ownership) | 核心任務與驗收指令 |
| :--- | :--- | :--- | :--- |
| **WP-1**<br>*(圖書館雙軌 Schema 與自動取號)* | **Library Schema & Guard Engineer**<br>模型：`flash` / `pro` | • `schemas/artifact_header.schema.json`<br>• `schemas/schema_validator.py`<br>• `scripts/sync_doc_metadata.py`<br>• `.Friday/extensions/workspace-guard.ts` | 1. 實作 `OFFICIAL_TYPES` vs `WIKI_TYPES` 雙軌 Schema、放寬 Wiki 雙審/標籤/行數限制。<br>2. 實作 `sync_doc_metadata.py --init` 自動取號編目與 `workspace-guard.ts` 開架區 `memory/wiki/` 放行。<br>• 驗收：`python3 schemas/schema_validator.py --run-oracle` |
| **WP-2**<br>*(Wiki 雙向圖譜與兩階段檢索)* | **Wiki Graph & Dream Engineer**<br>模型：`flash` / `pro` | • `memory/index/TAXONOMY.json`<br>• `schemas/context_node.schema.json`<br>• `scripts/auto_update_map.py`<br>• `.Friday/extensions/epistemic-gate.ts`<br>• `.Friday/prompts/dream.md` | 1. 建立 `TAXONOMY.json` 並解除 `domain_code` 寫死限制。<br>2. 於 `auto_update_map.py` 實作 `[[node_key]]` 正反向連結 (`outbound_links` / `backlinks`)。<br>3. 於 `epistemic-gate.ts` 實作兩階段目錄、`query_library` 工具與 `/dream` 自動編目。<br>• 驗收：`python3 scripts/auto_update_map.py` |
| **WP-3**<br>*(雙腦絲滑代讀與鬆耦合橋接)* | **Router Seamless Offload Engineer**<br>模型：`pro` | • `.Friday/extensions/model-router.ts` | 1. 拔除 `import "./epistemic-gate.js"` 改用 `globalThis.__fridayEpistemicBridge` (`R2`)。<br>2. 改造 `Token Offload Gate` (`L1115–L1184`) 為 `R1: Seamless Read Auto-Offload`（`limit <= 350` 直接放行；未設 `limit` 讀 `> 350` 行大檔於同 Turn 回傳結構大綱 + 關鍵預覽 + 分段座標）。 |
| **WP-4**<br>*(E2E 驗收測試與總帳對齊)* | **QA & Ledger Aligner**<br>模型：`flash_lite` / `flash` | • `scripts/test_friday_architecture.py`<br>• `memory/LEDGER.md`<br>• `.Friday/AGENTS.md` | 1. 擴充 `scripts/test_friday_architecture.py` 新增 `test_13_library_wiki_taxonomy_and_seamless_offload` 端到端測試並確保 `test_1`..`test_12` 全綠。<br>2. 同步 `memory/LEDGER.md` 與 `.Friday/AGENTS.md`。<br>• 驗收：`python3 scripts/test_friday_architecture.py` |

| 驗收編號 | 對應工作包 | E2E 驗收場景與測試輸入 | 可證偽通過基準 (Falsifiable Pass Criteria) |
| :--- | :--- | :--- | :--- |
| **`E2E-WP1-01`** | **WP-1** | 建立無 `reviewer`、無 `verification_oracle` 且 `0` 個 `[FACT]` 之 `artifact_type: "wiki"` 條目並執行 `schema_validator.py`。 | `schema_validator.py` 回傳 Exit Code `0`；相同條件若改為 `artifact_type: "spec"` 則必須觸發 `AS-01` / `AS-02` 攔截（Exit Code `1`）。 |
| **`E2E-WP1-02`** | **WP-1** | 對純 Markdown 草稿執行 `python3 scripts/sync_doc_metadata.py --file <draft.md> --init --type wiki --domain 310`。 | 自動分配接續之 `MEM-YYYY-XXXX`（跳過 `0099`/`0100` 測試哨兵）、生成合規 YAML 標頭，且通過 `schema_validator.py` 驗證（Exit Code `0`）。 |
| **`E2E-WP1-03`** | **WP-1** | 檢查 `.Friday/extensions/workspace-guard.ts` 之 `SEC-DOC-GOVERNANCE` 規則對 `memory/wiki/` 與 `memory/specs/` 之行為差異。 | 單一 Agent 寫入 `memory/wiki/**` 獲放行；未經治理流程寫入受保護公文館（`memory/codex`, `memory/adr`, `memory/specs`）則維持攔截。 |
| **`E2E-WP2-01`** | **WP-2** | 於 `memory/index/TAXONOMY.json` 定義子領域 `"310"` 與 `"510"`，建立 `domain_code: "310"` 節點並執行 `auto_update_map.py`。 | `schema_validator.py` 與 `auto_update_map.py` 均通過（Exit Code `0`），`CONTEXT_INDEX.json` 正確收錄 `"310"` 領域統計 `domain_stats`。 |
| **`E2E-WP2-02`** | **WP-2** | 於節點 A 內文加入 `[[000.SOUL.v1]]` 連結，執行 `python3 scripts/auto_update_map.py`。 | `CONTEXT_INDEX.json` 中節點 A 的 `outbound_links` 包含 `"000.SOUL.v1"`，且 `"000.SOUL.v1"` 的 `backlinks` 包含節點 A 之 `node_key`。 |
| **`E2E-WP2-03`** | **WP-2** | 測試 `epistemic-gate.ts` 兩階段目錄（模擬 `<= 25` 節點 vs `> 25` 節點）與 `query_library` 工具檢索與 `/dream` 指令註冊。 | 節點 `> 25` 時開局摘要僅包含核心 `000`/`100` 節點與各領域計數（行數 `<= 20`）；呼叫 `query_library(domain="300")` 正確回傳匹配條目與 `backlinks`；`/dream` 與 `.Friday/prompts/dream.md` 契約齊備。 |
| **`E2E-WP3-01`** | **WP-3** | 在 `model-router.ts` 雙腦/省流模式下呼叫 `read(path, offset=100, limit=120)`（`limit <= 350`）。 | `Token Offload Gate` 直接放行（`return undefined`），不計入未分段讀取違規，不回傳 `block: true`。 |
| **`E2E-WP3-02`** | **WP-3** | 在 `model-router.ts` 雙腦/省流模式下對 `> 350` 行大檔呼叫未帶 `limit` 之 `read(path)`。 | 同一個 Turn 內直接回傳包含「檔案結構大綱（含行號座標）+ 前 60 行預覽 + 建議 `offset`/`limit` 分段座標」之透明代讀結果，而非空洞報錯。 |
| **`E2E-WP3-03`** | **WP-3** | 靜態與動態檢查 `model-router.ts` 頂部匯入與 `globalThis.__fridayEpistemicBridge`。 | `model-router.ts` 不再包含 `from "./epistemic-gate.js"` 靜態匯入；單獨載入 `model-router.ts` 或無 `memory/codex` 時不拋出例外亦不輸出 `CONTEXT_INDEX.json=missing`。 |
| **`E2E-WP4-01`** | **WP-4** | 執行 `python3 scripts/test_friday_architecture.py` 與 `python3 schemas/schema_validator.py --run-oracle`。 | 原有 `test_1` 至 `test_12` 及新增之 `test_13_library_wiki_taxonomy_and_seamless_offload` 全部通過（Exit Code `0`）。 |

---

## 五、 預期效益與可證偽驗收基準

1. `[INFERRED]` **圖書館擴充性躍升**：新增一篇 Wiki 知識條目 (`artifact_type: "wiki" | "note" | "sop" | "glossary" | "digest"`) 僅需輕量標頭（或由 `sync_doc_metadata.py --init` 自動取號生成），零雙模型審批與算 `[FACT]` 摩擦，同時完整納入 `CONTEXT_INDEX.json` 雙向連結圖譜與 `TAXONOMY.json` 分類檢索。
2. `[INFERRED]` **雙腦模式 0 死胡同絲滑讀檔**：主腦在 `hybrid-synergy` 下帶有 `offset` + `limit <= 350` 的精準切片讀取直接放行；未帶 `limit` 讀取 `> 350` 行大檔時於單一 Turn 內直接獲得結構大綱、關鍵段落預覽與分段座標，徹底消除二次回合浪費。
3. `[INFERRED]` **Teamwork 高效平行交付與鬆耦合治理**：透過 `globalThis.__fridayEpistemicBridge` 解除跨插件靜態耦合，並依 `WP-1` ~ `WP-4` 嚴格物理分檔與 E2E 驗收矩陣（`E2E-WP1-01` ~ `E2E-WP4-01`），可於零檔案衝突下完成實作與回歸驗證。
