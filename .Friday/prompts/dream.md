---
description: "Friday 知識記憶修剪與夢境固化管線 (/dream: 整理 scratch/ 與 memory/wiki/ 草稿，自動編目並掛載雙向圖譜)"
---
請執行 Friday 知識記憶整理與圖書館固化流程：

1. **草稿掃描**：掃描 `scratch/` 與 `memory/wiki/` 中尚未具備合規 Frontmatter 的 Markdown 檔案。
2. **自動編目**：對未編目草稿執行 `python3 scripts/sync_doc_metadata.py --init --file <path> --type wiki --domain 310`。
3. **雙向圖譜連結**：解析條目間概念關聯，使用 `[[node_key]]` 或 `[[MEM-YYYY-XXXX]]` 建立正向引用。
4. **館藏索引編譯**：執行 `python3 scripts/auto_update_map.py` 更新 `CONTEXT_INDEX.json` 與 `CONTEXT_MAP.md`。
