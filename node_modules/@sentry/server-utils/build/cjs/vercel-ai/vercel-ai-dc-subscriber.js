Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });

const attributes = require('@sentry/conventions/attributes');
const op = require('@sentry/conventions/op');
const core = require('@sentry/core');
const tracingChannel = require('../tracing-channel.js');

const AI_SDK_TELEMETRY_TRACING_CHANNEL = "ai:telemetry";
const ORIGIN = "auto.vercelai.channel";
const GEN_AI_TOOL_CALL_ID_ATTRIBUTE = "gen_ai.tool.call.id";
const GEN_AI_TOOL_DESCRIPTION_ATTRIBUTE = "gen_ai.tool.description";
const GEN_AI_EMBEDDINGS_OPERATION = "embeddings";
const GEN_AI_RERANK_OPERATION = "rerank";
const GEN_AI_GENERATE_CONTENT_OPERATION = "generate_content";
const VERCEL_AI_OPERATION_ID_ATTRIBUTE = "vercel.ai.operationId";
const VERCEL_AI_MODEL_PROVIDER_ATTRIBUTE = "vercel.ai.model.provider";
const VERCEL_AI_SETTINGS_MAX_RETRIES_ATTRIBUTE = "vercel.ai.settings.maxRetries";
const operationIdByCallId = /* @__PURE__ */ new Map();
const toolDescriptionsByCallId = /* @__PURE__ */ new Map();
const ROOT_OPERATION_TYPES = /* @__PURE__ */ new Set(["generateText", "streamText", "embed", "rerank"]);
function clearOperationId(data) {
  if (!ROOT_OPERATION_TYPES.has(data.type)) {
    return;
  }
  const callId = asString(data.event.callId);
  if (callId) {
    operationIdByCallId.delete(callId);
    toolDescriptionsByCallId.delete(callId);
  }
}
function recordToolDescriptions(callId, tools) {
  if (!callId || !Array.isArray(tools)) {
    return;
  }
  let descriptions = toolDescriptionsByCallId.get(callId);
  for (const tool of tools) {
    if (isRecord(tool) && typeof tool.name === "string" && typeof tool.description === "string") {
      descriptions = descriptions ?? /* @__PURE__ */ new Map();
      if (!descriptions.has(tool.name)) {
        descriptions.set(tool.name, tool.description);
      }
    }
  }
  if (descriptions) {
    toolDescriptionsByCallId.set(callId, descriptions);
  }
}
function resolveToolDescription(callId, toolName, tools) {
  const fromMap = callId ? toolDescriptionsByCallId.get(callId)?.get(toolName) : void 0;
  if (fromMap) {
    return fromMap;
  }
  if (Array.isArray(tools)) {
    const match = tools.find((tool) => isRecord(tool) && tool.name === toolName);
    return isRecord(match) ? asString(match.description) : void 0;
  }
  if (isRecord(tools)) {
    const tool = tools[toolName];
    return isRecord(tool) ? asString(tool.description) : void 0;
  }
  return void 0;
}
let subscribed = false;
function subscribeVercelAiTracingChannel(tracingChannel$1, options = {}) {
  if (subscribed) {
    return;
  }
  subscribed = true;
  tracingChannel.bindTracingChannelToSpan(
    tracingChannel$1(AI_SDK_TELEMETRY_TRACING_CHANNEL),
    (data) => createSpanFromMessage(data, options),
    {
      // The helper ends the span; we enrich it from the settled result first (tokens, output messages,
      // finish reasons, response model/id, provider metadata) and drop the per-operation `callId` maps.
      beforeSpanEnd: (span, data) => {
        enrichSpanOnEnd(span, data, options);
        clearOperationId(data);
      }
    }
  );
}
function createSpanFromMessage(data, channelOptions) {
  const { type, event } = data;
  if (type === "step" || !event || typeof event !== "object") {
    return void 0;
  }
  const { recordInputs, enableTruncation } = getRecordingOptions(event, channelOptions);
  const provider = asString(event.provider);
  const modelId = asString(event.modelId);
  const callId = asString(event.callId);
  const maxRetries = asNumber(event.maxRetries);
  if (recordInputs) {
    recordToolDescriptions(callId, event.tools);
  }
  const baseAttributes = {
    [core.SEMANTIC_ATTRIBUTE_SENTRY_ORIGIN]: ORIGIN,
    ...provider ? { [attributes.GEN_AI_SYSTEM]: provider, [VERCEL_AI_MODEL_PROVIDER_ATTRIBUTE]: provider } : {},
    ...modelId ? { [attributes.GEN_AI_REQUEST_MODEL]: modelId } : {},
    ...maxRetries !== void 0 ? { [VERCEL_AI_SETTINGS_MAX_RETRIES_ATTRIBUTE]: maxRetries } : {}
  };
  switch (type) {
    case "generateText":
    case "streamText":
      return buildInvokeAgentSpan(event, baseAttributes, recordInputs, enableTruncation, callId, type === "streamText");
    case "languageModelCall":
      return buildModelCallSpan(event, baseAttributes, recordInputs, enableTruncation, callId, modelId);
    case "executeTool":
      return buildToolSpan(event, recordInputs);
    case "embed":
      return startGenAiSpan(GEN_AI_EMBEDDINGS_OPERATION, modelId, {
        ...baseAttributes,
        ...recordInputs && event.value !== void 0 ? { [attributes.GEN_AI_EMBEDDINGS_INPUT]: safeStringify(event.value) } : {}
      });
    case "rerank":
      return startGenAiSpan(GEN_AI_RERANK_OPERATION, modelId, baseAttributes);
    default:
      return void 0;
  }
}
function startGenAiSpan(operation, suffix, attributes$1) {
  return core.startInactiveSpan({
    name: suffix ? `${operation} ${suffix}` : operation,
    op: `gen_ai.${operation}`,
    attributes: { [attributes.GEN_AI_OPERATION_NAME]: operation, ...attributes$1 }
  });
}
function buildInvokeAgentSpan(event, baseAttributes, recordInputs, enableTruncation, callId, isStream) {
  const functionId = asString(event.functionId);
  const operationId = asString(event.operationId) ?? (isStream ? "ai.streamText" : "ai.generateText");
  if (callId) {
    operationIdByCallId.set(callId, { operationId, isStream });
  }
  return startGenAiSpan(op.GEN_AI_INVOKE_AGENT_SPAN_OP, functionId, {
    ...baseAttributes,
    [VERCEL_AI_OPERATION_ID_ATTRIBUTE]: operationId,
    [attributes.GEN_AI_RESPONSE_STREAMING]: isStream,
    ...functionId ? { [attributes.GEN_AI_FUNCTION_ID]: functionId } : {},
    ...recordInputs ? buildInputMessageAttributes(event, enableTruncation) : {}
  });
}
function buildModelCallSpan(event, baseAttributes, recordInputs, enableTruncation, callId, modelId) {
  const parent = callId ? operationIdByCallId.get(callId) : void 0;
  const operationId = parent ? `${parent.operationId}.${parent.isStream ? "doStream" : "doGenerate"}` : "ai.generateText.doGenerate";
  return startGenAiSpan(GEN_AI_GENERATE_CONTENT_OPERATION, modelId, {
    ...baseAttributes,
    [VERCEL_AI_OPERATION_ID_ATTRIBUTE]: operationId,
    ...recordInputs ? buildInputMessageAttributes(event, enableTruncation) : {},
    ...recordInputs && Array.isArray(event.tools) ? { [attributes.GEN_AI_REQUEST_AVAILABLE_TOOLS]: safeStringify(event.tools) } : {}
  });
}
function buildToolSpan(event, recordInputs) {
  const toolCall = isRecord(event.toolCall) ? event.toolCall : {};
  const toolName = asString(toolCall.toolName);
  const toolCallId = asString(event.toolCallId) ?? asString(toolCall.toolCallId);
  const toolInput = toolCall.input ?? toolCall.args;
  const description = recordInputs && toolName ? resolveToolDescription(asString(event.callId), toolName, event.tools) : void 0;
  return startGenAiSpan(op.GEN_AI_EXECUTE_TOOL_SPAN_OP, toolName, {
    [core.SEMANTIC_ATTRIBUTE_SENTRY_ORIGIN]: ORIGIN,
    [attributes.GEN_AI_TOOL_TYPE]: "function",
    ...toolName ? { [attributes.GEN_AI_TOOL_NAME]: toolName } : {},
    ...toolCallId ? { [GEN_AI_TOOL_CALL_ID_ATTRIBUTE]: toolCallId } : {},
    ...description ? { [GEN_AI_TOOL_DESCRIPTION_ATTRIBUTE]: description } : {},
    ...recordInputs && toolInput !== void 0 ? { [attributes.GEN_AI_TOOL_INPUT]: safeStringify(toolInput) } : {}
  });
}
function enrichSpanOnEnd(span, data, channelOptions) {
  const { type, result } = data;
  if (!isRecord(result)) {
    return;
  }
  const { recordOutputs } = getRecordingOptions(data.event, channelOptions);
  if (type === "executeTool") {
    if (recordOutputs) {
      span.setAttribute(attributes.GEN_AI_TOOL_OUTPUT, safeStringify(result.output ?? result));
    }
    const output = isRecord(result.output) ? result.output : void 0;
    if (output?.type === "tool-error") {
      captureToolError(span, data, output.error);
    }
    return;
  }
  const usage = isRecord(result.usage) ? result.usage : void 0;
  if (usage) {
    const inputTokens = tokenCount(usage.inputTokens) ?? tokenCount(usage.tokens);
    const outputTokens = tokenCount(usage.outputTokens);
    const totalTokens = tokenCount(usage.totalTokens) ?? sum(inputTokens, outputTokens);
    if (inputTokens !== void 0) {
      span.setAttribute(attributes.GEN_AI_USAGE_INPUT_TOKENS, inputTokens);
    }
    if (outputTokens !== void 0) {
      span.setAttribute(attributes.GEN_AI_USAGE_OUTPUT_TOKENS, outputTokens);
    }
    if (totalTokens !== void 0) {
      span.setAttribute(attributes.GEN_AI_USAGE_TOTAL_TOKENS, totalTokens);
    }
  }
  const finishReason = getFinishReason(result);
  if (finishReason && type === "languageModelCall") {
    span.setAttribute(attributes.GEN_AI_RESPONSE_FINISH_REASONS, safeStringify([finishReason]));
  }
  const response = isRecord(result.response) ? result.response : void 0;
  const responseId = asString(response?.id) ?? asString(result.responseId);
  if (responseId) {
    span.setAttribute(attributes.GEN_AI_RESPONSE_ID, responseId);
  }
  const responseModel = asString(response?.modelId) ?? asString(data.event.modelId);
  if (responseModel) {
    span.setAttribute(attributes.GEN_AI_RESPONSE_MODEL, responseModel);
  }
  const providerMetadata = result.providerMetadata;
  const providerAttributes = core.getProviderMetadataAttributes(providerMetadata);
  if (core.GEN_AI_CONVERSATION_ID_ATTRIBUTE in providerAttributes && core.spanToJSON(span).data[core.GEN_AI_CONVERSATION_ID_ATTRIBUTE]) {
    delete providerAttributes[core.GEN_AI_CONVERSATION_ID_ATTRIBUTE];
  }
  span.setAttributes(providerAttributes);
  if (recordOutputs) {
    const parts = type === "languageModelCall" && Array.isArray(result.content) ? partsFromContent(result.content) : partsFromTextAndToolCalls(result.text, result.toolCalls);
    const outputMessages = buildOutputMessages(parts, finishReason);
    if (outputMessages) {
      span.setAttribute(attributes.GEN_AI_OUTPUT_MESSAGES, outputMessages);
    }
  }
}
function normalizeFinishReason(finishReason) {
  return finishReason === "tool-calls" ? "tool_call" : finishReason ?? "stop";
}
function getFinishReason(result) {
  const finishReason = result.finishReason;
  if (typeof finishReason === "string") {
    return finishReason;
  }
  return isRecord(finishReason) ? asString(finishReason.unified) : void 0;
}
function tokenCount(value) {
  return asNumber(value) ?? (isRecord(value) ? asNumber(value.total) : void 0);
}
function buildOutputMessages(parts, finishReason) {
  if (!parts.length) {
    return void 0;
  }
  return safeStringify([{ role: "assistant", parts, finish_reason: normalizeFinishReason(finishReason) }]);
}
function toolCallPart(toolCall) {
  const args = toolCall.input ?? toolCall.args;
  return {
    type: "tool_call",
    id: asString(toolCall.toolCallId),
    name: asString(toolCall.toolName),
    arguments: typeof args === "string" ? args : safeStringify(args ?? {})
  };
}
function partsFromContent(content) {
  const parts = [];
  for (const item of content) {
    if (!isRecord(item)) {
      continue;
    }
    if (item.type === "text" && typeof item.text === "string") {
      parts.push({ type: "text", content: item.text });
    } else if (item.type === "tool-call") {
      parts.push(toolCallPart(item));
    }
  }
  return parts;
}
function partsFromTextAndToolCalls(text, toolCalls) {
  const parts = [];
  if (typeof text === "string" && text.length) {
    parts.push({ type: "text", content: text });
  }
  if (Array.isArray(toolCalls)) {
    for (const toolCall of toolCalls) {
      if (isRecord(toolCall)) {
        parts.push(toolCallPart(toolCall));
      }
    }
  }
  return parts;
}
function captureToolError(span, data, error) {
  span.setStatus({
    code: core.SPAN_STATUS_ERROR,
    message: error instanceof Error ? error.message : "tool_error"
  });
  const toolCall = isRecord(data.event.toolCall) ? data.event.toolCall : {};
  const toolName = asString(toolCall.toolName);
  const toolCallId = asString(data.event.toolCallId) ?? asString(toolCall.toolCallId);
  core.withScope((scope) => {
    scope.setContext("trace", core.spanToTraceContext(span));
    if (toolName) {
      scope.setTag("vercel.ai.tool.name", toolName);
    }
    if (toolCallId) {
      scope.setTag("vercel.ai.tool.callId", toolCallId);
    }
    scope.setLevel("error");
    core.captureException(
      error instanceof Error ? error : new Error(typeof error === "string" ? error : "Tool execution failed"),
      {
        mechanism: { type: "auto.vercelai.channel", handled: false }
      }
    );
  });
}
function getRecordingOptions(event, channelOptions) {
  const genAI = core.getClient()?.getDataCollectionOptions().genAI;
  return {
    recordInputs: resolveRecording(channelOptions.recordInputs, event.recordInputs, genAI?.inputs),
    recordOutputs: resolveRecording(channelOptions.recordOutputs, event.recordOutputs, genAI?.outputs),
    enableTruncation: core.shouldEnableTruncation(channelOptions.enableTruncation)
  };
}
function resolveRecording(integrationOption, perCallOption, globalDefault) {
  if (typeof integrationOption === "boolean") {
    return integrationOption;
  }
  if (typeof perCallOption === "boolean") {
    return perCallOption;
  }
  return globalDefault === true;
}
function buildInputMessageAttributes(event, enableTruncation) {
  const attributes$1 = {};
  const instructions = asString(event.instructions);
  if (instructions) {
    attributes$1[core.GEN_AI_SYSTEM_INSTRUCTIONS_ATTRIBUTE] = safeStringify([{ type: "text", content: instructions }]);
  }
  const messages = event.messages ?? event.prompt;
  if (messages !== void 0) {
    attributes$1[attributes.GEN_AI_INPUT_MESSAGES] = enableTruncation ? core.getTruncatedJsonString(messages) : safeStringify(messages);
    attributes$1[core.GEN_AI_INPUT_MESSAGES_ORIGINAL_LENGTH_ATTRIBUTE] = Array.isArray(messages) ? messages.length : 1;
  }
  return attributes$1;
}
function asString(value) {
  return typeof value === "string" ? value : void 0;
}
function asNumber(value) {
  return typeof value === "number" && !isNaN(value) ? value : void 0;
}
function sum(a, b) {
  return a === void 0 && b === void 0 ? void 0 : (a ?? 0) + (b ?? 0);
}
function isRecord(value) {
  return typeof value === "object" && value !== null;
}
function safeStringify(value) {
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return "[unserializable]";
  }
}

exports.clearOperationId = clearOperationId;
exports.createSpanFromMessage = createSpanFromMessage;
exports.enrichSpanOnEnd = enrichSpanOnEnd;
exports.subscribeVercelAiTracingChannel = subscribeVercelAiTracingChannel;
//# sourceMappingURL=vercel-ai-dc-subscriber.js.map
