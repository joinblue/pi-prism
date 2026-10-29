---
node_id: "MEM-2026-0014"
artifact_type: "spec"
access_tier: "standard"
priority: "high"
status: "verified"
created_at: "2026-10-29"
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
  inferred_count: 3
  hypothesis_count: 0
  unverified_count: 0
verification_oracle:
  type: "schema_check"
  command: "python3 schemas/schema_validator.py --file memory/specs/630_HARNESS_DETAX_AND_PROMPT_ORTHOGONALITY.md"
  expected_exit_code: 0
  falsifiable_criterion: "若本規格違反 Schema 散文預算，或重構後 test_friday_architecture.py 12 組測試未全數通過，則本節點判定無效。"
context_index:
  domain_code: "500"
  node_key: "500.HARNESS-DETAX.v1"
  facet_tags:
    - "Friday:Architecture:Spec:DetaxOrthogonality"
    - "PotoTypeV0:Optimization:Context:PromptEngineering"
  keywords:
    - "Framework Tax"
    - "Double Taxation"
    - "Silent Guardrails"
    - "Dispatch Specialist Tools"
    - "SEC-DOC-GOVERNANCE"
    - "PRIVATE_INDEX"
  summary_1line: "Friday 框架減稅與正交重構規格：消除雙重抽稅、賦予專家唯讀視野、收斂 SEC-DOC-GOVERNANCE 為根目錄保護並重構精簡角色 Prompt。"
topology:
  depends_on:
    - "000.SOUL.v1"
    - "100.ARCH-RULES.v1"
    - "500.ROUTER-V2-MULTITURN.v1"
    - "700.HARNESS-BLUEPRINT.v1"
  supersedes: []
  conflicts_with: []
  verified_by:
    - "schemas/schema_validator.py"
    - "scripts/test_friday_architecture.py"
  affected_paths:
    - ".Friday/AGENTS.md"
    - ".Friday/agents/architect.md"
    - ".Friday/agents/challenger.md"
    - ".Friday/agents/scout.md"
    - ".Friday/agents/worker.md"
    - ".Friday/agents/auditor.md"
    - ".Friday/extensions/model-router.ts"
    - ".Friday/extensions/workspace-guard.ts"
    - ".Friday/extensions/epistemic-gate.ts"
    - "schemas/schema_validator.py"
    - "scripts/auto_update_map.py"
---

# ⚡ `500.HARNESS-DETAX.v1` (MEM-2026-0014) — Friday 框架減稅、專家視野賦能與 Prompt 正交化重構規格

## 一、 實測病灶與「雙重抽稅 (Double Taxation)」根因診斷

1. `[FACT]` **10 萬 Token 膨脹與高快取假象**：於 Session `01a186b3` 實測中，第 134 輪 Input 達 `100,028` Tokens（`cacheRead: 99,728`），其中約 **40% (~42k Tokens)** 來自 5 次雙腦派工（10 次 `dispatch_specialist`）回傳之冗長三段式表格與主腦重複抄寫，約 **35% (~37k Tokens)** 來自記憶寫入失敗時重複印出之 60 行 `Prescription Skeleton` 範本。
2. `[FACT]` **無工具盲人專家 (`dispatch_specialist`)**：`model-router.ts` 之 `dispatch_specialist` 僅調用純文字 `stream/complete` API 且未提供任何唯讀工具；當主腦未顯式傳入 `filePaths` 時，`architect` 輸出無效之 `cat -n ...` 文字區塊即中斷，而 `challenger` 因看不見源碼遂將既有功能（如 `auto_update_map.py` 與 `PRIVATE_INDEX.json`）誤判為未驗證假設並要求凍結系統。
3. `[FACT]` **`friday-mandate` 關鍵字無腦催眠**：`model-router.ts` 於 `hybrid-synergy` 模式下只要偵測到「架構/設計/重構」字眼，即每輪往歷史尾端注入 `customType: "friday-mandate"` 強迫主腦在未查看任何檔案前先呼叫 `architect` + `challenger` 空轉。
4. `[FACT]` **`SEC-DOC-GOVERNANCE` 副檔名一刀切謬誤**：`workspace-guard.ts` 攔截 `memory/` 以外所有 `.md` 檔案寫入，把「檔案格式（`.md`）」誤當成「治理領域」，導致 `scratch/`、子模組說明檔或測試資料無法正常建立或解壓 `.md` 文件。
5. `[FACT]` **Prompt 職責重疊與激勵扭曲**：`AGENTS.md` 要求主腦背誦所有底層已硬性攔截之 `SEC-*` 代碼；`challenger` 被設定為「唯一存在價值是找碴」，誘發對單機原型與本地 `scratch/` 暫存區產生「安裝 ClamAV 掃毒、實作分散式事務鎖」等過度防禦幻想。

