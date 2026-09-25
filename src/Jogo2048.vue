<template>
  <div
    ref="rootRef"
    class="ros-2048"
    :class="{ 'ros-2048--low': modoLeve }"
    :dir="estado.idioma === 'ar-AR' ? 'rtl' : 'ltr'"
    @pointerdown="onPointerDown"
    @pointerup="onPointerUp"
    @pointercancel="onPointerUp"
  >
    <canvas ref="canvasRef" class="ros-2048__canvas" />

    <!-- HUD -->
    <div v-if="status !== 'ready'" class="ros-2048__hud" aria-hidden="true">
      <div class="ros-2048__stat">
        <span class="ros-2048__stat-label">{{ txt('score') }}</span>
        <span class="ros-2048__stat-val">{{ score }}</span>
      </div>
      <div class="ros-2048__stat ros-2048__stat--best">
        <span class="ros-2048__stat-label">{{ txt('best') }}</span>
        <span class="ros-2048__stat-val">{{ best }}</span>
      </div>
    </div>

    <!-- top-right controls -->
    <div v-if="status !== 'ready'" class="ros-2048__top-actions">
      <button
        class="ros-2048__icon-btn"
        :aria-label="txt('newGame')"
        @pointerdown.stop
        @click.stop="start"
      >
        <Icone nome="reiniciar" :tamanho="18" />
      </button>
      <button
        class="ros-2048__icon-btn"
        :aria-label="txt('share')"
        @pointerdown.stop
        @click.stop="shareScore"
      >
        <Icone nome="compartilhar" :tamanho="18" />
      </button>
      <button
        class="ros-2048__icon-btn"
        :aria-label="muted ? txt('soundOff') : txt('soundOn')"
        @pointerdown.stop
        @click.stop="toggleMute"
      >
        <Icone :nome="muted ? 'mudo' : 'som'" :tamanho="18" />
      </button>
    </div>

    <!-- Start screen -->
    <div v-if="status === 'ready'" class="ros-2048__start">
      <div class="ros-2048__logo">2048</div>
      <div class="ros-2048__tagline">{{ txt('tagline') }}</div>
      <div v-if="best > 0" class="ros-2048__start-best">👑 {{ txt('best') }} · {{ best }}</div>
      <button class="ros-2048__play" @pointerdown.stop @click.stop="start">
        <Icone nome="jogar" :tamanho="22" />
        {{ txt('play') }}
      </button>
    </div>

    <!-- First-run hint -->
    <div v-if="showHint && status === 'playing'" class="ros-2048__hint" aria-hidden="true">
      {{ isTouch ? txt('hintTouch') : txt('hintKeys') }}
    </div>

    <!-- Win banner (keep going) -->
    <transition name="ros2048-pop">
      <div v-if="status === 'won'" class="ros-2048__overlay">
        <div class="ros-2048__overlay-title ros-2048__overlay-title--win">
          {{ txt('youWin') }}
        </div>
        <button class="ros-2048__play" @pointerdown.stop @click.stop="continuePlaying">
          {{ txt('keepGoing') }}
        </button>
      </div>
    </transition>

    <!-- Game over -->
    <transition name="ros2048-pop">
      <div v-if="status === 'gameover'" class="ros-2048__overlay">
        <div class="ros-2048__overlay-title">
          {{ isRecord ? txt('newRecord') : txt('over') }}
        </div>
        <div class="ros-2048__overlay-score">{{ score }}</div>
        <div class="ros-2048__overlay-best">👑 {{ txt('best') }} · {{ best }}</div>
        <button class="ros-2048__play" @pointerdown.stop @click.stop="start">
          <Icone nome="reiniciar" :tamanho="20" />
          {{ txt('retry') }}
        </button>
      </div>
    </transition>
  </div>
</template>

