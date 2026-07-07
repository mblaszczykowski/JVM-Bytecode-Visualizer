#!/usr/bin/env node
/**
 * Buduje fixtures fazy 4 (plan.md §7, §9 Faza 4).
 *
 * Przebieg:
 *  1. `javac -g --release 21` do katalogu tymczasowego (`-g` daje LocalVariableTable,
 *     czyli nazwy zmiennych w UI; `--release 21` przypina major version 65 niezależnie
 *     od tego, jak nowy JDK ma deweloper — plan.md §13).
 *  2. Walidacja zakresu MVP: `javap -c -p` na każdej klasie, każdy mnemonik musi należeć
 *     do listy z plan.md §6. Instrukcja spoza listy wywala build — dzięki temu przykłady
 *     nie mogą po cichu wyjść poza to, co potrafi interpreter.
 *  3. Wyniki referencyjne z prawdziwej JVM: harness `ExpectedResults` woła metody
 *     obliczeniowe przykładów i wypisuje wyniki; trafiają do manifestu jako
 *     `expectedResult` i napędzają test różnicowy interpretera.
 *  4. Kopiowanie `.class` + `.java` do `public/examples/` i generacja `manifest.json`.
 *
 * Skrypt jest deterministyczny i idempotentny: katalog wyjściowy jest odtwarzany od zera,
 * kolejność wpisów manifestu wynika z tablicy EXAMPLES, a `.class` z javac nie zawiera
 * znaczników czasu — drugi przebieg daje bajt w bajt te same artefakty.
 *
 * Uruchomienie: `npm run fixtures -w web` (wymaga lokalnego JDK >= 21).
 */

import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const FIXTURES_DIR = dirname(fileURLToPath(import.meta.url));
const SOURCE_DIR = join(FIXTURES_DIR, 'src');
const HARNESS_DIR = join(FIXTURES_DIR, 'harness');
const OUTPUT_DIR = join(FIXTURES_DIR, '..', 'public', 'examples');

/** Harness liczy wyniki referencyjne; celowo NIE trafia do public/examples. */
const HARNESS_CLASS = 'ExpectedResults';

/** Java 21 (LTS) — plan.md §13. `--release` gwarantuje ten major version na każdym JDK >= 21. */
const JAVA_RELEASE = '21';
const EXPECTED_MAJOR_VERSION = 65;

/** Wersja formatu manifestu; konsumenci walidują ją schematem w src/services/manifest.ts. */
const MANIFEST_VERSION = 1;

/**
 * Zakres instrukcji MVP — dokładna kopia tabeli z plan.md §6.
 * Rozbicie na rodziny jest po to, żeby komunikat błędu mógł powiedzieć nie tylko
 * "ten mnemonik jest zabroniony", ale też jakie rodziny są w ogóle dostępne.
 */
const MVP_INSTRUCTION_SET = Object.freeze({
  stałe: [
    'nop',
    'iconst_m1',
    'iconst_0',
    'iconst_1',
    'iconst_2',
    'iconst_3',
    'iconst_4',
    'iconst_5',
    'bipush',
    'sipush',
  ],
  'load/store': [
    'iload',
    'iload_0',
    'iload_1',
    'iload_2',
    'iload_3',
    'istore',
    'istore_0',
    'istore_1',
    'istore_2',
    'istore_3',
  ],
  inkrementacja: ['iinc'],
  stos: ['dup', 'pop'],
  arytmetyka: ['iadd', 'isub', 'imul', 'idiv', 'irem', 'ineg'],
  'porównania ze skokiem': [
    'if_icmpeq',
    'if_icmpne',
    'if_icmplt',
    'if_icmpge',
    'if_icmpgt',
    'if_icmple',
    'ifeq',
    'ifne',
    'iflt',
    'ifge',
    'ifgt',
    'ifle',
  ],
  skok: ['goto'],
  wywołania: ['invokestatic', 'ireturn', 'return'],
});

const ALLOWED_MNEMONICS = new Set(Object.values(MVP_INSTRUCTION_SET).flat());

