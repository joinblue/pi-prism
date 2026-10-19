/**
 * Friday Orchestrator-First Router & Specialist Dispatcher (Pillar 3 - model-router.ts)
 * =====================================================================================
 * Stage 1+ & Router Handoff (M1 ~ M5) Upgrade:
 * 1. Anti-Hijack Main Orchestrator (`route()` 100% locked to `ROLE_MODELS.orchestrator`):
 *    Never hijacks main conversation history to 30B `vision` on image attachments; all image
 *    analysis is offloaded to `dispatch_specialist(specialist="vision", imagePath="...")` so
 *    image Base64 tokens never pollute the flagship orchestrator's context or break KV Cache.
 * 2. Zero-Cold-Start Specialist Dispatch Tool (`dispatch_specialist`) with Auto-Fallback Chain (M2)
 *    and Direct Multi-File Offload (`filePaths: string[]`, M3):
 *    Never falls back to `ROLE_MODELS.orchestrator` (protecting flagship tokens) and automatically
 *    iterates `ROLE_FALLBACK_CHAINS[role]` on `ResourceExhausted` / `429` / `5xx`.
 * 3. Tool-Call Token Offload Gate (M4) & Dual Strategy Modes (`apex-commander` | `hybrid-synergy`, M5):
 *    Hard-blocks direct image `read` and excessive multi-file `read` in `apex-commander` mode,
 *    and injects dynamic `[MANDATE]` directives on `before_agent_start`.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { type ImageContent, type Message, StringEnum, type TextContent } from "@earendil-works/pi-ai";
import {
	detectSupportedImageMimeTypeFromFile,
	type ExtensionAPI,
	type ExtensionContext,
	getAgentDir,
	type ModelRoute,
	type ModelRouteRequest,
	resizeImage,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const DEFAULT_PROVIDER = "nvidia";

export const DEFAULT_ROLE_MODELS = {
	orchestrator: "nvidia/nemotron-3-super-120b-a12b",
	scout: "z-ai/glm-5.3-flash",
	architect: "nvidia/nemotron-3-super-120b-a12b",
	challenger: "deepseek-ai/deepseek-v4.1-flash",
	code: "poolside/laguna-xs-2.1",
	audit: "z-ai/glm-5.3-flash",
	vision: "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning",
} as const;

export type RoleName = keyof typeof DEFAULT_ROLE_MODELS;
export type SpecialistRole = Exclude<RoleName, "orchestrator">;
export type StrategyMode = "apex-commander" | "hybrid-synergy";
type RouterPhase = "auto" | RoleName;

export const ROLE_FALLBACK_CHAINS: Record<SpecialistRole, string[]> = {
	scout: [
		"z-ai/glm-5.3-flash",
		"nvidia/nemotron-3.5-lightning-30b-a3b",
		"nvidia/nemotron-3-ultra-550b-a55b",
		"deepseek-ai/deepseek-v4.1-flash",
		"nvidia/nemotron-3-super-120b-a12b",
	],
	architect: [
		"nvidia/nemotron-3-super-120b-a12b",
		"nvidia/nemotron-3-ultra-550b-a55b",
		"nvidia/nemotron-3.5-lightning-30b-a3b",
		"z-ai/glm-5.3",
		"z-ai/glm-5.3-flash",
	],
	challenger: [
		"deepseek-ai/deepseek-v4.1-flash",
		"nvidia/nemotron-3-ultra-550b-a55b",
		"nvidia/nemotron-3.5-lightning-30b-a3b",
		"z-ai/glm-5.3",
		"nvidia/nemotron-3-nano-omni-30b-a3b-reasoning",
		"z-ai/glm-5.3-flash",
	],
	code: [
		"poolside/laguna-xs-2.1",
		"nvidia/nemotron-3-ultra-550b-a55b",
		"nvidia/nemotron-3.5-lightning-30b-a3b",
		"z-ai/glm-5.3",
		"deepseek-ai/deepseek-v4.1-flash",
		"z-ai/glm-5.3-flash",
	],
	audit: [
		"z-ai/glm-5.3-flash",
		"nvidia/nemotron-3.5-lightning-30b-a3b",
		"nvidia/nemotron-3-ultra-550b-a55b",
		"deepseek-ai/deepseek-v4.1-flash",
		"nvidia/nemotron-3-super-120b-a12b",
	],
	vision: [
		"nvidia/nemotron-3-nano-omni-30b-a3b-reasoning",
		"meta/llama-3.2-11b-vision-instruct",
		"z-ai/glm-5.3-flash",
		"deepseek-ai/deepseek-v4.1-flash",
		"google/diffusiongemma-26b-a4b-it",
	],
};

export const ROLE_MODELS: Record<RoleName, string> = { ...DEFAULT_ROLE_MODELS };
export let STRATEGY_MODE: StrategyMode = "apex-commander";

const ROLE_LABELS: Record<RoleName, string> = {
	orchestrator: "主腦 (Orchestrator - 負責統籌與規劃)",
	scout: "探索員 (Scout - 高速檢索與 Context 壓縮)",
	architect: "架構師 (Architect - 系統設計與 ADR)",
	challenger: "審查官 (Challenger - 跨模型紅隊找碴)",
	code: "工程師 (Code/Worker - 程式碼實作與重構)",
	audit: "稽核官 (Audit/Auditor - 驗證與品質把關)",
	vision: "視覺專家 (Vision - 圖片與圖表多模態解析)",
};

const STRATEGY_LABELS: Record<StrategyMode, string> = {
	"apex-commander": "模式一：極致旗艦統帥省流模式 (Apex Commander — 預設，強制省流閘門 + 免費專家代讀/代工)",
	"hybrid-synergy": "模式二：雙腦協同對抗模式 (Hybrid Synergy — 複合主腦 + 架構/紅隊雙腦共創)",
};

const ROLE_TO_AGENT_FILE: Partial<Record<RoleName, string>> = {
	scout: "scout.md",
	architect: "architect.md",
	challenger: "challenger.md",
	code: "worker.md",
	audit: "auditor.md",
};

interface FridayRouterState {
	phase: RouterPhase;
	modelId: string;
	reason: string;
}

type FridayRouteRequest = ModelRouteRequest<FridayRouterState>;

function getRoleModelsFilePath(): string {
	return path.join(getAgentDir(), "role-models.json");
}

function getAuthFilePath(): string {
	return path.join(getAgentDir(), "auth.json");
}

const NON_NVIDIA_PROVIDER_PREFIXES = [
	"google-vertex/",
	"google-antigravity/",
	"google-gemini-cli/",
	"anthropic/",
	"openrouter/",
	"ollama/",
	"vllm/",
];

function toProviderQualifiedModelSpec(spec: string): string {
	const trimmed = spec.trim();
	if (NON_NVIDIA_PROVIDER_PREFIXES.some((p) => trimmed.startsWith(p))) {
		return trimmed;
	}
	if (
		trimmed.startsWith("nvidia/nvidia/") ||
		trimmed.startsWith("nvidia/z-ai/") ||
		trimmed.startsWith("nvidia/deepseek-ai/") ||
		trimmed.startsWith("nvidia/poolside/") ||
		trimmed.startsWith("nvidia/meta/") ||
		trimmed.startsWith("nvidia/google/") ||
		trimmed.startsWith("nvidia/openai/")
	) {
		return trimmed;
	}
	return `${DEFAULT_PROVIDER}/${trimmed}`;
}

function syncAgentMarkdownModel(role: RoleName, fullModelSpec: string): void {
	const fileName = ROLE_TO_AGENT_FILE[role];
	if (!fileName) return;
	const agentPath = path.join(getAgentDir(), "agents", fileName);
	if (!fs.existsSync(agentPath)) return;
	try {
		const normalizedFull = toProviderQualifiedModelSpec(fullModelSpec);
		const content = fs.readFileSync(agentPath, "utf-8");
		const updated = content.replace(/^model:\s*.+$/m, `model: ${normalizedFull}`);
		if (updated !== content) {
			fs.writeFileSync(agentPath, updated, "utf-8");
		}
	} catch {
		// Best-effort sync
	}
}

function loadPersistedRoleModels(): void {
	const filePath = getRoleModelsFilePath();
	if (!fs.existsSync(filePath)) return;
	try {
		const raw = JSON.parse(fs.readFileSync(filePath, "utf-8"));
		for (const role of Object.keys(DEFAULT_ROLE_MODELS) as RoleName[]) {
			if (typeof raw?.[role] === "string" && raw[role].trim()) {
				ROLE_MODELS[role] = raw[role].trim();
				syncAgentMarkdownModel(role, ROLE_MODELS[role]);
			}
		}
		if (raw?.strategyMode === "apex-commander" || raw?.strategyMode === "hybrid-synergy") {
			STRATEGY_MODE = raw.strategyMode;
		}
	} catch {
		// Ignore malformed file and keep defaults
	}
}

function savePersistedRoleModels(): void {
	const filePath = getRoleModelsFilePath();
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	const payload = {
		...ROLE_MODELS,
		strategyMode: STRATEGY_MODE,
	};
	fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf-8");
}

function readAuthJson(): Record<string, any> {
	const authPath = getAuthFilePath();
	if (!fs.existsSync(authPath)) return {};
	try {
		return JSON.parse(fs.readFileSync(authPath, "utf-8")) ?? {};
	} catch {
		return {};
	}
}

function writeAuthJson(data: Record<string, any>): void {
	const authPath = getAuthFilePath();
	fs.mkdirSync(path.dirname(authPath), { recursive: true });
	fs.writeFileSync(authPath, `${JSON.stringify(data, null, 2)}\n`, { encoding: "utf-8", mode: 0o600 });
	try {
		fs.chmodSync(authPath, 0o600);
	} catch {
		// Ignore chmod errors on non-POSIX filesystems
	}
}

function loadCompactIndexSummary(cwd: string): string {
	const indexPath = path.join(cwd, "memory", "index", "CONTEXT_INDEX.json");
	if (!fs.existsSync(indexPath)) return "";
	try {
		const raw = JSON.parse(fs.readFileSync(indexPath, "utf-8"));
		const lines: string[] = ["\n[Project Governed Memory Index (CONTEXT_INDEX.json)]:"];
		const registry = raw.domain_registry ?? {};
		for (const [code, section] of Object.entries<any>(registry)) {
			for (const item of section?.items ?? []) {
				if (item.status === "archived" || item.status === "deprecated") continue;
				lines.push(`- [${code} | ${item.node_key} | ${item.node_id}] ${item.summary_1line} (${item.path})`);
			}
		}
		return lines.join("\n");
	} catch {
		return "";
	}
}

function buildSpecialistSystemPrompt(role: SpecialistRole): string {
	const modelSpec = ROLE_MODELS[role];
	const prompts: Record<SpecialistRole, string> = {
		scout: [
			`你是 Friday 團隊中的 Scout (高速情報探索員)，搭載 ${modelSpec}。`,
			"職責：快速檢索摘要、定位關鍵結構與事實，所有客觀結論必須標註 [FACT]，推論標註 [INFERRED]，保持極簡高信噪比。",
		].join("\n"),
		architect: [
			`你是 Friday 團隊中的 Architect (首席系統架構師)，搭載 ${modelSpec} 旗艦推理模型。`,
			"職責：擬定結構嚴謹的系統設計與 ADR 決策，明確區分 [FACT]、[INFERRED] 與 [HYPOTHESIS]，並定義可證偽驗證條件 (falsifiable_criterion)。",
		].join("\n"),
		challenger: [
			`你是 Friday 團隊中的 Challenger (跨模型紅隊對抗審查官)，搭載 ${modelSpec} 異體推理模型。`,
			"核心鐵律 (Anti-Sycophancy Protocol)：絕對禁止盲目附和提案者！專職找出一廂情願的假設、邊界漏洞與未驗證臆測，最後給出 VERDICT: APPROVED 或 VERDICT: CHALLENGED。",
		].join("\n"),
		code: [
			`你是 Friday 團隊中的 Worker/Code Specialist (專精程式碼工程師)，搭載 ${modelSpec} 模型。`,
			"職責：根據規格與審查意見，產出高品質、無副作用、具備嚴謹錯誤處理的程式碼或修補方案，嚴禁硬編碼本機絕對路徑。",
		].join("\n"),
		audit: [
			`你是 Friday 團隊中的 Auditor (獨立神諭驗收稽核官)，搭載 ${modelSpec} 模型。`,
			"職責：根據客觀驗證輸出、Schema 規則與測試結果進行嚴格核對，標註 [FACT] 並給出明確驗收結論。",
		].join("\n"),
		vision: [
			`你是 Friday 團隊中的 Vision Specialist (多模態視覺推理專家)，搭載 ${modelSpec} 模型。`,
			"職責：精確解析圖片、圖表、UI 結構與視覺資訊，標註 [FACT] 與 [INFERRED]，使用繁體中文回報。",
		].join("\n"),
	};
	return prompts[role];
}

/**
 * Checks whether the current turn (from the latest user message onwards, including
 * any `toolResult` messages such as `read` on an image file) contains an image block.
 */
