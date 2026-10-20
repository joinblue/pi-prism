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

export function buildProgressiveContextSummary(cwd: string): string | null {
	const indexPath = path.join(cwd, "memory", "index", "CONTEXT_INDEX.json");
	if (!fs.existsSync(indexPath)) return null;

	try {
		const raw = JSON.parse(fs.readFileSync(indexPath, "utf-8"));
		const registry = raw.domain_registry ?? {};
		const itemLines: string[] = [];
		let activeCount = 0;
		let isolatedCount = 0;

		for (const [code, section] of Object.entries<any>(registry)) {
			const items = section?.items ?? [];
			if (!Array.isArray(items) || items.length === 0) continue;
			for (const item of items) {
				// Stage 5: Active-Only Injection (automatically isolate archived & deprecated nodes)
				if (item.status === "archived" || item.status === "deprecated") {
					isolatedCount++;
					continue;
				}
				activeCount++;
				itemLines.push(
					`- [${code} | ${item.node_key} | ${item.node_id} (${item.artifact_type}/${item.status})] ${item.summary_1line} -> \`${item.path}\``,
				);
			}
		}

		const lines: string[] = [
			"",
			"## 🧩 [Friday Progressive Context Index] 專案記憶節點單行索引 (CONTEXT_INDEX — Active-Only)",
			`專案: ${raw.project ?? path.basename(cwd)} | 活躍節點數: ${activeCount} (已隔離歷史/淘汰節點: ${isolatedCount})`,
			"提示：此索引僅供需要查閱架構規範時按需使用 `read` 調閱；一般對話請直接回應使用者需求，無須主動詢問是否執行驗證。",
			...itemLines,
		];
		return lines.join("\n");
	} catch {
		return null;
	}
}

export function findAffectedMemoryNodes(
	cwd: string,
	relFilePath: string,
): Array<{ node_id: string; node_key: string; path: string; summary_1line: string }> {
	const indexPath = path.join(cwd, "memory", "index", "CONTEXT_INDEX.json");
	if (!fs.existsSync(indexPath)) return [];
	try {
		const raw = JSON.parse(fs.readFileSync(indexPath, "utf-8"));
		const registry = raw.domain_registry ?? {};
		const matches: Array<{ node_id: string; node_key: string; path: string; summary_1line: string }> = [];
		const normalizedTarget = relFilePath.replace(/\\/g, "/").replace(/^\.\//, "");

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
		return matches;
	} catch {
		return [];
	}
}

export default function (pi: ExtensionAPI) {
	pi.on("before_agent_start", async (event, ctx) => {
		const summary = buildProgressiveContextSummary(ctx.cwd);
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

			const validatorPath = path.join(ctx.cwd, "schemas", "schema_validator.py");
			const mapScriptPath = path.join(ctx.cwd, "scripts", "auto_update_map.py");
			if (!fs.existsSync(validatorPath) || !fs.existsSync(absPath)) return undefined;

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
				return {
					content: [
						...existingContent,
						{
							type: "text",
							text: `\n✅ [Epistemic Write-Time Gate] ${valOut}${mapOut ? `\n${mapOut}` : ""}`,
						},
					],
				};
			} catch (err: any) {
				const stdout = err?.stdout ? String(err.stdout).trim() : "";
				const stderr = err?.stderr ? String(err.stderr).trim() : String(err);
				const existingContent = Array.isArray(event.content) ? event.content : [];
				return {
					content: [
						...existingContent,
						{
							type: "text",
							text: `\n❌ [Epistemic Write-Time Gate — YAML Schema Violation in ${relToCwd}]\n${stdout}\n${stderr}\n👉 請立即根據上方處方籤修復範本 (Prescription Skeleton) 修正該記憶節點！`,
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

	pi.registerCommand("validate", {
		description: "執行 Friday 獨立驗證器 (schema_validator.py) 並更新 Context 依賴拓撲圖 (auto_update_map.py)",
		handler: async (_args, ctx) => {
			const validatorPath = path.join(ctx.cwd, "schemas", "schema_validator.py");
			const mapScriptPath = path.join(ctx.cwd, "scripts", "auto_update_map.py");

			if (!fs.existsSync(validatorPath)) {
				ctx.ui.notify(`⚠️ 當前專案 (${ctx.cwd}) 尚未包含 schemas/schema_validator.py`, "warning");
				return;
			}

			try {
				const out1 = execFileSync("python3", [validatorPath, "--run-oracle"], {
					cwd: ctx.cwd,
					encoding: "utf-8",
					timeout: 30_000,
				});
				let out2 = "";
				if (fs.existsSync(mapScriptPath)) {
					out2 = execFileSync("python3", [mapScriptPath], {
						cwd: ctx.cwd,
						encoding: "utf-8",
						timeout: 15_000,
					});
				}
				ctx.ui.notify(`✅ [Friday Harness Validator 驗證通過]\n${out1.trim()}\n${out2.trim()}`, "info");
			} catch (err: any) {
				const stdout = err?.stdout ? String(err.stdout) : "";
				const stderr = err?.stderr ? String(err.stderr) : String(err);
				ctx.ui.notify(`❌ [Friday Harness Validator 驗證失敗]\n${stdout}\n${stderr}`, "error");
			}
		},
	});
}
