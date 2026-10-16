---
node_id: "MEM-2026-0001"
artifact_type: "constitution"
access_tier: "immutable"
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
  inferred_count: 2
  hypothesis_count: 0
  unverified_count: 0
verification_oracle:
  type: "schema_check"
  command: "python3 schemas/schema_validator.py --file memory/codex/000_SOUL.md"
  expected_exit_code: 0
  falsifiable_criterion: "若內文認知標籤數量與 epistemic_profile 不一致，或產出模型與審查模型為同一模型，則本核心憲法節點立即判定無效。"
context_index:
  domain_code: "000"
  node_key: "000.SOUL.v1"
  facet_tags:
    - "Friday:Governance:Meta:Constitution"
    - "PotoTypeV0:Memory:Schema:Soul"
  keywords:
    - "Meta-Constitution"
    - "Anti-Sycophancy Protocol"
    - "Epistemic Tags"
  summary_1line: "Friday Agentic Harness 核心憲法：定義四級認知誠實標籤、跨模型對抗審查與獨立驗證斷言 (Oracle) 鐵律。"
topology:
  depends_on: []
  supersedes: []
  conflicts_with: []
  verified_by:
    - "schemas/schema_validator.py"
  affected_paths:
    - "schemas/artifact_header.schema.json"
    - "schemas/context_node.schema.json"
    - "schemas/schema_validator.py"
---

# 🏛️ `000.SOUL.v1` (MEM-2026-0001) — Friday × PotoTypeV0 核心憲法

## 一、 核心定位與認知誠實原則 (Epistemic Integrity)

1. `[FACT]` Pi Coding Agent (`@earendil-works/pi-coding-agent` v1.3.0) 原生提供 4 項基礎物理工具 (`read`, `bash`, `edit`, `write`) 與 41 個 Extension 生命週期插槽，預設不具工作區邊界強制鎖與防諂媚驗證器。
2. `[FACT]` 單一大型語言模型在缺乏外部驗證器 (External Oracle) 時，具有高度「自我迎合 (Self-Fitting)」與「討好使用者 (Sycophancy)」傾向，容易編造寬鬆測試以宣告任務成功。
3. `[INFERRED]` 因此，Friday Agentic Harness 管理下的所有架構記憶節點，必須強制將「產出權 (`author.model`)」與「審查權 (`reviewer.model`)」分離給不同模型家族，並綁定獨立的 `verification_oracle` 指令。

## 二、 四級認知標籤規範 (Mandatory Epistemic Tagging)

所有記憶節點內文之關鍵論述必須明確標註以下四種標籤之一，且數量必須與 YAML 標頭之 `epistemic_profile` 完全吻合：
- **`[FACT]`**：已透過實際執行指令、原始碼行號或測試輸出直接證實之客觀事實。
- **`[INFERRED]`**：基於已知事實與架構原理推導出之工程結論。
- **`[HYPOTHESIS]`**：尚待實驗驗證之設計假設（僅允許存在於 `draft` 或 `reviewing` 階段）。
- **`[UNVERIFIED]`**：未經查證之外部資訊（嚴禁出現在 `verified` 或 `archived` 節點中）。

## 三、 漸進式 Context 揭露鐵律 (Progressive Disclosure)

1. `[FACT]` 本專案採用「治理標頭 (`artifact_header.schema.json`) × Context 拓撲節點 (`context_node.schema.json`)」雙軌合一之 YAML Frontmatter。
2. `[INFERRED]` Agent 啟動時僅注入 `memory/index/CONTEXT_INDEX.json` 之 `summary_1line` 單行摘要，按需透過 `read` 調閱對應節點，確保 Context Window 高效純淨。
