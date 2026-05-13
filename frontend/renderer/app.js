// ── Config ──────────────────────────────────────────────────────────────────
const API_BASE = 'http://127.0.0.1:5173'

// ── JS Tooltip ───────────────────────────────────────────────────────────────
const _tooltip = document.createElement('div')
_tooltip.id = 'js-tooltip'
document.body.appendChild(_tooltip)

document.addEventListener('mouseover', e => {
  const el = e.target.closest('[data-tooltip]')
  if (!el) return
  const raw = el.dataset.tooltip || ''
  const sep = raw.indexOf(': ')
  if (sep > -1) {
    _tooltip.innerHTML = `<strong>${raw.slice(0, sep)}</strong>${raw.slice(sep + 2)}`
  } else {
    _tooltip.innerHTML = `<strong>${raw}</strong>`
  }
  _tooltip.style.display = 'block'
})

document.addEventListener('mousemove', e => {
  if (_tooltip.style.display === 'none') return
  const pad = 12
  const tw = _tooltip.offsetWidth
  const th = _tooltip.offsetHeight
  let x = e.clientX + pad
  let y = e.clientY - th - pad
  if (x + tw > window.innerWidth - 8) x = e.clientX - tw - pad
  if (y < 8) y = e.clientY + pad
  _tooltip.style.left = x + 'px'
  _tooltip.style.top = y + 'px'
})

document.addEventListener('mouseout', e => {
  if (!e.target.closest('[data-tooltip]')) return
  _tooltip.style.display = 'none'
})

// ── State ───────────────────────────────────────────────────────────────────
const state = {
  currentPage: 'dashboard',
  syncing: false,
  augmentData: {},
  notifications: [],
  notifUnread: 0,
  notifOpen: false,
  mode: 'all', // 'all' | 'duos' | 'trios'
}

// ── Mode helper ──────────────────────────────────────────────────────────────
function modeParam(prefix = '?') {
  if (state.mode === 'all') return ''
  return `${prefix}game_mode=${state.mode}`
}

function modeJoin(existing) {
  // existing already has '?' — append &game_mode if needed
  if (state.mode === 'all') return existing
  return existing + (existing.includes('?') ? '&' : '?') + `game_mode=${state.mode}`
}

// ── Notifications ─────────────────────────────────────────────────────────
function addNotification(text, type = 'info') {
  const now = new Date()
  const time = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  state.notifications.unshift({ text, type, time })
  if (state.notifications.length > 50) state.notifications.pop()
  if (!state.notifOpen) {
    state.notifUnread++
    const badge = document.getElementById('notif-badge')
    if (badge) {
      badge.textContent = state.notifUnread
      badge.classList.add('visible')
    }
  }
  renderNotifications()
}

function renderNotifications() {
  const list = document.getElementById('notif-list')
  if (!list) return
  if (state.notifications.length === 0) {
    list.innerHTML = '<div class="notif-empty">No notifications yet</div>'
    return
  }
  list.innerHTML = state.notifications.map(n => `
    <div class="notif-item">
      <span class="notif-dot ${n.type}"></span>
      <span class="notif-text">${n.text}</span>
      <span class="notif-time">${n.time}</span>
    </div>
  `).join('')
}

async function loadAugmentData() {
  const data = await api('/api/data/augments')
  if (data) state.augmentData = data
}

// ── API helpers ─────────────────────────────────────────────────────────────
async function api(path, opts = {}) {
  try {
    // Use Electron IPC bridge when available (avoids all CORS issues)
    if (window.electronAPI?.apiRequest) {
      const method = (opts.method || 'GET').toUpperCase()
      let body = null
      if (opts.body) {
        try { body = JSON.parse(opts.body) } catch { body = opts.body }
      }
      const result = await window.electronAPI.apiRequest(path, method, body)
      if (!result.ok) throw new Error(`HTTP ${result.status}${result.error ? ': ' + result.error : ''}`)
      return result.data
    }
    // Fallback: direct fetch (dev mode)
    const res = await fetch(API_BASE + path, opts)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.json()
  } catch (e) {
    console.error('API error', path, e)
    return null
  }
}

// ── Toast ────────────────────────────────────────────────────────────────────
function toast(message, type = 'info', duration = 3500) {
  const el = document.createElement('div')
  el.className = `toast ${type}`
  el.textContent = message
  document.getElementById('toast-container').appendChild(el)
  setTimeout(() => el.remove(), duration)
}

// ── Routing ──────────────────────────────────────────────────────────────────
const pageLoaders = {
  dashboard: loadDashboard,
  history: loadHistory,
  augments: loadAugments,
  champions: loadChampions,
  items: loadItems,
  graphs: loadGraphs,
  wins: loadWins,
  settings: loadSettings,
}

function navigate(page) {
  state.currentPage = page
  document.querySelectorAll('.nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.page === page)
  })
  const container = document.getElementById('page-container')
  container.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:200px;"><span class="spinner"></span></div>'
  const loader = pageLoaders[page]
  if (loader) loader(container)
}

// ── Icon URLs ────────────────────────────────────────────────────────────────
function champIcon(id) { return `${API_BASE}/api/assets/champion/${id}` }
function itemIcon(id) { return `${API_BASE}/api/assets/item/${id}` }
function augIcon(id) { return `${API_BASE}/api/assets/augment/${id}` }

window.imgError = function(img) {
  img.onerror = null
  img.style.background = 'var(--bg-tertiary)'
  img.style.opacity = '0.4'
}

function imgWithFallback(src, alt, cls) {
  return `<img src="${src}" alt="${alt}" class="${cls}" onerror="imgError(this)">`
}

// ── Placement badge ──────────────────────────────────────────────────────────
function placementBadge(n) {
  return `<span class="placement-badge" data-rank="${n}">${n}</span>`
}

// ── Augment chips — icon-only with tooltip ───────────────────────────────────
function augmentChips(augments, iconsOnly = false) {
  if (!augments || !augments.length) return '<span style="color:var(--text-muted);font-size:0.75rem;">—</span>'
  if (iconsOnly) {
    return `<div class="aug-icons-row">${augments.map(a => {
      const meta = state.augmentData[String(a.augment_id)]
      const tip = meta?.desc ? `${a.augment_name}: ${meta.desc}` : a.augment_name
      return `<span data-tooltip="${tip.replace(/"/g, '“').replace(/'/g, '’')}">
        ${imgWithFallback(augIcon(a.augment_id), a.augment_name, `aug-icon-sm ${a.tier}`)}
      </span>`
    }).join('')}</div>`
  }
  return `<div class="augments-row">${augments.map(a =>
    `<span class="augment-chip ${a.tier}" title="${a.augment_name}">
      ${imgWithFallback(augIcon(a.augment_id), a.augment_name, '')}
      ${a.augment_name}
    </span>`
  ).join('')}</div>`
}

// ── Item row — icons with tooltip ────────────────────────────────────────────
function itemsRow(items, iconsOnly = false) {
  if (!items || !items.length) return '<span style="color:var(--text-muted);font-size:0.75rem;">—</span>'
  return `<div class="items-row">${items.map(i =>
    `<span data-tooltip="${i.item_name}">
      ${imgWithFallback(itemIcon(i.item_id), i.item_name, 'item-icon')}
    </span>`
  ).join('')}</div>`
}

// ── KDA ───────────────────────────────────────────────────────────────────────
function kdaStr(k, d, a) {
  const ratio = d === 0 ? 'Perfect' : ((k + a) / d).toFixed(2)
  return `<span class="kda">${k}/${d}/${a} <span>${ratio} KDA</span></span>`
}

// ── Damage bar ───────────────────────────────────────────────────────────────
function dmgBar(dmg, maxDmg) {
  const pct = maxDmg > 0 ? Math.round((dmg / maxDmg) * 100) : 0
  return `<div class="dmg-bar-wrap"><div class="dmg-bar"><div class="dmg-bar-fill" style="width:${pct}%"></div></div><span class="dmg-val">${(dmg/1000).toFixed(1)}k</span></div>`
}

