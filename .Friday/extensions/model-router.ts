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
import { clearSessionPinnedContextSummaries, getSessionPinnedContextSummary } from "./epistemic-gate.js";

const DEFAULT_PROVIDER = "nvidia";
const DEPRECATED_404_MODELS = new Set([
	"nvidia/nemotron-3-super-120b-a12b",
	"nvidia/nvidia/nemotron-3-super-120b-a12b",
]);

export const DEFAULT_ROLE_MODELS = {
	orchestrator: "nvidia/nemotron-3-ultra-550b-a55b",
	scout: "z-ai/glm-5.3-flash",
	architect: "nvidia/nemotron-3-ultra-550b-a55b",
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
		"nvidia/nemotron-3-ultra-550b-a55b",
		"nvidia/nemotron-3.5-lightning-30b-a3b",
		"deepseek-ai/deepseek-v4.1-flash",
		"z-ai/glm-5.3",
	],
	architect: [
		"nvidia/nemotron-3-ultra-550b-a55b",
		"z-ai/glm-5.3",
		"nvidia/nemotron-3.5-lightning-30b-a3b",
		"deepseek-ai/deepseek-v4.1-flash",
		"z-ai/glm-5.3-flash",
	],
	challenger: [
		"deepseek-ai/deepseek-v4.1-flash",
		"nvidia/nemotron-3-ultra-550b-a55b",
		"nvidia/nemotron-3.5-lightning-30b-a3b",
		"z-ai/glm-5.3",
		"z-ai/glm-5.3-flash",
	],
	code: [
		"poolside/laguna-xs-2.1",
		"nvidia/nemotron-3-ultra-550b-a55b",
		"nvidia/nemotron-3.5-lightning-30b-a3b",
		"z-ai/glm-5.3",
		"deepseek-ai/deepseek-v4.1-flash",
	],
	audit: [
		"z-ai/glm-5.3-flash",
		"nvidia/nemotron-3-ultra-550b-a55b",
		"nvidia/nemotron-3.5-lightning-30b-a3b",
		"deepseek-ai/deepseek-v4.1-flash",
		"z-ai/glm-5.3",
	],
	vision: [
		"google/diffusiongemma-26b-a4b-it",
		"meta/llama-3.2-11b-vision-instruct",
		"nvidia/nemotron-3-nano-omni-30b-a3b-reasoning",
		"z-ai/glm-5.3-flash",
		"deepseek-ai/deepseek-v4.1-flash",
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
		let migrated404 = false;
		for (const role of Object.keys(DEFAULT_ROLE_MODELS) as RoleName[]) {
			if (typeof raw?.[role] === "string" && raw[role].trim()) {
				const candidate = raw[role].trim();
				if (DEPRECATED_404_MODELS.has(candidate)) {
					ROLE_MODELS[role] = DEFAULT_ROLE_MODELS[role];
					migrated404 = true;
				} else {
					ROLE_MODELS[role] = candidate;
				}
				syncAgentMarkdownModel(role, ROLE_MODELS[role]);
			}
		}
		if (raw?.strategyMode === "apex-commander" || raw?.strategyMode === "hybrid-synergy") {
			STRATEGY_MODE = raw.strategyMode;
		}
		if (migrated404) {
			savePersistedRoleModels();
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
		const rawText = fs.readFileSync(authPath, "utf-8");
		const parsed = JSON.parse(rawText) ?? {};
		// Self-healing guard: if a user manually pasted multiple `"nvidia": { "key": "..." }` blocks,
		// standard JSON.parse overwrites earlier blocks. Extract all nvapi-* keys when multiple `"nvidia"` keys exist.
		const duplicateNvidiaBlocks = rawText.match(/"nvidia"\s*:\s*\{/g);
		if (duplicateNvidiaBlocks && duplicateNvidiaBlocks.length > 1 && parsed.nvidia && typeof parsed.nvidia === "object") {
			const allNvKeys = Array.from(
				new Set((rawText.match(/nvapi-[A-Za-z0-9_-]{10,}/g) ?? []).map((k) => k.trim()).filter(Boolean)),
			);
			if (allNvKeys.length > 1) {
				parsed.nvidia.keys = allNvKeys;
				if (!parsed.nvidia.key || !allNvKeys.includes(parsed.nvidia.key)) {
					parsed.nvidia.key = allNvKeys[0];
				}
			}
		}
		return parsed;
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

/**
 * Multi-Account API Key Pool (Per-Loop Round-Robin + Sticky Key within Loop):
 * Extracts all configured API keys for a provider from `.Friday/auth.json` (`keys: string[]` or comma-separated `key`).
 */
export function getProviderKeyPool(providerId: string): string[] {
	const authData = readAuthJson();
	const entry = authData[providerId];
	if (!entry || typeof entry !== "object") return [];
	const pool: string[] = [];
	if (Array.isArray(entry.keys)) {
		for (const k of entry.keys) {
			if (typeof k === "string" && k.trim()) {
				pool.push(k.trim());
			}
		}
	}
	if (typeof entry.key === "string" && entry.key.trim()) {
		for (const part of entry.key.split(",")) {
			const trimmed = part.trim();
			if (trimmed && !pool.includes(trimmed)) {
				pool.push(trimmed);
			}
		}
	}
	return pool;
}

/**
 * Saves one or more API keys into `.Friday/auth.json` for `providerId`.
 * When `append = true`, appends to the existing `keys` pool; otherwise replaces the pool.
 */
export function saveProviderKeyPool(providerId: string, rawKeysInput: string, append = false): string[] {
	const authData = readAuthJson();
	const incoming = rawKeysInput
		.split(",")
		.map((k) => k.trim())
		.filter(Boolean);
	const existing = append ? getProviderKeyPool(providerId) : [];
	const merged = Array.from(new Set([...existing, ...incoming]));
	if (merged.length === 0) return [];
	const currentIdx = typeof authData[providerId]?.activeKeyIndex === "number" ? authData[providerId].activeKeyIndex : 0;
	const safeIdx = currentIdx >= 0 && currentIdx < merged.length ? currentIdx : 0;
	authData[providerId] = {
		type: "api_key",
		key: merged[safeIdx],
		...(merged.length > 1 ? { keys: merged, activeKeyIndex: safeIdx } : {}),
	};
	writeAuthJson(authData);
	return merged;
}

/**
 * Acquires a Sticky Key for an entire Multi-Turn Loop (`Per-Loop Round-Robin`).
 * Advances `activeKeyIndex` once when the loop begins and returns `selectedKey` to be passed
 * explicitly via `options.apiKey` in `ctx.modelRegistry.complete(...)`.
 * Keeps `authData[providerId].key` pinned to `pool[0]` so the Main Orchestrator's default key
 * and Prefix KV Cache are NEVER disrupted by specialist key rotation (Killer 2 Fix).
 */
export function acquireStickyProviderKey(providerId: string): {
	key?: string;
	keyIndex: number;
	poolSize: number;
	rotated: boolean;
} {
	const authData = readAuthJson();
	const entry = authData[providerId];
	if (!entry || typeof entry !== "object") {
		return { key: undefined, keyIndex: 0, poolSize: 0, rotated: false };
	}
	const pool = getProviderKeyPool(providerId);
	if (pool.length <= 1) {
		return { key: pool[0], keyIndex: 0, poolSize: pool.length, rotated: false };
	}
	const prevIdx = typeof entry.activeKeyIndex === "number" ? entry.activeKeyIndex : -1;
	const nextIdx = (prevIdx + 1) % pool.length;
	const selectedKey = pool[nextIdx]!;
	const rotated = entry.activeKeyIndex !== nextIdx || entry.key !== pool[0];
	// Pin `entry.key` to `pool[0]` for Main Orchestrator KV Cache stability; only advance `activeKeyIndex` for specialists
	entry.key = pool[0]!;
	entry.keys = pool;
	entry.activeKeyIndex = nextIdx;
	authData[providerId] = entry;
	if (rotated) {
		writeAuthJson(authData);
	}
	return { key: selectedKey, keyIndex: nextIdx, poolSize: pool.length, rotated };
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
			// Prefix KV Cache Guard (Killer 1 Fix):
			// Inject dynamic turn mandates at the TAIL of `messages` via `message` (customType: "friday-mandate", display: false)
			// instead of mutating `event.systemPrompt` at `messages[0]` (Token 0).
			// This keeps `messages[0]` 100% invariant across all turns and preserves the cloud Prefix KV Cache.
			return {
				message: {
					customType: "friday-mandate",
					content: mandates.join("\n"),
					display: false,
				},
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

			const indexSummary = loadCompactIndexSummary(ctx.cwd);
			const basePrompt = buildSpecialistSystemPrompt(role);
			const fullSystemPrompt = indexSummary ? `${basePrompt}\n${indexSummary}` : basePrompt;

			// Attach multimodal image block if `imagePath` is provided or auto-detected for `vision`
			let imageBlock: ImageContent | undefined;
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
					imageBlock = loaded.block;
				}
			} else if (role === "vision") {
				const sessionImage = findLatestImageBlockInSession(ctx);
				if (sessionImage) {
					imageBlock = sessionImage;
				}
			}

			// Split `attachedFileSections` into progressive batches when multi-file count > 2 or total chars > 16,000.
			// Never truncate any file content (100% full file fidelity preserved across all rounds).
			const totalAttachedChars = attachedFileSections.reduce((acc, s) => acc + s.length, 0);
			const fileBatches: string[][] = [];
			if (attachedFileSections.length <= 2 && totalAttachedChars <= 16000) {
				fileBatches.push(attachedFileSections);
			} else {
				let currentBatch: string[] = [];
				let currentBatchChars = 0;
				for (const section of attachedFileSections) {
					if (
						currentBatch.length >= 2 ||
						(currentBatch.length >= 1 && currentBatchChars + section.length > 14000)
					) {
						fileBatches.push(currentBatch);
						currentBatch = [];
						currentBatchChars = 0;
					}
					currentBatch.push(section);
					currentBatchChars += section.length;
				}
				if (currentBatch.length > 0) {
					fileBatches.push(currentBatch);
				}
			}
			const totalRounds = Math.max(1, fileBatches.length);

			const buildRoundUserContent = (roundIdx: number): Array<TextContent | ImageContent> => {
				const batch = fileBatches[roundIdx] ?? [];
				const parts: string[] = [];
				if (totalRounds === 1) {
					parts.push(`### Task\n${params.task}`);
					if (params.context) {
						parts.push(`### Context\n${params.context}`);
					}
					if (batch.length > 0) {
						parts.push(`### Attached Files\n${batch.join("\n\n")}`);
					}
				} else if (roundIdx === 0) {
					parts.push(`### Task (Multi-Turn Progressive File Analysis — Round 1/${totalRounds})\n${params.task}`);
					if (params.context) {
						parts.push(`### Context\n${params.context}`);
					}
					parts.push(
						`### Attached Files (Batch 1/${totalRounds} — 100% Uncompressed Full Text)\n${batch.join("\n\n")}`,
					);
					parts.push(
						`⚡ [Multi-Turn Loop Round 1/${totalRounds}] 請僅針對上述 Task 的核心目標，從本批次檔案提取最關鍵的事實筆記（嚴格限制於 8 行 / 200 字以內，禁止展開長篇分析，下一輪將繼續輸入後續檔案）。`,
					);
				} else if (roundIdx < totalRounds - 1) {
					parts.push(
						`### Attached Files (Batch ${roundIdx + 1}/${totalRounds} — 100% Uncompressed Full Text)\n${batch.join("\n\n")}`,
					);
					parts.push(
						`⚡ [Multi-Turn Loop Round ${roundIdx + 1}/${totalRounds}] 請結合前一輪筆記，從本批次檔案補充與 Task 直接相關的重點筆記（嚴格限制於 8 行 / 200 字以內，下一輪將繼續輸入後續檔案）。`,
					);
				} else {
					parts.push(
						`### Attached Files (Batch ${totalRounds}/${totalRounds} — 100% Uncompressed Full Text)\n${batch.join("\n\n")}`,
					);
					parts.push(
						`🎯 [Multi-Turn Loop Final Round ${totalRounds}/${totalRounds}] 所有附加檔案 (${attachedFileSections.length} 檔) 已完整輸入完畢！請綜合前面所有輪次的完整檔案內容與你的跨輪次推理筆記，完整回答最初的 Task：\n${params.task}`,
					);
				}
				const blocks: Array<TextContent | ImageContent> = [{ type: "text", text: parts.join("\n\n") }];
				if (roundIdx === 0 && imageBlock) {
					blocks.push(imageBlock);
				}
				return blocks;
			};

			const isRateLimit429 = (reason: string): boolean =>
				/\b429\b|rate[_\s-]?limit|resource[_\s-]?exhausted|too many requests|quota/i.test(reason);

			const sleepWithSignal = (ms: number, abortSig?: AbortSignal): Promise<void> =>
				new Promise((resolve, reject) => {
					if (abortSig?.aborted) {
						reject(new Error("Aborted"));
						return;
					}
					const timer = setTimeout(resolve, ms);
					if (abortSig) {
						abortSig.addEventListener(
							"abort",
							() => {
								clearTimeout(timer);
								reject(new Error("Aborted"));
							},
							{ once: true },
						);
					}
				});

			// M2 + Router v2: Iterate candidateModels with Per-Loop Sticky Key, Multi-Turn Progressive Loop,
			// In-Place 429 Exponential Backoff Wait (preserves Prefix KV Cache), Per-Round Checkpoint Preservation
			// (never discards completed intermediate rounds when a later round times out), and fast failover on 404/5xx
			const fallbackErrors: string[] = [];
			let lastAssistantMsg: any = null;
			let selectedModel = candidateModels[0]!;
			const conversationMessages: any[] = [];
			const roundNotes: string[] = [];
			let completedRoundIdx = 0;

			// Top-Level Usage Accumulator (Killer 4 Fix):
			// Sums token usage & cost across all multi-turn rounds so `/session` and `/context` reflect 100% of specialist consumption.
			const aggregatedUsage = {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 0,
				cost: {
					input: 0,
					output: 0,
					cacheRead: 0,
					cacheWrite: 0,
					total: 0,
				},
			};
			const accumulateAssistantUsage = (u: any) => {
				if (!u || typeof u !== "object") return;
				const inp = Number(u.input ?? 0) || 0;
				const out = Number(u.output ?? 0) || 0;
				const cr = Number(u.cacheRead ?? 0) || 0;
				const cw = Number(u.cacheWrite ?? 0) || 0;
				const tot = Number(u.totalTokens ?? inp + out + cr + cw) || inp + out + cr + cw;
				aggregatedUsage.input += inp;
				aggregatedUsage.output += out;
				aggregatedUsage.cacheRead += cr;
				aggregatedUsage.cacheWrite += cw;
				aggregatedUsage.totalTokens += tot;
				if (u.cost && typeof u.cost === "object") {
					aggregatedUsage.cost.input += Number(u.cost.input ?? 0) || 0;
					aggregatedUsage.cost.output += Number(u.cost.output ?? 0) || 0;
					aggregatedUsage.cost.cacheRead += Number(u.cost.cacheRead ?? 0) || 0;
					aggregatedUsage.cost.cacheWrite += Number(u.cost.cacheWrite ?? 0) || 0;
					aggregatedUsage.cost.total += Number(u.cost.total ?? 0) || 0;
				} else if (typeof u.cost === "number") {
					aggregatedUsage.cost.total += u.cost;
				}
			};

			for (let i = 0; i < candidateModels.length; i++) {
				const candidate = candidateModels[i]!;
				selectedModel = candidate;

				// Acquire a Sticky Key once for the entire Multi-Turn Loop and pass it explicitly via `options.apiKey`
				// without calling `ctx.modelRegistry.refresh()` or mutating the Main Orchestrator's default key (Killer 2 Fix).
				const stickyKeyInfo = acquireStickyProviderKey(candidate.provider);

				let candidateFailed = false;
				let finalOutputText = "";

				for (let roundIdx = completedRoundIdx; roundIdx < totalRounds; roundIdx++) {
					const roundBlocks = buildRoundUserContent(roundIdx);
					conversationMessages.push({
						role: "user",
						content: roundBlocks,
						timestamp: Date.now(),
					});

					const backoffScheduleMs = [5000, 10000];
					let roundSucceeded = false;
					const isIntermediateRound = totalRounds > 1 && roundIdx < totalRounds - 1;

					for (let attempt = 0; attempt <= backoffScheduleMs.length; attempt++) {
						const hasHeavyPayload = attachedFileSections.length > 0 || Boolean(imageBlock);
						const perRoundTimeoutMs = isIntermediateRound || !hasHeavyPayload ? 22000 : 38000;
						const candidateSignal = signal
							? AbortSignal.any([signal, AbortSignal.timeout(perRoundTimeoutMs)])
							: AbortSignal.timeout(perRoundTimeoutMs);

						try {
							const assistantMsg = await ctx.modelRegistry.complete(
								candidate,
								{
									systemPrompt: fullSystemPrompt,
									messages: conversationMessages,
								},
								{
									signal: candidateSignal,
									...(stickyKeyInfo.key ? { apiKey: stickyKeyInfo.key } : {}),
									...(isIntermediateRound ? { maxTokens: 768 } : {}),
								},
							);
							lastAssistantMsg = assistantMsg;
							accumulateAssistantUsage(assistantMsg?.usage);
							const textBlocks = assistantMsg.content
								.filter((b): b is { type: "text"; text: string } => b.type === "text")
								.map((b) => b.text);
							const thinkingBlocks = (assistantMsg.content as any[])
								.filter((b) => b?.type === "thinking" && typeof b.thinking === "string")
								.map((b) => b.thinking);
							const outputText = textBlocks.join("\n").trim() || thinkingBlocks.join("\n").trim();
							const isErr = assistantMsg.stopReason === "error" || Boolean(assistantMsg.errorMessage);

							if (!isErr && outputText) {
								// Push clean assistant text message (strip bulky internal thinking blocks across turns
								// to keep multi-turn payload compact and compatible with all OpenAI-style NIM endpoints)
								conversationMessages.push({
									role: "assistant",
									content: [{ type: "text", text: outputText }],
									timestamp: Date.now(),
								});
								finalOutputText = outputText;
								if (isIntermediateRound) {
									roundNotes.push(`**[Round ${roundIdx + 1}/${totalRounds} Notes]**\n${outputText}`);
								}
								completedRoundIdx = roundIdx + 1;
								roundSucceeded = true;
								break;
							}

							const errReason =
								assistantMsg.errorMessage || `stopReason=${assistantMsg.stopReason} (empty output)`;
							if (isRateLimit429(errReason) && attempt < backoffScheduleMs.length) {
								await sleepWithSignal(backoffScheduleMs[attempt]!, signal);
								continue;
							}
							fallbackErrors.push(
								`${candidate.provider}/${candidate.id} (round ${roundIdx + 1}/${totalRounds}): ${errReason}`,
							);
							break;
						} catch (err: any) {
							const errMsg = err?.message ?? String(err);
							if (isRateLimit429(errMsg) && attempt < backoffScheduleMs.length) {
								try {
									await sleepWithSignal(backoffScheduleMs[attempt]!, signal);
									continue;
								} catch {
									// Aborted by parent signal
								}
							}
							fallbackErrors.push(
								`${candidate.provider}/${candidate.id} (round ${roundIdx + 1}/${totalRounds}): ${errMsg}`,
							);
							break;
						}
					}

					if (!roundSucceeded) {
						// Pop the uncompleted user prompt so the next fallback candidate resumes cleanly from completedRoundIdx
						conversationMessages.pop();
						candidateFailed = true;
						break;
					}
				}

				if (!candidateFailed && finalOutputText) {
					const fallbackNotice =
						fallbackErrors.length > 0
							? `⚡ *[Auto-Fallback Triggered: ${fallbackErrors.join(" | ")} -> Completed by ${candidate.provider}/${candidate.id}]*\n\n`
							: "";
					const loopBadge =
						totalRounds > 1
							? ` | Multi-Turn Loop: ${totalRounds} rounds (${attachedFileSections.length} files)`
							: "";
					const keyBadge =
						stickyKeyInfo.poolSize > 1
							? ` | StickyKey #${stickyKeyInfo.keyIndex + 1}/${stickyKeyInfo.poolSize}`
							: "";
					return {
						content: [
							{
								type: "text",
								text: `🤖 **[Specialist: ${role} | Model: ${candidate.provider}/${candidate.id}${loopBadge}${keyBadge}]**\n\n${fallbackNotice}${finalOutputText}`,
							},
						],
						details: {
							specialist: role,
							model: `${candidate.provider}/${candidate.id}`,
							multiTurnRounds: totalRounds,
							attachedFileCount: attachedFileSections.length,
							stickyKeyIndex: stickyKeyInfo.keyIndex,
							keyPoolSize: stickyKeyInfo.poolSize,
							intermediateRoundNotes: roundNotes,
							fallbackAttempts: i,
							stopReason: lastAssistantMsg?.stopReason,
							usage: aggregatedUsage,
						},
						usage: aggregatedUsage,
						isError: false,
					};
				}
			}

			const errorSummary = fallbackErrors.join("\n- ");
			const partialNotesSuffix =
				roundNotes.length > 0
					? `\n\n📌 **[Preserved Intermediate Notes (${completedRoundIdx}/${totalRounds} rounds completed before timeout)]**\n${roundNotes.join("\n\n")}`
					: "";
			return {
				content: [
					{
						type: "text",
						text: `❌ **[Specialist: ${role} | All Candidate Models Exhausted]**\n- ${errorSummary}${partialNotesSuffix}`,
					},
				],
				details: {
					specialist: role,
					model: `${selectedModel.provider}/${selectedModel.id}`,
					fallbackErrors,
					completedRounds: completedRoundIdx,
					intermediateRoundNotes: roundNotes,
					stopReason: lastAssistantMsg?.stopReason ?? "error",
					usage: aggregatedUsage,
				},
				usage: aggregatedUsage,
				isError: true,
			};
		},
	});

	function formatStatusSummary(ctx: ExtensionContext): string {
		loadPersistedRoleModels();
		const authData = readAuthJson();
		const configuredProviders = Object.keys(authData).map((prov) => {
			const pool = getProviderKeyPool(prov);
			if (pool.length > 1) {
				const activeIdx = typeof authData[prov]?.activeKeyIndex === "number" ? authData[prov].activeKeyIndex : 0;
				return `${prov} (${pool.length} keys, Sticky #${activeIdx + 1})`;
			}
			return prov;
		});
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
		lines.push(`  • /mode key <provider> <Key1,Key2,...>          : 設定單一或多帳號輪詢金鑰池 (Per-Loop Sticky Round-Robin)`);
		lines.push(`  • /mode key add <provider> <NewAPIKey>          : 追加新帳號 API Key 至該 Provider 輪詢池`);
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

			const existingPool = getProviderKeyPool(providerId);
			let appendMode = false;
			if (existingPool.length > 0) {
				const keyAction = await scrollableSelect(
					ctx,
					`[${providerId}] 目前已設定 ${existingPool.length} 組 API Key，請選擇操作方式:`,
					[
						`➕ 追加新帳號 API Key 至輪詢池 (目前 ${existingPool.length} 組，支援 Per-Loop Sticky Round-Robin)`,
						"🔄 覆寫替換全部 API Key (可輸入單組或以逗號分隔多組 Key1,Key2,...)",
					],
				);
				if (!keyAction) return;
				appendMode = keyAction.startsWith("➕");
			}

			const keyInput = await ctx.ui.input(
				`請輸入 [${providerId}] 的 API Key (可輸入單組或以逗號分隔多組 Key1,Key2，權限 600 存入 .Friday/auth.json):`,
			);
			if (!keyInput?.trim()) return;

			const pool = saveProviderKeyPool(providerId, keyInput.trim(), appendMode);
			await ctx.modelRegistry.refresh();
			ctx.ui.notify(
				`✅ 已儲存 [${providerId}] 金鑰池 (共 ${pool.length} 組 API Key，Per-Loop Sticky Round-Robin 已啟用) 至 .Friday/auth.json！`,
				"info",
			);
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
			const defaultOrchShort = DEFAULT_ROLE_MODELS.orchestrator.split("/").pop() ?? DEFAULT_ROLE_MODELS.orchestrator;
			ctx.ui.setStatus("friday-router", `🧠 [ORCHESTRATOR] ${defaultOrchShort}`);
			ctx.ui.notify("✅ 已重設所有角色為預設極速模型池，並恢復 AUTO 與 apex-commander 模式。", "info");
		}
	}

	pi.registerCommand("mode", {
		description:
			"Friday 路由、各角色模型綁定、調度策略與憑證管理: /mode | /mode strategy <apex-commander|hybrid-synergy> | /mode set <role> <model> | /mode key [add] <provider> <key1,key2,...> | /mode vertex <project> [loc] | /mode status",
		handler: async (args, ctx) => {
			loadPersistedRoleModels();
			const tokens = args
				.trim()
				.split(/\s+/)
				.filter(Boolean);
			const sub = tokens[0]?.toLowerCase();

			// 1. No args -> open interactive menu if UI is available, else show status
			if (!sub) {
				if (ctx.hasUI) {
					await openInteractiveModeMenu(ctx);
				} else {
					ctx.ui.notify(formatStatusSummary(ctx), "info");
				}
				return;
			}

			// 2. "/mode status"
			if (sub === "status") {
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
				const defaultOrchShort = DEFAULT_ROLE_MODELS.orchestrator.split("/").pop() ?? DEFAULT_ROLE_MODELS.orchestrator;
				ctx.ui.setStatus("friday-router", `🧠 [ORCHESTRATOR] ${defaultOrchShort}`);
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

			// 6. "/mode key [add] <provider> <apiKey1,apiKey2,...>"
			if (sub === "key") {
				const isAdd = tokens[1]?.toLowerCase() === "add";
				const providerId = (isAdd ? tokens[2] : tokens[1])?.toLowerCase();
				const apiKey = tokens
					.slice(isAdd ? 3 : 2)
					.join(" ")
					.trim();
				if (!providerId || !apiKey) {
					ctx.ui.notify(
						"❌ 用法: /mode key [add] <provider> <Key1,Key2,...>\n範例: /mode key nvidia nvapi-1,nvapi-2 或 /mode key add nvidia nvapi-3",
						"warning",
					);
					return;
				}
				const pool = saveProviderKeyPool(providerId, apiKey, isAdd);
				await ctx.modelRegistry.refresh();
				ctx.ui.notify(
					`✅ 已將 [${providerId}] API Key 安全存入 .Friday/auth.json (權限 600，金鑰池共 ${pool.length} 組，Per-Loop Sticky Round-Robin 已啟用)！`,
					"info",
				);
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

	function estimateStringTokens(text: string): number {
		if (!text) return 0;
		return Math.ceil(text.length / 3.8);
	}

	function extractMessageCharsAndThinking(msg: any): { textChars: number; thinkingChars: number; toolCallChars: number } {
		let textChars = 0;
		let thinkingChars = 0;
		let toolCallChars = 0;
		if (!msg) return { textChars, thinkingChars, toolCallChars };
		if (typeof msg.content === "string") {
			textChars += msg.content.length;
			return { textChars, thinkingChars, toolCallChars };
		}
		if (Array.isArray(msg.content)) {
			for (const b of msg.content) {
				if (!b || typeof b !== "object") continue;
				if (b.type === "text" && typeof b.text === "string") {
					textChars += b.text.length;
				} else if (b.type === "thinking" && typeof b.thinking === "string") {
					thinkingChars += b.thinking.length;
				} else if (b.type === "toolCall") {
					toolCallChars += JSON.stringify(b.arguments ?? {}).length + String(b.name ?? "").length;
				} else if (b.type === "image" && typeof b.data === "string") {
					textChars += Math.min(4800, b.data.length);
				}
			}
		}
		return { textChars, thinkingChars, toolCallChars };
	}

	function formatTok(n: number): string {
		if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
		if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
		return String(Math.round(n));
	}

	function buildContextTelemetryReport(
		ctx: ExtensionContext,
		viewMode: "all" | "turns" | "tools" | "json" = "all",
	): string {
		loadPersistedRoleModels();
		const ctxUsage = ctx.getContextUsage?.() ?? { tokens: 0, contextWindow: 262_144, percent: 0 };
		const sysPrompt = ctx.getSystemPrompt?.() ?? "";
		const sessionKey = `${ctx.sessionManager?.getSessionId?.() ?? "default"}::${ctx.cwd}`;
		const pinnedIndex = getSessionPinnedContextSummary(sessionKey, ctx.cwd, false) ?? "";

		const sysBaseTokens = estimateStringTokens(sysPrompt);
		const sysIndexTokens = estimateStringTokens(pinnedIndex);
		const sysTotalTokens = sysBaseTokens + sysIndexTokens;

		const branchEntries: any[] = ctx.sessionManager?.getBranch?.() ?? [];
		const allEntries: any[] = ctx.sessionManager?.getEntries?.() ?? branchEntries;

		let userTokensEst = 0;
		let mandateCount = 0;
		let assistantTextTokensEst = 0;
		let thinkingTokensEst = 0;
		let toolCallTokensEst = 0;
		let toolResultTokensEst = 0;

		const toolCallInputsById = new Map<string, { name: string; preview: string }>();
		const heavyToolResults: Array<{
			toolName: string;
			preview: string;
			estTokens: number;
			chars: number;
			isOffload: boolean;
		}> = [];

		for (const entry of branchEntries) {
			if (entry?.type === "custom_message" && entry.customType === "friday-mandate") {
				mandateCount++;
				userTokensEst += estimateStringTokens(String(entry.content ?? ""));
				continue;
			}
			if (entry?.type !== "message" || !entry.message) continue;
			const msg = entry.message;
			const { textChars, thinkingChars, toolCallChars } = extractMessageCharsAndThinking(msg);

			if (msg.role === "user" || msg.role === "custom") {
				if (msg.customType === "friday-mandate") mandateCount++;
				userTokensEst += Math.ceil(textChars / 3.8);
			} else if (msg.role === "assistant") {
				assistantTextTokensEst += Math.ceil(textChars / 3.8);
				thinkingTokensEst += Math.ceil(thinkingChars / 3.8);
				toolCallTokensEst += Math.ceil(toolCallChars / 3.8);
				if (Array.isArray(msg.content)) {
					for (const b of msg.content) {
						if (b?.type === "toolCall" && b.id) {
							const args = (b.arguments ?? {}) as Record<string, any>;
							const targetHint =
								args.path ||
								args.imagePath ||
								(Array.isArray(args.filePaths) ? args.filePaths.join(",") : "") ||
								args.specialist ||
								args.agent ||
								args.command ||
								args.task ||
								"";
							const cleanHint = String(targetHint).replace(/\s+/g, " ").trim().slice(0, 46);
							toolCallInputsById.set(String(b.id), {
								name: String(b.name ?? "tool"),
								preview: cleanHint,
							});
						}
					}
				}
			} else if (msg.role === "toolResult") {
				const est = Math.ceil(textChars / 3.8);
				toolResultTokensEst += est;
				const meta = toolCallInputsById.get(String(msg.toolCallId ?? ""));
				const tName = String(msg.toolName ?? meta?.name ?? "tool");
				const preview = meta?.preview || tName;
				heavyToolResults.push({
					toolName: tName,
					preview,
					estTokens: est,
					chars: textChars,
					isOffload: tName === "dispatch_specialist" || tName === "subagent",
				});
			}
		}

		heavyToolResults.sort((a, b) => b.estTokens - a.estTokens);
		const topHeavyTools = heavyToolResults.slice(0, 5);

		// Panel 2 & 3: Scan all session entries for Main Brain turns vs Specialist / Subagent tool calls
		interface TurnForensicRow {
			turnNum: number;
			model: string;
			input: number;
			cacheRead: number;
			cacheWrite: number;
			output: number;
			hitRatePct: number;
			deltaSec: number | null;
			diagnosis: string;
		}
		const turnRows: TurnForensicRow[] = [];
		let prevTurnTs: number | null = null;
		let prevTurnModel: string | null = null;

		const mainTotals = { calls: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
		const specialistTotals = { calls: 0, rounds: 0, filesOffloaded: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
		const subagentTotals = { calls: 0, steps: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };

		for (const entry of allEntries) {
			if (entry?.type !== "message" || !entry.message) continue;
			const msg = entry.message;

			if (msg.role === "assistant" && msg.usage) {
				mainTotals.calls++;
				const u = msg.usage;
				const inp = Number(u.input ?? 0) || 0;
				const out = Number(u.output ?? 0) || 0;
				const cr = Number(u.cacheRead ?? 0) || 0;
				const cw = Number(u.cacheWrite ?? 0) || 0;
				const costVal = typeof u.cost === "object" ? Number(u.cost?.total ?? 0) || 0 : Number(u.cost ?? 0) || 0;

				mainTotals.input += inp;
				mainTotals.output += out;
				mainTotals.cacheRead += cr;
				mainTotals.cacheWrite += cw;
				mainTotals.cost += costVal;

				const promptSide = inp + cr + cw;
				const hitPct = promptSide > 0 ? (cr / promptSide) * 100 : 0;
				const ts = typeof msg.timestamp === "number" ? msg.timestamp : entry.timestamp ? Date.parse(entry.timestamp) : null;
				const deltaSec = prevTurnTs !== null && ts !== null && !Number.isNaN(ts) ? Math.max(0, Math.round((ts - prevTurnTs) / 1000)) : null;
				const modelLabel = `${msg.provider ?? ""}/${msg.model ?? "unknown"}`.replace(/^\//, "");

				let diagnosis = "🟢 CACHE_HIT";
				if (turnRows.length === 0) {
					diagnosis = cr > 0 ? "🟢 WARM_START_HIT" : "❄️ COLD_START (Turn 1)";
				} else if (cr > 0 && hitPct >= 50) {
					diagnosis = "🟢 CACHE_HIT";
				} else if (cr > 0 && hitPct < 50) {
					diagnosis = "🟡 PARTIAL_HIT";
				} else if (prevTurnModel && prevTurnModel !== modelLabel) {
					diagnosis = "🔄 MODEL_SWITCH";
				} else if (deltaSec !== null && deltaSec > 300) {
					diagnosis = `⏰ TTL_EXPIRED (${deltaSec}s > 5m)`;
				} else {
					diagnosis = "⚠️ CACHE_MISS / NO_PROVIDER_CACHE";
				}

				turnRows.push({
					turnNum: turnRows.length + 1,
					model: modelLabel.split("/").pop() ?? modelLabel,
					input: inp,
					cacheRead: cr,
					cacheWrite: cw,
					output: out,
					hitRatePct: hitPct,
					deltaSec,
					diagnosis,
				});

				if (ts !== null && !Number.isNaN(ts)) prevTurnTs = ts;
				prevTurnModel = modelLabel;
			} else if (msg.role === "toolResult") {
				const tName = String(msg.toolName ?? "");
				const u = msg.usage ?? msg.details?.usage;
				if (tName === "dispatch_specialist") {
					specialistTotals.calls++;
					specialistTotals.rounds += Number(msg.details?.multiTurnRounds ?? 1) || 1;
					specialistTotals.filesOffloaded += Number(msg.details?.attachedFileCount ?? 0) || 0;
					if (u && typeof u === "object") {
						specialistTotals.input += Number(u.input ?? 0) || 0;
						specialistTotals.output += Number(u.output ?? 0) || 0;
						specialistTotals.cacheRead += Number(u.cacheRead ?? 0) || 0;
						specialistTotals.cacheWrite += Number(u.cacheWrite ?? 0) || 0;
						specialistTotals.cost +=
							typeof u.cost === "object" ? Number(u.cost?.total ?? 0) || 0 : Number(u.cost ?? 0) || 0;
					}
				} else if (tName === "subagent") {
					subagentTotals.calls++;
					const resultsArr = Array.isArray(msg.details?.results) ? msg.details.results : [];
					subagentTotals.steps += Math.max(1, resultsArr.length);
					if (u && typeof u === "object") {
						subagentTotals.input += Number(u.input ?? 0) || 0;
						subagentTotals.output += Number(u.output ?? 0) || 0;
						subagentTotals.cacheRead += Number(u.cacheRead ?? 0) || 0;
						subagentTotals.cacheWrite += Number(u.cacheWrite ?? 0) || 0;
						subagentTotals.cost +=
							typeof u.cost === "object" ? Number(u.cost?.total ?? 0) || 0 : Number(u.cost ?? 0) || 0;
					} else {
						for (const r of resultsArr) {
							subagentTotals.input += Number(r?.usage?.input ?? 0) || 0;
							subagentTotals.output += Number(r?.usage?.output ?? 0) || 0;
							subagentTotals.cacheRead += Number(r?.usage?.cacheRead ?? 0) || 0;
							subagentTotals.cacheWrite += Number(r?.usage?.cacheWrite ?? 0) || 0;
							subagentTotals.cost += Number(r?.usage?.cost ?? 0) || 0;
						}
					}
				}
			}
		}

		const mainPromptTotal = mainTotals.input + mainTotals.cacheRead + mainTotals.cacheWrite;
		const mainCacheHitPct = mainPromptTotal > 0 ? (mainTotals.cacheRead / mainPromptTotal) * 100 : 0;
		const specPromptTotal = specialistTotals.input + specialistTotals.cacheRead + specialistTotals.cacheWrite;
		const specCacheHitPct = specPromptTotal > 0 ? (specialistTotals.cacheRead / specPromptTotal) * 100 : 0;
		const subPromptTotal = subagentTotals.input + subagentTotals.cacheRead + subagentTotals.cacheWrite;
		const subCacheHitPct = subPromptTotal > 0 ? (subagentTotals.cacheRead / subPromptTotal) * 100 : 0;

		const mainTotalTokens = mainPromptTotal + mainTotals.output;
		const offloadedTotalTokens =
			specPromptTotal + specialistTotals.output + subPromptTotal + subagentTotals.output;
		const grandTotalTokens = mainTotalTokens + offloadedTotalTokens;
		const offloadRatioPct = grandTotalTokens > 0 ? (offloadedTotalTokens / grandTotalTokens) * 100 : 0;

		if (viewMode === "json") {
			return JSON.stringify(
				{
					strategyMode: STRATEGY_MODE,
					orchestratorModel: ROLE_MODELS.orchestrator,
					kvCacheGuards: {
						tailMandateInjection: true,
						nonDisruptiveStickyKey: true,
						sessionPinnedContextIndex: true,
						topLevelToolUsageAggregation: true,
					},
					contextWindow: {
						activeTokens: ctxUsage.tokens ?? 0,
						maxWindow: ctxUsage.contextWindow ?? 262_144,
						percent: Number((ctxUsage.percent ?? 0).toFixed(2)),
						anatomyEstimatedTokens: {
							systemPromptBase: sysBaseTokens,
							sessionPinnedContextIndex: sysIndexTokens,
							userAndMandates: userTokensEst,
							assistantText: assistantTextTokensEst,
							thinking: thinkingTokensEst,
							toolCalls: toolCallTokensEst,
							toolResults: toolResultTokensEst,
						},
						topHeavyToolResults: topHeavyTools,
					},
					offloadMatrix: {
						mainOrchestrator: { ...mainTotals, cacheHitPct: Number(mainCacheHitPct.toFixed(1)) },
						dispatchSpecialist: { ...specialistTotals, cacheHitPct: Number(specCacheHitPct.toFixed(1)) },
						subagent: { ...subagentTotals, cacheHitPct: Number(subCacheHitPct.toFixed(1)) },
						offloadRatioPct: Number(offloadRatioPct.toFixed(1)),
					},
					perTurnForensics: turnRows,
				},
				null,
				2,
			);
		}

		const outLines: string[] = [
			`📊 Friday Context 結構、Token 消耗與 KV Cache 鑑識儀表板 (/context)`,
			`════════════════════════════════════════════════════════════════════════`,
			`🧠 主腦模型: ${ROLE_MODELS.orchestrator} | 策略: ${STRATEGY_MODE} | KV Cache 四大物理防護: ✅ 已啟用`,
		];

		if (viewMode === "all" || viewMode === "tools") {
			const estSum =
				sysTotalTokens +
				userTokensEst +
				assistantTextTokensEst +
				thinkingTokensEst +
				toolCallTokensEst +
				toolResultTokensEst;
			const actualTokens = ctxUsage.tokens ?? estSum;
			const winMax = ctxUsage.contextWindow || 262_144;
			const winPct = ((actualTokens / winMax) * 100).toFixed(1);

			outLines.push(``);
			outLines.push(
				`【Panel 1】Active Context Window 結構解剖 (目前視窗: ${formatTok(actualTokens)} / ${formatTok(winMax)} tokens, ${winPct}%)`,
			);
			outLines.push(`────────────────────────────────────────────────────────────────────────`);
			outLines.push(
				`  • System Prompt (AGENTS.md + 工具宣告)       : ~${formatTok(sysBaseTokens).padStart(7, " ")} tok (Token 0 固定前綴)`,
			);
			outLines.push(
				`  • Session-Pinned CONTEXT_INDEX 單行索引      : ~${formatTok(sysIndexTokens).padStart(7, " ")} tok (釘選防突變 ✅)`,
			);
			outLines.push(
				`  • User Prompts + 尾端隱形 Mandate (${mandateCount} 次)   : ~${formatTok(userTokensEst).padStart(7, " ")} tok (尾端注入不破快取 ✅)`,
			);
			outLines.push(
				`  • Assistant 回應與 Tool Call 參數            : ~${formatTok(assistantTextTokensEst + toolCallTokensEst).padStart(7, " ")} tok`,
			);
			outLines.push(
				`  • Thinking 深度推理區塊                      : ~${formatTok(thinkingTokensEst).padStart(7, " ")} tok`,
			);
			outLines.push(
				`  • Tool Results 工具回傳內容 (${heavyToolResults.length} 筆)         : ~${formatTok(toolResultTokensEst).padStart(7, " ")} tok`,
			);

			if (topHeavyTools.length > 0) {
				outLines.push(`  📌 [Top ${topHeavyTools.length} 最肥 Tool Results 排行榜]:`);
				topHeavyTools.forEach((t, idx) => {
					const badge = t.isOffload ? "🟢專家/子代理摘要" : "🟡主腦直讀";
					outLines.push(
						`     ${idx + 1}. [${t.toolName}] ${t.preview} -> ~${formatTok(t.estTokens)} tok (${t.chars} chars) [${badge}]`,
					);
				});
			}
		}

		if (viewMode === "all") {
			outLines.push(``);
			outLines.push(
				`【Panel 2】主腦 vs. 免費專家/子代理 省流投報率矩陣 (Offload ROI: ${offloadRatioPct.toFixed(1)}% Tokens 已由專家/子代理分擔)`,
			);
			outLines.push(`────────────────────────────────────────────────────────────────────────`);
			outLines.push(
				`  • 🧠 主腦 (Orchestrator)        : ${String(mainTotals.calls).padStart(2, " ")} 輪 | In: ${formatTok(mainTotals.input).padStart(6, " ")} | CacheRead: ${formatTok(mainTotals.cacheRead).padStart(6, " ")} | Out: ${formatTok(mainTotals.output).padStart(6, " ")} | Hit%: ${mainCacheHitPct.toFixed(1).padStart(5, " ")}% | Cost: $${mainTotals.cost.toFixed(4)}`,
			);
			outLines.push(
				`  • ⚡ 專家 (dispatch_specialist) : ${String(specialistTotals.calls).padStart(2, " ")} 次 (${specialistTotals.rounds} 輪/${specialistTotals.filesOffloaded} 檔) | In: ${formatTok(specialistTotals.input).padStart(6, " ")} | CacheRead: ${formatTok(specialistTotals.cacheRead).padStart(6, " ")} | Out: ${formatTok(specialistTotals.output).padStart(6, " ")} | Hit%: ${specCacheHitPct.toFixed(1).padStart(5, " ")}% | Cost: $${specialistTotals.cost.toFixed(4)}`,
			);
			outLines.push(
				`  • 🤖 子代理 (subagent)          : ${String(subagentTotals.calls).padStart(2, " ")} 次 (${subagentTotals.steps} 步) | In: ${formatTok(subagentTotals.input).padStart(6, " ")} | CacheRead: ${formatTok(subagentTotals.cacheRead).padStart(6, " ")} | Out: ${formatTok(subagentTotals.output).padStart(6, " ")} | Hit%: ${subCacheHitPct.toFixed(1).padStart(5, " ")}% | Cost: $${subagentTotals.cost.toFixed(4)}`,
			);
		}

		if (viewMode === "all" || viewMode === "turns") {
			outLines.push(``);
			outLines.push(`【Panel 3】逐輪 Prefix KV Cache 命中率與斷裂根因鑑識 (Per-Turn Cache Forensics)`);
			outLines.push(`────────────────────────────────────────────────────────────────────────`);
			if (turnRows.length === 0) {
				outLines.push(`  (目前尚無已完成的 Assistant 回合紀錄)`);
			} else {
				const sliceTurns = viewMode === "turns" ? turnRows : turnRows.slice(-12);
				if (viewMode !== "turns" && turnRows.length > 12) {
					outLines.push(`  (僅顯示最近 12 輪；輸入 /context turns 可檢視全部 ${turnRows.length} 輪)`);
				}
				for (const r of sliceTurns) {
					const dtStr = r.deltaSec !== null ? `${r.deltaSec}s` : "-";
					outLines.push(
						`  • Turn #${String(r.turnNum).padStart(2, "0")} [${r.model.slice(0, 22).padEnd(22, " ")}] | In:${formatTok(r.input).padStart(6, " ")} | Cache:${formatTok(r.cacheRead).padStart(6, " ")} | Out:${formatTok(r.output).padStart(5, " ")} | Hit:${r.hitRatePct.toFixed(0).padStart(3, " ")}% | Δt:${dtStr.padStart(5, " ")} | ${r.diagnosis}`,
					);
				}
			}
		}

		if (viewMode === "all") {
			outLines.push(``);
			outLines.push(`【Panel 4】自動化優化診斷與建議 (Actionable Optimization Hints)`);
			outLines.push(`────────────────────────────────────────────────────────────────────────`);
			const hints: string[] = [];
			const expiredCount = turnRows.filter((r) => r.diagnosis.startsWith("⏰ TTL_EXPIRED")).length;
			if (expiredCount > 0) {
				hints.push(
					`⏰ 偵測到 ${expiredCount} 次因閒置超過 5 分鐘 (>300s) 導致雲端 KV Cache 自然過期重算；密集互動可維持最高快取命中率。`,
				);
			}
			const heavyDirectReads = topHeavyTools.filter((t) => !t.isOffload && t.estTokens > 2500);
			if (heavyDirectReads.length > 0) {
				hints.push(
					`🟡 發現 ${heavyDirectReads.length} 筆大型工具輸出直接進入主腦 Context（最大: ${heavyDirectReads[0]?.toolName} ~${formatTok(heavyDirectReads[0]?.estTokens ?? 0)} tok）；建議多檔/大檔優先使用 dispatch_specialist(filePaths=[...]) 省流代讀。`,
				);
			}
			if ((ctxUsage.percent ?? 0) > 65) {
				hints.push(
					`🧹 目前主視窗佔用已達 ${(ctxUsage.percent ?? 0).toFixed(1)}%，建議適時執行 /compact 交由免費 Scout 壓縮歷史對話以降低每輪 Prefill 負擔。`,
				);
			}
			if (hints.length === 0) {
				hints.push(
					`✅ Prefix KV Cache 四大物理防護運作正常（System Prompt 0 突變、Sticky Key 隔離、頂層 Usage 完整接線）。`,
				);
			}
			for (const h of hints) {
				outLines.push(`  • ${h}`);
			}
			outLines.push(
				`💡 子指令: /context (完整四維度報告) | /context turns (全回合快取明細) | /context tools (工具肥大排行) | /context json | /context pin-refresh (手動刷新本 Session 釘選之 CONTEXT_INDEX)`,
			);
		}

		return outLines.join("\n");
	}

	pi.registerCommand("context", {
		description:
			"Friday Context 結構解剖、省流投報率 (Offload ROI) 與逐輪 KV Cache 鑑識儀表板: /context [turns|tools|json|pin-refresh]",
		handler: async (args, ctx) => {
			const sub = args.trim().toLowerCase().split(/\s+/)[0] ?? "";
			if (sub === "pin-refresh" || sub === "refresh") {
				clearSessionPinnedContextSummaries();
				const sessionKey = `${ctx.sessionManager?.getSessionId?.() ?? "default"}::${ctx.cwd}`;
				getSessionPinnedContextSummary(sessionKey, ctx.cwd, true);
				ctx.ui.notify(
					"🔄 已手動重新釘選本 Session 之 CONTEXT_INDEX 單行索引！(注意：下一輪將重新建立新的 System Prompt Prefix KV Cache)",
					"info",
				);
				return;
			}
			const viewMode: "all" | "turns" | "tools" | "json" =
				sub === "turns" || sub === "tools" || sub === "json" ? sub : "all";
			const report = buildContextTelemetryReport(ctx, viewMode);
			ctx.ui.notify(report, "info");
		},
	});
}
