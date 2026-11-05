/**
 * 纯逻辑 + 组件结构 + 真实 slots 生命周期回归测试。
 *
 * 运行：
 *   node --test test/activity-data.test.cjs
 *
 * 三层证据，均不伪造 UI：
 *  1) 纯数据层（client.js 的 `__activityData`）：官方字段、原生过滤规则、只按官方 id 去重、
 *     先排序后限量、运行优先 + 日期组、日历日（含 DST）。
 *  2) 组件结构层：直接把 SessionRow / ActivityList 当普通函数渲染（React 替身只产描述树、
 *     不建 DOM），检查 leading/标题/右侧元信息结构、归档灰显、点击走 guardedOpen、
 *     groupBy/orderBy 变化触发的自动退出、wide=false 不接管列表。
 *     这只证明「渲染出的结构」，不证明浏览器里的观感。
 *  3) 真实 slots 生命周期：用 DSH 客户端里抽取的 SlotCore 真身，验证注入回调是同步
 *     返回值即 Dispose、开关驱动 occupant 注册/注销、槽位已被占时不抢位。
 *     宿主 Cordis 包装层用测试替身（其源码不在抽取范围内，替身只演示同步回调合同）。
 *
 * 时区：DST 用例需要 TZ=America/New_York，请另跑一遍（见文件末尾说明）。
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const CLIENT = path.join(__dirname, '..', 'client.js')
/*
 * SlotCore 真身来源优先级：
 *  1) DSH_SLOT_CORE 显式指定；
 *  2) 宿主标准准备流程（test/helpers/prepare-host-fixtures.mjs）产出的固定路径；
 *  3) 早期手工抽取的 /tmp 位置（仅本机便利，不算可复现来源）。
 */
const SLOT_CORE_CANDIDATES = [
  path.join(__dirname, '..', '.stage-hostpatch', 'stage', 'ui-slots', 'lib', 'index.js'),
  '/tmp/dsh-client-ui-slots--index.js',
]
const SLOT_CORE_FIXTURE =
  process.env.DSH_SLOT_CORE ?? SLOT_CORE_CANDIDATES.find((candidate) => fs.existsSync(candidate)) ?? SLOT_CORE_CANDIDATES[0]
const IS_DST_CHILD = process.env.TZ === 'America/New_York'

/* ------------------------------------------------------------------ *
 * React 替身：createElement 只产描述树，useEffect 由 runComponent 手动提交
 * ------------------------------------------------------------------ */

const createReactStub = () => {
  let effects = []
  // 同一次挂载的多次渲染共用 refs（等价 React 的 hook 状态），这样组件里的 baseline 能跨渲染保留
  const refs = []
  let refIndex = 0
  const React = {
    createElement: (type, props, ...children) => {
      const flat = []
      for (const child of children) {
        if (Array.isArray(child)) flat.push(...child)
        else flat.push(child)
      }
      return { type, props: { ...(props ?? {}), children: flat } }
    },
    Fragment: 'Fragment',
    useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
    useEffect: (fn) => {
      effects.push(fn)
    },
    useMemo: (factory) => (typeof factory === 'function' ? factory() : undefined),
    useRef: (initial) => {
      if (refs[refIndex] === undefined) refs[refIndex] = { current: initial ?? null }
      return refs[refIndex++]
    },
    useCallback: (fn) => fn,
    useSyncExternalStore: (subscribe, getSnapshot) => getSnapshot(),
  }
  // 展开函数组件元素：等价 React 渲染时的组件求值
  const expand = (node) => {
    if (node === null || node === undefined) return node
    if (Array.isArray(node)) return node.map(expand)
    if (typeof node !== 'object') return node
    if (typeof node.type === 'function') return expand(node.type(node.props))
    return { ...node, props: { ...node.props, children: (node.props?.children ?? []).map(expand) } }
  }
  const runComponent = (Component, props) => {
    effects = []
    refIndex = 0
    const tree = expand(Component(props))
    const cleanups = []
    for (const effect of effects) {
      const result = effect()
      if (typeof result === 'function') cleanups.push(result)
    }
    return { tree, unmount: () => cleanups.forEach((fn) => fn()) }
  }
  const reset = () => {
    effects = []
    refs.length = 0
    refIndex = 0
  }
  return { React, runComponent, reset }
}

/**
 * 组件体内的 hooks 取自 client.js 加载时注入的那个 React，
 * 所以「加载模块」和「渲染组件」必须共用同一个替身，否则 effect 队列对不上。
 */
const STUB = createReactStub()

const loadActivityExports = () => {
  const source = fs.readFileSync(CLIENT, 'utf8')
  const { React } = STUB
  let captured
  const globalWindow = {
    __ModuleLoader__: {
      load: ({ factory }) => {
        captured = factory((id) => {
          if (id === 'react') return React
          throw new Error(`unexpected require(${id})`)
        })
      },
    },
  }
  const run = new Function('window', 'setTimeout', 'clearTimeout', source)
  run(globalWindow, () => 0, () => {})
  assert.equal(typeof captured?.apply, 'function', 'client.js 必须导出 apply')
  return captured
}

const exportsObj = loadActivityExports()
const D = exportsObj.__activityData
const SLOT_KEY = exportsObj.__activitySlot.key
const ENTRY_KEY = exportsObj.__activitySlot.entryKey

/** 从描述树里按条件收集节点。 */
const walk = (node, visit) => {
  if (node === null || node === undefined || typeof node !== 'object') return
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit)
    return
  }
  visit(node)
  for (const child of node.props?.children ?? []) walk(child, visit)
}

const collectNodes = (tree, predicate) => {
  const found = []
  walk(tree, (node) => {
    if (predicate(node)) found.push(node)
  })
  return found
}

const byClass = (tree, className) =>
  collectNodes(tree, (node) => String(node.props?.className ?? '').split(' ').includes(className))

const textOf = (node) => {
  if (typeof node === 'string') return node
  if (node === null || node === undefined) return ''
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (typeof node !== 'object') return String(node)
  return (node.props?.children ?? []).map(textOf).join('')
}

/* ------------------------------------------------------------------ *
 * 夹具
 * ------------------------------------------------------------------ */

const now = new Date(2026, 9, 15, 12, 0, 0).getTime() // 本地时间 2026-10-15 12:00
const HOUR = 3600000
const DAY = 86400000

const row = (id, patch = {}) => ({
  id,
  displayTitle: `title-${id}`,
  running: false,
  blank: false,
  retainedBy: {},
  updatedAt: now - HOUR,
  formatStatus: 'idle',
  cwd: '/Users/me/projects/alpha',
  ...patch,
})

const snapshotOf = (rows) => {
  const ids = []
  const byId = {}
  for (const entry of rows) {
    const key = entry.key ?? entry.id
    ids.push(key)
    byId[key] = entry.row
  }
  return { ids, byId, phase: 'ready', projectionsBySession: {} }
}

const sessionsOf = (rows, patch = {}) => {
  const list = snapshotOf(rows)
  return {
    list,
    workspaces: [],
    ungroupedSessionIds: [],
    flatSessionIds: list.ids.slice(),
    currentSessionId: undefined,
    archivedSessionIds: [],
    pinnedSessionIds: [],
    home: '/Users/me',
    archivedFilter: 'default',
    ...patch,
  }
}

const viewProps = (sessions, patch = {}) => ({
  sessions,
  view: { groupBy: 'workspace', orderBy: 'recent', archivedFilter: 'default', wide: true, ready: true, ...patch },
  actions: {},
  row: {},
})

/* ------------------------------------------------------------------ *
 * 1) 纯数据层
 * ------------------------------------------------------------------ */

test('toTime / pick：只接受有限正数与可解析字符串', () => {
  assert.equal(D.toTime(1700000000000), 1700000000000)
  assert.equal(D.toTime(0), undefined)
  assert.equal(D.toTime(-1), undefined)
  assert.equal(D.toTime(Number.NaN), undefined)
  assert.equal(D.toTime(''), undefined)
  assert.equal(D.toTime('not-a-date'), undefined)
  assert.equal(D.toTime('2026-10-15T00:00:00.000Z'), Date.parse('2026-10-15T00:00:00.000Z'))
  assert.equal(D.pick('  x  '), 'x')
  assert.equal(D.pick('   '), '')
  assert.equal(D.pick(undefined), '')
})

