import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App } from './App';
import { BASE_STEP_INTERVAL_MS } from './hooks/useExecutionPlayer';
import { flushDeepLink } from './services/session/deep-link';
import {
  readExampleBytes,
  readExampleManifest,
  readFixtureBytes,
} from './services/__fixtures__/example-files';
import {
  exampleRoutes,
  okResponse,
  statusResponse,
  stubFetch,
  type FakeRoute,
} from './services/__fixtures__/fake-fetch';
import { uploadFile } from './services/__fixtures__/upload-file';
import { exampleUrl, MANIFEST_FILE } from './services/loading/examples';
import { PREVIEW_MAX_STEPS } from './services/loading/program';
import { inlineRunner, RunCancelled, type ProgramRunner } from './services/loading/program-runner';

const FACTORIAL_STEPS = 40;

function exampleCount(): number {
  return (readExampleManifest() as { examples: readonly unknown[] }).examples.length;
}
const SCRUBBER = { name: 'Execution history position' };

const COMPILE_API = 'http://compile.test';
const HEALTH_URL = `${COMPILE_API}/actuator/health`;
const COMPILE_URL = `${COMPILE_API}/api/compile`;

interface AppProps {
  readonly compileApiUrl?: string | undefined;
  readonly programRunner?: ProgramRunner | undefined;
}

function renderApp(props: AppProps = {}): void {
  render(
    <StrictMode>
      <App {...props} />
    </StrictMode>,
  );
}

function examplePicker(): HTMLElement {
  return screen.getByRole('group', { name: 'Example programs' });
}

function exampleOption(name: string): HTMLElement {
  return within(examplePicker()).getByRole('button', { name });
}

function findExampleOption(name: string): Promise<HTMLElement> {
  return waitFor(() => exampleOption(name));
}

async function openApp(compileApiUrl?: string) {
  renderApp({ compileApiUrl });
  await findExampleOption('Factorial');
}

async function hashSettlesOn(hash: string): Promise<void> {
  await waitFor(() => {
    expect(window.location.hash).toBe(hash);
  });
}

async function openFactorial() {
  await openApp();
  fireEvent.click(exampleOption('Factorial'));
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
  readonly land: (response: Response | Error) => Promise<void>;
}

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
  flushDeepLink();
  window.history.replaceState(null, '', '/');
});