// ── Date formatting ──────────────────────────────────────────────────────────
function fmtDate(iso) {
  const d = new Date(iso)
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

// ── Duration ─────────────────────────────────────────────────────────────────
function fmtDuration(secs) {
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return `${m}m ${s}s`
}

// ── Avg placement color ──────────────────────────────────────────────────────
function avgColor(avg) {
  if (avg <= 2) return 'var(--placement-1)'
  if (avg <= 3) return 'var(--placement-3)'
  if (avg <= 4) return 'var(--placement-4)'
  return 'var(--text-secondary)'
}

// ── Empty state ───────────────────────────────────────────────────────────────
function emptyState(icon, title, body) {
  return `<div class="empty-state"><div class="empty-state-icon">${icon}</div><h3>${title}</h3><p>${body}</p></div>`
}

// ── Game Detail Modal ─────────────────────────────────────────────────────────
async function showGameModal(gameId) {
  const g = await api(`/api/games/${gameId}`)
  if (!g) return

  const totalDmg = g.damage_dealt || 1
  const totalTaken = g.damage_taken || 1

  const overlay = document.createElement('div')
  overlay.className = 'modal-overlay'
  overlay.onclick = e => { if (e.target === overlay) overlay.remove() }

  overlay.innerHTML = `
    <div class="modal-box">
      <div class="modal-header">
        <div style="display:flex;align-items:center;gap:12px">
          <img src="${champIcon(g.champion_id)}" onerror="window.imgError(this)" style="width:48px;height:48px;border-radius:10px;border:2px solid var(--accent-gold)">
          <div>
            <div style="font-size:1.1rem;font-weight:700;color:var(--text-primary)">${g.champion_name}</div>
            <div style="font-size:0.78rem;color:var(--text-muted)">${fmtDate(g.game_date)} · ${fmtDuration(g.duration_seconds)} · Patch ${g.patch || '—'}</div>
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:12px">
          ${placementBadge(g.placement)}
          <button onclick="this.closest('.modal-overlay').remove()" style="background:none;border:none;color:var(--text-muted);font-size:1.4rem;cursor:pointer;line-height:1">×</button>
        </div>
      </div>

      <div class="modal-section-title">Performance</div>
      <div class="modal-stat-grid">
        <div class="modal-stat"><span class="modal-stat-label">KDA</span><span class="modal-stat-val">${kdaStr(g.kills, g.deaths, g.assists)}</span></div>
        <div class="modal-stat"><span class="modal-stat-label">Gold</span><span class="modal-stat-val gold">${(g.gold_earned||0).toLocaleString()}</span></div>
        <div class="modal-stat"><span class="modal-stat-label">Total Damage</span><span class="modal-stat-val" style="color:var(--danger)">${(g.damage_dealt||0).toLocaleString()}</span></div>
        <div class="modal-stat"><span class="modal-stat-label">Damage Taken</span><span class="modal-stat-val">${(g.damage_taken||0).toLocaleString()}</span></div>
        <div class="modal-stat"><span class="modal-stat-label">Healing Done</span><span class="modal-stat-val" style="color:var(--success)">${(g.total_heal||0).toLocaleString()}</span></div>
        <div class="modal-stat"><span class="modal-stat-label">Ally Healed</span><span class="modal-stat-val" style="color:var(--success)">${(g.heal_on_teammates||0).toLocaleString()}</span></div>
      </div>

      <div class="modal-section-title">Damage Dealt Breakdown</div>
      <div class="modal-dmg-bars">
        ${dmgTypeBar('Physical', g.physical_damage||0, totalDmg, '#e8935a')}
        ${dmgTypeBar('Magic', g.magic_damage||0, totalDmg, '#8fa8f8')}
        ${dmgTypeBar('True', g.true_damage||0, totalDmg, '#e8eaf6')}
      </div>

      <div class="modal-section-title">Damage Taken Breakdown</div>
      <div class="modal-dmg-bars">
        ${dmgTypeBar('Physical', g.physical_damage_taken||0, totalTaken, '#e8935a')}
        ${dmgTypeBar('Magic', g.magic_damage_taken||0, totalTaken, '#8fa8f8')}
        ${dmgTypeBar('True', g.true_damage_taken||0, totalTaken, '#e8eaf6')}
      </div>

      ${(g.augments||[]).length > 0 ? `
      <div class="modal-section-title">Augments</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">${augmentChips(g.augments, false)}</div>` : ''}

      ${(g.items||[]).length > 0 ? `
      <div class="modal-section-title">Items</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">${itemsRow(g.items, false)}</div>` : ''}

      ${g.duo_partner ? `
      <div class="modal-section-title">Duo Partner</div>
      <div style="display:flex;align-items:center;gap:8px">
        ${g.duo_champion_id ? `<img src="${champIcon(g.duo_champion_id)}" onerror="window.imgError(this)" style="width:28px;height:28px;border-radius:50%;border:1px solid var(--border)">` : ''}
        <span style="color:var(--text-secondary)">${g.duo_champion_name ? `<strong>${g.duo_champion_name}</strong> ` : ''}${g.duo_partner ? `<span style="color:var(--text-muted)">(${g.duo_partner})</span>` : ''}</span>
      </div>` : ''}
    </div>`

  document.body.appendChild(overlay)
}

function dmgTypeBar(label, value, total, color) {
  const pct = total > 0 ? Math.round(value / total * 100) : 0
  return `
    <div class="modal-dmg-row">
      <span class="modal-dmg-label" style="color:${color}">${label}</span>
      <div class="modal-dmg-track">
        <div class="modal-dmg-fill" style="width:${pct}%;background:${color}"></div>
      </div>
      <span class="modal-dmg-val">${value.toLocaleString()} <span style="color:var(--text-muted)">(${pct}%)</span></span>
    </div>`
}

// ── Dashboard ────────────────────────────────────────────────────────────────
async function loadDashboard(container) {
  const m = modeParam()
  const [summary, recentData, trend, streak, topDmgGames] = await Promise.all([
    api('/api/stats/summary' + m),
    api(modeJoin('/api/games?limit=10')),
    api(modeJoin('/api/stats/trend?n=20')),
    api('/api/stats/streak' + m),
    api('/api/stats/top-damage' + m),
  ])

  const games = recentData?.games || []
  const maxDmg = Math.max(...games.map(g => g.damage_dealt), 1)
  const streakEmoji = streak?.type === 'win' ? '🏆' : streak?.type === 'top4' ? '🔥' : '💀'
  const streakColor = streak?.type === 'win' ? 'var(--placement-1)' : streak?.type === 'top4' ? 'var(--success)' : 'var(--danger)'
  const streakLabel = streak?.type === 'win' ? 'Win Streak' : streak?.type === 'top4' ? 'Top 4 Streak' : 'Loss Streak'

  container.innerHTML = `
    <div class="page">
      <div class="page-header" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px">
        <div>
          <h1 class="page-title">Dashboard</h1>
          <p class="page-subtitle">Your Arena performance at a glance</p>
        </div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
          <button class="btn btn-showcase" id="showcase-btn">🥇 1st Place Showcase</button>
          <button class="btn btn-leaderboard" id="leaderboard-btn">⚡ Top Damage Leaderboard</button>
          ${summary?.total_games > 0 ? `<button class="btn btn-primary" id="share-btn">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
            Share Stats
          </button>` : ''}
        </div>
      </div>

      ${streak?.streak > 1 ? `
      <div style="display:inline-flex;align-items:center;gap:10px;padding:10px 18px;background:rgba(0,0,0,0.3);border-radius:var(--radius);border:1px solid ${streakColor}33;margin-bottom:16px">
        <span style="font-size:1.5rem">${streakEmoji}</span>
        <span style="font-size:1.2rem;font-weight:800;color:${streakColor}">${streak.streak}</span>
        <span style="font-size:0.78rem;font-weight:600;text-transform:uppercase;letter-spacing:0.06em;color:${streakColor};opacity:0.8">${streakLabel}</span>
      </div>` : ''}

      <div class="stat-grid">
        <div class="stat-card">
          <div class="stat-label">Avg Placement</div>
          <div class="stat-value gold">${summary?.avg_placement ? summary.avg_placement.toFixed(2) : '—'}</div>
          <div class="stat-sub">across ${summary?.total_games || 0} games</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Top ${summary?.top_half_threshold || 4} Rate</div>
          <div class="stat-value blue">${summary?.top_half_rate != null ? summary.top_half_rate.toFixed(1) + '%' : '—'}</div>
          <div class="stat-sub">${state.mode === 'trios' ? 'top half (6 teams)' : 'made the podium'}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Win Rate</div>
          <div class="stat-value">${summary?.win_rate ? summary.win_rate.toFixed(1) + '%' : '—'}</div>
          <div class="stat-sub">1st place finishes</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Games Tracked</div>
          <div class="stat-value">${summary?.total_games || 0}</div>
          <div class="stat-sub">Arena games total</div>
        </div>
      </div>

      ${trend && trend.length > 1 ? `
      <div class="card" style="margin-bottom:24px">
        <div class="card-title">Placement Trend — Last ${trend.length} Games</div>
        <div style="height:80px"><canvas id="sparkline-canvas"></canvas></div>
      </div>` : ''}

      <div class="table-container">
        <div class="table-header">
          <span class="table-title">Recent Games</span>
          <button class="btn" onclick="navigate('history')">View all</button>
        </div>
        ${games.length === 0 ? emptyState('🎮', 'No games yet', 'Play some Arena games, then sync to see your stats here.') : `
        <table>
          <thead><tr>
            <th>#</th><th>Champion</th><th>Augments</th><th>Items</th><th>KDA</th><th>Damage</th><th>Date</th>
          </tr></thead>
          <tbody>${games.map(g => `
            <tr class="clickable-row" onclick="showGameModal(${g.id})" title="Click for full stats">
              <td>${placementBadge(g.placement)}</td>
              <td><div class="champ-cell">${imgWithFallback(champIcon(g.champion_id), g.champion_name, 'champ-icon')}<span>${g.champion_name}</span></div></td>
              <td>${augmentChips(g.augments, true)}</td>
              <td>${itemsRow(g.items, true)}</td>
              <td>${kdaStr(g.kills, g.deaths, g.assists)}</td>
              <td>${dmgBar(g.damage_dealt, maxDmg)}</td>
              <td style="color:var(--text-muted);font-size:0.8rem">${fmtDate(g.game_date)}</td>
            </tr>`).join('')}
          </tbody>
        </table>`}
      </div>
    </div>`

  if (trend && trend.length > 1) {
    const ctx = document.getElementById('sparkline-canvas')?.getContext('2d')
    if (ctx) drawSparkline(ctx, trend.map(t => t.placement))
  }

  document.getElementById('showcase-btn')?.addEventListener('click', () => showWinsShowcase())
  document.getElementById('leaderboard-btn')?.addEventListener('click', () => showDamageLeaderboard(topDmgGames || []))
  document.getElementById('share-btn')?.addEventListener('click', () => showShareCard(summary, null, streak))
}

async function showWinsShowcase() {
  const wins = await api('/api/stats/wins-collection')
  const total = (wins||[]).reduce((s, w) => s + w.win_count, 0)

  const overlay = document.createElement('div')
  overlay.className = 'modal-overlay'
  overlay.onclick = e => { if (e.target === overlay) overlay.remove() }

  overlay.innerHTML = `
    <div class="modal-box" style="max-width:700px">
      <div class="modal-header">
        <div>
          <div style="font-size:1.1rem;font-weight:700;color:var(--accent-gold)">🥇 1st Place Showcase</div>
          <div style="font-size:0.78rem;color:var(--text-muted)">${(wins||[]).length} champions · ${total} total wins</div>
        </div>
        <button onclick="this.closest('.modal-overlay').remove()" style="background:none;border:none;color:var(--text-muted);font-size:1.4rem;cursor:pointer">×</button>
      </div>
      ${!wins || wins.length === 0 ? `<div class="empty-state" style="padding:40px 0">Win a game to start your collection!</div>` : `
      <div class="wins-grid">
        ${wins.map(w => {
          const isRecord = w.max_damage === w.overall_max_damage
          return `
          <div class="win-card${isRecord ? ' win-card-record' : ''}">
            ${isRecord ? `<div class="win-record-banner">🏆 DMG RECORD</div>` : ''}
            <div class="win-card-img-wrap">
              <img src="${champIcon(w.champion_id)}" onerror="window.imgError(this)" alt="${w.champion_name}" />
              ${w.win_count > 1 ? `<span class="win-count-badge">×${w.win_count}</span>` : ''}
            </div>
            <div class="win-card-name">${w.champion_name}</div>
            <div class="win-card-winrate">${w.win_rate_pct}% win rate</div>
            <div class="win-card-dmg">⚡ ${(w.max_damage||0).toLocaleString()}</div>
            <div class="win-card-date">${fmtDate(w.last_win)}</div>
          </div>`
        }).join('')}
      </div>`}
    </div>`

  document.body.appendChild(overlay)
}

function showDamageLeaderboard(topDmgGames) {
  const sorted = [...topDmgGames].sort((a, b) => b.damage_dealt - a.damage_dealt)
  const max = sorted[0]?.damage_dealt || 1

  const overlay = document.createElement('div')
  overlay.className = 'modal-overlay'
  overlay.onclick = e => { if (e.target === overlay) overlay.remove() }

  overlay.innerHTML = `
    <div class="modal-box" style="max-width:680px">
      <div class="modal-header">
        <div>
          <div style="font-size:1.1rem;font-weight:700;color:var(--text-primary)">⚡ Top Damage Leaderboard</div>
          <div style="font-size:0.78rem;color:var(--text-muted)">Your highest damage game per champion</div>
        </div>
        <button onclick="this.closest('.modal-overlay').remove()" style="background:none;border:none;color:var(--text-muted);font-size:1.4rem;cursor:pointer">×</button>
      </div>
      ${sorted.length === 0 ? `<div class="empty-state" style="padding:40px 0">No games yet.</div>` : `
      <div style="display:flex;flex-direction:column;gap:8px;margin-top:4px">
        ${sorted.map((g, i) => `
          <div class="leaderboard-row clickable-row" onclick="showGameModal(${g.id});this.closest('.modal-overlay').remove()">
            <span class="lb-rank" style="color:${i===0?'var(--accent-gold)':i===1?'#b0bec5':i===2?'#cd7f32':'var(--text-muted)'}">#${i+1}</span>
            <img src="${champIcon(g.champion_id)}" onerror="window.imgError(this)" style="width:32px;height:32px;border-radius:6px;border:1px solid var(--border)">
            <span style="flex:1;font-weight:600;color:var(--text-primary)">${g.champion_name}</span>
            <div style="flex:2">
              <div class="dmg-bar"><div class="dmg-bar-fill" style="width:${Math.round(g.damage_dealt/max*100)}%"></div></div>
            </div>
            <span style="color:var(--accent-gold);font-weight:700;min-width:60px;text-align:right">${(g.damage_dealt/1000).toFixed(1)}k</span>
            <span style="color:var(--text-muted);font-size:0.75rem;min-width:55px;text-align:right">${fmtDate(g.game_date)}</span>
          </div>`).join('')}
      </div>`}
    </div>`

  document.body.appendChild(overlay)
}

function showShareCard(summary, bestChamp, streak) {
  const streakEmoji = streak?.type === 'win' ? '🏆' : streak?.type === 'top4' ? '🔥' : '💀'
  const streakText = streak?.streak > 1 ? `${streakEmoji} ${streak.streak} ${streak.type === 'win' ? 'Win' : streak.type === 'top4' ? 'Top 4' : 'Loss'} Streak` : ''

  const overlay = document.createElement('div')
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.8);z-index:10000;display:flex;align-items:center;justify-content:center;'
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove() }

  overlay.innerHTML = `
    <div style="background:var(--bg-secondary);border:1px solid var(--accent-gold);border-radius:16px;padding:32px;width:480px;max-width:95vw">
      <div id="share-card" style="
        background:linear-gradient(135deg,#0a0e1a 0%,#111827 50%,#1a2235 100%);
        border:1px solid rgba(200,155,60,0.3);border-radius:12px;padding:28px;
        font-family:'Inter',sans-serif;">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:20px">
          ${bestChamp ? `<img src="${champIcon(bestChamp.champion_id)}" onerror="imgError(this)" style="width:52px;height:52px;border-radius:10px;border:2px solid var(--accent-gold);object-fit:cover">` : ''}
          <div>
            <div style="font-size:1.2rem;font-weight:800;color:#c89b3c">Arena Tracker</div>
            ${bestChamp ? `<div style="font-size:0.8rem;color:#8b92a5">Best champ: <strong style="color:#e8eaf6">${bestChamp.champion_name}</strong></div>` : ''}
          </div>
          ${streakText ? `<div style="margin-left:auto;font-size:0.85rem;font-weight:700;color:#c89b3c">${streakText}</div>` : ''}
        </div>
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:16px">
          ${[
            ['Avg Place', summary?.avg_placement?.toFixed(2) || '—', '#c89b3c'],
            ['Top 4 Rate', (summary?.top4_rate?.toFixed(1) || '—') + '%', '#4a90d9'],
            ['Win Rate', (summary?.win_rate?.toFixed(1) || '—') + '%', '#e8eaf6'],
            ['Games', summary?.total_games || 0, '#8b92a5'],
          ].map(([label, val, color]) => `
            <div style="background:rgba(255,255,255,0.04);border-radius:8px;padding:10px;text-align:center">
              <div style="font-size:1.3rem;font-weight:800;color:${color}">${val}</div>
              <div style="font-size:0.65rem;text-transform:uppercase;letter-spacing:0.06em;color:#5a6178;margin-top:2px">${label}</div>
            </div>`).join('')}
        </div>
        <div style="font-size:0.65rem;color:#3a4158;text-align:right">Arena Tracker • ${new Date().toLocaleDateString()}</div>
      </div>
      <div style="display:flex;gap:10px;margin-top:16px;justify-content:flex-end">
        <button class="btn" onclick="this.closest('div[style]').parentElement.remove()">Close</button>
        <button class="btn btn-primary" onclick="copyShareCard()">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
          Copy Stats Text
        </button>
      </div>
    </div>`

  document.body.appendChild(overlay)

  window._shareData = { summary, bestChamp, streak }
}

window.copyShareCard = function() {
  const { summary, bestChamp, streak } = window._shareData || {}
  const streakEmoji = streak?.type === 'win' ? '🏆' : streak?.type === 'top4' ? '🔥' : '💀'
  const streakText = streak?.streak > 1 ? `${streakEmoji} ${streak.streak} ${streak.type} streak` : ''
  const text = [
    `🎮 Arena Tracker Stats`,
    bestChamp ? `⚔️ Best champ: ${bestChamp.champion_name}` : '',
    `📊 Avg Placement: ${summary?.avg_placement?.toFixed(2)}`,
    `🔝 Top 4 Rate: ${summary?.top4_rate?.toFixed(1)}%`,
    `🥇 Win Rate: ${summary?.win_rate?.toFixed(1)}%`,
    `🎯 Games: ${summary?.total_games}`,
    streakText,
  ].filter(Boolean).join('\n')

  navigator.clipboard.writeText(text).then(() => toast('Stats copied to clipboard!', 'success'))
}

function drawSparkline(ctx, data) {
  new Chart(ctx, {
    type: 'line',
    data: {
      labels: data.map((_, i) => ''),
      datasets: [{
        data,
        borderColor: '#c89b3c',
        borderWidth: 2,
        pointRadius: 3,
        pointBackgroundColor: data.map(p => p <= 4 ? '#52c07a' : '#e05252'),
        fill: true,
        backgroundColor: 'rgba(200,155,60,0.06)',
        tension: 0.3,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      scales: {
        y: { reverse: true, min: 1, max: state.mode === 'trios' ? 6 : 8, ticks: { display: false }, grid: { color: 'rgba(255,255,255,0.05)' } },
        x: { display: false },
      },
      plugins: { legend: { display: false }, tooltip: {
        callbacks: { label: (ctx) => `Placement: ${ctx.raw}` }
      }},
    },
  })
}

// ── History ───────────────────────────────────────────────────────────────────
let historyState = { page: 0, limit: 20, filters: {}, total: 0, expandedId: null }

async function loadHistory(container) {
  const champions = await api('/api/stats/champions' + modeParam())
  const champNames = (champions || []).map(c => c.champion_name)

  container.innerHTML = `
    <div class="page">
      <div class="page-header">
        <h1 class="page-title">Game History</h1>
        <p class="page-subtitle">All your Arena games — filterable and sortable</p>
      </div>
      <div class="filters-bar" id="history-filters">
        <select id="f-champ">
          <option value="">All Champions</option>
          ${champNames.map(n => `<option value="${n}">${n}</option>`).join('')}
        </select>
        <select id="f-place">
          <option value="">All Placements</option>
          <option value="1-1">1st only</option>
          <option value="1-4">Top 4</option>
          <option value="5-8">5th-8th</option>
        </select>
        <select id="f-patch"></select>
        <button class="btn" id="filter-apply-btn">Apply</button>
        <button class="btn" id="filter-reset-btn">Reset</button>
        <button class="btn" style="margin-left:auto" onclick="window.location.href='${API_BASE}/api/export/csv'">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          Export CSV
        </button>
      </div>
      <div id="history-table-wrap"></div>
    </div>`

  // Fill patch options
  const patches = await api('/api/games?limit=1000')
  const patchSet = [...new Set((patches?.games || []).map(g => g.patch).filter(Boolean))].sort().reverse()
  const patchSel = document.getElementById('f-patch')
  patchSel.innerHTML = '<option value="">All Patches</option>' + patchSet.map(p => `<option value="${p}">${p}</option>`).join('')

  historyState = { page: 0, limit: 20, filters: {}, total: 0, expandedId: null }

  document.getElementById('filter-apply-btn').onclick = () => {
    const champ = document.getElementById('f-champ').value
    const place = document.getElementById('f-place').value
    const patch = document.getElementById('f-patch').value
    historyState.filters = {}
    historyState.page = 0
    if (champ) historyState.filters.champion = champ
    if (place) {
      const [min, max] = place.split('-')
      historyState.filters.placement_min = min
      historyState.filters.placement_max = max
    }
    if (patch) historyState.filters.patch = patch
    renderHistoryTable()
  }

  document.getElementById('filter-reset-btn').onclick = () => {
    document.getElementById('f-champ').value = ''
    document.getElementById('f-place').value = ''
    document.getElementById('f-patch').value = ''
    historyState.filters = {}
    historyState.page = 0
    renderHistoryTable()
  }

  renderHistoryTable()
}

async function renderHistoryTable() {
  const wrap = document.getElementById('history-table-wrap')
  if (!wrap) return
  wrap.innerHTML = '<div style="display:flex;justify-content:center;padding:40px"><span class="spinner"></span></div>'

  const qs = new URLSearchParams({
    limit: historyState.limit,
    offset: historyState.page * historyState.limit,
    ...historyState.filters,
    ...(state.mode !== 'all' ? { game_mode: state.mode } : {}),
  })
  const data = await api('/api/games?' + qs)
  const games = data?.games || []
  historyState.total = data?.total || 0
  const totalPages = Math.ceil(historyState.total / historyState.limit)
  const maxDmg = Math.max(...games.map(g => g.damage_dealt), 1)

  if (games.length === 0) {
    wrap.innerHTML = `<div class="table-container">${emptyState('🔍', 'No games found', 'Try adjusting your filters.')}</div>`
    return
  }

  wrap.innerHTML = `
    <div class="table-container">
      <table>
        <thead><tr>
          <th>Place</th><th>Champion</th><th>Augments</th><th>Items</th><th>KDA</th><th>Damage</th><th>Duration</th><th>Date</th><th>Patch</th>
        </tr></thead>
        <tbody id="history-tbody">
          ${games.map(g => `
            <tr class="game-row" data-id="${g.id}" style="cursor:pointer">
              <td>${placementBadge(g.placement)}</td>
              <td><div class="champ-cell">${imgWithFallback(champIcon(g.champion_id), g.champion_name, 'champ-icon')}<span>${g.champion_name}</span></div></td>
              <td>${augmentChips(g.augments, true)}</td>
              <td>${itemsRow(g.items, true)}</td>
              <td>${kdaStr(g.kills, g.deaths, g.assists)}</td>
              <td>${dmgBar(g.damage_dealt, maxDmg)}</td>
              <td style="color:var(--text-muted);font-size:0.8rem">${fmtDuration(g.duration_seconds)}</td>
              <td style="color:var(--text-muted);font-size:0.8rem">${fmtDate(g.game_date)}</td>
              <td style="color:var(--text-muted);font-size:0.8rem">${g.patch || '—'}</td>
            </tr>
            <tr class="expand-row" id="expand-${g.id}" style="display:none">
              <td colspan="9">
                <div class="expand-content">
                  <div>
                    <div class="expand-section-title">Full Augment Build</div>
                    <div style="display:flex;flex-direction:column;gap:8px">
                      ${(g.augments || []).map(a => `
                        <div class="augment-chip ${a.tier}" style="max-width:none;padding:6px 12px 6px 8px">
                          ${imgWithFallback(augIcon(a.augment_id), a.augment_name, '')}
                          <span><strong>${a.augment_name}</strong></span>
                          <span style="margin-left:auto;font-size:0.68rem;opacity:0.7">${a.tier}</span>
                        </div>`).join('') || '<span style="color:var(--text-muted)">No augment data</span>'}
                    </div>
                  </div>
                  <div>
                    <div class="expand-section-title">Items</div>
                    <div style="display:flex;gap:6px;flex-wrap:wrap">
                      ${(g.items || []).map(i => `
                        <div style="display:flex;flex-direction:column;align-items:center;gap:4px">
                          ${imgWithFallback(itemIcon(i.item_id), i.item_name, 'item-icon')}
                          <span style="font-size:0.65rem;color:var(--text-muted);max-width:48px;text-align:center;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${i.item_name}</span>
                        </div>`).join('') || '<span style="color:var(--text-muted)">No item data</span>'}
                    </div>
                    ${g.duo_partner ? `
                    <div style="display:flex;align-items:center;gap:8px;margin-top:12px">
                      <span style="font-size:0.75rem;color:var(--text-muted)">Duo:</span>
                      ${g.duo_champion_id ? `<img src="${champIcon(g.duo_champion_id)}" onerror="window.imgError(this)" style="width:24px;height:24px;border-radius:50%;border:1px solid var(--border)" title="${g.duo_champion_name || ''}" />` : ''}
                      <span style="font-size:0.8rem;color:var(--text-secondary)">${g.duo_champion_name ? `<strong>${g.duo_champion_name}</strong>` : ''} ${g.duo_partner ? `<span style="color:var(--text-muted)">(${g.duo_partner})</span>` : ''}</span>
                    </div>` : ''}
                  </div>
                </div>
              </td>
            </tr>`).join('')}
        </tbody>
      </table>
      ${totalPages > 1 ? `
      <div class="pagination">
        <button class="page-btn" ${historyState.page === 0 ? 'disabled' : ''} onclick="historyPage(${historyState.page - 1})">← Prev</button>
        <span style="color:var(--text-muted);font-size:0.8rem">Page ${historyState.page + 1} of ${totalPages} (${historyState.total} games)</span>
        <button class="page-btn" ${historyState.page >= totalPages - 1 ? 'disabled' : ''} onclick="historyPage(${historyState.page + 1})">Next →</button>
      </div>` : ''}
    </div>`

  document.querySelectorAll('.game-row').forEach(row => {
    row.onclick = () => showGameModal(parseInt(row.dataset.id))
  })
}

function historyPage(n) {
  historyState.page = n
  renderHistoryTable()
}

// ── Augments ─────────────────────────────────────────────────────────────────
const OFFENSE_KEYWORDS = /damage|attack|crit|critical|kill|burn|bleed|wound|execute|pierce|burst|slash|lightning|chain|explosive|bomb|ignite|poison|blaze|shred|penetrat|letal|lethal|frag|fury|rampage|rampage|assault|carnage|destruction|annihilat|devastat|obliterat|nuke|smite|cleave|rupture|sunder|maim|impale|skewer|ravage|rend|lacerat|mutilat|batter|pummel|bludgeon|thrash|slam|crush|pulveriz/i
const DEFENSE_KEYWORDS = /shield|armor|health|heal|resist|block|immune|barrier|tenacity|regenerat|regen|fortif|ward|guard|protect|bulwark|bastion|refuge|sanctuary|sentinel|aegis|barrier|rampart|stalwart|steadfast|endur|persever|survive|survival|tank|tough|robust|resilient|invinc|invulner|immortal|undying|evade|dodge|parry/i
const UTILITY_KEYWORDS = /gold|xp|experience|mana|cooldown|haste|movement speed|ms boost|slow|stun|root|silence|cast|ability|spell|summon|minion|pet|companion|item|anvil|reroll|shop|steal|copy|clone|mimic|borrow|lend|share|trade|swap|exchange|convert|transform/i

function augCategory(aug) {
  const meta = state.augmentData[String(aug.augment_id)]
  const text = (aug.augment_name + ' ' + (meta?.desc || '')).toLowerCase()
  // Rarity 4 = special unique augments (stat anvils, Lamb's Respite, etc.)
  if (aug.tier === 'special') return 'special'
  if (DEFENSE_KEYWORDS.test(text)) return 'defense'
  if (OFFENSE_KEYWORDS.test(text)) return 'offense'
  if (UTILITY_KEYWORDS.test(text)) return 'utility'
  return 'utility' // default fallback
}

async function loadAugments(container) {
  const data = await api('/api/stats/augments' + modeParam())
  const augments = data || []

  container.innerHTML = `
    <div class="page">
      <div class="page-header">
        <h1 class="page-title">Augments</h1>
        <p class="page-subtitle">${augments.length} unique augments taken across all games</p>
      </div>
      <div class="filters-bar">
        <select id="aug-tier-filter">
          <option value="">All Tiers</option>
          <option value="prismatic">Prismatic</option>
          <option value="gold">Gold</option>
          <option value="silver">Silver</option>
        </select>
        <select id="aug-cat-filter">
          <option value="">All Types</option>
          <option value="offense">⚔ Offense</option>
          <option value="defense">🛡 Defense</option>
          <option value="utility">⚡ Utility</option>
          <option value="special">✦ Special</option>
        </select>
        <select id="aug-sort">
          <option value="times_taken">Most Taken</option>
          <option value="avg_placement">Best Avg Placement</option>
        </select>
      </div>
      <div class="grid-4" id="aug-grid">
        ${augments.length === 0 ? emptyState('✨', 'No augment data yet', 'Sync some Arena games to see your augment stats.') : renderAugCards(augments)}
      </div>
    </div>`

  const rerender = () => {
    const tier = document.getElementById('aug-tier-filter').value
    const cat  = document.getElementById('aug-cat-filter').value
    const sort = document.getElementById('aug-sort').value
    let filtered = [...augments]
    if (tier) filtered = filtered.filter(a => a.tier === tier)
    if (cat)  filtered = filtered.filter(a => augCategory(a) === cat)
    filtered.sort((a, b) => sort === 'avg_placement' ? a.avg_placement - b.avg_placement : b.times_taken - a.times_taken)
    document.getElementById('aug-grid').innerHTML = renderAugCards(filtered)
  }

  document.getElementById('aug-tier-filter').onchange = rerender
  document.getElementById('aug-cat-filter').onchange = rerender
  document.getElementById('aug-sort').onchange = rerender
}

function renderAugCards(augs) {
  return augs.map(a => `
    <div class="aug-card ${a.tier}">
      <div class="aug-card-header" style="flex-direction:column;align-items:center;text-align:center;gap:8px">
        ${(() => {
          const meta = state.augmentData[String(a.augment_id)]
          const tip = meta?.desc ? `${a.augment_name}: ${meta.desc}` : a.augment_name
          return `<span data-tooltip="${tip.replace(/"/g, '&quot;')}" style="display:inline-block">
            ${imgWithFallback(augIcon(a.augment_id), a.augment_name, 'aug-icon-lg')}
          </span>`
        })()}
        <div class="aug-card-tier ${a.tier}">${a.tier}</div>
      </div>
      <div class="aug-card-footer">
        <span style="color:var(--text-muted);font-size:0.78rem">${a.times_taken}× taken</span>
        <span class="aug-placement-badge" style="color:${avgColor(a.avg_placement)}">Avg ${a.avg_placement.toFixed(2)}</span>
      </div>
    </div>`).join('')
}

// ── Champions ─────────────────────────────────────────────────────────────────
async function loadChampions(container) {
  const data = await api('/api/stats/champions' + modeParam())
  const champions = (data || []).sort((a, b) => b.games - a.games)

  container.innerHTML = `
    <div class="page">
      <div class="page-header">
        <h1 class="page-title">Champions</h1>
        <p class="page-subtitle">${champions.length} champions played in Arena · click any to see full history</p>
      </div>
      <div class="filters-bar">
        <select id="champ-sort">
          <option value="games">Most Played</option>
          <option value="avg_placement">Best Avg Placement</option>
          <option value="win_rate">Win Rate</option>
          <option value="top4_rate">Top 4 Rate</option>
        </select>
      </div>
      <div class="grid-4" id="champ-grid">
        ${champions.length === 0 ? emptyState('⚔️', 'No champion data yet', 'Sync some Arena games to see your champion stats.') : renderChampCards(champions)}
      </div>
    </div>`

  document.getElementById('champ-sort').onchange = () => {
    const sort = document.getElementById('champ-sort').value
    const sorted = [...champions].sort((a, b) =>
      sort === 'games'         ? b.games - a.games :
      sort === 'avg_placement' ? a.avg_placement - b.avg_placement :
      sort === 'top4_rate'     ? b.top4_rate - a.top4_rate :
                                 b.win_rate - a.win_rate
    )
    document.getElementById('champ-grid').innerHTML = renderChampCards(sorted)
    attachChampCardClicks()
  }
  attachChampCardClicks()
}

function attachChampCardClicks() {
  document.querySelectorAll('.champ-card[data-champ]').forEach(card => {
    card.onclick = () => showChampDetail(card.dataset.champ, card.dataset.champid)
  })
}

async function showChampDetail(champName, champId) {
  const games = await api(`/api/stats/champions/${encodeURIComponent(champName)}/games` + modeParam())
  if (!games) return
  const maxDmg = Math.max(...games.map(g => g.damage_dealt), 1)

  const overlay = document.createElement('div')
  overlay.className = 'modal-overlay'
  overlay.onclick = e => { if (e.target === overlay) overlay.remove() }

  overlay.innerHTML = `
    <div class="modal-box" style="max-width:780px">
      <div class="modal-header">
        <div style="display:flex;align-items:center;gap:12px">
          <img src="${champIcon(champId)}" onerror="window.imgError(this)" style="width:44px;height:44px;border-radius:10px;border:2px solid var(--accent-gold)">
          <div>
            <div style="font-size:1.1rem;font-weight:700;color:var(--text-primary)">${champName}</div>
            <div style="font-size:0.78rem;color:var(--text-muted)">${games.length} games this season · newest first</div>
          </div>
        </div>
        <button onclick="this.closest('.modal-overlay').remove()" style="background:none;border:none;color:var(--text-muted);font-size:1.4rem;cursor:pointer">×</button>
      </div>
      <div style="overflow-x:auto">
        <table style="width:100%">
          <thead><tr>
            <th>#</th><th>Augments</th><th>Items</th><th>KDA</th><th>Damage</th><th>Date</th>
          </tr></thead>
          <tbody>
            ${games.map(g => `
              <tr class="clickable-row" onclick="showGameModal(${g.id})" title="Click for full stats">
                <td>${placementBadge(g.placement)}</td>
                <td>${augmentChips(g.augments, true)}</td>
                <td>${itemsRow(g.items, true)}</td>
                <td>${kdaStr(g.kills, g.deaths, g.assists)}</td>
                <td>${dmgBar(g.damage_dealt, maxDmg)}</td>
                <td style="color:var(--text-muted);font-size:0.78rem;white-space:nowrap">${fmtDate(g.game_date)}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>`

  document.body.appendChild(overlay)
  // clicking a game row inside this modal should open game detail without closing champ modal
  overlay.querySelectorAll('.clickable-row').forEach(row => {
    row.addEventListener('click', e => e.stopPropagation())
  })
}

function renderChampCards(champs) {
  return champs.map(c => `
    <div class="champ-card ${c.best_placement === 1 ? 'has-win' : ''} clickable-row" data-champ="${c.champion_name}" data-champid="${c.champion_id}" style="cursor:pointer">
      ${c.best_placement === 1 ? '<span class="win-crown">👑</span>' : ''}
      ${imgWithFallback(champIcon(c.champion_id), c.champion_name, 'champ-card-img')}
      <div class="champ-card-body">
        <div class="champ-card-name">${c.champion_name}</div>
        <div class="champ-card-stats">
          <div class="champ-stat-item">
            <span class="champ-stat-label">Games</span>
            <span class="champ-stat-val">${c.games}</span>
          </div>
          <div class="champ-stat-item">
            <span class="champ-stat-label">Avg Place</span>
            <span class="champ-stat-val" style="color:${avgColor(c.avg_placement)}">${c.avg_placement.toFixed(1)}</span>
          </div>
          <div class="champ-stat-item">
            <span class="champ-stat-label">Best</span>
            <span class="champ-stat-val" style="color:var(--accent-gold)">#${c.best_placement}</span>
          </div>
          <div class="champ-stat-item">
            <span class="champ-stat-label">Top 4%</span>
            <span class="champ-stat-val">${c.top4_rate?.toFixed(0) || 0}%</span>
          </div>
        </div>
      </div>
    </div>`).join('')
}

// ── Items ─────────────────────────────────────────────────────────────────────
async function loadItems(container) {
  const data = await api('/api/stats/items' + modeParam())
  const items = data || []

  items.sort((a, b) => a.avg_placement - b.avg_placement)

  container.innerHTML = `
    <div class="page">
      <div class="page-header">
        <h1 class="page-title">Items</h1>
        <p class="page-subtitle">${items.length} unique items built across all games</p>
      </div>
      <div class="filters-bar">
        <select id="item-sort">
          <option value="avg_placement">Best Avg Placement</option>
          <option value="times_built">Most Built</option>
        </select>
      </div>
      <div id="items-grid">
        ${items.length === 0 ? emptyState('🛡️', 'No item data yet', 'Sync some Arena games to see your item stats.') : renderItemsTable(items)}
      </div>
    </div>`

  document.getElementById('item-sort').onchange = () => {
    const sort = document.getElementById('item-sort').value
    const sorted = [...items].sort((a, b) => sort === 'times_built' ? b.times_built - a.times_built : a.avg_placement - b.avg_placement)
    document.getElementById('items-grid').innerHTML = renderItemsTable(sorted)
  }
}

function renderItemsTable(items) {
  return `
    <div class="table-container">
      <table>
        <thead><tr>
          <th>Item</th><th>Name</th><th>Times Built</th><th>Avg Placement</th>
        </tr></thead>
        <tbody>
          ${items.map(i => `
            <tr>
              <td>${imgWithFallback(itemIcon(i.item_id), i.item_name, 'item-icon')}</td>
              <td style="font-weight:500">${i.item_name}</td>
              <td>${i.times_built}</td>
              <td><span style="font-weight:600;color:${avgColor(i.avg_placement)}">${i.avg_placement.toFixed(2)}</span></td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`
}

// ── Graphs ────────────────────────────────────────────────────────────────────
async function loadGraphs(container) {
  const [trend, champions] = await Promise.all([
    api(modeJoin('/api/stats/trend?n=50')),
    api('/api/stats/champions' + modeParam()),
  ])

  container.innerHTML = `
    <div class="page">
      <div class="page-header">
        <h1 class="page-title">Graphs</h1>
        <p class="page-subtitle">Visual breakdown of your Arena performance</p>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(500px,1fr));gap:20px;margin-bottom:20px">
        <div class="chart-card">
          <div class="chart-title">Placement Over Time (last ${(trend||[]).length} games)</div>
          <div class="chart-wrap" style="height:220px"><canvas id="chart-trend"></canvas></div>
        </div>
        <div class="chart-card">
          <div class="chart-title">Placement Distribution</div>
          <div class="chart-wrap" style="height:220px"><canvas id="chart-dist"></canvas></div>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(500px,1fr));gap:20px">
        <div class="chart-card">
          <div class="chart-title">Top 4 Rate by Champion (3+ games)</div>
          <div class="chart-wrap" style="height:300px"><canvas id="chart-champs"></canvas></div>
        </div>
        <div class="chart-card">
          <div class="chart-title">Avg Placement by Champion</div>
          <div class="chart-wrap" style="height:300px"><canvas id="chart-champ-avg"></canvas></div>
        </div>
      </div>
    </div>`

  const chartDefaults = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { display: false } },
    scales: {
      x: { ticks: { color: '#5a6178', font: { size: 11 } }, grid: { color: 'rgba(255,255,255,0.04)' } },
      y: { ticks: { color: '#5a6178', font: { size: 11 } }, grid: { color: 'rgba(255,255,255,0.04)' } },
    },
  }

  if (trend && trend.length > 1) {
    const ctx = document.getElementById('chart-trend')?.getContext('2d')
    if (ctx) new Chart(ctx, {
      type: 'line',
      data: {
        labels: trend.map((t, i) => i + 1),
        datasets: [{
          data: trend.map(t => t.placement),
          borderColor: '#c89b3c',
          borderWidth: 2,
          pointRadius: 4,
          pointBackgroundColor: trend.map(t => t.placement <= 4 ? '#52c07a' : '#e05252'),
          fill: true,
          backgroundColor: 'rgba(200,155,60,0.07)',
          tension: 0.3,
        }],
      },
      options: {
        ...chartDefaults,
        scales: {
          ...chartDefaults.scales,
          y: { ...chartDefaults.scales.y, reverse: true, min: 1, max: state.mode === 'trios' ? 6 : 8, ticks: { color: '#5a6178', stepSize: 1 } },
        },
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => `#${c.raw} — ${trend[c.dataIndex]?.champion_name}` } } },
      },
    })

    // Distribution
    const maxPlace = state.mode === 'trios' ? 6 : 8
    const dist = Array(maxPlace).fill(0)
    trend.forEach(t => { if (t.placement <= maxPlace) dist[t.placement - 1]++ })
    const distLabels = ['1st','2nd','3rd','4th','5th','6th','7th','8th'].slice(0, maxPlace)
    const distColors = ['#c89b3c','#b0bec5','#cd7f32','#4a6a3a','#3a3a4a','#3a3a4a','#3a3a4a','#3a3a4a'].slice(0, maxPlace)
    const ctx2 = document.getElementById('chart-dist')?.getContext('2d')
    if (ctx2) new Chart(ctx2, {
      type: 'bar',
      data: {
        labels: distLabels,
        datasets: [{
          data: dist,
          backgroundColor: distColors,
          borderRadius: 5,
        }],
      },
      options: chartDefaults,
    })
  }

  if (champions && champions.length > 0) {
    const filtered = champions.filter(c => c.games >= 3).sort((a, b) => b.top4_rate - a.top4_rate).slice(0, 12)
    const ctx3 = document.getElementById('chart-champs')?.getContext('2d')
    if (ctx3 && filtered.length) new Chart(ctx3, {
      type: 'bar',
      data: {
        labels: filtered.map(c => c.champion_name),
        datasets: [{ data: filtered.map(c => c.top4_rate?.toFixed(1)), backgroundColor: '#4a90d9', borderRadius: 4 }],
      },
      options: {
        ...chartDefaults,
        indexAxis: 'y',
        scales: {
          x: { ...chartDefaults.scales.x, max: 100, ticks: { ...chartDefaults.scales.x.ticks, callback: v => v + '%' } },
          y: { ticks: { color: '#8b92a5', font: { size: 11 } }, grid: { display: false } },
        },
      },
    })

    const filteredAvg = champions.filter(c => c.games >= 2).sort((a, b) => a.avg_placement - b.avg_placement).slice(0, 12)
    const ctx4 = document.getElementById('chart-champ-avg')?.getContext('2d')
    if (ctx4 && filteredAvg.length) new Chart(ctx4, {
      type: 'bar',
      data: {
        labels: filteredAvg.map(c => c.champion_name),
        datasets: [{
          data: filteredAvg.map(c => c.avg_placement?.toFixed(2)),
          backgroundColor: filteredAvg.map(c => c.avg_placement <= 2 ? '#c89b3c' : c.avg_placement <= 4 ? '#52c07a' : '#e05252'),
          borderRadius: 4,
        }],
      },
      options: {
        ...chartDefaults,
        indexAxis: 'y',
        scales: {
          x: { ...chartDefaults.scales.x, min: 1, max: 8, reverse: false },
          y: { ticks: { color: '#8b92a5', font: { size: 11 } }, grid: { display: false } },
        },
      },
    })
  }
}