test('toEntry：标题回退链与官方字段投影', () => {
  const full = D.toEntry(row('a', { title: '  真标题  ', displayTitle: '显示标题', updatedAt: 1234567890 }))
  assert.deepEqual(full, {
    id: 'a',
    title: '真标题',
    workspace: 'alpha',
    hasTitleHint: true,
    blank: false,
    time: 1234567890,
    running: false,
  })
  assert.equal(D.toEntry(row('b', { displayTitle: '显示标题' })).title, '显示标题')
  assert.equal(D.toEntry(row('c', { displayTitle: '', title: '', cwd: '' })).title, 'c')
  assert.equal(D.toEntry({}), undefined)
  assert.equal(D.toEntry({ id: '   ' }), undefined)
  // 没有 updatedAt 就是没有时间，不猜 lastPromptAt 之类的字段
  assert.equal(D.toEntry(row('d', { updatedAt: undefined })).time, undefined)
})

test('workspaceOf / isChildRow：只认官方 cwd 与 origin/parentId', () => {
  assert.equal(D.workspaceOf({ cwd: '/a/b/project' }), 'project')
  assert.equal(D.workspaceOf({ cwd: '/' }), '')
  assert.equal(D.workspaceOf({}), '')
  assert.equal(D.isChildRow({ origin: 'subagent' }), true)
  assert.equal(D.isChildRow({ parentId: 'p' }), true)
  assert.equal(D.isChildRow({ parentId: '   ' }), false)
  assert.equal(D.isChildRow(undefined), false)
  assert.equal(D.isChildRow(row('x')), false)
})

test('dayStart / yesterdayStart：日历日而非 24 小时偏移', () => {
  const start = D.dayStart(now)
  const date = new Date(start)
  assert.equal(date.getHours(), 0)
  assert.equal(date.getMinutes(), 0)
  assert.equal(date.getSeconds(), 0)
  assert.equal(date.getMilliseconds(), 0)
  assert.equal(date.getDate(), 15)

  const yesterday = new Date(D.yesterdayStart(now))
  assert.equal(yesterday.getHours(), 0)
  assert.equal(yesterday.getDate(), 14)
  assert.equal(yesterday.getMonth(), 9)
  // 普通日子两者相差正好一天
  assert.equal(start - D.yesterdayStart(now), DAY)
})

test('minuteDelay：到下一个整分钟，整分时退化为 60s', () => {
  assert.equal(D.minuteDelay(0), 60000)
  assert.equal(D.minuteDelay(60000), 60000)
  assert.equal(D.minuteDelay(60001), 59999)
  assert.equal(D.minuteDelay(123456), 60000 - (123456 % 60000))
})

test('mainSessionId：优先宿主给的 currentSessionId', () => {
  const snap = snapshotOf([{ id: 'kept', row: row('kept', { retainedBy: { mainView: 2 } }) }])
  assert.equal(D.mainSessionId(snap, { currentSessionId: 'explicit' }), 'explicit')
  assert.equal(D.mainSessionId(snap, {}), 'kept')
  assert.equal(D.mainSessionId(snapshotOf([]), {}), undefined)
  // retainedBy.mainView 为 0 的不算
  const none = snapshotOf([{ id: 'idle', row: row('idle', { retainedBy: { mainView: 0 } }) }])
  assert.equal(D.mainSessionId(none, {}), undefined)
})

test('sessionVisible：与原生 sessionVisible 等价（子代理 / blank / 三态归档）', () => {
  const archived = new Set(['arch'])
  // 子代理永不出现
  assert.equal(D.sessionVisible(row('s', { origin: 'subagent' }), undefined, archived, 'show'), false)
  // blank 行只有 currentBlank 例外
  assert.equal(D.sessionVisible(row('b', { blank: true }), 'other', archived, 'show'), false)
  assert.equal(D.sessionVisible(row('b', { blank: true }), 'b', archived, 'default'), true)
  // default：只看未归档
  assert.equal(D.sessionVisible(row('n'), undefined, archived, 'default'), true)
  assert.equal(D.sessionVisible(row('arch'), undefined, archived, 'default'), false)
  // show：全看
  assert.equal(D.sessionVisible(row('arch'), undefined, archived, 'show'), true)
  // only：只看已归档
  assert.equal(D.sessionVisible(row('n'), undefined, archived, 'only'), false)
  assert.equal(D.sessionVisible(row('arch'), undefined, archived, 'only'), true)
  // 缺省 filter 等同 default
  assert.equal(D.sessionVisible(row('n'), undefined, archived, undefined), true)
})

test('collect：只按官方 row.id 去重，不归一 id 索引别名', () => {
  const snap = snapshotOf([
    { key: 'alias:dup', row: row('dup', { updatedAt: now - 3 * HOUR, title: 'first' }) },
    { key: 'dup', row: row('dup', { updatedAt: now - 1 * HOUR, title: 'second' }) },
    { key: 'plain', row: row('plain') },
  ])
  const entries = D.collect(snap, sessionsOf([]))
  assert.deepEqual(entries.map((entry) => entry.id), ['dup', 'plain'])
  // 保留的是先出现的那个（官方 id 相同即视为同一会话）
  assert.equal(entries[0].title, 'first')
})

test('collect：byId 里查不到的行不写进 seen，不吞后续有效项', () => {
  const snap = { ids: ['ghost', 'real'], byId: { real: row('real') }, phase: 'ready' }
  const entries = D.collect(snap, sessionsOf([]))
  assert.deepEqual(entries.map((entry) => entry.id), ['real'])
})

test('collect：应用原生过滤（含 currentBlank 例外）并标注归档', () => {
  const snap = snapshotOf([
    { id: 'live', row: row('live') },
    { id: 'blank-cur', row: row('blank-cur', { blank: true }) },
    { id: 'blank-old', row: row('blank-old', { blank: true }) },
    { id: 'child', row: row('child', { origin: 'subagent' }) },
    { id: 'arch', row: row('arch') },
  ])
  const sessions = sessionsOf([], { currentSessionId: 'blank-cur', archivedSessionIds: ['arch'] })
  const live = D.collect(snap, sessions)
  assert.deepEqual(live.map((entry) => entry.id), ['live', 'blank-cur'])
  assert.equal(live.every((entry) => entry.archived === false), true)

  const withArchived = D.collect(snap, { ...sessions, archivedFilter: 'show' })
  assert.deepEqual(withArchived.map((entry) => entry.id), ['live', 'blank-cur', 'arch'])
  assert.equal(withArchived.find((entry) => entry.id === 'arch').archived, true)

  const onlyArchived = D.collect(snap, { ...sessions, archivedFilter: 'only' })
  assert.deepEqual(onlyArchived.map((entry) => entry.id), ['arch'])
})

test('sort：运行中优先 → updatedAt 倒序 → 无时间最后 → id 稳定', () => {
  const entries = [
    { id: 'b', running: false, time: now - HOUR },
    { id: 'a', running: false, time: now - HOUR },
    { id: 'old', running: false, time: now - 5 * DAY },
    { id: 'run-old', running: true, time: now - 5 * DAY },
    { id: 'none', running: false, time: undefined },
  ]
  assert.deepEqual(D.sort(entries).map((entry) => entry.id), ['run-old', 'a', 'b', 'old', 'none'])
})

test('先排序再限量：最新的会话不会被未排序前缀截掉', () => {
  const rows = []
  for (let i = 0; i < 30; i += 1) {
    rows.push({ id: `s${String(i).padStart(2, '0')}`, row: row(`s${String(i).padStart(2, '0')}`, { updatedAt: now - (i + 1) * HOUR }) })
  }
  // 把最新的一条放到输入末尾，验证 limit 发生在全局排序之后
  rows.push({ id: 'newest', row: row('newest', { updatedAt: now }) })
  const model = D.view(viewProps(sessionsOf(rows)), undefined, now)
  assert.equal(model.status, 'ready')
  assert.equal(model.entries.length, 25)
  assert.equal(model.entries[0].id, 'newest')
  assert.equal(D.limit(D.sort(D.collect(snapshotOf(rows), sessionsOf([])))).length, 25)
})

test('dayKey / bucketOf：运行中一律进今天，但不改写官方时间', () => {
  assert.equal(D.dayKey(now, now), 'today')
  assert.equal(D.dayKey(D.dayStart(now), now), 'today')
  assert.equal(D.dayKey(D.yesterdayStart(now), now), 'yesterday')
  assert.equal(D.dayKey(D.yesterdayStart(now) - 1, now), 'earlier')
  assert.equal(D.dayKey(undefined, now), 'earlier')

  const running = { id: 'r', running: true, time: D.yesterdayStart(now) - 10 * DAY }
  assert.equal(D.bucketOf(running, now), 'today')
  assert.equal(running.time, D.yesterdayStart(now) - 10 * DAY, 'running 行不重写 updatedAt')
  assert.equal(D.bucketOf({ id: 'x', running: false, time: D.yesterdayStart(now) }, now), 'yesterday')
})

