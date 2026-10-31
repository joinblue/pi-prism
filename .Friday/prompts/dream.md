---
description: Run NREM/REM Memory Consolidation, Library Wiki Graph Sync, and LEDGER Pruning
---
Execute Friday's Unified Memory Consolidation (`/dream`) pipeline in 3 deterministic phases:

### Phase 1: NREM Deterministic Harvest & Cataloging (`scout` / `glm-5.3-flash`)
1. Inspect `memory/scratch/`, `memory/episodic/`, and `git status --short` to identify uncataloged notes, research digests, or modified source files.
2. For any valid uncataloged draft in `memory/scratch/` worth preserving:
   - Assign a 3-digit Dewey domain from `schemas/TAXONOMY.json` (`000`–`900`).
   - Initialize its Track B Wiki frontmatter via:
     `python3 scripts/sync_doc_metadata.py --init --type wiki --domain <DDD> --title "<Title>" --file <target_path>`
   - Move the finalized note into `memory/wiki/` (or `memory/specs/` if it is a formal specification with `reviewer` sign-off).
3. Run `python3 scripts/sync_doc_metadata.py` to synchronize SHA-256 `content_checksum` and `updated_at` timestamps across all modified memory nodes.

### Phase 2: REM Graph Stitching, Code Intelligence & Ledger Pruning (`architect` / `glm-5.1`)
1. Run `python3 scripts/auto_update_map.py` to heal `[[wikilinks]]`, recompute bidirectional `outbound_links` / `backlinks`, rebuild `code_intelligence_map` (AST symbols, Pi hooks/tools/commands, and `governing_specs`), and regenerate `memory/index/CONTEXT_INDEX.json` + `memory/codex/CONTEXT_MAP.md`.
2. Inspect `memory/index/CONTEXT_INDEX.json` for orphan nodes (zero `outbound_links` and zero `backlinks` outside `000`) and weave explicit `[[node_key]]` cross-references where semantically appropriate.
3. Audit `memory/LEDGER.md`:
   - Enforce the strict **<= 80 lines** cap.
   - Archive completed historical milestone details into `memory/wiki/` or `memory/specs/` while keeping only active priorities and recent decisions in `memory/LEDGER.md`.

### Phase 3: Independent Oracle Verification
1. Run `python3 schemas/schema_validator.py --run-oracle` and verify 100% pass status (`0` errors).
2. Report `[FACT]` summary of newly cataloged nodes, updated `outbound_links`/`backlinks` counts, `code_intelligence_map` coverage, `LEDGER.md` line count, and Oracle pass status.
