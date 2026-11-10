# dsh-wechat-plugin · dsh-go 版

> **本仓库仅独家适配 [DSH-go](https://github.com/ccch1mneyyy/dsh-Go) 这一项目**
>
> 它是把上游 `dsh-wechat-plugin` 改造成 dsh-go 能用的形态：界面走 dsh-go 的原生面板协议，
> 另外起一个本机端口给手机浏览器兜底。不塞 WebView、不改 dsh-go 的 Kotlin / Flutter 原生层。
> 在非 dsh-go 的宿主上使用不在支持范围内。

[DSH-go 项目](https://github.com/ccch1mneyyy/dsh-Go) · [上游仓库](https://github.com/xcisxc29/dsh-wechat) · [本仓库的 Release](https://github.com/Daijincy/dsh-wechat-plugin-dshgo/releases)

![platform](https://img.shields.io/badge/平台-DSH--go-1f6feb?style=flat-square)
![upstream](https://img.shields.io/badge/上游-0.47.0-444?style=flat-square)
![version](https://img.shields.io/badge/version-0.47.0--dshgo.2-2ea043?style=flat-square)
![license](https://img.shields.io/badge/license-MIT-blue?style=flat-square)
![port](https://img.shields.io/badge/本机端口-18910-8b5cf6?style=flat-square)

---

## 这是什么

在手机上用微信给电脑上的 DSH 发消息，电脑上的 agent 干活——这是上游插件的本事。本仓库只做一件事：

**把它放到 dsh-go 里能用、能看、能操作。**

- 收微信、长轮询、会话路由、审批 / 提问接管、媒体上传这些宿主逻辑**一行没改**；
- 只额外挂了两样东西：**4 个 dsh-go 原生面板** + **一个本机管理页（127.0.0.1:18910）**;
- WebView 里不再有本插件任何前端代码，所以「白屏」从结构上消失。

## 相比上游改了什么

| 改动 | 说明 |
|---|---|
| 删掉 `client.js` 与 `dsh.client` 声明 | 那 614 KB 的 React 网页是白屏来源；dsh-go 不跑它 |
| 新增 `dshGo` 清单 | 4 个面板（微信通道 / 扫码登录 / 微信会话 / 诊断）+ 1 条输入框状态条 |
| 新增 `src/dshgo/*` 与 `mobile/index.html` | 面板桥接、视图数据、本机管理页 |
| `lib/host.js` 只加一处 `mountDshGo(...)` | 在 `apply()` 里挂载，effect 清理时调 disposer |
| `ctx.provide('wechatChannel', runtime)` 加 try/catch | 官方校验器的 stub ctx 没有 `provide`，不能因此崩 |
| 补 `engines.dsh` | 声明宿主基线 |

> 上游 0.47.0 的原始说明保留在 [README-upstream.md](README-upstream.md)，未改动。

## 四个原生面板

| 面板 | 里面有什么 | 动作 |
|---|---|---|
| **微信通道** | 开关状态、账号数、轮询中数量、绑定数、最近错误 | 开启 / 关闭 / 刷新 |
| **扫码登录** | 登录阶段、进度文案、二维码是否已出、验证码是否在等 | 开始扫码 · 取消 · 复制/打开二维码链接 |
| **微信会话** | 每条微信对话绑到哪个会话、对方是谁 | 刷新绑定 |
| **诊断** | 版本、通道服务是否就绪、状态文件与日志路径、启动日志尾部 | 刷新 · 复制诊断 |

输入框上方状态条：`微信 · 2 在线` / `微信 · 未登录`。

> dsh-go 原生面板只能画文字和列表，**画不了二维码图片**。扫码这一步必须在本机管理页完成，面板只给进度和链接。

## 本机管理页（18910）

```bash
# 装完启动日志会打这一行
[微信桥] 管理页 http://127.0.0.1:18910
```

手机和电脑在同一局域网时，把它换成电脑的局域网 IP 就能用手机扫码。

- 端口用 `WX_MOBILE_PORT` 改，设 `0` 即关闭；
- 被占用时自动回落到随机端口，并在日志里明示。

| 接口 | 说明 |
|---|---|
| `GET /` | 管理页（通道开关、扫码、绑定列表、日志） |
| `GET /api/status` | 通道状态、登录态、账号、绑定数、日志尾部 |
| `POST /api/login` | 开始扫码登录 |
| `POST /api/verify` | 提交验证码 |
| `POST /api/cancel` | 取消登录 |
| `POST /api/enable` | 开 / 关通道 |

二维码字段是 `loginState().qrDataUrl`（页面直接 `<img src=…>`）与 `qrUrl`。

## 安装

```bash
dsh plugin --profile go remove dsh-wechat-plugin       # 如果装过原版
dsh plugin --profile go add https://github.com/Daijincy/dsh-wechat-plugin-dshgo/releases/download/v0.47.0-dshgo.2/dsh-wechat-plugin-0.47.0-dshgo.2.tgz
```

启动：

```bash
dsh --profile go --host 127.0.0.1 --port 3301 --no-open
```

> 注意顺序：`dsh --profile <名>` 必须在前，写成 `dsh web --profile …` 会报 `too many arguments`。

## 实现要点（给改同类插件的人）

1. 宿主把 runtime 挂成 cordis 服务 `wechatChannel`，桥接层用 `ctx.get('wechatChannel')` 在**进程内直调**这些方法，不走 HTTP、不需要 token：

```js
status() / loginState() / startLogin() / provideVerifyCode() / cancelLogin()
setEnabled() / disconnect() / bindings() / settingsForPage() / saveSettings()
```

2. 面板注册写法（`deps` 里不能带 `?`，也不能塞进顶层 `inject`）：

```js
ctx.inject(['dshGo'], scoped => {
  const kit = scoped.dshGo
  kit.panel('wechat', { view, data, actions })
  kit.strip('wx', () => '微信 · 2 在线')
})
```

3. 面板 `data` 必须 3 秒内同步返回；视图上限 32 KiB / 120 节点 / 8 层 / list ≤ 50 行；图标只能用白名单（`account` `running` `model` `globe` `refresh` `copy` `external` `power` `download`）。

4. `composer.strip` 容量是 **1**。若同时装了 `dsh-go-memory`，它会把微信在线数并进自己那一行，本插件不再单独占条。

## 目录

```
cli.js                 上游命令行入口
lib/host.js            宿主半侧（上游逻辑 + 一处 mountDshGo 调用）
lib/{routes,interactions,media-kind}.js
dist/core              上游核心构建产物
src/dshgo
├── bridge.js          挂载入口 / 读 channel 服务
├── state.js           面板快照
├── views.js           4 个视图 + 状态条文案
├── panels.js          面板与 strip 注册
└── mobile.js          18910 管理页与接口
mobile/index.html      单文件管理页（含二维码）
cordis.patch.yml       插件补丁声明
README-upstream.md     上游原始说明
```

## 已验证

- 真宿主 `@deepseek-ai/dsh@0.2.1-rc.4`：`dsh plugin --profile web add <tgz>` → 启动日志出现 `channel mounted` 与 `[微信桥] 管理页 http://127.0.0.1:18910`；
- `/api/status` 返回 `ready: true` 与真实日志尾部；
- 18910 被占用时自动改 35917 并在日志明示；
- headless chromium 截图核对管理页渲染。

扫码登录最后一步需要真实微信账号，本机无法代验。

## 许可

[MIT](LICENSE)，与上游一致。上游版权归 [xcisxc29](https://github.com/xcisxc29) 所有；
本仓库的 dsh-go 适配部分同样以 MIT 发布。
