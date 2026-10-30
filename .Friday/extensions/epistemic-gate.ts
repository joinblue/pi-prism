// Friday Epistemic Gate & Progressive Context Disclosure Extension
// ================================================================
// 1. Active-Only Progressive Disclosure: Injects the project's 1-line Context Index
//    (`memory/index/CONTEXT_INDEX.json`) into the system prompt on turn start,
//    automatically isolating `archived` and `deprecated` nodes.
// 2. Write-Time Schema & Index Enforcement: Automatically validates `memory/**/*.md`
//    writes/edits via `schema_validator.py` (with YAML Prescription Skeleton on error)
//    and recompiles `CONTEXT_INDEX.json` + `CONTEXT_MAP.md` (`auto_update_map.py`).
// 3. Code-to-Spec Drift Alert: When `write`/`edit` modifies a governed source file
//    listed in any active node's `affected_paths`, appends a reminder to check/update
//    the corresponding architecture spec node.
// 4. Provides `/validate` command to run the independent Oracle (`schema_validator.py`).

import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export const CATALOG_STAGE2_THRESHOLD = 25;

export function buildProgressiveContextSummary(cwd: string): string | null {
	const indexPath = path.join(cwd, "memory", "index", "CONTEXT_INDEX.json");
	const privateIndexPath = path.join(cwd, "memory", "index", "PRIVATE_INDEX.json");
	if (!fs.existsSync(indexPath) && !fs.existsSync(privateIndexPath)) return null;

	try {
		const raw = fs.existsSync(indexPath) ? JSON.parse(fs.readFileSync(indexPath, "utf-8")) : {};
		const privateRaw = fs.existsSync(privateIndexPath) ? JSON.parse(fs.readFileSync(privateIndexPath, "utf-8")) : null;
		const registry = raw.domain_registry ?? {};
		const itemLines: string[] = [];
		const pinnedLines: string[] = [];
		let activeCount = 0;
		let isolatedCount = 0;

		const collectRegistry = (reg: Record<string, any>, isPrivate = false) => {
			for (const [code, section] of Object.entries<any>(reg)) {
				const items = section?.items ?? [];
				if (!Array.isArray(items) || items.length === 0) continue;
				for (const item of items) {
					// Stage 5: Active-Only Injection (automatically isolate archived & deprecated nodes)
					if (item.status === "archived" || item.status === "deprecated") {
						isolatedCount++;
						continue;
					}
					activeCount++;
					const tag = isPrivate ? "🔒PRIVATE | " : "";
					const line = `- [${tag}${code} | ${item.node_key} | ${item.node_id} (${item.artifact_type}/${item.status})] ${item.summary_1line} -> \`${item.path}\``;
					itemLines.push(line);
					if (code === "000" || code === "100" || item.always_pin) {
						pinnedLines.push(line);
					}
				}
			}
		};

		collectRegistry(registry, false);
		if (privateRaw?.domain_registry) {
			collectRegistry(privateRaw.domain_registry, true);
		}

		if (activeCount > CATALOG_STAGE2_THRESHOLD) {
			// Stage 1 Compact Summary: <= 20 lines
			const stats = raw.domain_stats ?? {};
			const statsSummary = Object.entries(stats)
				.filter(([_, c]) => (c as number) > 0)
				.map(([d, c]) => `${d}: ${c}`)
				.join(" | ");
			const summaryLines: string[] = [
				"",
				`## 🧩 [Friday Progressive Context Index] 專案圖書館分類摘要 (節點數: ${activeCount} > ${CATALOG_STAGE2_THRESHOLD})`,
				`館藏統計：${statsSummary}`,
				"提示：館藏條目已超過緊湊閾值，使用 `query_library(domain=..., query=...)` 可精準檢索條目與雙向圖譜。",
				"### 核心憲法與護欄 (Pinned):",
				...pinnedLines,
			];
			return summaryLines.slice(0, 20).join("\n");
		}

		const lines: string[] = [
			"",
			"## 🧩 [Friday Progressive Context Index] 專案記憶節點單行索引 (CONTEXT_INDEX — Active-Only)",
			`專案: ${raw.project ?? path.basename(cwd)} | 活躍節點數: ${activeCount} (已隔離歷史/淘汰節點: ${isolatedCount})`,
			"提示：此索引僅供需要查閱架構規範時按需使用 `read` 調閱；一般對話請直接回應使用者需求，無須主動詢問是否執行驗證。",
			...itemLines,
		];

		const pendingAlignments = [
			...(Array.isArray(raw.pending_topology_alignments) ? raw.pending_topology_alignments : []),
			...(Array.isArray(privateRaw?.pending_topology_alignments) ? privateRaw.pending_topology_alignments : []),
		];
		if (pendingAlignments.length > 0) {
			lines.push("");
			lines.push("⚠️ [Pending Topology Alignment | 跨文件潛在規格衝突與待收斂提醒 (supersedes/conflicts_with 留空監測)]:");
			for (const item of pendingAlignments) {
				const targets = Array.isArray(item.unlinked_targets) ? item.unlinked_targets.join(", ") : "";
				lines.push(
					`- 節點 ${item.source_node_id} (${item.source_node_key} @ \`${item.source_path}\`) 內文提及活躍節點 [${targets}]，但標頭 \`supersedes\`/\`conflicts_with\` 尚未掛載收斂！調閱相關規格時請以最新節點或真實程式碼為準，並在驗證完成後歸檔舊節點。`,
				);
			}
		}

		return lines.join("\n");
	} catch {
		return null;
	}
}

