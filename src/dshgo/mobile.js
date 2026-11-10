/**
 * 本机管理端口（微信桥）。
 *
 * WebView 白屏时，手机浏览器直接开这个端口就能完成全部操作：看状态、出二维码、
 * 提交验证码、开关通道、断开账号、看启动日志。
 *
 * 只绑 127.0.0.1，不做鉴权，因此不监听 LAN；`WX_MOBILE_PORT=0` 关闭。
 *
 * @module dsh-wechat-plugin/src/dshgo/mobile
 */

import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const DEFAULT_PORT = 18910

function pageHtml() {
  const here = dirname(fileURLToPath(import.meta.url))
  return readFileSync(join(here, '..', '..', 'mobile', 'index.html'), 'utf8')
}

function json(res, status, body) {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-frame-options': 'DENY',
    'x-content-type-options': 'nosniff',
  })
  res.end(payload)
}

function readJson(req) {
  return new Promise(resolve => {
    let raw = ''
    req.on('data', chunk => { raw += chunk })
    req.on('error', () => resolve({}))
    req.on('end', () => {
      if (raw === '') return resolve({})
      try {
        resolve(JSON.parse(raw))
      } catch {
        resolve({})
      }
    })
  })
}

function statusPayload(state) {
  const s = state.snapshot()
  return {
    at: s.at,
    version: s.version,
    ready: s.ready,
    enabled: s.enabled,
    accounts: s.accounts,
    polling: s.polling,
    needsLogin: s.needsLogin,
    bindings: s.bindings,
    login: s.login,
    verifyNote: s.verifyNote,
    errors: s.errors,
    diag: {
      logPath: s.diag?.logPath ?? '',
      statePath: s.diag?.statePath ?? '',
      workspace: s.diag?.workspace ?? '',
      logTail: Array.isArray(s.diag?.logTail) ? s.diag.logTail.slice(-20) : [],
    },
  }
}

/**
 * @param {object} options - `{ state, logger }`
 * @returns {{ port: number, close: () => void }}
 */
export function createMobileServer({ state, logger }) {
  const desired = Number(process.env.WX_MOBILE_PORT ?? DEFAULT_PORT)
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    const pathname = url.pathname
    try {
      if (req.method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
        res.writeHead(200, {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'no-store',
          'x-frame-options': 'DENY',
        })
        res.end(pageHtml())
        return
      }
      if (req.method === 'GET' && pathname === '/health') {
        json(res, 200, { ok: true, port: server.actualPort ?? 0 })
        return
      }
      if (req.method === 'GET' && pathname === '/api/status') {
        json(res, 200, statusPayload(state))
        return
      }
      if (req.method === 'GET' && pathname === '/api/debug') {
        json(res, 200, state.debug())
        return
      }
      if (req.method === 'GET' && pathname === '/api/login') {
        json(res, 200, state.snapshot().login)
        return
      }
      if (req.method === 'POST' && pathname === '/api/login/start') {
        const login = await state.startLogin()
        json(res, 200, { ok: login.qrUrl !== '', login })
        return
      }
      if (req.method === 'POST' && pathname === '/api/login/verify') {
        const body = await readJson(req)
        const accepted = state.provideVerifyCode(body?.code ?? '')
        json(res, 200, { ok: true, accepted, ...statusPayload(state) })
        return
      }
      if (req.method === 'POST' && pathname === '/api/login/cancel') {
        state.cancelLogin()
        json(res, 200, { ok: true, ...statusPayload(state) })
        return
      }
      if (req.method === 'POST' && pathname === '/api/toggle') {
        const body = await readJson(req)
        await state.setEnabled(body?.enabled === true)
        json(res, 200, statusPayload(state))
        return
      }
      if (req.method === 'POST' && pathname === '/api/disconnect') {
        const body = await readJson(req)
        const disconnected = await state.disconnect(body?.accountId ?? '')
        json(res, 200, { ok: disconnected, ...statusPayload(state) })
        return
      }
      if (pathname === '/api/settings') {
        if (req.method === 'POST') {
          const settings = await state.saveSettings(await readJson(req))
          json(res, 200, { ok: true, settings })
          return
        }
        await state.refreshSettings()
        json(res, 200, { ok: true, settings: state.snapshot().settings })
        return
      }
      json(res, 404, { ok: false, error: `未知路径 ${pathname}` })
    } catch (error) {
      json(res, 500, { ok: false, error: String(error?.message ?? error) })
    }
  })

  server.on('error', error => {
    if (error?.code === 'EADDRINUSE' && desired !== 0) {
      logger?.warn?.(`[微信桥] ${desired} 被占用，改用随机端口`)
      server.listen(0, '127.0.0.1')
    }
  })

  if (desired !== 0) {
    server.listen(desired, '127.0.0.1', () => {
      server.actualPort = server.address()?.port ?? desired
      logger?.info?.(`[微信桥] 管理页 http://127.0.0.1:${server.actualPort}`)
    })
  }

  return {
    get port() { return server.actualPort ?? 0 },
    close: () => server.close(),
    server,
  }
}
