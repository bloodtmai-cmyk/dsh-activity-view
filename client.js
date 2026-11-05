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
         * Find the native session-list area: the scrollable column that hosts the sidebar's
         * "New session" button. Returns its viewport rect plus the colour to paint over it, and the
         * first y where our list may start (just below the native header, so the native
         * new-session/search controls stay usable).
         */
        const findRegion = () => {
          try {
            const wanted = [MESSAGES.en.newSession, MESSAGES.zh.newSession, translate('newSession')]
            const nodes = document.querySelectorAll('button, [role="button"], a')
            for (const node of nodes) {
              const text = (node.textContent || '').replace(/\s+/g, ' ').trim()
              const bare = text.replace(/^[+＋]\s*/, '')
              if (!wanted.includes(text) && !wanted.includes(bare)) continue
              const own = node.getBoundingClientRect()
              let parent = node.parentElement
              for (let depth = 0; depth < 10 && parent !== null; depth += 1) {
                const rect = parent.getBoundingClientRect()
                if (rect.height >= 180 && rect.width >= 160 && rect.width <= 640) {
                  let background = ''
                  let cursor = parent
                  for (let up = 0; up < 5 && cursor !== null; up += 1) {
                    const colour = window.getComputedStyle(cursor).backgroundColor
                    if (colour !== '' && colour !== 'transparent' && colour !== 'rgba(0, 0, 0, 0)') {
                      background = colour
                      break
                    }
                    cursor = cursor.parentElement
                  }
                  const top = Math.max(rect.top, Math.round(own.bottom) + 6)
                  return {
                    left: rect.left,
                    top,
                    width: rect.width,
                    height: Math.max(120, rect.bottom - top),
                    background,
                  }
                }
                parent = parent.parentElement
              }
            }
          } catch (error) {
            console.error('[activity-view] locate sidebar region failed', error)
          }
          return {
            left: 8,
            top: 56,
            width: 280,
            height: Math.max(240, window.innerHeight - 120),
            background: '',
          }
        }

        const paintOverlay = (host) => {
          const state = store.snapshot
          const region = findRegion()
          host.style.left = `${Math.round(region.left)}px`
          host.style.top = `${Math.round(region.top)}px`
          host.style.width = `${Math.round(region.width)}px`
          host.style.height = `${Math.round(region.height)}px`
          host.style.background =
            region.background !== '' ? region.background : 'var(--dsw-alias-bg-primary, Canvas)'
          host.textContent = ''

          const body = document.createElement('div')
          body.style.cssText =
            'flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;padding:2px 4px 10px;'
          host.appendChild(body)

          const message = (text) => {
            const node = document.createElement('div')
            node.textContent = text
            node.style.cssText =
              'padding:14px 8px;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-secondary,#667);'
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
              'padding:8px 6px 2px;font-size:11px;font-weight:500;letter-spacing:.02em;color:var(--dsw-alias-label-secondary,#667);'
            body.appendChild(heading)

            for (const entry of group.items) {
              const row = document.createElement('button')
              row.type = 'button'
              row.setAttribute('data-av-session', entry.id)
              row.title = entry.title
              row.style.cssText =
                'display:flex;align-items:center;gap:8px;width:100%;box-sizing:border-box;padding:6px 8px;margin:1px 0;border:0;border-radius:7px;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer;'

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
                'font-size:12.5px;line-height:1.35;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;'
              text.appendChild(title)
              if (entry.workspace !== '') {
                const workspace = document.createElement('span')
                workspace.textContent = entry.workspace
                workspace.style.cssText =
                  'font-size:10.5px;line-height:1.3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--dsw-alias-label-secondary,#8a8a8a);'
                text.appendChild(workspace)
              }
              row.appendChild(text)

              const when = document.createElement('span')
              when.textContent = formatWhen(entry.time)
              when.style.cssText =
                'flex:none;font-size:10.5px;color:var(--dsw-alias-label-secondary,#8a8a8a);'
              row.appendChild(when)

              body.appendChild(row)
            }
          }
        }

        const syncOverlay = () => {
          if (typeof document === 'undefined') return
          if (!overlayOpen) {
            if (overlayEl !== null) {
              overlayEl.remove()
              overlayEl = null
            }
            return
          }
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
              'border-radius:10px',
              'box-shadow:0 12px 32px rgba(0, 0, 0, 0.14)',
            ].join(';')
            host.addEventListener(
              'click',
              (event) => {
                const target = event.target instanceof Element ? event.target : null
                const row = target !== null ? target.closest('[data-av-session]') : null
                if (row !== null) {
                  event.preventDefault()
                  event.stopPropagation()
                  openSession(row.getAttribute('data-av-session') || '')
                }
              },
              true,
            )
            overlayEl = host
            document.body.appendChild(host)
          }
          paintOverlay(overlayEl)
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
            if (overlayOpen) syncOverlay()
          }
          const onKey = (event) => {
            if (event.key === 'Escape' && overlayOpen) setOverlayOpen(false)
          }
          window.addEventListener('resize', reposition)
          window.addEventListener('scroll', reposition, true)
          window.addEventListener('keydown', onKey)
          return () => {
            window.removeEventListener('resize', reposition)
            window.removeEventListener('scroll', reposition, true)
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
