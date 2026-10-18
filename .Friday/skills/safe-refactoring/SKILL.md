---
name: safe-refactoring
description: 安全架構重構與零退化標準作業程序 (Safe Refactoring & Zero-Regression SOP) — 結合 affected_paths 拓撲檢視、跨模型審查與獨立測試防護
---

# 🛠️ Safe Refactoring Skill (安全架構重構標準技能書)

當執行跨檔案重構、模組拆解或介面升級時，嚴格遵循以下四步零退化流程：

## 1. 拓撲影響面盤點 (Topology & Impact Analysis `[FACT]`)
- 重構前先查閱 `memory/index/CONTEXT_INDEX.json` 與 `memory/LEDGER.md`，確認目標檔案是否列於任何記憶節點之 `topology.affected_paths`。
- 若涉及受保護之核心規格 (`spec` / `rule` / `adr`)，先閱讀對應節點之 `falsifiable_criterion`，確保重構不違反既有架構不變量。

## 2. 建立基準測試快照 (Baseline Verification)
- 執行重構前，先以繁體中文說明目的並執行既有測試套件，確認變更前基準為 `PASSED (exitCode = 0)`。

## 3. 分步原子化變更與跨模型找碴 (Atomic Edit & Cross-Model Challenge)
- 保持單次變更原子化，避免同時混雜功能變更與結構搬移。
- 對高風險架構變更，主動呼叫 `dispatch_specialist(specialist="challenger", ...)` 進行異體模型紅隊審查，排除邊界遺漏與死鏈風險。

## 4. 死鏈修復、索引重編與三段式通報 (Index Sync & 3-Part Report)
- 若涉及檔案搬移或記憶節點更新，執行 `python3 schemas/schema_validator.py --run-oracle && python3 scripts/auto_update_map.py`。
- 以 **【結論 / 邊界與異常 / 下一步行動】** 三段式結構輸出重構前後對照表與測試實證。