/**
 * Sam mnemonik nie wystarczy: `invokestatic` jest w zakresie, ale plan.md §6 dopuszcza
 * wyłącznie wywołania metod TEJ SAMEJ klasy, a §8 pkt 6 — wyłącznie deskryptory z parametrami
 * `I` i zwrotką `I`/`V`. javap wypisuje w komentarzu docelową metodę bez nazwy klasy, gdy
 * należy ona do klasy dekompilowanej ("Method gcd:(II)I"), i z nazwą klasy w przeciwnym
 * wypadku ("Method java/lang/Math.max:(II)I") — po tym je odróżniamy.
 */
const METHOD_REFERENCE = /^Method\s+(\S+):(\(\S*\)\S+)$/;
const SUPPORTED_DESCRIPTOR = /^\(I*\)[IV]$/;

/** javap wypisuje sygnatury w składni Javy, nie w postaci deskryptorów. */
const MAIN_SIGNATURE = 'public static void main(java.lang.String[])';
const SUPPORTED_SIGNATURE = /^(?:\w+\s+)*?(?:int|void)\s+\w+\(\s*(?:int(?:\s*,\s*int)*)?\s*\)$/;

/**
 * Przykłady w kolejności prezentacji w UI. `id` musi zgadzać się z kluczem wypisywanym
 * przez harness — skrypt to sprawdza, więc rozjazd nazw wywali build, a nie test.
 */
const EXAMPLES = Object.freeze([
  {
    id: 'factorial',
    className: 'Factorial',
    title: 'Silnia — rekurencja',
    description:
      'Rekurencyjne 4! = 24. Stos wywołań rośnie do pięciu ramek (main + cztery wywołania), ' +
      'a przy powrotach zwija się mnożąc wyniki — najprostszy sposób, żeby zobaczyć, ' +
      'jak JVM wznawia metodę dokładnie w miejscu wywołania.',
  },
  {
    id: 'fibonacci',
    className: 'Fibonacci',
    title: 'Fibonacci — rekurencja rozgałęziona',
    description:
      'Naiwne fib(7) = 13. Każde wywołanie rozgałęzia się na dwa kolejne, więc stos rośnie ' +
      'i zwija się kilkadziesiąt razy. Dobrze widać tu koszt naiwnej rekurencji: te same ' +
      'podproblemy liczone są wielokrotnie od zera.',
  },
  {
    id: 'sum-of-squares',
    className: 'SumOfSquares',
    title: 'Suma iloczynów — zagnieżdżone pętle for',
    description:
      'Suma i*j po siatce 6x6 (na przekątnej są kwadraty, stąd nazwa). Płaski stos wywołań, ' +
      'za to setki kroków: pokazuje instrukcję iinc (inkrementacja licznika w miejscu, ' +
      'bez ruszania stosu operandów), warunek if_icmpgt i skok wsteczny goto.',
  },
  {
    id: 'gcd',
    className: 'Gcd',
    title: 'NWD — pętla while i reszta z dzielenia',
    description:
      'Algorytm Euklidesa dla (1071, 462) = 21. Pętla sterowana warunkiem, nie licznikiem: ' +
      'zamiast iinc mamy ifne na reszcie z dzielenia (irem) i przepisywanie wartości ' +
      'między slotami zmiennych lokalnych.',
  },
]);

/** Błąd builda z komunikatem gotowym do pokazania człowiekowi (bez stack trace'u). */
class FixtureBuildError extends Error {
  constructor(message) {
    super(message);
    this.name = 'FixtureBuildError';
  }
}

/**
 * Uruchamia narzędzie JDK i zwraca jego stdout. Błąd narzędzia zamieniamy na
 * FixtureBuildError z jego wyjściem — goły `execFileSync` gubi stderr w komunikacie.
 */
