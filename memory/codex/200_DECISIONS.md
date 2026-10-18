---
node_id: "MEM-2026-0003"
artifact_type: "adr"
access_tier: "standard"
priority: "high"
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
  inferred_count: 2
  hypothesis_count: 0
  unverified_count: 0
verification_oracle:
  type: "schema_check"
  command: "python3 schemas/schema_validator.py --file memory/codex/200_DECISIONS.md"
  expected_exit_code: 0
  falsifiable_criterion: "若 models.json 包含已知 404 或無限卡死之模型，或 pi-router/auto 無法在對話中動態路由至對應 NVIDIA 模型，則本決策失效。"
context_index:
  domain_code: "200"
  node_key: "200.ADR-001.v1"
  facet_tags:
    - "Friday:Orchestration:Router:VirtualModel"
    - "Friday:Orchestration:Teamwork:Subagents"
  keywords:
    - "Virtual Model Router"
    - "Multi-Agent Teamwork"
    - "NVIDIA NIM Pool"
  summary_1line: "ADR-001：採用 Pi v1.3.0 registerVirtualModel 實作 pi-router/auto 動態路由，並配置 5 角色跨模型子代理協作團隊。"
topology:
  depends_on:
    - "MEM-2026-0001"
    - "MEM-2026-0002"
  supersedes: []
  conflicts_with: []
  verified_by:
    - "schemas/schema_validator.py"
  affected_paths:
    - "schemas/schema_validator.py"
---

# 📜 `200.ADR-001.v1` (MEM-2026-0003) — 雙層 Agentic Harness、動態模型路由與多代理協作決策

## 一、 決策背景與實測依據

1. `[FACT]` 根據對 NVIDIA NIM 平台 21 款模型之實測結果，共有 10 款免費模型 (`cost = 0`) 穩定可用、2 款付費模型可用，另有 7 款回傳 HTTP 404、2 款 (`llama-3.2-90b-vision-instruct`, `moonshotai/kimi-k3`) 會發生無限掛起 (Hang)。
2. `[FACT]` Pi v1.3.0 原生提供 `pi.registerVirtualModel()` 接口，允許在每次 LLM 請求發送前動態決定目標實體模型 (`route(request, ctx)`)，並將路由狀態寫入 Session 分支樹。
3. `[INFERRED]` 將上述 9 款故障模型自 `.Friday/models.json` 徹底剔除，並以 `pi-router/auto` 作為 Friday 大腦預設模型，可兼顧零成本、高速度與跨模型專長互補。

## 二、 5 角色子代理與專長派工矩陣 (Dialectical Teamwork Matrix)

1. `[FACT]` Friday 大腦預設由固定主腦 `nvidia/nemotron-3-super-120b-a12b` (`0.28s TTFT`) 負責全局推理與維持 KV Cache，並在 `.Friday/agents/` 與 `dispatch_specialist` 工具中配置 5 名 `< 1s TTFT` 專業子代理：
   - **`scout` (`z-ai/glm-5.3-flash`)**：1M Context、`0.60s TTFT` 高速唯讀探索與檔案檢索。
   - **`architect` (`nvidia/nemotron-3-super-120b-a12b`)**：120B 旗艦推理、`0.28s TTFT` 架構設計與規格擬定。
   - **`challenger` (`nvidia/nemotron-3-nano-omni-30b-a3b-reasoning`)**：`0.39s TTFT` 跨模型異體對抗審查員，專門找尋 `architect` 與 `worker` 的邏輯漏洞與自我迎合盲點。
   - **`worker` (`poolside/laguna-xs-2.1`)**：`0.28s TTFT` 專精程式碼實作與重構。
   - **`auditor` (`z-ai/glm-5.3-flash`)**：`0.60s TTFT` 執行 `schema_validator.py` 與測試套件之獨立稽核員。
2. `[INFERRED]` 透過「Nemotron-120B 設計 ➔ Nemotron-Nano-30B/GLM 異體找碴審查 ➔ Laguna 實作 ➔ GLM-5.3-Flash 執行外部驗證腳本」的流水線，能從架構層面根除單一模型的諂媚與幻覺問題。
