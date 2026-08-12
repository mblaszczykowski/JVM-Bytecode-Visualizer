export type GlossaryTermId =
  | 'operand-stack'
  | 'call-stack'
  | 'frame'
  | 'local-variable-slot'
  | 'program-counter'
  | 'opcode'
  | 'branch-target'
  | 'constant-pool'
  | 'descriptor'
  | 'line-number-table';

export interface PrimerReference {
  readonly section: number;
  readonly title: string;
}

export interface GlossaryEntry {
  readonly id: GlossaryTermId;
  readonly term: string;
  readonly question: string;
  readonly paragraphs: readonly string[];
  readonly primer: PrimerReference;
  readonly related: readonly GlossaryTermId[];
}

const ENTRIES: Readonly<Record<GlossaryTermId, GlossaryEntry>> = {
  'operand-stack': {
    id: 'operand-stack',
    term: 'Operand stack',
    question: 'What is the operand stack?',
    paragraphs: [
      'Where an instruction keeps the values it is about to use. The JVM names no registers, ' +
        'so `iadd` says nothing about its inputs: it pops the two values on top of this stack ' +
        'and pushes their sum (JVMS §2.6.2).',
      'It belongs to one frame and is empty when that frame is created, so this panel always ' +
        'shows the stack of the method currently executing. Between `iadd` and the `istore` ' +
        'that follows it, the result exists only here and has no name yet, which is a state a ' +
        'source-level debugger cannot show.',
      'Typical depth is two or three. javac computes the deepest a method can ever go and ' +
        'records it as `max_stack` in the Code attribute (JVMS §4.7.3), so the size is fixed ' +
        'before the method runs.',
    ],
    primer: { section: 2, title: 'The JVM has two stacks' },
    related: ['call-stack', 'frame'],
  },

  'call-stack': {
    id: 'call-stack',
    term: 'Call stack',
    question: 'What is the call stack?',
    paragraphs: [
      'The second stack, unrelated to the operand stack: it holds one frame per method ' +
        'invocation in progress (JVMS §2.5.2). Every call pushes a frame, every return pops ' +
        'one.',
      'The frame executing right now is drawn at the bottom of the list, beside the panels ' +
        'that describe it, with the entry method at the top. Its depth is what the chart under ' +
        'the scrubber plots across the whole run; recursion is the shape that goes up and ' +
        'comes back down.',
      'This is the stack that overflows into `StackOverflowError`. An operand stack cannot ' +
        'overflow at run time, because its maximum was computed at compile time.',
    ],
    primer: { section: 2, title: 'The JVM has two stacks' },
    related: ['operand-stack', 'frame'],
  },

  frame: {
    id: 'frame',
    term: 'Frame',
    question: 'What is a frame?',
    paragraphs: [
      'A frame is created on every method invocation and destroyed when that invocation ' +
        'completes, whether it returns or throws (JVMS §2.6). It holds three things: this ' +
        "method's local variable slots, its own operand stack, and where execution has reached.",
      'Both areas are per frame, which is why recursion works. `factorial(3)` and ' +
        '`factorial(2)` are the same code with the same slot numbers, but each invocation has ' +
        'an array of slots of its own; nothing is saved and restored, because the frames never ' +
        'shared storage.',
      'The sizes are fixed when the frame is created, from `max_locals` and `max_stack` in the ' +
        "method's Code attribute (JVMS §4.7.3), shown as `max 2/1` in the Bytecode panel " +
        'header. A frame cannot grow.',
    ],
    primer: { section: 3, title: 'The frame' },
    related: ['call-stack', 'local-variable-slot', 'program-counter'],
  },

  'local-variable-slot': {
    id: 'local-variable-slot',
    term: 'Local variable slot',
    question: 'What is a local variable slot?',
    paragraphs: [
      'Local variables have no names at run time. They are an array addressed by index, and ' +
        'the instruction carries the index: `iload_1` reads slot 1, `istore_3` writes slot 3 ' +
        '(JVMS §2.6.1).',
      'In a static method, slot 0 is the first parameter; in an instance method, slot 0 is ' +
        'always `this` and the parameters start at slot 1. A `long` or a `double` occupies two ' +
        "consecutive slots, which is why a method's slot count is not its variable count.",
      'The names in this panel are not in the bytecode either. They come from the optional ' +
        '`LocalVariableTable` that javac emits with `-g`, which maps a slot to a name over a ' +
        'range of byte offsets (JVMS §4.7.13), so two variables whose scopes do not overlap ' +
        'can share one slot. Load a class compiled without `-g` and the panel can only say ' +
        '`slot 1`.',
    ],
    primer: { section: 4, title: 'Local variable slots' },
    related: ['frame', 'descriptor', 'line-number-table'],
  },

  'program-counter': {
    id: 'program-counter',
    term: 'Program counter',
    question: 'What is the program counter?',
    paragraphs: [
      'The only register the specification defines: it holds the address of the instruction ' +
        'being executed (JVMS §2.5.1). The highlighted row of the Bytecode panel is where it ' +
        'points.',
      'That address is a byte offset into the method, not a line number and not a step count. ' +
        '`bipush 6` occupies offsets 0 and 1 (one opcode byte, one operand byte), so the ' +
        'instruction after it begins at offset 2, which is what the left column of the listing ' +
        'counts.',
      'JVMS §2.5.1 gives the pc to the thread. This interpreter keeps one on every frame, ' +
        'because the offset a caller resumes at has to survive the call (JVMS §2.6); that is ' +
        'what lets the Call stack panel say what each suspended caller is waiting on.',
    ],
    primer: { section: 3, title: 'The frame' },
    related: ['frame', 'branch-target', 'line-number-table'],
  },

  opcode: {
    id: 'opcode',
    term: 'Opcode and mnemonic',
    question: 'What is an opcode?',
    paragraphs: [
      'One byte names the operation, and the mnemonic is that byte written out. 150 of the 205 ' +
        'opcodes in the table take no operand bytes at all: `iadd` never has to say where its ' +
        'inputs are, because they can only be the top of the operand stack.',
      'The type is in the mnemonic rather than in the values. `iadd` adds ints, `ladd` adds ' +
        'longs, `dadd` adds doubles (JVMS §2.11.1); the stack carries no types at run time, ' +
        'and a verification pass proves before execution that they line up (JVMS §4.10). The ' +
        '`i` prefix is everywhere here because the executable subset is the int instructions.',
      'What a particular mnemonic does is on the row itself: every instruction in the listing ' +
        'carries its own description. JVMS §6.5 is the complete reference, one entry per ' +
        'opcode.',
    ],
    primer: { section: 1, title: 'A stack machine has no registers' },
    related: ['operand-stack', 'constant-pool', 'branch-target'],
  },

  'branch-target': {
    id: 'branch-target',
    term: 'Branch target',
    question: 'What is a branch target?',
    paragraphs: [
      'Where a jump goes, printed as an absolute byte offset, exactly as `javap -c` prints it: ' +
        '`if_icmpgt 7` continues at offset 7. The arcs in the gutter draw the same thing, from ' +
        'the branch to its target.',
      'The class file does not store that number. A branch holds a signed 16-bit delta ' +
        'relative to the offset of its own opcode (JVMS §6.5 `if_icmp<cond>`); this ' +
        'disassembler and javap both do the addition for you.',
      'A target that lies before the branch is a backward jump, which is the shape a loop ' +
        'compiles to.',
    ],
    primer: { section: 8, title: 'Cross-checking with `javap`' },
    related: ['opcode', 'program-counter'],
  },

  'constant-pool': {
    id: 'constant-pool',
    term: 'Constant pool',
    question: 'What is the constant pool?',
    paragraphs: [
      'Bytecode contains no strings, class names or signatures, only small integers indexing ' +
        'a per-class table (JVMS §4.4). `javap` and the Bytecode panel both print those ' +
        'indices as `#7`.',
      'The entries form a chain, because names bottom out in `Utf8` entries: a `Methodref` ' +
        'names a `Class` and a `NameAndType`, and those name the strings. Reading ' +
        '`invokestatic #7` as `Factorial.factorial:(I)I` is a walk down that chain: a ' +
        'symbolic reference being resolved, which is what lets a class be compiled against a ' +
        'version of another class that no longer exists at run time (JVMS §5.4.3).',
      'Two details catch people out in a raw dump: the pool is 1-indexed, so index 0 is never ' +
        'valid, and a `Long` or `Double` entry takes two slots with the second one unused ' +
        '(JVMS §4.4.5). A pool with a `long` in it has gaps in its numbering.',
    ],
    primer: { section: 5, title: 'The constant pool' },
    related: ['descriptor', 'opcode'],
  },

  descriptor: {
    id: 'descriptor',
    term: 'Descriptor',
    question: 'What is a descriptor?',
    paragraphs: [
      "The JVM's type notation: a compact string defined by a grammar (JVMS §4.3), used in " +
        'method references, field references and the `LocalVariableTable`. `I` is `int`, `J` ' +
        'is `long` because `L` was taken, `Z` is `boolean` because `B` was taken, `[` prefixes ' +
        'an array, and `L<name>;` is a class type written with slashes rather than dots.',
      'A method descriptor is the parameter types, in order and without separators, in ' +
        'parentheses, followed by the return type (JVMS §4.3.3). `(I)I` takes one int and ' +
        'returns one; `([Ljava/lang/String;)V` is `void main(String[])`; `(II)Z` is two ints ' +
        'in and a boolean out.',
      'The parentheses are what make it parseable one character at a time: parameters are read ' +
        'until the `)`, so nothing needs a separator and nothing is ambiguous.',
    ],
    primer: { section: 6, title: 'Descriptors' },
    related: ['constant-pool', 'local-variable-slot'],
  },

  'line-number-table': {
    id: 'line-number-table',
    term: 'LineNumberTable',
    question: 'How does an offset become a line of source?',
    paragraphs: [
      'The Source panel highlights a line while the Bytecode panel points at a byte offset. ' +
        'The link between them is an optional attribute, `LineNumberTable`, emitted by ' +
        '`javac -g` (or `-g:lines`), which lists `(start_pc, line_number)` pairs ' +
        '(JVMS §4.7.12).',
      'The mapping is many-to-one and the line numbers do not increase monotonically: a `for` ' +
        'loop compiles its initialiser and its increment into different parts of the method, ' +
        'both attributed to the line the `for` is written on. To find the line for a given pc, ' +
        'take the entry with the largest `start_pc` that is not greater than it.',
      'That rule is why the highlighted source line appears to jump backwards while a loop ' +
        'runs: it is the increment. Compile without `-g` and the attribute is absent, so the ' +
        'bytecode still runs and the Source panel has nothing to highlight.',
    ],
    primer: { section: 7, title: 'From a byte offset back to a line of source' },
    related: ['program-counter', 'local-variable-slot'],
  },
};

const READING_ORDER: readonly GlossaryTermId[] = [
  'operand-stack',
  'call-stack',
  'frame',
  'local-variable-slot',
  'program-counter',
  'opcode',
  'branch-target',
  'constant-pool',
  'descriptor',
  'line-number-table',
];

export const GLOSSARY: readonly GlossaryEntry[] = READING_ORDER.map((id) => ENTRIES[id]);

export function glossaryEntry(id: GlossaryTermId): GlossaryEntry {
  return ENTRIES[id];
}

const TERM_BY_PANEL: Readonly<Record<string, GlossaryTermId>> = {
  Source: 'line-number-table',
  'Class file': 'constant-pool',
  Bytecode: 'opcode',
  'Call stack': 'call-stack',
  'Operand stack': 'operand-stack',
  Locals: 'local-variable-slot',
  'Run state': 'frame',
};

export function glossaryTermForPanel(panelTitle: string): GlossaryTermId | undefined {
  return TERM_BY_PANEL[panelTitle];
}
