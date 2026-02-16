/**
 * UI 结构化事件输出
 * 仅在 UI_EVENTS=1 时启用，通过 stdout 特殊前缀传输。
 */

const UI_EVENT_PREFIX = '@@UI@@';

function isUiEventsEnabled() {
    return process.env.UI_EVENTS === '1';
}

function emitUiEvent(type, payload = {}) {
    if (!isUiEventsEnabled()) return false;
    try {
        const frame = {
            type,
            ts: Date.now(),
            payload,
        };
        process.stdout.write(`${UI_EVENT_PREFIX}${JSON.stringify(frame)}\n`);
        return true;
    } catch (e) {
        return false;
    }
}

module.exports = {
    UI_EVENT_PREFIX,
    isUiEventsEnabled,
    emitUiEvent,
};
