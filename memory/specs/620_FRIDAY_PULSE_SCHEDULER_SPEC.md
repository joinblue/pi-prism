---
node_id: "MEM-2026-0011"
artifact_type: "spec"
access_tier: "standard"
priority: "high"
status: "draft"
created_at: "2026-10-27"
updated_at: "2026-10-27"
author:
  role: "architect"
  model: "google-vertex/gemini-4-argon"
reviewer:
  role: "challenger"
  model: "deepseek-ai/deepseek-v4.1-flash"
  verdict: "APPROVED"
epistemic_profile:
  fact_count: 3
  inferred_count: 3
  hypothesis_count: 1
  unverified_count: 0
verification_oracle:
  type: "schema_check"
  command: "python3 schemas/schema_validator.py --file memory/specs/620_FRIDAY_PULSE_SCHEDULER_SPEC.md"
  expected_exit_code: 0
  falsifiable_criterion: "若本初步規格未通過 Schema 驗證、違反 AS-02/AS-05 或散文行數超標，則判定無效。"
context_index:
  domain_code: "500"
  node_key: "500.PULSE-SCHEDULER.v1"
  facet_tags:
    - "Friday:Automation:PulseScheduler:Spec"
    - "Friday:Daemon:AdaptiveHeartbeat:Spec"
    - "PotoTypeV0:Workflow:InboxTriage:Spec"
  keywords:
    - "Friday Pulse"
    - "Adaptive Heartbeat"
    - "File Watcher"
    - "Zero-Cost Scout Triage"
    - "Inbox Approval"
    - "Worktree Isolation"
  summary_1line: "Friday Pulse 智慧背景排程初步藍圖：定義定時/事件/動態心跳三模態觸發、免費 Scout 前哨過濾與收件匣隔離簽核機制。"
topology:
  depends_on:
    - "000.SOUL.v1"
    - "100.ARCH-RULES.v1"
    - "200.OPT-ROADMAP.v1"
    - "500.ROUTER-V2-MULTITURN.v1"
  supersedes: []
  conflicts_with: []
  verified_by:
    - "schemas/schema_validator.py"
  affected_paths:
    - ".Friday/extensions/model-router.ts"
    - ".Friday/extensions/workspace-guard.ts"
    - "memory/LEDGER.md"
---

# 📌 `500.PULSE-SCHEDULER.v1` (MEM-2026-0011) — Friday Pulse 智慧背景排程與常駐自動化引擎初步藍圖

## 一、 背景與問題定義 (Problem Statement)

1. `[FACT]` 目前 Friday 的調度機制（`model-router.ts` 與 `subagent`）屬於「對話驅動（Session-Driven）」之被動執行模式，僅在使用者主動發起終端機互動時運作，尚無常駐背景的自主巡檢與事件喚醒能力。
2. `[FACT]` 傳統作業系統之 `cron` 僅能依固定時間執行死板腳本，缺乏跨次狀態記憶、事件感知（如資料夾新增算圖或程式碼變更）、動態調整檢查頻率以及異常自癒推理能力。
3. `[INFERRED]` 對標並結合本機 Codex Agent Automations 之設計精髓，在 Friday 現有的「免費專家模型池」與「工作區安全護欄」之上建構 **Friday Pulse 智慧背景排程引擎**，可實現全天候接近零成本的自動化巡檢、量化盯盤、ComfyUI 批次品管與專案背景維護。

---

## 二、 四大核心架構機制 (Core Architecture)