// ── Settings ──────────────────────────────────────────────────────────────────
async function loadSettings(container) {
  const settings = await api('/api/settings')
  const status = await api('/api/status')
  const isSetup = !settings?.api_key_set

  container.innerHTML = `
    <div class="page" style="max-width:640px">
      <div class="page-header">
        <h1 class="page-title">${isSetup ? '⚙️ Setup' : 'Settings'}</h1>
        <p class="page-subtitle">${isSetup ? 'Configure your Riot API key to start tracking.' : 'Manage your Arena Tracker configuration.'}</p>
      </div>

      ${isSetup ? `
      <div class="settings-section" style="border-color:rgba(200,155,60,0.3);background:rgba(200,155,60,0.04);margin-bottom:18px">
        <div style="color:var(--accent-gold);font-size:0.875rem;line-height:1.7">
          <strong>How to get a free Riot API key:</strong><br>
          1. Visit <a href="#" onclick="window.open && window.open('https://developer.riotgames.com')" style="color:var(--accent-blue)">developer.riotgames.com</a><br>
          2. Log in with your Riot account<br>
          3. Copy the <strong>Development API Key</strong> (refreshes every 24 hours)<br>
          4. Paste it below
        </div>
      </div>` : ''}

      <div class="settings-section">
        <div class="settings-section-title">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
          Riot API Key
        </div>
        <div class="form-group">
          <label class="form-label">API Key ${settings?.api_key_set ? `<span style="color:var(--text-muted);font-weight:400">(currently: ${settings.api_key_preview})</span>` : '<span style="color:var(--accent-gold)">Required</span>'}</label>
          <div class="form-input-row">
            <input type="password" id="api-key-input" placeholder="${settings?.api_key_set ? 'Paste new key to update…' : 'RGAPI-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'}" style="font-family:monospace;font-size:0.8rem" />
            <button class="btn" onclick="toggleApiKeyVisibility()" style="flex-shrink:0;padding:0 12px" title="Show/hide key">👁</button>
          </div>
          <div class="form-hint">Dev keys expire every 24h. Get a new one at developer.riotgames.com</div>
        </div>
      </div>

      <div class="settings-section">
        <div class="settings-section-title">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
          Summoner
        </div>
        <div class="form-group">
          <label class="form-label">Game Name + Tag</label>
          <div class="form-input-row">
            <input type="text" id="summoner-name" placeholder="YourName" value="${settings?.summoner_name || ''}" />
            <input type="text" id="tag-line" placeholder="NA1" style="max-width:100px" value="${settings?.tag_line || ''}" />
          </div>
          <div class="form-hint">Example: PlayerName + NA1 for "PlayerName#NA1"</div>
        </div>
        <div class="form-group">
          <label class="form-label">Region</label>
          <select id="region-select">
            ${['na1','euw1','eun1','kr','br1','la1','la2','oc1','tr1','ru'].map(r =>
              `<option value="${r}" ${settings?.region === r ? 'selected' : ''}>${r.toUpperCase()}</option>`
            ).join('')}
          </select>
        </div>
      </div>

      <div class="settings-section">
        <div class="settings-section-title">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          Sync Settings
        </div>
        <div class="form-group">
          <label class="form-label">Auto-sync interval: <span id="sync-interval-label">${settings?.sync_interval || 120}s</span></label>
          <input type="range" id="sync-interval" min="60" max="1800" step="60" value="${settings?.sync_interval || 120}" style="width:100%" />
          <div class="form-hint">How often Arena Tracker checks for new games (60s – 30min)</div>
        </div>
      </div>

      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <button class="btn btn-primary" id="save-settings-btn">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
          Save & Connect
        </button>
        <button class="btn" id="test-conn-btn">Test Connection</button>
        <button class="btn btn-danger" id="clear-data-btn" style="margin-left:auto">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
          Clear All Data
        </button>
      </div>

      <div id="conn-result" style="margin-top:16px"></div>
    </div>`

  document.getElementById('sync-interval').oninput = e => {
    document.getElementById('sync-interval-label').textContent = e.target.value + 's'
  }

  document.getElementById('save-settings-btn').onclick = async () => {
    const btn = document.getElementById('save-settings-btn')
    btn.disabled = true
    btn.textContent = 'Saving...'
    const result = document.getElementById('conn-result')

    const apiKeyValue = document.getElementById('api-key-input').value.trim()
    const payload = {
      summoner_name: document.getElementById('summoner-name').value.trim(),
      tag_line: document.getElementById('tag-line').value.trim(),
      region: document.getElementById('region-select').value,
      sync_interval: document.getElementById('sync-interval').value,
    }
    if (apiKeyValue) payload.api_key = apiKeyValue

    if (!payload.summoner_name || !payload.tag_line) {
      result.innerHTML = '<div class="toast error" style="position:static;animation:none">Please fill in all required fields.</div>'
      btn.disabled = false
      btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg> Save & Connect'
      return
    }

    const res = await api('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })

    if (res?.success && res?.connected) {
      result.innerHTML = '<div class="toast success" style="position:static;animation:none">✓ Connected! Syncing your games now…</div>'
      toast('Settings saved. Syncing games...', 'success')
      setTimeout(() => navigate('dashboard'), 2000)
    } else if (res?.success && !res?.connected) {
      result.innerHTML = `<div class="toast error" style="position:static;animation:none">✓ Settings saved — but couldn't connect to Riot API: ${res?.error || 'Check your API key and summoner info.'}</div>`
    } else if (res === null) {
      result.innerHTML = `<div class="toast error" style="position:static;animation:none">✗ Could not reach backend (is it running?). Press Ctrl+Shift+I for details.</div>`
    } else {
      result.innerHTML = `<div class="toast error" style="position:static;animation:none">✗ ${res?.error || 'Failed to save settings.'}</div>`
    }

    btn.disabled = false
    btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg> Save & Connect'
  }

  document.getElementById('test-conn-btn').onclick = async () => {
    const result = document.getElementById('conn-result')
    result.innerHTML = '<div style="color:var(--text-muted)">Testing...</div>'
    const res = await api('/api/settings/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: document.getElementById('api-key-input').value.trim() || undefined,
        summoner_name: document.getElementById('summoner-name').value.trim(),
        tag_line: document.getElementById('tag-line').value.trim(),
        region: document.getElementById('region-select').value,
      }),
    })
    if (res?.success) {
      result.innerHTML = '<div class="toast success" style="position:static;animation:none">✓ Connection successful!</div>'
    } else {
      result.innerHTML = `<div class="toast error" style="position:static;animation:none">✗ ${res?.error || 'Connection failed'}</div>`
    }
  }

  document.getElementById('clear-data-btn').onclick = async () => {
    if (!confirm('Are you sure you want to delete ALL game data? This cannot be undone.')) return
    const res = await api('/api/data/clear', { method: 'POST' })
    if (res?.success) {
      toast('All game data cleared.', 'info')
      navigate('dashboard')
    }
  }
}

