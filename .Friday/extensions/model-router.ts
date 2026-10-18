/**
 * Friday Orchestrator-First Router & Specialist Dispatcher (Pillar 3 - model-router.ts)
 * =====================================================================================
 * Stage 1 Upgrade:
 * 1. Fixed Main Orchestrator (`orchestrator` -> `nvidia/nemotron-3-super-120b-a12b`, <1s TTFT):
 *    Eliminates fragile keyword-based main-brain switching and preserves KV Cache across turns.
 *    Automatically switches only for:
 *      - `request.reason === "direct"` (compaction / background summary) -> `scout` (`z-ai/glm-5.3-flash`)
 *      - Multimodal image input (`hasImage`) -> `vision` (`nvidia/nemotron-3-nano-omni-30b-a3b-reasoning`)
 *      - Explicit manual `/mode` override
 * 2. Zero-Cold-Start Specialist Dispatch Tool (`dispatch_specialist`):
 *    Allows the Main Orchestrator to invoke any verified `<1s TTFT` specialist model directly
 *    in-process via `ctx.modelRegistry.complete(...)` without subprocess cold-start overhead:
 *      - scout      -> z-ai/glm-5.3-flash                            (TTFT 0.60s, 1M ctx fast exploration)
 *      - architect  -> nvidia/nemotron-3-super-120b-a12b             (TTFT 0.28s, 120B flagship architecture)
 *      - challenger -> nvidia/nemotron-3-nano-omni-30b-a3b-reasoning (TTFT 0.39s, Cross-model adversarial review)
 *      - code       -> poolside/laguna-xs-2.1                        (TTFT 0.28s, Code implementation & refactoring)
 *      - audit      -> z-ai/glm-5.3-flash                            (TTFT 0.60s, Fast verification & audit)
 *      - vision     -> nvidia/nemotron-3-nano-omni-30b-a3b-reasoning (TTFT 0.39s, Multimodal image reasoning)
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { type Message, StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext, ModelRoute, ModelRouteRequest } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const PROVIDER = "nvidia";

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

export const ROLE_MODELS = {
	orchestrator: "nvidia/nemotron-3-super-120b-a12b",
	scout: "z-ai/glm-5.3-flash",
	architect: "nvidia/nemotron-3-super-120b-a12b",
	challenger: "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning",
	code: "poolside/laguna-xs-2.1",
	audit: "z-ai/glm-5.3-flash",
	vision: "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning",
} as const;

export type SpecialistRole = "scout" | "architect" | "challenger" | "code" | "audit" | "vision";
type RouterPhase = "auto" | "orchestrator" | SpecialistRole;

interface FridayRouterState {
	phase: RouterPhase;
	modelId: string;
	reason: string;
}

type FridayRouteRequest = ModelRouteRequest<FridayRouterState>;

const SPECIALIST_SYSTEM_PROMPTS: Record<SpecialistRole, string> = {
	scout: [
		"你是 Friday 團隊中的 Scout (高速情報探索員)，搭載 z-ai/glm-5.3-flash (1M Context)。",
		"職責：快速檢索摘要、定位關鍵結構與事實，所有客觀結論必須標註 [FACT]，推論標註 [INFERRED]，保持極簡高信噪比。",
	].join("\n"),
	architect: [
		"你是 Friday 團隊中的 Architect (首席系統架構師)，搭載 nvidia/nemotron-3-super-120b-a12b 旗艦推理模型。",
		"職責：擬定結構嚴謹的系統設計與 ADR 決策，明確區分 [FACT]、[INFERRED] 與 [HYPOTHESIS]，並定義可證偽驗證條件 (falsifiable_criterion)。",
	].join("\n"),
	challenger: [
		"你是 Friday 團隊中的 Challenger (跨模型紅隊對抗審查官)，搭載 nvidia/nemotron-3-nano-omni-30b-a3b-reasoning 異體推理模型。",
		"核心鐵律 (Anti-Sycophancy Protocol)：絕對禁止盲目附和提案者！專職找出一廂情願的假設、邊界漏洞與未驗證臆測，最後給出 VERDICT: APPROVED 或 VERDICT: CHALLENGED。",
	].join("\n"),
	code: [
		"你是 Friday 團隊中的 Worker/Code Specialist (專精程式碼工程師)，搭載 poolside/laguna-xs-2.1 模型。",
		"職責：根據規格與審查意見，產出高品質、無副作用、具備嚴謹錯誤處理的程式碼或修補方案，嚴禁硬編碼本機絕對路徑。",
	].join("\n"),
	audit: [
		"你是 Friday 團隊中的 Auditor (獨立神諭驗收稽核官)，搭載 z-ai/glm-5.3-flash 模型。",
		"職責：根據客觀驗證輸出、Schema 規則與測試結果進行嚴格核對，標註 [FACT] 並給出明確驗收結論。",
	].join("\n"),
	vision: [
		"你是 Friday 團隊中的 Vision Specialist (多模態視覺推理專家)，搭載 nvidia/nemotron-3-nano-omni-30b-a3b-reasoning 模型。",
		"職責：精確解析視覺與結構化資訊，標註 [FACT] 與 [INFERRED]。",
	].join("\n"),
};

function hasImageAttachment(messages: readonly Message[]): boolean {
	const lastUser = messages.filter((m) => m.role === "user").at(-1);
	if (!lastUser || typeof lastUser.content === "string") return false;
	for (const block of lastUser.content) {
		if (block.type === "image") return true;
	}
	return false;
}

const DispatchSpecialistParams = Type.Object({
	specialist: StringEnum(["scout", "architect", "challenger", "code", "audit", "vision"] as const, {
		description:
			"Target specialist role: scout (fast summary/indexing), architect (120B system design), challenger (cross-model anti-sycophancy review), code (Laguna code generation), audit (verification review), vision (multimodal).",
	}),
	task: Type.String({
		description: "Clear, self-contained task instruction or review question for the specialist model.",
	}),
	context: Type.Optional(
		Type.String({
			description: "Optional supporting context (code snippets, file contents, or draft proposal to review).",
		}),
	),
});

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
			ctx.modelRegistry.find(PROVIDER, ROLE_MODELS.orchestrator) ??
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
		name: "Friday Orchestrator-First Router (Nemotron 120B + Fast Specialists)",
		reasoning: true,
		input: ["text", "image"],
		thinkingLevels: ["minimal", "low", "medium", "high"],
		contextWindow: 262_144,
		maxTokens: 131_072,
		async route(request, ctx) {
			// 1. Direct calls outside the turn loop (e.g. context compaction) use fast Scout (<1s TTFT, 1M ctx)
			if (request.reason === "direct") {
				return resolveRoute(request, ctx, "scout", ROLE_MODELS.scout, "Context compaction / direct call");
			}

			// 2. Manual override via /mode
			if (forcedMode !== "auto") {
				const targetId = ROLE_MODELS[forcedMode];
				return resolveRoute(request, ctx, forcedMode, targetId, `Manual /mode ${forcedMode}`);
			}

			// 3. Multimodal image attachment -> route to vision specialist
			if (hasImageAttachment(request.messages)) {
				return resolveRoute(request, ctx, "vision", ROLE_MODELS.vision, "Image attachment detected");
			}

			// 4. Default Orchestrator-First: fixed flagship 120B brain (preserves KV cache & reasoning stability)
			return resolveRoute(
				request,
				ctx,
				"orchestrator",
				ROLE_MODELS.orchestrator,
				"Fixed Main Orchestrator (Orchestrator-First)",
			);
		},
	});

	pi.registerTool({
		name: "dispatch_specialist",
		label: "Dispatch Specialist",
		description: [
			"Zero-cold-start in-process specialist model dispatcher (<1s TTFT).",
			"Use this tool when the Main Orchestrator needs fast specialized output or cross-model dialectical review without spawning a full CLI subprocess:",
			"- challenger (nvidia/nemotron-3-nano-omni-30b-a3b-reasoning): Cross-model anti-sycophancy review",
			"- code (poolside/laguna-xs-2.1): Focused code synthesis or refactoring",
			"- scout (z-ai/glm-5.3-flash): Fast 1M-context summarization or extraction",
			"- architect (nvidia/nemotron-3-super-120b-a12b): Deep architectural analysis",
			"- audit (z-ai/glm-5.3-flash): Verification output check",
		].join(" "),
		parameters: DispatchSpecialistParams,
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const role = params.specialist as SpecialistRole;
			const targetModelId = ROLE_MODELS[role];
			const model =
				ctx.modelRegistry.find(PROVIDER, targetModelId) ??
				ctx.modelRegistry.find(PROVIDER, ROLE_MODELS.orchestrator);

			if (!model) {
				return {
					content: [
						{
							type: "text",
							text: `❌ Specialist model "${PROVIDER}/${targetModelId}" not found in modelRegistry.`,
						},
					],
					isError: true,
				};
			}

			const userContent = params.context
				? `### Task\n${params.task}\n\n### Context\n${params.context}`
				: params.task;

			const indexSummary = loadCompactIndexSummary(ctx.cwd);
			const fullSystemPrompt = indexSummary
				? `${SPECIALIST_SYSTEM_PROMPTS[role]}\n${indexSummary}`
				: SPECIALIST_SYSTEM_PROMPTS[role];

			const assistantMsg = await ctx.modelRegistry.complete(
				model,
				{
					systemPrompt: fullSystemPrompt,
					messages: [
						{
							role: "user",
							content: userContent,
							timestamp: Date.now(),
						},
					],
				},
				{ signal },
			);

			const textBlocks = assistantMsg.content
				.filter((b): b is { type: "text"; text: string } => b.type === "text")
				.map((b) => b.text);
			const outputText = textBlocks.join("\n").trim() || assistantMsg.errorMessage || "(empty specialist response)";
			const isErr = assistantMsg.stopReason === "error" || Boolean(assistantMsg.errorMessage);

			return {
				content: [
					{
						type: "text",
						text: `🤖 **[Specialist: ${role} | Model: ${model.provider}/${model.id}]**\n\n${outputText}`,
					},
				],
				details: {
					specialist: role,
					model: `${model.provider}/${model.id}`,
					stopReason: assistantMsg.stopReason,
					usage: assistantMsg.usage,
				},
				isError: isErr,
			};
		},
	});

	pi.registerCommand("mode", {
		description:
			"切換 Friday 模型路由模式: /mode [auto|orchestrator|scout|architect|challenger|code|audit|vision]",
		handler: async (args, ctx) => {
			const arg = args.trim().toLowerCase() as RouterPhase;
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

			if (!arg) {
				ctx.ui.notify(
					[
						`🧠 Friday Orchestrator-First Router 目前模式: ${forcedMode.toUpperCase()}`,
						`可用模式: /mode auto | orchestrator | scout | architect | challenger | code | audit | vision`,
						`  • auto         : 固定主腦 (${ROLE_MODELS.orchestrator}) + 自動視覺/壓縮分流`,
						`  • orchestrator : ${ROLE_MODELS.orchestrator} (120B 旗艦主腦, <1s TTFT)`,
						`  • scout        : ${ROLE_MODELS.scout} (1M Context 極速探索)`,
						`  • architect    : ${ROLE_MODELS.architect} (120B 架構設計)`,
						`  • challenger   : ${ROLE_MODELS.challenger} (跨模型紅隊找碴)`,
						`  • code         : ${ROLE_MODELS.code} (Laguna 程式碼專精)`,
						`  • audit        : ${ROLE_MODELS.audit} (極速神諭驗收)`,
						`  • vision       : ${ROLE_MODELS.vision} (多模態視覺推理)`,
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
				ctx.ui.setStatus("friday-router", "🧠 [ORCHESTRATOR] nemotron-3-super-120b-a12b");
				ctx.ui.notify("✅ 已切換為 AUTO (固定主腦 Orchestrator-First) 模式。", "info");
			} else {
				const targetId = ROLE_MODELS[arg];
				ctx.ui.setStatus("friday-router", `🧠 [LOCK:${arg.toUpperCase()}] ${targetId.split("/").pop()}`);
				ctx.ui.notify(`✅ 已鎖定路由模式為 [${arg.toUpperCase()}] -> ${targetId}`, "info");
			}
		},
	});
}
