---
description: "啟動 Friday 跨模型子代理協作管線 (預設極速實作鏈: scout -> worker -> auditor；深度對抗鏈: scout -> architect -> challenger -> worker -> auditor)"
---
請針對以下任務啟動 Friday 跨模型子代理協作團隊 (`subagent` 工具的 `chain` 模式，各角色自動讀取 `.Friday/agents/*.md` 與 `.Friday/role-models.json` 綁定之免費極速模型)：

任務目標：$@

請依任務複雜度選擇以下任一子代理鏈 (`chain`) 調度：

### A. 預設極速實作鏈（一般功能實作、Bug 修復、測試撰寫 — 省時高成功率）
1. `scout`：快速檢索 `memory/index/CONTEXT_INDEX.json` 與目標檔案結構，整理關鍵行號與 `[FACT]` 摘要。
2. `worker`：根據 `{previous}` 與主腦指令，在獨立沙盒內完成程式碼修改，並自主執行語法檢查與單元測試（`python3 -m py_compile` / `pytest`），回傳極簡 Diff 摘要。
3. `auditor`：根據 `{previous}` 執行 `python3 schemas/schema_validator.py --run-oracle` 與相關測試進行獨立神諭驗收。

### B. 完整深度對抗鏈（重大架構變更、新增 ADR 或使用者明確要求深度推演時啟用）
1. `scout`：快速檢索 `memory/index/CONTEXT_INDEX.json` 與相關檔案路徑。
2. `architect`：根據 `{previous}` 的情報擬定符合架構規範與可證偽驗證條件 (`falsifiable_criterion`) 的實作方案。
3. `challenger`：對 `{previous}` 進行跨模型抗諂媚紅隊審查，指出任何潛在邏輯與邊界漏洞。
4. `worker`：根據 `{previous}` 落實檔案修改、沙盒內測試驗證並回報極簡 Diff 摘要。
5. `auditor`：執行 `python3 schemas/schema_validator.py --run-oracle` 與相關測試進行最終驗收。