describe('welcome screen', () => {
  it('names the application', async () => {
    stubFetch(exampleRoutes());
    await openApp();

    expect(
      screen.getByRole('heading', { level: 1, name: 'JVM Bytecode Visualizer' }),
    ).toBeVisible();
  });

  it('offers the bundled examples and a drop zone before anything is loaded', async () => {
    stubFetch(exampleRoutes());
    await openApp();

    expect(screen.getAllByTestId('welcome-example').length).toBe(exampleCount());
    expect(screen.getByText(/one bytecode instruction at a time/)).toBeVisible();
    expect(screen.queryByTestId('step-counter')).not.toBeInTheDocument();
    expect(screen.getAllByTestId('file-drop-zone').length).toBeGreaterThan(0);
  });

  it('shows a one-line tagline on every card, not a truncated description', async () => {
    stubFetch(exampleRoutes());
    await openApp();

    const [factorial] = screen.getAllByTestId('welcome-example');

    expect(factorial).toHaveTextContent('Five frames deep and back: 4! = 24.');
    expect(factorial).not.toHaveTextContent('resumes a method exactly where it left off');
    expect(exampleOption('Factorial')).toHaveAttribute(
      'title',
      expect.stringContaining('resumes a method exactly where it left off'),
    );
  });

  it('measures each example so the cards say how long the run is and how deep it goes', async () => {
    stubFetch(exampleRoutes());
    await openApp();

    const factorial = screen.getAllByTestId('welcome-example')[0] ?? document.body;
    await waitFor(() => {
      expect(factorial).toHaveTextContent('40 steps · depth 5');
    });
  });

  it('reports a manifest the schema rejects and still renders', async () => {
    stubFetch({
      [exampleUrl(MANIFEST_FILE)]: () => okResponse({ json: { version: 1, examples: [] } }),
    });
    renderApp();

    const banner = await screen.findByTestId('error-banner');

    expect(banner).toHaveTextContent('does not match the example manifest schema');
    expect(screen.queryAllByTestId('welcome-example')).toHaveLength(0);
  });

  it('never takes a program loaded meanwhile down with the manifest', async () => {
    const manifest = heldAnswer();
    stubFetch({ ...exampleRoutes(), [exampleUrl(MANIFEST_FILE)]: manifest.route });
    renderApp();

    chooseFile(uploadFile('Gcd.class', new Uint8Array(readExampleBytes('Gcd.class'))));
    await screen.findByTestId('step-counter');

    await manifest.land(new Error('the network went away'));

    expect(screen.getByTestId('step-counter')).toHaveTextContent(`step 1 / ${String(GCD_STEPS)}`);
    expect(screen.getByTestId('current-instruction')).toBeInTheDocument();
    expect(screen.getByTestId('error-banner')).toHaveTextContent('Could not download');
    expect(screen.queryByRole('button', { name: 'Factorial' })).not.toBeInTheDocument();
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
      screen.getByText(
        'Pops 4 and calls factorial(I)I with it in slot 0. The callee starts at pc 0 and ' +
          'main resumes at pc 4.',
      ),
    ).toBeInTheDocument();
  });

  it('maps the current line back to a range of byte offsets', async () => {
    stubFetch(exampleRoutes());
    await openFactorial();

    seekTo(4);

    expect(screen.getByText('pc 0–2')).toBeInTheDocument();
    expect(screen.getByText('LineNumberTable · largest startPc ≤ 2 → line 17')).toBeInTheDocument();
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

    fireEvent.click(screen.getByRole('button', { name: 'Go to line 18' }));

    expect(screen.getByTestId('current-source-line')).toHaveTextContent('return 1;');
  });

  it('rewinds to the first step when another example is chosen', async () => {
    stubFetch(exampleRoutes());
    await openFactorial();
    seekTo(20);

    fireEvent.click(exampleOption('GCD'));

    await waitFor(() => {
      expect(screen.getByTestId('step-counter')).toHaveTextContent('step 1 / 43');
    });
    expect(screen.getByRole('region', { name: 'Source' })).toHaveTextContent('Gcd.java');
  });

  it('reports a download that fails and keeps the welcome screen usable', async () => {
    const routes = exampleRoutes();
    stubFetch({ ...routes, [exampleUrl('Factorial.class')]: () => statusResponse(503) });
    await openApp();

    fireEvent.click(exampleOption('Factorial'));

    expect(await screen.findByTestId('error-banner')).toHaveTextContent('the server answered 503');
    expect(screen.getAllByTestId('welcome-example').length).toBe(exampleCount());
  });
});

const SOURCE_TAB = 'Source: the Java this class was compiled from';
const CLASS_TAB = 'Class: the structure of the class file itself';

function leftPanelTabs(): HTMLElement {
  return screen.getByRole('group', { name: 'Left panel' });
}

