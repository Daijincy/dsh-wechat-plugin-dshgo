/**
 * dsh-go 原生视图（协议 v1 组件，纯函数）。
 *
 * 组件只用 stack / row / text / callout / list / keyValue / actions / metric，
 * 老 App 也能画。视图 ≤ 32 KiB、≤ 120 节点、列表 ≤ 50 行。
 *
 * @module dsh-wechat-plugin/src/dshgo/views
 */

const MAX_LIST = 50

function text(value, tone) {
  const node = { type: 'text', text: String(value) }
  if (tone !== undefined) node.tone = tone
  return node
}

function callout(value, tone) {
  const node = { type: 'callout', text: String(value) }
  if (tone !== undefined) node.tone = tone
  return node
}

function keyValue(items) {
  return { type: 'keyValue', items }
}

function actions(items) {
  return { type: 'actions', items }
}

function shortPath(value) {
  const path = String(value ?? '')
  if (path.length <= 46) return path
  return `…${path.slice(-44)}`
}

/** 面板一：通道状态。 */
export function statusView(state) {
  const accounts = Array.isArray(state.accounts) ? state.accounts : []
  const children = []
  if (state.ready !== true) {
    children.push(callout('宿主里没有 wechatChannel 服务：通道还没启动，或者注入的服务没满足。', 'bad'))
    children.push(text('在 dsh-go 上，本插件依赖 sessionController / sessions / workspaceRegistry / tools 四个服务。缺一个就会一直挂起。', 'muted'))
    children.push(actions([{ label: '重新检测', action: 'refresh', icon: 'refresh', style: 'primary' }]))
    return { type: 'stack', children }
  }
  const polling = accounts.filter(account => account.polling).length
  children.push(callout(
    state.enabled
      ? (polling > 0 ? `通道已开启，${polling} 个微信账号正在接收消息` : '通道已开启，但还没有账号在轮询（先去「登录」面板扫码）')
      : '通道已关闭。开启后微信端的消息才会进来。',
    state.enabled ? (polling > 0 ? 'good' : 'warn') : 'info',
  ))
  children.push(keyValue([
    ['通道', state.enabled ? '已开启' : '已关闭'],
    ['账号', `${accounts.length} 个`],
    ['轮询中', `${polling} 个`],
    ['会话绑定', `${state.bindings.length} 个`],
    ['需要登录', state.needsLogin ? '是' : '否'],
  ]))
  if (accounts.length > 0) {
    children.push({
      type: 'list',
      items: accounts.slice(0, MAX_LIST).map(account => ({
        title: account.userId !== '' ? `微信 ${account.userId}` : account.accountId,
        subtitle: account.polling ? '轮询中' : '已连接，未轮询',
        trailing: account.polling ? '在线' : '离线',
        tone: account.polling ? 'good' : 'muted',
      })),
    })
  }
  if (state.errors.length > 0) {
    children.push(callout(state.errors.slice(-2).join(' / '), 'bad'))
  }
  children.push(actions([
    // 面板动作上限 2 个，开关与刷新放一行
    { label: state.enabled ? '关闭通道' : '开启通道', action: 'toggle', icon: 'power', style: 'primary' },
    { label: '刷新', action: 'refresh', icon: 'refresh' },
  ]))
  return { type: 'stack', children }
}

/** 面板二：扫码登录。二维码画不出来，把链接和进度给出去，扫码在管理页完成。 */
export function loginView(state) {
  const login = state.login ?? { phase: 'idle', step: '未开始' }
  const children = [
    callout(login.step !== '' ? login.step : '还没有开始登录', login.phase === 'succeeded' ? 'good' : (login.phase === 'failed' ? 'bad' : 'info')),
    keyValue([
      ['阶段', login.phase],
      ['验证码', login.awaitingVerifyCode ? '等待输入' : '不需要'],
      ['二维码', login.qrUrl !== '' ? '已生成' : '无'],
    ]),
  ]
  if (login.awaitingVerifyCode === true) {
    children.push(callout('服务端要求配对验证码。到管理页的「登录」一栏输入 6 位码。', 'warn'))
  }
  if (login.qrUrl !== '') {
    children.push({
      type: 'list',
      items: [{
        title: '打开二维码链接',
        subtitle: '手机浏览器打开即出二维码，用微信扫',
        trailing: '打开',
        icon: 'external',
        action: { id: 'openQr' },
      }],
    })
  }
  if (state.verifyNote !== '') children.push(text(state.verifyNote, 'muted'))
  children.push(actions([
    { label: state.accounts.length > 0 ? '再登一个账号' : '开始扫码登录', action: 'login', icon: 'account', style: 'primary' },
    { label: '取消', action: 'cancelLogin', icon: 'power' },
  ]))
  if (login.qrUrl !== '') {
    children.push(actions([{ label: '复制二维码链接', action: 'copyQr', icon: 'copy' }]))
  }
  return { type: 'stack', children }
}

/** 面板三：微信会话绑定。 */
export function chatView(state) {
  const bindings = Array.isArray(state.bindings) ? state.bindings : []
  const children = [
    keyValue([
      ['绑定数', `${bindings.length}`],
      ['账号数', `${state.accounts.length}`],
      ['工作区', shortPath(state.diag?.workspace ?? '—')],
    ]),
  ]
  if (bindings.length === 0) {
    children.push(callout('还没有微信对话绑定到会话。在微信里给机器人发一句话，就会自动建一条。', 'info'))
  } else {
    children.push({
      type: 'list',
      items: bindings.slice(0, MAX_LIST).map(binding => ({
        title: binding.title !== '' ? binding.title : (binding.sessionId || binding.conversationId),
        subtitle: `对方 ${binding.peerId || '—'}`,
        trailing: '已绑定',
      })),
    })
  }
  children.push(actions([{ label: '刷新绑定', action: 'refresh', icon: 'refresh', style: 'primary' }]))
  return { type: 'stack', children }
}

/** 面板四：诊断。 */
export function diagView(state) {
  const diag = state.diag ?? {}
  const tail = Array.isArray(diag.logTail) ? diag.logTail.slice(-8) : []
  const children = [
    keyValue([
      ['插件版本', state.version || '—'],
      ['通道服务', state.ready ? 'wechatChannel' : '缺失'],
      ['状态文件', shortPath(diag.statePath ?? '—')],
      ['启动日志', shortPath(diag.logPath ?? '—')],
    ]),
    text(diag.settingsWorkspace !== undefined ? `设置里的工作区：${shortPath(diag.settingsWorkspace)}` : '设置里的工作区：未读取', 'muted'),
  ]
  if (state.errors.length > 0) {
    children.push(callout(state.errors.slice(-2).join(' / '), 'bad'))
  }
  if (tail.length > 0) {
    children.push({
      type: 'list',
      items: tail.map((line, index) => ({ title: String(line).slice(0, 120), trailing: `#${index + 1}` })),
    })
  } else {
    children.push(text('启动日志为空（首次安装正常）。', 'muted'))
  }
  children.push(actions([
    { label: '刷新', action: 'refresh', icon: 'refresh', style: 'primary' },
    { label: '复制诊断', action: 'copyDiag', icon: 'copy' },
  ]))
  return { type: 'stack', children }
}

/** 输入框上方状态条。 */
export function stripLabel(state) {
  if (state.ready !== true) return '微信 · 未启动'
  const polling = (state.accounts ?? []).filter(account => account.polling).length
  if (state.enabled !== true) return '微信 · 已关闭'
  if (polling > 0) return `微信 · ${polling} 账号在线`
  return '微信 · 待扫码'
}
