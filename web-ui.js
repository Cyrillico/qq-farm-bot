const os = require('node:os');
const { startServer } = require('./web/server');

function listLocalIps() {
    const nets = os.networkInterfaces();
    const ips = [];
    for (const name of Object.keys(nets)) {
        const list = nets[name] || [];
        for (const item of list) {
            if (item.family === 'IPv4' && !item.internal) {
                ips.push(item.address);
            }
        }
    }
    return [...new Set(ips)];
}

async function main() {
    const started = await startServer({});
    const ips = listLocalIps();
    console.log(`[WebUI] 控制台已启动: http://127.0.0.1:${started.port}`);
    for (const ip of ips) {
        console.log(`[WebUI] 局域网访问: http://${ip}:${started.port}`);
    }
}

main().catch((err) => {
    console.error('[WebUI] 启动失败:', err);
    process.exit(1);
});