<script setup>
// O 2048. Fala com o sistema só pelo `host` do jogo-sdk: placar, áudio,
// modo leve, métricas e armazenamento chegam por ele, e é por isso que o mesmo
// arquivo roda dentro do RoqueOS, no `yarn dev` do repo e no teste.
import { onMounted, onUnmounted, ref } from 'vue'
import { emModoE2E } from '@roqueos-games/jogo-sdk'
import { createGame, move, tiles, keepGoing, SIZE } from './engine.js'
import { criarSom } from './som.js'
import { traduzir } from './textos.js'
import Icone from './Icone.vue'

const props = defineProps({
  /** O host do contrato v1 do jogo-sdk. */
  host: { type: Object, required: true },
  /** `{ ativo, idioma, textos }`, reativo; quem escreve é o `montar` do jogo. */
  estado: { type: Object, required: true },
})

const host = props.host
const txt = (chave, valores) => traduzir(props.estado.textos, chave, valores)

const rootRef = ref(null)
const canvasRef = ref(null)
const status = ref('ready') // ready | playing | won | gameover
const score = ref(0)
const best = ref(0)
const isRecord = ref(false)
const muted = ref(false)
const showHint = ref(false)
const isTouch = ref(false)
const modoLeve = ref(false)

let game = null
let ctx = null
let W = 0
let H = 0
let board = 0 // board pixel size (square)
let originX = 0
let originY = 0
let cellPx = 0
let gapPx = 0
let rafId = 0
let resizeObserver = null
let pararIdentidade = null
let recordeAoComecar = 0
let animT = 1 // 0..1 slide progress (1 = settled)
const ANIM = 0.11 // seconds per slide
let pop = [] // {r,c,t} merge/new pops
const pendingTimers = new Set()
const later = (fn, ms) => {
  const id = setTimeout(() => {
    pendingTimers.delete(id)
    fn()
  }, ms)
  pendingTimers.add(id)
  return id
}

// ── colour ramp ──────────────────────────────────────────────────────────────
const TILE_COLORS = {
  2: '#3b4a63',
  4: '#4a6180',
  8: '#f59e0b',
  16: '#f97316',
  32: '#ef4444',
  64: '#ec4899',
  128: '#a855f7',
  256: '#7c6cf0',
  512: '#3b82f6',
  1024: '#06b6d4',
  2048: '#22d3ee',
}
const tileColor = (v) => TILE_COLORS[v] || '#10b981'
const tileText = (v) => (v <= 4 ? '#eef2ff' : '#0b1020')

// ── audio (procedural) ───────────────────────────────────────────────────────
const som = criarSom(host.audio, () => muted.value)
// Chamado de dentro do gesto (toque, clique, tecla), sem `await` antes: o iOS
// só libera o áudio assim.
const primeAudio = () => {
  try {
    host.audio.destravar()?.catch?.(() => {})
  } catch {
    /* best-effort */
  }
}

// ── records ──────────────────────────────────────────────────────────────────
// As chaves `best` e `muted` viram `roqueos:game2048:best` e
// `roqueos:game2048:muted` no host, as mesmas de antes da extração: quem já
// jogava não perde o recorde, e a galeria continua lendo o best dali.
const loadLocal = () => {
  best.value = parseInt(host.armazenamento.ler('best') || '0', 10) || 0
  muted.value = host.armazenamento.ler('muted') === '1'
}
const persistBest = () => {
  host.armazenamento.gravar('best', String(best.value))
  Promise.resolve()
    .then(() => host.placar.salvar({ best: best.value }))
    .catch(() => {})
}
// O placar da conta ganha do local quando é maior, e o local sobe quando é o
// maior. Convidado não tem placar na conta: o host devolve null e ignora o
// salvar.
const syncRemote = async () => {
  try {
    const remoto = await host.placar.carregar()
    const daConta = Number(remoto?.best) || 0
    if (daConta > best.value) {
      best.value = daConta
      host.armazenamento.gravar('best', String(daConta))
    } else if (best.value > daConta) {
      await host.placar.salvar({ best: best.value })
    }
  } catch {
    /* offline */
  }
}
const toggleMute = () => {
  muted.value = !muted.value
  host.armazenamento.gravar('muted', muted.value ? '1' : '0')
}

