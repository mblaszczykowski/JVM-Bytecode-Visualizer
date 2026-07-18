import { FileUpload } from './FileUpload';

export interface WelcomeExample {
  readonly id: string;
  readonly title: string;
  readonly description: string;
}

interface WelcomeScreenProps {
  readonly examples: readonly WelcomeExample[];
  readonly onExampleSelected: (id: string) => void;
  readonly onFileSelected: (file: File) => void;
  /** Absent unless a compile service is configured and answered its health check. */
  readonly onWriteJava?: (() => void) | undefined;
}

/**
 * First screen: one centred panel in place of the grid. It is the frame every reader sees
 * first, so it says what the application does and offers the four examples as full-size
 * targets rather than as a strip of toolbar segments.
 */
export function WelcomeScreen({
  examples,
  onExampleSelected,
  onFileSelected,
  onWriteJava,
}: WelcomeScreenProps) {
  return (
    <div className="col-span-full row-span-full flex min-h-0 items-center justify-center overflow-auto scroll-slim">
      <div className="w-full max-w-[720px] rounded-panel bg-panel/[0.045] px-[28px] py-[26px] shadow-panel">
        <h2 className="text-[15px] font-semibold tracking-[-0.015em] text-white/95">
          Watch a Java program run, one bytecode instruction at a time.
        </h2>
        <p className="mt-[10px] text-[12.5px] leading-[19px] text-white/55">
          The class file is parsed, disassembled and executed here in the browser, and the whole run
          is recorded. Play it back like a video: every instruction, the call stack, the operand
          stack and every local variable slot.
        </p>

        <ul className="mt-[20px] grid gap-[10px] sm:grid-cols-2">
          {examples.map((example) => (
            <li key={example.id} className="flex">
              <button
                type="button"
                data-testid="welcome-example"
                onClick={() => {
                  onExampleSelected(example.id);
                }}
                className="focus-ring flex w-full flex-col gap-[5px] rounded-row bg-white/5 px-[15px] py-[12px] text-left transition-colors hover:bg-white/10"
              >
                <span className="text-[12.5px] font-semibold text-white/90">{example.title}</span>
                <span className="line-clamp-3 text-[11.5px] leading-[16px] text-white/55">
                  {example.description}
                </span>
              </button>
            </li>
          ))}
        </ul>

        <div className="mt-[18px] flex flex-col gap-[10px]">
          <FileUpload variant="zone" onFileSelected={onFileSelected} />
          {onWriteJava === undefined ? null : (
            <button
              type="button"
              data-testid="welcome-write-java"
              onClick={onWriteJava}
              className="focus-ring rounded-row bg-white/5 px-[15px] py-[12px] text-[12px] text-white/70 transition-colors hover:bg-white/10"
            >
              Write Java here and compile it
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
