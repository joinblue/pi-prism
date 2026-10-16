#!/usr/bin/env python3
"""
Friday Context Index & Topology Map Compiler (auto_update_map.py)
=================================================================
Scans all governed memory nodes in `memory/`,
compiles `memory/index/CONTEXT_INDEX.json` (Progressive Disclosure Index),
and renders `memory/codex/CONTEXT_MAP.md` for Agentic Context Engineering.
"""

from __future__ import annotations

import hashlib
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "schemas"))
from schema_validator import parse_markdown_frontmatter  # type: ignore

DOMAIN_LAYERS = {
    "000": "000 核心憲法與認知規範 (Core Constitution & Epistemic Rules)",
    "100": "100 安全邊界與工作區護欄 (Workspace Boundary & Security Guard)",
    "200": "200 架構決策與跨模型審查 (Architecture Decisions & Cross-Review)",
    "300": "300 核心領域邏輯與模組 (Core Domain Modules)",
    "400": "400 工具鏈、Hooks 與擴充套件 (Tools, Hooks & Extensions)",
    "500": "500 動態模型路由與子代理編排 (Model Routing & Subagents)",
    "600": "600 驗證斷言、測試與安全稽核 (Verification Oracles & Audits)",
    "700": "700 可攜式部署與容器封裝 (Portable Brain & Containerization)",
    "800": "800 外部規格與參考文獻 (External Specs & References)",
    "900": "900 歷史封存節點 (Archived & Superseded Nodes)",
}


def sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()[:16]


def build_context_index(project_root: Path) -> Dict[str, Any]:
    memory_dir = project_root / "memory"
    md_files = sorted(
        p for p in memory_dir.rglob("*.md")
        if p.name != "CONTEXT_MAP.md"
    )

    entries: List[Dict[str, Any]] = []
    by_domain: Dict[str, List[Dict[str, Any]]] = {k: [] for k in DOMAIN_LAYERS}
    edges: List[Dict[str, str]] = []

    for md_path in md_files:
        rel_path = str(md_path.relative_to(project_root))
        try:
            fm, _ = parse_markdown_frontmatter(md_path)
        except Exception as exc:
            print(f"⚠️ Skipping unparseable file {rel_path}: {exc}", file=sys.stderr)
            continue

        idx = fm.get("context_index", {})
        topo = fm.get("topology", {})
        domain = idx.get("domain_code", "000")

        entry = {
            "node_id": fm.get("node_id"),
            "artifact_type": fm.get("artifact_type"),
            "status": fm.get("status"),
            "access_tier": fm.get("access_tier"),
            "priority": fm.get("priority"),
            "domain_code": domain,
            "node_key": idx.get("node_key"),
            "facet_tags": idx.get("facet_tags", []),
            "keywords": idx.get("keywords", []),
            "summary_1line": idx.get("summary_1line", ""),
            "path": rel_path,
            "sha256_16": sha256_file(md_path),
            "author_model": fm.get("author", {}).get("model"),
            "reviewer_model": fm.get("reviewer", {}).get("model"),
            "depends_on": topo.get("depends_on", []),
            "affected_paths": topo.get("affected_paths", []),
        }
        entries.append(entry)
        by_domain.setdefault(domain, []).append(entry)

    key_to_id = {e["node_key"]: e["node_id"] for e in entries if e.get("node_key") and e.get("node_id")}
    for entry in entries:
        src_id = entry["node_id"]
        for dep in entry.get("depends_on", []):
            edges.append({"from": src_id, "to": key_to_id.get(dep, dep), "relation": "depends_on"})
    for md_path in md_files:
        try:
            fm, _ = parse_markdown_frontmatter(md_path)
            src_id = fm.get("node_id", str(md_path.relative_to(project_root)))
            for sup in fm.get("topology", {}).get("supersedes", []):
                edges.append({"from": src_id, "to": key_to_id.get(sup, sup), "relation": "supersedes"})
        except Exception:
            pass

    context_index = {
        "schema_version": "2.0.0",
        "project": project_root.name,
        "harness": "Friday",
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "total_nodes": len(entries),
        "domain_registry": {
            code: {
                "title": title,
                "count": len(by_domain.get(code, [])),
                "items": by_domain.get(code, []),
            }
            for code, title in DOMAIN_LAYERS.items()
        },
        "causal_topology_edges": edges,
    }
    return context_index


