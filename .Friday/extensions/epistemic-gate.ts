/**
 * Friday Epistemic Gate & Progressive Context Disclosure Extension
 * ================================================================
 * 1. Injects the project's 1-line Context Index (`memory/index/CONTEXT_INDEX.json`)
 *    into the system prompt on turn start (Progressive Disclosure — avoids dumping
 *    full files into the context window).
 * 2. Provides `/validate` command to run the independent Oracle (`schema_validator.py`)
 *    and re-compile `CONTEXT_INDEX.json` + `CONTEXT_MAP.md` (`auto_update_map.py`).
 */

import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

function buildProgressiveContextSummary(cwd: string): string | null {
	const indexPath = path.join(cwd, "memory", "index", "CONTEXT_INDEX.json");
	if (!fs.existsSync(indexPath)) return null;

	try {
		const raw = JSON.parse(fs.readFileSync(indexPath, "utf-8"));
		const lines: string[] = [
			"",
			"## 🧩 [Friday Progressive Context Index] 專案記憶節點單行索引 (CONTEXT_INDEX)",
			`專案: ${raw.project ?? path.basename(cwd)} | 記憶節點數: ${raw.total_nodes ?? 0}`,
			"提示：此索引僅供需要查閱架構規範時按需使用 `read` 調閱；一般對話請直接回應使用者需求，無須主動詢問是否執行驗證。",
		];

		const registry = raw.domain_registry ?? {};
		for (const [code, section] of Object.entries<any>(registry)) {
			const items = section?.items ?? [];
			if (!Array.isArray(items) || items.length === 0) continue;
			for (const item of items) {
				lines.push(
					`- [${code} | ${item.node_key} | ${item.node_id} (${item.artifact_type}/${item.status})] ${item.summary_1line} -> \`${item.path}\``,
				);
			}
		}
		return lines.join("\n");
	} catch {
		return null;
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

	// M7: Write-Time Schema & Index Enforcement whenever `write` or `edit` modifies `memory/**/*.md`
	pi.on("tool_result", async (event, ctx) => {
		if (event.toolName !== "write" && event.toolName !== "edit") return undefined;
		if (event.isError) return undefined;

		const input = (event.input ?? {}) as Record<string, unknown>;
		const rawPath = String(input.path ?? input.file_path ?? "").trim();
		if (!rawPath) return undefined;

		const absPath = path.isAbsolute(rawPath) ? path.resolve(rawPath) : path.resolve(ctx.cwd, rawPath);
		const relToCwd = path.relative(ctx.cwd, absPath).replace(/\\/g, "/");
		if (!relToCwd.startsWith("memory/") || !relToCwd.toLowerCase().endsWith(".md")) return undefined;
		if (relToCwd === "memory/index/CONTEXT_MAP.md") return undefined;

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
						text: `\n❌ [Epistemic Write-Time Gate — YAML Schema Violation in ${relToCwd}]\n${stdout}\n${stderr}\n👉 請立即根據上述錯誤修正該記憶節點之 YAML Frontmatter 標頭！`,
					},
				],
				isError: true,
			};
		}
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
