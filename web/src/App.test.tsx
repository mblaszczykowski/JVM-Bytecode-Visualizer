import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App } from './App';
import { readExampleBytes, readFixtureBytes } from './services/__fixtures__/example-files';
import {
  exampleRoutes,
  okResponse,
  statusResponse,
  stubFetch,
  type FakeRoute,
} from './services/__fixtures__/fake-fetch';
import { uploadFile } from './services/__fixtures__/upload-file';
import { exampleUrl, MANIFEST_FILE } from './services/examples';

const FACTORIAL_STEPS = 40;
const SCRUBBER = { name: 'Execution history position' };

const COMPILE_API = 'http://compile.test';
const HEALTH_URL = `${COMPILE_API}/actuator/health`;
const COMPILE_URL = `${COMPILE_API}/api/compile`;

/** Renders the app and waits for the manifest to arrive. */
async function openApp(compileApiUrl?: string) {
  render(<App compileApiUrl={compileApiUrl} />);
  await screen.findByRole('radio', { name: 'Factorial' });
}

async function openFactorial() {
  await openApp();
  fireEvent.click(screen.getByRole('radio', { name: 'Factorial' }));
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

interface HeldAnswer {
  readonly route: FakeRoute;
  /** Lands the answer and lets React process everything that follows from it. */
  readonly land: (response: Response | Error) => Promise<void>;
}

/** A request the test keeps in flight, so a later event can be raced against it. */
function heldAnswer(): HeldAnswer {
  let settle: (response: Response | Error) => void = () => undefined;
  const pending = new Promise<Response>((resolve, reject) => {
    settle = (response) => {
      if (response instanceof Error) {
        reject(response);
      } else {
        resolve(response);
      }
    };
  });

  return {
    route: () => pending,
    land: async (response) => {
      await act(async () => {
        settle(response);
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    },
  };
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

  it('shows a one-line tagline on every card, not a truncated description', async () => {
    stubFetch(exampleRoutes());
    await openApp();

    const [factorial] = screen.getAllByTestId('welcome-example');

    expect(factorial).toHaveTextContent('Five frames deep and back: 4! = 24.');
    // The long text belongs to the toolbar tooltip, not to the card.
    expect(factorial).not.toHaveTextContent('the clearest way to see');
    expect(screen.getByRole('radio', { name: 'Factorial' })).toHaveAttribute(
      'title',
      expect.stringContaining('the clearest way to see'),
    );
  });

  it('measures each example so the cards say how long the run is and how deep it goes', async () => {
    stubFetch(exampleRoutes());
    await openApp();

    const factorial = screen.getAllByTestId('welcome-example')[0] ?? document.body;
    await waitFor(() => {
      expect(factorial).toHaveTextContent('40 steps · depth 5');
    });
    expect(within(factorial).getAllByTestId('welcome-sparkline-bar')).toHaveLength(32);
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

  it('never takes a program loaded meanwhile down with the manifest', async () => {
    const manifest = heldAnswer();
    stubFetch({ ...exampleRoutes(), [exampleUrl(MANIFEST_FILE)]: manifest.route });
    render(<App />);

    // The reader does not wait for the examples: a drop lands while they are still in flight.
    chooseFile(uploadFile('Gcd.class', new Uint8Array(readExampleBytes('Gcd.class'))));
    await screen.findByTestId('step-counter');

    await manifest.land(new Error('the network went away'));

    expect(screen.getByTestId('step-counter')).toHaveTextContent(`step 1 / ${String(GCD_STEPS)}`);
    expect(screen.getByTestId('current-instruction')).toBeInTheDocument();
    // Only the examples are gone, and the banner says so.
    expect(screen.getByTestId('error-banner')).toHaveTextContent('Could not download');
    expect(screen.queryByRole('radio', { name: 'Factorial' })).not.toBeInTheDocument();
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
    // The card resolves the call, not just the premise: where control goes and where it
    // comes back to.
    expect(
      screen.getByText(
        'Pops 4 and calls factorial(I)I with it in slot 0 — the callee starts at pc 0 and ' +
          'main resumes at pc 4.',
      ),
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

  it('ends on the result rather than on three empty panels', async () => {
    stubFetch(exampleRoutes());
    await openFactorial();

    seekTo(FACTORIAL_STEPS - 1);

    const card = within(screen.getByTestId('completion-card'));
    expect(card.getByText('result')).toBeInTheDocument();
    expect(card.getByText('24')).toBeInTheDocument();
    expect(card.getByText('40')).toBeInTheDocument();
    expect(card.getByText('5 frames')).toBeInTheDocument();
    expect(card.getByText(/Matches the value a real JVM computed/)).toBeInTheDocument();

    // The frame that produced it is still described, instead of blanking with the stack.
    const locals = within(screen.getByRole('region', { name: 'Locals' }));
    expect(locals.getByText('result')).toBeInTheDocument();
    expect(locals.getByText('24')).toBeInTheDocument();
    expect(screen.getByText('Left behind by main')).toBeInTheDocument();
  });

  it('seeks to the first step at an instruction when its row is clicked', async () => {
    stubFetch(exampleRoutes());
    await openFactorial();
    seekTo(20);

    fireEvent.click(screen.getByRole('button', { name: 'Go to pc 11, invokestatic' }));

    expect(screen.getByTestId('step-counter')).toHaveTextContent(
      `step 10 / ${String(FACTORIAL_STEPS)}`,
    );
    expect(screen.getByTestId('current-instruction')).toHaveTextContent('invokestatic');
  });

  it('seeks to the first step on a source line when its row is clicked', async () => {
    stubFetch(exampleRoutes());
    await openFactorial();
    seekTo(20);

    fireEvent.click(screen.getByRole('button', { name: 'Go to line 27' }));

    expect(screen.getByTestId('current-source-line')).toHaveTextContent('return 1;');
  });

  it('rewinds to the first step when another example is chosen', async () => {
    stubFetch(exampleRoutes());
    await openFactorial();
    seekTo(20);

    fireEvent.click(screen.getByRole('radio', { name: 'GCD' }));

    await waitFor(() => {
      expect(screen.getByTestId('step-counter')).toHaveTextContent('step 1 / 43');
    });
    expect(screen.getByRole('region', { name: 'Source' })).toHaveTextContent('Gcd.java');
  });

  it('reports a download that fails and keeps the welcome screen usable', async () => {
    const routes = exampleRoutes();
    stubFetch({ ...routes, [exampleUrl('Factorial.class')]: () => statusResponse(503) });
    await openApp();

    fireEvent.click(screen.getByRole('radio', { name: 'Factorial' }));

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

    fireEvent.click(screen.getByRole('radio', { name: 'Factorial' }));
    await screen.findByTestId('step-counter');
    expect(screen.queryByTestId('error-banner')).not.toBeInTheDocument();
  });

  it('reports the rejection next to the drop zone, and lets it be dismissed', async () => {
    stubFetch(exampleRoutes());
    await openApp();

    chooseFile(uploadFile('notes.txt', new TextEncoder().encode('just some text')));

    // The welcome screen owns the whole grid, so the message belongs inside it — not pinned
    // to the bottom of the shell, half a screen away from the zone that produced it.
    const banner = await screen.findByTestId('error-banner');
    expect(banner.closest('footer')).toBeNull();
    expect(screen.getByTestId('welcome-screen')).toContainElement(banner);

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss this message' }));

    expect(screen.queryByTestId('error-banner')).not.toBeInTheDocument();
    expect(screen.getAllByTestId('welcome-example')).toHaveLength(4);
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

const GCD_SOURCE = 'public class Gcd {\n    static int gcd(int a, int b) { return a; }\n}';
const GCD_STEPS = 43;

function base64Of(bytes: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)));
}

const compiledGcd: FakeRoute = () =>
  okResponse({
    json: {
      success: true,
      className: 'Gcd',
      classFileBase64: base64Of(readExampleBytes('Gcd.class')),
      diagnostics: [],
    },
  });

const healthy: FakeRoute = () => okResponse({ json: { status: 'UP' } });

function diagnosticsResponse(message: string): Response {
  return okResponse({
    json: {
      success: false,
      className: null,
      classFileBase64: null,
      diagnostics: [{ line: 3, column: 12, kind: 'ERROR', message }],
    },
  });
}

function compileRoutes(compileRoute: FakeRoute, healthRoute: FakeRoute = healthy) {
  return { ...exampleRoutes(), [HEALTH_URL]: healthRoute, [COMPILE_URL]: compileRoute };
}

/** Opens the editor from the toolbar once the health check has let it appear. */
async function openEditor(): Promise<HTMLElement> {
  fireEvent.click(await screen.findByRole('button', { name: 'Write Java…' }));
  return screen.getByLabelText('Java source');
}

async function writeAndCompile(source = GCD_SOURCE): Promise<void> {
  fireEvent.change(await openEditor(), { target: { value: source } });
  fireEvent.click(screen.getByRole('button', { name: 'Compile' }));
}

describe('the compile editor', () => {
  it('is nowhere to be seen without a configured service', async () => {
    stubFetch(exampleRoutes());
    await openApp();

    expect(screen.queryByTestId('compiler-health')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Write Java…' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('welcome-write-java')).not.toBeInTheDocument();
  });

  it('appears in the toolbar and on the welcome screen once the service answers', async () => {
    stubFetch(compileRoutes(compiledGcd));
    await openApp(COMPILE_API);

    expect(await screen.findByRole('button', { name: 'Write Java…' })).toBeVisible();
    expect(screen.getByTestId('compiler-health')).toHaveAttribute('data-status', 'online');
    expect(screen.getByTestId('welcome-write-java')).toBeInTheDocument();
  });

  it('stays hidden when the service is configured but not answering', async () => {
    const fetchMock = stubFetch(compileRoutes(compiledGcd, () => statusResponse(503)));
    await openApp(COMPILE_API);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(HEALTH_URL, expect.anything());
    });
    expect(screen.queryByTestId('compiler-health')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Write Java…' })).not.toBeInTheDocument();
  });

  it('compiles what was written and plays the result back', async () => {
    const fetchMock = stubFetch(compileRoutes(compiledGcd));
    await openApp(COMPILE_API);

    await writeAndCompile();

    expect(await screen.findByTestId('step-counter')).toHaveTextContent(
      `step 1 / ${String(GCD_STEPS)}`,
    );
    expect(fetchMock).toHaveBeenCalledWith(
      COMPILE_URL,
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ source: GCD_SOURCE }) }),
    );

    // The source panel shows the .java that was written, not a placeholder.
    const source = screen.getByRole('region', { name: 'Source' });
    expect(source).toHaveTextContent('Gcd.java');
    expect(source).toHaveTextContent('static int gcd(int a, int b)');
    expect(screen.queryByTestId('compile-editor')).not.toBeInTheDocument();
  });

  it('keeps javac diagnostics in the editor rather than in the banner', async () => {
    stubFetch(
      compileRoutes(() =>
        okResponse({
          json: {
            success: false,
            className: null,
            classFileBase64: null,
            diagnostics: [{ line: 3, column: 12, kind: 'ERROR', message: "';' expected" }],
          },
        }),
      ),
    );
    await openApp(COMPILE_API);

    await writeAndCompile();

    expect(await screen.findByTestId('compile-diagnostic')).toHaveTextContent("3:12';' expected");
    expect(screen.queryByTestId('error-banner')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Java source')).toHaveValue(GCD_SOURCE);
  });

  it('asks the reader to wait when the rate limit is hit', async () => {
    stubFetch(compileRoutes(() => statusResponse(429)));
    await openApp(COMPILE_API);

    await writeAndCompile();

    expect(await screen.findByTestId('error-banner')).toHaveTextContent(
      'The compiler is busy (rate limit). Try again in a minute.',
    );
    expect(screen.getByLabelText('Java source')).toHaveValue(GCD_SOURCE);
  });

  it('keeps the draft when the service disappears mid-session', async () => {
    stubFetch({ ...exampleRoutes(), [HEALTH_URL]: healthy });
    await openApp(COMPILE_API);

    await writeAndCompile();

    expect(await screen.findByTestId('error-banner')).toHaveTextContent(
      'Could not reach the compile service',
    );
    expect(screen.getByTestId('compile-editor')).toBeInTheDocument();
    expect(screen.getByLabelText('Java source')).toHaveValue(GCD_SOURCE);
    expect(screen.getByTestId('compiler-health')).toHaveAttribute('data-status', 'offline');
  });

  it('drops a compile answer that lands after the editor is closed', async () => {
    const held = heldAnswer();
    const fetchMock = stubFetch(compileRoutes(held.route));
    await openApp(COMPILE_API);

    await writeAndCompile();
    expect(fetchMock).toHaveBeenCalledWith(COMPILE_URL, expect.anything());

    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(screen.queryByTestId('compile-editor')).not.toBeInTheDocument();

    await held.land(diagnosticsResponse("';' expected"));

    // Nothing reopens behind the reader's back and nothing lands in the banner.
    expect(screen.queryByTestId('compile-editor')).not.toBeInTheDocument();
    expect(screen.queryByTestId('compile-diagnostic')).not.toBeInTheDocument();
    expect(screen.queryByTestId('error-banner')).not.toBeInTheDocument();
  });

  it('keeps the answer to the newest compile when an older one comes back late', async () => {
    const stale = heldAnswer();
    let answer: FakeRoute = stale.route;
    stubFetch(compileRoutes(() => answer()));
    await openApp(COMPILE_API);

    await writeAndCompile();
    fireEvent.keyDown(document.body, { key: 'Escape' });

    answer = () => diagnosticsResponse('cannot find symbol');
    await writeAndCompile();
    expect(await screen.findByTestId('compile-diagnostic')).toHaveTextContent('cannot find symbol');

    await stale.land(diagnosticsResponse("';' expected"));

    expect(screen.getByTestId('compile-diagnostic')).toHaveTextContent('cannot find symbol');
  });

  it('brings the badge back online once the service answers again', async () => {
    let down = true;
    stubFetch(
      compileRoutes(() => {
        if (down) {
          throw new Error('connection refused');
        }
        return diagnosticsResponse("';' expected");
      }),
    );
    await openApp(COMPILE_API);

    await writeAndCompile();
    expect(await screen.findByTestId('error-banner')).toHaveTextContent(
      'Could not reach the compile service',
    );
    expect(screen.getByTestId('compiler-health')).toHaveAttribute('data-status', 'offline');

    down = false;
    fireEvent.click(screen.getByRole('button', { name: 'Compile' }));

    // javac answering at all is proof the service came back.
    expect(await screen.findByTestId('compile-diagnostic')).toBeInTheDocument();
    expect(screen.getByTestId('compiler-health')).toHaveAttribute('data-status', 'online');
    expect(screen.queryByTestId('error-banner')).not.toBeInTheDocument();
  });

  it('returns to what was on screen before when Escape closes it', async () => {
    stubFetch(compileRoutes(compiledGcd));
    await openApp(COMPILE_API);
    fireEvent.click(screen.getByRole('radio', { name: 'Factorial' }));
    await screen.findByTestId('step-counter');

    await openEditor();
    expect(screen.queryByTestId('current-instruction')).not.toBeInTheDocument();

    fireEvent.keyDown(document.body, { key: 'Escape' });

    expect(screen.queryByTestId('compile-editor')).not.toBeInTheDocument();
    expect(screen.getByTestId('current-instruction')).toBeInTheDocument();
    expect(screen.getByTestId('step-counter')).toHaveTextContent(
      `step 1 / ${String(FACTORIAL_STEPS)}`,
    );
  });

  it('gives the grid back when another program is chosen', async () => {
    stubFetch(compileRoutes(compiledGcd));
    await openApp(COMPILE_API);
    await openEditor();

    fireEvent.click(screen.getByRole('radio', { name: 'Factorial' }));

    expect(await screen.findByTestId('step-counter')).toBeInTheDocument();
    expect(screen.queryByTestId('compile-editor')).not.toBeInTheDocument();
  });

  it('lets the editor keep the keys the transport also listens for', async () => {
    stubFetch(compileRoutes(compiledGcd));
    await openApp(COMPILE_API);
    fireEvent.click(screen.getByRole('radio', { name: 'Factorial' }));
    await screen.findByTestId('step-counter');
    const textarea = await openEditor();

    fireEvent.keyDown(textarea, { key: ' ' });
    fireEvent.keyDown(textarea, { key: 'ArrowRight' });

    expect(screen.getByTestId('step-counter')).toHaveTextContent(
      `step 1 / ${String(FACTORIAL_STEPS)}`,
    );

    // The shortcuts are still live — they only stepped aside for the text field.
    fireEvent.keyDown(document.body, { key: 'ArrowRight' });
    expect(screen.getByTestId('step-counter')).toHaveTextContent(
      `step 2 / ${String(FACTORIAL_STEPS)}`,
    );
  });
});