// ── 1st Place Collection ──────────────────────────────────────────────────────
async function loadWins(container) {
  const wins = await api('/api/stats/wins-collection' + modeParam())
  if (!wins) { container.innerHTML = '<div class="empty-state">Could not load data.</div>'; return }

  const total = wins.reduce((s, w) => s + w.win_count, 0)

  container.innerHTML = `
    <div class="page">
      <div class="page-header">
        <h1 class="page-title">1st Place Collection</h1>
        <p class="page-subtitle">
          ${wins.length === 0
            ? 'No wins yet — go get that first place!'
            : `${wins.length} champion${wins.length !== 1 ? 's' : ''} won with · ${total} total win${total !== 1 ? 's' : ''} this season`}
        </p>
      </div>
      ${wins.length === 0 ? `
        <div class="empty-state" style="margin-top:60px">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="48" height="48" style="opacity:0.3;margin-bottom:12px"><polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26"/></svg>
          <div>Win a game to start your collection!</div>
        </div>` : `
      <div class="wins-grid" id="wins-grid">
        ${wins.map(w => {
          const isRecord = w.max_damage === w.overall_max_damage
          return `
          <div class="win-card${isRecord ? ' win-card-record' : ''}">
            ${isRecord ? `<div class="win-record-banner">🏆 DMG RECORD</div>` : ''}
            <div class="win-card-img-wrap">
              <img src="${champIcon(w.champion_id)}" onerror="window.imgError(this)" alt="${w.champion_name}" />
              ${w.win_count > 1 ? `<span class="win-count-badge">×${w.win_count}</span>` : ''}
            </div>
            <div class="win-card-name">${w.champion_name}</div>
            <div class="win-card-winrate">${w.win_rate_pct}% win rate</div>
            <div class="win-card-dmg" title="Your best damage game on this champion">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="10" height="10"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
              ${w.max_damage.toLocaleString()}
            </div>
            <div class="win-card-date">${fmtDate(w.last_win)}</div>
          </div>`
        }).join('')}
      </div>
      <p style="margin-top:24px;color:var(--text-muted);font-size:0.8rem;text-align:center">
        Win rate = 1st place finishes ÷ total games on that champion. ⚡ = your highest damage game on that champion.
      </p>`}
    </div>`
}

