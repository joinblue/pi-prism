/**
 * Friday Dynamic Virtual Model Router (Pillar 3 - model-router.ts)
 * ================================================================
 * Registers virtual model `pi-router/auto` and command `/mode`.
 * Automatically routes each LLM request across verified free NVIDIA NIM models:
 *   - scout     -> nvidia/nemotron-3.5-lightning-30b-a3b (Fast exploration & compaction)
 *   - architect -> deepseek-ai/deepseek-v4.1-flash       (1M ctx, 384K out, Architecture & Vision)
 *   - code      -> poolside/laguna-xs-2.1                (Code generation & refactoring specialist)
 *   - audit     -> z-ai/glm-5.3                          (1M ctx, Cross-model adversarial audit & debug)
 *   - vision    -> deepseek-ai/deepseek-v4.1-flash       (Multimodal image analysis)
 */

import type { Message } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext, ModelRoute, ModelRouteRequest } from "@earendil-works/pi-coding-agent";

const PROVIDER = "nvidia";

export const ROLE_MODELS = {
	scout: "z-ai/glm-5.3-flash",
	architect: "deepseek-ai/deepseek-v4.1-flash",
	code: "poolside/laguna-xs-2.1",
	audit: "z-ai/glm-5.3",
	fast_audit: "nvidia/nemotron-3.5-lightning-30b-a3b",
	vision: "deepseek-ai/deepseek-v4.1-flash",
} as const;

type RouterPhase = "auto" | "scout" | "architect" | "code" | "audit" | "vision";

interface FridayRouterState {
	phase: RouterPhase;
	modelId: string;
	reason: string;
}

type FridayRouteRequest = ModelRouteRequest<FridayRouterState>;

function extractLastUserInfo(messages: readonly Message[]): { text: string; hasImage: boolean } {
	const lastUser = messages.filter((m) => m.role === "user").at(-1);
	if (!lastUser) return { text: "", hasImage: false };
	if (typeof lastUser.content === "string") {
		return { text: lastUser.content, hasImage: false };
	}
	let hasImage = false;
	const texts: string[] = [];
	for (const block of lastUser.content) {
		if (block.type === "image") hasImage = true;
		if (block.type === "text") texts.push(block.text);
	}
	return { text: texts.join("\n"), hasImage };
}

function classifyIntent(text: string, hasImage: boolean): { phase: RouterPhase; modelId: string; reason: string } {
	if (hasImage) {
		return { phase: "vision", modelId: ROLE_MODELS.vision, reason: "Image attachment detected" };
	}
	const lower = text.toLowerCase();

	// 1. Audit / Challenge / Security / Verification intent -> GLM-5.3 (Cross-model reviewer)
	if (/(審查|找碴|會辦|驗證|安全|稽核|漏洞|挑戰|audit|review|challenge|verify|security|bug)/.test(lower)) {
		return { phase: "audit", modelId: ROLE_MODELS.audit, reason: "Dialectical audit / review intent" };
	}

	// 2. Code implementation / Refactoring / Fixing intent -> Laguna-XS-2.1
	if (/(實作|寫程式|重構|修改檔案|修補|測試腳本|implement|refactor|write code|patch|fix|coding)/.test(lower)) {
		return { phase: "code", modelId: ROLE_MODELS.code, reason: "Code implementation intent" };
	}

	// 3. Fast exploration / search / listing intent -> Nemotron 3.5 Lightning
	if (/(搜尋|尋找|列出|查看目錄|快篩|探索|search|find|list files|scout|quick)/.test(lower) && text.length < 160) {
		return { phase: "scout", modelId: ROLE_MODELS.scout, reason: "Fast workspace scout intent" };
	}

	// 4. Default / Architecture / Planning / Schema / Complex reasoning -> DeepSeek V4.1 Flash
	return { phase: "architect", modelId: ROLE_MODELS.architect, reason: "Architecture & deep reasoning" };
}

export default function (pi: ExtensionAPI) {
	let forcedMode: RouterPhase = "auto";

	function resolveRoute(
		request: FridayRouteRequest,
		ctx: ExtensionContext,
		phase: RouterPhase,
		modelId: string,
		reason: string,
	): ModelRoute<FridayRouterState> {
		const model =
			ctx.modelRegistry.find(PROVIDER, modelId) ??
			ctx.modelRegistry.find(PROVIDER, ROLE_MODELS.architect) ??
			ctx.modelRegistry.getAvailable()[0];

		if (!model) {
			throw new Error(`No available NVIDIA models found in Friday model registry.`);
		}

		const shortName = model.id.split("/").pop() ?? model.id;
		if (ctx.hasUI) {
			ctx.ui.setStatus("friday-router", `🧠 [${phase.toUpperCase()}] ${shortName}`);
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
		name: "Friday Auto Router (NVIDIA Multi-Brain)",
		reasoning: true,
		input: ["text", "image"],
		thinkingLevels: ["minimal", "low", "medium", "high"],
		contextWindow: 1_000_000,
		maxTokens: 131_072,
		async route(request, ctx) {
			// Direct calls outside the turn loop (e.g. context compaction) use fast Scout
			if (request.reason === "direct") {
				return resolveRoute(request, ctx, "scout", ROLE_MODELS.scout, "Context compaction / direct call");
			}

			// Manual override via /mode
			if (forcedMode !== "auto") {
				const targetId = ROLE_MODELS[forcedMode];
				return resolveRoute(request, ctx, forcedMode, targetId, `Manual /mode ${forcedMode}`);
			}

			const { text, hasImage } = extractLastUserInfo(request.messages);
			const decision = classifyIntent(text, hasImage);
			return resolveRoute(request, ctx, decision.phase, decision.modelId, decision.reason);
		},
	});

	pi.registerCommand("mode", {
		description: "切換 Friday 動態模型路由模式: /mode [auto|scout|architect|code|audit|vision]",
		handler: async (args, ctx) => {
			const arg = args.trim().toLowerCase() as RouterPhase;
			const validModes: RouterPhase[] = ["auto", "scout", "architect", "code", "audit", "vision"];

			if (!arg) {
				ctx.ui.notify(
					[
						`🧠 Friday Model Router 目前模式: ${forcedMode.toUpperCase()}`,
						`可用模式: /mode auto | scout | architect | code | audit | vision`,
						`  • auto      : 根據任務語意自動切換最佳免費模型`,
						`  • scout     : ${ROLE_MODELS.scout}`,
						`  • architect : ${ROLE_MODELS.architect}`,
						`  • code      : ${ROLE_MODELS.code}`,
						`  • audit     : ${ROLE_MODELS.audit}`,
						`  • vision    : ${ROLE_MODELS.vision}`,
					].join("\n"),
					"info",
				);
				return;
			}

			if (!validModes.includes(arg)) {
				ctx.ui.notify(`❌ 無效的模式 "${arg}"。請使用: ${validModes.join(", ")}`, "warning");
				return;
			}

			forcedMode = arg;
			if (arg === "auto") {
				ctx.ui.setStatus("friday-router", "🧠 [AUTO] pi-router/auto");
				ctx.ui.notify("✅ 已切換為 AUTO 智慧動態路由模式。", "info");
			} else {
				const targetId = ROLE_MODELS[arg];
				ctx.ui.setStatus("friday-router", `🧠 [LOCK:${arg.toUpperCase()}] ${targetId.split("/").pop()}`);
				ctx.ui.notify(`✅ 已鎖定路由模式為 [${arg.toUpperCase()}] -> ${targetId}`, "info");
			}
		},
	});
}
