const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const scriptPath = path.join(__dirname, '..', 'deploy', 'vps-oneclick.sh');

function readScript() {
    return fs.readFileSync(scriptPath, 'utf8');
}

test('VPS 一键部署脚本应把站点配置写入 sites-enabled，避免覆盖主 Caddyfile', () => {
    const content = readScript();
    assert.match(content, /\/etc\/caddy\/sites-enabled/);
    assert.match(content, /import \/etc\/caddy\/sites-enabled\/\*\.caddy/);
    assert.doesNotMatch(content, /cat > \/etc\/caddy\/Caddyfile <<CADDY/);
});

test('VPS 一键部署脚本应校验并重载 Caddy 托管站点配置', () => {
    const content = readScript();
    assert.match(content, /caddy validate/);
    assert.match(content, /systemctl reload caddy \|\| systemctl restart caddy/);
});


test('VPS 一键部署脚本检测到主配置已有同域名站点时应跳过注入，避免冲突', () => {
    const content = readScript();
    assert.match(content, /hasExistingCaddySiteForDomain/);
    assert.match(content, /跳过注入.*同域名/);
});