test('group：分组顺序按条目出现顺序，空列表得空分组', () => {
  const entries = [
    { id: 'a', running: false, time: now - HOUR },
    { id: 'b', running: false, time: D.yesterdayStart(now) },
    { id: 'c', running: false, time: now - 10 * DAY },
    { id: 'd', running: false, time: now - 2 * HOUR },
  ]
  const groups = D.group(entries, now)
  assert.deepEqual(groups.map((group) => group.key), ['today', 'yesterday', 'earlier'])
  assert.deepEqual(groups[0].entries.map((entry) => entry.id), ['a', 'd'])
  assert.deepEqual(D.group([], now), [])
})

test('modes / shouldLeaveActivityMode：只对 groupBy、orderBy 退出活动模式', () => {
  const baseline = D.modes({ groupBy: 'workspace', orderBy: 'recent', archivedFilter: 'default' })
  assert.deepEqual(baseline, { groupBy: 'workspace', orderBy: 'recent' })
  assert.equal(D.shouldLeaveActivityMode(baseline, D.modes({ groupBy: 'workspace', orderBy: 'recent' })), false)
  assert.equal(D.shouldLeaveActivityMode(baseline, D.modes({ groupBy: 'manual', orderBy: 'recent' })), true)
  assert.equal(D.shouldLeaveActivityMode(baseline, D.modes({ groupBy: 'workspace', orderBy: 'created' })), true)
  // 归档筛选变化不退出：插件内部按原生规则过滤
  assert.equal(
    D.shouldLeaveActivityMode(baseline, D.modes({ groupBy: 'workspace', orderBy: 'recent', archivedFilter: 'only' })),
    false,
  )
  // 未就绪时不判断
  assert.equal(D.shouldLeaveActivityMode(undefined, baseline), false)
  assert.equal(D.shouldLeaveActivityMode(baseline, undefined), false)
})

test('formatWhen：相对时间只来自官方 updatedAt', () => {
  const t = (key, params) => (params === undefined ? `<${key}>` : `<${key}:${params.count}>`)
  assert.equal(D.formatWhen(undefined, now, t), '')
  assert.equal(D.formatWhen(now - 1000, now, t), '<now>')
  assert.equal(D.formatWhen(now - 5 * 60000, now, t), '<minutesAgo:5>')
  assert.equal(D.formatWhen(now - 3 * HOUR, now, t), '<hoursAgo:3>')
  assert.equal(D.formatWhen(now - 2 * DAY, now, t), '<daysAgo:2>')
})

test('view：unavailable / loading / empty / ready 四态与数据来源优先级', () => {
  assert.equal(D.view({}, undefined, now).status, 'unavailable')
  assert.equal(D.view({ view: { ready: true } }, undefined, now).status, 'unavailable')

  const sessions = sessionsOf([{ id: 'a', row: row('a') }])
  assert.equal(D.view({ sessions, view: { ready: false } }, undefined, now).status, 'loading')

  const emptySessions = sessionsOf([])
  const empty = D.view({ sessions: emptySessions, view: { ready: true } }, undefined, now)
  assert.equal(empty.status, 'empty')
  assert.deepEqual(empty.groups, [])

  // 宿主没给 props.sessions.list 时退回 ctx.sessions.list 快照
  const fallbackSnap = snapshotOf([{ id: 'f', row: row('f') }])
  const fallback = D.view({ sessions: { archivedFilter: 'default' }, view: { ready: true } }, fallbackSnap, now)
  assert.equal(fallback.status, 'ready')
  assert.deepEqual(fallback.entries.map((entry) => entry.id), ['f'])

  // 宿主给了 list 就用宿主的，不再读快照
  const native = D.view(viewProps(sessions), snapshotOf([{ id: 'stale', row: row('stale') }]), now)
  assert.deepEqual(native.entries.map((entry) => entry.id), ['a'])
})

/* ------------------------------------------------------------------ *
 * 2) 组件结构（React 替身，无 DOM）
 * ------------------------------------------------------------------ */

const HostComponent = (() => {
  let captured
  const source = fs.readFileSync(CLIENT, 'utf8')
  // ActivityList 没有单独导出：走一次真实 apply，再打开活动模式用 register 拿到组件。
  const { React } = STUB
  const globalWindow = {
    __ModuleLoader__: {
      load: ({ factory }) => {
        const mod = factory(() => React)
        mod.apply({
          slots: {
            spec: () => ({ kind: 'single', scope: 'root' }),
            // 同步回调合同：槽位声明已就绪，宿主立刻调用 callback
            inject: (key, callback) => {
              const dispose = callback()
              return () => {
                if (typeof dispose === 'function') dispose()
              }
            },
            register: (options, component) => {
              captured = { options, component }
              return () => {}
            },
          },
          locale: undefined,
          sessions: undefined,
          effect: () => {},
        })
        // 活动模式打开后才会注册 occupant，组件由此取得
        mod.__activityMode.setOpen(true)
      },
    },
  }
  const run = new Function('window', 'setTimeout', 'clearTimeout', source)
  run(globalWindow, () => 0, () => {})
  assert.equal(typeof captured?.component, 'function', '打开活动模式后必须注册列表 occupant')
  return captured.component
})()

// 组件里的 useNow 读真实 Date.now；渲染期间固定成夹具时间，断言才可复现。
const renderList = (props, at) => {
  STUB.reset()
  const original = Date.now
  Date.now = () => at ?? now
  try {
    return STUB.runComponent(HostComponent, props)
  } finally {
    Date.now = original
  }
}

/**
 * 组件只依赖 store 的公开 API：开关 + 分组基线（checkGrouping）。
 * 这里给一个真实语义的替身，用来验证「基线属于 activation 生命周期」这条规则。
 */
const fakeStore = ({ open = true } = {}) => {
  let state = { open, localeEpoch: 0, baseline: null }
  const listeners = new Set()
  const publish = (next) => {
    state = next
    for (const listener of [...listeners]) listener()
  }
  return {
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    getSnapshot: () => state,
    isOpen: () => state.open,
    setOpen: (next) => {
      if (state.open !== next) publish({ ...state, open: next, baseline: null })
    },
    checkGrouping: (modes) => {
      if (state.open !== true) {
        if (state.baseline !== null) publish({ ...state, baseline: null })
        return false
      }
      if (state.baseline === null) {
        publish({ ...state, baseline: modes })
        return false
      }
      if (!D.shouldLeaveActivityMode(state.baseline, modes)) return false
      publish({ ...state, open: false, baseline: null })
      return true
    },
    baselineOf: () => state.baseline,
    isOpenNow: () => state.open,
  }
}

/** 渲染后的 CSS 文本（styleNode 就在树里，直接读它的 children）。 */
const styleText = (tree) => {
  const node = collectNodes(tree, (item) => item.type === 'style')[0]
  return textOf(node)
}

test('组件：wide=false 只渲染空壳，不接管列表', () => {
  const sessions = sessionsOf([{ id: 'a', row: row('a') }])
  const { tree } = renderList({
    ...viewProps(sessions, { wide: false }),
    store: fakeStore(),
    translate: (key) => key,
  })
  const roots = byClass(tree, 'avRoot')
  assert.equal(roots.length, 1)
  assert.equal(roots[0].props['data-activity-view'], 'narrow')
  assert.equal(byClass(tree, 'avRow').length, 0)
  assert.equal(byClass(tree, 'avGroup').length, 0)
})

