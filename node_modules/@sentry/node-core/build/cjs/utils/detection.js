Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });

require('@sentry/core');
require('../nodeVersion.js');

function isCjs() {
  return true;
  }
function supportsEsmLoaderHooks() {
  {
    return false;
  }
}

exports.isCjs = isCjs;
exports.supportsEsmLoaderHooks = supportsEsmLoaderHooks;
//# sourceMappingURL=detection.js.map