export function findAffectedMemoryNodes(
	cwd: string,
	relFilePath: string,
): Array<{ node_id: string; node_key: string; path: string; summary_1line: string }> {
	const indexPaths = [
		path.join(cwd, "memory", "index", "CONTEXT_INDEX.json"),
		path.join(cwd, "memory", "index", "PRIVATE_INDEX.json"),
	].filter((p) => fs.existsSync(p));
	if (indexPaths.length === 0) return [];
	try {
		const matches: Array<{ node_id: string; node_key: string; path: string; summary_1line: string }> = [];
		const normalizedTarget = relFilePath.replace(/\\/g, "/").replace(/^\.\//, "");

		for (const indexPath of indexPaths) {
			const raw = JSON.parse(fs.readFileSync(indexPath, "utf-8"));
			const registry = raw.domain_registry ?? {};
			for (const section of Object.values<any>(registry)) {
				const items = section?.items ?? [];
				if (!Array.isArray(items)) continue;
				for (const item of items) {
					if (item.status === "archived" || item.status === "deprecated") continue;
					const affected: string[] = Array.isArray(item.affected_paths) ? item.affected_paths : [];
					const isAffected = affected.some((ap) => {
						const normAp = String(ap).replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/$/, "");
						return normalizedTarget === normAp || normalizedTarget.startsWith(`${normAp}/`);
					});
					if (isAffected) {
						matches.push({
							node_id: String(item.node_id ?? ""),
							node_key: String(item.node_key ?? ""),
							path: String(item.path ?? ""),
							summary_1line: String(item.summary_1line ?? ""),
						});
					}
				}
			}
		}
		return matches;
	} catch {
		return [];
	}
}

const sessionPinnedSummaries = new Map<string, string>();

export function getSessionPinnedContextSummary(sessionKey: string, cwd: string, forceRefresh = false): string | null {
	if (!forceRefresh && sessionPinnedSummaries.has(sessionKey)) {
		return sessionPinnedSummaries.get(sessionKey) ?? null;
	}
	const built = buildProgressiveContextSummary(cwd);
	if (built) {
		sessionPinnedSummaries.set(sessionKey, built);
	}
	return built;
}

export function clearSessionPinnedContextSummaries(): void {
	sessionPinnedSummaries.clear();
}

export interface FridayEpistemicBridge {
	getVerifiedIndexSnapshot(cwd: string): any;
	getCatalogSummary(cwd: string): string | null;
	queryLibrary(
		cwd: string,
		params: {
			domain?: string;
			query?: string;
			node_key?: string;
			include_neighbors?: boolean;
			limit?: number;
		},
	): any[];
	getSessionPinnedContextSummary(sessionKey: string, cwd: string, forceRefresh?: boolean): string | null;
	clearSessionPinnedContextSummaries(): void;
}

