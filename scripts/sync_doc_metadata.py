#!/usr/bin/env python3
"""
Friday Deterministic Hook `.md` Metadata & Topology Auto-Sync (sync_doc_metadata.py)
====================================================================================
Executed automatically by `.Friday/extensions/epistemic-gate.ts` on `write`/`edit`
of governed Markdown files in `memory/**/*.md` BEFORE `schema_validator.py`.

Implements a Two-Phase Commit architecture to eliminate mechanical framework tax
while preserving 100% of `schema_validator.py` anti-sycophancy guarantees:
  - Phase 1A (Surgical Metadata & SSOT Sync):
      * Syncs `<!-- AUTO-ROLE-MODELS:START --> ... <!-- AUTO-ROLE-MODELS:END -->` blocks
        from `.Friday/role-models.json` if present in the Markdown body.
      * Scans the Markdown body with `schema_validator.EPISTEMIC_TAGS` and surgically
        updates `fact_count`, `inferred_count`, `hypothesis_count`, `unverified_count`,
        and `updated_at` in raw YAML frontmatter without altering key order, quotes,
        indentation, or inline YAML comments.
  - Phase 1B (Pre-Flight Validation):
      * Validates the edited file via `schema_validator.validate_document()` (ignoring
        only pending `[AS-06 Supersedes Conflict]` errors that Phase 2 will resolve).
      * If any blocking error exists (`AS-01`, `AS-02 [UNVERIFIED]`, `AS-03`, `AS-05`,
        `ProseBudget`), Phase 2 is strictly ABORTED so no active target spec is
        prematurely deprecated.
  - Phase 2 (Atomic `supersedes` Auto-Deprecation & Deadlock Healing):
      * Only when the edited file has `status == "verified"` and 0 blocking errors,
        automatically transitions any active (`verified`/`draft`) target listed in
        `topology.supersedes` to `status: "deprecated"`, and removes any accidental
        reverse `supersedes` back-references from the deprecated target.
"""

from __future__ import annotations

import argparse
import datetime
import json
import re
import sys
from pathlib import Path
from typing import Any, Dict, List, Tuple

SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT_DEFAULT = SCRIPT_DIR.parent
sys.path.insert(0, str(PROJECT_ROOT_DEFAULT / "schemas"))

import schema_validator as sv  # type: ignore

ROLE_MODELS_MARKER_RE = re.compile(
    r"<!-- AUTO-ROLE-MODELS:START -->.*?<!-- AUTO-ROLE-MODELS:END -->",
    re.DOTALL,
)


def split_frontmatter_raw(content: str) -> Tuple[str, str]:
    """Splits Markdown into (raw_frontmatter, body) without altering formatting."""
    if not content.startswith("---\n"):
        raise ValueError("Missing YAML frontmatter opening '---'")
    parts = content.split("\n---\n", 1)
    if len(parts) != 2:
        raise ValueError("Missing YAML frontmatter closing '---'")
    return parts[0][4:], parts[1]


def surgical_set_scalar(raw_fm: str, key: str, new_value_str: str) -> str:
    """
    Replaces `key: <old_value>` in raw YAML frontmatter while preserving:
    - Leading indentation
    - Quotes (if new_value_str includes quotes or matches existing style)
    - Inline YAML comments (`# ...`)
    - Key ordering of the rest of the file
    """
    pattern = re.compile(rf"(?m)^([ \t]*{re.escape(key)}:[ \t]*)([^\n#]+?)([ \t]*(?:#[^\r\n]*)?)$")

    def repl(match: re.Match[str]) -> str:
        prefix, old_val, suffix = match.group(1), match.group(2).strip(), match.group(3)
        if (
            not (new_value_str.startswith('"') or new_value_str.startswith("'"))
            and not new_value_str.isdigit()
            and old_val.startswith('"')
            and old_val.endswith('"')
        ):
            formatted = f'"{new_value_str}"'
        else:
            formatted = new_value_str
        return f"{prefix}{formatted}{suffix}"

    updated, count = pattern.subn(repl, raw_fm, count=1)
    if count == 0:
        raise KeyError(f"Key '{key}' not found in frontmatter")
    return updated


