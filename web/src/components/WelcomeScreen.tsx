import type { RunPreview } from '../services/program';

import { CapabilityNote } from './CapabilityNote';
import { ErrorBanner, type BannerSeverity } from './ErrorBanner';
import { FileUpload } from './FileUpload';
import { openGlossary } from './glossary-store';

export interface WelcomeExample {
  readonly id: string;
  readonly title: string;
  /** One line, written to fit — the long description stays in the toolbar tooltip. */
  readonly tagline: string;
  /** Length and shape of the run, once it has been measured. */
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
  /** Absent unless a compile service is configured and answered its health check. */
  readonly onWriteJava?: (() => void) | undefined;
  /** A failed upload or a manifest that never arrived — shown next to what caused it. */
  readonly notice?: WelcomeNotice | undefined;
}

/** Short answer to "what does this thing actually do", in three beats. */
const STEPS: readonly { readonly head: string; readonly body: string }[] = [
  { head: 'Parse', body: 'Constant pool, methods, Code attributes — read byte by byte.' },
  { head: 'Disassemble', body: 'Every opcode resolved against the real constant pool.' },
  { head: 'Execute', body: 'One frame at a time, with every step recorded for replay.' },
];

/**
 * The recursion profile of the whole run in 32 bars — the same chart the scrubber carries,
 * shrunk to a thumbnail. It is the one thing that tells the examples apart at a glance:
 * a flat line is a loop, a staircase is recursion.
 */
function DepthSparkline({ preview }: { readonly preview: RunPreview }) {
  const scale = Math.max(preview.maxDepth, 1);

  return (
    <span aria-hidden="true" className="flex h-[18px] items-end gap-px">
      {preview.profile.map((depth, bucket) => (
        <span
          key={bucket}
          data-testid="welcome-sparkline-bar"
          className="min-h-px flex-1 rounded-[1px] bg-white/25 transition-colors group-hover:bg-accent/70"
          style={{ height: `${String((depth / scale) * 100)}%` }}
        />
      ))}
    </span>
  );
}

/**
 * First screen — and the frame the README, the OG image and every reviewer sees first, so it
 * is composed rather than merely empty.
 *
 * One column read top to bottom: a headline that says what happens here, the pipeline in three
 * words, the bundled programs as a full-width row of real targets, then the drop zone for the
 * file someone brought along, and the honest note about what will happen to it.
 */
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
      {/* `margin: auto` rather than `justify-center`, and on the column's main axis: with room
          to spare the auto margins centre the block, and when the content is taller than the
          cell they resolve to zero instead of splitting the overflow across both edges — so a
          short viewport loses the drop zone off the bottom, never the headline off the top.
          The 18px band the padding reserves is what the `fade-y` mask eats when nothing is
          clipped. */}
      <div className="m-auto flex w-full max-w-[1080px] flex-col gap-[18px] py-[18px]">
        <header className="max-w-[680px]">
          <h2 className="text-display font-semibold tracking-[-0.02em] text-white/95">
            Watch a Java program run,
            <br />
            one bytecode instruction at a time.
          </h2>
          <p className="mt-[12px] text-body text-white/55">
            A <code className="font-mono text-white/75">.class</code> file is parsed, disassembled
            and executed here in the browser — no server, no upload. The whole run is recorded, so
            you can play it back like a video and watch the call stack, the operand stack and every
            local variable slot change.
          </p>
        </header>

        <ul className="grid gap-[10px] sm:grid-cols-3">
          {STEPS.map((step, index) => (
            <li
              key={step.head}
              className="rounded-row bg-white/[0.035] px-[14px] py-[11px] shadow-panel"
            >
              <span className="flex items-baseline gap-2">
                <span className="font-mono text-micro text-white/28">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <span className="text-label font-semibold text-white/85">{step.head}</span>
              </span>
              <span className="mt-[3px] block text-meta text-white/50">{step.body}</span>
            </li>
          ))}
        </ul>

        <section aria-label="Example programs">
          {/* On the heading's own line, so the invitation costs the cards no vertical room. */}
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="text-label font-semibold text-white/50">Start with an example</h3>
            <button
              type="button"
              data-testid="welcome-glossary"
              onClick={() => {
                openGlossary();
              }}
              className="focus-ring shrink-0 rounded-full bg-white/6 px-[10px] py-[4px] text-meta text-white/55 transition-colors hover:bg-white/12 hover:text-white/85"
            >
              New to the JVM? What these words mean
            </button>
          </div>
          <ul className="mt-[10px] grid gap-[12px] sm:grid-cols-2 xl:grid-cols-4">
            {examples.map((example) => (
              <li key={example.id} className="flex">
                <button
                  type="button"
                  data-testid="welcome-example"
                  onClick={() => {
                    onExampleSelected(example.id);
                  }}
                  className="focus-ring group flex w-full flex-col gap-[8px] rounded-panel bg-panel/[0.045] px-[16px] py-[14px] text-left shadow-panel transition-colors hover:bg-panel/[0.09]"
                >
                  <span className="text-title font-semibold text-white/90">{example.title}</span>
                  <span className="grow text-meta text-white/55">{example.tagline}</span>
                  {example.preview === undefined ? null : (
                    <>
                      <DepthSparkline preview={example.preview} />
                      <span className="font-mono text-micro text-white/40 tabular-nums">
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

        {/* Above the drop zone, not after the last thing on the page: the column is anchored to
            the top, so anything below the fold is a message nobody reads. */}
        {notice === undefined ? null : (
          <ErrorBanner
            severity={notice.severity}
            message={notice.message}
            onDismiss={notice.onDismiss}
          />
        )}

        <div className="flex flex-col gap-[10px] lg:flex-row lg:items-stretch">
          <div className="flex-1">
            <FileUpload variant="zone" onFileSelected={onFileSelected} />
          </div>
          {onWriteJava === undefined ? null : (
            <button
              type="button"
              data-testid="welcome-write-java"
              onClick={onWriteJava}
              className="focus-ring flex flex-col items-center justify-center gap-2 rounded-panel bg-white/[0.03] px-6 py-7 text-label text-white/75 shadow-panel transition-colors hover:bg-white/[0.07] lg:w-[300px]"
            >
              <span className="rounded-full bg-white/9 px-3 py-1.5 text-white/80 shadow-control-raised">
                Write Java…
              </span>
              <span className="text-meta text-white/55">compile a small class and run it here</span>
            </button>
          )}
        </div>

        {/* Directly under the drop zone, because that is where someone decides whether the file
            they brought is worth trying. Closed it is one line, so the examples stay in frame. */}
        <CapabilityNote />
      </div>
    </div>
  );
}
