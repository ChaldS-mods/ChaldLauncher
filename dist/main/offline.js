"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.offlineUuid = offlineUuid;
exports.isValidOfflineName = isValidOfflineName;
const node_crypto_1 = require("node:crypto");
const schemas_1 = require("../shared/schemas");
/**
 * UUID of an offline player, identical to what a vanilla server computes:
 * UUID.nameUUIDFromBytes(("OfflinePlayer:" + name).getBytes(UTF_8)), i.e. a version 3 UUID built from the MD5 hash.
 */
function offlineUuid(name) {
    const h = (0, node_crypto_1.createHash)('md5').update(`OfflinePlayer:${name}`, 'utf8').digest();
    h[6] = (h[6] & 0x0f) | 0x30;
    h[8] = (h[8] & 0x3f) | 0x80;
    const hex = h.toString('hex');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
function isValidOfflineName(name) {
    return schemas_1.offlineNameSchema.safeParse(name).success;
}
//# sourceMappingURL=offline.js.map