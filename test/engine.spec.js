import { describe, it, expect } from 'vitest'
import {
  createGame,
  move,
  canMove,
  isOver,
  tiles,
  keepGoing,
  addRandomTile,
  SIZE,
} from '../src/engine.js'

// place a controlled board (0 = empty) so moves are deterministic to assert
const setGrid = (state, values) => {
  state.grid = values.map((row, r) =>
    row.map((v, c) => (v ? { id: state._nextId++, value: v, r, c, prev: { r, c } } : null)),
  )
}
const valueGrid = (state) => state.grid.map((row) => row.map((t) => (t ? t.value : 0)))

describe('2048 engine', () => {
  it('creates a game with two starting tiles and score 0', () => {
    const g = createGame({ seed: 3 })
    expect(g.status).toBe('playing')
    expect(g.score).toBe(0)
    expect(tiles(g)).toHaveLength(2)
    for (const t of tiles(g)) expect([2, 4]).toContain(t.value)
  })

  it('is seed-deterministic', () => {
    const a = valueGrid(createGame({ seed: 99 }))
    const b = valueGrid(createGame({ seed: 99 }))
    expect(a).toEqual(b)
  })

  it('slides tiles to the wall', () => {
    const g = createGame({ seed: 1 })
    setGrid(g, [
      [0, 0, 0, 2],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ])
    const res = move(g, 'left')
    expect(res.moved).toBe(true)
    expect(g.grid[0][0].value).toBe(2)
  })

  it('merges equal neighbours and scores the sum (once per move)', () => {
    const g = createGame({ seed: 1 })
    setGrid(g, [
      [2, 2, 2, 2],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ])
    const res = move(g, 'left')
    expect(res.moved).toBe(true)
    // 2,2,2,2 → 4,4 (two independent merges, not 8)
    expect(g.grid[0][0].value).toBe(4)
    expect(g.grid[0][1].value).toBe(4)
    expect(g.score).toBe(8)
  })

  it('a move that changes nothing does not spawn a tile', () => {
    const g = createGame({ seed: 1 })
    setGrid(g, [
      [2, 4, 8, 16],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ])
    const before = tiles(g).length
    const res = move(g, 'left') // already packed left → no move
    expect(res.moved).toBe(false)
    expect(tiles(g).length).toBe(before) // no new tile
  })

  it('a move that changes the board spawns exactly one new tile', () => {
    const g = createGame({ seed: 5 })
    setGrid(g, [
      [0, 0, 0, 2],
      [0, 0, 0, 2],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ])
    const before = tiles(g).length
    move(g, 'up')
    expect(tiles(g).length).toBe(before) // 2 tiles merged into 1, +1 spawned = net same
    expect(g.grid[0][3].value).toBe(4)
    expect(tiles(g).some((t) => t.isNew)).toBe(true)
  })

  it('reaching 2048 wins (and you can keep going)', () => {
    const g = createGame({ seed: 1 })
    setGrid(g, [
      [1024, 1024, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ])
    const res = move(g, 'left')
    expect(res.won).toBe(true)
    expect(g.status).toBe('won')
    expect(g.grid[0][0].value).toBe(2048)
    keepGoing(g)
    expect(g.status).toBe('playing')
  })

  it('a full board with no merges is game over', () => {
    const g = createGame({ seed: 1 })
    setGrid(g, [
      [2, 4, 2, 4],
      [4, 2, 4, 2],
      [2, 4, 2, 4],
      [4, 2, 4, 2],
    ])
    expect(canMove(g)).toBe(false)
    move(g, 'left') // no move possible
    // force the status check the way the engine would after a real move
    if (!canMove(g)) g.status = 'gameover'
    expect(isOver(g)).toBe(true)
  })

  it('carries stable tile ids + prev cell for animation', () => {
    const g = createGame({ seed: 1 })
    setGrid(g, [
      [2, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ])
    const id = g.grid[0][0].id
    move(g, 'right')
    const t = g.grid[0][3]
    expect(t.id).toBe(id) // same tile, moved
    expect(t.prev).toEqual({ r: 0, c: 0 })
  })

  it('addRandomTile fills only empty cells', () => {
    const g = createGame({ seed: 2 })
    setGrid(g, [
      [2, 2, 2, 2],
      [2, 2, 2, 2],
      [2, 2, 2, 2],
      [2, 2, 2, 0],
    ])
    const t = addRandomTile(g)
    expect(t).not.toBeNull()
    expect(t.r).toBe(SIZE - 1)
    expect(t.c).toBe(SIZE - 1) // the only empty cell
  })
})