| 模組名稱 | 核心機制說明 | 搭配模型 / 安全機制 |
| :--- | :--- | :--- |
| **1. 三模態觸發器<br>(Tri-Modal Trigger)** | - **定時觸發 (`cron` / `interval`)**：固定週期喚醒（如每日 08:30 早報）。<br>- **事件觸發 (`watcher`)**：監聽指定資料夾（如新圖片產出、CSV 匯入、Git Commit）即時喚醒。<br>- **動態心跳 (`adaptive-heartbeat`)**：由 AI 根據當前狀況（如盤勢波動率或算圖佇列深度）自行決定下一次喚醒間隔（例如由 60 分鐘縮短為 3 分鐘）。 | 內建最小冷卻時間鎖（Cooldown $\ge 60\text{s}$）與每日最大喚醒次數上限，防止無限迴圈耗盡配額。 |
| **2. 兩階段省流過濾<br>(Two-Stage Triage)** | - **Stage A（免費前哨巡檢）**：每次心跳喚醒先派免費 `scout` 比對上次狀態快照（State Hash / Checkpoint）。若無實質變化或無異常，立即靜默休眠（`No-Op`），**消耗 0 主腦 Token 且不打擾使用者**。<br>- **Stage B（動態代理執行）**：確認有新事件或異常時，才啟動 `worker` 或 `orchestrator` 進行動態推理、爬蟲重試或腳本執行。 | 複用 `500.ROUTER-V2-MULTITURN.v1` 之 Sticky Key 池與免費 Fallback 鏈。 |
| **3. 沙盒隔離與收件匣<br>(Isolation & Inbox)** | - **唯讀與沙盒隔離**：背景任務預設僅具唯讀或獨立沙盒（如 Git Worktree / 指定輸出目錄）寫入權限，嚴禁直接覆寫使用者正在編輯之主分支檔案。<br>- **收件匣與外部推播**：只有產出重要結論或待決策事項時，才寫入 Pulse Inbox 並推播至手機（Telegram / Discord / Line）。 | 嚴格受 `100.ARCH-RULES.v1` (`workspace-guard.ts`) 邊界與憑證保護約束。 |
| **4. 專屬互動指令<br>(`/pulse` CLI)** | - `/pulse add <排程或監聽描述>`：用自然語言一句話建立排程或資料夾監聽任務。<br>- `/pulse list` / `pause` / `resume` / `run`：檢視、暫停或立即手動觸發測試。<br>- `/pulse inbox` / `approve`：檢視背景代理完成之成果並一鍵簽核合併。 | 設定儲存於 `.Friday/pulse-jobs.json`，執行狀態同步記錄於活躍台帳。 |

---

## 三、 執行流水線與狀態機 (Execution Pipeline)

```text
[觸發源: 定時 Cron / 檔案 Watcher / AI 動態心跳]
       │ (通過單實例互斥鎖 File Lock & 冷卻檢查)
       ▼
[Stage A: 免費 Scout 前哨快篩 (對比上次 Checkpoint)]
       ├── 判定「無變化 / 正常」 ──► 靜默更新心跳時間 (No-Op, 0 主腦消耗, 不發通知)
       │
       └── 判定「有新檔案 / 訊號觸發 / 異常」
                 │
                 ▼
[Stage B: 喚醒指定 Agent (Worker / Vision / Orchestrator) 動態推理執行]
       │ (於獨立沙盒目錄或 Worktree 執行，遇錯自動重試/自癒)
       ▼
[Stage C: 寫入 Pulse Inbox 報告 + 發送手機 Webhook 通知 + 動態決定下次喚醒時間]
```

1. `[FACT]` 所有背景排程透過單實例檔案鎖（File Lock）防止同一任務重疊併發執行，並強制遵守 `.Friday/` 與 `schemas/` 防竄改護欄。
2. `[INFERRED]` 透過「Stage A 免費 Scout 快篩 + Stage B 按需喚醒」，即使設定高頻率巡檢（例如每 5 分鐘檢查一次資料夾或行情），95% 以上的無變化周期都能由免費模型在 1 秒內攔截消化。
3. `[INFERRED]` 將「動態心跳（Adaptive Heartbeat）」與「檔案事件監聽（Watcher）」結合後，Friday 即可同時勝任「量化看盤動態盯場」、「ComfyUI 算圖資料夾即時品管」與「程式碼自動巡檢」。
4. `[HYPOTHESIS]` 預計在實測階段先以「本機常駐輕量 Daemon / 擴充指令 `/pulse` + Telegram/Discord 通知」作為最小可行原型（MVP），再依實際體感迭代調整冷卻閾值與沙盒合併流程。