test('组件：ready 列表是单行结构，运行优先、running 行不伪造时间', () => {
  const sessions = sessionsOf([
    { id: 'old', row: row('old', { updatedAt: now - 2 * DAY }) },
    { id: 'run', row: row('run', { running: true, updatedAt: now - 9 * DAY }) },
    { id: 'arch', row: row('arch', { updatedAt: now - 3 * HOUR }) },
  ], { archivedSessionIds: ['arch'] })
  const opened = []
  const host = {
    ...viewProps(sessions, { archivedFilter: 'show' }),
    store: fakeStore(),
    translate: (key, params) => (params === undefined ? `<${key}>` : `<${key}:${params.count}>`),
    actions: { openSession: (id) => opened.push(id) },
    // 原生 leading 恒返回一个 SlotOutlet 元素（即使为空），不能拿「非 null」当有内容。
    row: { leading: (id) => ({ type: 'i', props: { 'data-leading': id, children: [] } }) },
  }
  const { tree } = renderList(host)

  assert.equal(byClass(tree, 'avRoot')[0].props['data-activity-view'], 'list')
  const groups = byClass(tree, 'avGroup')
  assert.equal(groups.length, 2)
  assert.deepEqual(byClass(tree, 'avGroupTitle').map(textOf), ['<today>', '<earlier>'])

  const rows = byClass(tree, 'avRow')
  assert.deepEqual(rows.map((node) => node.props['data-session-row']), ['run', 'arch', 'old'])

  const first = rows[0]
  const classes = first.props.children.map((child) => child?.props?.className)
  assert.deepEqual(classes, ['avLeading', 'avTitle', 'avMeta', 'avRowTail'])
  assert.equal(first.props.role, 'button')
  assert.equal(first.props.tabIndex, 0)

  // running 行：自带 spinner，即便原生 leading 有节点也优先自带
  assert.equal(byClass(first, 'avSpin').length, 1)
  assert.equal(byClass(first, 'avDot').length, 0, '不能凭空调造未读点')

  // running 行的 meta 只有 workspace，时间原值（5 天前）不被写成「今天」
  const meta = first.props.children[2]
  assert.equal(textOf(meta), 'alpha')
  assert.equal(byClass(first, 'avTime').length, 0)
  // 非 running 行照常显示相对时间
  const oldRow = rows.find((node) => node.props['data-session-row'] === 'old')
  assert.equal(textOf(byClass(oldRow, 'avTime')[0]), '<daysAgo:2>')

  // 归档行：真实灰显样式规则 + class + aria-disabled，点击仍交给原生 guardedOpen
  const css = styleText(tree)
  assert.ok(/\.avRowArchived\s+\.avTitle\s*\{[^}]*--dsw-alias-label-caption/.test(css), '归档必须有真实灰显规则')
  const archivedRow = rows.find((node) => node.props['data-session-row'] === 'arch')
  assert.equal(String(archivedRow.props.className), 'avRow avRowArchived')
  assert.equal(archivedRow.props['aria-disabled'], 'true')
  assert.equal(first.props['aria-disabled'], undefined)

  // 点击 / Enter 都走宿主 actions.openSession（原生 guardedOpen），不自己打开
  first.props.onClick()
  rows[1].props.onKeyDown({ key: 'Enter', target: rows[1], currentTarget: rows[1], preventDefault: () => {} })
  assert.deepEqual(opened, ['run', 'arch'])
})

/*
 * #0013：运行中指示器必须是正圆。
 * border 画环在非整数 DPR 下会斜接成椭圆/缺角，改成正方 viewBox 的真实 SVG 圆弧：
 * 这里只锁结构与几何（正方 viewBox、等宽高、不可压缩、绕中心旋转、弧端对称），
 * 视觉是否「够圆」仍以真机截图为准，本用例不冒充观感证据。
 */
test('组件：#0013 running 指示器是正方 SVG 圆弧，不再用 border 画环', () => {
  const sessions = sessionsOf([{ id: 'run', row: row('run', { running: true }) }])
  const host = {
    ...viewProps(sessions, { archivedFilter: 'show' }),
    store: fakeStore(),
    translate: (key) => key,
    row: { leading: () => null },
  }
  const { tree } = renderList(host)

  const spin = byClass(tree, 'avSpin')
  assert.equal(spin.length, 1, 'running 行只有一个指示器')
  assert.equal(spin[0].props['aria-hidden'], 'true', '装饰图形不进可访问名')

  const glyph = byClass(spin[0], 'avSpinGlyph')
  assert.equal(glyph.length, 1)
  assert.equal(glyph[0].type, 'svg')
  assert.equal(glyph[0].props.viewBox, '0 0 16 16', 'viewBox 必须正方，否则弧会被拉成椭圆')
  assert.equal(glyph[0].props.width, 12)
  assert.equal(glyph[0].props.height, 12, '宽高必须相等')
  assert.equal(glyph[0].props['aria-hidden'], 'true')

  const track = byClass(spin[0], 'avSpinTrack')
  const arc = byClass(spin[0], 'avSpinArc')
  assert.equal(track.length, 1, '薄圆轨')
  assert.equal(arc.length, 1, '圆端弧')
  assert.equal(track[0].type, 'circle')
  assert.equal(arc[0].type, 'path')
  assert.equal(track[0].props.cx, 8)
  assert.equal(track[0].props.cy, 8)
  assert.equal(track[0].props.r, 6.5, '圆心居中、半径一致才同心')
  assert.equal(String(arc[0].props.d), 'M8 1.5A6.5 6.5 0 1 1 1.5 8', '弧起止点必须落在同一圆上')

  const css = styleText(tree)
  const ruleOf = (selector) => {
    const match = new RegExp(`\\${selector}\\{([^}]*)\\}`).exec(css)
    return match ? match[1] : ''
  }
  const spinRule = ruleOf('.avSpin')
  assert.match(spinRule, /width:12px/, '宽度锁定')
  assert.match(spinRule, /height:12px/, '高度锁定')
  assert.match(spinRule, /min-width:12px/)
  assert.match(spinRule, /min-height:12px/, '不允许被压扁')
  assert.match(spinRule, /flex:none/, '不允许 flex 收缩')
  assert.match(spinRule, /transform-origin:50% 50%/, '绕自身中心旋转')
  assert.ok(!/border/.test(spinRule), '不再用 border 画环')
  assert.ok(!/border-top-color:transparent/.test(css), '旧 border-top 透明写法必须消失')
  assert.match(ruleOf('.avSpinArc'), /stroke-linecap:round/, '弧端是圆的')
  assert.match(ruleOf('.avSpinArc'), /fill:none/)
})

test('组件：行内非交互区域点击仍开会话，只有原生交互控件外溢被抑制', () => {
  const sessions = sessionsOf([{ id: 'a', row: row('a') }])
  const opened = []
  let nativeClicks = 0
  const host = {
    ...viewProps(sessions),
    store: fakeStore(),
    translate: (key) => key,
    actions: { openSession: (id) => opened.push(id) },
    row: {
      leading: () => ({ type: 'i', props: { children: [] } }),
      actions: () => ({ type: 'button', props: { 'data-native': 'menu', onClick: () => (nativeClicks += 1) } }),
    },
  }
  const { tree } = renderList(host)
  const rowNode = byClass(tree, 'avRow')[0]
  const leading = rowNode.props.children[0]
  const tail = rowNode.props.children[3]

  // leading / meta 上不再挂无条件的 stopPropagation
  assert.equal(rowNode.props.children[2].props.onClick, undefined, 'meta 不应吞点击')

  /*
   * 用带「父子关系」的最小节点模型驱动 closest / contains：
   * 行自身带 role=button（原生 sessionRow 就是 role=button），所以行内普通 span 向上 closest
   * 会命中**外层行**，而不是 null。这正是旧实现（closest !== null 即抑制）会误吞点击的场景。
   */
  const makeNode = (label, interactive = false) => {
    const node = {
      label,
      parent: null,
      interactive,
      closest: (selector) => {
        if (typeof selector !== 'string' || selector === '') return null
        let cursor = node
        while (cursor !== null && cursor !== undefined) {
          if (cursor.interactive === true) return cursor
          cursor = cursor.parent
        }
        return null
      },
      contains: (other) => {
        let cursor = other
        while (cursor !== null && cursor !== undefined) {
          if (cursor === node) return true
          cursor = cursor.parent
        }
        return false
      },
    }
    return node
  }

  const rowDom = makeNode('row', true) // 行本身 role=button，属于「边界」，不是内部控件
  const plainLeading = makeNode('leading-span')
  plainLeading.parent = rowDom
  const plainTail = makeNode('tail-span')
  plainTail.parent = rowDom
  const nativeButton = makeNode('native-button', true)
  nativeButton.parent = rowDom

  const event = (target) => {
    let stopped = false
    return {
      target,
      currentTarget: rowDom,
      stopPropagation: () => {
        stopped = true
      },
      get stopped() {
        return stopped
      },
    }
  }

  // 普通 span：closest 命中的是外层行（非 null），仍必须放行给整行点击
  const plainLeadingEvent = event(plainLeading)
  assert.equal(plainLeading.closest('[role="button"]'), rowDom, '前置条件：closest 命中的是外层行而非 null')
  leading.props.onClick(plainLeadingEvent)
  assert.equal(plainLeadingEvent.stopped, false, '命中外层行不算内部控件，不能吞点击')

  const plainTailEvent = event(plainTail)
  tail.props.onClick(plainTailEvent)
  assert.equal(plainTailEvent.stopped, false, '尾部普通区域同样不能吞点击')

  // 真正的内部原生按钮（被边界包含）：抑制冒泡
  const nativeEvent = event(nativeButton)
  leading.props.onClick(nativeEvent)
  assert.equal(nativeEvent.stopped, true, '点到边界内的原生按钮时应抑制冒泡')

  // 目标就是行自己、或无法判定包含关系时，一律不抑制（宁可多开一次，也不吞点击）
  const boundaryEvent = event(rowDom)
  leading.props.onClick(boundaryEvent)
  assert.equal(boundaryEvent.stopped, false, 'target === currentTarget 不抑制')

  // 边界没有 contains 能力（无法判定包含关系）时也不抑制
  const opaqueBoundary = makeNode('opaque-boundary')
  delete opaqueBoundary.contains
  const innerButton = makeNode('inner-button', true)
  innerButton.parent = opaqueBoundary
  const unknownEvent = { target: innerButton, currentTarget: opaqueBoundary, stopPropagation: () => (unknownEvent.stopped = true), stopped: false }
  leading.props.onClick(unknownEvent)
  assert.equal(unknownEvent.stopped, false, '判定不了包含关系时不抑制')

  // 子节点自己的 Enter 不替整行开会话
  opened.length = 0
  rowNode.props.onKeyDown({ key: 'Enter', target: { closest: () => ({}) }, currentTarget: rowNode, preventDefault: () => 0 })
  assert.deepEqual(opened, [])
  // 行本身 Enter 仍然打开
  rowNode.props.onKeyDown({ key: 'Enter', target: rowNode, currentTarget: rowNode, preventDefault: () => 0 })
  assert.deepEqual(opened, ['a'])
})

