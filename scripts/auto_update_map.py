#!/usr/bin/env python3
"""
Friday Context Index & Topology Map Compiler (auto_update_map.py)
=================================================================
Scans all governed memory nodes in `memory/`,
1. Automatically heals broken relative Markdown links (`heal_dead_links`),
2. Scans Python (`ast`) and TypeScript (`import`) code dependencies (`scan_code_dependencies`),
3. Compiles `memory/index/CONTEXT_INDEX.json` (Progressive Disclosure Index),
4. Renders `memory/codex/CONTEXT_MAP.md` for Agentic Context Engineering.
"""

from __future__ import annotations

import ast
import hashlib
import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "schemas"))
from schema_validator import detect_unlinked_topology_references, parse_markdown_frontmatter  # type: ignore

DEFAULT_DOMAIN_LAYERS = {
    "000": "000 核心憲法與認知規範 (Core Constitution & Epistemic Rules)",
    "100": "100 安全邊界與工作區護欄 (Workspace Boundary & Security Guard)",
    "200": "200 架構決策與跨模型審查 (Architecture Decisions & Cross-Review)",
    "300": "300 核心領域邏輯與模組 (Core Domain Modules)",
    "310": "310 知識庫 Wiki 與圖譜筆記 (Library Wiki & Knowledge Graph Notes)",
    "320": "320 領域工作流程與標準作業程序 (Domain Workflows & SOPs)",
    "330": "330 領域詞彙表與本體庫 (Domain Glossaries & Ontologies)",
    "400": "400 工具鏈、Hooks 與擴充套件 (Tools, Hooks & Extensions)",
    "500": "500 動態模型路由與子代理編排 (Model Routing & Subagents)",
    "510": "510 模型池與路由策略 (Model Pool & Routing Strategy)",
    "600": "600 驗證斷言、測試與安全稽核 (Verification Oracles & Audits)",
    "700": "700 可攜式部署與容器封裝 (Portable Brain & Containerization)",
    "800": "800 外部規格與參考文獻 (External Specs & References)",
    "900": "900 歷史封存節點 (Archived & Superseded Nodes)",
}


def load_domain_layers(project_root: Path) -> Dict[str, str]:
    tax_path = project_root / "memory" / "index" / "TAXONOMY.json"
    if tax_path.exists():
        try:
            data = json.loads(tax_path.read_text(encoding="utf-8"))
            domains = data.get("domains", {})
            layers: Dict[str, str] = {}
            for k, v in domains.items():
                title = v.get("title", k) if isinstance(v, dict) else str(v)
                layers[k] = f"{k} {title}"
            for k, v in DEFAULT_DOMAIN_LAYERS.items():
                if k not in layers:
                    layers[k] = v
            return layers
        except Exception:
            pass
    return dict(DEFAULT_DOMAIN_LAYERS)


DOMAIN_LAYERS = dict(DEFAULT_DOMAIN_LAYERS)

OFFICIAL_TYPES = {"constitution", "rule", "adr", "spec", "audit"}
WIKI_TYPES = {"wiki", "note", "sop", "glossary", "digest"}
WIKILINK_RE = re.compile(r"\[\[([A-Za-z0-9_.-]+)(?:\|[^\]]+)?\]\]")


def extract_wikilinks_outside_fenced_blocks(body: str) -> List[str]:
    links: List[str] = []
    in_fence = False
    for line in body.splitlines():
        trimmed = line.strip()
        if trimmed.startswith("```"):
            in_fence = not in_fence
            continue
        if in_fence:
            continue
        for match in WIKILINK_RE.finditer(line):
            links.append(match.group(1))
    return sorted(list(set(links)))


MD_LINK_PATTERN = re.compile(r"(\[[^\]]+\]\()([^)\s]+)(\))")
TS_IMPORT_PATTERN = re.compile(r"""(?m)^\s*import\s+(?:type\s+)?(?:[^"']+from\s+)?["']([^"']+)["']""")


def sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()[:16]


