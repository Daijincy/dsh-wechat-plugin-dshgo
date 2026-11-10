/**
 * 微信桥在 dsh-go 上的状态快照。
 *
 * 宿主侧把 runtime 挂成了 cordis 服务 `wechatChannel`，所以这里不需要走 HTTP，
 * 也不需要 WebView：直接 `ctx.get('wechatChannel')` 拿运行时，调它的公开方法。
 *
 * 面板的 data 函数必须同步返回，因此这里用一只后台轮询器维护快照。
 *
 * @module dsh-wechat-plugin/src/dshgo/state
 */

const POLL_MS = 3500

function trimmed(value, max = 160) {
  const text = String(value ?? '')
  return text.length > max ? `${text.slice(0, max)}…` : text
}

export function createWechatState({ ctx, version = '', dataDir = '' }) {
  const state = {
    ready: false,
    version,
    dataDir,
    enabled: false,
    accounts: [],
    polling: 0,
    needsLogin: true,
    errors: [],
    diag: {},
    bindings: [],
    settings: {},
    login: { phase: 'idle', step: '未开始', qrUrl: '', qrDataUrl: '', awaitingVerifyCode: false },
    verifyNote: '',
    at: 0,
  }
  let timer = 0
  let stopped = false

  function runtime() {
    try {
      return typeof ctx.get === 'function' ? ctx.get('wechatChannel') : undefined
    } catch {
      return undefined
    }
  }

  function noteError(message) {
    const text = trimmed(message, 160)
    if (text === '') return
    if (state.errors[state.errors.length - 1] === text) return
    state.errors = [...state.errors, text].slice(-4)
  }

  function refreshLogin() {
    const rt = runtime()
    if (rt === undefined) return
    try {
      const login = rt.loginState?.() ?? { phase: 'idle' }
      state.login = {
        phase: String(login.phase ?? 'idle'),
        step: String(login.step ?? ''),
        qrUrl: String(login.qrUrl ?? ''),
        qrDataUrl: String(login.qrDataUrl ?? ''),
        awaitingVerifyCode: login.awaitingVerifyCode === true,
      }
    } catch (error) {
      noteError(`读取登录状态失败：${error?.message ?? error}`)
    }
  }

  async function refreshStatus() {
    const rt = runtime()
    if (rt === undefined) {
      state.ready = false
      return
    }
    state.ready = true
    try {
      const status = await rt.status()
      state.enabled = status?.enabled === true
      const accounts = Array.isArray(status?.accounts) ? status.accounts : []
      state.accounts = accounts.map(account => ({
        accountId: String(account.accountId ?? ''),
        userId: String(account.userId ?? ''),
        polling: account.polling === true,
      }))
      state.polling = state.accounts.filter(account => account.polling).length
      state.needsLogin = status?.needsLogin === true
      state.errors = Array.isArray(status?.errors)
        ? status.errors.slice(-4).map(line => trimmed(line, 160))
        : []
      state.diag = status?.diagnostics ?? {}
      refreshLogin()
    } catch (error) {
      noteError(`读取通道状态失败：${error?.message ?? error}`)
    }
  }

  async function refreshBindings() {
    const rt = runtime()
    if (rt === undefined) return
    try {
      const rows = await rt.bindings()
      state.bindings = (Array.isArray(rows) ? rows : []).map(row => ({
        conversationId: String(row.conversationId ?? ''),
        accountId: String(row.accountId ?? ''),
        peerId: String(row.peerId ?? ''),
        sessionId: String(row.sessionId ?? ''),
        title: String(row.title ?? row.sessionTitle ?? ''),
      }))
    } catch (error) {
      noteError(`读取会话绑定失败：${error?.message ?? error}`)
    }
  }

  async function refreshSettings() {
    const rt = runtime()
    if (rt === undefined) return
    try {
      state.settings = (await rt.settingsForPage()) ?? {}
    } catch (error) {
      noteError(`读取设置失败：${error?.message ?? error}`)
    }
  }

  async function startLogin() {
    const rt = runtime()
    if (rt === undefined) return state.login
    try {
      state.verifyNote = ''
      const result = await rt.startLogin()
      refreshLogin()
      if (result !== undefined) state.login = { ...state.login, ...result }
      return state.login
    } catch (error) {
      noteError(`启动登录失败：${error?.message ?? error}`)
      return state.login
    }
  }

  function provideVerifyCode(code) {
    const rt = runtime()
    if (rt === undefined) return false
    try {
      const accepted = rt.provideVerifyCode(String(code ?? ''))
      state.verifyNote = accepted ? '验证码已提交' : '当前没有在等待验证码'
      refreshLogin()
      return accepted
    } catch (error) {
      noteError(`提交验证码失败：${error?.message ?? error}`)
      return false
    }
  }

  function cancelLogin() {
    const rt = runtime()
    if (rt === undefined) return
    try {
      rt.cancelLogin()
      state.verifyNote = '已取消本次登录'
      refreshLogin()
    } catch (error) {
      noteError(`取消登录失败：${error?.message ?? error}`)
    }
  }

  async function setEnabled(enabled) {
    const rt = runtime()
    if (rt === undefined) return false
    try {
      await rt.setEnabled(enabled === true)
      await refreshStatus()
      return state.enabled
    } catch (error) {
      noteError(`切换通道失败：${error?.message ?? error}`)
      return false
    }
  }

  async function disconnect(accountId) {
    const rt = runtime()
    if (rt === undefined) return false
    try {
      const ok = await rt.disconnect(String(accountId ?? ''))
      await refreshStatus()
      return ok === true
    } catch (error) {
      noteError(`断开账号失败：${error?.message ?? error}`)
      return false
    }
  }

  async function saveSettings(patch) {
    const rt = runtime()
    if (rt === undefined) return state.settings
    try {
      await rt.saveSettings(patch ?? {})
      await refreshSettings()
      return state.settings
    } catch (error) {
      noteError(`保存设置失败：${error?.message ?? error}`)
      return state.settings
    }
  }

  async function tick() {
    if (stopped) return
    await refreshStatus()
    await refreshBindings()
    state.at = Date.now()
  }

  function start() {
    stopped = false
    refreshLogin()
    void refreshStatus()
    void refreshBindings()
    void refreshSettings()
    timer = setInterval(() => { void tick() }, POLL_MS)
    timer.unref?.()
    return () => {
      stopped = true
      clearInterval(timer)
    }
  }

  function debug() {
    const rt = runtime()
    const connection = typeof ctx.get === 'function' ? ctx.get('connection') : undefined
    return {
      runtime: rt === undefined ? 'missing' : 'wechatChannel',
      runtimeMethods: rt === undefined ? [] : Object.getOwnPropertyNames(Object.getPrototypeOf(rt) ?? {}).slice(0, 40),
      connectionKeys: connection === undefined ? [] : Object.keys(connection),
      stateReady: state.ready,
      bindings: state.bindings.length,
      loginPhase: state.login.phase,
    }
  }

  return {
    state,
    start,
    debug,
    runtime,
    refreshStatus,
    refreshBindings,
    refreshSettings,
    startLogin,
    provideVerifyCode,
    cancelLogin,
    setEnabled,
    disconnect,
    saveSettings,
    snapshot: () => state,
  }
}
