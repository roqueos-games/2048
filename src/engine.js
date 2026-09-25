/**
 * 2048 — pure, deterministic engine for the RoqueOS Games gallery.
 *
 * The classic slide-and-merge puzzle on a 4×4 grid: move all tiles one way,
 * equal neighbours merge into their sum, a new 2 (or 4) appears, reach the 2048
 * tile to win (and keep going for a higher score). Framework-free and
 * seed-deterministic (mulberry32) so it's fully unit-testable and the cover bot
 * can drive a reproducible frame.
 *
 * Tiles keep a stable id + their previous cell + merge/new flags so the
 * component can animate slides, merge-pops and spawns. No Vue / DOM / timers /
 * Math.random in here.
 */

export function mulberry32(seed) {
  let a = seed >>> 0
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export const SIZE = 4
export const WIN_VALUE = 2048

const emptyGrid = () => Array.from({ length: SIZE }, () => Array.from({ length: SIZE }, () => null))

const emptyCells = (grid) => {
  const out = []
  for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) if (!grid[r][c]) out.push({ r, c })
  return out
}

/** Add a random tile (90% → 2, 10% → 4) to an empty cell. Returns it or null. */
export function addRandomTile(state) {
  const cells = emptyCells(state.grid)
  if (!cells.length) return null
  const cell = cells[Math.floor(state.rng() * cells.length)]
  const value = state.rng() < 0.9 ? 2 : 4
  const tile = { id: state._nextId++, value, r: cell.r, c: cell.c, isNew: true, mergedFrom: null }
  tile.prev = { r: cell.r, c: cell.c }
  state.grid[cell.r][cell.c] = tile
  return tile
}

/** Build a fresh game with two starting tiles. */
export function createGame({ seed = 1, rng } = {}) {
  const state = {
    grid: emptyGrid(),
    score: 0,
    best: 0,
    status: 'playing', // playing | won | gameover
    won: false, // reached 2048 at least once (won banner already shown)
    size: SIZE,
    rng: rng || mulberry32(seed),
    _nextId: 1,
  }
  addRandomTile(state)
  addRandomTile(state)
  return state
}

// traversal orders so tiles closest to the wall move first
const traversals = (dir) => {
  const idx = [0, 1, 2, 3]
  const rows = dir === 'down' ? [...idx].reverse() : idx
  const cols = dir === 'right' ? [...idx].reverse() : idx
  return { rows, cols }
}
const VECT = {
  up: { dr: -1, dc: 0 },
  down: { dr: 1, dc: 0 },
  left: { dr: 0, dc: -1 },
  right: { dr: 0, dc: 1 },
}

const inBounds = (r, c) => r >= 0 && r < SIZE && c >= 0 && c < SIZE

/**
 * Slide/merge the board one direction. Mutates state; returns
 * { moved, gained, won } (component animates from each tile's `prev`).
 */
export function move(state, dir) {
  if (state.status === 'gameover' || !VECT[dir]) return { moved: false, gained: 0, won: false }
  const v = VECT[dir]
  const { rows, cols } = traversals(dir)
  // reset per-move animation flags
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const t = state.grid[r][c]
      if (t) {
        t.prev = { r, c }
        t.isNew = false
        t.mergedFrom = null
      }
    }
  }
  let moved = false
  let gained = 0
  let reached = false

  for (const r of rows) {
    for (const c of cols) {
      const tile = state.grid[r][c]
      if (!tile) continue
      // find the farthest cell + the cell beyond (a possible merge target)
      let nr = r
      let nc = c
      let next = { r: r + v.dr, c: c + v.dc }
      while (inBounds(next.r, next.c) && !state.grid[next.r][next.c]) {
        nr = next.r
        nc = next.c
        next = { r: nr + v.dr, c: nc + v.dc }
      }
      const target = inBounds(next.r, next.c) ? state.grid[next.r][next.c] : null
      if (target && target.value === tile.value && !target.mergedFrom) {
        // merge into the target
        const merged = {
          id: target.id,
          value: tile.value * 2,
          r: next.r,
          c: next.c,
          isNew: false,
          mergedFrom: [tile.id, target.id],
          prev: { r, c }, // this tile slides into the merge cell
        }
        state.grid[next.r][next.c] = merged
        state.grid[r][c] = null
        gained += merged.value
        if (merged.value >= WIN_VALUE) reached = true
        moved = true
      } else if (nr !== r || nc !== c) {
        // slide into the farthest empty cell
        state.grid[nr][nc] = tile
        state.grid[r][c] = null
        tile.r = nr
        tile.c = nc
        moved = true
      }
    }
  }

  if (moved) {
    state.score += gained
    // Math.max: reatribuir um recorde IGUAL não muda nada, então `>` e `>=`
    // decidiam o mesmo e a comparação solta deixava um mutante impossível de matar.
    state.best = Math.max(state.best, state.score)
    addRandomTile(state)
    if (reached && !state.won) {
      state.won = true
      state.status = 'won'
    }
    if (!canMove(state)) state.status = 'gameover'
  }
  return { moved, gained, won: reached }
}

/** True while at least one slide or merge is still possible. */
export function canMove(state) {
  if (emptyCells(state.grid).length) return true
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const t = state.grid[r][c]
      if (!t) continue
      for (const d of Object.values(VECT)) {
        const nr = r + d.dr
        const nc = c + d.dc
        if (inBounds(nr, nc) && state.grid[nr][nc]?.value === t.value) return true
      }
    }
  }
  return false
}

export const isOver = (state) => state.status === 'gameover'

/** Flat list of live tiles (handy for the renderer). */
export function tiles(state) {
  const out = []
  for (let r = 0; r < SIZE; r++)
    for (let c = 0; c < SIZE; c++) if (state.grid[r][c]) out.push(state.grid[r][c])
  return out
}

/** Continue past 2048 (dismiss the win banner, keep playing for score). */
export function keepGoing(state) {
  if (state.status === 'won') state.status = 'playing'
}
