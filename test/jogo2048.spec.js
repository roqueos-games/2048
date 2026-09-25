// O 2048 inteiro, montado pelo contrato do jogo-sdk com o host falso.
//
// Nenhum mock de store, de analytics ou de i18n do RoqueOS: se o jogo ainda
// alcançasse algo do RoqueOS, este arquivo não rodaria fora dele. É o mesmo teste
// que rodava no front antes da extração, em 25/09/2026.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { nextTick } from 'vue'
import { VERSAO_DO_CONTRATO } from '@roqueos-games/jogo-sdk'
import { criarHostFalso } from '@roqueos-games/jogo-sdk/host-falso'
import jogo from '../src/index.js'
import ptBR from '../i18n/pt-BR.json'
import enUS from '../i18n/en-US.json'
import tela from '../src/Jogo2048.vue?raw'

const ctx2d = () =>
  new Proxy(
    {},
    {
      get: (_t, p) => {
        if (p === 'createLinearGradient' || p === 'createRadialGradient')
          return () => ({ addColorStop() {} })
        if (p === 'canvas') return { width: 300, height: 150 }
        return () => {}
      },
      set: () => true,
    },
  )

let el = null
let host = null
let montagem = null

const palco = () => {
  el = document.createElement('div')
  document.body.appendChild(el)
  return el
}
const montou = () =>
  vi.waitFor(() => {
    if (!el.querySelector('.ros-2048')) throw new Error('o 2048 ainda não montou')
  })
const montar = async ({ ativo = true, ...opcoesDoHost } = {}) => {
  host = criarHostFalso({ jogoId: 'game2048', ...opcoesDoHost })
  montagem = jogo.mount(palco(), host, { windowId: 'w1', ativo })
  // O app só monta com o texto do idioma carregado.
  await montou()
  await nextTick()
}
const $ = (sel) => el.querySelector(sel)
const eventos = (nome) =>
  host.chamadas.filter((c) => c.capacidade === 'metricas' && c.args[0] === nome)
const tecla = (key) => window.dispatchEvent(new KeyboardEvent('keydown', { key }))
const pecas = (st) => st.grid.flat().filter(Boolean).length