function toggleApiKeyVisibility() {
  const input = document.getElementById('api-key-input')
  input.type = input.type === 'password' ? 'text' : 'password'
}

// ── Sync status polling ───────────────────────────────────────────────────────
async function updateSyncStatus() {
  const status = await api('/api/status')
  const dot = document.getElementById('sync-dot')
  const text = document.getElementById('sync-text')
  if (!dot || !text) return

  if (status?.backfilling) {
    dot.className = 'sync-dot syncing'
    text.textContent = 'Loading history…'
    document.getElementById('sync-btn')?.classList.add('spinning')
    if (!state.syncing) addNotification('Loading match history…', 'info')
    state.syncing = true
  } else if (status?.syncing) {
    dot.className = 'sync-dot syncing'
    text.textContent = 'Syncing...'
    document.getElementById('sync-btn')?.classList.add('spinning')
    if (!state.syncing) addNotification('Syncing new games…', 'info')
    state.syncing = true
  } else if (status?.last_error) {
    dot.className = 'sync-dot error'
    text.textContent = 'Sync error'
    document.getElementById('sync-btn')?.classList.remove('spinning')
    if (state.syncing) addNotification(`Sync error: ${status.last_error}`, 'error')
    state.syncing = false
  } else if (status?.last_synced) {
    dot.className = 'sync-dot ok'
    const mins = Math.floor((Date.now() - new Date(status.last_synced)) / 60000)
    text.textContent = mins < 1 ? 'Just synced' : `${mins}m ago`
    document.getElementById('sync-btn')?.classList.remove('spinning')
    if (state.syncing) addNotification(`Sync complete — ${status.game_count} games tracked`, 'success')
    state.syncing = false
  } else if (!status?.configured) {
    dot.className = 'sync-dot'
    text.textContent = 'Not configured'
  } else {
    dot.className = 'sync-dot'
    text.textContent = 'Ready'
  }
}

