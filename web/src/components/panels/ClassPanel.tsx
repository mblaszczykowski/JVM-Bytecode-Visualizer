import { useCallback, useMemo, type ReactNode } from 'react';

import type { ClassFile } from '../../core/classfile';
import { useScrollFollow } from '../../hooks/useScrollFollow';
import { classFactsOf, constantPoolRowsOf, fieldRowsOf } from '../../services/class-view';
import type { MethodListing } from '../../services/program';

import { ConstantPoolList } from './ConstantPoolList';
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
  readonly titleControl?: ReactNode;
  readonly className?: string;
}

function Hairline() {
  return <div aria-hidden="true" className="mx-4 h-px shrink-0 bg-line" />;
}

function SectionHeading({ children }: { readonly children: ReactNode }) {
  return <h3 className="px-4 pb-2 text-meta font-medium text-fg-3">{children}</h3>;
}

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
  const facts = useMemo(() => classFactsOf(classFile), [classFile]);
  const fields = useMemo(() => fieldRowsOf(classFile), [classFile]);
  const constants = useMemo(() => constantPoolRowsOf(classFile.constantPool), [classFile]);
  const contentRef = useScrollFollow(
    useCallback(
      (container: HTMLElement) => selectedRowTop(container, selectedConstant),
      [selectedConstant],
    ),
  );

  return (
    <Panel
      title="Class file"
      titleControl={titleControl}
      meta={`${simpleNameOf(classFile.thisClassName)} · ${String(constants.length)} constants`}
      contentRef={contentRef}
      className={className}
    >
      <div data-testid="class-panel" className="flex flex-col gap-3.5 pb-3.5">
        <dl className="flex flex-col gap-1.5 px-4">
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
                {fact.note === undefined ? null : (
                  <span className="pl-2 text-meta text-fg-3">{fact.note}</span>
                )}
              </dd>
            </div>
          ))}
        </dl>

        {fields.length === 0 ? null : (
          <>
            <Hairline />
            <div>
              <SectionHeading>Fields</SectionHeading>
              <ul className="flex flex-col gap-1 px-2.5">
                {fields.map((field) => (
                  <li
                    key={`${field.name}:${field.descriptor}`}
                    data-testid="field-row"
                    title={`descriptor ${field.descriptor}`}
                    className="flex items-center gap-2 rounded-row bg-raised px-3 py-2 text-label"
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
          <ConstantPoolList
            rows={constants}
            selectedIndex={selectedConstant}
            onSelectIndex={onSelectConstant}
          />
        </div>
      </div>
    </Panel>
  );
}

function simpleNameOf(internalName: string): string {
  return internalName.slice(internalName.lastIndexOf('/') + 1);
}

function selectedRowTop(container: HTMLElement, index: number | undefined): number | undefined {
  if (index === undefined) {
    return undefined;
  }
  const row = container.querySelector<HTMLElement>(
    `[data-testid="constant-row"][data-index="${String(index)}"]`,
  );
  if (row === null) {
    return undefined;
  }
  return (
    container.scrollTop + row.getBoundingClientRect().top - container.getBoundingClientRect().top
  );
}
