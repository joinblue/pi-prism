---
name: root-cause-debugging
description: 通用根因除錯標準作業程序 (Root-Cause Debugging SOP) — 強制先重現、定位最小證據鏈、禁止盲目猜測修補或竄改測試條件
---

# 🔍 Root-Cause Debugging Skill (通用根因除錯標準技能書)

當面對任何測試失敗、非預期行為或執行期異常時，嚴格遵循以下四階段科學除錯流程：

## 1. 觀察與最小可重現化 (Observe & Reproduce `[FACT]`)
- **禁止盲猜修補**：在取得明確的錯誤重現輸出 (`exitCode`、Stack Trace、標準錯誤輸出) 前，禁止修改任何正式程式碼。
- **執行前置說明**：執行重現用的 `bash` 指令前，必先以繁體中文說明指令目的與影響範圍。

## 2. 因果鏈定位與假設檢驗 (Isolate & Falsify `[HYPOTHESIS]` ➔ `[FACT]`)
- 使用 `grep`、`find` 與 `read` 沿著呼叫堆疊或資料流定位實際發生偏差之檔案與行號。
- 提出明確可證偽的根因假設 (`[HYPOTHESIS]`)，並透過最小探針或唯讀檢索驗證其真偽，轉化為 `[FACT]`。

## 3. 最小邊界修復與防作弊鐵律 (Minimal Fix & Anti-Gaming)
- **只修病根，不改裁判**：針對根因進行最小範圍之精準修改 (`edit`)，**嚴禁透過放寬測試斷言、刪除測試案例或修改 `schemas/` 來掩蓋錯誤**。
- **路徑可攜性**：所有新增或修改之程式碼與設定一律使用專案相對路徑，嚴禁寫入本機絕對路徑。

## 4. 獨立驗證與三段式通報 (Oracle Verification & 3-Part Report)
- 重新執行獨立驗證指令（如測試套件或 `python3 schemas/schema_validator.py --run-oracle`）確認 `exitCode === 0`。
- 以 **【結論 / 邊界與異常 / 下一步行動】** 三段式結構回報根因與驗證結果。