test('组件：右键调用原生 openSessionMenu，参数为原生形状且不是 toggle', () => {
  const sessions = sessionsOf([{ id: 'a', row: row('a') }])
  const calls = []
  const host = {
    ...viewProps(sessions),
    store: fakeStore(),
    translate: (key) => key,
    actions: {
      openSession: () => 0,
      openSessionMenu: (...args) => calls.push(args),
    },
    row: {},
  }
  const { tree } = renderList(host)
  const rowNode = byClass(tree, 'avRow')[0]
  let prevented = 0
  let stopped = 0
  rowNode.props.onContextMenu({
    clientX: 12,
    clientY: 34,
    preventDefault: () => (prevented += 1),
    stopPropagation: () => (stopped += 1),
  })
  assert.equal(prevented, 1)
  assert.equal(stopped, 1)
  assert.deepEqual(calls, [['a', 'title-a', { x: 12, y: 34 }, 'open']])
  assert.notEqual(calls[0][3], 'toggle', '右键不是开关动作，不能把原生菜单 toggle 掉')
})

test('组件：groupBy/orderBy 变化退出活动模式，基线与通知都只在 store 里', () => {
  const sessions = sessionsOf([{ id: 'a', row: row('a') }])
  const store = fakeStore()
  const base = { ...viewProps(sessions), store, translate: (key) => key }
  const view = (patch) => ({ ...base, view: { ...base.view, ...patch } })

  STUB.reset()
  STUB.runComponent(HostComponent, view({ groupBy: 'workspace', orderBy: 'recent' }))
  assert.equal(store.isOpenNow(), true)
  assert.deepEqual(store.baselineOf(), { groupBy: 'workspace', orderBy: 'recent' })

  // archivedFilter 变化：保留活动模式
  STUB.runComponent(HostComponent, view({ groupBy: 'workspace', orderBy: 'recent', archivedFilter: 'show' }))
  assert.equal(store.isOpenNow(), true)

  // 排序变化：自动退出，交回原生
  STUB.runComponent(HostComponent, view({ groupBy: 'workspace', orderBy: 'created' }))
  assert.equal(store.isOpenNow(), false)

  // 已经关闭后再改分组：保持关闭
  STUB.runComponent(HostComponent, view({ groupBy: 'manual', orderBy: 'created' }))
  assert.equal(store.isOpenNow(), false)
})

test('组件：临时 unmount 期间改原生分组，重挂后仍必须退出（基线不随组件丢失）', () => {
  const sessions = sessionsOf([{ id: 'a', row: row('a') }])
  const store = fakeStore()
  const base = { ...viewProps(sessions), store, translate: (key) => key }
  const view = (patch) => ({ ...base, view: { ...base.view, ...patch } })

  STUB.reset()
  STUB.runComponent(HostComponent, view({ groupBy: 'workspace', orderBy: 'recent' }))
  assert.equal(store.baselineOf()?.orderBy, 'recent')

  // 搜索 / rail 收起导致 occupant 卸载：组件 hook 状态全部丢失，store 保留
  STUB.reset()
  // 卸载期间用户在原生菜单把排序改成 created，然后重新挂载
  STUB.runComponent(HostComponent, view({ groupBy: 'workspace', orderBy: 'created' }))
  assert.equal(store.isOpenNow(), false, '基线若跟着组件丢，这里会误当成新基线而不退出')
})

test('组件：empty / loading / unavailable 都渲染提示而不是列表', () => {
  const store = fakeStore()
  const translate = (key) => `<${key}>`

  const empty = renderList({ ...viewProps(sessionsOf([])), store, translate }).tree
  assert.equal(textOf(byClass(empty, 'avNotice')[0]), '<empty>')
  assert.equal(byClass(empty, 'avRow').length, 0)

  const loading = renderList({
    sessions: sessionsOf([{ id: 'a', row: row('a') }]),
    view: { groupBy: 'workspace', orderBy: 'recent', wide: true, ready: false },
    store,
    translate,
  }).tree
  assert.equal(textOf(byClass(loading, 'avNotice')[0]), '<loading>')

  const unavailable = renderList({ sessions: undefined, view: { wide: true, ready: true }, store, translate }).tree
  assert.equal(textOf(byClass(unavailable, 'avNotice')[0]), '<unavailable>')
})

test('组件：行样式采用宿主已证实的 layout token，不自造缩进', () => {
  const sessions = sessionsOf([{ id: 'a', row: row('a') }])
  const { tree } = renderList({ ...viewProps(sessions), store: fakeStore(), translate: (key) => key })
  const css = styleText(tree)
  for (const token of [
    '--dsh-sidebar-row-padding',
    '--dsh-sidebar-label-gap',
    '--dsh-sidebar-paint-inset',
    '--dsh-workspace-indent',
    '--dsw-radius-md',
  ]) {
    assert.ok(css.includes(`var(${token}`), `行样式必须使用宿主 token ${token}`)
  }
  /*
   * 补丁替换掉的是 listArea 里的 <FlatList>/<SessionTree> 元素本身，原生 .list / .treeBody
   * 只存在于未占位时的 fallback 组件里；占位时它们并不存在，所以 occupant 必须自己当滚动根。
   */
  const rootRule = (css.match(/\.avRoot\{[^}]*\}/) ?? [''])[0]
  assert.ok(/overflow-y:auto/.test(rootRule), 'occupant 根节点必须是滚动容器')
  assert.ok(/overflow-x:hidden/.test(rootRule), '纵向滚动根不应带横向滚动')
  assert.ok(/flex:1/.test(rootRule), '根节点必须吃掉 listArea 剩余高度')
  assert.ok(/min-height:0/.test(rootRule), 'flex 子项必须 min-height:0 才滚得动')
  assert.ok(/scrollbar-gutter:stable/.test(rootRule), '沿用原生 .list 的滚动条占位')
  assert.ok(/padding-bottom:16px/.test(rootRule), '沿用原生 .list 的底部出血')
  assert.ok(/background-color:transparent/.test(rootRule), '不画背景，sidebar 背景透上来')
  assert.ok(rootRule.includes('var(--dsh-session-list-scrollbar-offset'), '沿用原生滚动条 token')
  assert.ok(rootRule.includes('var(--dsh-session-list-edge-inset'), '沿用原生左右出血 token')
  assert.equal(/^\.avGroup\{[^}]*flex:none/m.test(css), true, '内容组不被压扁')
  assert.equal(/\.avRow\{[^}]*flex:none/.test(css), true, '行不被压扁')
  assert.equal(/\.avRow\{[^}]*padding:8px/.test(css), false, '行缩进不能写成固定 8px')
})

/* ------------------------------------------------------------------ *
 * 3) 真实 slots 生命周期（SlotCore 真身 + Cordis inject 替身）
 * ------------------------------------------------------------------ */

const loadSlotCore = async () => {
  if (!fs.existsSync(SLOT_CORE_FIXTURE)) return undefined
  const mod = await import(pathToFileURL(SLOT_CORE_FIXTURE).href)
  return mod.SlotCore
}

/** 最小宿主替身：把 Cordis 的 effect / locale / sessions 收集起来，便于断言与卸载。 */
const createHost = (core, localeService) => {
  const disposers = []
  const injected = []
  const slots = {
    spec: (key) => core.spec(key),
    register: (options, component) => core.register(options, component),
    /*
     * Cordis `slots.inject(key, callback)` 的替身：槽位已声明时同步调用 callback，
     * 把它的返回值当作注销函数。我们断言的就是这条同步返回 Dispose 的合同。
     */
    inject: (key, callback) => {
      const record = { key, callback, dispose: callback() }
      injected.push(record)
      return () => {
        const fn = record.dispose
        if (typeof fn === 'function') {
          record.dispose = undefined
          fn()
        }
      }
    },
  }
  const ctx = {
    slots,
    locale: localeService,
    sessions: undefined,
    effect: (fn) => {
      const dispose = fn()
      if (typeof dispose === 'function') disposers.push(dispose)
    },
  }
  const unmount = () => {
    while (disposers.length > 0) disposers.pop()()
  }
  /*
   * 模拟「宿主重新声明了这个槽」：Cordis 会在槽可用时再次调用 inject 的同步回调。
   * 只用于到达顺序 / 消失重现这类用例。
   */
  const reinject = (key) => {
    const record = injected.find((item) => item.key === key)
    if (record === undefined) return undefined
    record.dispose = record.callback()
    return record
  }
  return { ctx, slots, injected, injectedOf: (key) => injected.find((item) => item.key === key), reinject, unmount }
}