function runTool(command, args) {
  try {
    return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (cause) {
    const stderr = typeof cause?.stderr === 'string' ? cause.stderr.trim() : '';
    const stdout = typeof cause?.stdout === 'string' ? cause.stdout.trim() : '';
    const details = [stderr, stdout].filter(Boolean).join('\n');
    throw new FixtureBuildError(
      `Polecenie "${command} ${args.join(' ')}" zakończyło się błędem.` +
        (details ? `\n${details}` : `\n${String(cause?.message ?? cause)}`),
    );
  }
}

function compileAll(classesDir) {
  const sources = [
    ...EXAMPLES.map((example) => join(SOURCE_DIR, `${example.className}.java`)),
    join(HARNESS_DIR, `${HARNESS_CLASS}.java`),
  ];
  runTool('javac', ['-g', '-Xlint:all', '--release', JAVA_RELEASE, '-d', classesDir, ...sources]);
}

/**
 * Rozbija wyjście `javap -c -p` na metody i ich instrukcje.
 *
 * Format javap jest stabilny i prosty: nagłówek metody to wcięta linia zakończona
 * średnikiem, a instrukcja to `<offset>: <mnemonik> [operandy]`. Konstruktory javap
 * wypisuje bez typu zwracanego (`private Factorial();`), a inicjalizator statyczny
 * jako `static {};` — obie formy rozpoznajemy, bo interpreter ich nigdy nie wykonuje
 * (plan.md §5.4), więc nie podlegają walidacji zakresu.
 */
function parseDisassembly(javapOutput, className) {
  const constructorPattern = new RegExp(`(?:^|\\s)${className}\\s*\\(`);
  const methods = [];
  let current = null;

  for (const line of javapOutput.split('\n')) {
    const instruction = /^\s+(\d+):\s+([a-z][a-z0-9_]*)\s*(.*)$/.exec(line);
    if (instruction) {
      if (current === null) {
        // Instrukcja przed nagłówkiem metody = javap zmienił format. Lepiej wywalić build,
        // niż po cichu przepuścić niezwalidowany bajtkod.
        throw new FixtureBuildError(
          `Nieoczekiwany format wyjścia javap dla klasy ${className}: instrukcja "${line.trim()}" ` +
            'pojawiła się przed nagłówkiem jakiejkolwiek metody.',
        );
      }
      const operands = instruction[3];
      const commentAt = operands.indexOf('//');
      current.instructions.push({
        offset: Number(instruction[1]),
        mnemonic: instruction[2],
        comment: commentAt === -1 ? '' : operands.slice(commentAt + 2).trim(),
      });
      continue;
    }

    const signature = /^\s{2}(\S.*);\s*$/.exec(line);
    if (signature) {
      const text = signature[1].trim();
      const kind = text.startsWith('static {}')
        ? 'class-init'
        : constructorPattern.test(text)
          ? 'instance-init'
          : 'method';
      current = { signature: text, kind, instructions: [] };
      methods.push(current);
    }
  }

  return methods;
}

function readMajorVersion(classesDir, className) {
  const verbose = runTool('javap', ['-v', '-p', '-classpath', classesDir, className]);
  const match = /^\s*major version:\s*(\d+)\s*$/m.exec(verbose);
  if (!match) {
    throw new FixtureBuildError(`Nie udało się odczytać major version klasy ${className}.`);
  }
  return Number(match[1]);
}

/**
 * Sprawdza, czy pojedyncze `invokestatic` mieści się w zakresie MVP: cel musi być metodą
 * tej samej klasy (plan.md §6) o deskryptorze z parametrami `I` i zwrotką `I`/`V` (§8 pkt 6).
 *
 * @returns {string | null} opis naruszenia albo null, gdy wywołanie jest w zakresie
 */
function checkInvokeStatic(comment) {
  const reference = METHOD_REFERENCE.exec(comment);
  if (!reference) {
    return `nie udało się odczytać celu wywołania z komentarza javap ("${comment}")`;
  }

  const [, target, descriptor] = reference;
  if (target.includes('.') || target.includes('/')) {
    return (
      `invokestatic do innej klasy (${target}) — MVP obsługuje wyłącznie wywołania ` +
      'metod tej samej klasy (plan.md §6)'
    );
  }
  if (!SUPPORTED_DESCRIPTOR.test(descriptor)) {
    return (
      `invokestatic ${target} o deskryptorze ${descriptor} — MVP obsługuje wyłącznie ` +
      'parametry I i zwrotkę I/V (plan.md §8 pkt 6)'
    );
  }
  return null;
}

/**
 * Sprawdza, że wykonywalne metody klasy mieszczą się w zakresie MVP: statyczne, o sygnaturze
 * na `int`ach, złożone wyłącznie z instrukcji z §6. Metody `<init>`/`<clinit>` pomijamy —
 * interpreter nigdy ich nie wykonuje (plan.md §5.4) — ale sama obecność `<clinit>` jest
 * błędem, bo oznacza pole statyczne.
 *
 * Wszystkie naruszenia zbieramy i raportujemy naraz: poprawianie przykładu po jednym
 * komunikacie na przebieg byłoby uciążliwe.
 */
function validateScope(className, methods) {
  if (methods.some((method) => method.kind === 'class-init')) {
    throw new FixtureBuildError(
      `Klasa ${className} ma inicjalizator statyczny <clinit>. ` +
        'Przykłady nie mogą używać pól statycznych (plan.md §5.4) — interpreter nigdy nie ' +
        'wykonuje <clinit>, więc program zobaczyłby niezainicjalizowany stan.',
    );
  }

  const mainMethods = methods.filter((method) => method.signature === MAIN_SIGNATURE);
  if (mainMethods.length !== 1) {
    throw new FixtureBuildError(
      `Klasa ${className} musi mieć dokładnie jedną metodę "${MAIN_SIGNATURE}" ` +
        `(znaleziono ${mainMethods.length}) — to punkt wejścia interpretera (plan.md §5.4).`,
    );
  }

  const violations = [];
  let instructionCount = 0;

  for (const method of methods) {
    if (method.kind !== 'method') {
      continue;
    }

    const where = `${className}::${method.signature}`;
    if (!/(?:^|\s)static\s/.test(method.signature)) {
      violations.push(`${where} — metoda niestatyczna; MVP zna tylko invokestatic (plan.md §6)`);
    }
    if (method.signature !== MAIN_SIGNATURE && !SUPPORTED_SIGNATURE.test(method.signature)) {
      violations.push(
        `${where} — sygnatura poza MVP; dozwolone są parametry int i zwrotka int/void ` +
          `(plan.md §8 pkt 6) albo dokładnie "${MAIN_SIGNATURE}"`,
      );
    }

    for (const { offset, mnemonic, comment } of method.instructions) {
      instructionCount += 1;
      if (!ALLOWED_MNEMONICS.has(mnemonic)) {
        violations.push(`${where}  offset ${offset}: ${mnemonic} — instrukcja spoza tabeli §6`);
        continue;
      }
      if (mnemonic === 'invokestatic') {
        const problem = checkInvokeStatic(comment);
        if (problem !== null) {
          violations.push(`${where}  offset ${offset}: ${problem}`);
        }
      }
    }
  }

  if (violations.length > 0) {
    const details = violations.map((violation) => `  • ${violation}`).join('\n');
    const families = Object.entries(MVP_INSTRUCTION_SET)
      .map(([family, mnemonics]) => `  ${family}: ${mnemonics.join(', ')}`)
      .join('\n');
    throw new FixtureBuildError(
      `Przykład wychodzi poza zakres MVP (plan.md §6):\n${details}\n\n` +
        `Dozwolone instrukcje:\n${families}\n\n` +
        'Popraw źródło przykładu (np. zakresy pętli albo użyte konstrukcje Javy) — ' +
        'zakresu interpretera nie rozszerzamy bez aktualizacji plan.md §6.',
    );
  }

  return instructionCount;
}

/** Uruchamia harness na prawdziwej JVM i zwraca mapę id → wynik. */
function readExpectedResults(classesDir) {
  const stdout = runTool('java', ['-classpath', classesDir, HARNESS_CLASS]);
  const results = new Map();

  for (const line of stdout.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '') {
      continue;
    }
    const match = /^([a-z0-9-]+)=(-?\d+)$/.exec(trimmed);
    if (!match) {
      throw new FixtureBuildError(
        `Harness ${HARNESS_CLASS} wypisał linię w nieoczekiwanym formacie: "${trimmed}". ` +
          'Oczekiwany format to "<id>=<liczba całkowita>".',
      );
    }
    results.set(match[1], Number(match[2]));
  }

  const declared = EXAMPLES.map((example) => example.id).sort();
  const reported = [...results.keys()].sort();
  if (declared.join(',') !== reported.join(',')) {
    throw new FixtureBuildError(
      `Harness ${HARNESS_CLASS} raportuje inne przykłady niż deklaruje build-fixtures.mjs.\n` +
        `  zadeklarowane: ${declared.join(', ')}\n` +
        `  z harnessu:    ${reported.join(', ')}`,
    );
  }

  return results;
}