// ── layout ───────────────────────────────────────────────────────────────────
const resize = () => {
  const el = rootRef.value
  const cv = canvasRef.value
  if (!el || !cv) return
  const dpr = Math.min(window.devicePixelRatio || 1, modoLeve.value ? 1.25 : 2)
  W = el.clientWidth
  H = el.clientHeight
  cv.width = Math.round(W * dpr)
  cv.height = Math.round(H * dpr)
  cv.style.width = W + 'px'
  cv.style.height = H + 'px'
  ctx = cv.getContext('2d')
  if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  board = Math.min(W - 32, H - 120)
  board = Math.max(160, board)
  originX = (W - board) / 2
  originY = (H - board) / 2 + 24
  gapPx = board * 0.03
  cellPx = (board - gapPx * (SIZE + 1)) / SIZE
}
const cellXY = (r, c) => ({
  x: originX + gapPx + c * (cellPx + gapPx),
  y: originY + gapPx + r * (cellPx + gapPx),
})

// ── input ────────────────────────────────────────────────────────────────────
let sx = 0
let sy = 0
let swiping = false
const doMove = (dir) => {
  if (!game || status.value !== 'playing') return
  const res = move(game, dir)
  if (!res.moved) return
  showHint.value = false
  animT = 0
  som.deslizar()
  syncState()
  if (res.gained > 0) {
    for (let r = 0; r < SIZE; r++)
      for (let c = 0; c < SIZE; c++) {
        const tt = game.grid[r][c]
        if (tt?.mergedFrom) pop.push({ r, c, t: 0 })
      }
    som.juntar(res.gained)
  }
  // new tile pop
  for (let r = 0; r < SIZE; r++)
    for (let c = 0; c < SIZE; c++) if (game.grid[r][c]?.isNew) pop.push({ r, c, t: 0 })
  if (game.status === 'won') onWin()
  else if (game.status === 'gameover') onGameOver()
}
const onPointerDown = (e) => {
  if (e.target.closest('button')) return
  primeAudio()
  if (status.value === 'ready' || status.value === 'gameover') {
    start()
    return
  }
  swiping = true
  sx = e.clientX
  sy = e.clientY
}
const onPointerUp = (e) => {
  if (!swiping) return
  swiping = false
  const dx = (e.clientX ?? sx) - sx
  const dy = (e.clientY ?? sy) - sy
  const ax = Math.abs(dx)
  const ay = Math.abs(dy)
  if (Math.max(ax, ay) < 24) return // a tap, not a swipe
  if (ax > ay) doMove(dx > 0 ? 'right' : 'left')
  else doMove(dy > 0 ? 'down' : 'up')
}
const KEYS = {
  ArrowUp: 'up',
  w: 'up',
  W: 'up',
  ArrowDown: 'down',
  s: 'down',
  S: 'down',
  ArrowLeft: 'left',
  a: 'left',
  A: 'left',
  ArrowRight: 'right',
  d: 'right',
  D: 'right',
}
// Só a janela ativa ouve o teclado. O ouvinte é do `window`, então com duas
// janelas de jogo abertas a seta moveria as duas; o `ativo` vem do host (a
// janela em foco, no RoqueOS).
const onKey = (e) => {
  if (e.type !== 'keydown' || !props.estado.ativo) return
  const dir = KEYS[e.key]
  if (!dir) return
  e.preventDefault()
  primeAudio()
  if (status.value === 'ready' || status.value === 'gameover') start()
  else doMove(dir)
}

