# 紧急通知：已经有人反馈封号了 低调使用，被举报必封
## 一些提醒：某些人嘴脸不要那么难看，直接拿我原版的程序去倒卖
# QQ经典农场 挂机脚本

#本项目基于原项目仓库https://github.com/linguo2625469/qq-farm-bot进行开发
基于 Node.js 的 QQ/微信 经典农场小程序自动化挂机脚本。通过分析小程序 WebSocket 通信协议（Protocol Buffers），实现全自动农场管理。
本脚本基于ai制作，必然有一定的bug，遇到了建议自己克服一下，后续不一定会更新了

## 功能特性

### 自己农场
- **自动收获** — 检测成熟作物并自动收获
- **自动铲除** — 自动铲除枯死/收获后的作物残留
- **自动种植** — 收获/铲除后自动购买种子并种植（默认按当前等级 + 已解锁土地数计算经验效率后选种；可配置强制最低等级作物）
- **自动施肥** — 种植后自动施放普通肥料加速生长
- **自动除草** — 检测并清除杂草
- **自动除虫** — 检测并消灭害虫
- **自动浇水** — 检测缺水作物并浇水
- **自动出售** — 每分钟自动出售仓库中的果实

### 好友农场
- **好友巡查** — 自动巡查好友农场
- **帮忙操作** — 帮好友浇水/除草/除虫
- **自动偷菜** — 偷取好友成熟作物

### 系统功能
- **自动领取任务** — 自动领取完成的任务奖励，支持分享翻倍/三倍奖励
- **自动同意好友** — 微信同玩好友申请自动同意（支持推送实时响应）
- **邀请码处理** — 启动时自动处理 share.txt 中的邀请链接（微信环境，share.txt有示例，是小程序的path）
- **状态栏显示** — 终端顶部固定显示平台/昵称/等级/经验/金币
- **经验进度** — 显示当前等级经验进度
- **心跳保活** — 自动维持 WebSocket 连接
- **Bark 异常推送** — 连接失败/运行异常自动推送到手机，同类错误默认 60 秒去重
- **Web 控制台** — 局域网网页实时查看日志/状态，支持多账号并发（QQ/WX/多个WX）、QQ扫码、Bark 可视化配置

