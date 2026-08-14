import { describe, expect, it } from 'vitest'
import {
  REPLY_SPLIT_MARKER,
  replyChunkDelayMs,
  splitReplyIntoChunks,
} from './chunk-reply'

describe('splitReplyIntoChunks', () => {
  it('keeps a short unmarked reply in one bubble', () => {
    expect(splitReplyIntoChunks('Olá! Como posso ajudar?', 3)).toEqual([
      'Olá! Como posso ajudar?',
    ])
  })

  it('honours explicit model markers without exposing them', () => {
    expect(
      splitReplyIntoChunks(
        `Tenho estas opções.${REPLY_SPLIT_MARKER}Quer ver primeiro as pretas?`,
        3,
      ),
    ).toEqual(['Tenho estas opções.', 'Quer ver primeiro as pretas?'])
  })

  it('strips exact internal history annotations before WhatsApp send', () => {
    expect(
      splitReplyIntoChunks(
        '[Imagem enviada no WhatsApp]\nAqui estão outras duas opções.',
        3,
      ),
    ).toEqual(['Aqui estão outras duas opções.'])
  })

  it('does not strip arbitrary bracketed customer/model text', () => {
    expect(
      splitReplyIntoChunks('[Tamanho M] está disponível para esta opção.', 3),
    ).toEqual(['[Tamanho M] está disponível para esta opção.'])
  })

  it('returns no chunks when an internal annotation is the whole output', () => {
    expect(splitReplyIntoChunks('[Imagem enviada no WhatsApp]', 3)).toEqual([])
  })

  it('merges overflow into the final allowed bubble', () => {
    expect(
      splitReplyIntoChunks(
        ['Um', 'Dois', 'Três', 'Quatro'].join(REPLY_SPLIT_MARKER),
        3,
      ),
    ).toEqual(['Um', 'Dois', 'Três\n\nQuatro'])
  })

  it('uses sentence boundaries for a long unmarked reply', () => {
    const text = [
      'Primeira frase com informação relevante para o cliente.',
      'Segunda frase com mais detalhes sobre o produto seleccionado.',
      'Terceira frase que confirma como o cliente pode prosseguir.',
      'Quarta frase com uma pergunta curta para manter a conversa natural.',
      'Quinta frase que fecha a explicação sem inventar informação.',
      'Sexta frase para garantir que o texto ultrapassa o limite heurístico.',
      'Sétima frase com contexto adicional suficiente para outro balão.',
    ].join(' ')

    const chunks = splitReplyIntoChunks(text, 3)
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.length).toBeLessThanOrEqual(3)
    expect(chunks.join(' ')).toBe(text)
  })

  it('removes markers but never splits when the configured maximum is one', () => {
    expect(
      splitReplyIntoChunks(`Parte um${REPLY_SPLIT_MARKER}Parte dois`, 1),
    ).toEqual(['Parte um Parte dois'])
  })
})

describe('replyChunkDelayMs', () => {
  it('keeps pauses between one and two seconds', () => {
    expect(replyChunkDelayMs('curto')).toBeGreaterThanOrEqual(1_000)
    expect(replyChunkDelayMs('x'.repeat(500))).toBe(2_000)
  })
})
