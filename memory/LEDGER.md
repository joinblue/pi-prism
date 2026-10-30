---
node_id: "MEM-2026-0008"
artifact_type: "spec"
access_tier: "standard"
priority: "high"
status: "verified"
created_at: "2026-10-18"
updated_at: "2026-10-30"
author:
  role: "architect"
  model: "google-vertex/gemini-4-argon"
reviewer:
  role: "challenger"
  model: "deepseek-ai/deepseek-v4.1-flash"
  verdict: "APPROVED"
epistemic_profile:
  fact_count: 2
  inferred_count: 1
  hypothesis_count: 0
  unverified_count: 0
verification_oracle:
  type: "schema_check"
  command: "python3 schemas/schema_validator.py --file memory/LEDGER.md"
  expected_exit_code: 0
  falsifiable_criterion: "若 memory/LEDGER.md 總行數超過 80 行或未通過 Schema 驗證，則本活躍台帳節點判定無效。"
context_index:
  domain_code: "300"
  node_key: "300.LEDGER.v1"
  facet_tags:
    - "PotoTypeV0:Workflow:Ledger:ActiveTasks"
    - "Friday:Governance:Memory:Ledger"
  keywords:
    - "LEDGER"
    - "Active Tasks"
    - "Work Orders"
    - "Stage Tracking"
  summary_1line: "專案唯一活躍工單台帳 (LEDGER.md)：嚴格限制總行數 <= 80 行，僅追蹤進行中任務，完工項目即刻歸檔。"
topology:
  depends_on:
    - "000.SOUL.v1"
    - "200.OPT-ROADMAP.v1"
    - "500.HARNESS-DETAX.v1"
    - "300.LIBRARY-WIKI-AND-SEAMLESS-ROUTER.v1"
  supersedes: []
  conflicts_with: []
  verified_by:
    - "schemas/schema_validator.py"
  affected_paths:
    - "memory/specs/200_OPTIMIZATION_ROADMAP.md"
    - "memory/specs/630_HARNESS_DETAX_AND_PROMPT_ORTHOGONALITY.md"
    - ".Friday/extensions/workspace-guard.ts"
    - ".Friday/extensions/model-router.ts"
---

# 📋 `300.LEDGER.v1` (MEM-2026-0008) — 專案唯一活躍工單台帳

## 一、 台帳治理守則 (Ledger Governance Rules)

1. `[FACT]` 本檔案為專案唯一活躍狀態台帳（Single Source of Active Work），嚴格限制檔案總行數 $\le 80$ 行。
2. `[FACT]` 所有已完成之歷史決策與里程碑透過 `/dream` 提純歸檔至 [`memory/codex/200_DECISIONS.md`](codex/200_DECISIONS.md) 或 [`memory/audits/`](audits/MEM-2026-0004_HARNESS_INIT_AUDIT.md)。
3. `[INFERRED]` 透過「只留活躍工單、完工即歸檔」的精簡機制，可確保 Agent 每次調閱台帳時皆維持極高信噪比，絕不耗損 Context 額度。

## 二、 活躍工單與演進進度表 (Active Work Orders)

| 工單 ID | 階段 / 任務名稱 | 狀態 | 負責角色 | 驗收基準 (Oracle) |
| :--- | :--- | :---: | :---: | :--- |
| **WO-2026-S1** | Stage 1：`<1s TTFT` 固定主腦 + `dispatch_specialist` | ✅ 已完成 (`fadbd17`) | `architect` / `worker` | `test_friday_architecture.py` (Suite 3 & 4) |
| **WO-2026-S2** | Stage 2：繁中強制、三段式通報、`LEDGER.md` 與 `/mode` 升級 | ✅ 已完成 (`772ef1d`) | `architect` / `worker` | `schema_validator.py` + `test_friday_architecture.py` (Suite 6) |
| **WO-2026-S3** | Stage 3：`workspace-guard.ts` 引號感知、`SEC-PORTABILITY` 與處方籤 | ✅ 已完成 (`2c398be`) | `worker` / `challenger` | `test_friday_architecture.py` (Suite 3 & 7) |
| **WO-2026-R1** | Router & Governance (`M1`~`M7`)：防奪舍、Fallback 鏈、`filePaths` 直讀、省流閘門、雙策略與 `SEC-DOC-GOVERNANCE` | ✅ 已完成 (`c848dc5`) | `architect` / `worker` | `test_friday_architecture.py` (Suite 8) |
| **WO-2026-R1.1** | Router Stress-Test Hotfix (`S1`~`S4`)：剔除 404 下架模型、`filePaths` 負載上限、60s 逾時與擋死回報鐵律 | ✅ 已完成 (`f8a7b3e`) | `worker` / `auditor` | `memory/audits/MEM-2026-0009_ROUTER_STRESS_AUDIT.md` |
| **WO-2026-S4** | Stage 4：`schema_validator.py` 散文預算、`AS-05`/`AS-06` 與骨架 | ✅ 已完成 | `worker` / `auditor` | `test_friday_architecture.py` (Suite 9) |
| **WO-2026-S5** | Stage 5：`auto_update_map.py` 死鏈/AST + `epistemic-gate.ts` 警報 | ✅ 已完成 | `worker` / `auditor` | `test_friday_architecture.py` (Suite 10) |
| **WO-2026-S6** | Stage 6：`/dream` 三階段睡眠記憶鞏固 + 退出微夢境 | ⏳ 待執行 | `architect` / `auditor` | Stage 6 Dream Pipeline E2E Tests |
| **WO-2026-P1** | Friday Pulse (`500.PULSE-SCHEDULER.v1`)：定時/事件/動態心跳三模態背景排程、免費 Scout 前哨過濾與 `/pulse` 收件匣 | 📝 藍圖草案 (`MEM-2026-0011`) | `architect` / `worker` | `memory/specs/620_FRIDAY_PULSE_SCHEDULER_SPEC.md` |
| **WO-2026-D1** | Harness Detax (`500.HARNESS-DETAX.v1` / `MEM-2026-0014`)：公私索引分流 (`PRIVATE_INDEX.json`) 與 D1~D5 框架減稅正交重構（根目錄 `SEC-DOC-GOVERNANCE`、專家唯讀視野、沉默護欄、Prompt 精煉與按需處方籤） | ✅ 已完成 | `architect` / `worker` | `memory/specs/630_HARNESS_DETAX_AND_PROMPT_ORTHOGONALITY.md` + `test_friday_architecture.py` |
| **WO-2026-M1** | Library Wiki, Taxonomy & Seamless Router (`MEM-2026-0015`)：雙軌圖書館 (`memory/wiki/`)、`TAXONOMY.json`、`query_library` 與絲滑透明代讀 | ✅ 已完成 | `architect` / `worker` | `test_friday_architecture.py` (Suite 13) |
