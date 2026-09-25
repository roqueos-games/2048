// O som do 2048, procedural: nenhum arquivo de áudio, só osciladores. O
// AudioContext é do host (no RoqueOS, o compartilhado com os apps de música;
// fora dele, um próprio), e o jogo só toca quando o contexto já está rodando,
// porque tocar num contexto suspenso enfileira som que sai tudo junto depois.

/**
 * @param {{ contexto: () => AudioContext | null }} audio a capacidade `audio` do host
 * @param {() => boolean} estaMudo
 */
export function criarSom(audio, estaMudo) {
  let volume = null
  let dono = null

  const contexto = () => {
    if (estaMudo()) return null
    try {
      const c = audio.contexto()
      if (!c || c.state !== 'running') return null
      // O ganho mestre pertence a UM contexto. Se o host trocar de contexto
      // (o iOS fecha o antigo ao voltar do fundo), recria em vez de ligar num
      // nó morto.
      if (dono !== c) {
        volume = c.createGain()
        volume.gain.value = 0.5
        volume.connect(c.destination)
        dono = c
      }
      return c
    } catch {
      return null
    }
  }

  const envelope = (c, t0, pico, queda) => {
    const g = c.createGain()
    g.gain.setValueAtTime(0.0001, t0)
    g.gain.exponentialRampToValueAtTime(pico, t0 + 0.008)
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + queda)
    g.connect(volume)
    return g
  }

  return {
    deslizar() {
      const c = contexto()
      if (!c) return
      const agora = c.currentTime
      const o = c.createOscillator()
      o.type = 'sine'
      o.frequency.setValueAtTime(200, agora)
      o.frequency.exponentialRampToValueAtTime(140, agora + 0.08)
      o.connect(envelope(c, agora, 0.05, 0.09))
      o.start(agora)
      o.stop(agora + 0.1)
    },
    juntar(valor) {
      const c = contexto()
      if (!c) return
      const agora = c.currentTime
      const passo = Math.min(12, Math.log2(valor)) // o tom sobe com a peça
      const o = c.createOscillator()
      o.type = 'triangle'
      o.frequency.setValueAtTime(220 * Math.pow(2, passo / 12), agora)
      o.frequency.exponentialRampToValueAtTime(330 * Math.pow(2, passo / 12), agora + 0.1)
      o.connect(envelope(c, agora, 0.14, 0.16))
      o.start(agora)
      o.stop(agora + 0.2)
    },
    venceu() {
      const c = contexto()
      if (!c) return
      const agora = c.currentTime
      ;[0, 4, 7, 12].forEach((semitom, i) => {
        const o = c.createOscillator()
        o.type = 'triangle'
        o.frequency.value = 523 * Math.pow(2, semitom / 12)
        o.connect(envelope(c, agora + i * 0.1, 0.16, 0.32))
        o.start(agora + i * 0.1)
        o.stop(agora + i * 0.1 + 0.34)
      })
    },
    perdeu() {
      const c = contexto()
      if (!c) return
      const agora = c.currentTime
      const o = c.createOscillator()
      o.type = 'sawtooth'
      o.frequency.setValueAtTime(280, agora)
      o.frequency.exponentialRampToValueAtTime(70, agora + 0.45)
      o.connect(envelope(c, agora, 0.18, 0.5))
      o.start(agora)
      o.stop(agora + 0.55)
    },
  }
}
