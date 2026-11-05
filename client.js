/**
 * Client half of the activity-view bundle.
 *
 * Adds one icon to the sidebar panel list. Clicking that icon swaps the sidebar's session
 * browsing region (`sidebar.workspaces`) for an activity list: every session sorted by recency,
 * grouped Today / Yesterday / Earlier, each row showing the workspace name it belongs to
 * (Codex style). Clicking the icon again disposes the replacement so the shipped region returns.
 * Data comes from `sessions.search`; rows open through `uiWorkspace.openSession`.
 */
window.__ModuleLoader__.load({
  id: '@local/activity-view',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const NS = 'activityView'
    const PANEL_KEY = 'activity-view'
    const POLL_MS = 5000
    const MAX_ROWS = 25

    const MESSAGES = {
      en: {
        panelTitle: 'Recently active sessions',
        iconLabel: 'Activity view',
        refresh: 'Refresh',
        loading: 'Loading recent sessions\u2026',
        empty: 'No recent activity yet.',
        failed: 'Could not load recent sessions.',
        unavailable: 'This build exposes no session search.',
        now: 'just now',
        minutesAgo: '{n}m ago',
        hoursAgo: '{n}h ago',
        daysAgo: '{n}d ago',
        today: 'Today',
        yesterday: 'Yesterday',
        earlier: 'Earlier',
        newSession: 'New session',
      },
      zh: {
        panelTitle: '\u6700\u8fd1\u6d3b\u52a8\u7684\u4f1a\u8bdd',
        iconLabel: '\u6d3b\u52a8\u89c6\u56fe',
        refresh: '\u5237\u65b0',
        loading: '\u6b63\u5728\u52a0\u8f7d\u6700\u8fd1\u4f1a\u8bdd\u2026',
        empty: '\u6682\u65e0\u6700\u8fd1\u6d3b\u52a8\u3002',
        failed: '\u65e0\u6cd5\u52a0\u8f7d\u6700\u8fd1\u4f1a\u8bdd\u3002',
        unavailable: '\u5f53\u524d\u7248\u672c\u6ca1\u6709\u63d0\u4f9b\u4f1a\u8bdd\u641c\u7d22\u63a5\u53e3\u3002',
        now: '\u521a\u521a',
        minutesAgo: '{n} \u5206\u949f\u524d',
        hoursAgo: '{n} \u5c0f\u65f6\u524d',
        daysAgo: '{n} \u5929\u524d',
        today: '\u4eca\u5929',
        yesterday: '\u6628\u5929',
        earlier: '\u66f4\u65e9',
        newSession: '\u65b0\u4f1a\u8bdd',
      },
    }

    const STYLE = `
button.dshActivityIcon {
  pointer-events: auto !important;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border-radius: 8px;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
  transition: background-color 120ms ease, color 120ms ease;
}
button.dshActivityIcon:hover {
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-primary);
}
button.dshActivityIcon:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary);
  outline-offset: 1px;
}
.dshActivityHost {
  position: relative !important;
  overflow: hidden !important;
}
.dshActivityHost > *:not(.dshActivityMount) {
  visibility: hidden !important;
}
.dshActivityMount {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  color: inherit;
  font: inherit;
}
.dshActivityMountBody {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
}
.dshActivityPanel {
  display: flex;
  flex-direction: column;
  gap: 14px;
  box-sizing: border-box;
  padding: 20px 24px 28px;
  color: var(--dsw-alias-label-primary);
  font-size: 13px;
}
.dshActivityHeader {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.dshActivityTitle {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  letter-spacing: 0.01em;
}
.dshActivityRefresh {
  padding: 4px 10px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 7px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  cursor: pointer;
}
.dshActivityRefresh:hover {
  border-color: var(--dsw-alias-border-l2);
  color: var(--dsw-alias-label-primary);
}
.dshActivityBody {
  overflow: auto;
}
.dshActivityList {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.dshActivityRow {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  width: 100%;
  box-sizing: border-box;
  padding: 9px 12px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.dshActivityRow:hover {
  background: var(--dsw-alias-bg-layer-2);
}
.dshActivityDot {
  flex: none;
  width: 6px;
  height: 6px;
  margin-top: 6px;
  border-radius: 50%;
  background: var(--dsw-alias-state-idle-primary);
}
.dshActivityText {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.dshActivityRowTitle {
  font-size: 13px;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.dshActivityMeta {
  font-size: 11px;
  color: var(--dsw-alias-label-secondary);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.dshActivityMessage {
  padding: 10px 12px;
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
}
.dshActivityDiagnostic {
  padding: 0 12px 4px;
  color: var(--dsw-alias-label-secondary);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 10px;
  opacity: 0.75;
  overflow-wrap: anywhere;
}
.dshActivityIconActive {
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-primary);
}
.dshActivityView {
  display: flex !important;
  flex-direction: column !important;
  gap: 10px;
  box-sizing: border-box;
  height: 100%;
  padding: 12px 10px 16px;
  overflow-y: auto;
  overflow-x: hidden;
  color: var(--dsw-alias-label-primary);
  font-size: 13px;
}

.dshActivityGroupTitle {
  padding: 8px 6px 2px !important;
  color: var(--dsw-alias-label-secondary) !important;
  font-size: 11px !important;
  font-weight: 500 !important;
  letter-spacing: 0.02em;
  background: transparent !important;
  border: 0 !important;
}
.dshActivityGroupList {
  display: flex !important;
  flex-direction: column !important;
  gap: 1px !important;
}
.dshActivityView button.dshActivityWsRow {
  display: flex !important;
  align-items: center !important;
  gap: 7px !important;
  width: 100% !important;
  box-sizing: border-box !important;
  padding: 7px 8px !important;
  border: 0 !important;
  border-radius: 8px !important;
  background: transparent !important;
  color: inherit !important;
  font: inherit !important;
  font-size: 13px !important;
  text-align: left !important;
  cursor: pointer !important;
  line-height: 1.35 !important;
}
.dshActivityView button.dshActivityWsRow:hover {
  background: var(--dsw-alias-bg-layer-2) !important;
}
.dshActivityWsTitle {
  flex: 1 1 auto !important;
  min-width: 0 !important;
  overflow: hidden !important;
  white-space: nowrap !important;
  text-overflow: ellipsis !important;
  font-weight: 400 !important;
}
.dshActivityWsName {
  flex: none !important;
  max-width: 45%;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  color: var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary)) !important;
  font-size: 11px !important;
}
.dshActivityTime {
  flex: none !important;
  margin-left: auto !important;
  color: var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary)) !important;
  font-size: 11px !important;
}
.dshActivityDot {
  flex: none !important;
  width: 7px !important;
  height: 7px !important;
  border-radius: 50% !important;
  border: 1px solid var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary)) !important;
  background: transparent !important;
  padding: 0 !important;
}
.dshActivitySpin {
  flex: none !important;
  width: 12px !important;
  height: 12px !important;
  border-radius: 50% !important;
  border: 2px solid var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary)) !important;
  border-top-color: transparent !important;
  background: transparent !important;
  padding: 0 !important;
  animation: dshActivitySpin 0.8s linear infinite !important;
}
@keyframes dshActivitySpin {
  to { transform: rotate(360deg); }
}
`

    const activityExports = {
      inject: ['slots', 'locale', 'timer', 'sessions', 'layout', 'uiWorkspace'],
      apply(ctx) {
        try {
          activityApply(ctx)
        } catch (error) {
          console.error('[activity-view] apply failed', error)
        }
      },
    }
    function activityApply(ctx) {
        const localeService = ctx.locale ?? ctx.get?.('locale')
        const timerService = ctx.timer ?? ctx.get?.('timer')
        const sessionsService = ctx.sessions ?? ctx.get?.('sessions')
        const layoutService = ctx.layout ?? ctx.get?.('layout')
        const workspaceService = ctx.uiWorkspace ?? ctx.get?.('uiWorkspace')

        const bound = (() => {
          try {
            return localeService?.bind?.(NS)
          } catch (error) {
            console.error('[activity-view] locale bind failed', error)
            return undefined
          }
        })()

        const readLanguage = () => {
          try {
            const snapshot = localeService?.getLocale?.() ?? localeService?.getSnapshot?.()
            return String(snapshot?.locale ?? snapshot?.id ?? snapshot?.language ?? '')
          } catch {
            return ''
          }
        }

        const translate = (key, values) => {
          let text
          try {
            text = bound?.(key)
          } catch {
            text = undefined
          }
          if (typeof text !== 'string' || text === '' || text === key || text === `${NS}.${key}`) {
            const table = readLanguage().toLowerCase().startsWith('zh') ? MESSAGES.zh : MESSAGES.en
            text = table[key] ?? MESSAGES.en[key] ?? key
          }
          if (values === undefined) return text
          return text.replace(/\{(\w+)\}/g, (match, name) => (name in values ? String(values[name]) : match))
        }

        /** Relative time for the row meta; falls back to nothing when the value is unusable. */
        const formatWhen = (value) => {
          if (value === undefined || value === null) return ''
          const when = typeof value === 'number' ? value : Date.parse(String(value))
          if (!Number.isFinite(when)) return ''
          const delta = Date.now() - when
          if (delta < 60_000) return translate('now')
          const minutes = Math.floor(delta / 60_000)
          if (minutes < 60) return translate('minutesAgo', { n: minutes })
          const hours = Math.floor(minutes / 60)
          if (hours < 24) return translate('hoursAgo', { n: hours })
          return translate('daysAgo', { n: Math.floor(hours / 24) })
        }

        const store = {
          snapshot: { status: 'idle', items: [], diagnostic: '' },
          listeners: new Set(),
          publish(next) {
            store.snapshot = next
            for (const listener of store.listeners) {
              try {
                listener(next)
              } catch (error) {
                console.error('[activity-view] listener failed', error)
              }
            }
          },
          subscribe(listener) {
            store.listeners.add(listener)
            return () => {
              store.listeners.delete(listener)
            }
          },
        }

        let inFlight

        const load = () => {
          if (sessionsService === undefined || sessionsService.list === undefined || typeof sessionsService.list.getSnapshot !== 'function') {
            store.publish({ status: 'unavailable', items: [], diagnostic: '' })
            return
          }
          try {
            const state = sessionsService.list.getSnapshot()
            const ids = Array.isArray(state?.ids) ? state.ids : []
            const byId = state?.byId ?? {}
            const projections = state?.projectionsBySession ?? {}
            // Entries handed to us through `byId` are the host's projected *display* objects and
            // may drop lineage fields, while the store's own `items` array keeps them. Index that
            // array so child sessions are still recognisable in that case.
            const lineage = new Map()
            for (const item of Array.isArray(state?.items) ? state.items : []) {
              if (item === null || typeof item !== 'object') continue
              const key = typeof item.sessionId === 'string' ? item.sessionId : (typeof item.id === 'string' ? item.id : '')
              if (key !== '') lineage.set(key, item)
            }
            const parentOf = (source) => {
              for (const key of ['parentSessionId', 'parentSession', 'parentId', 'parent']) {
                const value = source?.[key]
                if (typeof value === 'string' && value !== '') return value
              }
              return ''
            }
            // Only top-level sessions belong in an activity list: subagent runs and forked child
            // sessions reuse their parent's title, so listing them looks like one conversation
            // repeated several times. Field names differ across host versions, so probe every
            // known spelling and fail open when nothing is present.
            const isChildSession = (raw) => {
              const source = lineage.get(typeof raw.id === 'string' ? raw.id : raw.sessionId) ?? {}
              for (const candidate of [raw, source]) {
                if (candidate.origin === 'subagent') return true
                if (parentOf(candidate) !== '') return true
                for (const key of ['depth', 'delegationDepth']) {
                  const value = candidate[key]
                  if (typeof value === 'number' && value > 0) return true
                }
              }
              return false
            }
            // Final safety net that needs no lineage at all: collapse rows displaying the same
            // title inside the same workspace, preferring a running entry. Rows whose title is
            // only a placeholder (workspace name or id stub) never merge.
            const foldDuplicates = (entries) => {
              const chosen = new Map()
              const order = []
              for (const entry of entries) {
                const flat = entry.title.replace(/\s+/g, '')
                const placeholder = flat === '' || flat === entry.workspace || entry.title === entry.id.slice(0, 8)
                // Compare a prefix, not the whole title: sibling sessions start from the same
                // prompt and only diverge far past where the sidebar truncates them.
                const key = placeholder
                  ? ` ${entry.id}`
                  : `${flat.slice(0, 12)} ${entry.workspace}`
                const previous = chosen.get(key)
                if (previous === undefined) {
                  chosen.set(key, entry)
                  order.push(key)
                } else if (previous.running !== true && entry.running === true) {
                  chosen.set(key, entry)
                }
              }
              return order.map((key) => chosen.get(key))
            }

            // 同一会话可能同时以 `session-<uuid>` 与裸 `<uuid>` 两种写法进入列表（子代理目录用的是裸 uuid），
            // 所以先归一化这个前缀再去重，否则同一会话会被当成两条。
            const normalizeId = (id) => id.replace(/^session-/, '')
            const seenIds = new Set()
            const collected = ids
              .filter((id) => {
                if (typeof id !== 'string' || id === '') return false
                const key = normalizeId(id)
                if (seenIds.has(key)) return false
                seenIds.add(key)
                return true
              })
              .map((id) => byId[id])
              .filter(Boolean)
              .filter((raw) => !isChildSession(raw))
              .map((raw) => {
                // The list store entry is the host's projected display object, NOT a SessionSummary:
                // { id, displayTitle, title?, projectionValues?, cwd, blank, updatedAt, running, ... }.
                // `title`/`projectionValues` are only attached when a real projected title exists;
                // `displayTitle` is the host's own display derivation (title, else cwd basename).
                const id = typeof raw.id === 'string' ? raw.id : (typeof raw.sessionId === 'string' ? raw.sessionId : '')
                if (id === '') return undefined
                const pick = (value) => (typeof value === 'string' && value.trim() !== '' ? value.trim() : '')
                const values = raw.projectionValues ?? projections[id]?.values ?? {}
                const realTitle = pick(raw.title) || pick(values.title)
                const display = pick(raw.displayTitle)
                const cwd = typeof raw.cwd === 'string' ? raw.cwd : (typeof values.workingDirectory === 'string' ? values.workingDirectory : '')
                const workspace = cwd === '' ? '' : (cwd.split('/').filter(Boolean).pop() ?? '')
                const title = realTitle || display || workspace || id.slice(0, 8)
                return {
                  id,
                  title,
                  workspace,
                  hasHint: realTitle !== '',
                  blank: raw.blank === true,
                  time: typeof raw.updatedAt === 'number' ? raw.updatedAt : undefined,
                  running: raw.running === true,
                }
              })
              .filter(Boolean)
              .filter((entry) => entry.id !== '')
            const items = foldDuplicates(collected).slice(0, MAX_ROWS)
            store.publish({ status: 'ready', items, diagnostic: '' })
          } catch (error) {
            console.error('[activity-view] session list failed', error)
            store.publish({ status: 'error', items: store.snapshot.items, diagnostic: store.snapshot.diagnostic })
          }
        }

        const openSession = (sessionId) => {
          if (workspaceService === undefined || typeof workspaceService.openSession !== 'function') {
            return
          }
          try {
            workspaceService.openSession(sessionId)
          } catch (error) {
            console.error('[activity-view] open session failed', error)
          }
        }

        /**
         * 侧栏活动视图（覆盖式）。
         *
         * `sidebar.workspaces` 由 shell 的 sidebar 条目声明——catalog 里写得很清楚：「declaring is
         * claiming」。插件在 apply 期或运行期的 register 都只会留下一个 active:false 的占用者，
         * 原生浏览器照旧渲染，界面没有任何变化。所以这里不再和插槽较劲，改为在原生会话列表上方
         * 铺一块自己的面板：点侧栏图标开，再点关，关掉即原样露出原生列表。
         */
        let overlayOpen = false
        let overlayEl = null
        /** 挂进原生列表的容器与挂载点；与浮层互斥。 */
        let hostEl = null
        let mountEl = null
        /** 打开时算一次区域，之后只复用；重新测量会和外层视口互相影响，导致面板越缩越小。 */
        let pinnedRegion = null
        const modeListeners = new Set()
        const publishMode = (next) => {
          overlayOpen = next
          for (const listener of modeListeners) {
            try {
              listener(next)
            } catch (error) {
              console.error('[activity-view] mode listener failed', error)
            }
          }
        }
        const useMode = () => {
          const [, setTick] = React.useState(0)
          React.useEffect(() => {
            const listener = () => setTick((tick) => tick + 1)
            modeListeners.add(listener)
            return () => {
              modeListeners.delete(listener)
            }
          }, [])
          return overlayOpen
        }

        /** Recency order with running sessions pinned on top. */
        const sortEntries = (entries) =>
          entries.slice().sort((left, right) => {
            const a = typeof left.time === 'number' ? left.time : Date.parse(left.time) || 0
            const b = typeof right.time === 'number' ? right.time : Date.parse(right.time) || 0
            const ra = left.running === true ? 1 : 0
            const rb = right.running === true ? 1 : 0
            if (ra !== rb) return rb - ra
            return b - a
          })

        /** Today / Yesterday / Earlier bucket for one timestamp. */
        const dayLabel = (time) => {
          const when = typeof time === 'number' ? time : Date.parse(String(time ?? ''))
          const startOfToday = new Date()
          startOfToday.setHours(0, 0, 0, 0)
          const todayStart = startOfToday.getTime()
          if (!Number.isFinite(when)) return translate('earlier')
          if (when >= todayStart) return translate('today')
          if (when >= todayStart - 86400000) return translate('yesterday')
          return translate('earlier')
        }

        /**
         * 找原生「会话列表」那片区域。
         *
         * 不猜固定像素：候选 = 位于左栏的容器（宽度/高度像列表），先按**已知会话标题**命中的
         * 数量分组，命中多的组里取面积最小的那个；没有标题可用时退到「可滚动的左栏容器里
         * 面积最小」这一个结构特征。两者都失败才用一个只占左栏的小面板兜底。
         */
        const findRegion = () => {
          const viewportWidth = typeof window === 'undefined' ? 1024 : window.innerWidth
          const viewportHeight = typeof window === 'undefined' ? 768 : window.innerHeight
          const background = (element) => {
            let cursor = element
            for (let up = 0; up < 6 && cursor !== null; up += 1) {
              const colour = window.getComputedStyle(cursor).backgroundColor
              if (colour !== '' && colour !== 'transparent' && colour !== 'rgba(0, 0, 0, 0)') return colour
              cursor = cursor.parentElement
            }
            return ''
          }
          try {
            const titles = (Array.isArray(store.snapshot.items) ? store.snapshot.items : [])
              .map((entry) => (typeof entry.title === 'string' ? entry.title.trim() : ''))
              .filter((title) => title.length >= 3)
              .slice(0, 12)
            const leftColumnLimit = Math.min(720, Math.max(420, viewportWidth * 0.45))
            const candidates = []
            for (const element of document.querySelectorAll('*')) {
              if (element === overlayEl || (overlayEl !== null && element.contains(overlayEl))) continue
              const rect = element.getBoundingClientRect()
              if (rect.width < 150 || rect.width > 640) continue
              if (rect.height < 180) continue
              if (rect.left < 0 || rect.left > leftColumnLimit) continue
              const text = element.textContent || ''
              let hits = 0
              for (const title of titles) {
                if (text.includes(title)) hits += 1
              }
              const style = window.getComputedStyle(element)
              const scrollable =
                /auto|scroll/.test(style.overflowY) || element.scrollHeight > element.clientHeight + 8
              candidates.push({ hits, scrollable, area: rect.width * rect.height, element, rect })
            }
            const choose = (pool) => {
              let best = null
              for (const candidate of pool) {
                if (best === null || candidate.area < best.area) best = candidate
              }
              return best
            }
            let chosen = null
            if (candidates.length > 0) {
              let topHits = 0
              for (const candidate of candidates) {
                if (candidate.hits > topHits) topHits = candidate.hits
              }
              if (topHits > 0) {
                chosen = choose(candidates.filter((candidate) => candidate.hits === topHits))
              }
              if (chosen === null) {
                const scrolling = candidates.filter((candidate) => candidate.scrollable)
                chosen = choose(scrolling.length > 0 ? scrolling : candidates)
              }
            }
            if (chosen !== null) {
              let element = chosen.element
              for (let up = 0; up < 4; up += 1) {
                const parent = element.parentElement
                if (parent === null) break
                const parentRect = parent.getBoundingClientRect()
                if (Math.abs(parentRect.height - chosen.rect.height) > 6) break
                if (parentRect.width > 560) break
                if (parentRect.width - chosen.rect.width > 56) break
                element = parent
                chosen = { ...chosen, element, rect: parentRect, area: parentRect.width * parentRect.height }
              }
              return {
                left: chosen.rect.left,
                top: chosen.rect.top,
                width: chosen.rect.width,
                height: chosen.rect.height,
                background: background(chosen.element),
              }
            }
          } catch (error) {
            console.error('[activity-view] locate sidebar list failed', error)
          }
          // 兜底：左侧栏里一块带内边距的小面板，绝不覆盖整屏。
          const left = Math.min(120, Math.round(viewportWidth * 0.05) + 56)
          return {
            left,
            top: 72,
            width: Math.min(300, Math.max(220, viewportWidth - left - 24)),
            height: Math.min(520, Math.max(240, viewportHeight - 160)),
            background: '',
          }
        }

        const sessionTitles = () =>
          (Array.isArray(store.snapshot.items) ? store.snapshot.items : [])
            .map((entry) => (typeof entry.title === 'string' ? entry.title.trim() : ''))
            .filter((title) => title.length >= 3)
            .slice(0, 12)

        const headerLabels = () => {
          const labels = [translate('newSession'), MESSAGES.en.newSession, MESSAGES.zh.newSession]
          return labels.filter((label) => typeof label === 'string' && label !== '')
        }

        /**
         * 找**原生会话列表容器本身**，然后把面板挂进它内部。
         *
         * 之前是量一个矩形、把独立浮层摆上去，于是必然差一两个像素，还带自己的底色。
         * 改成挂进容器：四边由容器的 padding box 决定，字体/颜色/底色全部继承侧栏，
         * 宽度跟着侧栏走，不存在对不齐或"独立白框"的可能。
         */
        const findListHost = () => {
          try {
            const titles = sessionTitles()
            if (titles.length === 0) return null
            const viewportWidth = window.innerWidth
            const viewportHeight = window.innerHeight
            const headers = headerLabels()
            const leftLimit = Math.min(720, Math.max(420, viewportWidth * 0.45))
            let best = null
            for (const element of document.querySelectorAll('*')) {
              if (overlayEl !== null && (element === overlayEl || element.contains(overlayEl))) continue
              if (element.classList.contains('dshActivityMount')) continue
              const rect = element.getBoundingClientRect()
              if (rect.width < 150 || rect.width > 640) continue
              if (rect.height < 140 || rect.height > viewportHeight * 0.95) continue
              if (rect.left < 0 || rect.left > leftLimit) continue
              const text = element.textContent || ''
              let hits = 0
              for (const title of titles) {
                if (text.includes(title)) hits += 1
              }
              if (hits === 0) continue
              let hasHeader = false
              for (const label of headers) {
                if (text.includes(label)) {
                  hasHeader = true
                  break
                }
              }
              // 带「新会话 / 工作区」标题的容器是整列，盖上去会把头部也吃掉，跳过
              if (hasHeader) continue
              const style = window.getComputedStyle(element)
              const scrollable = /auto|scroll/.test(style.overflowY) || element.scrollHeight > element.clientHeight + 8
              // 安全阀：只有"可滚动的列表"或"至少命中两个会话标题"的容器才允许被接管，
              // 免得误藏别的区域。
              if (!scrollable && hits < Math.min(2, titles.length)) continue
              const score = hits * 10 + (scrollable ? 6 : 0) - (rect.height > viewportHeight * 0.8 ? 4 : 0)
              if (best === null || score > best.score) best = { element, score }
            }
            return best === null ? null : best.element
          } catch (error) {
            console.error('[activity-view] locate session list failed', error)
            return null
          }
        }

        const detachMount = () => {
          if (mountEl !== null) {
            mountEl.remove()
            mountEl = null
          }
          if (hostEl !== null) {
            hostEl.classList.remove('dshActivityHost')
            hostEl = null
          }
        }

        const renderInPlace = () => {
          const state = store.snapshot
          const hostStyle = window.getComputedStyle(hostEl)
          const fontSize = Number.parseFloat(hostStyle.fontSize) || 13
          const rowHeight = Math.max(24, Math.min(36, Math.round(fontSize * 2.2)))
          const sidePadding = Math.max(4, Math.min(14, Math.round(Number.parseFloat(hostStyle.paddingLeft) || 8)))

          mountEl.textContent = ''
          const body = document.createElement('div')
          body.className = 'dshActivityMountBody'
          body.style.padding = `4px ${sidePadding}px 10px`
          mountEl.appendChild(body)

          const message = (text) => {
            const node = document.createElement('div')
            node.textContent = text
            node.style.cssText = `padding:10px ${sidePadding}px;opacity:.75;`
            return node
          }

          const items = sortEntries(Array.isArray(state.items) ? state.items : [])
          if (state.status === 'unavailable') {
            body.appendChild(message(translate('unavailable')))
            return
          }
          if (items.length === 0) {
            const key = state.status === 'error' ? 'failed' : state.status === 'ready' ? 'empty' : 'loading'
            body.appendChild(message(translate(key)))
            return
          }

          const groups = []
          for (const entry of items) {
            const label = dayLabel(entry.time)
            let group = groups.find((candidate) => candidate.label === label)
            if (group === undefined) {
              group = { label, items: [] }
              groups.push(group)
            }
            group.items.push(entry)
          }

          for (const group of groups) {
            const heading = document.createElement('div')
            heading.textContent = group.label
            heading.style.cssText =
              `padding:8px ${sidePadding}px 2px;font-size:.78em;font-weight:500;opacity:.6;`
            body.appendChild(heading)

            for (const entry of group.items) {
              const row = document.createElement('button')
              row.type = 'button'
              row.setAttribute('data-av-session', entry.id)
              row.title = entry.title
              row.style.cssText =
                `display:flex;align-items:center;gap:6px;width:100%;box-sizing:border-box;height:${rowHeight}px;padding:0 6px;margin:0;border:0;border-radius:6px;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer;`
              row.addEventListener('mouseenter', () => {
                row.style.background = 'var(--dsw-alias-bg-layer-2, rgba(127,127,127,.14))'
              })
              row.addEventListener('mouseleave', () => {
                row.style.background = 'transparent'
              })

              const dot = document.createElement('span')
              dot.style.cssText = `flex:none;width:6px;height:6px;border-radius:50%;background:${
                entry.running === true ? 'var(--dsw-alias-brand-primary, #4f6bf5)' : 'transparent'
              };`
              row.appendChild(dot)

              const title = document.createElement('span')
              title.textContent = entry.title
              title.style.cssText = 'flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;'
              row.appendChild(title)

              const when = document.createElement('span')
              when.textContent = formatWhen(entry.time)
              when.style.cssText = 'flex:none;font-size:.82em;opacity:.55;'
              row.appendChild(when)

              body.appendChild(row)
            }
          }
        }

        const paintOverlay = (host) => {
          const state = store.snapshot
          if (pinnedRegion === null) pinnedRegion = findRegion()
          const region = pinnedRegion
          const viewportWidth = typeof window === 'undefined' ? 1024 : window.innerWidth
          const viewportHeight = typeof window === 'undefined' ? 768 : window.innerHeight
          const width = Math.max(220, Math.min(Math.round(region.width) || 0, Math.max(240, viewportWidth - 32)))
          const height = Math.max(160, Math.min(Math.round(region.height) || 0, Math.max(200, viewportHeight - 32)))
          const left = Math.max(0, Math.min(Math.round(region.left) || 0, viewportWidth - width - 8))
          const top = Math.max(0, Math.min(Math.round(region.top) || 0, viewportHeight - height - 8))
          host.style.left = `${left}px`
          host.style.top = `${top}px`
          host.style.width = `${width}px`
          host.style.height = `${height}px`
          host.style.background =
            'var(--dsw-specific-sidebar-fill, var(--dsw-alias-bg-layer-1, Canvas))'
          host.textContent = ''

          const body = document.createElement('div')
          body.style.cssText =
            'flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;padding:4px 6px 12px;font:inherit;'
          host.appendChild(body)

          const message = (text) => {
            const node = document.createElement('div')
            node.textContent = text
            node.style.cssText =
              'padding:14px 8px;font-size:12.5px;line-height:1.5;color:var(--dsw-alias-label-secondary, inherit);'
            return node
          }

          const items = sortEntries(Array.isArray(state.items) ? state.items : [])
          if (state.status === 'unavailable') {
            body.appendChild(message(translate('unavailable')))
            return
          }
          if (items.length === 0) {
            const key = state.status === 'error' ? 'failed' : state.status === 'ready' ? 'empty' : 'loading'
            body.appendChild(message(translate(key)))
            return
          }

          const groups = []
          for (const entry of items) {
            const label = dayLabel(entry.time)
            let group = groups.find((candidate) => candidate.label === label)
            if (group === undefined) {
              group = { label, items: [] }
              groups.push(group)
            }
            group.items.push(entry)
          }

          for (const group of groups) {
            const heading = document.createElement('div')
            heading.textContent = group.label
            heading.style.cssText =
              'padding:10px 6px 4px;font-size:11px;font-weight:500;letter-spacing:.02em;color:var(--dsw-alias-label-secondary, inherit);opacity:.8;'
            body.appendChild(heading)

            for (const entry of group.items) {
              const row = document.createElement('button')
              row.type = 'button'
              row.setAttribute('data-av-session', entry.id)
              row.title = entry.title
              row.style.cssText =
                'display:flex;align-items:center;gap:8px;width:100%;box-sizing:border-box;height:30px;padding:0 8px;margin:0;border:0;border-radius:6px;background:transparent;color:inherit;font:inherit;font-size:13px;text-align:left;cursor:pointer;'
              row.addEventListener('mouseenter', () => {
                row.style.background = 'var(--dsw-alias-bg-layer-2, rgba(127, 127, 127, 0.12))'
              })
              row.addEventListener('mouseleave', () => {
                row.style.background = 'transparent'
              })

              const dot = document.createElement('span')
              dot.style.cssText = `flex:none;width:6px;height:6px;border-radius:50%;background:${
                entry.running === true ? 'var(--dsw-alias-brand-primary, #4f6bf5)' : 'transparent'
              };`
              row.appendChild(dot)

              const text = document.createElement('span')
              text.style.cssText = 'flex:1;min-width:0;display:flex;flex-direction:column;gap:1px;'
              const title = document.createElement('span')
              title.textContent = entry.title
              title.style.cssText =
                'font-size:13px;line-height:1.35;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;'
              text.appendChild(title)
              if (entry.workspace !== '') {
                const workspace = document.createElement('span')
                workspace.textContent = entry.workspace
                workspace.style.cssText =
                  'font-size:11px;line-height:1.3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--dsw-alias-label-secondary, inherit);opacity:.85;'
                text.appendChild(workspace)
              }
              row.appendChild(text)

              const when = document.createElement('span')
              when.textContent = formatWhen(entry.time)
              when.style.cssText =
                'flex:none;font-size:11px;color:var(--dsw-alias-label-secondary, inherit);opacity:.7;'
              row.appendChild(when)

              body.appendChild(row)
            }
          }
        }

        /** 可见的失败提示：宁可打扰一次，也不要静默什么都不发生。 */
        const toastFailure = (error) => {
          try {
            const box = document.createElement('div')
            box.textContent = `[activity-view] ${error instanceof Error ? error.message : String(error)}`
            box.style.cssText = [
              'position:fixed',
              'left:12px',
              'bottom:12px',
              'z-index:2147483647',
              'max-width:70vw',
              'padding:8px 10px',
              'border-radius:8px',
              'background:#7f1d1d',
              'color:#fff',
              'font:12px/1.4 ui-sans-serif,system-ui,sans-serif',
              'white-space:pre-wrap',
              'box-shadow:0 8px 24px rgba(0,0,0,.3)',
            ].join(';')
            document.documentElement.appendChild(box)
            window.setTimeout(() => box.remove(), 12000)
          } catch {
            // 连提示都放不进去时只能留在控制台
          }
        }

        const teardown = () => {
          pinnedRegion = null
          detachMount()
          if (overlayEl !== null) {
            overlayEl.remove()
            overlayEl = null
          }
        }

        const syncOverlay = () => {
          if (typeof document === 'undefined') return
          try {
            paintSync()
            document.documentElement.setAttribute('data-activity-view', overlayOpen ? 'open' : 'closed')
          } catch (error) {
            console.error('[activity-view] overlay failed', error)
            toastFailure(error)
          }
        }

        const paintSync = () => {
          if (!overlayOpen) {
            teardown()
            return
          }

          if (hostEl !== null && !hostEl.isConnected) detachMount()
          if (hostEl === null) hostEl = findListHost()

          // 找不到原生列表时退回到独立浮层，至少不会什么都不显示。
          if (hostEl === null) {
            detachMount()
            if (overlayEl === null) {
              const host = document.createElement('div')
              host.className = 'dshActivityOverlay'
              host.setAttribute('role', 'region')
              host.setAttribute('aria-label', translate('iconLabel'))
              host.style.cssText = [
                'position:fixed',
                'z-index:2147483000',
                'display:flex',
                'flex-direction:column',
                'min-height:0',
                'border-radius:0',
                'border:0',
                'box-shadow:none',
              ].join(';')
              host.addEventListener(
                'mousedown',
                (event) => {
                  const target = event.target instanceof Element ? event.target : null
                  const row = target !== null ? target.closest('[data-av-session]') : null
                  if (row === null) return
                  event.preventDefault()
                  event.stopPropagation()
                  openSession(row.getAttribute('data-av-session') || '')
                },
                true,
              )
              overlayEl = host
              document.documentElement.appendChild(host)
            }
            paintOverlay(overlayEl)
            return
          }

          if (overlayEl !== null) {
            overlayEl.remove()
            overlayEl = null
          }
          if (hostEl.classList.contains('dshActivityHost') === false) {
            hostEl.classList.add('dshActivityHost')
          }
          if (mountEl === null || mountEl.parentElement !== hostEl) {
            if (mountEl !== null) mountEl.remove()
            mountEl = document.createElement('div')
            mountEl.className = 'dshActivityMount'
            mountEl.setAttribute('role', 'region')
            mountEl.setAttribute('aria-label', translate('iconLabel'))
            mountEl.addEventListener(
              'mousedown',
              (event) => {
                const target = event.target instanceof Element ? event.target : null
                const row = target !== null ? target.closest('[data-av-session]') : null
                if (row === null) return
                event.preventDefault()
                event.stopPropagation()
                openSession(row.getAttribute('data-av-session') || '')
              },
              true,
            )
            hostEl.appendChild(mountEl)
          }
          renderInPlace()
        }

        const setOverlayOpen = (next) => {
          publishMode(next === true)
          syncOverlay()
        }

        const toggleActivityView = () => {
          setOverlayOpen(!overlayOpen)
        }

        const useLocaleTick = () => {
          const [, setTick] = React.useState(0)
          React.useEffect(() => {
            let dispose
            try {
              dispose = localeService?.subscribe?.(() => setTick((tick) => tick + 1))
            } catch {
              dispose = undefined
            }
            return typeof dispose === 'function' ? dispose : undefined
          }, [])
        }

        const useSnapshot = () => {
          const [snapshot, setSnapshot] = React.useState(store.snapshot)
          React.useEffect(() => {
            setSnapshot(store.snapshot)
            return store.subscribe(setSnapshot)
          }, [])
          return snapshot
        }

        const ActivityIcon = (props) => {
          useLocaleTick()
          const active = useMode()
          const snapshot = useSnapshot()
          const busy = Array.isArray(snapshot.items) && snapshot.items.some((entry) => entry.running === true)
          const label = translate('iconLabel')
          const edge =
            props !== null && typeof props === 'object' && typeof props.size === 'number' ? props.size : 16
          return h(
            'span',
            {
              className: active ? 'dshActivityIcon dshActivityIconActive' : 'dshActivityIcon',
              role: 'button',
              tabIndex: 0,
              'aria-label': label,
              'aria-pressed': active ? 'true' : 'false',
              title: label,
              style: {
                pointerEvents: 'auto',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                lineHeight: 0,
                color: active
                  ? 'var(--dsw-alias-label-primary, #1a1a1a)'
                  : 'var(--dsw-alias-label-secondary, #666)',
              },
              onClick: () => toggleActivityView(),
              onKeyDown: (event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  toggleActivityView()
                }
              },
            },
            h(
              'svg',
              { viewBox: '0 0 24 24', width: edge, height: edge, fill: 'none', 'aria-hidden': 'true', style: { display: 'block' } },
              h('circle', { cx: 12, cy: 12, r: 8.25, stroke: 'currentColor', strokeWidth: 1.6 }),
              h(
                'g',
                null,
                busy
                  ? h('animateTransform', {
                      attributeName: 'transform',
                      attributeType: 'XML',
                      type: 'rotate',
                      from: '0 12 12',
                      to: '360 12 12',
                      dur: '1.6s',
                      repeatCount: 'indefinite',
                    })
                  : null,
                h('path', {
                  d: 'M12 7.6V12.1L15 13.9',
                  stroke: 'currentColor',
                  strokeWidth: 1.6,
                  strokeLinecap: 'round',
                  strokeLinejoin: 'round',
                }),
              ),
              h('circle', { cx: 17.6, cy: 7.2, r: 2.4, fill: 'currentColor', opacity: busy ? 1 : 0.55 }),
            ),
          )
        }

        /** Group entries into today / yesterday / earlier buckets, preserving recency order. */
        const groupByDay = (items) => {
          const startOfToday = new Date()
          startOfToday.setHours(0, 0, 0, 0)
          const todayStart = startOfToday.getTime()
          const yesterdayStart = todayStart - 86400000
          const groups = []
          for (const entry of items) {
            const when =
              typeof entry.time === 'number'
                ? entry.time
                : typeof entry.time === 'string'
                  ? Date.parse(entry.time)
                  : NaN
            const label = !Number.isFinite(when)
              ? translate('earlier')
              : when >= todayStart
                ? translate('today')
                : when >= yesterdayStart
                  ? translate('yesterday')
                  : translate('earlier')
            // 按时段时间可能缺失/非法（sort 会把它们挤到中段），若直接按「标签变化」切组，
            // 同一个「更早」会被切成两段，界面上就是两个重复的日期标题。改为按标签归并。
            let group = groups.find((candidate) => candidate.label === label)
            if (!group) {
              group = { label, items: [] }
              groups.push(group)
            }
            group.items.push(entry)
          }
          return groups
        }

        /**
         * The activity view: it replaces the sidebar session/workspace browsing region. Sessions are
         * sorted by recency, grouped Today/Yesterday/Earlier, each row showing its workspace name.
         */
        const ActivityViewPanel = () => {
          useLocaleTick()
          const snapshot = useSnapshot()

          React.useEffect(() => {
            load()
            if (sessionsService !== undefined && sessionsService.list !== undefined && typeof sessionsService.list.subscribe === 'function') {
              return sessionsService.list.subscribe(() => load())
            }
          }, [])

          const runningOnlyOn = useMode()
          const all = snapshot.items.slice().sort((left, right) => {
            const a = typeof left.time === 'number' ? left.time : Date.parse(left.time) || 0
            const b = typeof right.time === 'number' ? right.time : Date.parse(right.time) || 0
            // Running sessions first (the "current active" ones), then most recent first.
            const ra = left.running === true ? 1 : 0
            const rb = right.running === true ? 1 : 0
            if (ra !== rb) return rb - ra
            return b - a
          })
          const items = runningOnlyOn ? all.filter((entry) => entry.running === true) : all


          let listBody
          if (snapshot.status === 'unavailable') {
            listBody = h('div', { className: 'dshActivityMessage' }, translate('unavailable'))
          } else if (items.length === 0) {
            const key =
              snapshot.status === 'error' ? 'failed' : snapshot.status === 'ready' ? 'empty' : 'loading'
            listBody = h('div', { className: 'dshActivityMessage' }, translate(key))
          } else {
            listBody = groupByDay(items).map((group) =>
              h(
                'div',
                { key: group.label },
                h('div', {
                  className: 'dshActivityGroupTitle',
                  style: {
                    padding: '8px 6px 2px',
                    color: 'var(--dsw-alias-label-secondary, #666)',
                    fontSize: '11px',
                    fontWeight: 500,
                    letterSpacing: '0.02em',
                    background: 'transparent',
                    border: '0',
                  },
                }, group.label),
                h(
                  'div',
                  { className: 'dshActivityGroupList' },
                  group.items.map((entry) =>
                    h(
                      'button',
                      {
                        key: entry.id || entry.title,
                        type: 'button',
                        className: 'dshActivityWsRow',
                        'data-av-session': entry.id,
                        title: entry.title,
                        onClick: () => openSession(entry.id),
                        style: {
                          display: 'flex',
                          alignItems: 'center',
                          gap: '7px',
                          width: '100%',
                          boxSizing: 'border-box',
                          padding: '6px 8px',
                          border: '0',
                          borderRadius: '8px',
                          background: 'transparent',
                          color: 'inherit',
                          font: 'inherit',
                          fontSize: '13px',
                          textAlign: 'left',
                          cursor: 'pointer',
                          lineHeight: 1.35,
                        },
                      },
                      entry.running === true
                        ? h(
                            'svg',
                            {
                              className: 'dshActivitySpin',
                              viewBox: '0 0 24 24',
                              width: 12,
                              height: 12,
                              fill: 'none',
                              'aria-hidden': 'true',
                              style: { flex: 'none', display: 'block' },
                            },
                            h('circle', {
                              cx: 12,
                              cy: 12,
                              r: 9,
                              stroke: 'currentColor',
                              strokeWidth: 3,
                              strokeOpacity: 0.25,
                            }),
                            h(
                              'g',
                              null,
                              // SMIL: spins without needing the injected @keyframes rule.
                              h('animateTransform', {
                                attributeName: 'transform',
                                attributeType: 'XML',
                                type: 'rotate',
                                from: '0 12 12',
                                to: '360 12 12',
                                dur: '0.85s',
                                repeatCount: 'indefinite',
                              }),
                              h('path', {
                                d: 'M12 3a9 9 0 0 1 9 9',
                                stroke: 'currentColor',
                                strokeWidth: 3,
                                strokeLinecap: 'round',
                              }),
                            ),
                          )
                        : h('span', {
                            // Inactive rows show no icon; keep a same-size spacer so
                            // running rows' spinners and titles stay vertically aligned.
                            'aria-hidden': 'true',
                            style: {
                              flex: 'none',
                              width: '12px',
                              height: '12px',
                              padding: '0',
                            },
                          }),
                      h('span', { className: 'dshActivityWsTitle', style: { flex: '1 1 auto', minWidth: 0, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' } }, entry.title),
                      entry.workspace === '' || entry.workspace === entry.title
                        ? null
                        : h('span', { className: 'dshActivityWsName', style: { flex: 'none', maxWidth: '45%', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', color: 'var(--dsw-alias-label-tertiary, #999)', fontSize: '11px' } }, entry.workspace),
                      h('span', { className: 'dshActivityTime', style: { flex: 'none', marginLeft: 'auto', color: 'var(--dsw-alias-label-tertiary, #999)', fontSize: '11px' } }, formatWhen(entry.time)),
                    ),
                  ),
                ),
              ),
            )
          }

          return h(
            'div',
            {
              className: 'dshActivityView dshActivityPanel',
              style: {
                display: 'flex',
                flexDirection: 'column',
                gap: '10px',
                boxSizing: 'border-box',
                height: '100%',
                padding: '4px 2px 12px',
                overflowY: 'auto',
                overflowX: 'hidden',
                color: 'var(--dsw-alias-label-primary, #1a1a1a)',
                fontSize: '13px',
              },
            },
            h(
              'div',
              {
                className: 'dshActivityPanelTitle',
                style: {
                  flex: 'none',
                  padding: '2px 6px 4px',
                  fontSize: '11px',
                  fontWeight: 500,
                  letterSpacing: '0.02em',
                  textTransform: 'uppercase',
                  color: 'var(--dsw-alias-label-primary, #1a1a1a)',
                },
              },
              translate('panelTitle'),
            ),
            listBody,
          )
        }

        if (typeof styles !== 'undefined' && typeof styles.insert === 'function') {
          ctx.effect(() => styles.insert(STYLE), 'activity-view:styles')
        }

        ctx.effect(() => {
          const onDocClick = (event) => {
            try {
              if (!event || (event.button !== undefined && event.button !== 0)) return
              const target = event.target
              if (!target || typeof target.closest !== 'function') return
              // Rows: the host wrapper swallows React handlers on this slot and its own container
              // click turns into a New Session, so take the click in the capture phase and stop it.
              const row = target.closest('[data-av-session]')
              if (row) {
                event.preventDefault()
                event.stopPropagation()
                const id = row.getAttribute('data-av-session') || ''
                if (id !== '') openSession(id)
                return
              }
            } catch (suppress) {}
          }
          document.addEventListener('click', onDocClick, true)
          return () => document.removeEventListener('click', onDocClick, true)
        }, 'activity-view:native-click')

        for (const [localeId, dict] of Object.entries(MESSAGES)) {
          ctx.effect(() => {
            try {
              const dispose = localeService?.register?.(NS, localeId, dict)
              return typeof dispose === 'function' ? dispose : undefined
            } catch (error) {
              console.error('[activity-view] locale register failed', localeId, error)
              return undefined
            }
          }, `activity-view:locale:${localeId}`)
        }

        // 列表变化时刷新覆盖层；窗口尺寸变化时重新定位。
        ctx.effect(() => store.subscribe(() => syncOverlay()), 'activity-view:overlay-sync')
        ctx.effect(() => {
          const reposition = () => {
            if (!overlayOpen) return
            pinnedRegion = null
            syncOverlay()
          }
          const onKey = (event) => {
            if (event.key === 'Escape' && overlayOpen) setOverlayOpen(false)
            // 兜底入口：插槽内的点击可能被宿主吞掉，快捷键不经过插槽。
            if (event.altKey && event.shiftKey && !event.metaKey && !event.ctrlKey && (event.key === 'A' || event.key === 'a')) {
              event.preventDefault()
              toggleActivityView()
            }
          }
          /**
           * 面板列表的按钮由宿主 sidebar 自己绘制（我们的组件未必是事件目标），React 的
           * onClick 不可靠。这里在捕获阶段按 class / aria-label / 可见文案命中，最后再用
           * 图标自身的矩形做坐标命中测试，确保无论宿主怎么包，点上去都能被我们接住。
           */
          const label = translate('iconLabel')
          const matchesEntry = (node) => {
            if (node === null) return false
            if (node.closest('.dshActivityIcon') !== null) return true
            if (node.closest(`[aria-label="${label}"]`) !== null) return true
            let cursor = node
            for (let depth = 0; depth < 4 && cursor !== null; depth += 1) {
              const text = (cursor.textContent || '').replace(/\s+/g, ' ').trim()
              if (text === label) return true
              cursor = cursor.parentElement
            }
            return false
          }
          const hitOwnIcon = (event) => {
            const icon = document.querySelector('.dshActivityIcon')
            if (icon === null) return false
            const rect = icon.getBoundingClientRect()
            if (rect.width <= 0 || rect.height <= 0) return false
            const pad = 6
            return (
              event.clientX >= rect.left - pad &&
              event.clientX <= rect.right + pad &&
              event.clientY >= rect.top - pad &&
              event.clientY <= rect.bottom + pad
            )
          }
          const onClickCapture = (event) => {
            if (overlayEl !== null && overlayEl.contains(event.target)) return
            const target = event.target instanceof Element ? event.target : null
            if (target === null) return
            if (!matchesEntry(target) && !hitOwnIcon(event)) return
            event.preventDefault()
            event.stopPropagation()
            toggleActivityView()
          }
          window.addEventListener('click', onClickCapture, true)
          window.addEventListener('resize', reposition)
          window.addEventListener('keydown', onKey)
          return () => {
            window.removeEventListener('click', onClickCapture, true)
            window.removeEventListener('resize', reposition)
            window.removeEventListener('keydown', onKey)
            if (overlayEl !== null) {
              overlayEl.remove()
              overlayEl = null
            }
          }
        }, 'activity-view:overlay-lifecycle')

        ctx.slots.inject('sidebar.panellist', () => {
          return ctx.slots.register(
            { name: 'sidebar.panellist', id: PANEL_KEY, order: 20, label: () => translate('iconLabel') },
            ActivityIcon,
          )
        })

        if (timerService !== undefined && typeof timerService.interval === 'function') {
          ctx.effect(() => timerService.interval(() => void load(), POLL_MS), 'activity-view:poll')
        }

        void load()
    }
    return activityExports
  },
})