### 开发工具
- **[PB 解码工具](#pb-解码工具)** — 内置 Protobuf 数据解码器，方便调试分析
- **[经验分析工具](#经验分析工具)** — 分析作物经验效率，计算最优种植策略

## 安装

```bash
git clone https://github.com/linguo2625469/qq-farm-bot.git
cd qq-farm-bot
npm install
```

## 使用

### 获取登录 Code

你需要从小程序中抓取 code。可以通过抓包工具（如 Fiddler、Charles、mitmproxy 等）获取 WebSocket 连接 URL 中的 `code` 参数。

现已支持qq端扫码登录获取code后自动登录，wx不会支持，不需要再提问（wx无此类漏洞）
[lkeme/QRLib](https://github.com/lkeme/QRLib) - 扫码登录使用此项目代码，非常感谢。

### 启动挂机

```bash
# QQ小程序 (无任何参数默认qq平台且使用二维码登录)
node client.js

# QQ小程序 (默认)
node client.js --code <你的登录code>

# 微信小程序
node client.js --code <你的登录code> --wx
```

### 自定义巡查间隔

```bash
# 农场巡查间隔 5 秒，好友巡查间隔 2 秒
node client.js --code <code> --interval 5 --friend-interval 2
```

### Web 控制台（推荐）

```bash
npm run ui
```

启动后可通过以下地址访问：

- 本机：`http://127.0.0.1:3210`
- 局域网：`http://<你的局域网IP>:3210`

Web 控制台支持：

- 多账号并发管理（按 `accountId` 启动/停止独立会话）
- 运行模式切换（run / verify / decode）
- QQ 扫码二维码页面内展示
- 实时日志滚动（每账号最多保留 5000 行，可切换查看单账号/全部账号）
- 账号状态实时展示（平台/昵称/等级/经验/金币/升级还差经验，按账号切换）
- 最佳作物实时展示（当前选种、当前等级最优、下一级最优）
- Bark 链接与通知分类设置（fatal/network/business）并立即生效
- Bark 一键测试推送

多账号使用示例：
1. 在 Web 页面把 `accountId` 填为 `qq-main`，平台选 QQ，启动。
2. 再把 `accountId` 改为 `wx-main`，平台选微信并填对应 code，启动。
3. 会话列表可看到两个独立进程，并可分别查看日志与停止。

### Web 控制台登录鉴权（推荐开启）

通过环境变量开启账号密码登录：

```bash
WEB_UI_AUTH_USERNAME=admin
WEB_UI_AUTH_PASSWORD=change-me
WEB_UI_AUTH_SECRET=change-me-to-a-long-random-string
```

- 设置了 `WEB_UI_AUTH_USERNAME` + `WEB_UI_AUTH_PASSWORD` 后，前端会先显示登录页。
- 登录成功后才可调用 `/api/*`（包含 SSE）。
- 建议同时把 `WEB_UI_HOST` 设为 `127.0.0.1`，减少暴露面。

> 默认监听 `0.0.0.0`，如未开启鉴权会有明显安全风险，请勿直接暴露公网。

### VPS 一键部署（推荐）

仓库内置一键脚本：

```bash
sudo bash deploy/vps-oneclick.sh \
  --domain farm.example.com \
  --repo https://github.com/Cyrillico/qq-farm-bot.git \
  --branch main \
  --auth-user admin
```

脚本会自动完成：
- HTTPS 证书 + Caddy 反代
- systemd 常驻运行
- UFW 防火墙 + fail2ban + 自动安全更新
- Web 控制台账号密码鉴权环境变量写入

完整说明见：`docs/vps-oneclick.md`

### 参数说明

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `--code` | 小程序登录凭证（**必需**） | — |
| `--wx` | 使用微信登录 | QQ 小程序 |
| `--interval` | 自己农场巡查间隔（秒） | 2 |
| `--friend-interval` | 好友巡查间隔（秒） | 1 |
| `--verify` | 验证 proto 定义是否正确 | — |
| `--decode` | 进入 PB 数据解码模式 | — |

### 邀请码功能（微信环境）

在项目根目录创建 `share.txt` 文件，每行一个邀请链接：

```
?uid=123&openid=xxx&share_source=4&doc_id=2
?uid=456&openid=xxx&share_source=4&doc_id=2
```

启动时会自动处理这些邀请链接，申请添加好友。处理完成后文件会被清空。

### PB 解码工具

内置 Protobuf 数据解码器，支持自动推断消息类型：

```bash
# 解码 base64 格式的 gatepb.Message
node client.js --decode CigKGWdhbWVwYi... --gate

# 解码 hex 格式，指定消息类型
node client.js --decode 0a1c0a19... --hex --type gatepb.Message

# 查看解码工具详细帮助
node client.js --decode
```

### 经验分析工具

 * 规则：
 * 1) 每次收获经验 = exp，铲地固定 +1 经验 => 单轮经验 = exp + 1
 * 2) 种植速度：
 *    - 不施肥：2 秒种 18 块地 => 9 块/秒
 *    - 普通肥：2 秒种 12 块地 => 6 块/秒
 * 3) 普通肥：减少 20% 生长时间；若 20% < 30 秒，则固定减少 30 秒
 */

```bash
node tools/calc-exp-yield.js
node tools/calc-exp-yield.js --lands 18 --level 27
node tools/calc-exp-yield.js --input tools/seed-shop-merged-export.json
```

### 当前种子选择逻辑

