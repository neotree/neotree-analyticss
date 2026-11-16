import { Component, Fragment, type ReactNode } from 'react';

import { report } from '../lib/telemetry';
import { ErrorView } from './Screens';

type State = { failed: boolean; attempt: number; };

/**
 * Last line of defence for a render error: shows a recovery screen instead of a blank app and reports
 * the crash. "Restart" remounts everything below, which also unmounts the WebView (ending its session
 * on this device the same way a lock does).
 */
export class ErrorBoundary extends Component<{ children: ReactNode; }, State> {
    state: State = { failed: false, attempt: 0 };

    static getDerivedStateFromError(): Partial<State> {
        return { failed: true };
    }

    componentDidCatch(error: unknown, info: { componentStack?: string | null; }) {
        const firstComponent = info.componentStack?.trim().split('\n')[0]?.trim() ?? null;
        report('crash', error, { component: firstComponent });
    }

    render() {
        if (this.state.failed) {
            return (
                <ErrorView
                    title="Something went wrong"
                    message="The app hit an unexpected problem. Restart to continue; you may need to sign in again."
                    actions={[{ label: 'Restart', onPress: () => this.setState(state => ({ failed: false, attempt: state.attempt + 1 })) }]}
                />
            );
        }
        // A new key on restart remounts the whole tree with fresh state.
        return <Fragment key={this.state.attempt}>{this.props.children}</Fragment>;
    }
}
