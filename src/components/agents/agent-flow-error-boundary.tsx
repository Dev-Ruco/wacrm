'use client'

import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
  code: string | null
}

function flowErrorCode(error: Error): string {
  const input = `${error.name}:${error.message}`
  let hash = 2166136261
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return `FLOW-${(hash >>> 0).toString(16).toUpperCase().padStart(8, '0')}`
}

export class AgentFlowErrorBoundary extends Component<Props, State> {
  state: State = { error: null, code: null }

  static getDerivedStateFromError(error: Error): State {
    return { error, code: flowErrorCode(error) }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[agent flow] render failed:', {
      code: flowErrorCode(error),
      error,
      componentStack: info.componentStack,
    })
  }

  private retry = () => {
    this.setState({ error: null, code: null })
  }

  render() {
    if (!this.state.error) return this.props.children

    return (
      <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-6">
        <div className="flex items-start gap-3">
          <div className="rounded-lg bg-destructive/10 p-2 text-destructive">
            <AlertTriangle className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-foreground">O visualizador do fluxo encontrou um erro.</p>
            <p className="mt-1 text-sm text-muted-foreground">
              As restantes configurações do agente continuam disponíveis. Pode tentar montar novamente apenas este painel.
            </p>
            {this.state.code && (
              <p className="mt-2 font-mono text-xs text-muted-foreground">Código: {this.state.code}</p>
            )}
            <Button variant="outline" className="mt-4" onClick={this.retry}>
              <RefreshCw className="h-4 w-4" /> Tentar novamente
            </Button>
          </div>
        </div>
      </div>
    )
  }
}
