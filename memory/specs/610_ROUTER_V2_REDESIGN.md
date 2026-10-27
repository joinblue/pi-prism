---
node_id: "MEM-2026-0010"
artifact_type: "spec"
access_tier: "standard"
priority: "critical"
status: "verified"
created_at: "2026-10-20"
updated_at: "2026-10-27"
author:
  role: "architect"
  model: "google-vertex/gemini-4-argon"
reviewer:
  role: "challenger"
  model: "nvidia/nemotron-3-ultra-550b-a55b"
  verdict: "APPROVED"
epistemic_profile:
  fact_count: 8
  inferred_count: 2
  hypothesis_count: 1
  unverified_count: 0
verification_oracle:
  type: "schema_check"
  command: "python3 schemas/schema_validator.py --file memory/specs/610_ROUTER_V2_REDESIGN.md"
  expected_exit_code: 0
  falsifiable_criterion: "若本規格未通過 Schema 驗證、違反 AS-01/AS-05 或散文行數超標，則判定無效。"
context_index:
  domain_code: "500"
  node_key: "500.ROUTER-V2-MULTITURN.v1"
  facet_tags:
    - "Friday:Routing:MultiTurnSpecialist:Spec"
    - "Friday:Auth:MultiKeyStickyPool:Spec"
    - "PotoTypeV0:Governance:HookSpecSync:Spec"
  keywords:
    - "Multi-Turn dispatch_specialist"
    - "Sticky Key"
    - "Per-Loop Round-Robin"
    - "429 Backoff Wait"
    - "Token Offload Gate"
    - "Hook Spec Sync"
  summary_1line: "Router v2 架構重構規格：定義多輪累進專家迴圈、同迴圈 Sticky Key 池 (遇 429 等待 RPM 恢復) 與 Hook 自動化文件同步藍圖。"
topology:
  depends_on:
    - "000.SOUL.v1"
    - "200.OPT-ROADMAP.v1"
    - "500.MODEL-APIKEY-SPEC.v1"
    - "600.AUDIT-002.v1"
    - "700.HARNESS-BLUEPRINT.v1"
  supersedes:
    - "600.AUDIT-002.v1"
  conflicts_with: []
  verified_by:
    - "schemas/schema_validator.py"
    - "scripts/sync_doc_metadata.py"
  affected_paths:
    - ".Friday/models.json"
    - ".Friday/role-models.json"
    - ".Friday/AGENTS.md"
    - ".Friday/extensions/model-router.ts"
    - ".Friday/extensions/epistemic-gate.ts"
    - ".Friday/extensions/subagent/index.ts"
    - "schemas/schema_validator.py"
    - "scripts/sync_doc_metadata.py"
    - "scripts/test_friday_architecture.py"
    - "memory/audits/MEM-2026-0009_ROUTER_STRESS_AUDIT.md"
    - "memory/specs/200_OPTIMIZATION_ROADMAP.md"
    - "memory/specs/500_MODEL_APIKEY_GUIDE.md"
    - "memory/specs/700_HARNESS_BLUEPRINT.md"
---

# 🚀 `500.ROUTER-V2-MULTITURN.v1` (MEM-2026-0010) — 多輪專家迴圈、Sticky Key 池與 Hook 自動同步規格

## 一、 認知事實與核心架構修正 (Core Architectural Decisions)