def heal_dead_links(project_root: Path, md_files: List[Path]) -> List[Dict[str, str]]:
    """
    Stage 5: Scans Markdown files in `memory/` for broken relative links `[label](rel/path.md)`.
    If a target file was moved within the workspace, automatically rewrites the link in place.
    """
    healed_records: List[Dict[str, str]] = []

    # Build lookup table of basename -> list of Paths inside project_root
    basename_map: Dict[str, List[Path]] = {}
    for root_sub in ("memory", ".Friday", "schemas", "scripts"):
        sub_dir = project_root / root_sub
        if not sub_dir.exists():
            continue
        for p in sub_dir.rglob("*"):
            if p.is_file():
                basename_map.setdefault(p.name, []).append(p)

    for md_path in md_files:
        raw_text = md_path.read_text(encoding="utf-8")
        lines = raw_text.splitlines(keepends=True)
        in_fence = False
        modified = False
        new_lines: List[str] = []

        for line in lines:
            if line.strip().startswith("```"):
                in_fence = not in_fence
                new_lines.append(line)
                continue
            if in_fence:
                new_lines.append(line)
                continue

            def _replace_link(match: re.Match[str]) -> str:
                nonlocal modified
                prefix, raw_target, suffix = match.group(1), match.group(2), match.group(3)
                if raw_target.startswith(("http://", "https://", "mailto:", "#", "file://")):
                    return match.group(0)
                target_no_anchor = raw_target.split("#", 1)[0]
                anchor = ("#" + raw_target.split("#", 1)[1]) if "#" in raw_target else ""
                if not target_no_anchor:
                    return match.group(0)

                resolved = (md_path.parent / target_no_anchor).resolve()
                if resolved.exists():
                    return match.group(0)

                base_name = Path(target_no_anchor).name
                candidates = basename_map.get(base_name, [])
                if len(candidates) == 1:
                    found_path = candidates[0]
                    healed_rel = os.path.relpath(found_path, md_path.parent).replace("\\", "/") + anchor
                    modified = True
                    healed_records.append(
                        {
                            "file": str(md_path.relative_to(project_root)),
                            "old_target": raw_target,
                            "new_target": healed_rel,
                        }
                    )
                    return f"{prefix}{healed_rel}{suffix}"
                return match.group(0)

            new_lines.append(MD_LINK_PATTERN.sub(_replace_link, line))

        if modified:
            md_path.write_text("".join(new_lines), encoding="utf-8")

    return healed_records


def scan_code_dependencies(project_root: Path) -> List[Dict[str, str]]:
    """
    Stage 5: Parses Python files via `ast.parse` and TypeScript files via import regex
    to build a machine-readable code dependency graph across `schemas/`, `scripts/`, and `.Friday/extensions/`.
    """
    code_edges: List[Dict[str, str]] = []
    py_module_map: Dict[str, str] = {}

    for sub in ("schemas", "scripts"):
        d = project_root / sub
        if d.exists():
            for py_file in sorted(d.rglob("*.py")):
                py_module_map[py_file.stem] = str(py_file.relative_to(project_root))

    for sub in ("schemas", "scripts"):
        d = project_root / sub
        if not d.exists():
            continue
        for py_file in sorted(d.rglob("*.py")):
            src_rel = str(py_file.relative_to(project_root))
            try:
                tree = ast.parse(py_file.read_text(encoding="utf-8"), filename=src_rel)
            except Exception:
                continue
            seen_targets = set()
            for node in ast.walk(tree):
                if isinstance(node, ast.Import):
                    for alias in node.names:
                        top_mod = alias.name.split(".")[0]
                        if top_mod in py_module_map and py_module_map[top_mod] != src_rel:
                            target = py_module_map[top_mod]
                            if target not in seen_targets:
                                seen_targets.add(target)
                                code_edges.append({"from": src_rel, "to": target, "type": "py_import"})
                elif isinstance(node, ast.ImportFrom) and node.module:
                    top_mod = node.module.split(".")[0]
                    if top_mod in py_module_map and py_module_map[top_mod] != src_rel:
                        target = py_module_map[top_mod]
                        if target not in seen_targets:
                            seen_targets.add(target)
                            code_edges.append({"from": src_rel, "to": target, "type": "py_from_import"})

    ext_dir = project_root / ".Friday" / "extensions"
    if ext_dir.exists():
        for ts_file in sorted(ext_dir.rglob("*.ts")):
            src_rel = str(ts_file.relative_to(project_root))
            raw_ts = ts_file.read_text(encoding="utf-8")
            seen_targets = set()
            for m in TS_IMPORT_PATTERN.finditer(raw_ts):
                spec = m.group(1)
                if spec.startswith("."):
                    candidate = (ts_file.parent / spec).resolve()
                    if candidate.suffix in (".js", ".mjs"):
                        ts_cand = candidate.with_suffix(".ts")
                        if ts_cand.exists():
                            candidate = ts_cand
                    elif not candidate.suffix and candidate.with_suffix(".ts").exists():
                        candidate = candidate.with_suffix(".ts")
                    if candidate.exists() and candidate.is_relative_to(project_root):
                        target = str(candidate.relative_to(project_root))
                        if target not in seen_targets:
                            seen_targets.add(target)
                            code_edges.append({"from": src_rel, "to": target, "type": "ts_local_import"})
                elif spec.startswith("@earendil-works/") or spec.startswith("@sinclair/"):
                    if spec not in seen_targets:
                        seen_targets.add(spec)
                        code_edges.append({"from": src_rel, "to": spec, "type": "ts_sdk_import"})

    return code_edges