export function queryLibraryNodes(
	cwd: string,
	params: {
		domain?: string;
		query?: string;
		node_key?: string;
		include_neighbors?: boolean;
		limit?: number;
	},
): any[] {
	const indexPath = path.join(cwd, "memory", "index", "CONTEXT_INDEX.json");
	const privatePath = path.join(cwd, "memory", "index", "PRIVATE_INDEX.json");
	const indexPaths = [indexPath, privatePath].filter((p) => fs.existsSync(p));
	if (indexPaths.length === 0) return [];

	let results: any[] = [];
	for (const p of indexPaths) {
		try {
			const index = JSON.parse(fs.readFileSync(p, "utf-8"));
			for (const sec of Object.values<any>(index.domain_registry ?? {})) {
				for (const it of sec.items ?? []) {
					if (params.domain && it.domain_code !== params.domain && it.subdomain !== params.domain) continue;
					if (params.node_key && it.node_key !== params.node_key && it.node_id !== params.node_key) continue;
					if (params.query) {
						const q = params.query.toLowerCase();
						const matched =
							(it.node_key ?? "").toLowerCase().includes(q) ||
							(it.node_id ?? "").toLowerCase().includes(q) ||
							(it.summary_1line ?? "").toLowerCase().includes(q) ||
							(it.path ?? "").toLowerCase().includes(q) ||
							(Array.isArray(it.keywords) && it.keywords.some((k: string) => k.toLowerCase().includes(q)));
						if (!matched) continue;
					}
					results.push(it);
				}
			}
		} catch {
			// ignore parse errors
		}
	}

	if (params.limit && params.limit > 0) {
		results = results.slice(0, params.limit);
	}
	return results;
}

export const fridayEpistemicBridge: FridayEpistemicBridge = {
	getVerifiedIndexSnapshot: (cwd: string) => {
		const p = path.join(cwd, "memory", "index", "CONTEXT_INDEX.json");
		return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf-8")) : null;
	},
	getCatalogSummary: (cwd: string) => buildProgressiveContextSummary(cwd),
	queryLibrary: (cwd: string, params) => queryLibraryNodes(cwd, params),
	getSessionPinnedContextSummary,
	clearSessionPinnedContextSummaries,
};

(globalThis as any).__fridayEpistemicBridge = fridayEpistemicBridge;