1. `[FACT]` **全面下架 404 模型 (`S1`)**：`nvidia/nemotron-3-super-120b-a12b` 官方 NIM 端點已回傳 `HTTP 404 Not Found`，必須從 `.Friday/models.json`、`model-router.ts`、`.Friday/agents/architect.md` 與所有活躍規格書中徹底移除，改由 `nvidia/nemotron-3-ultra-550b-a55b` 與 `z-ai/glm-5.3` 接替。
2. `[FACT]` **保留 `Token Offload Gate`（3 檔 / 350 行 / 圖片攔截）並廢除單次檔案數硬上限與截斷提案**：維持主腦單輪讀取超過 3 個檔案或 `>350` 行自動轉交免費專家之省流規則；同時**明確廢除** `600.AUDIT-002.v1` (`MEM-2026-0009`) 第三節原訂之「`filePaths` 最多 3 個檔案 / 20,000 字元硬上限」以及任何「掐頭去尾截斷」作法，確保跨檔比對 100% 讀取完整全文。
3. `[FACT]` **單輪硬塞導致 20 秒斷線之根因確認 (`S2`/`S3`)**：現行 `dispatch_specialist` 將所有 `filePaths` 全文串接後透過單次非串流 `complete()` 呼叫並設 20 秒強制斷線，導致推理模型在完成多檔 Prefill 與 `<think>` 思考前即遭腰斬並觸發連環 Fallback，瞬間耗盡單帳號 `40 RPM` 配額。
4. `[INFERRED]` **`dispatch_specialist` 升級為「記憶體內多輪累進推理迴圈 (`In-Process Multi-Turn Loop`)」**：當傳入多個檔案（如 $\ge 3$ 檔）或長文本時，`dispatch_specialist` 不再單輪一次塞入全部檔案，而是啟動 In-Process 多輪迴圈（每輪分批餵入 1~2 份完整檔案，共用同一 `messages` 歷史陣列），讓專家模型在每一輪皆保有獨立 `<think>` 深度推理與 Prefix KV Cache 命中，單輪耗時壓低至 5~12 秒內，徹底根除逾時斷線。
5. `[INFERRED]` **多帳號 API Key 池採取「跨迴圈輪詢 (`Per-Loop Round-Robin`) + 同迴圈鎖定 (`Sticky Key`) + 遇 `429` 原地等待 RPM 恢復」**：
   - 新啟動之專家迴圈或 `subagent` 任務，依序由 `.Friday/auth.json` 的 `keys: [...]` 金鑰池輪流分配一把 API Key。
   - **同一個多輪迴圈內全程固定綁定同一把 API Key (`Sticky Key / Session Affinity`)**，以 100% 保住雲端 Prefix KV Cache，避免跨輪換 Key 導致全部歷史對話重算 Prefill。
   - 若迴圈中途遭遇 `HTTP 429 Rate Limit`（觸發單帳號 `40 RPM` 滑動視窗上限），**禁止立即換 Key 破壞快取**，應維持同一把 Key 進行原地指數退避等待（如等待 `5s -> 10s -> 15s` 待 RPM 額度恢復後繼續下一輪）；僅於遭遇 `401/403`（憑證失效）、`402`（點數耗盡）或退避重試耗盡時，才 Failover 切換至下一把 Key。
6. `[FACT]` **與既有規格節點之跨檔對齊與淘汰紀錄（已完成同步）**：本規格 (`500.ROUTER-V2-MULTITURN.v1`) 已完成對舊規格矛盾之解決與跨檔對齊：

| 關聯對象節點 | 原有過時/衝突記載 | 本新規格 (`MEM-2026-0010`) 之正確定義與處置狀態 |
| :--- | :--- | :--- |
| **`600.AUDIT-002.v1`** (`MEM-2026-0009`) | 規定 `filePaths` 單次最多 `3` 檔 / $\le 20,000$ 字元硬上限，且維持單輪 `complete()` 60s 呼叫 | **已透過 `topology.supersedes` 雙階段淘汰 (`deprecated`)**；廢除 3 檔 / 20k 字元上限，改為 In-Process Multi-Turn Loop |
| **`500.MODEL-APIKEY-SPEC.v1`** (`MEM-2026-0006`) | 舊版引用 404 模型，且角色模型表與 `.Friday/role-models.json` 需人工維護 | **已完成對齊**：剔除 404 模型、收錄 `keys` 陣列 Sticky Key 規範，並嵌入 `<!-- AUTO-ROLE-MODELS:START/END -->` 由 `sync_doc_metadata.py` 全自動同步 |
| **`200.OPT-ROADMAP.v1` & `700.HARNESS-BLUEPRINT.v1`** | 舊版未收錄多輪 `dispatch_specialist`、Sticky Key 池與 `sync_doc_metadata.py` 自動同步引擎 | **已完成對齊**：全面更新架構藍圖、優化路線圖（Stage 1~5 全數標記 `✅ 已完成`）與 11 項測試矩陣 (`TEST 1 ~ TEST 11`) |

---

## 二、 總結對照表：四大核心設計定案 (Design Summary Matrix)

| 模組維度 | 舊版作法 / 原壓測報告 (`MEM-2026-0009`) 缺陷 | 最終定案設計 (`500.ROUTER-V2-MULTITURN.v1`) |
| :--- | :--- | :--- |
| **1. 下架模型清理 (`S1`)** | 殘留 `nvidia/nemotron-3-super-120b-a12b` 導致必定 `HTTP 404` | 全面剔除，改用 `nvidia/nemotron-3-ultra-550b-a55b` 與 `z-ai/glm-5.3` |
| **2. 省流閘門與多檔讀取 (`S2`/`S3`)** | 單輪硬塞全部檔案導致 `>20s` 腰斬；或設 `<=3` 檔上限 / 掐頭去尾截斷導致比對失明 | **保留 3 檔 / 350 行省流閘門**，將 `dispatch_specialist` 升級為 **In-Process 多輪累進迴圈**（每輪獨立 `<think>`、全文不截斷） |
| **3. 多帳號 API Key 輪詢 (`RPM = 40 × N`)** | 單一 Key 易撞 `40 RPM`；若每輪盲目換 Key 會導致多輪迴圈之 KV Cache 100% 失效 | **Per-Loop Round-Robin + 迴圈內 Sticky Key**；中途撞 `429` **原地等待 RPM 恢復**以保住 KV Cache |
| **4. 確定性 Hook `.md` 自動同步 (`sync_doc_metadata.py`)** | Agent 修改 `.md` 時常算錯 `epistemic_profile` 數字或漏改舊節點 `status` 導致連續 `AS-02`/`AS-04`/`AS-06` 重試框架稅 | **Two-Phase Commit 自動同步 Hook**：Phase 1 手術刀式原地同步標籤計數、`updated_at` 與 SSOT 模型表；Phase 2 於新檔驗證通過後自動將 `supersedes` 舊節點降級為 `deprecated` 並清理雙向死鎖 |