// ── flow ─────────────────────────────────────────────────────────────────────
const syncState = () => {
  score.value = game.score
  if (game.best > best.value) best.value = game.best
}
const start = () => {
  primeAudio()
  game = createGame({ seed: Math.floor(Math.random() * 1e9) || 1 })
  game.best = best.value
  recordeAoComecar = best.value
  pop = []
  animT = 1
  isRecord.value = false
  status.value = 'playing'
  showHint.value = true
  later(() => (showHint.value = false), 3600)
  syncState()
  host.metricas.evento('game_start')
}
const continuePlaying = () => {
  keepGoing(game)
  status.value = 'playing'
}
const onWin = () => {
  status.value = 'won'
  som.venceu()
}
// "Novo recorde!" compara com o recorde de quando a partida COMEÇOU. Comparar
// com `best` não serve: o `syncState` de cada jogada já subiu o `best` junto
// com os pontos, então no fim `score > best` nunca era verdade e a tela dizia
// "Sem movimentos" até no recorde. Defeito do componente antigo, achado no QA
// da Onda 1 em 25/09/2026.
const onGameOver = () => {
  status.value = 'gameover'
  isRecord.value = game.score > recordeAoComecar
  if (game.score > best.value) best.value = game.score
  persistBest()
  som.perdeu()
  host.metricas.evento('game_over', { score: game.score })
}

// ── loop + render ────────────────────────────────────────────────────────────
let lastT = 0
const tick = (now) => {
  rafId = requestAnimationFrame(tick)
  const dt = lastT ? Math.min(0.05, (now - lastT) / 1000) : 0
  lastT = now
  if (animT < 1) animT = Math.min(1, animT + dt / ANIM)
  for (const p of pop) p.t = Math.min(1, p.t + dt / 0.18)
  pop = pop.filter((p) => p.t < 1)
  render()
}

const roundRect = (g, x, y, w, h, r) => {
  const rr = Math.min(r, w / 2, h / 2)
  g.beginPath()
  g.moveTo(x + rr, y)
  g.arcTo(x + w, y, x + w, y + h, rr)
  g.arcTo(x + w, y + h, x, y + h, rr)
  g.arcTo(x, y + h, x, y, rr)
  g.arcTo(x, y, x + w, y, rr)
  g.closePath()
}
const easeOut = (t) => 1 - Math.pow(1 - t, 3)

const render = () => {
  if (!ctx || !game) return
  const g = ctx
  g.clearRect(0, 0, W, H)
  const bg = g.createLinearGradient(0, 0, 0, H)
  bg.addColorStop(0, '#0d1326')
  bg.addColorStop(1, '#080b16')
  g.fillStyle = bg
  g.fillRect(0, 0, W, H)

  // board
  roundRect(g, originX, originY, board, board, 16)
  g.fillStyle = '#161d33'
  g.fill()
  // empty cells
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const { x, y } = cellXY(r, c)
      roundRect(g, x, y, cellPx, cellPx, 10)
      g.fillStyle = 'rgba(255,255,255,0.045)'
      g.fill()
    }
  }

  // tiles
  const e = easeOut(animT)
  for (const tl of tiles(game)) {
    const from = tl.prev || { r: tl.r, c: tl.c }
    const rr = from.r + (tl.r - from.r) * e
    const cc = from.c + (tl.c - from.c) * e
    const x = originX + gapPx + cc * (cellPx + gapPx)
    const y = originY + gapPx + rr * (cellPx + gapPx)
    // pop scale
    let sc = 1
    const pp = pop.find((p) => p.r === tl.r && p.c === tl.c)
    if (pp) sc = 1 + Math.sin(pp.t * Math.PI) * 0.14
    const size = cellPx * sc
    const off = (cellPx - size) / 2
    g.save()
    if (!modoLeve.value && tl.value >= 128) {
      g.shadowColor = tileColor(tl.value)
      g.shadowBlur = 18
    }
    roundRect(g, x + off, y + off, size, size, 10)
    g.fillStyle = tileColor(tl.value)
    g.fill()
    g.restore()
    // number
    g.fillStyle = tileText(tl.value)
    const digits = String(tl.value).length
    g.font = `800 ${Math.round(cellPx * (digits > 3 ? 0.3 : digits > 2 ? 0.36 : 0.44))}px system-ui, sans-serif`
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.fillText(String(tl.value), x + cellPx / 2, y + cellPx / 2 + 1)
  }
}

