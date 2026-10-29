/**
 * Friday Workspace Boundary Guard & SEC-CMD-V1 Extension (Pillar 2 — Stage 3)
 * ===========================================================================
 * 1. Quote-Aware Shell Parser: Strips single/double-quoted string literals to prevent
 *    false positives (e.g., `echo "rm -rf /"`), while recursively extracting `$(...)`
 *    and backtick `` `...` `` subshells (even inside double quotes) to prevent bypasses.
 * 2. Read-Only Bash Exemption: Allows safe read-only commands (`grep`, `cat`, `head`, etc.)
 *    on non-secret `.Friday/` and `schemas/` files without false-positive blocks.
 * 3. Unconditional Credential Protection (`SEC-CRED`): Protects `auth.json`, `.env*`, SSH keys.
 * 4. Brain & Schema Lock (`SEC-BRAIN` / `SEC-SCHEMA`): Prevents unauthorized mutation of
 *    `.Friday/` and `schemas/` (blocks in headless/subagent mode, prompts in UI mode).
 * 5. Portability Guard (`SEC-PORTABILITY`): Blocks `write`/`edit` from writing local machine
 *    absolute paths (`/home/<user>`, `/Users/<user>`, `file:///`) into repository files.
 * 6. Self-Healing Remediation (`RemediationPointer`): Every block includes actionable guidance.
 */

import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { type ExtensionAPI, type ExtensionContext, getAgentDir } from "@earendil-works/pi-coding-agent";

const FILE_TOOLS = new Set(["read", "write", "edit", "grep", "find", "ls"]);