TS_EXPORT_SYMBOL_RE = re.compile(
    r"^\s*export\s+(?:default\s+)?(?:async\s+)?(function|class|const|interface|type)\s+([A-Za-z0-9_]+)"
)
TS_REGISTER_COMMAND_RE = re.compile(r"""pi\.registerCommand\(\s*["']([^"']+)["']""")
TS_REGISTER_TOOL_RE = re.compile(r"""pi\.registerTool\(\s*\{[\s\S]*?name\s*:\s*["']([^"']+)["']""")
TS_ON_HOOK_RE = re.compile(r"""pi\.on\(\s*["']([^"']+)["']""")


def build_code_intelligence_map(
    project_root: Path,
    entries: List[Dict[str, Any]],
    code_dependency_edges: List[Dict[str, str]],
) -> Dict[str, Dict[str, Any]]:
    """Build AST symbol coordinates, Pi hook/command/tool registrations, impact circles, and governing specs."""
    intel_map: Dict[str, Dict[str, Any]] = {}

    prompts_dir = project_root / ".Friday" / "prompts"
    prompt_commands = {
        p.stem for p in prompts_dir.glob("*.md")
    } if prompts_dir.exists() else set()

    py_files: List[Path] = []
    for folder in ("schemas", "scripts"):
        d = project_root / folder
        if d.exists():
            py_files.extend(sorted(d.glob("*.py")))

    for py_file in py_files:
        rel_path = str(py_file.relative_to(project_root))
        symbols: List[Dict[str, Any]] = []
        try:
            source = py_file.read_text(encoding="utf-8")
            tree = ast.parse(source, filename=str(py_file))
            for node in tree.body:
                if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    symbols.append({
                        "name": node.name,
                        "kind": "function",
                        "line_start": getattr(node, "lineno", 1),
                        "line_end": getattr(node, "end_lineno", getattr(node, "lineno", 1)),
                    })
                elif isinstance(node, ast.ClassDef):
                    symbols.append({
                        "name": node.name,
                        "kind": "class",
                        "line_start": getattr(node, "lineno", 1),
                        "line_end": getattr(node, "end_lineno", getattr(node, "lineno", 1)),
                    })
        except Exception:
            pass
        intel_map[rel_path] = {
            "file_path": rel_path,
            "language": "python",
            "symbols": symbols,
            "pi_registrations": [],
            "command_conflicts": [],
            "imports": [],
            "imported_by": [],
            "governing_specs": [],
        }

    ext_dir = project_root / ".Friday" / "extensions"
    if ext_dir.exists():
        for ts_file in sorted(ext_dir.rglob("*.ts")):
            rel_path = str(ts_file.relative_to(project_root))
            symbols = []
            pi_registrations: List[Dict[str, Any]] = []
            command_conflicts: List[str] = []
            try:
                source = ts_file.read_text(encoding="utf-8")
                lines = source.splitlines()
                for idx, line in enumerate(lines, start=1):
                    if line.lstrip().startswith("//"):
                        continue
                    m_sym = TS_EXPORT_SYMBOL_RE.match(line)
                    if m_sym:
                        symbols.append({
                            "name": m_sym.group(2),
                            "kind": m_sym.group(1),
                            "line_start": idx,
                            "line_end": idx,
                        })
                    for m_cmd in TS_REGISTER_COMMAND_RE.finditer(line):
                        cmd_name = m_cmd.group(1)
                        pi_registrations.append({
                            "kind": "command",
                            "name": f"/{cmd_name}",
                            "line": idx,
                        })
                        if cmd_name in prompt_commands:
                            command_conflicts.append(
                                f"/{cmd_name} shadows .Friday/prompts/{cmd_name}.md (L{idx})"
                            )
                    for m_hook in TS_ON_HOOK_RE.finditer(line):
                        pi_registrations.append({
                            "kind": "hook",
                            "name": m_hook.group(1),
                            "line": idx,
                        })
                for m_tool in TS_REGISTER_TOOL_RE.finditer(source):
                    tool_line = source[: m_tool.start()].count("\n") + 1
                    pi_registrations.append({
                        "kind": "tool",
                        "name": m_tool.group(1),
                        "line": tool_line,
                    })
            except Exception:
                pass
            intel_map[rel_path] = {
                "file_path": rel_path,
                "language": "typescript",
                "symbols": symbols,
                "pi_registrations": sorted(pi_registrations, key=lambda x: (x["line"], x["name"])),
                "command_conflicts": command_conflicts,
                "imports": [],
                "imported_by": [],
                "governing_specs": [],
            }

    for edge in code_dependency_edges:
        src = edge.get("from", "")
        dst = edge.get("to", "")
        if src in intel_map and dst and dst not in intel_map[src]["imports"]:
            intel_map[src]["imports"].append(dst)
        if dst in intel_map and src and src not in intel_map[dst]["imported_by"]:
            intel_map[dst]["imported_by"].append(src)

    for entry in entries:
        node_id = str(entry.get("node_id") or entry.get("id") or "")
        node_key = str(entry.get("node_key") or "")
        node_title = str(entry.get("summary_1line") or entry.get("title") or "")
        node_path = str(entry.get("path") or entry.get("file_path") or "")
        for aff in entry.get("affected_paths", []) or []:
            aff_str = str(aff).strip()
            if not aff_str:
                continue
            for code_path, info in intel_map.items():
                if (
                    code_path == aff_str
                    or code_path.startswith(aff_str.rstrip("/") + "/")
                    or aff_str.endswith(Path(code_path).name)
                ):
                    spec_ref = {
                        "node_id": node_id,
                        "node_key": node_key,
                        "summary_1line": node_title,
                        "path": node_path,
                    }
                    if spec_ref not in info["governing_specs"]:
                        info["governing_specs"].append(spec_ref)

    return intel_map