function writeArtifacts(classesDir, expectedResults) {
  // Katalog odtwarzany od zera: bez tego usunięty przykład zostawiłby osierocony .class.
  rmSync(OUTPUT_DIR, { recursive: true, force: true });
  mkdirSync(OUTPUT_DIR, { recursive: true });

  const entries = EXAMPLES.map((example) => {
    const classFile = `${example.className}.class`;
    const sourceFile = `${example.className}.java`;
    copyFileSync(join(classesDir, classFile), join(OUTPUT_DIR, classFile));
    copyFileSync(join(SOURCE_DIR, sourceFile), join(OUTPUT_DIR, sourceFile));

    return {
      id: example.id,
      title: example.title,
      description: example.description,
      classFile,
      sourceFile,
      entryMethod: 'main',
      resultVariable: 'result',
      expectedResult: expectedResults.get(example.id),
    };
  });

  const manifest = { version: MANIFEST_VERSION, examples: entries };
  writeFileSync(
    join(OUTPUT_DIR, 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8',
  );
  return manifest;
}

function main() {
  const classesDir = mkdtempSync(join(tmpdir(), 'jvm-bytecode-fixtures-'));
  try {
    console.log(`javac -g --release ${JAVA_RELEASE} → ${classesDir}`);
    compileAll(classesDir);

    let totalInstructions = 0;
    for (const example of EXAMPLES) {
      const { className } = example;

      const majorVersion = readMajorVersion(classesDir, className);
      if (majorVersion !== EXPECTED_MAJOR_VERSION) {
        throw new FixtureBuildError(
          `${className}.class ma major version ${majorVersion}, oczekiwano ` +
            `${EXPECTED_MAJOR_VERSION} (Java ${JAVA_RELEASE}). Sprawdź flagę --release javac.`,
        );
      }

      const methods = parseDisassembly(
        runTool('javap', ['-c', '-p', '-classpath', classesDir, className]),
        className,
      );
      const instructionCount = validateScope(className, methods);
      totalInstructions += instructionCount;

      const perMethod = methods
        .filter((method) => method.kind === 'method')
        .map((method) => `${method.signature} = ${method.instructions.length}`)
        .join(', ');
      console.log(
        `  ✓ ${className}  major=${majorVersion}, instrukcje w zakresie §6: ` +
          `${instructionCount} (${perMethod})`,
      );
    }

    const expectedResults = readExpectedResults(classesDir);
    const manifest = writeArtifacts(classesDir, expectedResults);

    console.log(`\nWyniki referencyjne z prawdziwej JVM (harness ${HARNESS_CLASS}):`);
    for (const entry of manifest.examples) {
      console.log(`  ${entry.id} → ${entry.expectedResult}`);
    }
    console.log(
      `\nGotowe: ${manifest.examples.length} przykładów, ${totalInstructions} instrukcji ` +
        `zwalidowanych względem plan.md §6.\nArtefakty: ${OUTPUT_DIR}`,
    );
  } finally {
    rmSync(classesDir, { recursive: true, force: true });
  }
}

try {
  main();
} catch (error) {
  if (error instanceof FixtureBuildError) {
    console.error(`\nbuild-fixtures: ${error.message}\n`);
    process.exitCode = 1;
  } else {
    throw error;
  }
}
