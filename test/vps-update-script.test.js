const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const scriptPath = path.join(__dirname, '..', 'deploy', 'vps-update.sh');

test('VPS 更新脚本应存在并执行拉取、安装、重启三段式更新', () => {
    assert.equal(fs.existsSync(scriptPath), true, '缺少 deploy/vps-update.sh');
    const content = fs.readFileSync(scriptPath, 'utf8');
    assert.match(content, /git\s+-C\s+"?\$APP_DIR"?\s+fetch\s+origin\s+"?\$BRANCH"?/);
    assert.match(content, /git\s+-C\s+"?\$APP_DIR"?\s+reset\s+--hard\s+"?origin\/\$BRANCH"?/);
    assert.match(content, /npm\s+--prefix\s+"?\$APP_DIR"?\s+install\s+--omit=dev/);
    assert.match(content, /systemctl\s+restart\s+"?\$SERVICE_NAME"?/);
});

test('VPS 更新脚本应支持快速指定目录、服务名和分支', () => {
    const content = fs.readFileSync(scriptPath, 'utf8');
    assert.match(content, /--app-dir <path>/);
    assert.match(content, /--service <name>/);
    assert.match(content, /--branch <name>/);
});
