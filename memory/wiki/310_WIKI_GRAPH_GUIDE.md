---
node_id: "MEM-2026-0016"
artifact_type: "wiki"
access_tier: "standard"
priority: "normal"
status: "verified"
created_at: "2026-10-30"
updated_at: "2026-10-30"
author:
  role: "knowledge_curator"
  model: "flash"
reviewer: null
artifact_track: "wiki"
subdomain: "310"
content_checksum: "11168435cecaf808"
context_index:
  domain_code: "310"
  node_key: "310.WIKI-GRAPH-GUIDE.v1"
  facet_tags:
    - "Library:Wiki:Guide:wiki"
  keywords:
    - "wiki"
    - "knowledge"
    - "graph"
    - "links"
  summary_1line: "Friday Library Wiki and Bidirectional Knowledge Graph Guide"
topology:
  depends_on:
    - "000.SOUL.v1"
    - "300.LIBRARY-WIKI-AND-SEAMLESS-ROUTER.v1"
  supersedes: []
  conflicts_with: []
  verified_by:
    - "schemas/schema_validator.py"
  affected_paths:
    - "memory/wiki/310_WIKI_GRAPH_GUIDE.md"
---

# 📚 Friday Library Wiki & Bidirectional Graph Guide

- [FACT] Friday 支援雙軌知識庫管理：正式公文軌（`OFFICIAL_TYPES`）與圖書館 Wiki 軌（`WIKI_TYPES`）。
- [FACT] Wiki 節點可透過雙向 WikiLinks 連結至核心憲法 [[000.SOUL.v1]] 與路由模組 [[300.LIBRARY-WIKI-AND-SEAMLESS-ROUTER.v1]]。

## 雙向圖譜與知識漫遊
條目正文中引用的 `[[node_key]]` 會由 `auto_update_map.py` 自動提取為 `outbound_links`，並在目標節點反向登記為 `backlinks`。
