import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { EmbedBar } from './EmbedBar';

const FULL_URL = 'https://example.test/#/factorial/12';

describe('EmbedBar', () => {
  it('names the program it is showing, then the application it belongs to', () => {
    render(
      <EmbedBar
        appName="JVM Bytecode Visualizer"
        programName="Factorial.java"
        fullUrl={FULL_URL}
      />,
    );

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'Factorial.java · JVM Bytecode Visualizer',
    );
  });

  it('falls back to the application name where no program is loaded', () => {
    render(
      <EmbedBar appName="JVM Bytecode Visualizer" programName={undefined} fullUrl={FULL_URL} />,
    );

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('JVM Bytecode Visualizer');
  });

  it('says that the way out replaces the embed rather than opening beside it', () => {
    render(
      <EmbedBar appName="JVM Bytecode Visualizer" programName={undefined} fullUrl={FULL_URL} />,
    );

    const out = screen.getByTestId('embed-open-full');

    expect(out).toHaveAccessibleName('Open in full (leaves this embedded view)');
    expect(out).toHaveAttribute('target', '_top');
    expect(out).toHaveAttribute('href', FULL_URL);
  });
});
