import { openGlossary } from '../../services/glossary-store';
import type { RunPreview } from '../../services/program';

import { CapabilityNote } from './CapabilityNote';
import { ErrorBanner, type BannerSeverity } from '../chrome/ErrorBanner';
import { FileUpload } from './FileUpload';
import { Button } from '../ui/Button';
import { buttonSurface } from '../ui/button-surface';

export interface WelcomeExample {
  readonly id: string;
  readonly title: string;
  readonly tagline: string;
  readonly preview?: RunPreview | undefined;
}

export interface WelcomeNotice {
  readonly severity: BannerSeverity;
  readonly message: string;
  readonly onDismiss: () => void;
}

interface WelcomeScreenProps {
  readonly examples: readonly WelcomeExample[];
  readonly onExampleSelected: (id: string) => void;
  readonly onFileSelected: (file: File) => void;
  readonly onWriteJava?: (() => void) | undefined;
  readonly notice?: WelcomeNotice | undefined;
}

const STEPS: readonly { readonly head: string; readonly body: string }[] = [
  { head: 'Parse', body: 'Constant pool, methods and Code attributes, read byte by byte.' },
  { head: 'Disassemble', body: 'Every opcode resolved against the real constant pool.' },
  { head: 'Execute', body: 'One frame at a time, with every step recorded for replay.' },
];

function DepthSparkline({ preview }: { readonly preview: RunPreview }) {
  const scale = Math.max(preview.maxDepth, 1);

  return (
    <span aria-hidden="true" className="flex h-[18px] items-end gap-px">
      {preview.profile.map((depth, bucket) => (
        <span
          key={bucket}
          data-testid="welcome-sparkline-bar"
          className="min-h-px flex-1 bg-fg-dim transition-colors duration-150 group-hover:bg-accent"
          style={{ height: `${String((depth / scale) * 100)}%` }}
        />
      ))}
    </span>
  );
}

export function WelcomeScreen({
  examples,
  onExampleSelected,
  onFileSelected,
  onWriteJava,
  notice,
}: WelcomeScreenProps) {
  return (
    <div
      data-testid="welcome-screen"
      className="scroll-slim fade-y col-span-full row-span-full flex min-h-0 flex-col overflow-auto"
    >
      <div className="m-auto flex w-full max-w-[1080px] flex-col gap-4 py-4">
        <div className="max-w-[820px]">
          <h2 className="text-display font-semibold tracking-[-0.028em] text-fg">
            Watch a Java program run,
            <br />
            one bytecode instruction at a time.
          </h2>
          <p className="mt-3.5 max-w-[64ch] text-body text-fg-2">
            A <code className="font-mono text-fg">.class</code> file is parsed, disassembled and
            executed here in the browser. No server, no upload. The whole run is recorded, so you
            can play it back like a video and watch the call stack, the operand stack and every
            local variable slot change.
          </p>
        </div>

        <ul className="grid divide-y divide-line border-y border-line sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          {STEPS.map((step) => (
            <li key={step.head} className="py-3 sm:px-4 sm:first:pl-0 sm:last:pr-0">
              <span className="block text-label font-medium text-fg">{step.head}</span>
              <span className="mt-0.5 block text-meta text-fg-3">{step.body}</span>
            </li>
          ))}
        </ul>

        <section aria-label="Example programs">
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="text-label font-medium text-fg-2">Start with an example</h3>
            <Button
              size="sm"
              data-testid="welcome-glossary"
              onClick={() => {
                openGlossary();
              }}
              className="shrink-0"
            >
              New to the JVM? What these words mean
            </Button>
          </div>
          <ul className="mt-2.5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {examples.map((example) => (
              <li key={example.id} className="flex">
                <button
                  type="button"
                  data-testid="welcome-example"
                  onClick={() => {
                    onExampleSelected(example.id);
                  }}
                  className="focus-ring group flex w-full flex-col gap-1.5 rounded-panel bg-panel px-3.5 py-3 text-left shadow-panel transition-colors duration-150 hover:bg-raised"
                >
                  <span className="text-title font-medium text-fg">{example.title}</span>
                  <span className="grow text-meta text-fg-2">{example.tagline}</span>
                  {example.preview === undefined ? null : (
                    <>
                      <DepthSparkline preview={example.preview} />
                      <span className="font-mono text-micro text-fg-3 tabular-nums">
                        {example.preview.steps.toLocaleString('en-US')} steps · depth{' '}
                        {example.preview.maxDepth}
                      </span>
                    </>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </section>

        {notice === undefined ? null : (
          <ErrorBanner
            severity={notice.severity}
            message={notice.message}
            onDismiss={notice.onDismiss}
          />
        )}

        <div className="flex flex-col gap-2.5 lg:flex-row lg:items-stretch">
          <div className="flex-1">
            <FileUpload variant="zone" onFileSelected={onFileSelected} />
          </div>
          {onWriteJava === undefined ? null : (
            <button
              type="button"
              data-testid="welcome-write-java"
              onClick={onWriteJava}
              className="focus-ring flex flex-wrap items-center justify-center gap-x-3 gap-y-1 rounded-panel bg-panel px-5 py-4 text-label text-fg-2 shadow-panel transition-colors duration-150 hover:bg-raised lg:w-[300px]"
            >
              <span className={buttonSurface('prominent')}>Write Java…</span>
              <span className="text-meta text-fg-3">compile a small class and run it here</span>
            </button>
          )}
        </div>

        <CapabilityNote />
      </div>
    </div>
  );
}
