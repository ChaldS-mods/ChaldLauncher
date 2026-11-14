import { Component, type ErrorInfo, type ReactNode } from 'react';
import { useI18n } from '../i18n';
import { Icon } from './Icon';

function Fallback({ error, reset }: { error: Error; reset: () => void }) {
  const { t } = useI18n();
  return (
    <div className="page" role="alert">
      <div className="card" style={{ maxWidth: 520, margin: '48px auto', padding: 24 }}>
        <p className="boot__error" style={{ marginBottom: 12 }}>
          <Icon name="alert" size={16} /> {error.message || String(error)}
        </p>
        <button type="button" className="btn" onClick={reset}>{t('boot.retry')}</button>
      </div>
    </div>
  );
}

/**
 * Catches render errors of a page so a broken page does not blank the whole launcher.
 * Use `key={page}` on it so switching pages resets the error.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: unknown): { error: Error } {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error('[ui] render error:', error, info.componentStack);
  }

  render(): ReactNode {
    if (this.state.error) return <Fallback error={this.state.error} reset={() => this.setState({ error: null })} />;
    return this.props.children;
  }
}