describe('2048 pelo jogo-sdk', () => {
  let origCtx
  beforeEach(() => {
    window.__ROS_E2E__ = {}
    origCtx = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = vi.fn(() => ctx2d())
    vi.stubGlobal('requestAnimationFrame', () => 1)
    vi.stubGlobal('cancelAnimationFrame', () => {})
  })
  afterEach(() => {
    montagem?.desmontar()
    el?.remove()
    montagem = null
    el = null
    host = null
    HTMLCanvasElement.prototype.getContext = origCtx
    delete window.__ROS_E2E__
    delete window.__game2048
    vi.unstubAllGlobals()
  })

  it('é um jogo do SDK, com o id que o catálogo e o recorde usam', () => {
    expect(jogo.id).toBe('game2048')
    expect(jogo.versaoDoContrato).toBe(VERSAO_DO_CONTRATO)
    expect(jogo.capacidades).toEqual([])
  })

  it('abre na tela inicial, com o texto do idioma do host', async () => {
    await montar()
    expect($('.ros-2048__logo').textContent).toBe('2048')
    expect($('.ros-2048__play').textContent).toContain(ptBR.play)
    expect($('.ros-2048__tagline').textContent).toBe(ptBR.tagline)
    expect($('.ros-2048__hud')).toBeNull()
  })

  it('fala o idioma do host, e troca quando o host troca', async () => {
    await montar({ idioma: 'en-US' })
    expect($('.ros-2048__play').textContent).toContain(enUS.play)
    host.disparar('idioma', 'pt-BR')
    await vi.waitFor(() => expect($('.ros-2048__play').textContent).toContain(ptBR.play))
  })

  it('começar dá duas peças, mostra o placar e registra game_start', async () => {
    await montar()
    window.__game2048.start()
    await nextTick()
    const st = window.__game2048.state
    expect(st.status).toBe('playing')
    expect(pecas(st)).toBe(2)
    expect($('.ros-2048__hud')).not.toBeNull()
    expect(eventos('game_start').map((c) => c.args)).toEqual([['game_start', {}]])
  })

  it('um movimento pelo gancho desliza e junta', async () => {
    await montar()
    window.__game2048.start()
    const st = window.__game2048.state
    st.grid = [
      [{ id: 1, value: 2, r: 0, c: 0, prev: { r: 0, c: 0 } }, null, null, null],
      [{ id: 2, value: 2, r: 1, c: 0, prev: { r: 1, c: 0 } }, null, null, null],
      [null, null, null, null],
      [null, null, null, null],
    ]
    window.__game2048.move('up')
    await nextTick()
    expect(st.grid[0][0].value).toBe(4)
    expect(st.score).toBeGreaterThanOrEqual(4)
  })

  it('stage() monta o tabuleiro cheio da capa', async () => {
    await montar()
    window.__game2048.stage()
    await nextTick()
    const st = window.__game2048.state
    expect(pecas(st)).toBe(16)
    expect(st.score).toBeGreaterThan(0)
  })

  // Um tabuleiro cheio que só anda para a esquerda e trava, seja 2 ou 4 a peça
  // que nascer no canto: nenhuma vizinha dela é 2 nem 4.
  const travarNoFim = (st, pontos) => {
    const L = [
      [8, 16, 8, 16],
      [16, 8, 16, 8],
      [8, 16, 8, 16],
      [0, 32, 64, 128],
    ]
    st.grid = L.map((l, r) =>
      l.map((v, c) => (v ? { id: 900 + r * 4 + c, value: v, r, c, prev: { r, c } } : null)),
    )
    st.score = pontos
  }

  it('fim de jogo acima do recorde de quando começou é "Novo recorde!", e o recorde sobe', async () => {
    host = criarHostFalso({ jogoId: 'game2048' })
    host.storage.setItem('roqueos:game2048:best', '100')
    montagem = jogo.mount(palco(), host, { ativo: true })
    await montou()
    window.__game2048.start()
    travarNoFim(window.__game2048.state, 5000)
    window.__game2048.move('left')
    await nextTick()
    expect(window.__game2048.state.status).toBe('gameover')
    expect($('.ros-2048__overlay-title').textContent.trim()).toBe(ptBR.newRecord)
    expect(host.storage.getItem('roqueos:game2048:best')).toBe('5000')
    await vi.waitFor(async () => expect(await host.placar.carregar()).toEqual({ best: 5000 }))
    expect(eventos('game_over').map((c) => c.args)).toEqual([['game_over', { score: 5000 }]])
  })

  it('fim de jogo abaixo do recorde é "Sem movimentos", e o recorde fica', async () => {
    host = criarHostFalso({ jogoId: 'game2048' })
    host.storage.setItem('roqueos:game2048:best', '9000')
    montagem = jogo.mount(palco(), host, { ativo: true })
    await montou()
    window.__game2048.start()
    travarNoFim(window.__game2048.state, 5000)
    window.__game2048.move('left')
    await nextTick()
    expect($('.ros-2048__overlay-title').textContent.trim()).toBe(ptBR.over)
    expect(host.storage.getItem('roqueos:game2048:best')).toBe('9000')
  })

  it('o som liga e desliga na mesma chave de antes da extração', async () => {
    await montar()
    window.__game2048.start()
    await nextTick()
    const botoes = el.querySelectorAll('.ros-2048__icon-btn')
    botoes[botoes.length - 1].click()
    expect(host.storage.getItem('roqueos:game2048:muted')).toBe('1')
    botoes[botoes.length - 1].click()
    expect(host.storage.getItem('roqueos:game2048:muted')).toBe('0')
  })

  it('o recorde da conta maior que o local vem para a tela e para a chave da galeria', async () => {
    host = criarHostFalso({ jogoId: 'game2048' })
    await host.placar.salvar({ best: 5000 })
    montagem = jogo.mount(palco(), host, { ativo: true })
    await montou()
    await vi.waitFor(() => expect(host.storage.getItem('roqueos:game2048:best')).toBe('5000'))
    await nextTick()
    expect($('.ros-2048__start-best').textContent).toContain('5000')
  })

  it('o recorde local maior que o da conta sobe para a conta', async () => {
    host = criarHostFalso({ jogoId: 'game2048' })
    host.storage.setItem('roqueos:game2048:best', '3000')
    montagem = jogo.mount(palco(), host, { ativo: true })
    await montou()
    await vi.waitFor(async () => expect(await host.placar.carregar()).toEqual({ best: 3000 }))
  })

  it('entrar na conta com o jogo aberto busca o recorde da conta de novo', async () => {
    await montar()
    await vi.waitFor(() => expect(host.contar('placar', 'carregar')).toBe(1))
    host.disparar('identidade', { uid: 'u1', nome: 'Ana' })
    await vi.waitFor(() => expect(host.contar('placar', 'carregar')).toBe(2))
  })

  it('só a janela ativa ouve o teclado', async () => {
    await montar({ ativo: false })
    tecla('ArrowUp')
    await nextTick()
    expect(eventos('game_start')).toHaveLength(0)
    expect($('.ros-2048__start')).not.toBeNull()

    montagem.ativar(true)
    tecla('ArrowUp')
    await nextTick()
    expect(eventos('game_start')).toHaveLength(1)
    expect($('.ros-2048__start')).toBeNull()
  })

  it('o perfil leve do host chega no jogo', async () => {
    await montar({ modoLeve: true })
    expect($('.ros-2048').classList.contains('ros-2048--low')).toBe(true)
  })

  it('desmontar solta tudo: o gancho, a tela e o teclado', async () => {
    await montar()
    montagem.desmontar()
    expect(window.__game2048).toBeUndefined()
    expect(el.querySelector('.ros-2048')).toBeNull()
    tecla('ArrowUp')
    expect(eventos('game_start')).toHaveLength(0)
    // Desmontar de novo acontece de verdade (a janela fecha e o componente em
    // volta desmonta depois) e não pode lançar.
    expect(() => montagem.desmontar()).not.toThrow()
  })

  it('desmontar antes de o texto chegar não monta nada depois', async () => {
    host = criarHostFalso({ jogoId: 'game2048' })
    montagem = jogo.mount(palco(), host, { ativo: true })
    montagem.desmontar()
    await new Promise((r) => setTimeout(r, 50))
    expect(el.querySelector('.ros-2048')).toBeNull()
  })

  it('toda chave que a tela usa existe no pt-BR', () => {
    const usadas = [...tela.matchAll(/txt\('([\w.]+)'/g)].map((m) => m[1])
    expect(usadas.length).toBeGreaterThan(10)
    const faltando = usadas.filter((k) => typeof ptBR[k] !== 'string')
    expect(faltando).toEqual([])
  })
})