// ── share ────────────────────────────────────────────────────────────────────
const shareScore = async () => {
  const text = txt('shareText', { score: score.value })
  try {
    if (navigator.share) await navigator.share({ text, title: '2048' })
  } catch {
    /* cancelled */
  }
}

onMounted(() => {
  modoLeve.value = Boolean(host.desempenho.modoLeve())
  isTouch.value = 'ontouchstart' in window || navigator.maxTouchPoints > 0
  loadLocal()
  game = createGame({ seed: 1 })
  resize()
  syncRemote()
  // Quem entra na conta com o jogo aberto vê o recorde da conta sem reabrir.
  pararIdentidade = host.identidade.aoMudar(() => syncRemote())
  lastT = 0
  rafId = requestAnimationFrame(tick)
  resizeObserver = new ResizeObserver(resize)
  resizeObserver.observe(rootRef.value)
  window.addEventListener('keydown', onKey)

  if (emModoE2E()) {
    window.__game2048 = {
      get state() {
        return game
      },
      start,
      move: (dir) => doMove(dir),
      // Cover aid: a lively board with a good spread of tiles.
      stage: () => {
        start()
        status.value = 'playing'
        game.score = 6420
        score.value = 6420
        const layout = [
          [2, 32, 4, 2],
          [8, 256, 64, 16],
          [128, 512, 1024, 8],
          [4, 16, 32, 2],
        ]
        game.grid = layout.map((row, r) =>
          row.map((v, c) => ({ id: game._nextId++, value: v, r, c, prev: { r, c } })),
        )
        animT = 1
      },
    }
  }
})

onUnmounted(() => {
  if (rafId) cancelAnimationFrame(rafId)
  for (const id of pendingTimers) clearTimeout(id)
  pendingTimers.clear()
  resizeObserver?.disconnect()
  pararIdentidade?.()
  window.removeEventListener('keydown', onKey)
  if (emModoE2E()) delete window.__game2048
})
</script>