def is_private_memory_path(project_root: Path, md_path: Path) -> bool:
    rel_parts = md_path.relative_to(project_root).parts
    return "private" in rel_parts


def _compile_index_subset(
    project_root: Path,
    subset_files: List[Path],
    all_nodes_fm: Dict[str, Dict[str, Any]],
    key_to_id: Dict[str, str],
    healed_links: List[Dict[str, str]],
    code_dependency_edges: List[Dict[str, str]],
) -> Dict[str, Any]:
    domain_layers = load_domain_layers(project_root)
    entries: List[Dict[str, Any]] = []
    by_domain: Dict[str, List[Dict[str, Any]]] = {k: [] for k in domain_layers}
    edges: List[Dict[str, str]] = []
    subset_fm: Dict[str, Dict[str, Any]] = {}
    body_by_id: Dict[str, str] = {}
    path_by_id: Dict[str, str] = {}

    subset_key_to_id: Dict[str, str] = {}
    subset_id_to_key: Dict[str, str] = {}
    raw_parsed_nodes: List[Dict[str, Any]] = []

    for md_path in subset_files:
        rel_path = str(md_path.relative_to(project_root))
        try:
            fm, body = parse_markdown_frontmatter(md_path)
        except Exception as exc:
            print(f"⚠️ Skipping unparseable file {rel_path}: {exc}", file=sys.stderr)
            continue

        idx = fm.get("context_index", {}) if isinstance(fm.get("context_index"), dict) else {}
        topo = fm.get("topology", {}) if isinstance(fm.get("topology"), dict) else {}
        domain = idx.get("domain_code", "000")
        src_id = fm.get("node_id", rel_path)
        node_key = idx.get("node_key")

        if src_id:
            if node_key:
                subset_key_to_id[node_key] = src_id
                subset_id_to_key[src_id] = node_key

        raw_parsed_nodes.append({
            "md_path": md_path,
            "rel_path": rel_path,
            "fm": fm,
            "body": body,
            "domain": domain,
            "src_id": src_id,
            "node_key": node_key,
            "idx": idx,
            "topo": topo,
        })

    outbound_by_node: Dict[str, List[str]] = {}
    backlinks_map: Dict[str, List[str]] = {}

    for node in raw_parsed_nodes:
        src_id = node["src_id"]
        src_key = node["node_key"]
        canonical_src = src_key if src_key else src_id
        extracted_tokens = extract_wikilinks_outside_fenced_blocks(node["body"])

        resolved_outbound: List[str] = []
        for token in extracted_tokens:
            if token in subset_key_to_id:
                resolved_outbound.append(token)
                target_key = token
                target_id = subset_key_to_id[token]
            elif token in subset_id_to_key:
                target_key = subset_id_to_key[token]
                target_id = token
                resolved_outbound.append(target_key)
            else:
                continue

            backlinks_map.setdefault(target_key, []).append(canonical_src)
            backlinks_map.setdefault(target_id, []).append(canonical_src)

        outbound_by_node[src_id] = sorted(list(set(resolved_outbound)))

    for node in raw_parsed_nodes:
        md_path = node["md_path"]
        rel_path = node["rel_path"]
        fm = node["fm"]
        body = node["body"]
        domain = node["domain"]
        src_id = node["src_id"]
        node_key = node["node_key"]
        idx = node["idx"]
        topo = node["topo"]

        artifact_type = fm.get("artifact_type", "wiki")
        inferred_track = "official" if artifact_type in OFFICIAL_TYPES else "wiki"
        artifact_track = fm.get("artifact_track") or idx.get("artifact_track") or topo.get("artifact_track") or inferred_track

        subdomain = fm.get("subdomain") or idx.get("subdomain") or topo.get("subdomain")
        if not subdomain and domain and domain not in ("000", "100", "200", "300", "400", "500", "600", "700", "800", "900"):
            subdomain = domain

        outbound_links = outbound_by_node.get(src_id, [])
        node_backlinks = sorted(list(set(
            backlinks_map.get(src_id, []) + (backlinks_map.get(node_key, []) if node_key else [])
        )))

        entry = {
            "node_id": fm.get("node_id"),
            "artifact_type": artifact_type,
            "status": fm.get("status"),
            "access_tier": fm.get("access_tier"),
            "priority": fm.get("priority"),
            "domain_code": domain,
            "subdomain": subdomain,
            "artifact_track": artifact_track,
            "outbound_links": outbound_links,
            "backlinks": node_backlinks,
            "node_key": node_key,
            "facet_tags": idx.get("facet_tags", []),
            "keywords": idx.get("keywords", []),
            "summary_1line": idx.get("summary_1line", ""),
            "path": rel_path,
            "sha256_16": sha256_file(md_path),
            "author_model": fm.get("author", {}).get("model") if isinstance(fm.get("author"), dict) else None,
            "reviewer_model": fm.get("reviewer", {}).get("model") if isinstance(fm.get("reviewer"), dict) else None,
            "depends_on": topo.get("depends_on", []) if isinstance(topo, dict) else [],
            "affected_paths": topo.get("affected_paths", []) if isinstance(topo, dict) else [],
        }
        entries.append(entry)
        by_domain.setdefault(domain, []).append(entry)

        subset_fm[src_id] = fm
        body_by_id[src_id] = body
        path_by_id[src_id] = rel_path

    for entry in entries:
        src_id = entry["node_id"]
        for dep in entry.get("depends_on", []):
            edges.append({"from": src_id, "to": key_to_id.get(dep, dep), "relation": "depends_on"})

    for src_id, fm in subset_fm.items():
        topo = fm.get("topology", {}) if isinstance(fm.get("topology"), dict) else {}
        for sup in topo.get("supersedes", []):
            edges.append({"from": src_id, "to": key_to_id.get(sup, sup), "relation": "supersedes"})

    pending_topology_alignments: List[Dict[str, Any]] = []
    for src_id, fm in sorted(subset_fm.items()):
        body = body_by_id.get(src_id, "")
        notices = detect_unlinked_topology_references(src_id, fm, body, subset_fm)
        if not notices:
            continue
        topo = fm.get("topology", {}) or {}
        declared_refs = set(
            (topo.get("depends_on") or [])
            + (topo.get("supersedes") or [])
            + (topo.get("conflicts_with") or [])
        )
        unlinked_targets: List[str] = []
        for target_id, target_fm in sorted(subset_fm.items()):
            if target_id == src_id or target_fm.get("status") != "verified":
                continue
            if target_fm.get("artifact_type") not in ("spec", "audit"):
                continue
            target_key = target_fm.get("context_index", {}).get("node_key", "")
            if target_id in declared_refs or (target_key and target_key in declared_refs):
                continue
            if target_id in body or (target_key and target_key in body):
                unlinked_targets.append(f"{target_id} ({target_key})" if target_key else target_id)
        if unlinked_targets:
            pending_topology_alignments.append(
                {
                    "source_node_id": src_id,
                    "source_node_key": fm.get("context_index", {}).get("node_key", ""),
                    "source_path": path_by_id.get(src_id, ""),
                    "unlinked_targets": unlinked_targets,
                }
            )

    domain_stats = {
        code: len(by_domain.get(code, []))
        for code in domain_layers
    }

    return {
        "schema_version": "2.2.0",
        "project": project_root.name,
        "harness": "Friday",
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "total_nodes": len(entries),
        "healed_links": healed_links,
        "pending_topology_alignments": pending_topology_alignments,
        "domain_stats": domain_stats,
        "domain_registry": {
            code: {
                "title": title,
                "count": len(by_domain.get(code, [])),
                "items": by_domain.get(code, []),
            }
            for code, title in domain_layers.items()
        },
        "causal_topology_edges": edges,
        "code_dependency_edges": code_dependency_edges,
        "code_intelligence_map": (
            build_code_intelligence_map(project_root, entries, code_dependency_edges)
            if code_dependency_edges
            else {}
        ),
    }


