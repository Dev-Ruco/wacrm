import type { GoldenCase } from './golden-set'

/**
 * Regression cases distilled from real failure modes observed in production.
 * Keep these tenant-neutral and fictional so they can run safely against any
 * configured provider while still exercising the same agent/tool contract.
 */
export const CONVERSATION_REGRESSION_SET: GoldenCase[] = [
  {
    id: 'regression-business-location-grounded',
    description: 'Pergunta pela localização usa conhecimento real e nunca expõe placeholders internos.',
    conversation: [{ role: 'user', content: 'Onde fica a loja?' }],
    withTools: true,
    criteria: [
      'Chama search_knowledge antes de responder à localização da empresa.',
      'Responde com a morada devolvida pela base de conhecimento quando encontrada.',
      'Não mostra placeholders, notas internas, texto entre parênteses rectos a pedir a morada, nem inventa uma localização.',
    ],
  },
  {
    id: 'regression-pickup-without-time-does-not-schedule',
    description: 'Interesse em levantar um produto não autoriza o agente a inventar data ou hora.',
    conversation: [
      { role: 'user', content: 'Quero ver leggings pretas' },
      {
        role: 'assistant',
        content: 'Tenho a Legging Alta Performance preta por 1500 MZN. Posso mostrar-lhe esta opção.',
      },
      { role: 'user', content: 'Quero essa, posso vir buscar?' },
    ],
    withTools: true,
    criteria: [
      'Não chama schedule_visit porque a cliente ainda não forneceu nem confirmou uma data e uma hora específicas.',
      'Não inventa uma marcação, data ou hora.',
      'Confirma naturalmente que o levantamento pode ser tratado e pede apenas a informação realmente em falta para combinar a visita.',
    ],
  },
  {
    id: 'regression-no-second-welcome',
    description: 'O agente não reinicia a conversa com nova saudação quando já existe um pedido concreto.',
    conversation: [
      { role: 'user', content: 'Olá' },
      { role: 'assistant', content: 'Olá! Em que posso ajudar?' },
      { role: 'user', content: 'Quero leggings' },
    ],
    withTools: true,
    criteria: [
      'Continua directamente para o pedido de leggings e não repete uma mensagem genérica de boas-vindas.',
      'Chama search_catalog para responder ao pedido concreto.',
      'Não pergunta novamente em que pode ajudar.',
    ],
  },
  {
    id: 'regression-short-size-follow-up',
    description: 'Uma resposta curta de tamanho completa o contexto em vez de reiniciar a descoberta.',
    conversation: [
      { role: 'user', content: 'Quero uma legging preta' },
      {
        role: 'assistant',
        content: 'Tenho a Legging Alta Performance preta. Qual é o tamanho que procura?',
      },
      { role: 'user', content: 'M' },
    ],
    withTools: true,
    criteria: [
      'Interpreta M como resposta à pergunta de tamanho da legging já em discussão.',
      'Não pergunta qual produto a cliente pretende nem reinicia com uma saudação.',
      'Não afirma stock do tamanho M sem dados verificados.',
    ],
  },
  {
    id: 'regression-concrete-product-preserved',
    description: 'O nome concreto do produto não é substituído por uma categoria vaga na pesquisa.',
    conversation: [{ role: 'user', content: 'Quero uma legging para treino' }],
    withTools: true,
    criteria: [
      'Chama search_catalog com uma pesquisa que preserva o objecto concreto “legging”.',
      'Não substitui a pesquisa apenas por conceitos vagos como roupa, roupa de treino ou vestuário desportivo.',
      'Usa os resultados reais para responder em vez de inventar opções.',
    ],
  },
  {
    id: 'regression-rejection-keeps-goal',
    description: 'Uma rejeição altera a preferência sem apagar o objectivo comercial activo.',
    conversation: [
      { role: 'user', content: 'Quero uma legging para treinar' },
      {
        role: 'assistant',
        content: 'Tenho uma Legging Alta Performance preta. Quer esta opção?',
      },
      { role: 'user', content: 'Não gostei dessa, quero algo mais discreto' },
    ],
    withTools: true,
    criteria: [
      'Mantém o objectivo de encontrar uma legging e incorpora a nova preferência por algo mais discreto.',
      'Não volta a oferecer a opção que a cliente acabou de rejeitar.',
      'Procura ou recomenda uma alternativa real sem reiniciar a conversa do zero.',
    ],
  },
]
