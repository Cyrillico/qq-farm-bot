const path = require('node:path');
const { fork } = require('node:child_process');
const { EventEmitter } = require('node:events');
const readline = require('node:readline');
const { UI_EVENT_PREFIX } = require('../src/uiEvents');

function toInt(val, fallback = null) {
    if (val == null || val === '') return fallback;
    const n = Number.parseInt(val, 10);
    return Number.isFinite(n) ? n : fallback;
}

class SessionRunner extends EventEmitter {
    constructor(options = {}) {
        super();
        this.rootDir = options.rootDir || path.join(__dirname, '..');
        this.clientPath = options.clientPath || path.join(this.rootDir, 'client.js');
        this.child = null;
        this.stopRequested = false;
        this.mode = 'run';
        this.args = [];
    }

    isRunning() {
        return Boolean(this.child && this.child.exitCode == null);
    }

    buildArgs(raw = {}) {
        const mode = raw.mode || 'run';
        const args = [];
        if (mode === 'verify') {
            args.push('--verify');
            return { mode, args };
        }
        if (mode === 'decode') {
            if (!raw.decodeData) {
                throw new Error('decode mode requires decodeData');
            }
            args.push('--decode', String(raw.decodeData));
            if (raw.decodeHex) args.push('--hex');
            if (raw.decodeGate) args.push('--gate');
            if (raw.decodeType) args.push('--type', String(raw.decodeType));
            return { mode, args };
        }

        const platform = raw.platform === 'wx' ? 'wx' : 'qq';
        if (platform === 'wx') {
            if (!raw.code) throw new Error('微信模式必须填写 code');
            args.push('--code', String(raw.code), '--wx');
        } else {
            const useQr = Boolean(raw.useQr);
            if (useQr && !raw.code) {
                args.push('--qr');
            } else if (raw.code) {
                args.push('--code', String(raw.code));
            } else {
                throw new Error('QQ 模式需填写 code 或启用扫码');
            }
        }

        const interval = toInt(raw.interval);
        const friendInterval = toInt(raw.friendInterval);
        if (interval != null && interval > 0) args.push('--interval', String(interval));
        if (friendInterval != null && friendInterval > 0) args.push('--friend-interval', String(friendInterval));

        return { mode: 'run', args };
    }

    start(params = {}) {
        if (this.isRunning()) {
            throw new Error('已有运行中的会话');
        }

        const { mode, args } = this.buildArgs(params);
        this.mode = mode;
        this.args = args;
        this.stopRequested = false;

        const child = fork(this.clientPath, args, {
            cwd: this.rootDir,
            silent: true,
            env: {
                ...process.env,
                UI_EVENTS: '1',
            },
        });
        this.child = child;

        this.#bindStream(child.stdout, 'stdout');
        this.#bindStream(child.stderr, 'stderr');

        child.on('spawn', () => {
            this.emit('spawn', {
                pid: child.pid,
                mode: this.mode,
                args: [...this.args],
            });
        });

        child.on('message', (msg) => {
            this.emit('child-message', msg);
        });

        child.on('exit', (code, signal) => {
            const payload = {
                code: Number.isInteger(code) ? code : null,
                signal: signal || '',
                stopRequested: this.stopRequested,
                mode: this.mode,
                args: [...this.args],
            };
            this.child = null;
            this.stopRequested = false;
            this.emit('exit', payload);
        });

        return {
            pid: child.pid,
            mode: this.mode,
            args: [...this.args],
        };
    }

    stop() {
        if (!this.isRunning()) return Promise.resolve(false);

        this.stopRequested = true;
        const child = this.child;
        return new Promise((resolve) => {
            let resolved = false;
            const done = (val) => {
                if (resolved) return;
                resolved = true;
                resolve(val);
            };

            const timer = setTimeout(() => {
                if (this.isRunning()) {
                    try { child.kill('SIGKILL'); } catch (e) { }
                }
            }, 5000);

            child.once('exit', () => {
                clearTimeout(timer);
                done(true);
            });

            try {
                child.kill('SIGINT');
            } catch (e) {
                clearTimeout(timer);
                done(false);
            }
        });
    }

    applyBarkSettings(barkSettings) {
        if (!this.isRunning() || !this.child || !this.child.connected) {
            return false;
        }
        try {
            this.child.send({
                type: 'settings:bark',
                payload: barkSettings || {},
            });
            return true;
        } catch (e) {
            return false;
        }
    }

    #bindStream(stream, streamName) {
        if (!stream) return;
        const rl = readline.createInterface({ input: stream });
        rl.on('line', (line) => {
            if (line.startsWith(UI_EVENT_PREFIX)) {
                const raw = line.slice(UI_EVENT_PREFIX.length);
                try {
                    const frame = JSON.parse(raw);
                    this.emit('ui-event', frame);
                } catch (e) {
                    this.emit('line', {
                        stream: streamName,
                        text: line,
                    });
                }
                return;
            }
            this.emit('line', {
                stream: streamName,
                text: line,
            });
        });
    }
}

module.exports = {
    SessionRunner,
};
