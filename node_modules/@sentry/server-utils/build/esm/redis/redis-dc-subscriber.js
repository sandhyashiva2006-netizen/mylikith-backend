import { SERVER_PORT, SERVER_ADDRESS, DB_QUERY_TEXT, DB_SYSTEM_NAME, DB_OPERATION_BATCH_SIZE } from '@sentry/conventions/attributes';
import { debug, startInactiveSpan, SEMANTIC_ATTRIBUTE_SENTRY_OP, SEMANTIC_ATTRIBUTE_SENTRY_ORIGIN } from '@sentry/core';
import { DEBUG_BUILD } from '../debug-build.js';
import { bindTracingChannelToSpan } from '../tracing-channel.js';

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
    DEBUG_BUILD && debug.log("Redis node:diagnostics_channel subscription failed.");
  }
}
function setupCommandChannel(tracingChannel, channelName, getCommandArgs) {
  return bindTracingChannelToSpan(
    tracingChannel(channelName),
    (data) => {
      const args = getCommandArgs(data);
      const statement = args.length ? `${data.command} ${args.join(" ")}` : data.command;
      return startInactiveSpan({
        name: `redis-${data.command}`,
        attributes: {
          [SEMANTIC_ATTRIBUTE_SENTRY_ORIGIN]: ORIGIN,
          [SEMANTIC_ATTRIBUTE_SENTRY_OP]: "db.redis",
          [DB_SYSTEM_NAME]: DB_SYSTEM_NAME_VALUE_REDIS,
          [DB_QUERY_TEXT]: statement,
          ...data.serverAddress != null ? { [SERVER_ADDRESS]: data.serverAddress } : {},
          ...data.serverPort != null ? { [SERVER_PORT]: data.serverPort } : {}
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
function setupBatchChannel(tracingChannel, channelName, getOperationName) {
  return bindTracingChannelToSpan(
    tracingChannel(channelName),
    (data) => {
      return startInactiveSpan({
        name: getOperationName(data),
        attributes: {
          [SEMANTIC_ATTRIBUTE_SENTRY_ORIGIN]: ORIGIN,
          [SEMANTIC_ATTRIBUTE_SENTRY_OP]: "db.redis",
          [DB_SYSTEM_NAME]: DB_SYSTEM_NAME_VALUE_REDIS,
          // should only include batch size greater than 1,
          // or else it isn't properly considered a "batch"
          ...Number(data.batchSize) > 1 ? { [DB_OPERATION_BATCH_SIZE]: data.batchSize } : {},
          ...data.serverAddress != null ? { [SERVER_ADDRESS]: data.serverAddress } : {},
          ...data.serverPort != null ? { [SERVER_PORT]: data.serverPort } : {}
        }
      });
    },
    { captureError: false }
  ).unbind;
}
function setupConnectChannel(tracingChannel, channelName) {
  return bindTracingChannelToSpan(
    tracingChannel(channelName),
    (data) => {
      return startInactiveSpan({
        name: "redis-connect",
        attributes: {
          [SEMANTIC_ATTRIBUTE_SENTRY_ORIGIN]: ORIGIN,
          [SEMANTIC_ATTRIBUTE_SENTRY_OP]: "db.redis.connect",
          [DB_SYSTEM_NAME]: DB_SYSTEM_NAME_VALUE_REDIS,
          ...data.serverAddress != null ? { [SERVER_ADDRESS]: data.serverAddress } : {},
          ...data.serverPort != null ? { [SERVER_PORT]: data.serverPort } : {}
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

export { IOREDIS_DC_CHANNEL_COMMAND, IOREDIS_DC_CHANNEL_CONNECT, REDIS_DC_CHANNEL_BATCH, REDIS_DC_CHANNEL_COMMAND, REDIS_DC_CHANNEL_CONNECT, subscribeRedisDiagnosticChannels };
//# sourceMappingURL=redis-dc-subscriber.js.map
