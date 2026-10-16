---
description: 啟動 Friday 跨模型對抗協作管線 (Scout -> Architect -> Challenger -> Worker -> Auditor)
---
請針對以下任務啟動 Friday 跨模型子代理協作團隊 (`subagent` 工具的 `chain` 模式)：

任務目標：$@

請依序調度以下子代理鏈 (`chain`)：
1. `scout` (`nvidia/nemotron-3.5-lightning-30b-a3b`)：快速檢索 `memory/index/CONTEXT_INDEX.json` 與相關檔案路徑。
2. `architect` (`deepseek-ai/deepseek-v4.1-flash`)：根據 `{previous}` 的情報擬定符合架構規範與可證偽驗證條件的實作方案。
3. `challenger` (`z-ai/glm-5.3`)：對 `{previous}` 進行跨模型抗諂媚找碴審查，指出任何潛在漏洞。
4. `worker` (`poolside/laguna-xs-2.1`)：根據 `{previous}` 落實檔案修改與實作。
5. `auditor` (`z-ai/glm-5.3-flash`)：執行 `python3 schemas/schema_validator.py --run-oracle` 與相關測試進行最終驗收。