const SECRET_FILE_PATTERNS = [
	/(?:^|[\\/\s"'=])(?:\.Friday[\\/])?auth\.json(?:$|[\s"';&|)])/i,
	/(?:^|[\\/])auth\.json$/i,
	/(?:^|[\\/\s"'=])\.env(?:\.[a-zA-Z0-9._-]+)?(?:$|[\s"';&|)])/i,
	/(?:^|[\\/])\.env(?:\.[a-zA-Z0-9._-]+)?$/i,
	/(?:^|[\\/])id_(?:rsa|ed25519|ecdsa)$/i,
	/(?:^|[\\/])application_default_credentials\.json$/i,
];

const DESTRUCTIVE_BASH_PATTERNS: Array<{
	id: string;
	pattern: RegExp;
	desc: string;
	remediation: string;
}> = [
	{
		id: "SEC-CMD-01",
		pattern:
			/\brm\s+(?:-[a-zA-Z]*r[a-zA-Z]*f|-[a-zA-Z]*f[a-zA-Z]*r|--recursive)\s+(?:\/(?:\s|$|[;&|*])|\.\.(?:\/|\s|$)|~(?:\/|\s|$)|\$HOME\b)/i,
		desc: "遞迴刪除根目錄、上層目錄或家目錄",
		remediation: "請僅針對專案工作區 (ctx.cwd) 內之明確子目錄或單一檔案進行清理，嚴禁對 /、.. 或 ~ 執行 rm -rf。",
	},
	{
		id: "SEC-CMD-02",
		pattern: /\b(?:mkfs|fdisk|parted|wipefs)\b/i,
		desc: "磁碟格式化或分割表破壞指令",
		remediation: "系統磁碟管理工具屬於高風險操作，請改由使用者手動於終端機執行。",
	},
	{
		id: "SEC-CMD-03",
		pattern: /\bdd\s+if=.*of=\/dev\//i,
		desc: "直接覆寫區塊裝置 (/dev/*)",
		remediation: "禁止直接寫入 /dev/* 區塊裝置；一般檔案測試請輸出至專案目錄下的相對路徑檔案。",
	},
	{
		id: "SEC-CMD-04",
		pattern: /\b(?:curl|wget)\b[^|]*\|\s*(?:ba)?sh\b/i,
		desc: "未經驗證之遠端腳本管線直執 (curl|sh)",
		remediation: "請先將遠端檔案下載至專案暫存區並使用 read 檢視內容確認安全後，再明確執行。",
	},
	{
		id: "SEC-CMD-05",
		pattern: /\b(?:chmod|chown)\s+-R\s+777\s+\//i,
		desc: "全域權限破壞 (chmod -R 777 /)",
		remediation: "請僅對專案內必要之單一腳本設定最小權限（例如 chmod +x scripts/foo.sh 或 chmod 600）。",
	},
	{
		id: "SEC-CMD-06",
		pattern: /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/,
		desc: "Fork Bomb 阻斷服務攻擊",
		remediation: "嚴禁執行任何形式的無窮遞迴程序衍生 (Fork Bomb)。",
	},
];

const SAFE_SYSTEM_PREFIXES = ["/dev/null", "/dev/stdout", "/dev/stderr", "/dev/fd", "/proc/self"];

const READ_ONLY_COMMANDS = new Set([
	"cat",
	"head",
	"tail",
	"less",
	"more",
	"grep",
	"egrep",
	"fgrep",
	"rg",
	"find",
	"ls",
	"stat",
	"wc",
	"file",
	"diff",
	"echo",
	"printf",
	"pwd",
	"which",
	"type",
	"uname",
	"whoami",
	"id",
	"date",
	"true",
	"false",
]);

export function formatRemediation(code: string, message: string, pointer: string): string {
	return `🛡️ [Friday Guard | ${code}] ${message}\n🔧 [RemediationPointer | 自癒處方籤]: ${pointer}`;
}

/**
 * Quote-Aware Shell Parser & Recursive Subshell Extractor (Stage 3):
 * - Strips single-quoted (`'...'`) and double-quoted (`"..."`) string literals from the top-level
 *   command (replacing them with `__QUOTED__`) so `echo "rm -rf /"` is never falsely flagged.
 * - Extracts any `$(...)` and `` `...` `` subshell commands (both unquoted and inside double quotes!)
 *   recursively so hidden commands like `echo "$(rm -rf /)"` or `echo "$(cat .Friday/auth.json)"`
 *   are still inspected as executable commands.
 */
export function parseShellCommandQuoteAware(command: string): {
	unquotedCommand: string;
	subshells: string[];
	allExecutableSegments: string[];
} {
	const subshells: string[] = [];

	function extractFromSegment(src: string, depth: number): string {
		if (depth > 8) return src;
		let out = "";
		let i = 0;
		let mode: "none" | "single" | "double" = "none";

		while (i < src.length) {
			const ch = src[i];

			if (mode === "single") {
				if (ch === "'") {
					mode = "none";
					out += "__SQ__";
				}
				i++;
				continue;
			}

			// Escape sequence outside single quotes
			if (ch === "\\") {
				i += 2;
				continue;
			}

			// Handle $(...) subshell (active in both "none" and "double" quote modes!)
			if (ch === "$" && src[i + 1] === "(") {
				let parenDepth = 1;
				let j = i + 2;
				let subMode: "none" | "single" | "double" = "none";
				while (j < src.length && parenDepth > 0) {
					const c = src[j];
					if (subMode === "single") {
						if (c === "'") subMode = "none";
						j++;
						continue;
					}
					if (c === "\\") {
						j += 2;
						continue;
					}
					if (subMode === "double") {
						if (c === '"') subMode = "none";
						else if (c === "(" && src[j - 1] === "$") parenDepth++;
						j++;
						continue;
					}
					if (c === "'") subMode = "single";
					else if (c === '"') subMode = "double";
					else if (c === "(") parenDepth++;
					else if (c === ")") parenDepth--;
					j++;
				}
				const inner = src.slice(i + 2, Math.max(i + 2, j - 1)).trim();
				if (inner) {
					const cleanedInner = extractFromSegment(inner, depth + 1);
					subshells.push(cleanedInner);
				}
				out += " __SUBSHELL__ ";
				i = j;
				continue;
			}

			// Handle `...` backtick subshell (active in both "none" and "double" quote modes!)
			if (ch === "`") {
				let j = i + 1;
				while (j < src.length && src[j] !== "`") {
					if (src[j] === "\\") j += 2;
					else j++;
				}
				const inner = src.slice(i + 1, j).trim();
				if (inner) {
					const cleanedInner = extractFromSegment(inner, depth + 1);
					subshells.push(cleanedInner);
				}
				out += " __SUBSHELL__ ";
				i = j + 1;
				continue;
			}

			if (mode === "double") {
				if (ch === '"') {
					mode = "none";
					out += "__DQ__";
				}
				i++;
				continue;
			}

			// mode === "none"
			if (ch === "'") {
				mode = "single";
				i++;
				continue;
			}
			if (ch === '"') {
				mode = "double";
				i++;
				continue;
			}

			out += ch;
			i++;
		}

		return out;
	}

	const unquotedCommand = extractFromSegment(command, 0);
	return {
		unquotedCommand,
		subshells,
		allExecutableSegments: [unquotedCommand, ...subshells],
	};
}

/**
 * Determines whether an unquoted shell command segment is purely read-only
 * (no redirections `>`, `tee`, `sed -i`, or mutating binaries).
 */
export function isReadOnlyBashCommand(unquotedSegment: string): boolean {
	// Reject any output redirection (> or >>) outside of safe fd redirects like 2>&1 or 2>/dev/null
	const strippedSafeRedirects = unquotedSegment
		.replace(/\b\d*>&\d+\b/g, "")
		.replace(/\b\d*>+\s*\/dev\/null\b/g, "");
	if (/>/.test(strippedSafeRedirects)) {
		return false;
	}

	// Reject in-place mutation flags or mutating commands
	if (/\bsed\b[^;|&]*\s-[a-zA-Z]*i\b/.test(unquotedSegment)) {
		return false;
	}
	if (/\b(?:tee|rm|mv|cp|chmod|chown|touch|mkdir|rmdir|ln|dd|truncate|patch|install)\b/.test(unquotedSegment)) {
		return false;
	}
	if (/\b(?:python3?|node|perl|ruby)\s+-(?:c|e)\b/.test(unquotedSegment)) {
		return false;
	}

	// Split by command separators (|, &&, ||, ;) and verify every sub-command starts with a read-only utility
	const parts = unquotedSegment
		.split(/\|\||&&|[|;\n]/)
		.map((s) => s.trim())
		.filter(Boolean);

	if (parts.length === 0) return true;

	for (const part of parts) {
		// Strip leading env assignments like FOO=bar
		const tokens = part.split(/\s+/).filter((t) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(t));
		if (tokens.length === 0) continue;
		const cmd = path.basename(tokens[0]);

		if (cmd === "__SUBSHELL__") continue;
		if (READ_ONLY_COMMANDS.has(cmd)) continue;

		if (cmd === "git") {
			const sub = tokens[1] ?? "";
			if (["status", "diff", "log", "show", "branch", "rev-parse", "ls-files", "remote"].includes(sub)) {
				continue;
			}
			return false;
		}

		if (cmd === "python" || cmd === "python3") {
			const scriptArg = tokens[1] ?? "";
			if (
				scriptArg.endsWith("schema_validator.py") ||
				scriptArg.endsWith("auto_update_map.py") ||
				tokens.includes("--help") ||
				tokens.includes("--version")
			) {
				continue;
			}
			return false;
		}

		return false;
	}

	return true;
}

/**
 * Checks whether content being written/edited into a governed file leaks machine-specific absolute paths.
 */
export function checkPortabilityViolation(content: string, cwd: string): { violated: boolean; matched?: string } {
	if (!content) return { violated: false };
	const homeDir = os.homedir();
	const patterns: RegExp[] = [
		new RegExp(homeDir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"),
		new RegExp(cwd.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"),
		/\bfile:\/\/\/(?:home|Users|root|var|tmp|opt)\/[^\s)"'`>]+/i,
		/(?:^|[\s"'`=(])\/(?:home|Users)\/[a-zA-Z0-9._-]+\/[^\s)"'`>]+/,
	];

	for (const pat of patterns) {
		const m = pat.exec(content);
		if (m) {
			return { violated: true, matched: m[0].trim() };
		}
	}
	return { violated: false };
}

function resolveRealTarget(rawPath: string, cwd: string): string {
	const expanded = rawPath.startsWith("~/")
		? path.join(os.homedir(), rawPath.slice(2))
		: rawPath === "~"
			? os.homedir()
			: rawPath;
	const abs = path.resolve(cwd, expanded);
	try {
		return fs.realpathSync(abs);
	} catch {
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

export function extractPathsFromBash(unquotedCommand: string): string[] {
	const candidates = new Set<string>();
	const regex =
		/(?:^|\s|[=><])((?:\/[a-zA-Z0-9._-]+){1,}|~\/[a-zA-Z0-9._/-]+|\.\.\/[a-zA-Z0-9._/-]*|\.?\/?\.Friday(?:\/[a-zA-Z0-9._/-]*)?|\.?\/?schemas(?:\/[a-zA-Z0-9._/-]*)?)/g;
	let match: RegExpExecArray | null;
	while ((match = regex.exec(unquotedCommand)) !== null) {
		const token = match[1].trim();
		if (!token) continue;
		if (SAFE_SYSTEM_PREFIXES.some((p) => token === p || token.startsWith(`${p}/`))) continue;
		if (token.startsWith("//") || token.includes("://")) continue;
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
		isReadOnlyBash = false,
	): Promise<{ allowed: boolean; reason?: string }> {
		const target = resolveRealTarget(rawPath, ctx.cwd);
		const agentDir = getAgentDir();
		const schemasDir = path.join(ctx.cwd, "schemas");

		// 1. Unconditional Secret & Credential Protection (SEC-CRED) — NEVER exempted even for read-only!
		if (SECRET_FILE_PATTERNS.some((p) => p.test(target) || p.test(rawPath))) {
			return {
				allowed: false,
				reason: formatRemediation(
					"SEC-CRED",
					`嚴格禁止存取機密憑證或金鑰檔案: ${rawPath}`,
					"憑證由 pi 執行期自動載入。若需引導使用者設定金鑰，請提示使用者執行 `/mode` 或 `/login`，切勿直接讀取 auth.json 或 .env。",
				),
			};
		}

		const isReadOnlyOperation =
			toolName === "read" ||
			toolName === "ls" ||
			toolName === "find" ||
			toolName === "grep" ||
			(toolName === "bash" && isReadOnlyBash);

		// 2. Schema Validator Lock (SEC-SCHEMA): Prevent agent from tampering with schemas/
		if (isWithinDir(target, schemasDir)) {
			if (isReadOnlyOperation) {
				return { allowed: true };
			}
			if (!ctx.hasUI) {
				return {
					allowed: false,
					reason: formatRemediation(
						"SEC-SCHEMA",
						`Schema 防改鎖：禁止自動修改驗證器或契約規則目錄 -> ${target}`,
						"禁止透過修改 schemas/ 繞過驗證規則。請根據驗證器輸出的錯誤訊息，修正 memory/ 下的目標文件使其符合 Schema 規範。",
					),
				};
			}
			const optAllowSchema = "✅ 允許本次修改 schemas/ 驗證規則 (Allow once)";
			const optDenySchema = "❌ 拒絕修改 schemas/ 驗證規則 (Deny & Block)";
			const schemaChoice = await ctx.ui.select(
				[
					"🔒 [Friday Schema Lock | SEC-SCHEMA] 偵測到針對 schemas/ 決定性驗證器的修改請求！",
					`  • 觸發工具與動作: [${toolName}] ${operationDesc}`,
					`  • 目標解析路徑: ${target}`,
					"",
					"是否授權修改 Schema 驗證器？",
				].join("\n"),
				[optAllowSchema, optDenySchema],
			);
			if (schemaChoice === optAllowSchema) {
				ctx.ui.notify(`已單次授權修改 Schema 檔案: ${target}`, "info");
				return { allowed: true };
			}
			return {
				allowed: false,
				reason: formatRemediation(
					"SEC-SCHEMA",
					`使用者拒絕了對 schemas/ 目錄 (${target}) 的修改請求。`,
					"請保持 schemas/ 驗證規則不變，改為修正目標檔案內容以通過驗證。",
				),
			};
		}

		// 3. Brain Core Protection (SEC-BRAIN): Prevent agent from mutating .Friday/ without authorization
		if (isWithinDir(target, agentDir)) {
			if (isReadOnlyOperation) {
				return { allowed: true };
			}
			if (!ctx.hasUI) {
				return {
					allowed: false,
					reason: formatRemediation(
						"SEC-BRAIN",
						`大腦核心保護：禁止自動修改或寫入 .Friday 大腦設定與擴充檔 -> ${target}`,
						"子代理與非互動模式嚴禁修改 .Friday/。請僅使用唯讀工具 (read/grep) 檢視設定，或由使用者透過 `/mode` 指令變更配置。",
					),
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
				reason: formatRemediation(
					"SEC-BRAIN",
					`使用者拒絕了對 .Friday 大腦核心目錄 (${target}) 的修改請求。`,
					"請勿直接改寫 .Friday/ 核心檔案；若需切換模型請提示使用者使用 `/mode`。",
				),
			};
		}

		// 4. Allow anything inside current project workspace (ctx.cwd) outside .Friday and schemas
		if (isWithinDir(target, ctx.cwd)) {
			return { allowed: true };
		}

		// 5. Allow session-trusted external directories
		for (const trusted of sessionTrustedDirs) {
			if (isWithinDir(target, trusted)) {
				return { allowed: true };
			}
		}

		// 6. Out-of-bounds detected!
		if (!ctx.hasUI) {
			return {
				allowed: false,
				reason: formatRemediation(
					"BOUNDARY",
					`越界攔截：非互動/子代理模式禁止存取專案工作區 (${ctx.cwd}) 以外之路徑 -> ${target}`,
					`請將所有檔案讀寫與檢索限制於專案工作區 (${ctx.cwd}) 內部之相對路徑。`,
				),
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
			reason: formatRemediation(
				"BOUNDARY",
				`使用者拒絕了對專案工作區外部路徑 (${target}) 的存取請求。`,
				`請改用專案工作區 (${ctx.cwd}) 內的相對路徑檔案完成任務。`,
			),
		};
	}

	pi.on("session_start", async (_event, ctx) => {
		if (ctx.hasUI) {
			ctx.ui.setStatus("friday-guard", `🛡️ Lock:${path.basename(ctx.cwd)}`);
		}
	});

	pi.on("user_bash", async (event, _ctx) => {
		const command = event.command || "";
		const parsed = parseShellCommandQuoteAware(command);
		for (const seg of parsed.allExecutableSegments) {
			for (const rule of DESTRUCTIVE_BASH_PATTERNS) {
				if (rule.pattern.test(seg)) {
					return {
						result: {
							output: formatRemediation(
								rule.id,
								`已攔截高風險指令 (${rule.desc}):\n  ${command}`,
								rule.remediation,
							),
							exitCode: 126,
							cancelled: false,
							truncated: false,
						},
					};
				}
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
			const check = await verifyPathAccess(rawPath, toolName, `${toolName}(${rawPath})`, ctx, false);
			if (!check.allowed) {
				return { block: true, reason: check.reason ?? "Blocked by Friday Workspace Guard" };
			}

			// Stage 3 & M7: SEC-DOC-GOVERNANCE + SEC-PORTABILITY check on write / edit
			if (toolName === "write" || toolName === "edit") {
				const target = resolveRealTarget(rawPath, ctx.cwd);
				const relToCwd = path.relative(ctx.cwd, target).replace(/\\/g, "/");

				// M7 & D1: SEC-DOC-GOVERNANCE — Only block unmanaged .md files created directly in the project root directory
				// (outside memory/ and .Friday/, subdirectories like scratch/, .staging/, src/, tests/, docs/ are freely allowed).
				if (target.toLowerCase().endsWith(".md") && !relToCwd.startsWith("..")) {
					const isUnmanagedRootMarkdown =
						!relToCwd.includes("/") && relToCwd !== "README.md" && relToCwd !== "AGENTS.md";
					if (isUnmanagedRootMarkdown) {
						return {
							block: true,
							reason: formatRemediation(
								"SEC-DOC-GOVERNANCE",
								`🛡️ [SEC-DOC-GOVERNANCE] 禁止在專案根目錄直接建立未納管的幽靈 Markdown 文件 (${rawPath}，根目錄僅允許 README.md 與 AGENTS.md)！`,
								"受治理架構規格請寫入 memory/specs/ 或 memory/private/specs/（決策寫入 memory/decisions/、驗收寫入 memory/audits/、進度寫入 memory/LEDGER.md）並附上合規 YAML 標頭；臨時草稿或測試筆記請寫入 scratch/ 等子目錄。",
							),
						};
					}
				}

				const isGovernedDocOrConfig =
					relToCwd.startsWith("memory/") ||
					relToCwd === "README.md" ||
					relToCwd === "AGENTS.md" ||
					relToCwd.startsWith(".Friday/");

				if (isGovernedDocOrConfig) {
					const writtenText = [
						typeof input.content === "string" ? input.content : "",
						typeof input.newText === "string" ? input.newText : "",
						typeof input.new_str === "string" ? input.new_str : "",
						typeof input.replacement === "string" ? input.replacement : "",
					].join("\n");

					const portability = checkPortabilityViolation(writtenText, ctx.cwd);
					if (portability.violated) {
						return {
							block: true,
							reason: formatRemediation(
								"SEC-PORTABILITY",
								`禁止將本機絕對路徑或個人家目錄路徑 ("${portability.matched}") 寫入受納管檔案 (${rawPath})！`,
								`為確保專案 100% 跨機可攜性 (Portable Brain)，請將路徑改寫為相對於專案根目錄的相對路徑（例如將 "${ctx.cwd}/foo/bar.md" 改為 "foo/bar.md" 或 "<WORKSPACE_ROOT>/foo/bar.md"）。`,
							),
						};
					}
				}
			}

			return undefined;
		}

		// B. Check bash tool commands (Quote-Aware + Recursive Subshell Inspection)
		if (toolName === "bash") {
			const command = String((event.input as Record<string, unknown>).command ?? "");
			const parsed = parseShellCommandQuoteAware(command);

			// 1. Check SEC-CMD-V1 destructive patterns across top-level unquoted command AND all subshells
			for (const seg of parsed.allExecutableSegments) {
				for (const rule of DESTRUCTIVE_BASH_PATTERNS) {
					if (rule.pattern.test(seg)) {
						return {
							block: true,
							reason: formatRemediation(
								rule.id,
								`攔截毀滅性指令 (${rule.desc}): ${command}`,
								rule.remediation,
							),
						};
					}
				}
			}

			// 2. Check if any unquoted command or subshell references secret files directly (SEC-CRED)
			for (const seg of parsed.allExecutableSegments) {
				if (SECRET_FILE_PATTERNS.some((p) => p.test(seg))) {
					return {
						block: true,
						reason: formatRemediation(
							"SEC-CRED",
							`禁止透過 bash 或子殼層存取機密金鑰與憑證檔 (auth.json / .env): ${command}`,
							"憑證由系統自動注入，請勿以 cat/grep/bash 探測 auth.json 或 .env；若需變更金鑰請引導使用者執行 `/mode`。",
						),
					};
				}
			}

			// 3. Extract paths from each executable segment and verify boundary + read-only exemptions
			const displayCmd = command.length > 1000 ? `${command.slice(0, 1000)}...` : command;
			for (const seg of parsed.allExecutableSegments) {
				const segReadOnly = isReadOnlyBashCommand(seg);
				const extractedPaths = extractPathsFromBash(seg);
				// Also scan inside quoted strings when executing non-read-only commands (e.g. `python3 -c "open('schemas/...', 'w')"`)
				if (!segReadOnly) {
					const quotedMatches = command.match(/(?:schemas\/|\.Friday\/|memory\/LEDGER\.md)[^\s"'`)]*/g) ?? [];
					for (const qm of quotedMatches) {
						if (!extractedPaths.includes(qm)) {
							extractedPaths.push(qm);
						}
					}
				}
				for (const rawPath of extractedPaths) {
					const check = await verifyPathAccess(rawPath, "bash", displayCmd, ctx, segReadOnly);
					if (!check.allowed) {
						return { block: true, reason: check.reason ?? "Blocked by Friday Workspace Guard" };
					}
				}
			}
		}

		return undefined;
	});

	pi.registerCommand("guard", {
		description:
			"檢視或重設 Friday 工作區邊界防護狀態，或執行架構驗證與索引更新: /guard [reset|validate]",
		handler: async (args, ctx) => {
			const sub = args.trim().toLowerCase().split(/\s+/)[0] ?? "";
			if (sub === "reset") {
				sessionTrustedDirs.clear();
				ctx.ui.notify("🛡️ 已清空所有外部臨時授權目錄，嚴格鎖定回目前專案目錄。", "info");
				return;
			}
			if (sub === "validate") {
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
					`🛡️ Friday Workspace Guard (Stage 3) 狀態`,
					`• 鎖定專案工作區 (ctx.cwd): ${ctx.cwd}`,
					`• Friday 大腦目錄 (SEC-BRAIN): ${getAgentDir()}`,
					`• Schema 驗證鎖定 (SEC-SCHEMA): ${path.join(ctx.cwd, "schemas")}`,
					`• 啟用防護: 引號感知剖析 / 子殼層遞迴拆解 / 唯讀指令豁免 / SEC-PORTABILITY / 自癒處方籤`,
					`• 已臨時信任之外部目錄:\n${trustedList}`,
					`• 子指令: /guard reset (重設外部目錄授權) | /guard validate (執行 schema_validator.py --run-oracle 全庫驗證)`,
				].join("\n"),
				"info",
			);
		},
	});
}