test('slots 生命周期：inject 回调同步返回 Dispose，开关驱动 occupant 注册/注销', async (t) => {
  const SlotCore = await loadSlotCore()
  if (SlotCore === undefined) {
    t.skip(`缺少 SlotCore 抽取件：${SLOT_CORE_FIXTURE}`)
    return
  }
  const core = new SlotCore()
  // 宿主用 children 表声明 slot（与宿主服务的声明方式同形）
  const disposeDeclaration = core.registerFactory(
    { name: 'test.host.sidebar', scope: 'root', children: { [SLOT_KEY]: { kind: 'single', scope: 'root' } } },
    () => null,
  )
  assert.equal(core.spec(SLOT_KEY)?.kind, 'single')

  const host = createHost(core)
  const mod = loadActivityExports()
  mod.apply(host.ctx)

  assert.equal(mod.__activityMode.isOpen(), false)
  assert.equal(core.entriesOfSlot(SLOT_KEY).length, 0, '未进入活动模式时不许占位，原生列表照常渲染')

  // 注册的注入回调必须是同步返回（generator / Promise 都不合规）
  assert.equal(host.injected.length, 2, '列表扩展点 + 导航动作行各订阅一次')
  assert.deepEqual(host.injected.map((item) => item.key).sort(), [ENTRY_KEY, SLOT_KEY].sort())
  const listRecord = host.injectedOf(SLOT_KEY)
  assert.equal(typeof listRecord.dispose, 'function', 'inject 回调必须直接返回 Dispose')
  assert.equal(
    Object.prototype.toString.call(listRecord.dispose),
    '[object Function]',
  )

  mod.__activityMode.toggle()
  assert.equal(mod.__activityMode.isOpen(), true)
  let occupants = core.entriesOfSlot(SLOT_KEY)
  assert.equal(occupants.length, 1)
  assert.equal(occupants[0].locale, 'activityView')
  assert.equal(typeof occupants[0].inject, 'function')
  assert.equal(typeof occupants[0].component, 'function')

  // 关掉就注销，SlotOutlet 立刻回落原生
  mod.__activityMode.setOpen(false)
  assert.equal(core.entriesOfSlot(SLOT_KEY).length, 0)

  // 反复开关不残留、不报「同优先级已占」
  mod.__activityMode.toggle()
  assert.equal(core.entriesOfSlot(SLOT_KEY).length, 1)
  mod.__activityMode.toggle()
  assert.equal(core.entriesOfSlot(SLOT_KEY).length, 0)

  // 插件卸载：占位清空、注入 Dispose 被调用
  mod.__activityMode.toggle()
  assert.equal(core.entriesOfSlot(SLOT_KEY).length, 1)
  host.unmount()
  assert.equal(core.entriesOfSlot(SLOT_KEY).length, 0, 'teardown 必须回收 occupant')
  assert.equal(host.injectedOf(SLOT_KEY).dispose, undefined, 'teardown 必须调用注入回调的 Dispose')

  disposeDeclaration()
  assert.equal(core.spec(SLOT_KEY), undefined)
})

test('slots 生命周期：槽位未声明时不注册死按钮/列表，模式自动关回', async (t) => {
  const SlotCore = await loadSlotCore()
  if (SlotCore === undefined) {
    t.skip(`缺少 SlotCore 抽取件：${SLOT_CORE_FIXTURE}`)
    return
  }
  const core = new SlotCore()
  const host = createHost(core)
  const mod = loadActivityExports()
  mod.apply(host.ctx)
  assert.equal(mod.__activityMode.isOpen(), false)

  mod.__activityMode.toggle()
  assert.equal(core.entriesOfSlot(SLOT_KEY).length, 0, '老宿主没有该 slot，不能注册')
  assert.equal(mod.__activityMode.isOpen(), false, '注册失败必须把模式关回去，不留空开关')
})

test('slots 生命周期：single 槽被别的 occupant 占住时不抢位、不抛异常', async (t) => {
  const SlotCore = await loadSlotCore()
  if (SlotCore === undefined) {
    t.skip(`缺少 SlotCore 抽取件：${SLOT_CORE_FIXTURE}`)
    return
  }
  const core = new SlotCore()
  core.registerFactory(
    { name: 'test.host.sidebar', scope: 'root', children: { [SLOT_KEY]: { kind: 'single', scope: 'root' } } },
    () => null,
  )
  const alienDispose = core.register({ name: SLOT_KEY, registrant: 'someone-else' }, () => null)
  const host = createHost(core)
  const mod = loadActivityExports()
  mod.apply(host.ctx)

  assert.doesNotThrow(() => mod.__activityMode.toggle())
  assert.equal(mod.__activityMode.isOpen(), false)
  const occupants = core.entriesOfSlot(SLOT_KEY)
  assert.equal(occupants.length, 1)
  assert.equal(occupants[0].registrant, 'someone-else', '原 occupant 不被挤掉')
  alienDispose()
})


/* ------------------------------------------------------------------ *
 * 3b) 入口：导航动作行 slot（sidebar.navigation.action）与语言座位
 * ------------------------------------------------------------------ */

const ENTRY_CLASSES = {
  panelRow: 'hostPanelRow',
  panelActive: 'hostPanelActive',
  panelGlyph: 'hostPanelGlyph',
  panelTitle: 'hostPanelTitle',
  wide: 'hostWide',
}

const declareSlots = (core, keys) =>
  core.registerFactory(
    {
      name: 'test.host.sidebar',
      scope: 'root',
      children: Object.fromEntries(
        keys.map((key) => [key, { kind: key === ENTRY_KEY ? 'list' : 'single', scope: 'root' }]),
      ),
    },
    () => null,
  )

/** 按宿主 SlotOutlet 的方式渲染 occupant：inject() 的返回值摊进组件 props。 */
const renderInjected = (entry, extra) => {
  assert.equal(typeof entry?.inject, 'function')
  STUB.reset()
  return STUB.runComponent(entry.component, { ...entry.inject(), ...extra })
}

test('locale：按原生范式注册 zh/en 字典，bind(NS) 兜底翻译，props.t 优先', async (t) => {
  const SlotCore = await loadSlotCore()
  if (SlotCore === undefined) {
    t.skip(`缺少 SlotCore 抽取件：${SLOT_CORE_FIXTURE}`)
    return
  }
  const core = new SlotCore()
  const disposeDeclaration = declareSlots(core, [SLOT_KEY, ENTRY_KEY])

  let registered
  let dictionaryDisposed = 0
  const boundNamespaces = []
  const locale = {
    // 原生范式：ctx.locale.register(NS, { zh, en, ... }) 返回注销函数，由 ctx.effect 持有
    register: (namespace, table) => {
      registered = { namespace, table }
      return () => {
        dictionaryDisposed += 1
      }
    },
    // 原生范式：ctx.locale.bind(NS) → t(key, params)
    bind: (namespace) => {
      boundNamespaces.push(namespace)
      return (key, params) => {
        const template = registered?.table?.zh?.[key]
        if (typeof template !== 'string') return undefined
        if (params === undefined) return template
        return template.replace(/\{(\w+)\}/g, (match, name) =>
          params[name] === undefined ? match : String(params[name]),
        )
      }
    },
  }

  const host = createHost(core, locale)
  const mod = loadActivityExports()
  mod.apply(host.ctx)

  assert.equal(registered?.namespace, 'activityView', '必须用具名 namespace 注册字典')
  assert.deepEqual(Object.keys(registered.table).sort(), ['en', 'zh'])
  const enKeys = Object.keys(registered.table.en).sort()
  assert.deepEqual(Object.keys(registered.table.zh).sort(), enKeys, '中英字典 key 必须一一对应')
  for (const key of [
    'panelTitle',
    'iconLabel',
    'loading',
    'empty',
    'failed',
    'unavailable',
    'now',
    'minutesAgo',
    'hoursAgo',
    'daysAgo',
    'today',
    'yesterday',
    'earlier',
  ]) {
    assert.ok(enKeys.includes(key), `字典缺少 key: ${key}`)
    assert.equal(typeof registered.table.en[key], 'string')
    assert.ok(registered.table.zh[key].length > 0)
  }

  const entry = core.entriesOfSlot(ENTRY_KEY)[0]
  const injected = entry.inject()
  // 注入的 translate 走 locale.bind(NS)，中文宿主下拿到中文
  assert.equal(injected.translate('panelTitle'), '活动')
  assert.equal(injected.translate('minutesAgo', { count: 5 }), '5 分钟前')
  assert.ok(boundNamespaces.every((ns) => ns === 'activityView'), '只能绑定自己的 namespace')

  // 组件优先宿主标准的 props.t（SlotOutlet 绑定了 entry.locale 的那个座位）
  const withHostT = renderInjected(entry, {
    classes: ENTRY_CLASSES,
    wide: true,
    t: (key) => `T:${key}`,
  }).tree
  assert.equal(withHostT.props['aria-label'], 'T:iconLabel')
  assert.equal(textOf(withHostT.props.children[1]), 'T:panelTitle')

  // 没有 props.t 时用注入的 translate（仍是中文）
  const withoutHostT = renderInjected(entry, { classes: ENTRY_CLASSES, wide: true }).tree
  assert.equal(withoutHostT.props['aria-label'], '活动视图')

  // 字典注册随插件 effect 回收
  host.unmount()
  assert.equal(dictionaryDisposed, 1, 'ctx.effect 必须回收字典注册')
  disposeDeclaration()
})

