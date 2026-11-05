/**
 * Client half of the activity-view bundle.
 *
 * 定位：宿主插槽的一个渲染者（occupant），不接管任何其他区域。
 *  - 只在宿主声明的 `sidebar.workspaces.sessions`（single/root）里注册一个列表 occupant；
 *    不注册时 SlotOutlet 自己回落到原生 FlatList/SessionTree，插件不返回、不复制原生列表。
 *  - 不向 document 铺覆盖层，不读取/改写宿主 DOM（无 querySelector、无 MutationObserver、
 *    无 capture 阶段劫持、无 documentElement 属性、无祖先样式下发）。
 *  - 数据优先使用宿主通过 props 传进来的原生快照（props.sessions.list）与原生过滤集合，
 *    只有宿主没传时（老宿主 / 单独挂载调试）才退回 `ctx.sessions.list` 的官方快照。
 *  - 时间只由本组件的分钟级本地时钟推进（不算数据源轮询），跨午夜时分组随之重算。
 */
window.__ModuleLoader__.load({
  id: 'dsh-activity-view',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const NS = 'activityView'
    const MAX_ROWS = 25
    /** 宿主列表扩展点（single/root，原生无占用者，active 时用默认 priority 0 即可）。 */
    const SLOT_KEY = 'sidebar.workspaces.sessions'
    /**
     * 开关入口：宿主补丁追加的导航动作行插槽（list/root）。
     * 位置在 nav.panelList 的原 PanelRows 之后、More 之前，自带 button 语义，
     * 不 selectPanel、不写 globalPanel、不碰 footer。
     * props 合同（宿主显式传入）：{ wide, classes: { panelRow, panelActive, panelGlyph, panelTitle } }。
     */
    const ENTRY_KEY = 'sidebar.navigation.action'
    /** register 的 options.id / options.order（宿主渲染顺序：原生行之后、More 之前）。 */
    const ENTRY_ID = 'activity-view'
    const ENTRY_ORDER = 20

    /**
     * 纯数据层（无 DOM / 无 locale / 无 React / 无插槽），供 UI 与 test 共用。
     *
     * 数据合同只认官方字段。宿主原生快照 `props.sessions.list` 与
     * `ctx.sessions.list.getSnapshot()` 同形：{ ids, byId }，byId 每行由
     * dsh-api-session-controller 的 projectList() 投影而来，字段集合是：
     * id / displayTitle / running / retainedBy / blank / updatedAt / formatStatus，
     * 以及可选的 title / cwd / parentId / origin / projectionValues。
     * updatedAt 即官方活动时间（api-session/activity → handleSessionActivity，与
     * metadata.lastPromptAt 取 max），不探测 lastPromptAt 这类未经证实的时间字段。
     */
    const D = (() => {
      const toTime = (value) => {
        if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? value : undefined
        if (typeof value === 'string' && value !== '') {
          const parsed = Date.parse(value)
          return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
        }
        return undefined
      }

      const pick = (value) => (typeof value === 'string' && value.trim() !== '' ? value.trim() : '')

      /** 本地日历日的起点（用 setHours 归零，不用毫秒偏移）。 */
      const dayStart = (now) => {
        const date = new Date(now)
        date.setHours(0, 0, 0, 0)
        return date.getTime()
      }

      /**
       * 昨天的本地日历日起点。
       *
       * 必须用 setDate(getDate() - 1)：本地日可能是 23/24/25 小时（夏令时切换），
       * `today - 86400000` 在春季切换日会落到前天 23:00 / 昨天 01:00，把昨天整组算错。
       */
      const yesterdayStart = (now) => {
        const date = new Date(now)
        date.setHours(0, 0, 0, 0)
        date.setDate(date.getDate() - 1)
        return date.getTime()
      }

      /** 到下一个整分钟的毫秒数（本地时钟就用它续期，不做数据轮询）。 */
      const minuteDelay = (now) => {
        const delay = 60000 - (now % 60000)
        return delay > 0 ? delay : 60000
      }

      /** 子代理行不进活动列表：只认官方 origin / parentId。 */
      const isChildRow = (row) =>
        row !== null && row !== undefined && (row.origin === 'subagent' || pick(row.parentId) !== '')

      const workspaceOf = (row) => {
        const cwd = pick(row?.cwd)
        if (cwd === '') return ''
        const parts = cwd.split('/').filter(Boolean)
        return parts.length === 0 ? '' : parts[parts.length - 1]
      }

      const toEntry = (row) => {
        const id = pick(row?.id)
        if (id === '') return undefined
        const realTitle = pick(row?.title)
        const display = pick(row?.displayTitle)
        const workspace = workspaceOf(row)
        return {
          id,
          title: realTitle || display || workspace || id.slice(0, 8),
          workspace,
          hasTitleHint: realTitle !== '',
          blank: row?.blank === true,
          time: toTime(row?.updatedAt),
          running: row?.running === true,
        }
      }

      const archivedSet = (sessions) =>
        new Set(
          Array.isArray(sessions?.archivedSessionIds)
            ? sessions.archivedSessionIds.filter((id) => typeof id === 'string' && id !== '')
            : [],
        )

      /**
       * 原生置顶集合：`props.sessions.pinnedSessionIds`（宿主 owner 合同字段，
       * 与 archivedSessionIds 同源）。老宿主没给这个字段时返回空集合，
       * 活动模式行为与没有置顶功能时完全一致。
       */
      const pinnedSet = (sessions) => {
        const list = sessions?.pinnedSessionIds
        if (!Array.isArray(list)) return new Set()
        const set = new Set()
        for (const id of list) if (typeof id === 'string' && id !== '') set.add(id)
        return set
      }

      /**
       * 置顶顺序：以 owner 的 `sessions.flatSessionIds`（原生有序 id 列表）为准，
       * 只捞其中被精确置顶的 id；`flatSessionIds` 里没有的置顶项再按
       * `pinnedSessionIds` 原数组顺序补在后面。全程精确 id 匹配：不去前缀、
       * 不看 title、不读未经取证的 `row.pinned`。
       *
       * 返回 { pinned, rest }：pinned 是置顶行（已按上面顺序），rest 保持传入顺序。
       */
      const pinnedOrder = (entries, sessions) => {
        const pins = pinnedSet(sessions)
        if (pins.size === 0 || entries.length === 0) return { pinned: [], rest: entries }
        const byId = new Map()
        for (const entry of entries) if (!byId.has(entry.id)) byId.set(entry.id, entry)
        const pinned = []
        const taken = new Set()
        const take = (id) => {
          if (typeof id !== 'string' || !pins.has(id) || taken.has(id)) return
          const entry = byId.get(id)
          // 与原生 sectionMembers 一致：归档行不进置顶段，仍留在既有日期组里（灰显）。
          if (entry === undefined || entry.archived === true) return
          pinned.push(entry)
          taken.add(id)
        }
        if (Array.isArray(sessions?.flatSessionIds)) for (const id of sessions.flatSessionIds) take(id)
        for (const id of sessions.pinnedSessionIds) take(id)
        return { pinned, rest: entries.filter((entry) => !taken.has(entry.id)) }
      }

      /**
       * 原生 `mainSessionId(list)`：当前被主视图保留的会话（即 currentBlank）。
       * 宿主已经在 props.sessions.currentSessionId 里给了就直接用。
       */
      const mainSessionId = (snapshot, sessions) => {
        const explicit = pick(sessions?.currentSessionId)
        if (explicit !== '') return explicit
        const byId = snapshot?.byId ?? {}
        for (const key of Object.keys(byId)) {
          const row = byId[key]
          if (row !== undefined && row !== null && (row.retainedBy?.mainView ?? 0) > 0) return pick(row.id)
        }
        return undefined
      }

      /**
       * 与原生 `sessionVisible(session, current, archived, archivedFilter)` 等价：
       *  - 子代理行不出现；
       *  - blank 行只保留 currentBlank（这就是「currentBlank 例外」）；
       *  - archivedFilter: default → 只看未归档；show → 全看；only → 只看已归档。
       *
       * 注意：owner.flatSessionIds / orderedWorkspaces 只做排序，**不按 archivedFilter 过滤**，
       * 所以本插件必须自己按这条原生规则筛，不能假设那些 id 天生可见。
       */
      const sessionVisible = (row, current, archived, filter) => {
        if (row?.origin === 'subagent') return false
        if (row?.blank === true && pick(row?.id) !== current) return false
        const id = pick(row?.id)
        if (filter === 'show') return true
        if (filter === 'only') return archived.has(id)
        return !archived.has(id)
      }

      /**
       * 从原生快照取行。
       *
       * 去重只按官方 `row.id`：`ids` 里的键只是索引，可能就是带前缀的别名；
       * 用别名去重会把「别名不同、真实 id 相同」的两项误判成同一个会话。
       * byId 里查不到对应行时**不**记入 seen —— 否则后面同 id 的有效行会被吞掉。
       */
      const collect = (snapshot, sessions) => {
        const ids = Array.isArray(snapshot?.ids) ? snapshot.ids : []
        const byId = snapshot?.byId ?? {}
        const archived = archivedSet(sessions)
        const current = mainSessionId(snapshot, sessions)
        const filter = sessions?.archivedFilter ?? 'default'
        const seen = new Set()
        const entries = []
        for (const key of ids) {
          const row = typeof key === 'string' ? byId[key] : undefined
          if (row === undefined || row === null) continue
          if (!sessionVisible(row, current, archived, filter)) continue
          const entry = toEntry(row)
          if (entry === undefined) continue
          if (seen.has(entry.id)) continue
          seen.add(entry.id)
          entries.push({ ...entry, archived: archived.has(entry.id) })
        }
        return entries
      }

      /**
       * 活动模式的固定排序：运行中优先，其次官方 updatedAt 倒序（无时间的排最后），
       * 同时间用 id 保证稳定。不复刻原生的 workspace / 手动排序——用户一旦切换那些
       * 原生选项，本插件直接退出活动模式，把列表交回原生。
       */
      const sort = (entries) => {
        const list = entries.slice()
        list.sort((a, b) => {
          if (a.running !== b.running) return a.running ? -1 : 1
          const left = a.time ?? 0
          const right = b.time ?? 0
          if (left !== right) return right - left
          return a.id.localeCompare(b.id)
        })
        return list
      }

      /** 先排序再限量：限量必须发生在全局排序之后，不能对未排序前缀截断。 */
      const limit = (entries) => (entries.length > MAX_ROWS ? entries.slice(0, MAX_ROWS) : entries)

      const dayKey = (time, now) => {
        if (time === undefined) return 'earlier'
        if (time >= dayStart(now)) return 'today'
        if (time >= yesterdayStart(now)) return 'yesterday'
        return 'earlier'
      }

      /**
       * 活动模式固定「运行优先 + 日期组」：
       * 运行中的会话一律落在今天（不重写它的官方 time），其余按本地日历日归组。
       */
      const bucketOf = (entry, now) => (entry.running ? 'today' : dayKey(entry.time, now))

      /**
       * 活动模式固定「运行优先 + 日期组」，置顶行额外落在最前面的 `pinned` 组。
       * `pinned` 组**不画标题**（`header: false`）：顶部直接是置顶行，随后仍是
       * Today / Yesterday / Earlier，用户已认可的分组布局不变，也不产生空标题高度。
       */
      const group = (entries, now, pinned = []) => {
        const groups = []
        if (pinned.length > 0) groups.push({ key: 'pinned', header: false, entries: pinned })
        const index = new Map()
        for (const entry of entries) {
          const key = bucketOf(entry, now)
          let bucket = index.get(key)
          if (bucket === undefined) {
            bucket = { key, entries: [] }
            index.set(key, bucket)
            groups.push(bucket)
          }
          bucket.entries.push(entry)
        }
        return groups
      }

      /** 活动模式接管的是「运行优先 + 日期组」；原生排序/分组选项一改就交回原生。 */
      const modes = (view) => ({ groupBy: view?.groupBy, orderBy: view?.orderBy })

      /**
       * 原生菜单改了 groupBy / orderBy 就退出活动模式。
       * 只读比较、不回写：用户的选择原样保留，原生列表按新选择即时生效。
       */
      const shouldLeaveActivityMode = (baseline, next) => {
        if (baseline === undefined || next === undefined) return false
        return baseline.groupBy !== next.groupBy || baseline.orderBy !== next.orderBy
      }

      const ago = (time, now) => {
        const delta = now - time
        if (delta < 60000) return { unit: 'now', value: 0 }
        if (delta < 3600000) return { unit: 'minutes', value: Math.floor(delta / 60000) }
        if (delta < 86400000) return { unit: 'hours', value: Math.floor(delta / 3600000) }
        return { unit: 'days', value: Math.floor(delta / 86400000) }
      }

      const formatWhen = (time, now, t) => {
        if (time === undefined) return ''
        const span = ago(time, now)
        if (span.unit === 'now') return t('now')
        if (span.unit === 'minutes') return t('minutesAgo', { count: span.value })
        if (span.unit === 'hours') return t('hoursAgo', { count: span.value })
        return t('daysAgo', { count: span.value })
      }

      /**
       * 单一入口：把宿主 props 收成「已过滤 + 已排序 + 已限量 + 已分组」的视图模型。
       * 返回 status 让 UI 区分 loading / empty / ready / unavailable。
       */
      const view = (props, snapshot, now) => {
        const sessions = props?.sessions ?? undefined
        const native = sessions?.list ?? snapshot
        if (native === undefined || native === null) return { status: 'unavailable', groups: [], entries: [] }
        if (props?.view?.ready === false) return { status: 'loading', groups: [], entries: [] }
        // 归档筛选：宿主把它放在 props.view.archivedFilter；老快照兜底才读 sessions 上的同名字段。
        const archivedFilter = props?.view?.archivedFilter ?? sessions?.archivedFilter
        const context = sessions === undefined || sessions.archivedFilter === archivedFilter
          ? (sessions ?? {})
          : { ...sessions, archivedFilter }
        const sorted = sort(collect(native, context))
        // 置顶行提到最前，且**不占** MAX_ROWS 配额：普通行仍取满 MAX_ROWS。
        const { pinned, rest } = pinnedOrder(sorted, context)
        const shown = limit(rest)
        const entries = pinned.concat(shown)
        const groups = group(shown, now, pinned)
        return { status: entries.length === 0 ? 'empty' : 'ready', groups, entries }
      }

      return {
        toTime,
        pick,
        dayStart,
        yesterdayStart,
        minuteDelay,
        isChildRow,
        workspaceOf,
        toEntry,
        mainSessionId,
        sessionVisible,
        pinnedSet,
        pinnedOrder,
        collect,
        sort,
        limit,
        dayKey,
        bucketOf,
        group,
        modes,
        shouldLeaveActivityMode,
        formatWhen,
        view,
      }
    })()

    const MESSAGES = {
      en: {
        panelTitle: 'Activity',
        iconLabel: 'Activity view',
        loading: 'Loading activity…',
        empty: 'No recent sessions',
        failed: 'Could not read sessions',
        unavailable: 'Session list extension point unavailable in this build',
        now: 'now',
        minutesAgo: '{count}m',
        hoursAgo: '{count}h',
        daysAgo: '{count}d',
        today: 'Today',
        yesterday: 'Yesterday',
        earlier: 'Earlier',
      },
      zh: {
        panelTitle: '活动',
        iconLabel: '活动视图',
        loading: '正在读取活动…',
        empty: '最近没有会话',
        failed: '读取会话失败',
        unavailable: '当前版本没有提供会话列表扩展点',
        now: '刚刚',
        minutesAgo: '{count} 分钟前',
        hoursAgo: '{count} 小时前',
        daysAgo: '{count} 天前',
        today: '今天',
        yesterday: '昨天',
        earlier: '更早',
      },
    }

    const interpolate = (template, params) => {
      if (typeof template !== 'string') return ''
      if (params === undefined) return template
      return template.replace(/\{(\w+)\}/g, (match, name) =>
        params[name] === undefined ? match : String(params[name]),
      )
    }

    /**
     * 语言座位：宿主 SlotOutlet 会把绑定到 entry.locale 的 `t` 传进组件 props（标准座位），
     * 组件优先用它；没有 t 就用注入的 translate；两者都没有才落到自带英文表。
     * 这里不探测任何未经证实的 locale 字段（language()/getLocale 之类）。
     */
    const pickTranslate = (props) => {
      if (typeof props?.t === 'function') return props.t
      if (typeof props?.translate === 'function') return props.translate
      return (key, params) => interpolate(MESSAGES.en[key] ?? key, params)
    }

    /**
     * 样式随组件一起渲染（`<style>` 作为组件子节点），不再往 document.head 注入
     * 全局样式表：没有全局 id，热更新时也不会因为「旧 id 已存在」而提前 return 留下陈旧 CSS。
     * 行指标全部取宿主自己用的 layout token（`--dsh-sidebar-row-padding` / `--dsh-sidebar-label-gap` /
     * `--dsh-sidebar-paint-inset` / `--dsh-workspace-indent` / `--dsw-radius-md`），不观测 DOM、不自造数值。
     *
     * 滚动：补丁替换掉的是 `listArea` 里那个 `<FlatList>`/`<SessionTree>` 元素本身，而原生
     * `.list` / `.treeBody` 只存在于**未占位时的 fallback 组件内部**——一旦 override 生效它们并不存在。
     * 因此本 occupant 的根节点必须自己充当唯一滚动容器，按原生 `.list` 的 token 复刻
     * （`flex:1; min-height:0; overflow-y:auto`、`--dsh-session-list-scrollbar-offset` /
     * `--dsh-session-list-scrollbar-width` / `--dsh-session-list-edge-inset`、`scrollbar-gutter:stable`、
     * 底部 16px 出血），并且不画背景，让 sidebar 背景透上来；内容组与行 `flex:none`，不被压扁。
     */
    const STYLE = `
.avRoot{box-sizing:border-box;display:flex;flex-direction:column;flex:1;min-height:0;overflow-y:auto;overflow-x:hidden;scrollbar-gutter:stable;margin-left:-4px;margin-right:var(--dsh-session-list-scrollbar-offset,0px);padding-left:4px;padding-right:calc(var(--dsh-session-list-edge-inset,var(--dsh-sidebar-row-padding,12px)) - var(--dsh-session-list-scrollbar-width,0px) - var(--dsh-session-list-scrollbar-offset,0px));padding-bottom:16px;background-color:transparent;color:var(--dsw-alias-label-primary,currentColor);font-size:14px}
.avRoot>*+*{margin-top:2px}
.avGroup{display:flex;flex-direction:column;flex:none}
.avGroup>*+*{margin-top:2px}
.avGroupTitle{box-sizing:border-box;flex:none;margin-top:4px;padding-inline:var(--dsh-session-list-edge-inset,var(--dsh-sidebar-row-padding,12px));font-size:11px;line-height:16px;font-weight:500;color:var(--dsw-alias-label-tertiary,currentColor)}
.avRow{box-sizing:border-box;display:flex;flex:none;align-items:center;gap:0;width:100%;height:32px;margin-top:2px;padding:0 8px;padding-inline-start:calc(var(--dsh-sidebar-row-padding,12px) - var(--dsh-sidebar-paint-inset,0px) + var(--dsh-workspace-indent,0px));border-style:solid;border-color:transparent;border-width:0;border-inline-width:var(--dsh-sidebar-paint-inset,0px);border-radius:var(--dsw-radius-md,8px);background-color:transparent;background-clip:padding-box;color:inherit;font:inherit;text-align:left;cursor:pointer}
.avRow:hover{background-color:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12))}
.avRow:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary,currentColor));outline-offset:-2px}
.avRowArchived .avTitle{color:var(--dsw-alias-label-caption,currentColor)}
.avRowArchived .avMeta{color:var(--dsw-alias-label-caption,currentColor)}
.avRowArchived:hover{background-color:transparent}
.avLeading{flex:none;display:inline-flex;align-items:center;justify-content:center;width:16px;height:20px;line-height:0;color:var(--dsw-alias-label-tertiary,currentColor)}
.avTitle{flex:1 1 auto;min-width:0;margin:0 6px 0 var(--dsh-sidebar-label-gap,6px);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px;line-height:20px}
.avMeta{display:flex;align-items:center;gap:6px;flex:0 1 auto;min-width:0;max-width:45%;overflow:hidden;color:var(--dsw-alias-label-tertiary,currentColor)}
.avWorkspace{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;line-height:20px}
.avTime{flex:none;font-size:10px;line-height:16px;font-variant-numeric:tabular-nums}
.avRowTail{flex:none;display:inline-flex;align-items:center;gap:2px;min-width:0}
.avNotice{flex:none;padding:10px 12px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary,currentColor)}
/*
 * 运行中指示器用真实 SVG 圆弧画正圆：正方 viewBox + 等宽高 + flex:none，
 * 不再用 border 画环（border 的斜接在不同 DPR 下会看成椭圆/缺角）。
 * 轨道细、弧端圆，颜色仍取 currentColor，尺寸仍占 12×12，leading 座位 16×20 不变。
 */
.avSpin{flex:none;width:12px;height:12px;min-width:12px;min-height:12px;display:inline-flex;align-items:center;justify-content:center;line-height:0;animation:avSpin .9s linear infinite;transform-origin:50% 50%}
@keyframes avSpin{to{transform:rotate(360deg)}}
.avSpinGlyph{display:block;flex:none;width:12px;height:12px;overflow:visible}
.avSpinTrack{fill:none;stroke:currentColor;stroke-width:1.5;stroke-linecap:round;opacity:.3}
.avSpinArc{fill:none;stroke:currentColor;stroke-width:1.5;stroke-linecap:round}
`

    const styleNode = () => h('style', { key: 'av-style' }, STYLE)

    /** 插槽决策：只有宿主真的声明成 single 才注册，别的形状一律告警不动。 */
    const decideSlot = (spec) => {
      if (spec === undefined || spec === null) {
        return { mounted: false, reason: 'undeclared' }
      }
      const kind = spec.kind ?? spec.type
      if (kind === 'single') return { mounted: true, reason: 'declared' }
      return { mounted: false, reason: `unexpected-kind:${String(kind)}` }
    }

    /** 入口插槽决策：宿主必须声明成 list（动作行是一串，不是单占位）。 */
    const decideEntry = (spec) => {
      if (spec === undefined || spec === null) {
        return { mounted: false, reason: 'undeclared' }
      }
      const kind = spec.kind ?? spec.type
      if (kind === 'list') return { mounted: true, reason: 'declared' }
      return { mounted: false, reason: `unexpected-kind:${String(kind)}` }
    }

    /** 宿主快照的兜底读取（仅当 props 没带 sessions.list 时用）。 */
    const createSnapshotReader = (sessionsService) => () => {
      try {
        const snapshot = sessionsService?.list?.getSnapshot?.()
        return snapshot ?? undefined
      } catch (error) {
        console.error('[activity-view] session snapshot read failed', error)
        return undefined
      }
    }

    /**
     * 全局 UI store：只存「开关 + locale 版本 + 活动模式基线」，会话数据一律走 props。
     *
     * baseline 存这里而不是组件 useRef：搜索或 rail 收起会让 occupant 临时 unmount，
     * useRef 会跟着丢，重挂时把改过的原生 groupBy/orderBy 当成新基线，于是「用户改了
     * 原生分组也不退出活动模式」。基线挂在 store 上就跨临时 unmount 保留，
     * 打开/关闭活动模式（activation 生命周期）时重置。
     */
    const createStore = () => {
      let snapshot = { open: false, localeEpoch: 0, baseline: null }
      const listeners = new Set()
      const publish = (next) => {
        snapshot = next
        for (const listener of Array.from(listeners)) {
          try {
            listener()
          } catch (error) {
            console.error('[activity-view] store listener failed', error)
          }
        }
      }
      return {
        subscribe: (listener) => {
          listeners.add(listener)
          return () => listeners.delete(listener)
        },
        getSnapshot: () => snapshot,
        isOpen: () => snapshot.open,
        setOpen: (open) => {
          if (snapshot.open === open) return
          // activation 重置：每次开/关都清基线，下一次渲染重新取。
          publish({ ...snapshot, open, baseline: null })
        },
        toggle: () => publish({ ...snapshot, open: !snapshot.open, baseline: null }),
        bumpLocale: () => publish({ ...snapshot, localeEpoch: snapshot.localeEpoch + 1 }),
        /**
         * 活动模式基线检查（纯逻辑，不碰宿主）：
         *  - 未开启：清基线，不动模式；
         *  - 首次：记录基线，不退出；
         *  - 之后（含跨 unmount 重挂）：原生分组/排序变了就静默退出活动模式。
         * 返回 true 表示这次调用把活动模式关掉了。
         */
        checkGrouping: (modes) => {
          if (snapshot.open !== true) {
            if (snapshot.baseline !== null) publish({ ...snapshot, baseline: null })
            return false
          }
          if (snapshot.baseline === null) {
            publish({ ...snapshot, baseline: modes })
            return false
          }
          if (!D.shouldLeaveActivityMode(snapshot.baseline, modes)) return false
          publish({ ...snapshot, open: false, baseline: null })
          return true
        },
      }
    }

    const useStore = (store) =>
      React.useSyncExternalStore
        ? React.useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
        : store.getSnapshot()

    /**
     * 本地分钟时钟：到下一个整分钟续一次，跨午夜时分组与相对时间一起重算。
     * 这不是数据源轮询（不碰会话 API），只是让「今天/昨天/N 分钟前」不冻结。
     */
    const useNow = () => {
      const [now, setNow] = React.useState(() => Date.now())
      React.useEffect(() => {
        let timer = 0
        const schedule = () => {
          timer = setTimeout(() => {
            setNow(Date.now())
            schedule()
          }, D.minuteDelay(Date.now()))
        }
        schedule()
        return () => clearTimeout(timer)
      }, [])
      return now
    }

    /** 原生交互控件清单：只有这些子节点的点击/按键才不外溢到整行。 */
    const INTERACTIVE = 'button,a,input,textarea,select,summary,[role="button"],[role="link"],[data-context-menu-trigger]'

    /**
     * 命中判定必须**限制在 currentTarget 之内**：`closest` 会一路向上找到外层行自己
     * （行本身带 role=button），那不属于「行内原生控件」。所以只在 found 既不是边界本身、
     * 又确实被边界包含时才算内部控件；无法判定包含关系时按「不抑制」处理——宁可多开一次会话，
     * 也不能吞掉普通区域的点击。
     */
    const insideInteractive = (event) => {
      const target = event?.target
      const boundary = event?.currentTarget
      if (target === undefined || target === null) return false
      if (boundary === undefined || boundary === null || target === boundary) return false
      if (typeof target.closest !== 'function') return false
      const found = target.closest(INTERACTIVE)
      if (found === undefined || found === null) return false
      if (found === boundary) return false
      if (typeof boundary.contains !== 'function') return false
      return boundary.contains(found) === true
    }

    /**
     * 子节点捕获：原生 leading / trailing / action 节点里可能有自己的按钮。
     * 只有真的点到交互控件时才阻断冒泡，普通空白与文字仍然打开会话。
     */
    const holdInteractive = (event) => {
      if (insideInteractive(event)) event.stopPropagation()
    }

    /**
     * 一行原生风格的会话：leading 16 / 间隙 label-gap / 单行弹性标题 / 右侧「工作区 + 时间」。
     *
     * 时间列规则（已定，勿改）：running 行的时间原值不动、也不按相对时间重算，
     * 右侧只显示工作区；否则 5 天前的会话一旦 running 就会被写成「今天」。
     */
    const SessionRow = (props) => {
      const { entry, host, t, now } = props
      const row = host?.row
      const call = (fn) => {
        if (typeof fn !== 'function') return null
        try {
          return fn(entry.id)
        } catch (error) {
          console.error('[activity-view] native row node failed', error)
          return null
        }
      }
      const leading = call(row?.leading)
      const trailing = call(row?.trailing)
      const actions = call(row?.actions)
      const hover = call(row?.hover)
      const when = entry.running ? '' : D.formatWhen(entry.time, now, t)
      const open = () => {
        try {
          host?.actions?.openSession?.(entry.id)
        } catch (error) {
          console.error('[activity-view] openSession failed', error)
        }
      }
      /*
       * 右键菜单走原生 action：openSessionMenu(sessionId, displayTitle, point, mode)。
       * 原生只有省略号按钮一处调用（mode='toggle'）；右键不是开关动作，用 'open'，
       * 交给宿主 contextMenus.open 打开原生 session 菜单。
       */
      const openMenu = (event) => {
        const menu = host?.actions?.openSessionMenu
        if (typeof menu !== 'function') return
        if (typeof event?.preventDefault === 'function') event.preventDefault()
        if (typeof event?.stopPropagation === 'function') event.stopPropagation()
        try {
          menu(entry.id, entry.title, { x: event?.clientX ?? 0, y: event?.clientY ?? 0 }, 'open')
        } catch (error) {
          console.error('[activity-view] openSessionMenu failed', error)
        }
      }
      /*
       * leading 座位的合同：row.leading(id) 返回的是 SlotOutlet 元素，
       * 即使原生没有内容也不是 null。所以不能用「非 null」判断有没有 spinner：
       * running 行一律用自带的运行中指示，非 running 行用原生节点，原生空则留空占位。
       */
      /*
       * spinner 是装饰性图形：整体 aria-hidden，不参与读屏和可访问名；
       * 尺寸锁在 12×12 的正方框里，靠 SVG viewBox 保证无论容器怎么压都是正圆。
       */
      const leadingNode = entry.running
        ? h(
            'span',
            { className: 'avSpin', 'aria-hidden': 'true' },
            h(
              'svg',
              {
                className: 'avSpinGlyph',
                viewBox: '0 0 16 16',
                width: 12,
                height: 12,
                focusable: 'false',
                'aria-hidden': 'true',
              },
              h('circle', { className: 'avSpinTrack', cx: 8, cy: 8, r: 6.5 }),
              h('path', { className: 'avSpinArc', d: 'M8 1.5A6.5 6.5 0 1 1 1.5 8' }),
            ),
          )
        : leading !== null
          ? leading
          : null
      return h(
        'div',
        {
          className: entry.archived ? 'avRow avRowArchived' : 'avRow',
          role: 'button',
          tabIndex: 0,
          'data-session-row': entry.id,
          title: entry.title,
          // 归档行按原生 linkState 灰显；点击仍交给原生 guardedOpen，由宿主提示「已归档不可打开」。
          'aria-disabled': entry.archived ? 'true' : undefined,
          onClick: open,
          onContextMenu: openMenu,
          onKeyDown: (event) => {
            // 子按钮自己的 Enter/Space 不替整行开会话。
            if (event?.target !== undefined && event.target !== event.currentTarget) return
            if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
              event.preventDefault()
              open()
            }
          },
        },
        h('span', { className: 'avLeading', onClick: holdInteractive, onKeyDown: holdInteractive }, leadingNode),
        h('span', { className: 'avTitle' }, entry.title),
        h(
          'span',
          { className: 'avMeta' },
          entry.workspace === '' ? null : h('span', { className: 'avWorkspace' }, entry.workspace),
          when === '' ? null : h('span', { className: 'avTime' }, when),
        ),
        h(
          'span',
          { className: 'avRowTail', onClick: holdInteractive, onKeyDown: holdInteractive },
          trailing,
          actions,
          hover,
        ),
      )
    }

    /**
     * 列表 occupant。宿主把 owner 摊平进 props：
     * props.view / props.sessions / props.actions / props.row。
     * 打开会话只走 props.actions.openSession（原生 guardedOpen：归档会话有原生保护）。
     */
    const ActivityList = (props) => {
      const store = props?.store
      const translate = props?.translate
      const snapshotReader = props?.snapshot
      const now = useNow()
      useStore(store)
      const t = pickTranslate(props)
      const groupBy = props?.view?.groupBy
      const orderBy = props?.view?.orderBy

      /*
       * 活动模式只提供「运行优先 + 日期组」。用户在原生菜单里改了分组或排序，
       * 就退出活动模式并注销本 occupant，让原生列表按新选择即时生效：
       * 不回写、不撤销用户的选择。
       * 基线由 store 持有，所以搜索/rail 导致的临时 unmount 不会把它当新基线重置。
       */
      React.useEffect(() => {
        if (store !== undefined) store.checkGrouping(D.modes({ groupBy, orderBy }))
      }, [groupBy, orderBy, store])

      let snapshot
      if (props?.sessions?.list === undefined && typeof snapshotReader === 'function') {
        snapshot = snapshotReader()
      }
      const model = D.view(props, snapshot, now)
      const title = (group) => {
        if (group.key === 'today') return t('today')
        if (group.key === 'yesterday') return t('yesterday')
        return t('earlier')
      }
      const body = () => {
        if (model.status === 'unavailable') return h('div', { className: 'avNotice' }, t('unavailable'))
        if (model.status === 'loading') return h('div', { className: 'avNotice' }, t('loading'))
        if (model.status === 'empty') return h('div', { className: 'avNotice' }, t('empty'))
        return model.groups.map((group) =>
          h(
            'div',
            { className: 'avGroup', key: group.key },
            // 置顶组不画标题：顶部直接是置顶行，后面紧跟原生 Today/Yesterday/Earlier，
            // 既不加新标题，也不留空标题高度。
            group.header === false ? null : h('div', { className: 'avGroupTitle' }, title(group)),
            group.entries.map((entry) => h(SessionRow, { key: entry.id, entry, host: props, t, now })),
          ),
        )
      }
      // 宿主合同：wide=false 时本槽不挂载；万一被挂上也只渲染空壳，不接管列表。
      if (props?.view?.wide === false) return h('div', { className: 'avRoot', 'data-activity-view': 'narrow' }, styleNode())
      return h(
        'div',
        { className: 'avRoot', 'data-activity-view': 'list', role: 'list' },
        styleNode(),
        body(),
      )
    }

    /**
     * 导航动作行里的开关按钮：自己就是 <button>（不再嵌进原生 button 里），
     * 原生类名全部由宿主通过 props.classes 传入，背景/配色一律不自绘。
     * 标题 span 照原生 PanelRow 的 `clsx(panelTitle, wide)` 同时挂 panelTitle 与 wide，
     * 字形尺寸也沿原生形态（宽 16 / 窄 18）。
     */
    const EntryAction = (props) => {
      const store = props?.store
      const translate = props?.translate
      const state = useStore(store)
      const open = state?.open === true
      const classes = props?.classes ?? {}
      const wide = props?.wide !== false
      const t = pickTranslate(props)
      const label = t('iconLabel')
      const rowClass = [classes.panelRow, open ? classes.panelActive : ''].filter(Boolean).join(' ')
      // 原生：标题 span 用 clsx(panelTitle, wide)；字形尺寸 wide ? 16 : 18。
      const titleClass = [classes.panelTitle, classes.wide].filter(Boolean).join(' ')
      const glyphSize = wide ? 16 : 18
      return h(
        'button',
        {
          type: 'button',
          className: rowClass === '' ? undefined : rowClass,
          'aria-pressed': open ? 'true' : 'false',
          'aria-label': label,
          title: label,
          onClick: () => {
            if (store !== undefined && typeof store.toggle === 'function') store.toggle()
          },
        },
        h(
          'span',
          { className: classes.panelGlyph, 'aria-hidden': 'true' },
          h(
            'svg',
            {
              width: glyphSize,
              height: glyphSize,
              viewBox: '0 0 16 16',
              focusable: 'false',
              'aria-hidden': 'true',
            },
            h('path', {
              d: 'M1.75 8h2.6l1.5-4 2.3 8 1.9-5.5 1.1 1.5h2.85',
              fill: 'none',
              stroke: 'currentColor',
              'stroke-width': 1.5,
              'stroke-linecap': 'round',
              'stroke-linejoin': 'round',
            }),
          ),
        ),
        wide ? h('span', { className: titleClass }, t('panelTitle')) : null,
      )
    }

    const activityExports = {
      __activityData: D,
      __activitySlot: {
        key: SLOT_KEY,
        decide: decideSlot,
        entryKey: ENTRY_KEY,
        entryId: ENTRY_ID,
        entryOrder: ENTRY_ORDER,
        decideEntry,
      },
      /** 声明依赖的宿主服务。 */
      inject: ['slots', 'locale', 'sessions'],
      apply: (ctx) => activityApply(ctx),
    }

    function activityApply(ctx) {
      const slotsService = ctx?.slots ?? (typeof ctx?.get === 'function' ? ctx.get('slots') : undefined)
      const localeService = ctx?.locale ?? (typeof ctx?.get === 'function' ? ctx.get('locale') : undefined)
      const sessionsService = ctx?.sessions ?? (typeof ctx?.get === 'function' ? ctx.get('sessions') : undefined)

      const store = createStore()
      const readSnapshot = createSnapshotReader(sessionsService)

      /*
       * 语言：按原生范式把 {zh,en} 字典注册进宿主 locale 服务（ctx.effect 负责随插件回收），
       * entry.locale=NS 让 SlotOutlet 把绑定后的 t 交给组件；组件侧优先用 props.t。
       * 兜底只在 bind 不可用时用自带英文表，不做任何 language()/getLocale 字段猜测。
       */
      const translate = (key, params) => {
        try {
          const bound = typeof localeService?.bind === 'function' ? localeService.bind(NS) : undefined
          if (typeof bound === 'function') {
            const value = bound(key, params)
            if (typeof value === 'string' && value !== '') return value
          }
        } catch (error) {
          console.error('[activity-view] locale bind failed', error)
        }
        return interpolate(MESSAGES.en[key] ?? key, params)
      }

      try {
        ctx?.effect?.(() => localeService?.register?.(NS, MESSAGES), 'activity-view: dictionaries')
        ctx?.effect?.(() => {
          const off = localeService?.subscribe?.(() => store.bumpLocale())
          return () => {
            if (typeof off === 'function') off()
          }
        }, 'activity-view: locale subscription')
      } catch (error) {
        console.error('[activity-view] locale wiring failed', error)
      }

      if (slotsService === undefined || typeof slotsService.inject !== 'function' || typeof slotsService.register !== 'function') {
        console.warn('[activity-view] slots service lacks inject/register; nothing mounted.')
        return
      }

      /** 当前需要回收的注册（开关关闭、宿主撤销声明、插件销毁都要走这里）。 */
      let disposeList
      let disposeEntry
      const injectedDispose = { list: undefined, entry: undefined }

      const teardown = () => {
        if (disposeList !== undefined) {
          const dispose = disposeList
          disposeList = undefined
          dispose()
        }
        if (disposeEntry !== undefined) {
          const dispose = disposeEntry
          disposeEntry = undefined
          dispose()
        }
      }

      const readSpec = (key) => {
        try {
          return slotsService.spec?.(key)
        } catch (error) {
          console.error(`[activity-view] cannot read slot spec ${key}`, error)
          return undefined
        }
      }

      const registerList = () => {
        const decided = decideSlot(readSpec(SLOT_KEY))
        if (!decided.mounted) {
          if (decided.reason !== 'undeclared') {
            console.warn(`[activity-view] refusing to occupy ${SLOT_KEY}: ${decided.reason}`)
          }
          return undefined
        }
        // 同步 callback → Dispose 合同：inject 的工厂直接返回 register() 的注销函数。
        try {
          return slotsService.register(
            {
              name: SLOT_KEY,
              locale: NS,
              inject: () => ({ store, translate, snapshot: readSnapshot }),
            },
            ActivityList,
          )
        } catch (error) {
          // single 槽同优先级已被占（别的插件/原生 occupant）：不抢位，直接退回原生。
          console.warn(`[activity-view] could not occupy ${SLOT_KEY}`, error)
          return undefined
        }
      }

      /** 开关状态 → 是否占用列表插槽。关闭即注销，SlotOutlet 立刻回落原生列表。 */
      const syncListOccupant = () => {
        const want = store.isOpen()
        if (want && disposeList === undefined) {
          const dispose = registerList()
          if (dispose !== undefined) disposeList = dispose
          else store.setOpen(false)
          return
        }
        if (!want && disposeList !== undefined) {
          const dispose = disposeList
          disposeList = undefined
          dispose()
        }
      }

      /** 入口按钮只有「列表扩展点 + 导航动作行」都声明时才挂，缺一个就不留死按钮。 */
      const entryReady = () =>
        decideSlot(readSpec(SLOT_KEY)).mounted && decideEntry(readSpec(ENTRY_KEY)).mounted

      const registerEntry = () => {
        const decided = decideEntry(readSpec(ENTRY_KEY))
        if (!decided.mounted) {
          if (decided.reason !== 'undeclared') {
            console.warn(`[activity-view] refusing to occupy ${ENTRY_KEY}: ${decided.reason}`)
          }
          return undefined
        }
        try {
          return slotsService.register(
            {
              name: ENTRY_KEY,
              locale: NS,
              id: ENTRY_ID,
              order: ENTRY_ORDER,
              inject: () => ({ store, translate }),
            },
            EntryAction,
          )
        } catch (error) {
          console.warn(`[activity-view] could not occupy ${ENTRY_KEY}`, error)
          return undefined
        }
      }

      const syncEntry = () => {
        if (entryReady() && disposeEntry === undefined) {
          const dispose = registerEntry()
          if (dispose !== undefined) disposeEntry = dispose
          return
        }
        if (!entryReady() && disposeEntry !== undefined) {
          const dispose = disposeEntry
          disposeEntry = undefined
          dispose()
        }
      }

      const offOpen = store.subscribe(syncListOccupant)
      try {
        ctx?.effect?.(() => () => {
          offOpen()
          teardown()
          for (const key of ['list', 'entry']) {
            const dispose = injectedDispose[key]
            injectedDispose[key] = undefined
            if (typeof dispose === 'function') dispose()
          }
        }, 'activity-view: teardown')
      } catch (error) {
        console.error('[activity-view] effect registration failed', error)
      }

      /*
       * 两个插槽各自等宿主声明（老宿主永远不会触发）。到达顺序不固定，任何一边到达
       * 都重新求值：列表扩展点决定 occupant 挂/卸，两个都齐了才追加导航动作行按钮。
       */
      const subscribeKey = (key, onArrive) => {
        try {
          const dispose = slotsService.inject(key, () => {
            onArrive()
            return () => {
              teardown()
            }
          })
          return typeof dispose === 'function' ? dispose : undefined
        } catch (error) {
          console.warn(`[activity-view] slots.inject failed for ${key}`, error)
          return undefined
        }
      }

      const resync = () => {
        syncListOccupant()
        syncEntry()
      }

      injectedDispose.list = subscribeKey(SLOT_KEY, resync)
      injectedDispose.entry = subscribeKey(ENTRY_KEY, resync)

      // 唯一的模式切换入口：外部（宿主新 nav action / 未来的入口 occupant）通过它切 mode。
      activityExports.__activityMode = {
        isOpen: () => store.isOpen(),
        setOpen: (open) => store.setOpen(open === true),
        toggle: () => store.toggle(),
        checkGrouping: (modes) => store.checkGrouping(modes),
        subscribe: (listener) => store.subscribe(listener),
        getSnapshot: () => store.getSnapshot(),
        entryKey: ENTRY_KEY,
        entryId: ENTRY_ID,
        entryOrder: ENTRY_ORDER,
      }
    }

    return activityExports
  },
})
