---
node_id: "MEM-2026-0018"
artifact_type: "wiki"
access_tier: "standard"
priority: "high"
status: "verified"
created_at: "2026-10-31"
updated_at: "2026-10-31"
author:
  role: "architect"
  model: "claude-opus-4-6-thinking"
reviewer: null
artifact_track: "wiki"
subdomain: "320"
content_checksum: "21423219796cc5de"
context_index:
  domain_code: "300"
  node_key: "320.EXTENSION-AND-SCHEMA-RECIPES.v1"
  facet_tags:
    - "Library:Wiki:Recipes:extension"
    - "Security:WebResearch:NemotronGuard:Firewall"
  keywords:
    - "extension"
    - "schema"
    - "dream"
    - "web_research"
    - "nemotron"
    - "code_intelligence_map"
  summary_1line: "Stage 6 Extension Recipes, Schema Guardrails, Unified /dream, Nemotron Web Research, and Code Intelligence Map"
topology:
  depends_on:
    - "000.SOUL.v1"
    - "310.WIKI-GRAPH-GUIDE.v1"
    - "300.LIBRARY-WIKI-AND-SEAMLESS-ROUTER.v1"
  supersedes: []
  conflicts_with: []
  verified_by:
    - "schemas/schema_validator.py"
    - "scripts/test_friday_architecture.py"
  affected_paths:
    - ".Friday/extensions/epistemic-gate.ts"
    - ".Friday/extensions/web-research.ts"
    - ".Friday/prompts/dream.md"
    - "scripts/auto_update_map.py"
    - "scripts/test_friday_architecture.py"
---

# 🛠️ Friday Extension Recipes, Schema Guardrails & Code Intelligence Guide

- [FACT] 本技術指南固化 Stage 6 三大核心能力與架構防坑契約，並連結至核心憲法 [[000.SOUL.v1]]、圖書館雙向圖譜指南 [[310.WIKI-GRAPH-GUIDE.v1]] 與插件架構藍圖 [[300.LIBRARY-WIKI-AND-SEAMLESS-ROUTER.v1]]。
- [FACT] 遵循本節點之施工圖契約，主腦或子代理可在不依賴多輪重試的前提下一次通過 `schemas/schema_validator.py --run-oracle`。

## 1. 雙軌 Schema 與 `memory/**` 寫入防坑守則

- [FACT] `schemas/schema_validator.py` 的 `--run-oracle` 會遞迴驗證 `memory/` 下除 `memory/LEDGER.md` 以外的所有 Markdown 檔案。
- [FACT] 任何由 Hook（如 `session_shutdown`）自動寫入 `memory/episodic/SESSION_DIGEST.md` 的紀錄，必須先以 `python3 scripts/sync_doc_metadata.py --init --type digest --domain 900 --file memory/episodic/SESSION_DIGEST.md` 建立合法的 `WIKI_TYPES` 標頭，寫入後再執行 `sync_doc_metadata.py --file memory/episodic/SESSION_DIGEST.md` 更新 `content_checksum`。
- [FACT] 規則 `AS-05` 嚴格禁止在 `memory/**/*.md` 內出現任何環境絕對路徑或檔案 URI 前綴，所有路徑引用一律使用相對於專案根目錄的相對路徑。

## 2. 單一 `/dream` 入口與 `session_shutdown` 確定性收斂

- [FACT] Pi Agent 的指令優先順序中，`pi.registerCommand("dream")` 會遮蔽 `.Friday/prompts/dream.md` 提示詞模板。
- [FACT] `.Friday/extensions/epistemic-gate.ts` 不再註冊同名 `/dream` 指令，改由 `pi.on("session_shutdown")` 自動完成確定性 `SESSION_DIGEST.md` 歸檔與 `auto_update_map.py` 索引刷新；手動執行 `/dream` 則唯一觸發 `.Friday/prompts/dream.md` 的三階段 NREM/REM/Oracle 記憶整併流程。

## 3. 內建 `web_research` 100% 本地直連與 Nemotron Safety Guard v3 防火牆

- [FACT] `.Friday/extensions/web-research.ts` 註冊 `web_research` 工具，實作四階段縱深防禦（零第三方雲端中轉、100% 本地直連）：
  1. `validateOutboundSafety`：攔截內網/Loopback/Link-Local IPv4 與 IPv6 位址（SSRF 防護）以及查詢字串中的 API Key 外洩。
  2. `hybridSearchAndFetch`：採用本地直連雙引擎。搜尋主通道由本地發送標準瀏覽器 POST 表單直連 DuckDuckGo Lite，網頁抓取由本地 `fetch` 搭配內建 `htmlToCleanMarkdown` 轉出乾淨結構化 Markdown；本地安裝 `ddgs` / `trafilatura` 時自動啟用本地開源函式庫深度解析備援，徹底剔除第三方雲端代理中轉。
  3. `evaluateWebContentWithNemotronGuard`：先執行確定性 `IPI_DETERMINISTIC_RE` 快篩，再強制送入 `nvidia/llama-3.1-nemotron-safety-guard-8b-v3` 進行雙維度語意審查，無金鑰或連線異常時一律採 Fail-Closed 阻斷。
  4. `synthesizeWithScout`：注入當下時間錨點由 `z-ai/glm-5.3-flash` 濃縮為不超過 350 字的 `[FACT]` 條列摘要與 `[1] <URL>` 來源引註。

## 4. 零快取耗損時間錨點 (Zero-Cache-Eviction Tail Time Anchor)

- [FACT] 大模型 Prefix KV Cache 嚴格由左至右按順序比對。若將當下時間（分/秒）動態寫入開頭之 `systemPrompt`（Token 0），會導致每一輪快取被全部作廢。
- [FACT] Friday 採用尾端時間錨點策略：在 `.Friday/extensions/model-router.ts` 的 `before_agent_start` Hook 中，將 `[Current Local Time (Tail Anchor): YYYY-MM-DD HH:MM:SS]` 透過尾端訊息 `friday-mandate` 動態附加在 `messages` 陣列末尾；同時在 `web-research.ts` 的 Scout 摘要 Prompt 中注入當前時間錨點。此架構確保了跨日、恢復對話（Resume）時主腦具備精確時間感知，且保持開頭 System Prompt 不變，達成 0% 快取破壞。

## 5. `code_intelligence_map` 與 `query_library` 雙向影響圈檢索

- [FACT] `scripts/auto_update_map.py` 內建 `build_code_intelligence_map`，同時掃描 Python AST 頂層函式/類別行號 (`L<start>-L<end>`) 與 TypeScript Extension 匯出符號、`pi.registerCommand`、`pi.registerTool`、`pi.on` 註冊位置。
- [FACT] 每個源碼檔案均自動計算 `imports`、`imported_by` 影響圈與反向綁定的 `governing_specs`（由各記憶節點的 `affected_paths` 聚合），並透過 `.Friday/extensions/epistemic-gate.ts` 的 `query_library` 工具連同 `neighbor_summaries` 一併回傳。
