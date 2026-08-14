import { describe, expect, it } from 'vitest'
import { stripHistoryAnnotationMarkers } from './history-annotations'

describe('stripHistoryAnnotationMarkers', () => {
  it('removes only exact server-owned history annotations', () => {
    expect(
      stripHistoryAnnotationMarkers(
        '[Imagem enviada no WhatsApp]\nAqui estão outras duas opções.\n[Opção interactiva no WhatsApp]',
      ),
    ).toBe('Aqui estão outras duas opções.')
  })

  it('keeps arbitrary bracketed text untouched', () => {
    expect(stripHistoryAnnotationMarkers('[Cliente VIP] Confirmado.')).toBe(
      '[Cliente VIP] Confirmado.',
    )
  })
})