def surgical_remove_from_yaml_list(raw_fm: str, list_key: str, item_to_remove: str) -> str:
    """
    Surgically removes `item_to_remove` from a YAML list `list_key:` in `raw_fm`
    (handling both block list `- "item"` and inline list `["item"]` formats)
    without stripping trailing newlines or inline comments.
    """
    inline_pat = re.compile(rf"(?m)^([ \t]*{re.escape(list_key)}:[ \t]*\[)([^\]]*)(\][ \t]*(?:#[^\r\n]*)?)$")
    m_inline = inline_pat.search(raw_fm)
    if m_inline:
        items_raw = [x.strip() for x in m_inline.group(2).split(",") if x.strip()]
        kept = [x for x in items_raw if x.strip("\"'") != item_to_remove]
        return inline_pat.sub(rf"\g<1>{', '.join(kept)}\g<3>", raw_fm, count=1)

    lines = raw_fm.splitlines(keepends=True)
    out_lines: List[str] = []
    in_target_list = False
    list_indent = 0
    removed_any = False
    list_header_idx = -1
    remaining_block_items = 0

    for line in lines:
        stripped = line.strip()
        indent = len(line) - len(line.lstrip(" "))
        if not in_target_list:
            m_hdr = re.match(rf"^([ \t]*){re.escape(list_key)}:[ \t]*(?:#[^\r\n]*)?\r?\n?$", line)
            if m_hdr:
                in_target_list = True
                list_indent = len(m_hdr.group(1))
                list_header_idx = len(out_lines)
                remaining_block_items = 0
            out_lines.append(line)
        else:
            if stripped.startswith("- ") and indent > list_indent:
                val = stripped[2:].split("#", 1)[0].strip().strip("\"'")
                if val == item_to_remove:
                    removed_any = True
                    continue
                else:
                    remaining_block_items += 1
                    out_lines.append(line)
            elif not stripped or stripped.startswith("#"):
                out_lines.append(line)
            else:
                in_target_list = False
                if removed_any and remaining_block_items == 0 and list_header_idx >= 0:
                    out_lines[list_header_idx] = re.sub(
                        rf"^([ \t]*{re.escape(list_key)}:)[ \t]*((?:#[^\r\n]*)?\r?\n?)$",
                        r"\1 []\2",
                        out_lines[list_header_idx],
                    )
                out_lines.append(line)

    if in_target_list and removed_any and remaining_block_items == 0 and list_header_idx >= 0:
        out_lines[list_header_idx] = re.sub(
            rf"^([ \t]*{re.escape(list_key)}:)[ \t]*((?:#[^\r\n]*)?\r?\n?)$",
            r"\1 []\2",
            out_lines[list_header_idx],
        )

    return "".join(out_lines)


def render_role_models_ssot_block(project_root: Path) -> str | None:
    role_models_path = project_root / ".Friday" / "role-models.json"
    if not role_models_path.exists():
        return None
    try:
        rm_data = json.loads(role_models_path.read_text(encoding="utf-8"))
        table_lines = [
            "<!-- AUTO-ROLE-MODELS:START -->",
            "| 角色 (Role) | 當前綁定模型 (`.Friday/role-models.json` SSOT) |",
            "| :--- | :--- |",
        ]
        for role_key in (
            "orchestrator",
            "scout",
            "architect",
            "challenger",
            "code",
            "audit",
            "vision",
            "strategyMode",
        ):
            if role_key in rm_data:
                table_lines.append(f"| `{role_key}` | `{rm_data[role_key]}` |")
        table_lines.append("<!-- AUTO-ROLE-MODELS:END -->")
        return "\n".join(table_lines)
    except Exception:
        return None


def compute_actual_epistemic_counts(body: str) -> Dict[str, int]:
    """Uses the exact same regexes as schema_validator.EPISTEMIC_TAGS."""
    return {
        key: len(pattern.findall(body))
        for key, pattern in sv.EPISTEMIC_TAGS.items()
    }


