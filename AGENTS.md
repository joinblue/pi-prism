# 🏗️ PotoTypeV0 專案工作區規範 (AGENTS.md)

本專案內嵌專屬 **Friday 大腦 (`PI_CODING_AGENT_DIR=$(pwd)/.Friday`)**，實現「大腦隨專案可攜」之雙層 Agentic Harness 架構。

## 專案結構與核心元件

- `.Friday/`：專案內嵌之 Friday Agentic Harness 大腦核心（受 `SEC-BRAIN` 與 `SEC-CRED` 保護，禁止 Agent 自動修改大腦擴充或讀取 `auth.json`）。
- `schemas/artifact_header.schema.json`：記憶節點治理標頭 Schema（定義產出模型、審查模型、認知標籤統計與獨立驗證斷言）。
- `schemas/context_node.schema.json`：漸進式 Context 索引與依賴拓撲 DAG Schema（領域分層碼 `000`–`900`、節點鍵值 `node_key` 與單行摘要）。
- `schemas/schema_validator.py`：獨立外部防諂媚驗證器 (Verification Oracle)，檢查 AS-01 (跨模型異體審查)、AS-02 (認知標籤誠實度)、AS-03 (可證偽驗證指令) 與 AS-04 (無環依賴拓撲)。
- `scripts/auto_update_map.py`：自動掃描 `memory/` 編譯 `memory/index/CONTEXT_INDEX.json` 與 `memory/codex/CONTEXT_MAP.md`。
- `memory/codex/`：專案核心架構規範 (`000_SOUL.md`, `100_ARCH_RULES.md`, `200_DECISIONS.md`) 與自動編譯之全域總目錄 [`memory/codex/CONTEXT_MAP.md`](memory/codex/CONTEXT_MAP.md)。
- `memory/specs/`：受 Schema 統一納管之系統架構藍圖 (`700_HARNESS_BLUEPRINT.md`)、模型與金鑰設定規格 (`500_MODEL_APIKEY_GUIDE.md`) 與六階段優化演進路線圖 (`200_OPTIMIZATION_ROADMAP.md`)。
- `memory/audits/`：跨模型交叉審查與架構驗收紀錄。

## 記憶庫變更規則（僅於修改 `memory/` 檔案時觸發）

一般日常問答與程式開發無須執行記憶庫驗證；唯有當你新增或修改了 `memory/` 目錄下的架構記憶節點時，才需要執行：
```bash
python3 schemas/schema_validator.py --run-oracle && python3 scripts/auto_update_map.py
```
或由使用者於 TUI 中輸入 `/validate`。