def render_context_map_md(project_root: Path, index: Dict[str, Any]) -> str:
    lines: List[str] = [
        "# 🗺️ PotoTypeV0 × Friday Context Registry & Topology Map (CONTEXT_MAP.md)",
        "",
        f"> **自動生成時間**: `{index['generated_at']}` | **Agentic Harness**: `{index['harness']}` | **記憶節點總數**: `{index['total_nodes']}`",
        "> **漸進式揭露原則 (Progressive Disclosure)**: Agent 啟動時僅注入本索引之單行摘要，按節點鍵值 (`node_key`) 或節點 ID (`node_id`) 按需調閱對應檔案。",
        "",
        "## 1. 領域分層索引表 (Domain Layer Registry 000–900)",
        "",
    ]

    for code, section in index["domain_registry"].items():
        items = section["items"]
        if not items:
            continue
        lines.append(f"### 🧩 `{code}` — {section['title']}")
        lines.append("")
        lines.append("| 定位鍵 (`node_key`) | 節點 ID (`node_id`) | 類型 | 狀態 | 產出模型 ➔ 審查模型 | 單行摘要 (`summary_1line`) | 路徑 |")
        lines.append("| :--- | :--- | :---: | :---: | :--- | :--- | :--- |")
        for it in items:
            if it["path"].startswith("memory/codex/"):
                rel_link = Path(it["path"]).name
            elif it["path"].startswith("memory/"):
                rel_link = f"../{it['path'][len('memory/'):]}"
            else:
                rel_link = f"../../{it['path']}"
            lines.append(
                f"| `{it['node_key']}` | `{it['node_id']}` | `{it['artifact_type']}` | `{it['status']}` | `{it['author_model']}` ➔ `{it['reviewer_model']}` | {it['summary_1line']} | [{Path(it['path']).name}]({rel_link}) |"
            )
        lines.append("")

    lines.extend([
        "## 2. 記憶節點依賴拓撲圖 (Context Dependency DAG)",
        "",
        "```mermaid",
        "flowchart TD",
    ])
    if index["causal_topology_edges"]:
        for edge in index["causal_topology_edges"]:
            src = edge["from"].replace("-", "_")
            dst = edge["to"].replace("-", "_").replace(".", "_")
            lines.append(f'    {src}["{edge["from"]}"] -->|"{edge["relation"]}"| {dst}["{edge["to"]}"]')
    else:
        lines.append('    ROOT["MEM-2026-0001 (000.SOUL.v1)"]')
    lines.extend([
        "```",
        "",
        "## 3. 專案治理目錄結構摘要",
        "",
        "- `.Friday/` — 專案內嵌可攜式 Agentic Harness 大腦（含模型路由、安全護欄、漸進式揭露與 5 角色子代理）",
        "- `schemas/` — 記憶節點標頭 (`artifact_header.schema.json`)、Context 拓撲節點 (`context_node.schema.json`) 與防諂媚驗證器 (`schema_validator.py`)",
        "- `memory/codex/` — 核心架構規範 (`000_SOUL.md`, `100_ARCH_RULES.md`, `200_DECISIONS.md`) 與自動編譯總目錄 (`CONTEXT_MAP.md`)",
        "- `memory/specs/` — 統一納管之系統架構藍圖 (`700_HARNESS_BLUEPRINT.md`)、模型與金鑰設定指南 (`500_MODEL_APIKEY_GUIDE.md`) 與六階段演進路線圖 (`200_OPTIMIZATION_ROADMAP.md`)",
        "- `memory/audits/` — 跨模型交叉審查與架構驗證紀錄",
        "- `memory/index/CONTEXT_INDEX.json` — 機器可讀之漸進式揭露 Context 索引",
        "- `scripts/` — Context 索引編譯器 (`auto_update_map.py`) 與端到端架構驗收套件 (`test_friday_architecture.py`)",
        "",
    ])
    return "\n".join(lines)


def main() -> int:
    project_root = Path(__file__).resolve().parent.parent
    index = build_context_index(project_root)

    index_path = project_root / "memory" / "index" / "CONTEXT_INDEX.json"
    index_path.parent.mkdir(parents=True, exist_ok=True)
    index_path.write_text(json.dumps(index, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    map_path = project_root / "memory" / "codex" / "CONTEXT_MAP.md"
    map_path.parent.mkdir(parents=True, exist_ok=True)
    map_path.write_text(render_context_map_md(project_root, index), encoding="utf-8")

    print(f"✅ Compiled CONTEXT_INDEX.json ({index['total_nodes']} nodes) -> {index_path}")
    print(f"✅ Rendered CONTEXT_MAP.md -> {map_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