def load_all_node_paths(project_root: Path) -> Tuple[Dict[str, Path], Dict[str, str], Dict[str, Dict[str, Any]]]:
    memory_dir = project_root / "memory"
    id_to_path: Dict[str, Path] = {}
    key_to_id: Dict[str, str] = {}
    all_nodes: Dict[str, Dict[str, Any]] = {}

    if not memory_dir.exists():
        return id_to_path, key_to_id, all_nodes

    for p in sorted(memory_dir.rglob("*.md")):
        if p.name == "CONTEXT_MAP.md":
            continue
        try:
            fm, _ = sv.parse_markdown_frontmatter(p)
            if isinstance(fm, dict) and "node_id" in fm:
                nid = fm["node_id"]
                id_to_path[nid] = p
                all_nodes[nid] = fm
                nkey = fm.get("context_index", {}).get("node_key")
                if nkey:
                    key_to_id[nkey] = nid
        except Exception:
            continue
    return id_to_path, key_to_id, all_nodes


def sync_governed_markdown(
    md_path: Path,
    project_root: Path,
    today_str: str | None = None,
) -> Dict[str, Any]:
    if today_str is None:
        today_str = datetime.date.today().isoformat()

    result: Dict[str, Any] = {
        "file": str(md_path),
        "counts_updated": False,
        "ssot_table_updated": False,
        "old_counts": {},
        "new_counts": {},
        "deprecated_targets": [],
        "phase1_errors": [],
        "phase2_aborted": False,
    }

    if not md_path.exists():
        result["phase2_aborted"] = True
        return result

    raw_content = md_path.read_text(encoding="utf-8")
    try:
        raw_fm, body = split_frontmatter_raw(raw_content)
        fm, _ = sv.parse_markdown_frontmatter(md_path)
    except Exception as exc:
        result["phase1_errors"] = [str(exc)]
        result["phase2_aborted"] = True
        return result

    # --- Phase 1A: SSOT Role-Models Block & Epistemic Tag Count Auto-Sync ---
    new_body = body
    if ROLE_MODELS_MARKER_RE.search(new_body):
        rendered_block = render_role_models_ssot_block(project_root)
        if rendered_block:
            replaced_body = ROLE_MODELS_MARKER_RE.sub(rendered_block, new_body)
            if replaced_body != new_body:
                new_body = replaced_body
                result["ssot_table_updated"] = True

    actual_counts = compute_actual_epistemic_counts(new_body)
    declared_profile = fm.get("epistemic_profile", {}) or {}
    result["old_counts"] = {k: declared_profile.get(k) for k in sv.EPISTEMIC_TAGS}
    result["new_counts"] = actual_counts

    new_raw_fm = raw_fm
    counts_changed = False
    for key, actual_val in actual_counts.items():
        if declared_profile.get(key) != actual_val:
            try:
                new_raw_fm = surgical_set_scalar(new_raw_fm, key, str(actual_val))
                counts_changed = True
            except KeyError:
                pass

    date_changed = False
    if str(fm.get("created_at", "")) > today_str:
        try:
            new_raw_fm = surgical_set_scalar(new_raw_fm, "created_at", today_str)
            date_changed = True
        except KeyError:
            pass

    if counts_changed or result["ssot_table_updated"] or date_changed or str(fm.get("updated_at", "")) != today_str:
        try:
            new_raw_fm = surgical_set_scalar(new_raw_fm, "updated_at", today_str)
        except KeyError:
            pass
        md_path.write_text(f"---\n{new_raw_fm}\n---\n{new_body}", encoding="utf-8")
        result["counts_updated"] = counts_changed

    # --- Phase 1B: Pre-Flight Validation Before Mutating Any Superseded Target ---
    schemas_dir = project_root / "schemas"
    header_schema = json.loads((schemas_dir / "artifact_header.schema.json").read_text(encoding="utf-8"))
    node_schema = json.loads((schemas_dir / "context_node.schema.json").read_text(encoding="utf-8"))

    id_to_path, key_to_id, all_nodes = load_all_node_paths(project_root)
    fm_after, errs = sv.validate_document(
        md_path,
        project_root,
        header_schema,
        node_schema,
        run_oracle=False,
        all_nodes=all_nodes,
    )

    blocking_errs = [
        e for e in errs
        if not e.startswith("[AS-06 Supersedes Conflict]")
    ]
    result["phase1_errors"] = blocking_errs

    if blocking_errs or not fm_after:
        result["phase2_aborted"] = True
        return result

    # --- Phase 2: Atomic Deprecation of `supersedes` Targets ---
    status = fm_after.get("status", "")
    this_node_id = fm_after.get("node_id", "")
    this_node_key = (fm_after.get("context_index", {}) or {}).get("node_key", "")
    supersedes_list = (fm_after.get("topology", {}) or {}).get("supersedes", []) or []

    if status == "verified" and supersedes_list:
        for sup_ref in supersedes_list:
            target_id = sup_ref if sup_ref in id_to_path else key_to_id.get(sup_ref)
            if not target_id or target_id not in id_to_path:
                continue
            target_path = id_to_path[target_id]
            target_fm = all_nodes.get(target_id, {})
            target_status = target_fm.get("status", "")
            t_raw = target_path.read_text(encoding="utf-8")
            t_raw_fm, t_body = split_frontmatter_raw(t_raw)
            t_modified = False

            if target_status not in ("archived", "deprecated"):
                t_raw_fm = surgical_set_scalar(t_raw_fm, "status", "deprecated")
                t_modified = True

            target_sups = (target_fm.get("topology", {}) or {}).get("supersedes", []) or []
            for rev_ref in (this_node_id, this_node_key):
                if rev_ref and rev_ref in target_sups:
                    t_raw_fm = surgical_remove_from_yaml_list(t_raw_fm, "supersedes", rev_ref)
                    t_modified = True

            if t_modified:
                try:
                    t_raw_fm = surgical_set_scalar(t_raw_fm, "updated_at", today_str)
                except KeyError:
                    pass
                target_path.write_text(f"---\n{t_raw_fm}\n---\n{t_body}", encoding="utf-8")
                result["deprecated_targets"].append({
                    "node_id": target_id,
                    "path": str(target_path.relative_to(project_root)),
                    "old_status": target_status,
                    "new_status": "deprecated",
                })

    return result