def build_context_index(project_root: Path) -> Dict[str, Any]:
    public_index, _ = build_public_and_private_indices(project_root)
    return public_index


def build_public_and_private_indices(project_root: Path) -> tuple[Dict[str, Any], Dict[str, Any]]:
    memory_dir = project_root / "memory"
    md_files = sorted(
        p for p in memory_dir.rglob("*.md")
        if p.name not in ("CONTEXT_MAP.md", "LEDGER.md")
    )

    healed_links = heal_dead_links(project_root, md_files)
    code_dependency_edges = scan_code_dependencies(project_root)

    all_nodes_fm: Dict[str, Dict[str, Any]] = {}
    key_to_id: Dict[str, str] = {}
    public_files: List[Path] = []
    private_files: List[Path] = []

    for md_path in md_files:
        if is_private_memory_path(project_root, md_path):
            private_files.append(md_path)
        else:
            public_files.append(md_path)
        try:
            fm, _ = parse_markdown_frontmatter(md_path)
            nid = fm.get("node_id")
            nkey = fm.get("context_index", {}).get("node_key") if isinstance(fm.get("context_index"), dict) else None
            if nid:
                all_nodes_fm[nid] = fm
            if nkey and nid:
                key_to_id[nkey] = nid
        except Exception:
            pass

    public_healed = [h for h in healed_links if "private" not in Path(h["file"]).parts]
    private_healed = [h for h in healed_links if "private" in Path(h["file"]).parts]

    public_index = _compile_index_subset(
        project_root, public_files, all_nodes_fm, key_to_id, public_healed, code_dependency_edges
    )
    private_index = _compile_index_subset(
        project_root, private_files, all_nodes_fm, key_to_id, private_healed, []
    )
    return public_index, private_index


