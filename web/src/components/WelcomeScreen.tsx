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
          className="min-h-px flex-1 rounded-[1px] bg-fg-dim transition-colors group-hover:bg-accent"
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
        {/* Not a <header>: the toolbar is this document's banner landmark, and a second
            one makes both of them ambiguous to a screen reader working by landmark. */}
        <div className="max-w-[820px]">
          <h2 className="text-display font-semibold tracking-[-0.028em] text-fg">
            Watch a Java program run,
            <br />
            one bytecode instruction at a time.
          </h2>
          {/* Its own measure rather than the header's: 38px type wants a wide column and 13px
              prose does not, and one width for both leaves the paragraph too long to track. */}
          <p className="mt-[14px] max-w-[64ch] text-body text-fg-2">
            A <code className="font-mono text-fg">.class</code> file is parsed, disassembled and
            executed here in the browser — no server, no upload. The whole run is recorded, so you
            can play it back like a video and watch the call stack, the operand stack and every
            local variable slot change.
          </p>
        </div>

        {/*
          The pipeline, as a band divided by hairlines rather than as three numbered cards.

          Parse → Disassemble → Execute is a real sequence, so the order carries information and
          has to survive. What does not have to survive is printing `01 02 03` beside it: reading
          left to right across a divided band already says "in this order", and the numerals were
          decoration standing in for structure. Below `sm` the band stacks and the rules lie down
          with it, which is the same statement rotated.
        */}
        <ul className="grid divide-y divide-line border-y border-line sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          {STEPS.map((step) => (
            <li key={step.head} className="py-[12px] sm:px-[16px] sm:first:pl-0 sm:last:pr-0">
              <span className="block text-label font-medium text-fg">{step.head}</span>
              <span className="mt-[3px] block text-meta text-fg-3">{step.body}</span>
            </li>
          ))}
        </ul>

        <section aria-label="Example programs">
          {/* On the heading's own line, so the invitation costs the cards no vertical room. */}
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="text-label font-medium text-fg-2">Start with an example</h3>
            <button
              type="button"
              data-testid="welcome-glossary"
              onClick={() => {
                openGlossary();
              }}
              className="focus-ring shrink-0 rounded-control px-[8px] py-[4px] text-meta text-fg-2 transition-colors duration-150 hover:bg-raised hover:text-fg"
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
                  className="focus-ring group flex w-full flex-col gap-[7px] rounded-panel bg-panel px-[14px] py-[12px] text-left shadow-panel transition-colors duration-150 hover:bg-raised"
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
              className="focus-ring flex flex-wrap items-center justify-center gap-x-3 gap-y-1 rounded-panel bg-panel px-5 py-4 text-label text-fg-2 shadow-panel transition-colors duration-150 hover:bg-raised lg:w-[300px]"
            >
              <span className="rounded-control bg-raised px-[10px] py-[5px] text-fg shadow-control-raised">
                Write Java…
              </span>
              <span className="text-meta text-fg-3">compile a small class and run it here</span>
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