export default function (pi: ExtensionAPI) {
	(globalThis as any).__fridayEpistemicBridge = fridayEpistemicBridge;

	pi.registerTool({
		name: "query_library",
		description: "Query Friday Library Context Index and bidirectional wiki graph.",
		parameters: {
			type: "object",
			properties: {
				domain: { type: "string", description: "3-digit domain classification code" },
				query: { type: "string", description: "Keyword search in node_key, summary, and keywords" },
				node_key: { type: "string", description: "Exact node key lookup" },
				include_neighbors: { type: "boolean", description: "Whether to return outbound_links and backlinks" },
				limit: { type: "number", description: "Max results to return" },
			},
		},
		execute: async (args: any, ctx: any) => {
			return fridayEpistemicBridge.queryLibrary(ctx.cwd, args ?? {});
		},
	});

	pi.registerCommand("dream", {
		description: "Consolidate scratch drafts into memory/wiki/ and rebuild knowledge graph",
		handler: async (_args: string, ctx: any) => {
			const dreamPromptPath = path.join(ctx.cwd, ".Friday", "prompts", "dream.md");
			let promptText = "";
			if (fs.existsSync(dreamPromptPath)) {
				promptText = fs.readFileSync(dreamPromptPath, "utf-8");
			}
			return {
				output: `[Friday /dream Pipeline Activated]\nPrompt: ${dreamPromptPath}\n${promptText ? `\n${promptText}` : ""}`,
			};
		},
	});
	pi.on("session_start", async (_event, ctx) => {
		const sessionKey = `${ctx.sessionManager?.getSessionId?.() ?? "default"}::${ctx.cwd}`;
		getSessionPinnedContextSummary(sessionKey, ctx.cwd, true);
	});

	pi.on("before_agent_start", async (event, ctx) => {
		// Prefix KV Cache Guard (Killer 3 Fix):
		// Pin the Progressive Context Index summary per session so mid-session `memory/**/*.md` edits
		// (which trigger `auto_update_map.py`) do NOT mutate `messages[0]` (Token 0) and invalidate the Prefix KV Cache.
		const sessionKey = `${ctx.sessionManager?.getSessionId?.() ?? "default"}::${ctx.cwd}`;
		const summary = getSessionPinnedContextSummary(sessionKey, ctx.cwd, false);
		if (!summary) return undefined;
		return {
			systemPrompt: `${event.systemPrompt}\n${summary}`,
		};
	});

	// Stage 5 + M7:
	// 1. Write-Time Schema & Index Enforcement whenever `write` or `edit` modifies `memory/**/*.md`
	// 2. Code-to-Spec Drift Alert whenever `write` or `edit` modifies a file in `affected_paths`
	pi.on("tool_result", async (event, ctx) => {
		if (event.toolName !== "write" && event.toolName !== "edit") return undefined;
		if (event.isError) return undefined;

		const input = (event.input ?? {}) as Record<string, unknown>;
		const rawPath = String(input.path ?? input.file_path ?? "").trim();
		if (!rawPath) return undefined;

		const absPath = path.isAbsolute(rawPath) ? path.resolve(rawPath) : path.resolve(ctx.cwd, rawPath);
		const relToCwd = path.relative(ctx.cwd, absPath).replace(/\\/g, "/");

		// Case A: Modified a governed memory node in `memory/**/*.md`
		if (relToCwd.startsWith("memory/") && relToCwd.toLowerCase().endsWith(".md")) {
			if (relToCwd === "memory/codex/CONTEXT_MAP.md") return undefined;

			const syncScriptPath = path.join(ctx.cwd, "scripts", "sync_doc_metadata.py");
			const validatorPath = path.join(ctx.cwd, "schemas", "schema_validator.py");
			const mapScriptPath = path.join(ctx.cwd, "scripts", "auto_update_map.py");
			if (!fs.existsSync(validatorPath) || !fs.existsSync(absPath)) return undefined;

			let syncOut = "";
			if (fs.existsSync(syncScriptPath)) {
				try {
					syncOut = execFileSync("python3", [syncScriptPath, "--file", absPath, "--project-root", ctx.cwd], {
						cwd: ctx.cwd,
						encoding: "utf-8",
						timeout: 15_000,
					}).trim();
				} catch {
					// If raw frontmatter is malformed, let schema_validator.py report the Prescription Skeleton below
				}
			}

			try {
				const valOut = execFileSync("python3", [validatorPath, "--file", absPath], {
					cwd: ctx.cwd,
					encoding: "utf-8",
					timeout: 15_000,
				}).trim();
				let mapOut = "";
				if (fs.existsSync(mapScriptPath)) {
					mapOut = execFileSync("python3", [mapScriptPath], {
						cwd: ctx.cwd,
						encoding: "utf-8",
						timeout: 15_000,
					}).trim();
				}
				const existingContent = Array.isArray(event.content) ? event.content : [];
				const syncPrefix = syncOut ? `${syncOut}\n` : "";
				return {
					content: [
						...existingContent,
						{
							type: "text",
							text: `\n${syncPrefix}✅ [Epistemic Write-Time Gate] ${valOut}${mapOut ? `\n${mapOut}` : ""}`,
						},
					],
				};
			} catch (err: any) {
				const stdout = err?.stdout ? String(err.stdout).trim() : "";
				const stderr = err?.stderr ? String(err.stderr).trim() : String(err);
				const existingContent = Array.isArray(event.content) ? event.content : [];
				const syncPrefix = syncOut ? `${syncOut}\n` : "";
				return {
					content: [
						...existingContent,
						{
							type: "text",
							text: `\n${syncPrefix}❌ [Epistemic Write-Time Gate — YAML Schema Violation in ${relToCwd}]\n${stdout}\n${stderr}\n👉 請立即根據上方處方籤修復範本 (Prescription Skeleton) 修正該記憶節點！`,
						},
					],
					isError: true,
				};
			}
		}

		// Case B: Modified a source/config file outside `memory/` -> check `affected_paths` for Code-to-Spec Drift Alert
		const affectedNodes = findAffectedMemoryNodes(ctx.cwd, relToCwd);
		if (affectedNodes.length > 0) {
			const nodeBullets = affectedNodes
				.map((n) => `  - [${n.node_key} | ${n.node_id}] \`${n.path}\` (${n.summary_1line})`)
				.join("\n");
			const existingContent = Array.isArray(event.content) ? event.content : [];
			return {
				content: [
					...existingContent,
					{
						type: "text",
						text:
							`\n⚠️ [Code-to-Spec Drift Alert | 源碼變更連動警報]\n` +
							`您剛修改了受保護源碼 \`${relToCwd}\`，以下活躍記憶節點將此路徑列為 \`affected_paths\`：\n` +
							`${nodeBullets}\n` +
							`💡 若本次變更涉及架構介面、路由行為或安全規則調整，請同步檢視並更新對應之記憶節點與 \`epistemic_profile\` 計數。`,
					},
				],
			};
		}

		return undefined;
	});
}