export function hasImageAttachment(messages: readonly Message[]): boolean {
	let lastUserIdx = -1;
	for (let i = messages.length - 1; i >= 0; i--) {
		if (messages[i]?.role === "user") {
			lastUserIdx = i;
			break;
		}
	}
	const recentSlice = lastUserIdx >= 0 ? messages.slice(lastUserIdx) : messages;
	for (const msg of recentSlice) {
		if (msg.role !== "user" && msg.role !== "toolResult") continue;
		if (!Array.isArray(msg.content)) continue;
		for (const block of msg.content) {
			if (block && typeof block === "object" && "type" in block && block.type === "image") {
				return true;
			}
		}
	}
	return false;
}

function inferImageMimeTypeFromExtension(filePath: string): string | null {
	const ext = path.extname(filePath).toLowerCase();
	switch (ext) {
		case ".jpg":
		case ".jpeg":
			return "image/jpeg";
		case ".png":
			return "image/png";
		case ".webp":
			return "image/webp";
		case ".gif":
			return "image/gif";
		default:
			return null;
	}
}

function extractImagePathFromText(text: string): string | undefined {
	if (!text) return undefined;
	const match = text.match(/(?:\/|~\/|\.\.?\/|[a-zA-Z0-9_.-]+\/)[^\s"'`<>]+?\.(?:jpg|jpeg|png|webp|gif)/i);
	return match?.[0];
}

async function loadImageBlockFromFile(
	rawPath: string,
	cwd: string,
): Promise<{ block?: ImageContent; resolvedPath: string; error?: string }> {
	const cleaned = rawPath.trim().replace(/^['"]|['"]$/g, "");
	const resolvedPath = path.isAbsolute(cleaned) ? cleaned : path.resolve(cwd, cleaned);
	if (!fs.existsSync(resolvedPath)) {
		return { resolvedPath, error: `找不到圖片檔案: ${resolvedPath}` };
	}
	try {
		const detectedMime =
			(await detectSupportedImageMimeTypeFromFile(resolvedPath)) ?? inferImageMimeTypeFromExtension(resolvedPath);
		if (!detectedMime) {
			return { resolvedPath, error: `不支援的圖片格式: ${resolvedPath}` };
		}
		const bytes = new Uint8Array(fs.readFileSync(resolvedPath));
		const resized = await resizeImage(bytes, detectedMime);
		if (resized) {
			return {
				resolvedPath,
				block: {
					type: "image",
					data: resized.data,
					mimeType: resized.mimeType,
				},
			};
		}
		return {
			resolvedPath,
			block: {
				type: "image",
				data: Buffer.from(bytes).toString("base64"),
				mimeType: detectedMime,
			},
		};
	} catch (err: any) {
		return { resolvedPath, error: `讀取圖片失敗 (${resolvedPath}): ${err?.message ?? String(err)}` };
	}
}

function findLatestImageBlockInSession(ctx: ExtensionContext): ImageContent | undefined {
	try {
		const entries = ctx.sessionManager.getEntries();
		for (let i = entries.length - 1; i >= 0; i--) {
			const entry = entries[i] as any;
			const msg = entry?.message;
			if (!msg || !Array.isArray(msg.content)) continue;
			for (const block of msg.content) {
				if (block && typeof block === "object" && block.type === "image" && block.data && block.mimeType) {
					return {
						type: "image",
						data: block.data,
						mimeType: block.mimeType,
					};
				}
			}
		}
	} catch {
		// Ignore session scan errors
	}
	return undefined;
}

function findConfiguredModel(ctx: ExtensionContext, spec: string) {
	if (!spec) return undefined;
	const trimmed = spec.trim();

	// 1. Exact full match `${m.provider}/${m.id}` across all known models
	const allModels = ctx.modelRegistry.getAll();
	const exactFull = allModels.find((m) => `${m.provider}/${m.id}` === trimmed);
	if (exactFull) return exactFull;

	// 2. Check `<provider>/<modelId>` split
	const slashIdx = trimmed.indexOf("/");
	if (slashIdx > 0) {
		const candidateProvider = trimmed.slice(0, slashIdx);
		const candidateId = trimmed.slice(slashIdx + 1);
		const bySplit = ctx.modelRegistry.find(candidateProvider, candidateId);
		if (bySplit) return bySplit;
	}

	// 3. Fallback: check default provider (`nvidia`) with `trimmed` as model ID
	const byDefault = ctx.modelRegistry.find(DEFAULT_PROVIDER, trimmed);
	if (byDefault) return byDefault;

	// 4. Fallback: match by `m.id === trimmed` in any provider
	return allModels.find((m) => m.id === trimmed);
}

function isProtectedSecretPath(resolvedPath: string): boolean {
	const base = path.basename(resolvedPath);
	if (base === "auth.json" || base === "application_default_credentials.json") return true;
	if (base === ".env" || (base.startsWith(".env.") && base !== ".env.example")) return true;
	return false;
}

const DispatchSpecialistParams = Type.Object({
	specialist: StringEnum(["scout", "architect", "challenger", "code", "audit", "vision"] as const, {
		description:
			"Target specialist role: scout (fast summary/indexing), architect (120B system design), challenger (cross-model anti-sycophancy review), code (Laguna code generation), audit (verification review), vision (multimodal image/chart analysis).",
	}),
	task: Type.String({
		description: "Clear, self-contained task instruction or review question for the specialist model.",
	}),
	context: Type.Optional(
		Type.String({
			description: "Optional supporting context (code snippets, file contents, or draft proposal to review).",
		}),
	),
	filePaths: Type.Optional(
		Type.Array(
			Type.String({
				description:
					"Optional list of workspace file paths to read directly in-process and attach to the specialist prompt (saves main orchestrator read tokens).",
			}),
		),
	),
	imagePath: Type.Optional(
		Type.String({
			description:
				"Optional path to a local image file (jpg/png/webp/gif) to attach as a multimodal image block when dispatching to the 'vision' specialist.",
		}),
	),
});

export default function (pi: ExtensionAPI) {
	loadPersistedRoleModels();
	let forcedMode: RouterPhase = "auto";
	let turnReadCount = 0;

	function resolveRoute(
		request: FridayRouteRequest,
		ctx: ExtensionContext,
		phase: RouterPhase,
		modelSpec: string,
		reason: string,
	): ModelRoute<FridayRouterState> {
		loadPersistedRoleModels();
		const model =
			findConfiguredModel(ctx, modelSpec) ??
			findConfiguredModel(ctx, ROLE_MODELS.orchestrator) ??
			ctx.modelRegistry.getAvailable()[0];

		if (!model) {
			throw new Error(`No available models found in Friday model registry (target: ${modelSpec}).`);
		}

		const shortName = model.id.split("/").pop() ?? model.id;
		if (ctx.hasUI) {
			ctx.ui.setStatus("friday-router", `🧠 [${phase.toUpperCase()}] ${model.provider}/${shortName}`);
		}

		return {
			model,
			thinkingLevel: request.thinkingLevel,
			state: { phase, modelId: model.id, reason },
		};
	}

	pi.registerVirtualModel<FridayRouterState>({
		provider: "pi-router",
		id: "auto",
		name: "Friday Orchestrator-First Router (Anti-Hijack + Specialist Fallback)",
		reasoning: true,
		input: ["text", "image"],
		thinkingLevels: ["minimal", "low", "medium", "high"],
		contextWindow: 262_144,
		maxTokens: 131_072,
		async route(request, ctx) {
			loadPersistedRoleModels();

			// 1. Direct calls outside the turn loop (e.g. context compaction) use fast Scout (<1s TTFT, 1M ctx)
			if (request.reason === "direct") {
				return resolveRoute(request, ctx, "scout", ROLE_MODELS.scout, "Context compaction / direct call");
			}

			// 2. Manual override via /mode
			if (forcedMode !== "auto") {
				const targetId = ROLE_MODELS[forcedMode];
				return resolveRoute(request, ctx, forcedMode, targetId, `Manual /mode ${forcedMode}`);
			}

			// 3. M1 Anti-Hijack Orchestrator-First: 100% locked to ROLE_MODELS.orchestrator.
			// Never auto-hijacks the main conversation to 30B vision on image blocks (prevents KV cache reset & base64 token pollution).
			return resolveRoute(
				request,
				ctx,
				"orchestrator",
				ROLE_MODELS.orchestrator,
				"Fixed Main Orchestrator (Orchestrator-First Anti-Hijack)",
			);
		},
	});

	pi.on("turn_start", async () => {
		turnReadCount = 0;
	});

	pi.on("before_agent_start", async (event) => {
		loadPersistedRoleModels();
		turnReadCount = 0;
		const promptText = typeof event.prompt === "string" ? event.prompt : "";
		if (!promptText) return undefined;

		const mandates: string[] = [];
		if (STRATEGY_MODE === "apex-commander") {
			if (extractImagePathFromText(promptText)) {
				mandates.push(
					'[MANDATE: 偵測到圖片路徑，嚴禁使用 read 讀取圖片，必須立即呼叫 dispatch_specialist(specialist="vision", imagePath="...", task="...")！]',
				);
			}
			if (/(比對|對照|檢查.*檔案|多個檔案|不一致|衝突|compare|audit.*files)/i.test(promptText)) {
				mandates.push(
					'[MANDATE: 偵測到多檔檢索/對比需求，請優先呼叫 dispatch_specialist(specialist="scout"|"challenger", filePaths=[...], task="...") 或 subagent(agent="scout")，禁止主腦逐一 read 所有檔案！]',
				);
			}
			if (/(實作|重構|修改.*程式碼|撰寫.*測試|修復.*bug|implement|refactor)/i.test(promptText)) {
				mandates.push(
					'[MANDATE: 偵測到程式碼實作/重構需求，主腦確認架構後請優先委派 subagent(agent="worker", task="...") 於獨立沙盒施工並驗證！]',
				);
			}
		} else if (STRATEGY_MODE === "hybrid-synergy") {
			if (/(架構|設計|重構|演算法|ADR|architecture|refactor|design)/i.test(promptText)) {
				mandates.push(
					'[MANDATE (Hybrid-Synergy Mode): 偵測到複雜設計與重構任務，主腦在動手修改前，請先呼叫 dispatch_specialist(specialist="architect"|"challenger") 進行跨模型雙腦推演與紅隊挑刺！]',
				);
			}
		}

		if (mandates.length > 0) {
			return {
				systemPrompt: `${event.systemPrompt}\n\n${mandates.join("\n")}`,
			};
		}
		return undefined;
	});

	pi.on("tool_call", async (event, ctx) => {
		loadPersistedRoleModels();
		if (STRATEGY_MODE !== "apex-commander" || forcedMode !== "auto") return undefined;
		if (event.toolName !== "read") return undefined;

		// Do not restrict subagent workers (e.g., laguna-xs-2.1 or glm-5.3-flash) running in isolated subprocesses
		const activeModelFull = ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : "";
		const isMainOrchestrator =
			!ctx.model ||
			ctx.model.provider === "pi-router" ||
			activeModelFull === ROLE_MODELS.orchestrator ||
			ctx.model.id === ROLE_MODELS.orchestrator;
		if (!isMainOrchestrator) return undefined;

		const rawPath = String((event.input as any)?.path ?? "").trim();
		if (!rawPath) return undefined;

		// Rule 1: Hard-block reading images directly into Main Orchestrator context
		if (inferImageMimeTypeFromExtension(rawPath) !== null) {
			return {
				block: true,
				reason:
					'🛡️ [Token Offload Gate] 旗艦省流模式下，禁止使用 read 將圖片 Base64 載入主對話 Context！請立即改呼叫 dispatch_specialist(specialist="vision", imagePath="...", task="...") 由免費視覺專家解析。',
			};
		}

		// Rule 2: Multi-file / Large-file Read Quota Gate (> 3 files in a single turn, or > 350 lines without limit outside memory/)
		turnReadCount += 1;
		const resolvedPath = path.isAbsolute(rawPath) ? rawPath : path.resolve(ctx.cwd, rawPath);
		const relToCwd = path.relative(ctx.cwd, resolvedPath).replace(/\\/g, "/");
		const isGovernedMemoryFile = relToCwd === "memory" || relToCwd.startsWith("memory/");

		let exceedsLineLimit = false;
		if (!isGovernedMemoryFile && !(event.input as any)?.limit && fs.existsSync(resolvedPath)) {
			try {
				const stat = fs.statSync(resolvedPath);
				if (stat.isFile() && stat.size > 4096) {
					const lineCount = fs.readFileSync(resolvedPath, "utf-8").split("\n").length;
					if (lineCount > 350) {
						exceedsLineLimit = true;
					}
				}
			} catch {
				// Ignore stat/read errors and let the read tool handle them
			}
		}

		if (turnReadCount > 3 || exceedsLineLimit) {
			return {
				block: true,
				reason:
					'🛡️ [Token Offload Gate] 旗艦省流模式下，單回合禁止直接連續 read 超過 3 個檔案或讀取 >350 行巨型檔案！請改用 dispatch_specialist(specialist="scout"|"challenger", filePaths=[...], task="...") 或 subagent(agent="scout"|"worker", task="...") 由免費專家代讀分析。',
			};
		}

		return undefined;
	});

	pi.registerTool({
		name: "dispatch_specialist",
		label: "Dispatch Specialist",
		description: [
			"Zero-cold-start in-process specialist model dispatcher (<1s TTFT) with auto-fallback chain and direct multi-file read (`filePaths`).",
			"Use this tool when the Main Orchestrator needs fast specialized output, multi-file reading/comparison, multimodal vision analysis, or cross-model dialectical review without burning main orchestrator tokens:",
			"- challenger: Cross-model anti-sycophancy review",
			"- code: Focused code synthesis or refactoring",
			"- scout: Fast 1M-context summarization or multi-file extraction",
			"- architect: Deep architectural analysis",
			"- audit: Verification output check",
			"- vision: Multimodal image/chart analysis (pass `imagePath` to attach local image file)",
		].join(" "),
		parameters: DispatchSpecialistParams,
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			loadPersistedRoleModels();
			const role = params.specialist as SpecialistRole;

			// M2: Build deduplicated candidate chain from ROLE_MODELS[role] + ROLE_FALLBACK_CHAINS[role].
			// NEVER fallback to ROLE_MODELS.orchestrator (protects paid flagship tokens).
			const candidateSpecs = Array.from(new Set([ROLE_MODELS[role], ...(ROLE_FALLBACK_CHAINS[role] ?? [])]));
			const candidateModels: NonNullable<ReturnType<typeof findConfiguredModel>>[] = [];
			const seenModelKeys = new Set<string>();
			for (const spec of candidateSpecs) {
				const resolved = findConfiguredModel(ctx, spec);
				if (resolved) {
					const key = `${resolved.provider}/${resolved.id}`;
					if (!seenModelKeys.has(key)) {
						seenModelKeys.add(key);
						candidateModels.push(resolved);
					}
				}
			}

			if (candidateModels.length === 0) {
				return {
					content: [
						{
							type: "text",
							text: `❌ Specialist models for role "${role}" (${candidateSpecs.join(" -> ")}) not found in modelRegistry. (Refused to fallback to orchestrator to protect flagship tokens.)`,
						},
					],
					isError: true,
				};
			}

			// M3: Direct in-process filePaths reading (0 main-brain file-reading tokens)
			const attachedFileSections: string[] = [];
			if (Array.isArray(params.filePaths) && params.filePaths.length > 0) {
				const rootResolved = path.resolve(ctx.cwd);
				for (const rawFilePath of params.filePaths) {
					const cleaned = rawFilePath.trim();
					if (!cleaned) continue;
					const absPath = path.isAbsolute(cleaned) ? path.resolve(cleaned) : path.resolve(rootResolved, cleaned);
					const insideWorkspace =
						absPath === rootResolved || absPath.startsWith(`${rootResolved}${path.sep}`);
					if (!insideWorkspace) {
						return {
							content: [
								{
									type: "text",
									text: `❌ [dispatch_specialist] Out-of-bounds filePath blocked: ${rawFilePath} (must stay inside workspace ${rootResolved})`,
								},
							],
							isError: true,
						};
					}
					if (isProtectedSecretPath(absPath)) {
						return {
							content: [
								{
									type: "text",
									text: `❌ [dispatch_specialist] Access to protected credential file blocked: ${rawFilePath}`,
								},
							],
							isError: true,
						};
					}
					if (!fs.existsSync(absPath) || !fs.statSync(absPath).isFile()) {
						attachedFileSections.push(`--- [File: ${cleaned}] ---\n(File not found: ${absPath})`);
						continue;
					}
					try {
						const fileText = fs.readFileSync(absPath, "utf-8");
						const relLabel = path.relative(rootResolved, absPath).replace(/\\/g, "/");
						attachedFileSections.push(`--- [File: ${relLabel}] ---\n${fileText}`);
					} catch (err: any) {
						attachedFileSections.push(
							`--- [File: ${cleaned}] ---\n(Error reading file: ${err?.message ?? String(err)})`,
						);
					}
				}
			}

			const promptParts: string[] = [`### Task\n${params.task}`];
			if (params.context) {
				promptParts.push(`### Context\n${params.context}`);
			}
			if (attachedFileSections.length > 0) {
				promptParts.push(`### Attached Files\n${attachedFileSections.join("\n\n")}`);
			}
			const userContentText = promptParts.join("\n\n");

			const contentBlocks: Array<TextContent | ImageContent> = [{ type: "text", text: userContentText }];

			// Attach multimodal image block if `imagePath` is provided or auto-detected for `vision`
			const candidateImagePath =
				params.imagePath?.trim() ||
				(role === "vision"
					? extractImagePathFromText(params.task) ?? extractImagePathFromText(params.context ?? "")
					: undefined);

			if (candidateImagePath) {
				const loaded = await loadImageBlockFromFile(candidateImagePath, ctx.cwd);
				if (loaded.error) {
					return {
						content: [{ type: "text", text: `❌ [Vision Specialist] ${loaded.error}` }],
						isError: true,
					};
				}
				if (loaded.block) {
					contentBlocks.push(loaded.block);
				}
			} else if (role === "vision") {
				const sessionImage = findLatestImageBlockInSession(ctx);
				if (sessionImage) {
					contentBlocks.push(sessionImage);
				}
			}

			const indexSummary = loadCompactIndexSummary(ctx.cwd);
			const basePrompt = buildSpecialistSystemPrompt(role);
			const fullSystemPrompt = indexSummary ? `${basePrompt}\n${indexSummary}` : basePrompt;

			// M2: Iterate candidateModels with automatic fallback on ResourceExhausted / 429 / 5xx / error
			const fallbackErrors: string[] = [];
			let lastAssistantMsg: any = null;
			let selectedModel = candidateModels[0]!;

			for (let i = 0; i < candidateModels.length; i++) {
				const candidate = candidateModels[i]!;
				selectedModel = candidate;
				const candidateSignal = signal
					? AbortSignal.any([signal, AbortSignal.timeout(10000)])
					: AbortSignal.timeout(10000);
				try {
					const assistantMsg = await ctx.modelRegistry.complete(
						candidate,
						{
							systemPrompt: fullSystemPrompt,
							messages: [
								{
									role: "user",
									content: contentBlocks,
									timestamp: Date.now(),
								},
							],
						},
						{ signal: candidateSignal },
					);
					lastAssistantMsg = assistantMsg;
					const textBlocks = assistantMsg.content
						.filter((b): b is { type: "text"; text: string } => b.type === "text")
						.map((b) => b.text);
					const thinkingBlocks = (assistantMsg.content as any[])
						.filter((b) => b?.type === "thinking" && typeof b.thinking === "string")
						.map((b) => b.thinking);
					const outputText = textBlocks.join("\n").trim() || thinkingBlocks.join("\n").trim();
					const isErr = assistantMsg.stopReason === "error" || Boolean(assistantMsg.errorMessage);

					if (!isErr && outputText) {
						const fallbackNotice =
							i > 0
								? `⚡ *[Auto-Fallback Triggered: ${fallbackErrors.join(" | ")} -> Switched to ${candidate.provider}/${candidate.id}]*\n\n`
								: "";
						return {
							content: [
								{
									type: "text",
									text: `🤖 **[Specialist: ${role} | Model: ${candidate.provider}/${candidate.id}]**\n\n${fallbackNotice}${outputText}`,
								},
							],
							details: {
								specialist: role,
								model: `${candidate.provider}/${candidate.id}`,
								fallbackAttempts: i,
								stopReason: assistantMsg.stopReason,
								usage: assistantMsg.usage,
							},
							isError: false,
						};
					}

					const errReason = assistantMsg.errorMessage || `stopReason=${assistantMsg.stopReason} (empty output)`;
					fallbackErrors.push(`${candidate.provider}/${candidate.id}: ${errReason}`);
				} catch (err: any) {
					fallbackErrors.push(`${candidate.provider}/${candidate.id}: ${err?.message ?? String(err)}`);
				}
			}

			const errorSummary = fallbackErrors.join("\n- ");
			return {
				content: [
					{
						type: "text",
						text: `❌ **[Specialist: ${role} | All Candidate Models Exhausted]**\n- ${errorSummary}`,
					},
				],
				details: {
					specialist: role,
					model: `${selectedModel.provider}/${selectedModel.id}`,
					fallbackErrors,
					stopReason: lastAssistantMsg?.stopReason ?? "error",
				},
				isError: true,
			};
		},
	});

	function formatStatusSummary(ctx: ExtensionContext): string {
		loadPersistedRoleModels();
		const authData = readAuthJson();
		const configuredProviders = Object.keys(authData);
		const lines: string[] = [
			`🧠 Friday 路由與角色模型配置 (鎖定模式: ${forcedMode.toUpperCase()} | 調度策略: ${STRATEGY_MODE})`,
			`──────────────────────────────────────────────────`,
		];
		for (const role of Object.keys(DEFAULT_ROLE_MODELS) as RoleName[]) {
			const spec = ROLE_MODELS[role];
			const resolved = findConfiguredModel(ctx, spec);
			const fullLabel = resolved ? `${resolved.provider}/${resolved.id}` : `${spec} (未解析)`;
			const authOk = resolved ? ctx.modelRegistry.hasConfiguredAuth(resolved) : false;
			const badge = authOk ? "✅" : "⚠️未認證";
			lines.push(`  • ${role.padEnd(12, " ")} : ${fullLabel} [${badge}]`);
		}
		lines.push(`──────────────────────────────────────────────────`);
		lines.push(`⚙️ 目前調度策略模式 (strategyMode): ${STRATEGY_MODE} — ${STRATEGY_LABELS[STRATEGY_MODE]}`);
		lines.push(
			`🔑 已設定憑證之 Providers (.Friday/auth.json): ${configuredProviders.length > 0 ? configuredProviders.join(", ") : "(無)"}`,
		);
		lines.push(`💡 快速指令:`);
		lines.push(`  • /mode                                         : 開啟互動式設定選單`);
		lines.push(`  • /mode strategy <apex-commander|hybrid-synergy>: 切換雙調度策略模式`);
		lines.push(`  • /mode set <角色> <模型>                       : 例 /mode set orchestrator google-vertex/gemini-4-argon`);
		lines.push(`  • /mode key <provider> <APIKey>                 : 例 /mode key anthropic sk-ant-...`);
		lines.push(`  • /mode vertex <ProjectID> [區]                 : 例 /mode vertex my-gcp-project global`);
		lines.push(`  • /mode <auto|角色名稱>                         : 切換自動路由或強制鎖定單一角色`);
		return lines.join("\n");
	}

	function applyRoleModelChange(ctx: ExtensionContext, role: RoleName, rawModelSpec: string): boolean {
		const resolved = findConfiguredModel(ctx, rawModelSpec);
		const normalizedSpec = resolved
			? resolved.provider === DEFAULT_PROVIDER
				? resolved.id
				: `${resolved.provider}/${resolved.id}`
			: rawModelSpec.trim();
		const fullCliSpec = resolved ? `${resolved.provider}/${resolved.id}` : rawModelSpec.trim();

		ROLE_MODELS[role] = normalizedSpec;
		savePersistedRoleModels();
		syncAgentMarkdownModel(role, fullCliSpec);

		if (role === "orchestrator" && forcedMode === "auto" && ctx.hasUI) {
			const shortName = fullCliSpec.split("/").pop() ?? fullCliSpec;
			ctx.ui.setStatus("friday-router", `🧠 [ORCHESTRATOR] ${shortName}`);
		}
		const hasAuth = resolved ? ctx.modelRegistry.hasConfiguredAuth(resolved) : false;
		const authNotice = hasAuth
			? "✅ 憑證已就緒"
			: `⚠️ 提醒：Provider "${resolved?.provider ?? rawModelSpec.split("/")[0]}" 尚未完成認證，請透過 /mode 設定金鑰或執行 /login`;
		ctx.ui.notify(`✅ 已將角色 [${role}] 綁定模型更新為: ${fullCliSpec} (${authNotice})`, "info");
		return true;
	}

	/**
	 * Scrollable selector that fixes pi's built-in `ctx.ui.select` lack of viewport windowing.
	 * Renders at most `maxVisible` items at a time with ▲/▼ scroll indicators, wrap-around ↑/↓, and PgUp/PgDn.
	 */
	async function scrollableSelect(
		ctx: ExtensionContext,
		title: string,
		options: string[],
		maxVisible = 10,
	): Promise<string | undefined> {
		if (options.length === 0) return undefined;
		if (!ctx.hasUI || typeof ctx.ui.custom !== "function") {
			return ctx.ui.select(title, options);
		}
		return ctx.ui.custom<string | undefined>((tui, theme, keybindings, done) => {
			let selectedIndex = 0;
			return {
				render(width: number): string[] {
					const safeWidth = Math.max(20, width - 2);
					const border = theme.fg("border", "─".repeat(safeWidth));
					const lines: string[] = [
						border,
						` ${theme.fg("accent", theme.bold(title))} ${theme.fg("dim", `(${selectedIndex + 1}/${options.length})`)}`,
						"",
					];

					const startIndex = Math.max(
						0,
						Math.min(selectedIndex - Math.floor(maxVisible / 2), Math.max(0, options.length - maxVisible)),
					);
					const endIndex = Math.min(startIndex + maxVisible, options.length);

					if (startIndex > 0) {
						lines.push(theme.fg("dim", `   ▲ 往上還有 ${startIndex} 個選項...`));
					}

					for (let i = startIndex; i < endIndex; i++) {
						const raw = options[i] ?? "";
						const clipped = raw.length > safeWidth - 5 ? `${raw.slice(0, safeWidth - 6)}…` : raw;
						if (i === selectedIndex) {
							lines.push(` ${theme.fg("accent", "→ ")}${theme.fg("accent", theme.bold(clipped))}`);
						} else {
							lines.push(`   ${theme.fg("text", clipped)}`);
						}
					}

					if (endIndex < options.length) {
						lines.push(theme.fg("dim", `   ▼ 往下還有 ${options.length - endIndex} 個選項...`));
					}

					lines.push("");
					lines.push(
						` ${theme.fg("dim", "↑/↓ 移動(自動捲動)  •  PgUp/PgDn 翻頁  •  Enter 確認  •  Esc 取消")}`,
					);
					lines.push(border);
					return lines;
				},
				handleInput(keyData: string): void {
					if (keybindings.matches(keyData, "tui.select.up") || keyData === "\x1b[A" || keyData === "k") {
						selectedIndex = selectedIndex <= 0 ? options.length - 1 : selectedIndex - 1;
						tui.requestRender();
					} else if (
						keybindings.matches(keyData, "tui.select.down") ||
						keyData === "\x1b[B" ||
						keyData === "j"
					) {
						selectedIndex = selectedIndex >= options.length - 1 ? 0 : selectedIndex + 1;
						tui.requestRender();
					} else if (keyData === "\x1b[5~") {
						// PageUp
						selectedIndex = Math.max(0, selectedIndex - maxVisible);
						tui.requestRender();
					} else if (keyData === "\x1b[6~") {
						// PageDown
						selectedIndex = Math.min(options.length - 1, selectedIndex + maxVisible);
						tui.requestRender();
					} else if (
						keybindings.matches(keyData, "tui.select.confirm") ||
						keyData === "\r" ||
						keyData === "\n"
					) {
						done(options[selectedIndex]);
					} else if (
						keybindings.matches(keyData, "tui.select.cancel") ||
						keyData === "\x1b" ||
						keyData === "\x03"
					) {
						done(undefined);
					}
				},
				invalidate(): void {},
			};
		});
	}

	async function openInteractiveModeMenu(ctx: ExtensionContext): Promise<void> {
		const action = await scrollableSelect(ctx, "🧠 Friday 路由、角色模型與憑證管理中心 (/mode)", [
			`1. 🎯 設定各角色綁定模型 (主腦 orchestrator / 各分工專家)`,
			`2. 🔑 設定 Provider API Key 與 GCP Vertex 專案憑證 (.Friday/auth.json)`,
			`3. 🔄 切換路由鎖定模式 (目前: ${forcedMode.toUpperCase()})`,
			`4. ⚙️ 切換雙調度策略模式 (目前: ${STRATEGY_MODE})`,
			`5. 📋 檢視目前角色模型與憑證狀態總覽`,
			`6. ♻️ 重設所有角色為預設極速模型池`,
		]);
		if (!action) return;

		if (action.startsWith("1.")) {
			const roleOptions = (Object.keys(DEFAULT_ROLE_MODELS) as RoleName[]).map(
				(r) => `${r} — ${ROLE_LABELS[r]} [目前: ${ROLE_MODELS[r]}]`,
			);
			const chosenRoleLine = await scrollableSelect(ctx, "請選擇要更換模型的角色:", roleOptions);
			if (!chosenRoleLine) return;
			const role = chosenRoleLine.split(" ")[0] as RoleName;

			const allAvailable = ctx.modelRegistry.getAvailable().filter((m) => m.provider !== "pi-router");
			const providerCounts = new Map<string, number>();
			for (const m of allAvailable) {
				providerCounts.set(m.provider, (providerCounts.get(m.provider) ?? 0) + 1);
			}

			const providerFilterOptions = [
				...Array.from(providerCounts.entries()).map(
					([prov, count]) => `📂 ${prov} (顯示該 Provider 下已認證可用的 ${count} 個模型)`,
				),
				`🌐 顯示全部可用與推薦模型 (共 ${allAvailable.length} 個，支援上下捲動)`,
				"✏️ 手動輸入 <provider>/<modelId> ...",
			];

			const filterChoice = await scrollableSelect(
				ctx,
				`請選擇 [${role}] 的模型來源分類:`,
				providerFilterOptions,
			);
			if (!filterChoice) return;

			if (filterChoice.startsWith("✏️")) {
				const customInput = await ctx.ui.input(
					`請輸入 [${role}] 的模型 ID (格式 <provider>/<model>，例如 google-vertex/gemini-4-argon):`,
					ROLE_MODELS[role],
				);
				if (!customInput?.trim()) return;
				applyRoleModelChange(ctx, role, customInput.trim());
				return;
			}

			const selectedProvider = filterChoice.startsWith("📂 ")
				? filterChoice.slice(2).trim().split(" ")[0]
				: undefined;

			const filteredModels = (
				selectedProvider ? allAvailable.filter((m) => m.provider === selectedProvider) : allAvailable
			).map((m) => `${m.provider}/${m.id} (${m.name ?? m.id}) [✅可用]`);

			const curatedExtras = [
				"google-vertex/gemini-4-argon (GCP Vertex AI - Gemini 4 Argon 1M)",
				"google-vertex/gemini-2.5-pro (GCP Vertex AI - Gemini 2.5 Pro)",
				"anthropic/claude-opus-4-5 (Anthropic - Claude Opus 4.5)",
				"anthropic/claude-sonnet-4-5 (Anthropic - Claude Sonnet 4.5)",
			];

			const modelOptions = [
				...filteredModels,
				...(selectedProvider
					? []
					: curatedExtras.filter((extra) => !filteredModels.some((a) => a.startsWith(extra.split(" ")[0])))),
				"✏️ 手動輸入 <provider>/<modelId> ...",
			];

			const modelSelection = await scrollableSelect(
				ctx,
				`請為 [${role}] 選擇目標模型 (支援 ↑/↓ 與 PgUp/PgDn 捲動):`,
				modelOptions,
				10,
			);
			if (!modelSelection) return;

			let targetSpec = modelSelection.split(" ")[0];
			if (modelSelection.startsWith("✏️")) {
				const customInput = await ctx.ui.input(
					`請輸入 [${role}] 的模型 ID (格式 <provider>/<model>，例如 google-vertex/gemini-4-argon):`,
					ROLE_MODELS[role],
				);
				if (!customInput?.trim()) return;
				targetSpec = customInput.trim();
			}
			applyRoleModelChange(ctx, role, targetSpec);
			return;
		}

		if (action.startsWith("2.")) {
			const providerChoice = await scrollableSelect(
				ctx,
				"請選擇要設定憑證的 Provider (.Friday/auth.json):",
				[
					"google-vertex — GCP Vertex AI (設定 Project ID + Location 或 API Key)",
					"anthropic     — Anthropic Claude (設定 API Key，若用 Claude 訂閱請執行 /login anthropic)",
					"nvidia        — NVIDIA NIM (設定 NVIDIA API Key)",
					"google        — Google Gemini AI Studio (設定 GEMINI_API_KEY)",
					"openai        — OpenAI (設定 OPENAI_API_KEY)",
					"openrouter    — OpenRouter (設定 OPENROUTER_API_KEY)",
					"radius        — Pi Radius Gateway (設定 RADIUS_API_KEY，若用帳號登入請執行 /login radius)",
					"✏️ 手動輸入其他 Provider 名稱...",
				],
			);
			if (!providerChoice) return;

			let providerId = providerChoice.split(" ")[0].trim();
			if (providerChoice.startsWith("✏️")) {
				const customProv = await ctx.ui.input("請輸入 Provider ID (例如 deepseek, groq, xai):");
				if (!customProv?.trim()) return;
				providerId = customProv.trim();
			}

			if (providerId === "google-vertex") {
				const vertexMode = await scrollableSelect(ctx, "請選擇 GCP Vertex AI 認證方式:", [
					"1. Google 帳號 OAuth (ADC) — 輸入 GCP Project ID 與 Location (推薦，無須靜態金鑰)",
					"2. Google Cloud API Key — 直接輸入靜態 API Key",
				]);
				if (!vertexMode) return;

				const authData = readAuthJson();
				if (vertexMode.startsWith("1.")) {
					const project = await ctx.ui.input("請輸入 GCP Project ID (專案代號):", "my-gcp-project");
					if (!project?.trim()) return;
					const location =
						(await ctx.ui.input("請輸入 GCP Location (例如 global 或 us-central1):", "global"))?.trim() ||
						"global";
					authData["google-vertex"] = {
						type: "api_key",
						env: {
							GOOGLE_CLOUD_PROJECT: project.trim(),
							GOOGLE_CLOUD_LOCATION: location,
						},
					};
					writeAuthJson(authData);
					await ctx.modelRegistry.refresh();
					ctx.ui.notify(
						`✅ 已將 GCP Vertex AI 專案 (${project.trim()} @ ${location}) 寫入 .Friday/auth.json！\n💡 若尚未完成本機 Google 帳號 OAuth 授權，請於終端機執行: gcloud auth application-default login`,
						"info",
					);
				} else {
					const apiKey = await ctx.ui.input("請輸入 Google Cloud API Key:");
					if (!apiKey?.trim()) return;
					authData["google-vertex"] = {
						type: "api_key",
						key: apiKey.trim(),
					};
					writeAuthJson(authData);
					await ctx.modelRegistry.refresh();
					ctx.ui.notify("✅ 已儲存 Google Vertex AI API Key 至 .Friday/auth.json 並重新整理模型池！", "info");
				}
				return;
			}

			const keyInput = await ctx.ui.input(`請輸入 [${providerId}] 的 API Key (將加密權限 600 存入 .Friday/auth.json):`);
			if (!keyInput?.trim()) return;

			const authData = readAuthJson();
			authData[providerId] = {
				type: "api_key",
				key: keyInput.trim(),
			};
			writeAuthJson(authData);
			await ctx.modelRegistry.refresh();
			ctx.ui.notify(`✅ 已儲存 [${providerId}] API Key 至 .Friday/auth.json 並重新載入可用模型！`, "info");
			return;
		}

		if (action.startsWith("3.")) {
			const modeChoices: Array<{ id: RouterPhase; label: string }> = [
				{
					id: "auto",
					label: `auto — 自動路由 (固定主腦 ${ROLE_MODELS.orchestrator} + 專家/子代理分流 + 自動壓縮轉 Scout) [推薦]`,
				},
				...(Object.keys(DEFAULT_ROLE_MODELS) as RoleName[]).map((r) => ({
					id: r,
					label: `${r} — 強制鎖定所有對話使用 ${ROLE_MODELS[r]}`,
				})),
			];
			const chosen = await scrollableSelect(
				ctx,
				"請選擇 Friday 路由模式:",
				modeChoices.map((c) => c.label),
			);
			if (!chosen) return;
			const targetMode = chosen.split(" ")[0] as RouterPhase;
			forcedMode = targetMode;
			if (targetMode === "auto") {
				const shortName = ROLE_MODELS.orchestrator.split("/").pop() ?? ROLE_MODELS.orchestrator;
				ctx.ui.setStatus("friday-router", `🧠 [ORCHESTRATOR] ${shortName}`);
				ctx.ui.notify(`✅ 已切換為 AUTO 模式 (主腦: ${ROLE_MODELS.orchestrator} + 專家分流)。`, "info");
			} else {
				const targetId = ROLE_MODELS[targetMode];
				ctx.ui.setStatus("friday-router", `🧠 [LOCK:${targetMode.toUpperCase()}] ${targetId.split("/").pop()}`);
				ctx.ui.notify(`✅ 已強制鎖定路由模式為 [${targetMode.toUpperCase()}] -> ${targetId}`, "info");
			}
			return;
		}

		if (action.startsWith("4.")) {
			const strategyChoice = await scrollableSelect(ctx, "請選擇 Friday 雙調度策略模式 (strategyMode):", [
				`apex-commander — ${STRATEGY_LABELS["apex-commander"]}`,
				`hybrid-synergy — ${STRATEGY_LABELS["hybrid-synergy"]}`,
			]);
			if (!strategyChoice) return;
			const chosenStrategy = strategyChoice.split(" ")[0] as StrategyMode;
			STRATEGY_MODE = chosenStrategy;
			savePersistedRoleModels();
			ctx.ui.notify(`✅ 已切換調度策略為 [${STRATEGY_MODE}]: ${STRATEGY_LABELS[STRATEGY_MODE]}`, "info");
			return;
		}

		if (action.startsWith("5.")) {
			ctx.ui.notify(formatStatusSummary(ctx), "info");
			return;
		}

		if (action.startsWith("6.")) {
			for (const role of Object.keys(DEFAULT_ROLE_MODELS) as RoleName[]) {
				ROLE_MODELS[role] = DEFAULT_ROLE_MODELS[role];
				syncAgentMarkdownModel(role, DEFAULT_ROLE_MODELS[role]);
			}
			STRATEGY_MODE = "apex-commander";
			savePersistedRoleModels();
			forcedMode = "auto";
			ctx.ui.setStatus("friday-router", "🧠 [ORCHESTRATOR] nemotron-3-super-120b-a12b");
			ctx.ui.notify("✅ 已重設所有角色為預設極速模型池，並恢復 AUTO 與 apex-commander 模式。", "info");
		}
	}

	pi.registerCommand("mode", {
		description:
			"Friday 路由、各角色模型綁定、調度策略與憑證管理: /mode | /mode strategy <apex-commander|hybrid-synergy> | /mode set <role> <model> | /mode key <provider> <key> | /mode vertex <project> [loc] | /mode status",
		handler: async (args, ctx) => {
			loadPersistedRoleModels();
			const tokens = args
				.trim()
				.split(/\s+/)
				.filter(Boolean);
			const sub = tokens[0]?.toLowerCase();

			// 1. No args or "/mode config" -> open interactive menu if UI is available, else show status
			if (!sub || sub === "config" || sub === "menu") {
				if (ctx.hasUI) {
					await openInteractiveModeMenu(ctx);
				} else {
					ctx.ui.notify(formatStatusSummary(ctx), "info");
				}
				return;
			}

			// 2. "/mode status" or "/mode list"
			if (sub === "status" || sub === "list") {
				ctx.ui.notify(formatStatusSummary(ctx), "info");
				return;
			}

			// 3. "/mode strategy <apex-commander|hybrid-synergy>"
			if (sub === "strategy") {
				const targetStrategy = tokens[1]?.toLowerCase() as StrategyMode | undefined;
				if (targetStrategy !== "apex-commander" && targetStrategy !== "hybrid-synergy") {
					ctx.ui.notify(
						`❌ 用法: /mode strategy <apex-commander|hybrid-synergy>\n目前模式: ${STRATEGY_MODE} (${STRATEGY_LABELS[STRATEGY_MODE]})`,
						"warning",
					);
					return;
				}
				STRATEGY_MODE = targetStrategy;
				savePersistedRoleModels();
				ctx.ui.notify(`✅ 已切換調度策略模式為 [${STRATEGY_MODE}]: ${STRATEGY_LABELS[STRATEGY_MODE]}`, "info");
				return;
			}

			// 4. "/mode reset"
			if (sub === "reset") {
				for (const role of Object.keys(DEFAULT_ROLE_MODELS) as RoleName[]) {
					ROLE_MODELS[role] = DEFAULT_ROLE_MODELS[role];
					syncAgentMarkdownModel(role, DEFAULT_ROLE_MODELS[role]);
				}
				STRATEGY_MODE = "apex-commander";
				savePersistedRoleModels();
				forcedMode = "auto";
				ctx.ui.setStatus("friday-router", "🧠 [ORCHESTRATOR] nemotron-3-super-120b-a12b");
				ctx.ui.notify("✅ 已重設所有角色為預設模型池。", "info");
				return;
			}

			// 5. "/mode set <role> <provider/model>"
			if (sub === "set") {
				const roleArg = tokens[1]?.toLowerCase() as RoleName | undefined;
				const modelArg = tokens.slice(2).join(" ");
				const validRoles = Object.keys(DEFAULT_ROLE_MODELS) as RoleName[];
				if (!roleArg || !validRoles.includes(roleArg) || !modelArg) {
					ctx.ui.notify(
						`❌ 用法: /mode set <${validRoles.join("|")}> <provider/model>\n範例: /mode set orchestrator google-vertex/gemini-4-argon`,
						"warning",
					);
					return;
				}
				applyRoleModelChange(ctx, roleArg, modelArg);
				return;
			}

			// 6. "/mode key <provider> <apiKey>"
			if (sub === "key") {
				const providerId = tokens[1]?.toLowerCase();
				const apiKey = tokens.slice(2).join(" ").trim();
				if (!providerId || !apiKey) {
					ctx.ui.notify(
						"❌ 用法: /mode key <provider> <apiKey>\n範例: /mode key anthropic sk-ant-...",
						"warning",
					);
					return;
				}
				const authData = readAuthJson();
				authData[providerId] = {
					type: "api_key",
					key: apiKey,
				};
				writeAuthJson(authData);
				await ctx.modelRegistry.refresh();
				ctx.ui.notify(`✅ 已將 [${providerId}] API Key 安全存入 .Friday/auth.json (權限 600) 並更新模型池！`, "info");
				return;
			}

			// 7. "/mode vertex <projectId> [location]"
			if (sub === "vertex") {
				const projectId = tokens[1]?.trim();
				const location = tokens[2]?.trim() || "global";
				if (!projectId) {
					ctx.ui.notify(
						"❌ 用法: /mode vertex <GCP_PROJECT_ID> [LOCATION]\n範例: /mode vertex my-gcp-project global",
						"warning",
					);
					return;
				}
				const authData = readAuthJson();
				authData["google-vertex"] = {
					type: "api_key",
					env: {
						GOOGLE_CLOUD_PROJECT: projectId,
						GOOGLE_CLOUD_LOCATION: location,
					},
				};
				writeAuthJson(authData);
				await ctx.modelRegistry.refresh();
				ctx.ui.notify(
					`✅ 已設定 GCP Vertex AI 專案 (${projectId} @ ${location}) 至 .Friday/auth.json！\n💡 請確認本機已執行 gcloud auth application-default login 完成 Google OAuth 授權。`,
					"info",
				);
				return;
			}

			// 8. Direct mode switch: "/mode <auto|orchestrator|scout|architect|challenger|code|audit|vision>"
			const validModes: RouterPhase[] = [
				"auto",
				"orchestrator",
				"scout",
				"architect",
				"challenger",
				"code",
				"audit",
				"vision",
			];
			if (!validModes.includes(sub as RouterPhase)) {
				ctx.ui.notify(
					`❌ 無效的子指令或模式 "${sub}"。\n可用指令: /mode (互動選單) | /mode status | /mode strategy <apex-commander|hybrid-synergy> | /mode set <角色> <模型> | /mode key <provider> <key> | /mode vertex <project> [loc] | /mode <${validModes.join("|")}>`,
					"warning",
				);
				return;
			}

			forcedMode = sub as RouterPhase;
			if (forcedMode === "auto") {
				const shortName = ROLE_MODELS.orchestrator.split("/").pop() ?? ROLE_MODELS.orchestrator;
				ctx.ui.setStatus("friday-router", `🧠 [ORCHESTRATOR] ${shortName}`);
				ctx.ui.notify(`✅ 已切換為 AUTO (固定主腦 ${ROLE_MODELS.orchestrator} + 專家分流) 模式。`, "info");
			} else {
				const targetId = ROLE_MODELS[forcedMode];
				ctx.ui.setStatus("friday-router", `🧠 [LOCK:${forcedMode.toUpperCase()}] ${targetId.split("/").pop()}`);
				ctx.ui.notify(`✅ 已鎖定路由模式為 [${forcedMode.toUpperCase()}] -> ${targetId}`, "info");
			}
		},
	});
}
