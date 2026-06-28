Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });

const attributes = require('@sentry/conventions/attributes');
const core = require('@sentry/core');
const debugBuild = require('../debug-build.js');
const tracingChannel = require('../tracing-channel.js');

const REDIS_DC_CHANNEL_COMMAND = "node-redis:command";
const REDIS_DC_CHANNEL_BATCH = "node-redis:batch";
const REDIS_DC_CHANNEL_CONNECT = "node-redis:connect";
const IOREDIS_DC_CHANNEL_COMMAND = "ioredis:command";
const IOREDIS_DC_CHANNEL_CONNECT = "ioredis:connect";
const ORIGIN = "auto.db.redis.diagnostic_channel";
const DB_SYSTEM_NAME_VALUE_REDIS = "redis";
let subscribed = false;
let currentResponseHook;
let activeUnbinds = [];
function subscribeRedisDiagnosticChannels(tracingChannel, responseHook) {
  currentResponseHook = responseHook;
  if (subscribed) return;
  subscribed = true;
  try {
    activeUnbinds.push(
      setupCommandChannel(tracingChannel, REDIS_DC_CHANNEL_COMMAND, (data) => data.args.slice(1)),
      setupBatchChannel(
        tracingChannel,
        REDIS_DC_CHANNEL_BATCH,
        (data) => data.batchMode === "PIPELINE" ? "PIPELINE" : "MULTI"
      ),
      setupConnectChannel(tracingChannel, REDIS_DC_CHANNEL_CONNECT),
      // ioredis: args already exclude the command name; no slicing needed. And
      // ioredis has no separate batch channel — pipeline/MULTI metadata rides
      // on the per-command payload via `batchMode`/`batchSize`.
      setupCommandChannel(tracingChannel, IOREDIS_DC_CHANNEL_COMMAND, (data) => data.args),
      setupConnectChannel(tracingChannel, IOREDIS_DC_CHANNEL_CONNECT)
    );
  } catch {
    debugBuild.DEBUG_BUILD && core.debug.log("Redis node:diagnostics_channel subscription failed.");
  }
}
function setupCommandChannel(tracingChannel$1, channelName, getCommandArgs) {
  return tracingChannel.bindTracingChannelToSpan(
    tracingChannel$1(channelName),
    (data) => {
      const args = getCommandArgs(data);
      const statement = args.length ? `${data.command} ${args.join(" ")}` : data.command;
      return core.startInactiveSpan({
        name: `redis-${data.command}`,
        attributes: {
          [core.SEMANTIC_ATTRIBUTE_SENTRY_ORIGIN]: ORIGIN,
          [core.SEMANTIC_ATTRIBUTE_SENTRY_OP]: "db.redis",
          [attributes.DB_SYSTEM_NAME]: DB_SYSTEM_NAME_VALUE_REDIS,
          [attributes.DB_QUERY_TEXT]: statement,
          ...data.serverAddress != null ? { [attributes.SERVER_ADDRESS]: data.serverAddress } : {},
          ...data.serverPort != null ? { [attributes.SERVER_PORT]: data.serverPort } : {}
        }
      });
    },
    {
      // Command failures are surfaced to (and usually handled by) the caller; only annotate the
      // span so we don't emit a duplicate error event for every failed command.
      captureError: false,
      beforeSpanEnd(span, data) {
        if ("error" in data) return;
        runResponseHook(span, data.command, getCommandArgs(data), data.result);
      }
    }
  ).unbind;
}
function setupBatchChannel(tracingChannel$1, channelName, getOperationName) {
  return tracingChannel.bindTracingChannelToSpan(
    tracingChannel$1(channelName),
    (data) => {
      return core.startInactiveSpan({
        name: getOperationName(data),
        attributes: {
          [core.SEMANTIC_ATTRIBUTE_SENTRY_ORIGIN]: ORIGIN,
          [core.SEMANTIC_ATTRIBUTE_SENTRY_OP]: "db.redis",
          [attributes.DB_SYSTEM_NAME]: DB_SYSTEM_NAME_VALUE_REDIS,
          // should only include batch size greater than 1,
          // or else it isn't properly considered a "batch"
          ...Number(data.batchSize) > 1 ? { [attributes.DB_OPERATION_BATCH_SIZE]: data.batchSize } : {},
          ...data.serverAddress != null ? { [attributes.SERVER_ADDRESS]: data.serverAddress } : {},
          ...data.serverPort != null ? { [attributes.SERVER_PORT]: data.serverPort } : {}
        }
      });
    },
    { captureError: false }
  ).unbind;
}
function setupConnectChannel(tracingChannel$1, channelName) {
  return tracingChannel.bindTracingChannelToSpan(
    tracingChannel$1(channelName),
    (data) => {
      return core.startInactiveSpan({
        name: "redis-connect",
        attributes: {
          [core.SEMANTIC_ATTRIBUTE_SENTRY_ORIGIN]: ORIGIN,
          [core.SEMANTIC_ATTRIBUTE_SENTRY_OP]: "db.redis.connect",
          [attributes.DB_SYSTEM_NAME]: DB_SYSTEM_NAME_VALUE_REDIS,
          ...data.serverAddress != null ? { [attributes.SERVER_ADDRESS]: data.serverAddress } : {},
          ...data.serverPort != null ? { [attributes.SERVER_PORT]: data.serverPort } : {}
        }
      });
    },
    { captureError: false }
  ).unbind;
}
function runResponseHook(span, command, args, result) {
  const hook = currentResponseHook;
  if (!hook) return;
  try {
    hook(span, command, args, result);
  } catch {
  }
}

exports.IOREDIS_DC_CHANNEL_COMMAND = IOREDIS_DC_CHANNEL_COMMAND;
exports.IOREDIS_DC_CHANNEL_CONNECT = IOREDIS_DC_CHANNEL_CONNECT;
exports.REDIS_DC_CHANNEL_BATCH = REDIS_DC_CHANNEL_BATCH;
exports.REDIS_DC_CHANNEL_COMMAND = REDIS_DC_CHANNEL_COMMAND;
exports.REDIS_DC_CHANNEL_CONNECT = REDIS_DC_CHANNEL_CONNECT;
exports.subscribeRedisDiagnosticChannels = subscribeRedisDiagnosticChannels;
//# sourceMappingURL=redis-dc-subscriber.js.map
