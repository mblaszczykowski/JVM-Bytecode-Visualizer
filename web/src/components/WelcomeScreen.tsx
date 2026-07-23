import type { RunPreview } from '../services/program';

import { ErrorBanner, type BannerSeverity } from './ErrorBanner';
import { FileUpload } from './FileUpload';

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
 * shrunk to a thumbnail. It is the one thing that tells the four examples apart at a glance:
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
 * It is anchored to the top of the grid instead of floating in the middle of a void: a
 * headline that says what happens here, the pipeline in three words, the four programs as a
 * full-width row of real targets, and the drop zone last, for the file someone brought along.
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
      className="scroll-slim col-span-full row-span-full flex min-h-0 overflow-auto"
    >
      {/* `margin: auto` rather than `justify-center`: on a short viewport the top of a centred
          flex item cannot be scrolled back to, and this is the screen with the headline on it. */}
      <div className="m-auto flex w-full max-w-[1080px] flex-col gap-[18px] py-[10px]">
        <header className="max-w-[680px]">
          <h2 className="text-[27px] leading-[1.15] font-semibold tracking-[-0.02em] text-white/95">
            Watch a Java program run,
            <br />
            one bytecode instruction at a time.
          </h2>
          <p className="mt-[12px] text-[13px] leading-[20px] text-white/55">
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
                <span className="font-mono text-[10px] text-white/28">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <span className="text-[12px] font-semibold text-white/85">{step.head}</span>
              </span>
              <span className="mt-[3px] block text-[11.5px] leading-[16px] text-white/50">
                {step.body}
              </span>
            </li>
          ))}
        </ul>

        <section aria-label="Example programs">
          <h3 className="text-[11.5px] font-semibold text-white/50">Start with an example</h3>
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
                  <span className="text-[13px] font-semibold text-white/90">{example.title}</span>
                  <span className="grow text-[11.5px] leading-[16px] text-white/55">
                    {example.tagline}
                  </span>
                  {example.preview === undefined ? null : (
                    <>
                      <DepthSparkline preview={example.preview} />
                      <span className="font-mono text-[10.5px] text-white/40 tabular-nums">
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

        <div className="flex flex-col gap-[10px] lg:flex-row lg:items-stretch">
          <div className="flex-1">
            <FileUpload variant="zone" onFileSelected={onFileSelected} />
          </div>
          {onWriteJava === undefined ? null : (
            <button
              type="button"
              data-testid="welcome-write-java"
              onClick={onWriteJava}
              className="focus-ring flex flex-col items-center justify-center gap-1 rounded-panel bg-white/[0.03] px-6 py-7 text-[12px] text-white/75 shadow-panel transition-colors hover:bg-white/[0.07] lg:w-[300px]"
            >
              <span className="rounded-full bg-white/9 px-3 py-1.5 text-white/80 shadow-control-raised">
                Write Java…
              </span>
              <span className="text-[11.5px] text-white/55">
                compile a small class and run it here
              </span>
            </button>
          )}
        </div>

        {/* Next to the thing that failed, not pinned to the bottom of the window. */}
        {notice === undefined ? null : (
          <ErrorBanner
            severity={notice.severity}
            message={notice.message}
            onDismiss={notice.onDismiss}
          />
        )}
      </div>
    </div>
  );
}
