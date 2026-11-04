"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppError = void 0;
exports.isAbort = isAbort;
class AppError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = 'AppError';
    }
}
exports.AppError = AppError;
function isAbort(e) {
    return e instanceof Error && (e.name === 'AbortError' || e.code === 'ABORT_ERR');
}
//# sourceMappingURL=errors.js.map