// ── Init ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  // Mode toggle
  document.getElementById('mode-toggle').addEventListener('click', e => {
    const btn = e.target.closest('.mode-btn')
    if (!btn) return
    document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'))
    btn.classList.add('active')
    state.mode = btn.dataset.mode
    navigate(state.currentPage)
  })

  // Nav clicks
  document.getElementById('nav-list').addEventListener('click', e => {
    const item = e.target.closest('.nav-item[data-page]')
    if (item) navigate(item.dataset.page)
  })
  document.getElementById('settings-nav-btn').addEventListener('click', () => navigate('settings'))

  // Notification panel toggle
  const notifBtn = document.getElementById('notif-btn')
  const notifPanel = document.getElementById('notif-panel')
  const notifClear = document.getElementById('notif-clear-btn')

  notifBtn.addEventListener('click', () => {
    state.notifOpen = !state.notifOpen
    notifPanel.classList.toggle('open', state.notifOpen)
    if (state.notifOpen) {
      state.notifUnread = 0
      const badge = document.getElementById('notif-badge')
      if (badge) badge.classList.remove('visible')
    }
  })

  notifClear.addEventListener('click', () => {
    state.notifications = []
    state.notifUnread = 0
    const badge = document.getElementById('notif-badge')
    if (badge) badge.classList.remove('visible')
    renderNotifications()
  })

  // Close panel when clicking outside
  document.addEventListener('click', (e) => {
    if (state.notifOpen && !notifPanel.contains(e.target) && !notifBtn.contains(e.target)) {
      state.notifOpen = false
      notifPanel.classList.remove('open')
    }
  })

  // Sync button
  document.getElementById('sync-btn').addEventListener('click', async () => {
    const btn = document.getElementById('sync-btn')
    btn.classList.add('spinning')
    await api('/api/sync', { method: 'POST' })
    toast('Sync started', 'info')
    setTimeout(updateSyncStatus, 1000)
  })

  // Load augment descriptions
  loadAugmentData()

  // Check if setup needed
  const status = await api('/api/status')
  if (!status?.configured) {
    navigate('settings')
  } else {
    navigate('dashboard')
  }

  // Sync status every 15s
  updateSyncStatus()
  setInterval(updateSyncStatus, 15000)

  // ── Auto-updater UI ──────────────────────────────────────────────────────
  if (window.electronAPI?.onUpdateStatus) {
    const patchOverlay = document.getElementById('patch-overlay')
    const patchLabel = document.getElementById('patch-label')
    const patchBar = document.getElementById('patch-bar')

    window.electronAPI.onUpdateStatus((status) => {
      if (status === 'downloading') {
        patchOverlay.style.display = 'flex'
        patchLabel.textContent = 'Patching...'
        addNotification('Downloading update…', 'info')
      } else if (status === 'ready') {
        patchLabel.textContent = 'Update Ready — Restarting...'
        addNotification('Update downloaded — restarting!', 'success')
        setTimeout(() => window.electronAPI.installUpdate(), 2000)
      }
    })

    window.electronAPI.onUpdateProgress((pct) => {
      patchBar.style.width = pct + '%'
      patchLabel.textContent = `Patching... ${pct}%`
    })
  }
})
