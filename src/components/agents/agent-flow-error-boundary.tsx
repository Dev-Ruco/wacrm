'use client'

import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

export class AgentFlowErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[agent flow] render failed:', error, info)
  }

  private retry = () => {
    this.setState({ error: null })
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
            <Button variant="outline" className="mt-4" onClick={this.retry}>
              <RefreshCw className="h-4 w-4" /> Tentar novamente
            </Button>
          </div>
        </div>
      </div>
    )
  }
}
