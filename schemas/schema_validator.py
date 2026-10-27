#!/usr/bin/env python3
"""
Friday Agentic Harness Epistemic & Anti-Sycophancy Validator (Pillar 1 Oracle)
==============================================================================
Validates governed Markdown memory nodes in `memory/` against:
  1. `artifact_header.schema.json` (記憶節點治理標頭)
  2. `context_node.schema.json`    (漸進式 Context 索引與拓撲節點)
  3. Anti-Sycophancy & Epistemic Rules (AS-01 ~ AS-06 + Tiered Prose Line Budget):
     - AS-01: Cross-Model Review Enforcement (`author.model != reviewer.model` on `verified` / `archived`)
     - AS-02: Epistemic Tag Honesty Check (frontmatter counts must match actual `[FACT]`/`[INFERRED]`/`[HYPOTHESIS]`/`[UNVERIFIED]` tags in body)
     - AS-03: Falsifiable Verification Oracle Check
     - AS-04: Causal Topology DAG Integrity (no missing `depends_on` targets or cycles)
     - AS-05: Path Portability & Privacy Check (no `/home/<real_user>/`, `/Users/<real_user>/`, or `file:///...` absolute paths)
     - AS-06: Version Exclusivity & Obsolescence Check (`supersedes` target must be `archived`/`deprecated`; `conflicts_with` cannot both be `verified`)
     - ProseBudget: Tiered pure prose line budget (`constitution`/`rule`/`adr` <= 50 lines; `spec`/`audit` <= 160 lines; `LEDGER.md` total <= 80 lines)
     - Prescription Skeleton: Outputs ready-to-copy YAML + Markdown skeleton on failure for 1-turn self-healing
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

PROSE_LINE_BUDGETS: Dict[str, int] = {
    "constitution": 50,
    "rule": 50,
    "adr": 50,
    "spec": 160,
    "audit": 160,
}

AS05_PORTABILITY_PATTERNS: List[Tuple[str, re.Pattern[str]]] = [
    ("Linux User Path", re.compile(r"/home/(?!<user>)[A-Za-z0-9._-]+/")),
    ("macOS User Path", re.compile(r"/Users/(?!<user>)[A-Za-z0-9._-]+/")),
    ("Windows User Path", re.compile(r"\b[A-Za-z]:\\Users\\(?!<user>)[A-Za-z0-9._-]+\\")),
    ("Local file:/// URI", re.compile(r"file:///[A-Za-z0-9._~-]+")),
]


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


def count_prose_lines(body: str) -> int:
    """
    Counts pure prose lines in Markdown body, excluding:
    - Fenced code blocks (``` ... ```, including mermaid diagrams)
    - Blank lines and horizontal rules (---)
    - Markdown headings (# ...)
    - Markdown table rows (| ... |)
    """
    in_fence = False
    prose_count = 0
    for raw_line in body.splitlines():
        stripped = raw_line.strip()
        if stripped.startswith("```"):
            in_fence = not in_fence
            continue
        if in_fence:
            continue
        if not stripped:
            continue
        if stripped.startswith("#"):
            continue
        if stripped.startswith("|") and stripped.endswith("|"):
            continue
        if re.match(r"^[-*_]{3,}$", stripped):
            continue
        prose_count += 1
    return prose_count


def check_as05_portability(raw_content: str) -> List[str]:
    errors: List[str] = []
    for label, pattern in AS05_PORTABILITY_PATTERNS:
        match = pattern.search(raw_content)
        if match:
            errors.append(
                f"[AS-05 Portability] 偵測到本機絕對路徑或使用者名稱洩漏 ({label}: `{match.group(0)}`)："
                "記憶節點內一律改用專案相對路徑或 `/home/<user>/` 佔位符。"
            )
    return errors


def load_all_memory_nodes(project_root: Path) -> Dict[str, Dict[str, Any]]:
    memory_dir = project_root / "memory"
    nodes: Dict[str, Dict[str, Any]] = {}
    if not memory_dir.exists():
        return nodes
    for p in sorted(memory_dir.rglob("*.md")):
        if p.name == "CONTEXT_MAP.md":
            continue
        try:
            fm, _ = parse_markdown_frontmatter(p)
            if isinstance(fm, dict) and "node_id" in fm:
                nodes[fm["node_id"]] = fm
        except Exception:
            continue
    return nodes


def check_as06_node_exclusivity(
    node_id: str,
    fm: Dict[str, Any],
    all_nodes: Dict[str, Dict[str, Any]],
) -> List[str]:
    errors: List[str] = []
    key_to_id: Dict[str, str] = {}
    for nid, nfm in all_nodes.items():
        nkey = nfm.get("context_index", {}).get("node_key")
        if nkey:
            key_to_id[nkey] = nid

    topo = fm.get("topology", {})
    status = fm.get("status", "")

    for sup in topo.get("supersedes", []) or []:
        target_id = sup if sup in all_nodes else key_to_id.get(sup)
        if not target_id or target_id not in all_nodes:
            errors.append(f"[AS-06 Supersedes] {node_id} 宣告取代不存在的節點 ID 或定位鍵: {sup}")
            continue
        target_fm = all_nodes[target_id]
        target_status = target_fm.get("status", "")
        if target_status not in ("archived", "deprecated"):
            errors.append(
                f"[AS-06 Supersedes Conflict] {node_id} 宣告取代 {sup} ({target_id})，"
                f"但舊節點狀態仍為「{target_status}」（必須先降級為 archived 或 deprecated）。"
            )

    for conf in topo.get("conflicts_with", []) or []:
        target_id = conf if conf in all_nodes else key_to_id.get(conf)
        if not target_id or target_id not in all_nodes:
            continue
        target_fm = all_nodes[target_id]
        target_status = target_fm.get("status", "")
        if status == "verified" and target_status == "verified":
            errors.append(
                f"[AS-06 Mutual Exclusion] {node_id} 與互斥節點 {conf} ({target_id}) 不可同時處於 verified 狀態！"
            )

    return errors


def detect_unlinked_topology_references(
    node_id: str,
    fm: Dict[str, Any],
    body: str,
    all_nodes: Dict[str, Dict[str, Any]],
) -> List[str]:
    """
    Detects when an active (`verified`/`draft`) spec/audit explicitly references other `verified`
    spec/audit nodes in its Markdown body while `supersedes` and `conflicts_with` are left empty (`[]`).
    Returns human-readable reminder notices so temporary unlinked conflicts are never forgotten.
    """
    notices: List[str] = []
    status = fm.get("status", "")
    if status not in ("verified", "draft"):
        return notices

    topo = fm.get("topology", {}) or {}
    declared_refs = set(
        (topo.get("depends_on") or [])
        + (topo.get("supersedes") or [])
        + (topo.get("conflicts_with") or [])
    )

    unlinked_targets: List[str] = []
    for target_id, target_fm in sorted(all_nodes.items()):
        if target_id == node_id:
            continue
        if target_fm.get("status") != "verified":
            continue
        if target_fm.get("artifact_type") not in ("spec", "audit"):
            continue
        target_key = target_fm.get("context_index", {}).get("node_key", "")
        if target_id in declared_refs or (target_key and target_key in declared_refs):
            continue
        if target_id in body or (target_key and target_key in body):
            label = f"{target_id} ({target_key})" if target_key else target_id
            unlinked_targets.append(label)

    if unlinked_targets:
        notices.append(
            f"[AS-06 Pending Topology Alignment] 節點 {node_id} 內文提及活躍節點 {', '.join(unlinked_targets)}，"
            f"但標頭 `supersedes` / `conflicts_with` 留空尚未收斂（完成跨檔衝突測試後，請補齊 supersedes 或將舊節點降級為 archived/deprecated）。"
        )
    return notices


def generate_prescription_skeleton(
    md_path: Path,
    project_root: Path,
    fm: Dict[str, Any] | None,
) -> str:
    rel_path = str(md_path.relative_to(project_root)) if md_path.is_relative_to(project_root) else md_path.name
    node_id = (fm or {}).get("node_id", "MEM-2026-0099")
    artifact_type = (fm or {}).get("artifact_type", "spec")
    node_key = (fm or {}).get("context_index", {}).get("node_key", "300.MODULE-SPEC.v1")
    domain_code = (fm or {}).get("context_index", {}).get("domain_code", "300")
    return f"""🔧 [Prescription Skeleton | YAML 處方籤修復範本 ({rel_path})]
請直接複製以下合法 YAML Frontmatter 與三段式認知內文骨架覆寫或修補 `{rel_path}`：
```markdown
---
node_id: "{node_id}"
artifact_type: "{artifact_type}"
access_tier: "standard"
priority: "high"
status: "verified"
created_at: "2026-10-20"
updated_at: "2026-10-20"
author:
  role: "architect"
  model: "nvidia/nemotron-3-ultra-550b-a55b"
reviewer:
  role: "challenger"
  model: "deepseek-ai/deepseek-v4.1-flash"
  verdict: "APPROVED"
epistemic_profile:
  fact_count: 1
  inferred_count: 1
  hypothesis_count: 0
  unverified_count: 0
verification_oracle:
  type: "schema_check"
  command: "python3 schemas/schema_validator.py --file {rel_path}"
  expected_exit_code: 0
  falsifiable_criterion: "若 {rel_path} 未通過 Schema 驗證，則本記憶節點判定無效。"
context_index:
  domain_code: "{domain_code}"
  node_key: "{node_key}"
  facet_tags:
    - "PotoTypeV0:Architecture:Spec:Governance"
  keywords:
    - "{node_key}"
    - "Governance"
  summary_1line: "請填寫 10~160 字元之單行精準摘要，供漸進式揭露索引注入。"
topology:
  depends_on:
    - "000.SOUL.v1"
  supersedes: []
  conflicts_with: []
  verified_by:
    - "schemas/schema_validator.py"
  affected_paths:
    - "schemas/schema_validator.py"
---

# 📌 `{node_key}` ({node_id}) — 節點標題

1. `[FACT]` 客觀可驗證事實陳述（請確保數量與標頭 `fact_count` 完全一致）。
2. `[INFERRED]` 根據系統架構推導之設計結論（請確保數量與標頭 `inferred_count` 完全一致）。
```"""


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
    all_nodes: Dict[str, Dict[str, Any]] | None = None,
) -> Tuple[Dict[str, Any] | None, List[str]]:
    errors: List[str] = []
    raw_content = md_path.read_text(encoding="utf-8")

    # Stage 4: AS-05 Path Portability & Privacy Check (runs even before/alongside schema checks)
    errors.extend(check_as05_portability(raw_content))

    try:
        fm, body = parse_markdown_frontmatter(md_path)
    except Exception as exc:
        errors.append(str(exc))
        return None, errors

    # 1. Schema structure checks
    errors.extend(validate_against_schema(fm, header_schema, "ArtifactHeaderSchema"))
    errors.extend(validate_against_schema(fm, node_schema, "ContextNodeSchema"))

    # 2. Stage 4: Tiered Prose Line Budget Check
    artifact_type = fm.get("artifact_type", "")
    budget = PROSE_LINE_BUDGETS.get(artifact_type)
    prose_lines = count_prose_lines(body)
    if budget is not None and prose_lines > budget:
        errors.append(
            f"[ProseBudget] 純散文行數超標 ({prose_lines} > {budget} 行，類型={artifact_type})："
            "請將冗長文字轉化為 Markdown 表格或 Mermaid 拓撲圖以降低散文膨脹。"
        )
    if md_path.name == "LEDGER.md":
        total_lines = len(raw_content.splitlines())
        if total_lines > 80:
            errors.append(
                f"[ProseBudget / LEDGER] memory/LEDGER.md 總行數超標 ({total_lines} > 80 行)：請立即歸檔已完工項目！"
            )

    # 3. AS-01: Cross-Model Dialectical Review Check (Anti-Sycophancy)
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

    # 4. AS-02: Epistemic Tag Honesty Check
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

    # 5. AS-03: Affected Paths & Falsifiable Oracle Check
    for rel_path in fm.get("topology", {}).get("affected_paths", []):
        target = (project_root / rel_path).resolve()
        if not target.exists():
            errors.append(
                f"[AS-03 Grounding] topology.affected_paths 指向不存在的路徑: {rel_path}"
            )

    # 6. Stage 4: AS-06 Supersedes & Mutual Exclusion Check (single-file or batch)
    topo = fm.get("topology", {})
    if topo.get("supersedes") or topo.get("conflicts_with"):
        lookup_nodes = dict(all_nodes) if all_nodes is not None else load_all_memory_nodes(project_root)
        node_id = fm.get("node_id", md_path.stem)
        lookup_nodes[node_id] = fm
        errors.extend(check_as06_node_exclusivity(node_id, fm, lookup_nodes))

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
        node_status = fm.get("status", "")
        is_inactive = node_status in ("archived", "deprecated")
        for dep in fm.get("topology", {}).get("depends_on", []):
            resolved = dep if dep in known_ids else key_to_node.get(dep)
            if not resolved:
                errors.append(f"[AS-04 Topology] {node_id} 依賴不存在的節點 ID 或定位鍵: {dep}")
            elif not is_inactive:
                # Skip cycle edges involving archived/deprecated historical nodes
                target_status = nodes.get(resolved, {}).get("status", "")
                if target_status not in ("archived", "deprecated"):
                    adj[node_id].append(resolved)

        # AS-06 checks at graph level
        errors.extend(check_as06_node_exclusivity(node_id, fm, nodes))

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

    existing_nodes = load_all_memory_nodes(project_root)
    all_nodes: Dict[str, Dict[str, Any]] = {}
    total_errors = 0

    for md_file in md_files:
        rel = md_file.relative_to(project_root) if md_file.is_relative_to(project_root) else md_file
        fm, errs = validate_document(
            md_file,
            project_root,
            header_schema,
            node_schema,
            args.run_oracle,
            all_nodes=existing_nodes,
        )
        if fm and "node_id" in fm:
            all_nodes[fm["node_id"]] = fm
        if errs:
            total_errors += len(errs)
            print(f"❌ {rel}: FAILED ({len(errs)} errors)")
            for e in errs:
                print(f"   - {e}")
            print(generate_prescription_skeleton(md_file, project_root, fm))
        else:
            node_id = fm.get("node_id", "UNKNOWN") if fm else "UNKNOWN"
            node_key = fm.get("context_index", {}).get("node_key", "") if fm else ""
            status = fm.get("status", "") if fm else ""
            print(f"✅ {rel} [{node_id} | {node_key} | {status}]: PASSED")
            if fm:
                try:
                    _, body_text = parse_markdown_frontmatter(md_file)
                    lookup_for_notice = dict(existing_nodes)
                    lookup_for_notice[node_id] = fm
                    notices = detect_unlinked_topology_references(node_id, fm, body_text, lookup_for_notice)
                    for n in notices:
                        print(f"   ⚠️ {n}")
                except Exception:
                    pass

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