describe('switching the left panel between the source and the class file', () => {
  it('carries the single switch across to the panel it opens', async () => {
    stubFetch(exampleRoutes());
    await openFactorial();

    expect(screen.getByRole('region', { name: 'Source' })).toContainElement(leftPanelTabs());

    fireEvent.click(within(leftPanelTabs()).getByRole('button', { name: CLASS_TAB }));

    expect(screen.getByRole('region', { name: 'Class file' })).toContainElement(leftPanelTabs());
    expect(within(leftPanelTabs()).getByRole('button', { name: CLASS_TAB })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    fireEvent.click(within(leftPanelTabs()).getByRole('button', { name: SOURCE_TAB }));

    expect(screen.getByRole('region', { name: 'Source' })).toContainElement(leftPanelTabs());
  });

  it('leaves the focus on the switch a keyboard reader just used', async () => {
    stubFetch(exampleRoutes());
    await openFactorial();

    const classTab = within(leftPanelTabs()).getByRole('button', { name: CLASS_TAB });
    classTab.focus();
    fireEvent.click(classTab);

    expect(within(leftPanelTabs()).getByRole('button', { name: CLASS_TAB })).toHaveFocus();
  });
});

describe('what a reader who cannot see the panels hears', () => {
  const PANELS = ['Bytecode', 'Source', 'Class', 'State'];

  function announcement(): HTMLElement {
    return screen.getByTestId('app-status');
  }

  function showPanel(name: string): void {
    fireEvent.click(within(screen.getByTestId('panel-switch')).getByRole('button', { name }));
  }

  async function announcementSettles(pattern: RegExp): Promise<void> {
    await waitFor(() => {
      expect(announcement().textContent).toMatch(pattern);
    });
  }

  it('reads the step out of the shell, so no hidden panel takes the announcement with it', async () => {
    stubFetch(exampleRoutes());
    await openFactorial();

    await announcementSettles(/^pc 0, iconst_4, stack: pushes 1\. In main;/);

    for (const panel of PANELS) {
      showPanel(panel);

      expect(announcement().closest('.hidden'), `${panel} hides the announcement`).toBeNull();
      expect(screen.getByTestId('state-column')).not.toContainElement(announcement());
    }
  });

  it('follows the run rather than repeating the step it opened on', async () => {
    stubFetch(exampleRoutes());
    await openFactorial();
    await announcementSettles(/^pc 0, iconst_4/);
    showPanel('Bytecode');

    fireEvent.keyDown(document.body, { key: 'ArrowRight' });

    await announcementSettles(/^pc 1, invokestatic, stack: pops 1, pushes 1\. /);
  });
});

function stallingRunner(settled: number, cancellable = true): ProgramRunner {
  let runs = 0;
  return {
    cancellable,
    run(command, options) {
      if (command.maxSteps === PREVIEW_MAX_STEPS) {
        return inlineRunner.run(command, options);
      }
      runs += 1;
      if (runs <= settled) {
        return inlineRunner.run(command, options);
      }
      return new Promise((_resolve, reject) => {
        options?.onProgress?.(125_000);
        options?.signal?.addEventListener(
          'abort',
          () => {
            reject(new RunCancelled());
          },
          { once: true },
        );
      });
    },
  };
}

describe('giving up on a run', () => {
  it('says how far a long run has got, and offers to end it', async () => {
    stubFetch(exampleRoutes());
    renderApp({ programRunner: stallingRunner(0) });
    fireEvent.click(await findExampleOption('Factorial'));

    expect(await screen.findByRole('button', { name: 'Cancel' })).toBeVisible();
    expect(screen.getByRole('status')).toHaveTextContent('Loading Factorial');
    await waitFor(() => {
      expect(screen.getByTestId('loading-steps')).toHaveTextContent('125,000 steps');
    });
  });

  it('puts the run the reader was reading back, rather than an empty screen', async () => {
    stubFetch(exampleRoutes());
    renderApp({ programRunner: stallingRunner(1) });
    fireEvent.click(await findExampleOption('Factorial'));
    await screen.findByTestId('step-counter');

    fireEvent.click(exampleOption('GCD'));
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));

    expect(screen.getByTestId('step-counter')).toHaveTextContent(
      `step 1 / ${String(FACTORIAL_STEPS)}`,
    );
    expect(screen.getByRole('region', { name: 'Source' })).toHaveTextContent('Factorial.java');
    expect(screen.queryByTestId('panel-skeleton')).not.toBeInTheDocument();
    expect(screen.queryByTestId('error-banner')).not.toBeInTheDocument();
  });

  it('goes back to the welcome screen when there was nothing to go back to', async () => {
    stubFetch(exampleRoutes());
    renderApp({ programRunner: stallingRunner(0) });
    fireEvent.click(await findExampleOption('Factorial'));

    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));

    expect(screen.getByTestId('welcome-screen')).toBeInTheDocument();
  });

  it('does not offer to cancel a run this thread could not stop', async () => {
    stubFetch(exampleRoutes());
    renderApp({ programRunner: stallingRunner(0, false) });
    fireEvent.click(await findExampleOption('Factorial'));

    expect(await screen.findByRole('status')).toHaveTextContent('Loading Factorial');
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
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

describe('a link into a run', () => {
  it('opens on the example the hash names', async () => {
    window.history.replaceState(null, '', '#/factorial');
    stubFetch(exampleRoutes());

    renderApp();

    await waitFor(() =>
      expect(screen.getByTestId('step-counter')).toHaveTextContent(
        `step 1 / ${String(FACTORIAL_STEPS)}`,
      ),
    );
  });

  it('opens on the step the hash names', async () => {
    window.history.replaceState(null, '', '#/factorial/13');
    stubFetch(exampleRoutes());

    renderApp();

    await waitFor(() =>
      expect(screen.getByTestId('step-counter')).toHaveTextContent(
        `step 13 / ${String(FACTORIAL_STEPS)}`,
      ),
    );
  });

  it('opens on the tour stop the hash names', async () => {
    window.history.replaceState(null, '', '#/factorial/tour/recursion/3');
    stubFetch(exampleRoutes());

    renderApp();

    await waitFor(() =>
      expect(screen.getByTestId('step-counter')).toHaveTextContent(
        `step 10 / ${String(FACTORIAL_STEPS)}`,
      ),
    );
    expect(screen.getByTestId('tour-strip')).toHaveTextContent('3 / 6');
  });

  it('drops a step past the end of the run rather than clamping to it', async () => {
    window.history.replaceState(null, '', `#/factorial/${String(FACTORIAL_STEPS + 1)}`);
    stubFetch(exampleRoutes());

    renderApp();

    await waitFor(() =>
      expect(screen.getByTestId('step-counter')).toHaveTextContent(
        `step 1 / ${String(FACTORIAL_STEPS)}`,
      ),
    );
  });

  it('shows the welcome screen for an example the manifest does not carry', async () => {
    window.history.replaceState(null, '', '#/no-such-example');
    stubFetch(exampleRoutes());

    renderApp();

    expect(await screen.findByTestId('welcome-screen')).toBeInTheDocument();
    expect(screen.queryByTestId('step-counter')).not.toBeInTheDocument();
  });

  it('writes the position back, so the address bar is the link', async () => {
    stubFetch(exampleRoutes());
    await openFactorial();

    await hashSettlesOn('#/factorial/1');

    seekTo(12);

    await hashSettlesOn('#/factorial/13');
  });

  it('writes the tour stop back, and the step again once the tour is left', async () => {
    stubFetch(exampleRoutes());
    await openFactorial();

    fireEvent.click(screen.getByTestId('tour-start'));

    await hashSettlesOn('#/factorial/tour/recursion/1');

    fireEvent.click(screen.getByTestId('tour-next'));

    await hashSettlesOn('#/factorial/tour/recursion/2');

    fireEvent.click(screen.getByTestId('tour-leave'));

    expect(screen.queryByTestId('tour-strip')).not.toBeInTheDocument();
    await hashSettlesOn('#/factorial/5');
  });

  it('says nothing about an upload, which the link could not reach', async () => {
    stubFetch(exampleRoutes());
    await openApp();

    chooseFile(uploadFile('Gcd.class', new Uint8Array(readExampleBytes('Gcd.class'))));
    await screen.findByTestId('step-counter');

    expect(window.location.hash).toBe('');
  });
});

describe('playing the run back', () => {
  const PAST_ANY_URL_THROTTLE = 500;

  async function settleUnderFakeTimers(): Promise<void> {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PAST_ANY_URL_THROTTLE);
    });
  }

  it('runs from the space bar, holds the address bar still and hands it back on pause', async () => {
    stubFetch(exampleRoutes());
    await openFactorial();
    await hashSettlesOn('#/factorial/1');

    vi.useFakeTimers();
    try {
      fireEvent.keyDown(document.body, { key: ' ' });
      act(() => {
        vi.advanceTimersByTime(BASE_STEP_INTERVAL_MS * 3);
      });
      await settleUnderFakeTimers();

      expect(screen.getByTestId('step-counter')).toHaveTextContent(
        `step 4 / ${String(FACTORIAL_STEPS)}`,
      );
      expect(window.location.hash).toBe('#/factorial/1');

      fireEvent.keyDown(document.body, { key: ' ' });
      await settleUnderFakeTimers();

      expect(window.location.hash).toBe('#/factorial/4');
    } finally {
      vi.useRealTimers();
    }
  });

  it('stops the clock when another program is loaded mid-playback', async () => {
    stubFetch(exampleRoutes());
    await openFactorial();

    vi.useFakeTimers();
    try {
      fireEvent.keyDown(document.body, { key: ' ' });
      act(() => {
        vi.advanceTimersByTime(BASE_STEP_INTERVAL_MS * 2);
      });
      expect(screen.getByTestId('step-counter')).toHaveTextContent(
        `step 3 / ${String(FACTORIAL_STEPS)}`,
      );

      fireEvent.click(exampleOption('GCD'));
      await settleUnderFakeTimers();

      expect(screen.getByTestId('step-counter')).toHaveTextContent(`step 1 / ${String(GCD_STEPS)}`);

      act(() => {
        vi.advanceTimersByTime(BASE_STEP_INTERVAL_MS * 5);
      });

      expect(screen.getByTestId('step-counter')).toHaveTextContent(`step 1 / ${String(GCD_STEPS)}`);
      expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
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

    fireEvent.click(exampleOption('Factorial'));
    await screen.findByTestId('step-counter');
    expect(screen.queryByTestId('error-banner')).not.toBeInTheDocument();
  });

  it('reports the rejection next to the drop zone, and lets it be dismissed', async () => {
    stubFetch(exampleRoutes());
    await openApp();

    chooseFile(uploadFile('notes.txt', new TextEncoder().encode('just some text')));

    const banner = await screen.findByTestId('error-banner');
    expect(banner.closest('footer')).toBeNull();
    expect(screen.getByTestId('welcome-screen')).toContainElement(banner);

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss this message' }));

    expect(screen.queryByTestId('error-banner')).not.toBeInTheDocument();
    expect(screen.getAllByTestId('welcome-example').length).toBe(exampleCount());
  });

  it('reports the same rejection again when the same file is opened twice', async () => {
    stubFetch(exampleRoutes());
    await openApp();
    const notes = () => uploadFile('notes.txt', new TextEncoder().encode('just some text'));

    chooseFile(notes());
    await screen.findByTestId('error-banner');
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss this message' }));
    expect(screen.queryByTestId('error-banner')).not.toBeInTheDocument();

    chooseFile(notes());

    expect(await screen.findByTestId('error-banner')).toHaveTextContent('Not a .class file');
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
      'Stopped after 20,000 steps: the program probably does not terminate.',
    );
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

describe('exploring a class file with nothing to run', () => {
  async function openLibrary(): Promise<void> {
    stubFetch(exampleRoutes());
    await openApp();
    chooseFile(uploadFile('Library.class', new Uint8Array(readFixtureBytes('Library.class'))));
    await screen.findByTestId('class-panel');
  }

  it('lands in the explorer instead of bouncing back to the welcome screen', async () => {
    await openLibrary();

    expect(screen.queryByTestId('welcome-screen')).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Bytecode' })).toBeInTheDocument();
    expect(screen.queryByTestId('step-counter')).not.toBeInTheDocument();
  });

  it('says that nothing ran in the live region as well as in the notice', async () => {
    await openLibrary();

    await waitFor(() => {
      expect(screen.getByTestId('app-status')).toHaveTextContent(
        'Nothing was executed, so there is no active instruction.',
      );
    });
  });

  it('says why nothing ran, as a notice rather than as a failure', async () => {
    await openLibrary();

    const banner = screen.getByTestId('error-banner');
    expect(banner).toHaveAttribute('data-severity', 'info');
    expect(banner).toHaveTextContent('Library has no method this machine can start from');
    expect(banner).toHaveTextContent('every method listing are on screen to read');
  });

  it('opens the listing of any method the reader picks', async () => {
    await openLibrary();
    const bytecode = screen.getByRole('region', { name: 'Bytecode' });
    expect(bytecode).toHaveTextContent('<init>()V');

    fireEvent.click(within(rowFor('clamp(III)I')).getByText('clamp'));

    expect(bytecode).toHaveTextContent('clamp(III)I');
    expect(within(bytecode).getByText('if_icmpge')).toBeInTheDocument();
  });

  it('follows a #n in the listing to the entry it names', async () => {
    await openLibrary();

    fireEvent.click(screen.getByRole('button', { name: 'Show constant pool entry #1' }));

    const followed = screen
      .getAllByTestId('constant-row')
      .find((row) => row.getAttribute('data-index') === '1');
    expect(followed).toHaveAttribute('aria-current', 'true');
  });
});

describe('a class whose entry point is not called main', () => {
  async function openCounter(): Promise<void> {
    stubFetch(exampleRoutes());
    await openApp();
    chooseFile(uploadFile('Counter.class', new Uint8Array(readFixtureBytes('Counter.class'))));
    await screen.findByTestId('step-counter');
  }

  it('runs the only method it could start from', async () => {
    await openCounter();

    expect(screen.getByRole('region', { name: 'Bytecode' })).toHaveTextContent('count()I');
    expect(within(rowFor('count()I')).getByText('entry')).toBeInTheDocument();
    expect(within(rowFor('step(I)I')).getByText('listing only')).toBeInTheDocument();
  });

  it('re-runs from a method the picker offers', async () => {
    await openCounter();
    seekTo(20);

    fireEvent.click(screen.getByRole('button', { name: 'Run count()I' }));

    await waitFor(() => {
      expect(screen.getByTestId('step-counter')).toHaveTextContent('step 1 / 70');
    });
  });

  it('reads a method the run never entered without reporting it as dead code', async () => {
    await openCounter();

    fireEvent.click(within(rowFor('step(I)I')).getByText('step'));

    const bytecode = screen.getByRole('region', { name: 'Bytecode' });
    expect(bytecode).toHaveTextContent('step(I)I');
    expect(within(bytecode).queryByTestId('current-instruction')).not.toBeInTheDocument();
    expect(screen.queryByTestId('next-instruction-card')).not.toBeInTheDocument();
  });
});

function rowFor(signature: string): HTMLElement {
  const row = screen
    .getAllByTestId('method-row')
    .find((candidate) => candidate.getAttribute('data-method') === signature);
  if (row === undefined) {
    throw new Error(`no method row for ${signature}`);
  }
  return row;
}

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

const compiledGcdWithWarning: FakeRoute = () =>
  okResponse({
    json: {
      success: true,
      className: 'Gcd',
      classFileBase64: base64Of(readExampleBytes('Gcd.class')),
      diagnostics: [
        { line: 2, column: 34, kind: 'WARNING', message: 'unchecked call to add(int,int)' },
      ],
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

    const source = screen.getByRole('region', { name: 'Source' });
    expect(source).toHaveTextContent('Gcd.java');
    expect(source).toHaveTextContent('static int gcd(int a, int b)');
    expect(screen.queryByTestId('compile-editor')).not.toBeInTheDocument();
    expect(screen.queryByTestId('error-banner')).not.toBeInTheDocument();
  });

  it('says what javac warned about, and plays the class back all the same', async () => {
    stubFetch(compileRoutes(compiledGcdWithWarning));
    await openApp(COMPILE_API);

    await writeAndCompile();

    expect(await screen.findByTestId('step-counter')).toHaveTextContent(
      `step 1 / ${String(GCD_STEPS)}`,
    );
    const banner = screen.getByTestId('error-banner');
    expect(banner).toHaveAttribute('data-severity', 'warning');
    expect(banner).toHaveTextContent(
      'javac compiled the class with 1 warning at line 2: unchecked call to add(int,int). ' +
        'Warnings do not stop a compile, so the class it produced is the one on screen.',
    );
  });

  it('drops the warning when it is dismissed, and does not raise it over the next program', async () => {
    stubFetch(compileRoutes(compiledGcdWithWarning));
    await openApp(COMPILE_API);

    await writeAndCompile();
    await screen.findByTestId('error-banner');

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss this message' }));
    expect(screen.queryByTestId('error-banner')).not.toBeInTheDocument();

    fireEvent.click(exampleOption('Factorial'));

    await waitFor(() => {
      expect(screen.getByTestId('step-counter')).toHaveTextContent(
        `step 1 / ${String(FACTORIAL_STEPS)}`,
      );
    });
    expect(screen.queryByTestId('error-banner')).not.toBeInTheDocument();
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
      'The compile service is limiting how often this browser may compile. Try again in a minute. The examples and .class uploads still work.',
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

  it('says the service is still unreachable on the next attempt, once dismissed', async () => {
    stubFetch({ ...exampleRoutes(), [HEALTH_URL]: healthy });
    await openApp(COMPILE_API);

    await writeAndCompile();
    expect(await screen.findByTestId('error-banner')).toHaveTextContent(
      'Could not reach the compile service',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss this message' }));
    expect(screen.queryByTestId('error-banner')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Compile' }));

    expect(await screen.findByTestId('error-banner')).toHaveTextContent(
      'Could not reach the compile service',
    );
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

    expect(await screen.findByTestId('compile-diagnostic')).toBeInTheDocument();
    expect(screen.getByTestId('compiler-health')).toHaveAttribute('data-status', 'online');
    expect(screen.queryByTestId('error-banner')).not.toBeInTheDocument();
  });

  it('returns to what was on screen before when Escape closes it', async () => {
    stubFetch(compileRoutes(compiledGcd));
    await openApp(COMPILE_API);
    fireEvent.click(exampleOption('Factorial'));
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

    fireEvent.click(exampleOption('Factorial'));

    expect(await screen.findByTestId('step-counter')).toBeInTheDocument();
    expect(screen.queryByTestId('compile-editor')).not.toBeInTheDocument();
  });

  it('holds the transport while the editor is open, and hands it back on close', async () => {
    stubFetch(compileRoutes(compiledGcd));
    await openApp(COMPILE_API);
    fireEvent.click(exampleOption('Factorial'));
    await screen.findByTestId('step-counter');
    const textarea = await openEditor();

    fireEvent.keyDown(textarea, { key: ' ' });
    fireEvent.keyDown(textarea, { key: 'ArrowRight' });
    fireEvent.keyDown(screen.getByRole('button', { name: 'Compile' }), { key: 'ArrowRight' });
    fireEvent.keyDown(document.body, { key: 'End' });

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await screen.findByTestId('step-counter');

    expect(screen.getByTestId('step-counter')).toHaveTextContent(
      `step 1 / ${String(FACTORIAL_STEPS)}`,
    );

    fireEvent.keyDown(document.body, { key: 'ArrowRight' });
    expect(screen.getByTestId('step-counter')).toHaveTextContent(
      `step 2 / ${String(FACTORIAL_STEPS)}`,
    );
  });
});
