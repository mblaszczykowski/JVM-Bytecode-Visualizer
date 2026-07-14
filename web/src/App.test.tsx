import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App } from './App';
import { readExampleBytes, readFixtureBytes } from './services/__fixtures__/example-files';
import {
  exampleRoutes,
  okResponse,
  statusResponse,
  stubFetch,
} from './services/__fixtures__/fake-fetch';
import { uploadFile } from './services/__fixtures__/upload-file';
import { exampleUrl, MANIFEST_FILE } from './services/examples';

const FACTORIAL_STEPS = 40;
const SCRUBBER = { name: 'Execution history position' };

/** Renders the app and waits for the manifest to arrive. */
async function openApp() {
  render(<App />);
  await screen.findByRole('button', { name: 'Factorial' });
}

async function openFactorial() {
  await openApp();
  fireEvent.click(screen.getByRole('button', { name: 'Factorial' }));
  await screen.findByTestId('step-counter');
}

function seekTo(step: number): void {
  fireEvent.change(screen.getByRole('slider', SCRUBBER), { target: { value: String(step) } });
}

function chooseFile(file: File): void {
  const [toolbarInput] = screen.getAllByLabelText('Open .class…');
  if (toolbarInput === undefined) {
    throw new Error('the toolbar has no file input');
  }
  fireEvent.change(toolbarInput, { target: { files: [file] } });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('welcome screen', () => {
  it('names the application', async () => {
    stubFetch(exampleRoutes());
    await openApp();

    expect(
      screen.getByRole('heading', { level: 1, name: 'JVM Bytecode Visualizer' }),
    ).toBeVisible();
  });

  it('offers the four examples and a drop zone before anything is loaded', async () => {
    stubFetch(exampleRoutes());
    await openApp();

    expect(screen.getAllByTestId('welcome-example')).toHaveLength(4);
    expect(screen.getByText(/one bytecode instruction at a time/)).toBeVisible();
    expect(screen.queryByTestId('step-counter')).not.toBeInTheDocument();
    expect(screen.getAllByTestId('file-drop-zone').length).toBeGreaterThan(0);
  });

  it('reports a manifest the schema rejects and still renders', async () => {
    stubFetch({
      [exampleUrl(MANIFEST_FILE)]: () => okResponse({ json: { version: 1, examples: [] } }),
    });
    render(<App />);

    const banner = await screen.findByTestId('error-banner');

    expect(banner).toHaveTextContent('does not match the example manifest schema');
    expect(screen.queryAllByTestId('welcome-example')).toHaveLength(0);
  });
});

describe('running an example', () => {
  it('parses, executes and shows the first step', async () => {
    stubFetch(exampleRoutes());
    await openFactorial();

    expect(screen.getByTestId('step-counter')).toHaveTextContent(
      `step 1 / ${String(FACTORIAL_STEPS)}`,
    );
    expect(screen.getByTestId('current-instruction')).toHaveTextContent('iconst_4');
    expect(screen.getByTestId('current-source-line')).toHaveTextContent(
      'int result = factorial(4);',
    );
    expect(screen.getByRole('region', { name: 'Bytecode' })).toHaveTextContent(
      'main([Ljava/lang/String;)V',
    );
  });

  it('explains the call with the real constant pool entry', async () => {
    stubFetch(exampleRoutes());
    await openFactorial();

    fireEvent.click(screen.getByRole('button', { name: 'Step forward' }));

    expect(screen.getByTestId('current-instruction')).toHaveTextContent('invokestatic');
    const chain = within(screen.getByTestId('cp-chain'));
    expect(chain.getByText('#7')).toBeInTheDocument();
    expect(chain.getByText('Methodref')).toBeInTheDocument();
    expect(chain.getByText('Factorial.factorial:(I)I')).toBeInTheDocument();
    expect(
      screen.getByText('Pops 4 and calls factorial(I)I with it in slot 0.'),
    ).toBeInTheDocument();
  });

  it('maps the current line back to a range of byte offsets', async () => {
    stubFetch(exampleRoutes());
    await openFactorial();

    seekTo(4);

    expect(screen.getByText('pc 0–2')).toBeInTheDocument();
    expect(screen.getByText('LineNumberTable · largest startPc ≤ 2 → line 26')).toBeInTheDocument();
  });

  it('follows the recursion down to five frames and back', async () => {
    stubFetch(exampleRoutes());
    await openFactorial();

    seekTo(26);
    expect(screen.getAllByTestId('call-frame')).toHaveLength(5);

    seekTo(FACTORIAL_STEPS - 1);
    expect(screen.queryByTestId('call-frame')).not.toBeInTheDocument();
    expect(screen.queryByTestId('next-instruction-card')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Step back' }));
    const locals = within(screen.getByRole('region', { name: 'Locals' }));
    expect(locals.getByText('result')).toBeInTheDocument();
    expect(locals.getByText('24')).toBeInTheDocument();
  });

  it('rewinds to the first step when another example is chosen', async () => {
    stubFetch(exampleRoutes());
    await openFactorial();
    seekTo(20);

    fireEvent.click(screen.getByRole('button', { name: 'GCD' }));

    await waitFor(() => {
      expect(screen.getByTestId('step-counter')).toHaveTextContent('step 1 / 43');
    });
    expect(screen.getByRole('region', { name: 'Source' })).toHaveTextContent('Gcd.java');
  });

  it('reports a download that fails and keeps the welcome screen usable', async () => {
    const routes = exampleRoutes();
    stubFetch({ ...routes, [exampleUrl('Factorial.class')]: () => statusResponse(503) });
    await openApp();

    fireEvent.click(screen.getByRole('button', { name: 'Factorial' }));

    expect(await screen.findByTestId('error-banner')).toHaveTextContent('the server answered 503');
    expect(screen.getAllByTestId('welcome-example')).toHaveLength(4);
  });
});

describe('keyboard shortcuts', () => {
  it('steps forward with the right arrow', async () => {
    stubFetch(exampleRoutes());
    await openFactorial();

    fireEvent.keyDown(document.body, { key: 'ArrowRight' });

    expect(screen.getByTestId('step-counter')).toHaveTextContent(
      `step 2 / ${String(FACTORIAL_STEPS)}`,
    );

    fireEvent.keyDown(document.body, { key: 'End' });
    expect(screen.getByTestId('step-counter')).toHaveTextContent(
      `step ${String(FACTORIAL_STEPS)} / ${String(FACTORIAL_STEPS)}`,
    );

    fireEvent.keyDown(document.body, { key: 'Home' });
    expect(screen.getByTestId('step-counter')).toHaveTextContent(
      `step 1 / ${String(FACTORIAL_STEPS)}`,
    );
  });

  it('leaves the arrow keys to the scrubber, which handles them itself', async () => {
    stubFetch(exampleRoutes());
    await openFactorial();

    fireEvent.keyDown(screen.getByRole('slider', SCRUBBER), { key: 'ArrowRight' });

    expect(screen.getByTestId('step-counter')).toHaveTextContent(
      `step 1 / ${String(FACTORIAL_STEPS)}`,
    );
  });
});

describe('uploads', () => {
  it('rejects a file that is not a class file and stays usable', async () => {
    stubFetch(exampleRoutes());
    await openApp();

    chooseFile(uploadFile('notes.txt', new TextEncoder().encode('just some text')));

    expect(await screen.findByTestId('error-banner')).toHaveTextContent(
      'Not a .class file: expected the 0xcafebabe header',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Factorial' }));
    await screen.findByTestId('step-counter');
    expect(screen.queryByTestId('error-banner')).not.toBeInTheDocument();
  });

  it('rejects a file over the size limit', async () => {
    stubFetch(exampleRoutes());
    await openApp();

    chooseFile(uploadFile('Huge.class', new Uint8Array(600 * 1024)));

    expect(await screen.findByTestId('error-banner')).toHaveTextContent(
      'the upload limit is 512 KiB',
    );
  });

  it('warns about a program that does not terminate and offers a higher limit', async () => {
    stubFetch(exampleRoutes());
    await openApp();

    chooseFile(
      uploadFile('InfiniteLoop.class', new Uint8Array(readFixtureBytes('InfiniteLoop.class'))),
    );

    const banner = await screen.findByTestId('error-banner');
    expect(banner).toHaveAttribute('data-severity', 'warning');
    expect(banner).toHaveTextContent(
      'Stopped after 20,000 steps — the program probably does not terminate.',
    );
    // The history collected so far stays playable — that is the point of recording it.
    expect(screen.getByTestId('step-counter')).toHaveTextContent('step 1 / 20000');

    fireEvent.click(screen.getByRole('button', { name: 'Raise the limit' }));

    await waitFor(() => {
      expect(screen.getByTestId('error-banner')).toHaveTextContent('Stopped after 100,000 steps');
    });
    expect(screen.getByTestId('step-counter')).toHaveTextContent('step 1 / 100000');
  });

  it('runs an uploaded class file that has no source next to it', async () => {
    stubFetch(exampleRoutes());
    await openApp();

    chooseFile(uploadFile('Gcd.class', new Uint8Array(readExampleBytes('Gcd.class'))));

    await screen.findByTestId('step-counter');
    expect(screen.getByRole('region', { name: 'Source' })).toHaveTextContent('No .java source');
    expect(screen.getByTestId('current-instruction')).toBeInTheDocument();
  });
});