默认策略（`src/farm.js`）：
1. 拉取商店中当前可购买的种子（已解锁、满足等级、未超限购）。
2. 读取账号等级 + 已解锁土地块数，调用 `tools/calc-exp-yield.js` 的 `getPlantingRecommendation(level, lands)`。
3. 按普通肥经验效率排名，从高到低选择在商店可买到的第一个种子。
4. 若推荐失败，则走兜底排序逻辑。

强制最低等级作物（通常白萝卜）：
- 在 `src/config.js` 设置 `forceLowestLevelCrop: true` 后，直接选择最低等级种子。
- 开启后不再执行经验效率分析推荐。

## 项目结构

<details>
<summary>点击展开项目结构</summary>

```
├── client.js              # CLI 入口文件 - 参数解析与启动调度
├── web-ui.js              # Web 控制台启动入口
├── web/
│   ├── server.js          # HTTP API + SSE + 静态资源服务
│   ├── auth.js            # Web 控制台鉴权（环境变量账号密码 + Cookie 会话）
│   ├── session-runner.js  # 子进程会话桥接（fork + IPC）
│   ├── state-store.js     # 内存状态与日志缓存
│   ├── settings-store.js  # Bark 设置读写与校验
│   └── public/
│       ├── index.html     # Web 控制台页面
│       ├── app.js         # 前端交互逻辑
│       └── styles.css     # 前端样式
├── src/
│   ├── config.js          # 配置常量与生长阶段枚举
│   ├── bark.js            # Bark 推送工具（告警发送+去重）
│   ├── cropAdvisor.js     # 当前等级/下一级最佳作物推荐摘要
│   ├── runtimeSettings.js # 运行时可热更新设置（Bark）
│   ├── uiEvents.js        # Web UI 结构化事件输出
│   ├── utils.js           # 工具函数 (类型转换/日志/时间同步/sleep)
│   ├── proto.js           # Protobuf 加载与消息类型管理
│   ├── network.js         # WebSocket 连接/消息编解码/登录/心跳
│   ├── farm.js            # 自己农场: 收获/浇水/除草/除虫/铲除/种植/施肥
│   ├── friend.js          # 好友农场: 进入/帮忙/偷菜/巡查循环
│   ├── task.js            # 任务系统: 自动领取任务奖励
│   ├── status.js          # 状态栏: 终端顶部固定显示用户状态
│   ├── warehouse.js       # 仓库系统: 自动出售果实
│   ├── invite.js          # 邀请码处理: 自动申请好友
│   ├── gameConfig.js      # 游戏配置: 等级经验表/植物数据
│   └── decode.js          # PB 解码/验证工具模式
├── proto/                 # Protobuf 消息定义
│   ├── game.proto         # 网关消息定义 (gatepb)
│   ├── userpb.proto       # 用户/登录/心跳消息
│   ├── plantpb.proto      # 农场/土地/植物消息
│   ├── corepb.proto       # 通用 Item 消息
│   ├── shoppb.proto       # 商店消息
│   ├── friendpb.proto     # 好友列表/申请消息
│   ├── visitpb.proto      # 好友农场拜访消息
│   ├── notifypb.proto     # 服务器推送通知消息
│   ├── taskpb.proto       # 任务系统消息
│   └── itempb.proto       # 背包/仓库/物品消息
├── gameConfig/            # 游戏配置数据
│   ├── RoleLevel.json     # 等级经验表
│   └── Plant.json         # 植物数据（名称/生长时间/经验等）
├── deploy/
│   └── vps-oneclick.sh    # VPS 一键部署脚本（HTTPS + 反代 + 基础防护）
├── docs/
│   └── vps-oneclick.md    # VPS 一键部署详细说明
├── tools/                 # 辅助工具
│   └── analyze-exp-*.js   # 经验效率分析脚本
├── .qq-farm-ui-settings.example.json # Web UI Bark 设置示例
├── .env.example           # Web UI 环境变量示例（含登录鉴权）
└── package.json
```

</details>

## 运行示例

<details>
<summary>点击展开运行示例</summary>