def render_context_map_md(project_root: Path, index: Dict[str, Any]) -> str:
    lines: List[str] = [
        "# 🗺️ PotoTypeV0 × Friday Context Registry & Topology Map (CONTEXT_MAP.md)",
        "",
        f"> **自動生成時間**: `{index['generated_at']}` | **Agentic Harness**: `{index['harness']}` | **記憶節點總數**: `{index['total_nodes']}`",
        "> **漸進式揭露原則 (Progressive Disclosure)**: Agent 啟動時僅注入活躍節點 (`verified`/`draft`) 之單行摘要，按節點鍵值 (`node_key`) 或節點 ID (`node_id`) 按需調閱對應檔案。",
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
        "## 3. 源碼 AST Import 依賴拓撲表 (Python & TypeScript Code Dependency Graph)",
        "",
        "| 來源模組 (`from`) | 目標依賴 (`to`) | 依賴類型 (`type`) |",
        "| :--- | :--- | :---: |",
    ])
    for cedge in index.get("code_dependency_edges", []):
        lines.append(f"| `{cedge['from']}` | `{cedge['to']}` | `{cedge['type']}` |")
    intel_map = index.get("code_intelligence_map", {})
    if intel_map:
        lines.extend([
            "",
            "### 3.2 源碼符號、Hook 註冊與規格影響圈總表 (Code Intelligence & Impact Map)",
            "",
            "| 源碼路徑 (`file_path`) | 主要符號與行號 (`symbols`) | Pi 擴充註冊 (`command`/`tool`/`hook`) | 影響圈 (`imported_by`) | 綁定規格 (`governing_specs`) |",
            "| :--- | :--- | :--- | :--- | :--- |",
        ])
        for cpath, info in sorted(intel_map.items()):
            syms = ", ".join(
                f"`{s['name']}`(L{s['line_start']}-L{s['line_end']})"
                for s in info.get("symbols", [])[:6]
            ) or "—"
            regs = ", ".join(
                f"`{r['kind']}:{r['name']}`(L{r['line']})"
                for r in info.get("pi_registrations", [])[:6]
            ) or "—"
            imp_by = ", ".join(f"`{p}`" for p in info.get("imported_by", [])) or "—"
            specs = ", ".join(f"`{g.get('node_key') or g.get('node_id')}`" for g in info.get("governing_specs", [])) or "—"
            lines.append(f"| `{cpath}` | {syms} | {regs} | {imp_by} | {specs} |")
    lines.extend([
        "",
        "## 4. 專案治理目錄結構摘要",
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
    index, private_index = build_public_and_private_indices(project_root)

    index_path = project_root / "memory" / "index" / "CONTEXT_INDEX.json"
    index_path.parent.mkdir(parents=True, exist_ok=True)
    index_path.write_text(json.dumps(index, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    private_index_path = project_root / "memory" / "index" / "PRIVATE_INDEX.json"
    private_map_path = project_root / "memory" / "private" / "CONTEXT_MAP.md"
    if private_index.get("total_nodes", 0) > 0:
        private_index_path.write_text(json.dumps(private_index, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        private_map_path.parent.mkdir(parents=True, exist_ok=True)
        private_map_md = render_context_map_md(project_root, private_index).replace(
            "# 🗺️ PotoTypeV0 × Friday Context Registry & Topology Map (CONTEXT_MAP.md)",
            "# 🔒 PotoTypeV0 × Friday Private Context Registry & Topology Map (memory/private/CONTEXT_MAP.md)",
            1,
        )
        private_map_path.write_text(private_map_md, encoding="utf-8")
    else:
        if private_index_path.exists():
            private_index_path.unlink()
        if private_map_path.exists():
            private_map_path.unlink()

    map_path = project_root / "memory" / "codex" / "CONTEXT_MAP.md"
    map_path.parent.mkdir(parents=True, exist_ok=True)
    map_path.write_text(render_context_map_md(project_root, index), encoding="utf-8")

    healed = index.get("healed_links", []) + private_index.get("healed_links", [])
    if healed:
        print(f"🩹 Auto-healed {len(healed)} broken relative Markdown link(s): {healed}")
    print(f"✅ Compiled CONTEXT_INDEX.json ({index['total_nodes']} public nodes, {len(index.get('code_dependency_edges', []))} code edges) -> {index_path}")
    if private_index.get("total_nodes", 0) > 0:
        print(f"🔒 Compiled PRIVATE_INDEX.json ({private_index['total_nodes']} private nodes, git-ignored) -> {private_index_path}")
        print(f"🔒 Rendered Private CONTEXT_MAP.md -> {private_map_path}")
    print(f"✅ Rendered CONTEXT_MAP.md -> {map_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
