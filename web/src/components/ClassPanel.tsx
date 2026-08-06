import { useMemo, type ReactNode } from 'react';

import type { ClassFile } from '../core/classfile';
import { classFactsOf, constantPoolRowsOf, fieldRowsOf } from '../services/class-view';
import type { MethodListing } from '../services/program';

import { ConstantPoolTable } from './ConstantPoolTable';
import { MethodPicker } from './MethodPicker';
import { Panel } from './Panel';

export interface ClassPanelProps {
  readonly classFile: ClassFile;
  readonly methods: readonly MethodListing[];
  readonly selectedMethod: MethodListing | undefined;
  readonly onSelectMethod: (method: MethodListing) => void;
  readonly onRunMethod?: ((method: MethodListing) => void) | undefined;
  readonly entryMethod?: MethodListing | undefined;
  readonly selectedConstant?: number | undefined;
  readonly onSelectConstant?: ((index: number) => void) | undefined;
  /** Rendered in the panel header in place of the title — the Source/Class switch. */
  readonly titleControl?: ReactNode;
  readonly className?: string;
}

/** Hierarchy inside the glass comes from opacity and hairlines, never from a border. */
function Hairline() {
  return <div aria-hidden="true" className="mx-[18px] h-px shrink-0 bg-line" />;
}

function SectionHeading({ children }: { readonly children: ReactNode }) {
  return <h3 className="px-[18px] pb-[8px] text-meta font-semibold text-fg-3">{children}</h3>;
}

/**
 * The class file as `javap -v` opens it: who the class is, what it declares, and the pool
 * every one of those declarations is spelled out of.
 *
 * None of it depends on a run. A class whose every method takes arguments has nothing this
 * machine can execute and still has all of this to read, which is the whole point of the
 * panel — a parse that cannot be replayed is not a failure, it is a class file.
 */
export function ClassPanel({
  classFile,
  methods,
  selectedMethod,
  onSelectMethod,
  onRunMethod,
  entryMethod,
  selectedConstant,
  onSelectConstant,
  titleControl,
  className = '',
}: ClassPanelProps) {
  // The compiler memoises this file anyway; the intent is the point. Resolving every entry of
  // the pool of a real class file is a few hundred lookups, and none of them depend on a step.
  const facts = useMemo(() => classFactsOf(classFile), [classFile]);
  const fields = useMemo(() => fieldRowsOf(classFile), [classFile]);
  const constants = useMemo(() => constantPoolRowsOf(classFile.constantPool), [classFile]);

  return (
    <Panel
      title="Class file"
      titleControl={titleControl}
      meta={`${simpleNameOf(classFile.thisClassName)} · ${String(constants.length)} constants`}
      className={className}
    >
      <div data-testid="class-panel" className="flex flex-col gap-[14px] pb-[14px]">
        <dl className="flex flex-col gap-[6px] px-[18px]">
          {facts.map((fact) => (
            <div
              key={fact.label}
              data-testid="class-fact"
              data-fact={fact.label}
              className="flex items-baseline gap-3"
            >
              <dt className="w-[86px] shrink-0 font-mono text-meta text-fg-3">{fact.label}</dt>
              <dd className="min-w-0">
                <span className="font-mono text-label break-all text-fg-2">{fact.value}</span>
                {/* `65.0` is a number; `class file format of Java 21` is what it means. */}
                {fact.note === undefined ? null : (
                  <span className="pl-2 text-meta text-fg-3">{fact.note}</span>
                )}
              </dd>
            </div>
          ))}
        </dl>

        {/* A section permanently reading "no fields" would be a fixture that says nothing. */}
        {fields.length === 0 ? null : (
          <>
            <Hairline />
            <div>
              <SectionHeading>Fields</SectionHeading>
              <ul className="flex flex-col gap-[5px] px-[10px]">
                {fields.map((field) => (
                  <li
                    key={`${field.name}:${field.descriptor}`}
                    data-testid="field-row"
                    title={`descriptor ${field.descriptor}`}
                    className="flex items-center gap-2 rounded-row bg-raised px-[13px] py-[8px] text-label"
                  >
                    {field.modifiers.length === 0 ? null : (
                      <span className="shrink-0 font-mono text-meta text-fg-3">
                        {field.modifiers.join(' ')}
                      </span>
                    )}
                    <span className="truncate text-fg">{field.name}</span>
                    <span className="grow" />
                    <span className="shrink-0 font-mono text-meta text-fg-3">{field.type}</span>
                  </li>
                ))}
              </ul>
            </div>
          </>
        )}

        <Hairline />
        <div>
          <SectionHeading>Methods</SectionHeading>
          <MethodPicker
            methods={methods}
            selected={selectedMethod}
            onSelect={onSelectMethod}
            onRun={onRunMethod}
            entry={entryMethod}
          />
        </div>

        <Hairline />
        <div>
          <SectionHeading>Constant pool</SectionHeading>
          <ConstantPoolTable
            rows={constants}
            selectedIndex={selectedConstant}
            onSelectIndex={onSelectConstant}
          />
        </div>
      </div>
    </Panel>
  );
}

/** The header carries the whole internal name; the panel metadata only has room for the class. */
function simpleNameOf(internalName: string): string {
  return internalName.slice(internalName.lastIndexOf('/') + 1);
}