---

## 三、 確定性 Hook `.md` 自動同步與 Router v2.1 補強規格 (Implemented in `sync_doc_metadata.py` & `model-router.ts`)

1. `[FACT]` **Two-Phase Commit 確定性 `.md` 同步腳本 (`scripts/sync_doc_metadata.py`)**：掛載於 `epistemic-gate.ts` 的 `tool_result` Hook（於 `schema_validator.py` 執行前觸發）：
   - **Phase 1A（手術刀式原地元資料與 SSOT 同步）**：掃描內文四級認知標籤真實出現次數，以行級 Regex 原地更新 `fact_count`、`inferred_count`、`hypothesis_count`、`unverified_count` 與 `updated_at`（100% 保留原有 YAML 鍵值順序、引號與行內註解，嚴禁使用 `yaml.dump` 破壞排版）；若內文含 `<!-- AUTO-ROLE-MODELS:START/END -->` 標記，自動由 `.Friday/role-models.json` 渲染最新模型表。
   - **Phase 1B（Pre-Flight 阻斷保護）**：先對當前檔案執行完整驗證（僅暫時豁免待由 Phase 2 解決之 `AS-06 Supersedes Conflict`）。若當前檔案存在 `AS-01`、`AS-02 [UNVERIFIED]`、`AS-05` 或 `ProseBudget` 等違規，**立即中止 Phase 2**，確保舊規格絕不會被無效新檔提前廢棄。
   - **Phase 2（`supersedes` 跨檔自動退役與雙向死鎖自癒）**：當新檔合規且 `status == "verified"` 時，自動將 `topology.supersedes` 指向之活躍舊節點降級為 `status: "deprecated"`，並清除舊節點反向指向新檔之 `supersedes` 殘留；同時 `schema_validator.py` 的 `check_topology_graph` 排除 `archived`/`deprecated` 節點之循環依賴邊，徹底根除 `AS-04` 死鎖。
2. `[FACT]` **Router v2.1 跨模型接力保留與雙策略多模態分流 (`model-router.ts` & `.Friday/AGENTS.md`)**：
   - `dispatch_specialist` 多輪迴圈將 `conversationMessages`、`roundNotes` 與 `completedRoundIdx` 提升至候選模型迴圈外層，當第 $N$ 輪逾時觸發 Failover 換模型時，**完整保留前 $1 \dots N-1$ 輪已完成之筆記**從第 $N$ 輪接力續跑，並將附帶檔案/圖片之最終整合輪逾時放寬為 `38s`（中間輪與無附加檔案之快速問答維持 `22s` 快速 Failover）。
   - `readAuthJson()` 具備重複頂層 JSON 鍵自癒解析能力，自動合併多組 API Key。
   - 圖片 `read` 攔截僅於 `apex-commander` 省流模式下生效；當切換至 `hybrid-synergy` 雙腦模式或原生多模態主腦時，允許主腦直接 `read` 圖片，零框架稅完成視覺推理。
3. `[HYPOTHESIS]` **Stage 6 `/dream` 睡眠記憶批次整合（待後續階段實作）**：跨檔案自由散文段落（Prose）之深度語意整合，留待 Stage 6 `/dream` 離線批次機制處理，不在寫入期 Hook 中呼叫 LLM 改寫內文。

---

## 四、 Prefix KV Cache 四大破口根治、頂層 `usage` 接線與 `/context` 遙測儀表板規格 (Router v2.2 Telemetry & Cache Guard)

1. `[FACT]` **四大 Prefix KV Cache 破壞因子與物理根治方案**：在 `pi-coding-agent` v1.4.0 中，任何對 `before_agent_start` 回傳之 `systemPrompt`（位於 `messages[0]` Token 0）或對主腦預設 API Key 之動態改寫，皆會導致後續整個對話歷史之雲端 Prefix KV Cache 100% 失效。本版確立四大物理防護：

