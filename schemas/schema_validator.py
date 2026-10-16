#!/usr/bin/env python3
"""
Friday Agentic Harness Epistemic & Anti-Sycophancy Validator (Pillar 1 Oracle)
==============================================================================
Validates governed Markdown memory nodes in `memory/` against:
  1. `artifact_header.schema.json` (記憶節點治理標頭)
  2. `context_node.schema.json`    (漸進式 Context 索引與拓撲節點)
  3. Anti-Sycophancy & Epistemic Rules (AS-01 ~ AS-04):
     - AS-01: Cross-Model Review Enforcement (`author.model != reviewer.model` on `verified` / `archived`)
     - AS-02: Epistemic Tag Honesty Check (frontmatter counts must match actual `[FACT]`/`[INFERRED]`/`[HYPOTHESIS]`/`[UNVERIFIED]` tags in body)
     - AS-03: Falsifiable Verification Oracle Check
     - AS-04: Causal Topology DAG Integrity (no missing `depends_on` targets or cycles)
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path
from typing import Any, Dict, List, Tuple

try:
    import yaml  # type: ignore
except ImportError:
    yaml = None

try:
    import jsonschema  # type: ignore
except ImportError:
    jsonschema = None


EPISTEMIC_TAGS = {
    "fact_count": re.compile(r"(?m)^\s*(?:[-*+]|\d+\.)\s+`?\[FACT\]`?(?!\*\*：)"),
    "inferred_count": re.compile(r"(?m)^\s*(?:[-*+]|\d+\.)\s+`?\[INFERRED\]`?(?!\*\*：)"),
    "hypothesis_count": re.compile(r"(?m)^\s*(?:[-*+]|\d+\.)\s+`?\[HYPOTHESIS\]`?(?!\*\*：)"),
    "unverified_count": re.compile(r"(?m)^\s*(?:[-*+]|\d+\.)\s+`?\[UNVERIFIED\]`?(?!\*\*：)"),
}


def parse_markdown_frontmatter(md_path: Path) -> Tuple[Dict[str, Any], str]:
    content = md_path.read_text(encoding="utf-8")
    if not content.startswith("---\n"):
        raise ValueError(f"{md_path}: Missing YAML frontmatter opening '---'")
    parts = content.split("\n---\n", 1)
    if len(parts) != 2:
        raise ValueError(f"{md_path}: Missing YAML frontmatter closing '---'")
    raw_fm = parts[0][4:]
    body = parts[1]
    if yaml is not None:
        data = yaml.safe_load(raw_fm)
    else:
        data = json.loads(raw_fm)
    if not isinstance(data, dict):
        raise ValueError(f"{md_path}: Frontmatter must parse to a JSON/YAML object")
    return data, body


def validate_against_schema(data: Dict[str, Any], schema: Dict[str, Any], label: str) -> List[str]:
    errors: List[str] = []
    if jsonschema is not None:
        validator = jsonschema.Draft202012Validator(schema)
        for err in sorted(validator.iter_errors(data), key=lambda e: list(e.path)):
            loc = ".".join(str(p) for p in err.path) or "<root>"
            errors.append(f"[{label}] {loc}: {err.message}")
    else:
        for req in schema.get("required", []):
            if req not in data:
                errors.append(f"[{label}] Missing required field: {req}")
    return errors


def validate_document(
    md_path: Path,
    project_root: Path,
    header_schema: Dict[str, Any],
    node_schema: Dict[str, Any],
    run_oracle: bool = False,
) -> Tuple[Dict[str, Any] | None, List[str]]:
    errors: List[str] = []
    try:
        fm, body = parse_markdown_frontmatter(md_path)
    except Exception as exc:
        return None, [str(exc)]

    # 1. Schema structure checks
    errors.extend(validate_against_schema(fm, header_schema, "ArtifactHeaderSchema"))
    errors.extend(validate_against_schema(fm, node_schema, "ContextNodeSchema"))

    if errors:
        return fm, errors

    # 2. AS-01: Cross-Model Dialectical Review Check (Anti-Sycophancy)
    status = fm.get("status")
    orig_model = fm.get("author", {}).get("model", "")
    rev_model = fm.get("reviewer", {}).get("model", "")
    verdict = fm.get("reviewer", {}).get("verdict", "")

    if status in ("verified", "archived"):
        if orig_model == rev_model:
            errors.append(
                f"[AS-01 Anti-Sycophancy] 禁止同模型自審自核！產出模型 ({orig_model}) 與審查模型 ({rev_model}) 相同，不可進入「{status}」狀態。"
            )
        if verdict != "APPROVED":
            errors.append(
                f"[AS-01 Anti-Sycophancy] 狀態為「{status}」時，reviewer.verdict 必須為 APPROVED（目前為 {verdict}）。"
            )

    # 3. AS-02: Epistemic Tag Honesty Check
    profile = fm.get("epistemic_profile", {})
    actual_counts: Dict[str, int] = {}
    for key, pattern in EPISTEMIC_TAGS.items():
        actual = len(pattern.findall(body))
        actual_counts[key] = actual
        declared = profile.get(key, -1)
        if actual != declared:
            errors.append(
                f"[AS-02 Epistemic Honesty] 內文標籤數量與標頭宣告不符：{key} 宣告為 {declared}，但內文實際出現 {actual} 次。"
            )

    if status in ("verified", "archived"):
        if actual_counts.get("unverified_count", 0) > 0:
            errors.append(
                f"[AS-02 Epistemic Gate] 進入「{status}」之記憶節點不得含有 [UNVERIFIED] 未驗證段落（目前有 {actual_counts['unverified_count']} 處）。"
            )
        if actual_counts.get("fact_count", 0) + actual_counts.get("inferred_count", 0) == 0:
            errors.append(
                f"[AS-02 Epistemic Gate] 記憶節點內文必須至少包含一處 [FACT] 或 [INFERRED] 標記。"
            )

    # 4. AS-03: Affected Paths & Falsifiable Oracle Check
    for rel_path in fm.get("topology", {}).get("affected_paths", []):
        target = (project_root / rel_path).resolve()
        if not target.exists():
            errors.append(
                f"[AS-03 Grounding] topology.affected_paths 指向不存在的路徑: {rel_path}"
            )

    if run_oracle:
        oracle = fm.get("verification_oracle", {})
        cmd = oracle.get("command", "")
        expected_code = oracle.get("expected_exit_code", 0)
        if cmd:
            proc = subprocess.run(
                cmd,
                shell=True,
                cwd=str(project_root),
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                timeout=30,
            )
            if proc.returncode != expected_code:
                errors.append(
                    f"[AS-03 Oracle Failed] 指令 `{cmd}` 回傳碼 {proc.returncode} != 預期 {expected_code}。輸出: {proc.stderr.strip() or proc.stdout.strip()}"
                )

    return fm, errors


def check_topology_graph(nodes: Dict[str, Dict[str, Any]]) -> List[str]:
    errors: List[str] = []
    known_ids = set(nodes.keys())
    key_to_node: Dict[str, str] = {}
    for node_id, fm in nodes.items():
        node_key = fm.get("context_index", {}).get("node_key")
        if node_key:
            key_to_node[node_key] = node_id

    adj: Dict[str, List[str]] = {n: [] for n in nodes}
    for node_id, fm in nodes.items():
        for dep in fm.get("topology", {}).get("depends_on", []):
            resolved = dep if dep in known_ids else key_to_node.get(dep)
            if not resolved:
                errors.append(f"[AS-04 Topology] {node_id} 依賴不存在的節點 ID 或定位鍵: {dep}")
            else:
                adj[node_id].append(resolved)

    # Cycle detection (DFS)
    visited: Dict[str, int] = {}  # 0=unvisited, 1=visiting, 2=done

    def dfs(node: str, stack: List[str]) -> None:
        visited[node] = 1
        for nxt in adj.get(node, []):
            state = visited.get(nxt, 0)
            if state == 1:
                cycle_str = " -> ".join(stack + [nxt])
                errors.append(f"[AS-04 Topology Cycle] 偵測到循環依賴: {cycle_str}")
            elif state == 0:
                dfs(nxt, stack + [nxt])
        visited[node] = 2

    for n in nodes:
        if visited.get(n, 0) == 0:
            dfs(n, [n])

    return errors


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate Friday Agentic Harness Memory Nodes.")
    parser.add_argument("--project-root", default=".", help="Project root directory")
    parser.add_argument("--file", help="Validate a single Markdown file")
    parser.add_argument("--run-oracle", action="store_true", help="Execute verification_oracle commands")
    args = parser.parse_args()

    project_root = Path(args.project_root).resolve()
    schemas_dir = project_root / "schemas"
    header_schema = json.loads((schemas_dir / "artifact_header.schema.json").read_text(encoding="utf-8"))
    node_schema = json.loads((schemas_dir / "context_node.schema.json").read_text(encoding="utf-8"))

    if args.file:
        md_files = [Path(args.file).resolve()]
    else:
        memory_dir = project_root / "memory"
        md_files = sorted(
            p for p in memory_dir.rglob("*.md")
            if p.name != "CONTEXT_MAP.md"
        )

    if not md_files:
        print("⚠️ No governed Markdown memory nodes found in memory/.")
        return 0

    all_nodes: Dict[str, Dict[str, Any]] = {}
    total_errors = 0

    for md_file in md_files:
        rel = md_file.relative_to(project_root) if md_file.is_relative_to(project_root) else md_file
        fm, errs = validate_document(md_file, project_root, header_schema, node_schema, args.run_oracle)
        if fm and "node_id" in fm:
            all_nodes[fm["node_id"]] = fm
        if errs:
            total_errors += len(errs)
            print(f"❌ {rel}: FAILED ({len(errs)} errors)")
            for e in errs:
                print(f"   - {e}")
        else:
            node_id = fm.get("node_id", "UNKNOWN") if fm else "UNKNOWN"
            node_key = fm.get("context_index", {}).get("node_key", "") if fm else ""
            status = fm.get("status", "") if fm else ""
            print(f"✅ {rel} [{node_id} | {node_key} | {status}]: PASSED")

    if not args.file and all_nodes:
        topo_errors = check_topology_graph(all_nodes)
        if topo_errors:
            total_errors += len(topo_errors)
            print("❌ Topology Graph Check: FAILED")
            for e in topo_errors:
                print(f"   - {e}")
        else:
            print(f"✅ Causal Topology Graph ({len(all_nodes)} nodes): PASSED (0 broken links, 0 cycles)")

    return 1 if total_errors > 0 else 0


if __name__ == "__main__":
    sys.exit(main())
