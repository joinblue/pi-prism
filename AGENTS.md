# 🏗️ PotoTypeV0 (`pi-prism`) 專案工作區規範 (AGENTS.md)

本專案內嵌專屬 **Friday 大腦 (`PI_CODING_AGENT_DIR=$(pwd)/.Friday`)**，實現「大腦隨專案可攜」之雙層 Agentic Harness 架構。

## 核心溝通與執行紀律 (Mandatory Communication & Execution Rules)

1. **強制繁體中文思考與回應**：內部思考 (`thinking`) 與所有回覆一律使用繁體中文 (`zh-TW`)。
2. **`bash` 執行前必先說明目的**：執行任何 `bash` 指令前，必須先以繁體中文向使用者說明該指令之**目的**與**影響範圍**。
3. **高信噪比三段式通報協議**：所有任務總結與進度回報強制採用 **【結論 / 邊界與異常 / 下一步行動】** 三段式結構；**客觀數據、驗證輸出與對照表格豁免行數限制**。

## 專案結構與核心元件

- `.Friday/`：專案內嵌之 Friday Agentic Harness 大腦核心（含 `.Friday/skills/` 通用工程技能書；受 `SEC-BRAIN` 與 `SEC-CRED` 保護，禁止 Agent 自動修改大腦擴充或讀取 `auth.json`）。
- `schemas/artifact_header.schema.json`：記憶節點治理標頭 Schema（定義產出模型、審查模型、認知標籤統計與獨立驗證斷言）。
- `schemas/context_node.schema.json`：漸進式 Context 索引與依賴拓撲 DAG Schema（領域分層碼 `000`–`900`、節點鍵值 `node_key` 與單行摘要）。
- `schemas/schema_validator.py`：獨立外部防諂媚驗證器 (Verification Oracle)，檢查 AS-01 ~ AS-06、分級散文行數預算與自動處方籤輸出。
- `scripts/auto_update_map.py`：自動掃描 `memory/`、修復死鏈、解析程式碼依賴並編譯 `memory/index/CONTEXT_INDEX.json` 與 `memory/codex/CONTEXT_MAP.md`。
- `memory/LEDGER.md`：唯一活躍工單台帳（嚴格限制上限 $\le 80$ 行，僅保留活躍任務，完工即歸檔）。
- `memory/codex/`：專案核心架構規範 (`000_SOUL.md`, `100_ARCH_RULES.md`, `200_DECISIONS.md`) 與自動編譯之全域總目錄 [`memory/codex/CONTEXT_MAP.md`](memory/codex/CONTEXT_MAP.md)。
- `memory/specs/`：受 Schema 統一納管之系統架構藍圖 (`700_HARNESS_BLUEPRINT.md`)、模型與金鑰設定規格 (`500_MODEL_APIKEY_GUIDE.md`) 與六階段優化演進路線圖 (`200_OPTIMIZATION_ROADMAP.md`)。
- `memory/audits/`：跨模型交叉審查與架構驗收紀錄。

## 記憶庫變更規則（修改 `memory/` 檔案時自動或手動觸發）

一般日常問答與程式開發無須手動執行記憶庫驗證；當新增或修改了 `memory/` 目錄下的架構記憶節點時，系統 Hook 會自動驗證，或可執行：
```bash
python3 schemas/schema_validator.py --run-oracle && python3 scripts/auto_update_map.py
```
亦可於 TUI 中輸入 `/validate` 或 `/dream`。