---

## 二、 五大工程重構設計與正交化原則

| 編號 | 重構模組 | 舊版問題設計 | 正交化根治設計 (Orthogonal Solution) |
| :---: | :--- | :--- | :--- |
| **D1** | **領域邊界治理 (`SEC-DOC-GOVERNANCE`)** | 依副檔名 `.md` 全面封鎖工作區，靠白名單打補丁。 | **反轉為「職責領域保護」**：<br>1. `memory/` 內強制納管（`memory/private/` 分流至 `PRIVATE_INDEX.json` 不進 Git）。<br>2. `memory/` 外**僅攔截在專案根目錄 (`./`) 直接建立未納管 `.md`**（`README.md`, `AGENTS.md` 除外），全面釋放 `scratch/`、`src/`、`tests/` 等所有子目錄之檔案自由。 |
| **D2** | **專家內建工具迴圈與子代理備援 (`dispatch_specialist` & `subagent`)** | 無工具純文字補全，沒傳 `filePaths` 即成瞎子；`code` 僅能吐回整份源碼讓主腦重寫（雙重課稅）；`subagent` 遇限流直接崩潰。 | **自動路徑掛載 + In-Process Tool-Use Loop + Subagent Fallback**：<br>1. 自動解析 `task` 內提及之檔案/目錄路徑並預載入 Context 與目錄快照。<br>2. 為所有專家掛載專案內唯讀工具（`read_file`, `list_dir`, `grep_search`），並為 `code` 專家賦予安全寫入與語法驗證工具（`edit_file`, `write_file`, `run_syntax_check`），由 `code` 直接改檔並僅回傳精簡 Diff 摘要（消除主腦雙重課稅）。<br>3. 為 `subagent` 實作 `SUBAGENT_ROLE_FALLBACKS` 自動模型備援鏈與 `Worker local total request limit reached` 秒級熔斷切換。 |
| **D3** | **沉默護欄與拔除催眠 (`Silent Guardrails`)** | 每輪塞 `friday-mandate` 強迫跑雙腦；`AGENTS.md` 背誦法條。 | 1. 移除 `hybrid-synergy` 自動塞入 `friday-mandate` 強迫雙腦推演之攔截器，交由主腦按需調度。<br>2. 從 `AGENTS.md` 移除 `SEC-*` 條文背誦，由底層 Hook 於違規時才透過 `RemediationPointer` 介入。 |
| **D4** | **角色 Prompt 精煉與抗幻想校準** | 強制每輪長篇三段式表格；`challenger` 為找碴而找碴。 | 1. **專家高密度回報上限**：`dispatch_specialist` 內部回傳嚴格控制在精煉重點（$\le 350$ 字），避免主腦 Context 膨脹。<br>2. **Challenger 實證審查原則**：僅針對真實讀取之代碼/規格指出具體邏輯或競態缺陷；若符合當前原型階段需求則直接 `VERDICT: APPROVED`，嚴禁無源碼盲猜或提出企業級過度防禦（如掃毒、複雜事務鎖）。 |
| **D5** | **處方籤精準報錯 (`schema_validator.py`)** | 每次驗證失敗皆印出完整 60 行 YAML 處方籤洗版。 | **按需輸出骨架**：當檔案**已具備合法 YAML Frontmatter 結構**、僅個別欄位或內文認知標籤不符時，僅輸出具體錯誤行與單行修正提示；僅在**缺失或無法解析 YAML 標頭**時才印出完整 60 行 `Prescription Skeleton`。 |

---

## 三、 預期效益與可證偽驗收基準

1. `[INFERRED]` **Context 稅率下降 >70%**：消除雙腦冗長官僚報告、移除重複 `friday-mandate` 與 60 行處方籤洗版後，單輪雙腦協作之 Context 增長將由 `~15,000` Tokens 降至 `<3,500` Tokens。
2. `[INFERRED]` **零瞎子專家誤判**：賦予 `dispatch_specialist` 自動路徑提取與唯讀探查能力後，`architect` 與 `challenger` 可直接查閱 `scripts/auto_update_map.py` 與 `scratch/` 實況，徹底消除「因未見源碼而要求熔斷系統」之假陽性阻撓。
3. `[INFERRED]` **全庫無衝突收斂**：同步更新 `memory/` 既有規範文件與 `scripts/test_friday_architecture.py` 後，12 組端到端測試套件與全庫 Schema 驗證須 100% 通過。
