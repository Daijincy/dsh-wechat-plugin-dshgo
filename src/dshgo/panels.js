/**
 * dsh-go 原生面板注册（微信桥）。
 *
 * 只走 `ctx.dshGo` 的公开接口：`panel(id, {view, data, actions})`、`strip`、`refresh`。
 * 没有 dsh-go 桥接的宿主（桌面 dsh / TUI）不会进入这个回调，插件其余部分照常工作。
 *
 * @module dsh-wechat-plugin/src/dshgo/panels
 */

import { statusView, loginView, chatView, diagView, stripLabel } from './views.js'

const POLL_MS = 4000

function effect(value) {
  return value
}

export function registerPanels(ctx, { state }) {
  ctx.inject(['dshGo'], scoped => {
    const kit = scoped.dshGo
    const snapshot = state.snapshot
    let timer = 0
    let last = ''

    const data = () => ({
      at: snapshot().at,
      ready: snapshot().ready,
      enabled: snapshot().enabled,
      accountCount: snapshot().accounts.length,
      polling: snapshot().accounts.filter(account => account.polling).length,
      loginPhase: snapshot().login.phase,
      loginStep: snapshot().login.step,
      qrUrl: snapshot().login.qrUrl,
      needsLogin: snapshot().needsLogin,
      bindings: snapshot().bindings.length,
      errors: snapshot().errors,
    })

    function fingerprint() {
      const s = snapshot()
      return JSON.stringify([
        s.ready, s.enabled, s.accounts.length, s.polling, s.login.phase,
        s.login.qrUrl, s.bindings.length, s.errors[s.errors.length - 1] ?? '',
      ])
    }

    function broadcast() {
      const next = fingerprint()
      if (next === last) return
      last = next
      for (const id of ['wechat', 'login', 'chat', 'diag']) {
        try {
          kit.refresh?.(id)
        } catch {
          // 面板没打开时桥接自己忽略
        }
      }
    }

    timer = setInterval(broadcast, POLL_MS)
    timer.unref?.()
    scoped.effect(() => () => clearInterval(timer), 'dsh-wechat-plugin: dsh-go refresh loop')

    const panelData = (scope, emit) => {
      emit(data())
      const handle = setInterval(() => emit(data()), POLL_MS)
      handle.unref?.()
      return () => clearInterval(handle)
    }

    kit.panel('wechat', {
      view: () => statusView(snapshot()),
      data: panelData,
      actions: {
        toggle: () => ({
          pending: { label: '正在切换通道', timeoutMs: 30_000 },
          result: async () => {
            const want = snapshot().enabled !== true
            await state.setEnabled(want)
            return effect({ toast: want ? '通道已开启' : '通道已关闭' })
          },
        }),
        refresh: () => ({
          pending: { label: '正在刷新', timeoutMs: 20_000 },
          result: async () => {
            await state.refreshStatus()
            await state.refreshBindings()
            return effect({ refresh: true, toast: '已刷新' })
          },
        }),
      },
    })

    kit.panel('login', {
      view: () => loginView(snapshot()),
      data: panelData,
      actions: {
        login: () => ({
          pending: { label: '正在获取二维码', timeoutMs: 60_000 },
          result: async () => {
            const login = await state.startLogin()
            if (login.qrUrl === '') return effect({ toast: '二维码还没出来，稍等再看一眼管理页' })
            return effect({ copy: login.qrUrl, toast: '二维码链接已复制，浏览器打开扫码' })
          },
        }),
        cancelLogin: () => {
          state.cancelLogin()
          return effect({ toast: '已取消登录' })
        },
        copyQr: () => {
          const url = snapshot().login.qrUrl
          if (url === '') return effect({ toast: '还没有二维码' })
          return effect({ copy: url, toast: '二维码链接已复制' })
        },
        openQr: () => {
          const url = snapshot().login.qrUrl
          if (url === '') return effect({ toast: '先点「开始扫码登录」' })
          return effect({ link: url })
        },
      },
    })

    kit.panel('chat', {
      view: () => chatView(snapshot()),
      data: panelData,
      actions: {
        refresh: () => ({
          pending: { label: '正在刷新绑定', timeoutMs: 20_000 },
          result: async () => {
            await state.refreshBindings()
            await state.refreshStatus()
            return effect({ refresh: true, toast: '绑定已更新' })
          },
        }),
      },
    })

    kit.panel('diag', {
      view: () => diagView(snapshot()),
      data: panelData,
      actions: {
        refresh: () => ({
          pending: { label: '正在刷新', timeoutMs: 20_000 },
          result: async () => {
            await state.refreshStatus()
            return effect({ refresh: true, toast: '诊断已刷新' })
          },
        }),
        copyDiag: () => {
          const s = snapshot()
          const body = [
            `version: ${s.version}`,
            `channel service: ${s.ready ? 'wechatChannel' : 'missing'}`,
            `enabled: ${s.enabled}`,
            `accounts: ${s.accounts.length} (polling ${s.polling})`,
            `bindings: ${s.bindings.length}`,
            `login: ${s.login.phase} ${s.login.step}`,
            `errors: ${s.errors.join(' | ') || '(none)'}`,
          ].join('\n')
          return effect({ copy: body, toast: '诊断已复制' })
        },
      },
    })

  })
}