<style scoped lang="scss">
.ros-2048 {
  // Cores de identidade do jogo, como custom property para que um tema consiga
  // alcançá-las. As quatro de texto herdam o token do RoqueOS quando ele existe
  // e caem num valor próprio quando o jogo roda sozinho, porque fora do
  // RoqueOS não há `tokens-root.scss` nenhum carregado.
  --ros-2048-texto: var(--ros-text-100, #ffffff);
  --ros-2048-texto-50: var(--ros-text-50, rgba(255, 255, 255, 0.5));
  --ros-2048-texto-70: var(--ros-text-70, rgba(255, 255, 255, 0.7));
  --ros-2048-texto-72: var(--ros-text-72, rgba(255, 255, 255, 0.72));
  --ros-2048-branco-rgb: var(--ros-white-rgb, 255, 255, 255);
  --ros-2048-bg-1: #080b16;
  --ros-2048-bg-2: rgba(22, 29, 51, 0.85);
  --ros-2048-bg-3: rgba(22, 29, 51, 0.7);
  --ros-2048-bg-4: rgba(40, 52, 88, 0.8);
  --ros-2048-bg-5: rgba(13, 19, 38, 0.4);
  --ros-2048-bg-6: rgba(8, 11, 22, 0.9);
  --ros-2048-bg-7: #22d3ee;
  --ros-2048-bg-8: #a855f7;
  --ros-2048-bg-9: #f59e0b;
  --ros-2048-shadow-1: rgba(34, 211, 238, 0.3);
  --ros-2048-fg-1: #ffd23f;
  --ros-2048-fg-2: #06121a;
  --ros-2048-bg-10: #67e8f9;
  --ros-2048-shadow-2: rgba(34, 211, 238, 0.4);
  --ros-2048-shadow-3: rgba(34, 211, 238, 0.6);
  --ros-2048-bg-11: rgba(13, 19, 38, 0.7);
}

.ros-2048 {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  user-select: none;
  -webkit-user-select: none;
  -webkit-touch-callout: none;
  -webkit-tap-highlight-color: transparent;
  touch-action: none;
  cursor: pointer;
  background: var(--ros-2048-bg-1);
  color: var(--ros-2048-texto);

  &__canvas {
    position: absolute;
    inset: 0;
    display: block;
  }

  &__hud {
    position: absolute;
    top: 12px;
    left: 16px;
    display: flex;
    gap: 10px;
    z-index: 3;
    pointer-events: none;
  }
  &__stat {
    background: var(--ros-2048-bg-2);
    border-radius: 10px;
    padding: 5px 14px;
    display: flex;
    flex-direction: column;
    align-items: center;
    min-width: 70px;
  }
  &__stat-label {
    font-size: 9px;
    letter-spacing: 1.4px;
    text-transform: uppercase;
    color: var(--ros-2048-texto-50);
  }
  &__stat-val {
    font-size: 20px;
    font-weight: 800;
  }

  &__top-actions {
    position: absolute;
    top: 12px;
    right: 12px;
    display: flex;
    gap: 8px;
    z-index: 6;
  }
  &__icon-btn {
    width: 34px;
    height: 34px;
    display: grid;
    place-items: center;
    border-radius: 10px;
    border: 1px solid rgba(var(--ros-2048-branco-rgb), 0.16);
    background: var(--ros-2048-bg-3);
    color: rgba(var(--ros-2048-branco-rgb), 0.86);
    cursor: pointer;
    &:hover {
      background: var(--ros-2048-bg-4);
    }
  }

  &__start,
  &__overlay {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 14px;
    z-index: 5;
    text-align: center;
    padding: 20px;
    background: radial-gradient(120% 90% at 50% 42%, var(--ros-2048-bg-5), var(--ros-2048-bg-6));
  }
  &__logo {
    font-size: 64px;
    font-weight: 900;
    letter-spacing: 2px;
    background: linear-gradient(
      120deg,
      var(--ros-2048-bg-7),
      var(--ros-2048-bg-8) 60%,
      var(--ros-2048-bg-9)
    );
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
    text-shadow: 0 0 44px var(--ros-2048-shadow-1);
  }
  &__tagline {
    font-size: 15px;
    color: var(--ros-2048-texto-72);
    max-width: 320px;
  }
  &__start-best,
  &__overlay-best {
    font-size: 14px;
    color: var(--ros-2048-fg-1);
    font-weight: 700;
  }
  &__play {
    margin-top: 6px;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 12px 30px;
    border: none;
    border-radius: 999px;
    font-size: 17px;
    font-weight: 800;
    color: var(--ros-2048-fg-2);
    background: linear-gradient(120deg, var(--ros-2048-bg-10), var(--ros-2048-bg-7));
    box-shadow: 0 10px 30px var(--ros-2048-shadow-2);
    cursor: pointer;
    transition: transform 0.12s ease;
    &:hover {
      transform: translateY(-2px);
    }
  }
  &__overlay-title {
    font-size: 30px;
    font-weight: 900;
    &--win {
      color: var(--ros-2048-bg-7);
      text-shadow: 0 0 24px var(--ros-2048-shadow-3);
    }
  }
  &__overlay-score {
    font-size: 58px;
    font-weight: 900;
    line-height: 1;
    color: var(--ros-2048-bg-9);
  }
  &__hint {
    position: absolute;
    bottom: 18px;
    left: 50%;
    transform: translateX(-50%);
    font-size: 13px;
    color: var(--ros-2048-texto-70);
    background: var(--ros-2048-bg-11);
    padding: 7px 16px;
    border-radius: 999px;
    pointer-events: none;
    z-index: 4;
  }
}

.ros2048-pop-enter-active {
  transition: all 0.3s cubic-bezier(0.2, 1.3, 0.5, 1);
}
.ros2048-pop-enter-from {
  opacity: 0;
  transform: scale(0.8);
}
// O perfil leve vem do host (`desempenho.modoLeve`), não do atributo que o
// RoqueOS põe no <html>: fora do RoqueOS esse atributo não existe.
.ros-2048--low .ros-2048__logo {
  text-shadow: none;
}
</style>