def main() -> int:
    parser = argparse.ArgumentParser(description="Deterministic Hook Metadata & Topology Sync for Friday Memory Nodes.")
    parser.add_argument("--project-root", default=".", help="Project root directory")
    parser.add_argument("--file", required=True, help="Target governed Markdown file to sync")
    args = parser.parse_args()

    project_root = Path(args.project_root).resolve()
    md_path = Path(args.file).resolve()
    res = sync_governed_markdown(md_path, project_root)

    rel = md_path.relative_to(project_root) if md_path.is_relative_to(project_root) else md_path
    msgs: List[str] = []
    if res.get("counts_updated"):
        msgs.append(
            f"🔄 [Hook Auto-Sync] 已自動校正 `{rel}` 之 `epistemic_profile` 標籤計數: "
            f"{res['old_counts']} -> {res['new_counts']}"
        )
    if res.get("ssot_table_updated"):
        msgs.append(f"🔄 [Hook Auto-Sync] 已由 `.Friday/role-models.json` 自動同步 `{rel}` 內之 SSOT 角色模型表")
    for dep in res.get("deprecated_targets", []):
        msgs.append(
            f"🔄 [Hook Auto-Supersede] 因應 `{rel}` 宣告 `supersedes`，已自動將舊節點 "
            f"`{dep['node_id']}` (`{dep['path']}`) 狀態由 `{dep['old_status']}` 降級為 `deprecated`"
        )

    if msgs:
        print("\n".join(msgs))
    return 0


if __name__ == "__main__":
    sys.exit(main())