```
QQ | 我的农场 | Lv24 125/500 | 金币:88888
────────────────────────────────────────────

========== 登录成功 ==========
  GID:    1234567890
  昵称:   我的农场
  等级:   24
  金币:   88888
  时间:   2026/2/7 16:00:00
===============================

[16:00:02] [农场] [收:15 长:0] → 收获15/种植15
[16:00:03] [施肥] 已为 15/15 块地施肥
[16:00:05] [农场] [草:2 虫:1 水:3 长:15] → 除草2/除虫1/浇水3
[16:00:08] [好友] 小明: 偷6(白萝卜)
[16:00:10] [好友] 巡查 5 人 → 偷12/除草3/浇水2
[16:00:15] [仓库] 出售 2 种果实共 300 个，获得 600 金币
[16:00:20] [任务] 领取: 收获5次 → 金币500/经验100

# 微信同玩好友申请自动同意：
[16:05:30] [申请] 收到 1 个好友申请: 小绿
[16:05:31] [申请] 已同意 1 人: 小绿
```

</details>

## 配置说明

### src/config.js

```javascript
const CONFIG = {
    serverUrl: 'wss://gate-obt.nqf.qq.com/prod/ws',
    clientVersion: '1.6.0.14_20251224',
    platform: 'qq',              // 平台: qq 或 wx
    os: 'iOS',
    heartbeatInterval: 25000,    // 心跳间隔 25秒
    farmCheckInterval: 1000,     // 农场巡查完成后等待间隔
    friendCheckInterval: 10000,  // 好友巡查完成后等待间隔
    forceLowestLevelCrop: false, // true: 固定最低等级作物（白萝卜优先），跳过经验效率分析
    barkPushUrl: '',             // 不在源码写入，改为 Web 控制台前端设置
    barkDedupSeconds: 60,         // 同类异常去重时间窗口（秒）
    barkGroup: 'qq-farm-bot',     // Bark 通知分组
};
```

### Bark 推送说明

- 触发范围：
  - 绝大多数 `logWarn` 级别告警
  - WebSocket 非手动断开/错误
  - `uncaughtException` / `unhandledRejection` / 启动失败
- 去重规则：同类错误（去掉数字噪声后）在 `barkDedupSeconds` 时间窗口内只推送一次。
- 快速连通性测试：

```bash
node -e "const { pushBark } = require('./src/bark'); pushBark('测试', '连通性验证').then(()=>process.exit(0));"
```

### Bark Web 可视化设置

- 持久化文件：`/Users/cyril/qq-farm-bot/.qq-farm-ui-settings.json`
- 示例文件：`/Users/cyril/qq-farm-bot/.qq-farm-ui-settings.example.json`
- 页面保存后立即生效（运行中的进程无需重启）
- 建议：公开仓库场景下不要把 Bark 链接写入任何 tracked 文件，只在前端页面设置
- 通知分类：
  - `fatal`：启动失败、未捕获异常等致命问题
  - `network`：WS/登录/心跳/协议解码相关
  - `business`：农场/好友/仓库/任务等业务告警

### src/friend.js

```javascript
const HELP_ONLY_WITH_EXP = true;      // 只在有经验时帮助好友（已更新可用）
const ENABLE_PUT_BAD_THINGS = false;  // 是否启用放虫放草功能（暂不可用 必须关闭，否则有严重的话后果）
```

## 注意事项

1. **登录 Code 有效期有限**，过期后需要重新抓取
2. **请合理设置巡查间隔**，过于频繁可能触发服务器限流
3. **微信环境**才支持邀请码和好友申请功能
4. **QQ环境**下code支持多次使用
5. **WX环境**下code不支持多次使用，请抓包时将code拦截掉

## 免责声明

本项目仅供学习和研究用途。使用本脚本可能违反游戏服务条款，由此产生的一切后果由使用者自行承担。

![Star History Chart](https://api.star-history.com/svg?repos=Cyrillico/qq-farm-bot&type=Date&theme=light)

## License

MIT
