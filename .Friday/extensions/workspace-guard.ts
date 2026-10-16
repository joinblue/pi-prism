/**
 * Friday Workspace Boundary Guard & SEC-CMD-V1 Extension (Pillar 2)
 * =================================================================
 * 1. Locks file & bash operations to the active project workspace (`ctx.cwd`).
 * 2. Unconditionally protects credentials (`auth.json`, `.env*`, SSH keys).
 * 3. Enforces SEC-CMD-V1 against destructive shell commands.
 * 4. Pops up an AGY-style interactive permission prompt (`ctx.ui.select`)
 *    when the agent attempts to access paths outside `ctx.cwd`.
 *    In headless/subagent mode (`!ctx.hasUI`), blocks out-of-bounds access automatically.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { type ExtensionAPI, type ExtensionContext, getAgentDir } from "@earendil-works/pi-coding-agent";

const FILE_TOOLS = new Set(["read", "write", "edit", "grep", "find", "ls"]);

const SECRET_FILE_PATTERNS = [
	/(?:^|[\\/])auth\.json$/i,
	/(?:^|[\\/])\.env(?:\.[a-zA-Z0-9._-]+)?$/i,
	/(?:^|[\\/])id_(?:rsa|ed25519|ecdsa)$/i,
];

const DESTRUCTIVE_BASH_PATTERNS: Array<{ id: string; pattern: RegExp; desc: string }> = [
	{
		id: "SEC-CMD-01",
		pattern: /\brm\s+(?:-[a-zA-Z]*r[a-zA-Z]*f|-[a-zA-Z]*f[a-zA-Z]*r|--recursive)\s+(?:\/(?:\s|$|[;&|*])|\.\.(?:\/|\s|$)|~(?:\/|\s|$)|\$HOME\b)/i,
		desc: "遞迴刪除根目錄、上層目錄或家目錄",
	},
	{ id: "SEC-CMD-02", pattern: /\b(?:mkfs|fdisk|parted|wipefs)\b/i, desc: "磁碟格式化或分割表破壞指令" },
	{ id: "SEC-CMD-03", pattern: /\bdd\s+if=.*of=\/dev\//i, desc: "直接覆寫區塊裝置 (/dev/*)" },
	{ id: "SEC-CMD-04", pattern: /\b(?:curl|wget)\b[^|]*\|\s*(?:ba)?sh\b/i, desc: "未經驗證之遠端腳本管線直執 (curl|sh)" },
	{ id: "SEC-CMD-05", pattern: /\b(?:chmod|chown)\s+-R\s+777\s+\//i, desc: "全域權限破壞 (chmod -R 777 /)" },
	{ id: "SEC-CMD-06", pattern: /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/, desc: "Fork Bomb 阻斷服務攻擊" },
];

const SAFE_SYSTEM_PREFIXES = ["/dev/null", "/dev/stdout", "/dev/stderr", "/dev/fd", "/proc/self"];

function resolveRealTarget(rawPath: string, cwd: string): string {
	const expanded = rawPath.startsWith("~/") ? path.join(os.homedir(), rawPath.slice(2)) : rawPath === "~" ? os.homedir() : rawPath;
	const abs = path.resolve(cwd, expanded);
	try {
		return fs.realpathSync(abs);
	} catch {
		// If file does not exist yet (e.g. write), resolve parent directory if possible
		const parent = path.dirname(abs);
		try {
			return path.join(fs.realpathSync(parent), path.basename(abs));
		} catch {
			return abs;
		}
	}
}

function isWithinDir(target: string, baseDir: string): boolean {
	const realBase = (() => {
		try {
			return fs.realpathSync(baseDir);
		} catch {
			return path.resolve(baseDir);
		}
	})();
	const rel = path.relative(realBase, target);
	return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function extractPathsFromBash(command: string): string[] {
	const candidates = new Set<string>();
	// Match absolute paths like /etc/passwd, /home/..., ~/..., ../ parent traversals, or .Friday brain paths
	const regex =
		/(?:^|\s|["'=><])((?:\/[a-zA-Z0-9._-]+){1,}|~\/[a-zA-Z0-9._/-]+|\.\.\/[a-zA-Z0-9._/-]*|\.?\/?\.Friday(?:\/[a-zA-Z0-9._/-]*)?)/g;
	let match: RegExpExecArray | null;
	while ((match = regex.exec(command)) !== null) {
		const token = match[1].trim();
		if (!token) continue;
		if (SAFE_SYSTEM_PREFIXES.some((p) => token === p || token.startsWith(`${p}/`))) continue;
		// Ignore common CLI flags or URLs or sed expressions
		if (token.startsWith("//") || token.includes("://")) continue;
		// Ignore standard system binary paths when just invoking commands
		if (/^\/(?:usr\/)?(?:local\/)?s?bin\//.test(token)) continue;
		candidates.add(token);
	}
	return Array.from(candidates);
}

export default function (pi: ExtensionAPI) {
	const sessionTrustedDirs = new Set<string>();

	async function verifyPathAccess(
		rawPath: string,
		toolName: string,
		operationDesc: string,
		ctx: ExtensionContext,
	): Promise<{ allowed: boolean; reason?: string }> {
		const target = resolveRealTarget(rawPath, ctx.cwd);
		const agentDir = getAgentDir();

		// 1. Unconditional Secret & Credential Protection (SEC-CRED)
		if (SECRET_FILE_PATTERNS.some((p) => p.test(target) || p.test(rawPath))) {
			return {
				allowed: false,
				reason: `🛡️ [Friday Guard | SEC-CRED] 嚴格禁止存取機密憑證或金鑰檔案: ${rawPath}`,
			};
		}

		// 2. Brain Core Protection (SEC-BRAIN): Since .Friday lives inside PotoTypeV0 (ctx.cwd),
		//    prevent the agent from modifying its own brain (.Friday/extensions, settings.json, models, agents)
		if (isWithinDir(target, agentDir)) {
			const isReadOnlyTool = toolName === "read" || toolName === "ls" || toolName === "find" || toolName === "grep";
			if (isReadOnlyTool) {
				return { allowed: true };
			}
			// Write / Edit / Bash targeting .Friday brain directory
			if (!ctx.hasUI) {
				return {
					allowed: false,
					reason: `🛡️ [Friday Guard | SEC-BRAIN] 大腦核心保護：禁止自動修改或寫入 .Friday 大腦設定與擴充檔 -> ${target}`,
				};
			}
			const optAllowBrain = "✅ 允許本次修改 .Friday 大腦設定 (Allow once)";
			const optDenyBrain = "❌ 拒絕修改大腦設定 (Deny & Block)";
			const brainChoice = await ctx.ui.select(
				[
					"🧠 [Friday Brain Core Guard | SEC-BRAIN] 偵測到針對 .Friday 大腦核心目錄的修改或指令請求！",
					`  • 大腦核心目錄: ${agentDir}`,
					`  • 觸發工具與動作: [${toolName}] ${operationDesc}`,
					`  • 目標解析路徑: ${target}`,
					"",
					"是否授權修改 Friday 大腦核心檔案？",
				].join("\n"),
				[optAllowBrain, optDenyBrain],
			);
			if (brainChoice === optAllowBrain) {
				ctx.ui.notify(`已單次授權修改大腦檔案: ${target}`, "info");
				return { allowed: true };
			}
			return {
				allowed: false,
				reason: `🛡️ [Friday Guard | SEC-BRAIN] 使用者拒絕了對 .Friday 大腦核心目錄 (${target}) 的修改請求。`,
			};
		}

		// 3. Allow anything inside current project workspace (ctx.cwd) outside .Friday
		if (isWithinDir(target, ctx.cwd)) {
			return { allowed: true };
		}

		// 4. Allow session-trusted external directories
		for (const trusted of sessionTrustedDirs) {
			if (isWithinDir(target, trusted)) {
				return { allowed: true };
			}
		}

		// 5. Out-of-bounds detected!
		if (!ctx.hasUI) {
			return {
				allowed: false,
				reason: `🛡️ [Friday Guard | BOUNDARY] 越界攔截：非互動/子代理模式禁止存取專案工作區 (${ctx.cwd}) 以外之路徑 -> ${target}`,
			};
		}

		const targetDir = path.dirname(target);
		const optOnce = "✅ 允許本次操作 (Allow once)";
		const optSession = `🔓 本次 Session 信任此目錄 (${targetDir})`;
		const optDeny = "❌ 拒絕並攔截 (Deny & Block)";

		const choice = await ctx.ui.select(
			[
				"🛡️ [Friday Workspace Boundary Guard] 偵測到跨出專案工作區的存取請求！",
				`  • 目前專案鎖定範圍 (cwd): ${ctx.cwd}`,
				`  • 觸發工具與動作: [${toolName}] ${operationDesc}`,
				`  • 目標解析路徑: ${target}`,
				"",
				"是否授權 Friday 執行此越界操作？",
			].join("\n"),
			[optOnce, optSession, optDeny],
		);

		if (choice === optOnce) {
			ctx.ui.notify(`已單次授權存取: ${target}`, "info");
			return { allowed: true };
		}
		if (choice === optSession) {
			sessionTrustedDirs.add(targetDir);
			ctx.ui.notify(`已將目錄加入本次 Session 信任清單: ${targetDir}`, "info");
			return { allowed: true };
		}

		return {
			allowed: false,
			reason: `🛡️ [Friday Guard] 使用者拒絕了對專案工作區外部路徑 (${target}) 的存取請求。`,
		};
	}

	pi.on("session_start", async (_event, ctx) => {
		if (ctx.hasUI) {
			ctx.ui.setStatus("friday-guard", `🛡️ Lock:${path.basename(ctx.cwd)}`);
		}
	});

	pi.on("user_bash", async (event, _ctx) => {
		const command = event.command || "";
		for (const rule of DESTRUCTIVE_BASH_PATTERNS) {
			if (rule.pattern.test(command)) {
				return {
					result: {
						output: `🛑 [Friday Guard | ${rule.id}] 已攔截高風險指令 (${rule.desc}):\n  ${command}`,
						exitCode: 126,
						cancelled: false,
						truncated: false,
					},
				};
			}
		}
		return undefined;
	});

	pi.on("tool_call", async (event, ctx) => {
		const toolName = event.toolName;

		// A. Check file-oriented tools (read, write, edit, grep, find, ls)
		if (FILE_TOOLS.has(toolName)) {
			const input = event.input as Record<string, unknown>;
			const rawPath = (input.path ?? input.file_path ?? ".") as string;
			const check = await verifyPathAccess(rawPath, toolName, `${toolName}(${rawPath})`, ctx);
			if (!check.allowed) {
				return { block: true, reason: check.reason ?? "Blocked by Friday Workspace Guard" };
			}
			return undefined;
		}

		// B. Check bash tool commands
		if (toolName === "bash") {
			const command = String((event.input as Record<string, unknown>).command ?? "");

			// 1. Check SEC-CMD-V1 destructive patterns
			for (const rule of DESTRUCTIVE_BASH_PATTERNS) {
				if (rule.pattern.test(command)) {
					return {
						block: true,
						reason: `🛑 [Friday Guard | ${rule.id}] 攔截毀滅性指令 (${rule.desc}): ${command}`,
					};
				}
			}

			// 2. Check if bash command references secret files directly
			if (SECRET_FILE_PATTERNS.some((p) => p.test(command))) {
				return {
					block: true,
					reason: `🛡️ [Friday Guard | SEC-CRED] 禁止透過 bash 存取機密金鑰或憑證檔 (auth.json / .env): ${command}`,
				};
			}

			// 3. Extract paths from bash command and verify boundary
			const extractedPaths = extractPathsFromBash(command);
			for (const rawPath of extractedPaths) {
				const check = await verifyPathAccess(rawPath, "bash", command.slice(0, 100), ctx);
				if (!check.allowed) {
					return { block: true, reason: check.reason ?? "Blocked by Friday Workspace Guard" };
				}
			}
		}

		return undefined;
	});

	pi.registerCommand("guard", {
		description: "檢視或重設 Friday 工作區邊界防護狀態 (/guard [reset])",
		handler: async (args, ctx) => {
			if (args.trim() === "reset") {
				sessionTrustedDirs.clear();
				ctx.ui.notify("🛡️ 已清空所有外部臨時授權目錄，嚴格鎖定回目前專案目錄。", "info");
				return;
			}
			const trustedList =
				sessionTrustedDirs.size > 0
					? Array.from(sessionTrustedDirs)
							.map((d) => `  - ${d}`)
							.join("\n")
					: "  (無外部信任目錄 — 100% 鎖定於專案工作區內)";
			ctx.ui.notify(
				[
					`🛡️ Friday Workspace Guard 狀態`,
					`• 鎖定專案工作區 (ctx.cwd): ${ctx.cwd}`,
					`• Friday 大腦目錄: ${getAgentDir()}`,
					`• 已臨時信任之外部目錄:\n${trustedList}`,
				].join("\n"),
				"info",
			);
		},
	});
}
