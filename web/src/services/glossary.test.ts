/// <reference types="node" />

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as process from 'node:process';
import { describe, expect, it } from 'vitest';

import { GLOSSARY, glossaryEntry, glossaryTermForPanel, type GlossaryTermId } from './glossary';

function primerText(): string {
  const candidates = [
    resolve(process.cwd(), '../docs/jvm-primer.md'),
    resolve(process.cwd(), 'docs/jvm-primer.md'),
  ];
  const found = candidates.find((path) => existsSync(path));
  if (found === undefined) {
    throw new Error(`jvm-primer.md not found (looked in: ${candidates.join(', ')})`);
  }
  return readFileSync(found, 'utf8');
}

const PRIMER = primerText();

const PRIMER_SECTIONS = new Map(
  [...PRIMER.matchAll(/^## (\d+)\. (.+)$/gm)].map((heading) => [
    Number(heading[1]),
    heading[2] ?? '',
  ]),
);

function citationsOf(text: string): readonly string[] {
  return [...text.matchAll(/§\d+(?:\.\d+)*/g)].map((match) => match[0]);
}

describe('glossary', () => {
  it('condenses a section the primer actually has, under the title it actually carries', () => {
    expect(PRIMER_SECTIONS.size).toBeGreaterThan(0);

    for (const entry of GLOSSARY) {
      expect(PRIMER_SECTIONS.get(entry.primer.section), entry.term).toBe(entry.primer.title);
    }
  });

  it('cites no JVMS section the primer does not cite for the same machine', () => {
    for (const entry of GLOSSARY) {
      for (const citation of citationsOf(entry.paragraphs.join(' '))) {
        const cited = new RegExp(`${citation.replaceAll('.', '\\.')}(?![\\d.])`);
        expect(cited.test(PRIMER), `${entry.term} cites ${citation}`).toBe(true);
      }
    }
  });

  it('asserts every rule against a citation', () => {
    for (const entry of GLOSSARY) {
      expect(citationsOf(entry.paragraphs.join(' ')).length, entry.term).toBeGreaterThan(0);
    }
  });

  it('covers the terms the panels name and keeps every cross-reference reachable', () => {
    const known = new Set(GLOSSARY.map((entry) => entry.id));
    expect(known.size).toBe(GLOSSARY.length);

    for (const entry of GLOSSARY) {
      for (const related of entry.related) {
        expect(known.has(related), `${entry.term} → ${related}`).toBe(true);
        expect(related).not.toBe(entry.id);
      }
    }
  });

  it('answers for the panels that draw a mechanism, and stays quiet for the rest', () => {
    const panels: Readonly<Record<string, GlossaryTermId>> = {
      Source: 'line-number-table',
      'Class file': 'constant-pool',
      Bytecode: 'opcode',
      'Call stack': 'call-stack',
      'Operand stack': 'operand-stack',
      Locals: 'local-variable-slot',
    };

    for (const [panel, term] of Object.entries(panels)) {
      expect(glossaryTermForPanel(panel), panel).toBe(term);
    }
    expect(glossaryTermForPanel('Console')).toBeUndefined();
    expect(glossaryTermForPanel('Heap')).toBeUndefined();
  });

  it('asks a question a reader would ask, in the voice of the primer', () => {
    for (const entry of GLOSSARY) {
      expect(entry.question.endsWith('?'), entry.term).toBe(true);
      expect(glossaryEntry(entry.id)).toBe(entry);
    }
  });
});
