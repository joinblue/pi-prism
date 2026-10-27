---
node_id: "MEM-2026-0009"
artifact_type: "audit"
access_tier: "standard"
priority: "high"
status: "deprecated"
created_at: "2026-10-19"
updated_at: "2026-10-20"
author:
  role: "architect"
  model: "google-vertex/gemini-4-argon"
reviewer:
  role: "challenger"
  model: "nvidia/nemotron-3-ultra-550b-a55b"
  verdict: "APPROVED"
epistemic_profile:
  fact_count: 6
  inferred_count: 2
  hypothesis_count: 0
  unverified_count: 0
verification_oracle:
  type: "schema_check"
  command: "python3 schemas/schema_validator.py --file memory/audits/MEM-2026-0009_ROUTER_STRESS_AUDIT.md"
  expected_exit_code: 0
  falsifiable_criterion: "若壓力測試之 4 大問題根因或修復規格缺失、散文超標或違反 AS-01/AS-05，則驗證失敗。"
context_index:
  domain_code: "600"
  node_key: "600.AUDIT-002.v1"
  facet_tags:
    - "Friday:Routing:StressTest:Audit"
    - "PotoTypeV0:Verification:RouterHandoff:Audit"
  keywords:
    - "Stress Test"
    - "Token Offload Gate"
    - "filePaths"
    - "SEC-DOC-GOVERNANCE"
    - "404 Not Found"
    - "Timeout"
  summary_1line: "WO-2026-R1 (M1~M7) 與 Stage 4~5 壓力測試驗收報告：記錄已通過之防禦機制與待修復之 4 項執行期瓶頸。"
topology:
  depends_on:
    - "000.SOUL.v1"
  supersedes: []
  conflicts_with: []
  verified_by:
    - "schemas/schema_validator.py"
  affected_paths:
    - ".Friday/models.json"
    - ".Friday/role-models.json"
    - ".Friday/extensions/model-router.ts"
    - ".Friday/prompts/team.md"
    - "scripts/test_friday_architecture.py"
    - "memory/specs/200_OPTIMIZATION_ROADMAP.md"
    - "memory/specs/500_MODEL_APIKEY_GUIDE.md"
    - "memory/specs/700_HARNESS_BLUEPRINT.md"
---

# 🧪 `600.AUDIT-002.v1` (MEM-2026-0009) — Router Handoff (M1~M7) 壓力測試驗收與熱修復規格

## 一、 實彈壓力測試通過項目 (Verified Safeguards)

1. `[FACT]` **圖片與巨型檔案直讀硬性攔截 (`M4 Token Offload Gate`)**：於 `apex-commander` 模式下，主腦直接對圖片或超過 350 行之大型源碼呼叫無限制 `read` 時，均被當場硬性攔截 (`block: true`)，零 Base64 污染主腦 Context。
2. `[FACT]` **`filePaths` 機密與越界防禦 (`M3 Security`)**：對 `dispatch_specialist` 傳入 `.Friday/auth.json` 與工作區外路徑時，均被底層安全檢查即時阻擋。
3. `[FACT]` **防幽靈文件鎖與源碼連動警報 (`M7 & Stage 5`)**：於 `memory/` 外建立未納管 `.md` 文件立即觸發 `SEC-DOC-GOVERNANCE` 攔截；修改受保護源碼立即觸發 `Code-to-Spec Drift Alert` 提醒對應之記憶節點。

---

## 二、 壓力測試揭露之 4 大執行期問題與根因分析