test('slot 入口：两个槽齐备才挂导航动作行按钮，属性/类名/aria 随 mode 同步', async (t) => {
  const SlotCore = await loadSlotCore()
  if (SlotCore === undefined) {
    t.skip(`缺少 SlotCore 抽取件：${SLOT_CORE_FIXTURE}`)
    return
  }
  const core = new SlotCore()
  const disposeDeclaration = declareSlots(core, [SLOT_KEY, ENTRY_KEY])
  const host = createHost(core)
  const mod = loadActivityExports()
  mod.apply(host.ctx)

  const entries = core.entriesOfSlot(ENTRY_KEY)
  assert.equal(entries.length, 1, '两槽都声明时必须注册入口按钮')
  const entry = entries[0]
  assert.equal(entry.options.id, 'activity-view', 'register 必须带 options.id')
  assert.equal(entry.options.order, 20)
  assert.equal(entry.locale, 'activityView')

  let tree = renderInjected(entry, { classes: ENTRY_CLASSES, wide: true }).tree
  assert.equal(tree.type, 'button', '入口自己就是 button，不嵌进原生 button')
  assert.equal(tree.props.type, 'button')
  assert.equal(tree.props.className, ENTRY_CLASSES.panelRow)
  assert.equal(tree.props['aria-pressed'], 'false')
  // 本用例没装 locale 服务：落到自带英文表兜底（中文路径由上一个 locale 用例覆盖）
  assert.equal(tree.props['aria-label'], 'Activity view')
  const glyph = tree.props.children[0]
  assert.equal(glyph.type, 'span')
  assert.equal(glyph.props.className, ENTRY_CLASSES.panelGlyph, 'glyph 用宿主传入的类')
  assert.equal(glyph.props['aria-hidden'], 'true')
  // 字形尺寸沿原生形态：宽 16 / 窄 18（原生 renderSlot('sidebar.panellist', { size: wide ? 16 : 18 })）
  assert.equal(glyph.props.children[0].props.width, 16)
  assert.equal(glyph.props.children[0].props.height, 16)
  const title = tree.props.children[1]
  assert.equal(title.type, 'span')
  // 原生 PanelRow 的标题 span 是 clsx(panelTitle, wide)，不是只挂 panelTitle
  assert.equal(title.props.className, `${ENTRY_CLASSES.panelTitle} ${ENTRY_CLASSES.wide}`)
  assert.equal(textOf(title), 'Activity')

  // 点击 = 切 mode：列表 occupant 真的挂上，aria-pressed 跟着变
  tree.props.onClick()
  assert.equal(mod.__activityMode.isOpen(), true)
  assert.equal(core.entriesOfSlot(SLOT_KEY).length, 1)
  tree = renderInjected(entry, { classes: ENTRY_CLASSES, wide: true }).tree
  assert.equal(tree.props['aria-pressed'], 'true')
  assert.equal(tree.props.className, `${ENTRY_CLASSES.panelRow} ${ENTRY_CLASSES.panelActive}`)
  tree.props.onClick()
  assert.equal(mod.__activityMode.isOpen(), false)
  assert.equal(core.entriesOfSlot(SLOT_KEY).length, 0, '再点一次回落原生列表')

  // 窄侧栏（wide=false）只留 glyph，不渲染标题
  tree = renderInjected(entry, { classes: ENTRY_CLASSES, wide: false }).tree
  const visible = tree.props.children.filter((child) => child !== null && child !== undefined)
  assert.equal(visible.length, 1, '窄侧栏只留 glyph')
  assert.equal(visible[0].props.className, ENTRY_CLASSES.panelGlyph)
  assert.equal(visible[0].props.children[0].props.width, 18, '窄侧栏字形 18，与原生一致')

  host.unmount()
  assert.equal(core.entriesOfSlot(ENTRY_KEY).length, 0, 'teardown 回收入口注册')
  disposeDeclaration()
})

test('slot 入口：缺一个槽就不挂按钮，按到达顺序补齐/撤销且不残留', async (t) => {
  const SlotCore = await loadSlotCore()
  if (SlotCore === undefined) {
    t.skip(`缺少 SlotCore 抽取件：${SLOT_CORE_FIXTURE}`)
    return
  }

  // 1) 只有列表扩展点：老宿主 → 不留死按钮
  {
    const core = new SlotCore()
    const disposeDeclaration = declareSlots(core, [SLOT_KEY])
    const host = createHost(core)
    const mod = loadActivityExports()
    mod.apply(host.ctx)
    assert.equal(core.entriesOfSlot(ENTRY_KEY).length, 0, '缺导航动作行时不许注册入口')

    // 宿主补声明导航动作行并重新通知 → 两槽齐备后按钮出现
    const disposeEntryDeclaration = core.registerFactory(
      {
        name: 'test.host.nav',
        scope: 'root',
        children: { [ENTRY_KEY]: { kind: 'list', scope: 'root' } },
      },
      () => null,
    )
    host.reinject(ENTRY_KEY)
    assert.equal(core.spec(ENTRY_KEY)?.kind, 'list')
    assert.equal(core.entriesOfSlot(ENTRY_KEY).length, 1)

    // 进入活动模式后，导航动作行撤销（注入 Dispose 被调用）→ 入口与 occupant 都清掉，
    // 但模式开关保留；槽位重新出现后按开关状态恢复
    mod.__activityMode.setOpen(true)
    assert.equal(core.entriesOfSlot(SLOT_KEY).length, 1)
    host.injectedOf(ENTRY_KEY).dispose()
    assert.equal(core.entriesOfSlot(ENTRY_KEY).length, 0, '槽消失后入口必须注销')
    assert.equal(core.entriesOfSlot(SLOT_KEY).length, 0, '槽消失后 occupant 也回收')
    assert.equal(mod.__activityMode.isOpen(), true, '槽位消失不改用户的选择')
    host.reinject(ENTRY_KEY)
    assert.equal(core.entriesOfSlot(ENTRY_KEY).length, 1, '槽位重现后入口恢复')
    assert.equal(core.entriesOfSlot(SLOT_KEY).length, 1, '槽位重现后 occupant 恢复')

    host.unmount()
    assert.equal(core.entriesOfSlot(ENTRY_KEY).length, 0)
    assert.equal(core.entriesOfSlot(SLOT_KEY).length, 0)
    disposeEntryDeclaration()
    disposeDeclaration()
  }

  // 2) 只有导航动作行、且 kind 不对（single）：不挂入口，也不许占位
  {
    const core = new SlotCore()
    const disposeDeclaration = core.registerFactory(
      {
        name: 'test.host.nav',
        scope: 'root',
        children: { [ENTRY_KEY]: { kind: 'single', scope: 'root' } },
      },
      () => null,
    )
    const host = createHost(core)
    const mod = loadActivityExports()
    mod.apply(host.ctx)
    assert.equal(core.entriesOfSlot(ENTRY_KEY).length, 0, 'kind 不符时不许注册')
    mod.__activityMode.toggle()
    assert.equal(core.entriesOfSlot(SLOT_KEY).length, 0)
    assert.equal(mod.__activityMode.isOpen(), false)
    host.unmount()
    disposeDeclaration()
  }
})

/* ------------------------------------------------------------------ *
 * 4) DST：在 TZ=America/New_York 下核对「昨天」是日历日
 * ------------------------------------------------------------------ */

