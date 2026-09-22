import { Component, type ErrorInfo, type ReactNode } from 'react';

interface RuntimeErrorBoundaryProps {
  children: ReactNode;
  resetKey?: string;
  compact?: boolean;
  homeHref?: string;
}

interface RuntimeErrorBoundaryState {
  error: Error | null;
}

const normalizeError = (error: unknown): Error =>
  error instanceof Error ? error : new Error('Unknown runtime error');

class RuntimeErrorBoundary extends Component<RuntimeErrorBoundaryProps, RuntimeErrorBoundaryState> {
  state: RuntimeErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: unknown): RuntimeErrorBoundaryState {
    return { error: normalizeError(error) };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error('[VisionFood runtime error]', normalizeError(error), info.componentStack);
  }

  componentDidUpdate(prevProps: RuntimeErrorBoundaryProps) {
    if (
      this.state.error &&
      prevProps.resetKey !== this.props.resetKey
    ) {
      this.setState({ error: null });
    }
  }

  private reload = () => {
    window.location.reload();
  };

  render() {
    if (!this.state.error) return this.props.children;

    const homeHref = this.props.homeHref || '/';
    const wrapper = this.props.compact
      ? 'mx-4 mt-6 kiosk-card p-6'
      : 'min-h-screen bg-background flex items-center justify-center px-6 py-10';
    const card = this.props.compact
      ? 'max-w-xl mx-auto text-center space-y-4'
      : 'w-full max-w-md kiosk-card p-6 text-center space-y-4';

    return (
      <div className={wrapper} role="alert">
        <div className={card}>
          <div className="text-4xl" aria-hidden="true">⚠️</div>
          <h1 className="text-lg font-bold">Não foi possível abrir esta tela</h1>
          <p className="text-sm text-muted-foreground">
            O sistema protegeu a sessão para evitar uma tela preta. Atualize a tela e tente novamente.
          </p>
          <div className="flex flex-col sm:flex-row gap-2 justify-center">
            <button
              type="button"
              onClick={this.reload}
              className="touch-btn bg-primary text-primary-foreground px-4 py-3 rounded-xl font-semibold"
            >
              Atualizar tela
            </button>
            <a
              href={homeHref}
              className="touch-btn border border-border px-4 py-3 rounded-xl font-semibold"
            >
              Voltar para uma área segura
            </a>
          </div>
        </div>
      </div>
    );
  }
}

export default RuntimeErrorBoundary;