| 編號 | 實測抓出之問題 | 發生目標檔案 | 實證根因分析 |
| :---: | :--- | :--- | :--- |
| **S1** | **`nvidia/nemotron-3-super-120b-a12b` 官方端點已下架 (HTTP 404)** | `.Friday/models.json`<br>`.Friday/extensions/model-router.ts`<br>`.Friday/agents/architect.md` | 實測呼叫時 NVIDIA NIM 伺服器回傳 `404 Not Found (Function ac74040f... Not found)`，留存於模型池與預設清單會導致必定失敗。 |
| **S2** | **`dispatch_specialist` 多檔比對時因 `<think>` 推理耗時被逾時鬧鐘切斷** | `.Friday/extensions/model-router.ts`<br>`.Friday/models.json` | 免費模型開啟 `"reasoning": true` 後，面對開放式「比對/找衝突」任務會先生成 1,500+ Tokens 之 `<think>` 內部思考（耗時 15~35 秒），若逾時上限過短或未限制思考長度會導致 `Request was aborted`。 |
| **S3** | **單次 `filePaths` 缺乏負載容量上限保護 (Payload Cap)** | `.Friday/extensions/model-router.ts` | 一次塞入 6 份大型規格書（>45,000 字元）會超出免費 NIM 端點單次可穩定承受之 Prefill 負載，需設定單次檔案數與總字數上限。 |
| **S4** | **`test_8` 無頭子程序逾時與 `team.md` YAML 冒號引號檢查** | `scripts/test_friday_architecture.py`<br>`.Friday/prompts/team.md` | `team.md` 頂部 `description:` 含冒號需雙引號包覆；`test_8` 受 S1/S2 影響導致無頭 `pi -p` 測試逾時。 |
| **S5** | **`Code-to-Spec Drift Alert` 觸發後未強制同步更新關聯規格書** | `memory/specs/200_OPTIMIZATION_ROADMAP.md`<br>`memory/specs/500_MODEL_APIKEY_GUIDE.md`<br>`memory/specs/700_HARNESS_BLUEPRINT.md` | 修改 `model-router.ts` 與 `workspace-guard.ts` 觸發 Drift Alert 後，上述 3 份綁定 `affected_paths` 之規格書仍殘留已 404 下架之 `nemotron-3-super-120b-a12b` 且未收錄 `M1~M7` 新機制，形成規格漂移。 |

---

## 三、 待執行熱修復規格 (Hotfix Specifications for Stage 7.1)

1. `[FACT]` **修復 1 — 全面剔除已 404 下架之 `nvidia/nemotron-3-super-120b-a12b`**：
   - 從 `.Friday/models.json`、`model-router.ts` (`DEFAULT_ROLE_MODELS` 與 `ROLE_FALLBACK_CHAINS`)、`.Friday/role-models.json`、`.Friday/agents/architect.md` 及 `scripts/test_friday_architecture.py` 中移除 `nemotron-3-super-120b-a12b`，改用實測存活之 `nvidia/nemotron-3-ultra-550b-a55b` 或 `z-ai/glm-5.3`（保留使用者主腦 `google-vertex/gemini-4-argon`）。
2. `[INFERRED]` **修復 2 — `dispatch_specialist` 單次負載上限 (`Payload Cap`) 與極簡推理設定**：
   - 单一候選模型生成上限設為 `60000` (60 秒，提早完成即刻返回，遇 `429`/`404`/`16/16` 則 0.3 秒內秒切 Fallback，不改死固定模型排序)。
   - 新增 `filePaths` 單次負載上限：**最多 `3` 個檔案或總字元數 $\le 20,000$ 字元**；超過時直接回傳提示要求分批呼叫或改派 `subagent` 沙盒分步處理。
   - 針對 `scout` / `audit` 角色，於 System Prompt 要求極簡直出，避免長篇 `<think>` 空轉耗時。
3. `[FACT]` **修復 3 — 堅守 `Token Offload Gate`「擋死並回報使用者」鐵律**：
   - 於 `apex-commander` 模式下，嚴格維持圖片與大檔/多檔 `read` 硬性封鎖 (`block: true`)，**絕不因免費專家失敗而自動解鎖讓主腦直接讀取大檔**（防止數萬 Token 瞬間灌爆主腦 Context）。
   - 當免費專家全數塞車失敗或觸發負載上限時，主腦必須直接向使用者簡短回報失敗原因，由使用者裁示是否指派 `subagent` 子代理處理。
4. `[INFERRED]` **修復 4 — 更新 `scripts/test_friday_architecture.py` 驗收斷言**：
   - 於 `test_8` 加入 `team.md` YAML 雙引號檢查，並確保剔除 404 模型後 `TEST 1` ~ `TEST 10` 全數穩定通過。
5. `[FACT]` **修復 5 — 落實 `Code-to-Spec Drift Alert` 閉環（同步更新 3 份關聯 `specs/` 記憶節點並強化 Hook 追蹤）**：
   - 同步更新 `Code-to-Spec Drift Alert` 點名之 3 份規格節點（`200_OPTIMIZATION_ROADMAP.md`、`500_MODEL_APIKEY_GUIDE.md`、`700_HARNESS_BLUEPRINT.md`），將文內已 404 下架之 `nemotron-3-super-120b-a12b` 替換為存活模型，並補入 `filePaths`、`Token Offload Gate`、`SEC-DOC-GOVERNANCE` 與雙策略模式說明，更新 `updated_at` 與 `epistemic_profile` 計數後通過 `schema_validator.py --run-oracle`。
   - 於 `.Friday/extensions/epistemic-gate.ts` 中強化 Drift Alert 機制：記錄當次 Session 已修改但尚未同步更新之關聯 `spec` 節點清單（Pending Spec Sync Set），直到對應 `spec` 節點被檢視或更新。