test('#0014 view：置顶行按 owner 的 flatSessionIds 顺序提到最前，且不占普通 25 条配额', () => {
  const rows = [
    { id: 'p1', row: row('p1', { updatedAt: now - 5 * DAY }) },
    { id: 'p2', row: row('p2', { updatedAt: now - 6 * DAY }) },
  ]
  for (let index = 0; index < 26; index += 1) {
    rows.push({ id: `s${index}`, row: row(`s${index}`, { updatedAt: now - (index + 1) * HOUR }) })
  }
  const sessions = sessionsOf(rows, {
    // flat 里 p2 比 p1 靠前 → 置顶顺序以 flat 为准，不看 pinnedSessionIds 的数组顺序
    flatSessionIds: ['s3', 'p2', 's7', 'p1', 'q-alias', 's1'],
    pinnedSessionIds: ['p1', 'p2'],
  })
  const model = D.view(viewProps(sessions), undefined, now)

  assert.equal(model.status, 'ready')
  assert.equal(model.groups[0].key, 'pinned')
  assert.equal(model.groups[0].header, false, '置顶组不画标题')
  assert.deepEqual(model.groups[0].entries.map((entry) => entry.id), ['p2', 'p1'])
  // 置顶不占配额：普通项仍取满 25 条
  assert.equal(model.entries.length, 27)
  assert.equal(model.entries.filter((entry) => entry.id !== 'p1' && entry.id !== 'p2').length, 25)
  // 同一精确 id 只出现一次，别名不会带出重复行
  const ids = model.groups.flatMap((g) => g.entries.map((entry) => entry.id))
  assert.equal(new Set(ids).size, ids.length)
})

test('#0014 view：flat 缺项按 pinnedSessionIds 追加；旧置顶行保留真实时间，running 与置顶并存', () => {
  const sessions = sessionsOf([
    { id: 'oldPin', row: row('oldPin', { updatedAt: now - 3 * DAY }) },
    { id: 'runPin', row: row('runPin', { running: true, updatedAt: now - 9 * DAY }) },
    { id: 'plain', row: row('plain', { updatedAt: now - HOUR }) },
  ], {
    flatSessionIds: ['plain', 'runPin'],
    pinnedSessionIds: ['oldPin', 'runPin'],
  })
  const model = D.view(viewProps(sessions), undefined, now)
  assert.deepEqual(model.groups[0].entries.map((entry) => entry.id), ['runPin', 'oldPin'])

  const runPin = model.entries.find((entry) => entry.id === 'runPin')
  const oldPin = model.entries.find((entry) => entry.id === 'oldPin')
  assert.equal(runPin.running, true, '置顶与 running 并存，spinner 由 running 决定')
  assert.equal(runPin.time, now - 9 * DAY, '不伪造 running 的官方时间')
  assert.equal(oldPin.running, false)
  assert.equal(oldPin.time, now - 3 * DAY, '旧置顶行保留真实 updatedAt')
  assert.equal(D.bucketOf(oldPin, now), 'earlier', '不会被伪装成今天')
})

test('#0014 view：归档的置顶行不进置顶段，show 下仍回既有日期组', () => {
  const sessions = sessionsOf([
    { id: 'archPin', row: row('archPin', { updatedAt: now - 3 * DAY }) },
    { id: 'live', row: row('live', { updatedAt: now - HOUR }) },
  ], {
    flatSessionIds: ['archPin', 'live'],
    pinnedSessionIds: ['archPin'],
    archivedSessionIds: ['archPin'],
  })
  const hidden = D.view(viewProps(sessions), undefined, now)
  assert.deepEqual(hidden.entries.map((entry) => entry.id), ['live'])
  assert.equal(hidden.groups.some((g) => g.key === 'pinned'), false)

  const shown = D.view(viewProps(sessions, { archivedFilter: 'show' }), undefined, now)
  assert.equal(shown.groups.some((g) => g.key === 'pinned'), false, '归档行不生成置顶段')
  const archGroup = shown.groups.find((g) => g.entries.some((entry) => entry.id === 'archPin'))
  assert.equal(archGroup.key, 'earlier', '归档置顶行留在既有日期组')
  assert.equal(archGroup.entries.find((entry) => entry.id === 'archPin').archived, true, '仍按归档灰显')
})

test('#0014 view：宿主没给 pinnedSessionIds 时行为与没有置顶功能完全一致', () => {
  const rows = [
    { id: 'a', row: row('a', { updatedAt: now - HOUR }) },
    { id: 'b', row: row('b', { running: true, updatedAt: now - 3 * DAY }) },
  ]
  const withField = sessionsOf(rows, { flatSessionIds: ['a', 'b'], pinnedSessionIds: [] })
  const withoutField = sessionsOf(rows, { flatSessionIds: ['a', 'b'] })
  delete withoutField.pinnedSessionIds
  const a = D.view(viewProps(withField), undefined, now)
  const b = D.view(viewProps(withoutField), undefined, now)
  assert.deepEqual(b.groups.map((g) => g.key), a.groups.map((g) => g.key))
  assert.deepEqual(b.entries.map((entry) => entry.id), a.entries.map((entry) => entry.id))
  assert.equal(b.groups.some((g) => g.key === 'pinned'), false)
})

test('组件：#0014 顶部直接是置顶行、不新增标题，随后才是 Today / Earlier', () => {
  const sessions = sessionsOf([
    { id: 'pinOld', row: row('pinOld', { updatedAt: now - 3 * DAY }) },
    { id: 'pinRun', row: row('pinRun', { running: true, updatedAt: now - 9 * DAY }) },
    { id: 'fresh', row: row('fresh', { updatedAt: now - HOUR }) },
    { id: 'older', row: row('older', { updatedAt: now - 2 * DAY }) },
  ], {
    flatSessionIds: ['fresh', 'pinRun', 'older', 'pinOld'],
    pinnedSessionIds: ['pinOld', 'pinRun'],
  })
  const host = {
    ...viewProps(sessions),
    store: fakeStore(),
    translate: (key, params) => (params === undefined ? `<${key}>` : `<${key}:${params.count}>`),
    row: { leading: (id) => ({ type: 'i', props: { 'data-leading': id, children: [] } }) },
  }
  const { tree } = renderList(host)

  assert.deepEqual(byClass(tree, 'avRow').map((node) => node.props['data-session-row']), [
    'pinRun',
    'pinOld',
    'fresh',
    'older',
  ])
  // 置顶段没有标题：标题只有原生 Today / Earlier 两个
  assert.deepEqual(byClass(tree, 'avGroupTitle').map(textOf), ['<today>', '<earlier>'])
  assert.equal(byClass(tree, 'avGroup').length, 3, '置顶段 + 两个日期组')

  const firstRow = byClass(tree, 'avRow')[0]
  assert.equal(byClass(firstRow, 'avSpin').length, 1, '置顶 + running 仍带 spinner')
  const secondRow = byClass(tree, 'avRow')[1]
  assert.equal(byClass(secondRow, 'avSpin').length, 0, '非 running 的置顶行没有 spinner')
  assert.match(textOf(secondRow), /<daysAgo:3>/, '旧置顶行显示真实相对时间')
})

test('DST：春秋切换周的「昨天」起点按日历日推进', (t) => {
  if (!IS_DST_CHILD) {
    t.skip('只在 TZ=America/New_York 子进程里运行')
    return
  }
  // 2026-03-08 是美东春季切换日（当地 23 小时）
  const springNow = new Date(2026, 2, 9, 0, 30, 0).getTime()
  const springToday = D.dayStart(springNow)
  const springYesterday = D.yesterdayStart(springNow)
  assert.equal((springToday - springYesterday) / HOUR, 23, '3 月 9 日之前那天只有 23 小时')
  const springDate = new Date(springYesterday)
  assert.equal(springDate.getDate(), 8)
  assert.equal(springDate.getHours(), 0)

  // 2026-11-01 是秋季切换日（当地 25 小时）
  const fallNow = new Date(2026, 10, 2, 12, 0, 0).getTime()
  const fallToday = D.dayStart(fallNow)
  const fallYesterday = D.yesterdayStart(fallNow)
  assert.equal((fallToday - fallYesterday) / HOUR, 25, '11 月 2 日之前那天有 25 小时')
  assert.equal(new Date(fallYesterday).getDate(), 1)

  // 也就是说：这些天里 yesterdayStart === dayStart - 86400000 是错的
  assert.notEqual(springYesterday, springToday - DAY)
  assert.notEqual(fallYesterday, fallToday - DAY)
})

/*
 * 两个时区各跑一次（DST 用例只在美东时区生效）：
 *   node --test test/activity-data.test.cjs
 *   TZ=America/New_York node --test test/activity-data.test.cjs
 */
