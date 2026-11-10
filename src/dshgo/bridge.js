/**
 * 把微信桥挂到 dsh-go 的原生界面 + 本机端口上。
 *
 * 宿主半侧照旧跑（它才是真正收发微信消息的那一半）；这里只补两块：
 * 1. `ctx.dshGo` 原生面板（4 个面板 + 状态条）；
 * 2. 127.0.0.1 上的管理端口，WebView 白屏时用手机浏览器打开即可。
 *
 * 桌面 dsh 上 `ctx.dshGo` 不存在，`registerPanels` 的回调不会被调用，其余部分无副作用。
 *
 * @module dsh-wechat-plugin/src/dshgo/bridge
 */

import { createWechatState } from './state.js'
import { registerPanels } from './panels.js'
import { createMobileServer } from './mobile.js'

export function mountDshGo(ctx, { logger, version = '', dataDir = '' } = {}) {
  const state = createWechatState({ ctx, version, dataDir })
  let dispose = () => {}
  let mobile

  try {
    dispose = state.start()
  } catch (error) {
    logger?.warn?.(`[微信桥] 状态轮询启动失败：${error?.message ?? error}`)
  }

  try {
    mobile = createMobileServer({ state, logger })
  } catch (error) {
    logger?.warn?.(`[微信桥] 管理端口启动失败：${error?.message ?? error}`)
  }

  try {
    registerPanels(ctx, { state })
  } catch (error) {
    logger?.warn?.(`[微信桥] 原生面板注册失败：${error?.message ?? error}`)
  }

  return () => {
    try { dispose() } catch { /* ignore */ }
    try { mobile?.close() } catch { /* ignore */ }
  }
}