| 破口編號與位置 | 原有破壞 Prefix KV Cache 之設計缺陷 | Router v2.2 物理根治設計 (`epistemic-gate.ts` / `model-router.ts` / `subagent/index.ts`) |
| :--- | :--- | :--- |
| **Killer 1：動態 `[MANDATE]` 覆寫 Token 0**<br>(`.Friday/extensions/model-router.ts`) | `before_agent_start` 根據當輪關鍵字將 `[MANDATE: ...]` 附加至 `event.systemPrompt`；下一輪關鍵字消失時 `messages[0]` 再次變動，造成連環 `cacheRead = 0` | **尾端隱形訊息注入 (`Tail Custom Message`)**：改透過 `before_agent_start` 的 `message: { customType: "friday-mandate", content, display: false }` 附加於當輪 `messages` 尾端，`systemPrompt` (Token 0) 全程 100% 恆定不變 |
| **Killer 2：專家輪詢改寫主腦預設 Key**<br>(`.Friday/extensions/model-router.ts`) | `acquireStickyProviderKey` 旋轉 `authData[provider].key` 並呼叫 `ctx.modelRegistry.refresh()`，導致與專家同 Provider 之主腦下一輪被迫換 Key 而丟失帳號綁定之 KV Cache | **非侵入式顯式傳遞 `apiKey`**：`acquireStickyProviderKey` 僅推進 `activeKeyIndex` 並透過 `ctx.modelRegistry.complete(candidate, context, { signal, apiKey: stickyKeyInfo.key })` 顯式傳入專家迴圈，主腦預設 `entry.key` 永遠固定於 `pool[0]` |
| **Killer 3：中途改 `.md` 刷新 Token 0 索引**<br>(`.Friday/extensions/epistemic-gate.ts`) | Session 中途修改 `memory/**/*.md` 觸發 `auto_update_map.py` 後，下一輪 `buildProgressiveContextSummary` 變更 `messages[0]`，使先前累積之數萬 Token 歷史快取瞬間作廢 | **Session 級索引釘選 (`Session-Pinned Context Summary`)**：依 `sessionId`（或工作區路徑）將首次建立之 `CONTEXT_INDEX` 單行摘要釘選於記憶體，同一 Session 內保證 Token 0 絕對不變 |
| **Killer 4：工具子呼叫 Token 未掛載頂層 `usage`**<br>(`model-router.ts` & `subagent/index.ts`) | `dispatch_specialist` 僅將最後一輪 `usage` 放在 `details.usage`（漏計前 $N-1$ 輪且未設頂層 `result.usage`）；`subagent` 亦僅放於 `details.results[].usage`，導致內建 `/session` 統計失明 | **多輪累加並掛載頂層 `AgentToolResult.usage`**：`dispatch_specialist` 累加多輪迴圈與重試之全部 `input`/`output`/`cacheRead`/`cacheWrite`/`cost`，與 `subagent` 同步掛載於頂層 `usage` 欄位，使 `/session` 與狀態列 100% 精確反映真實消耗 |

2. `[FACT]` **`/context` 四維度 Context 結構與 KV Cache 鑑識儀表板 (`model-router.ts`)**：補強內建 `/session` 缺乏之單輪快取斷裂鑑識與工具肥大度分析，註冊 `/context [turns|tools|json|pin-refresh]` 指令：
   - **Panel 1 — Active Context Window Anatomy**：精確拆解目前活躍分支 (`ctx.sessionManager.getBranch()`) 之 System Prompt (`AGENTS.md` + Session-Pinned `CONTEXT_INDEX`)、User/Assistant 對話、Tool Results 與 Thinking 佔比，並列出 **Top 5 最肥 Tool Results 排行榜**。
   - **Panel 2 — Main Brain vs. Specialist/Subagent Offload Matrix**：對照主腦 (`orchestrator`) 與免費專家 (`dispatch_specialist`) 及子代理 (`subagent`) 之呼叫次數、Token 消耗、快取命中率與省流卸載比例 (`Offload Ratio`)。
   - **Panel 3 — Per-Turn KV Cache Hit/Miss Forensics**：逐輪列出主腦 `input`、`cacheRead`、`Hit%`、相鄰回合間隔 $\Delta t$，並自動診斷快取斷裂根因（`🟢 HIT`、`❄️ COLD_START`、`⏰ TTL_EXPIRED (>5m idle)`、`🔄 MODEL_SWITCH`、`⚠️ PREFIX_MUTATED / PROVIDER_NO_CACHE`）。
   - **Panel 4 — Actionable Optimization Hints**：根據實測數據自動給出高信噪比優化建議。
