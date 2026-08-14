import { execFileSync } from 'node:child_process';

// The class files both fixture builders write are committed and byte-diffed by CI, and both read
// javap output back with regexes. One JDK produces them; anything else is drift. The patch
// number is part of the pin because a single StackMapTable byte or a reordered javap line inside
// a feature release is enough to turn the fixtures job red on a change that touched nothing
// related. .github/workflows/web.yml installs this exact version.
export const REQUIRED_JDK_VERSION = '25.0.4';
export const JAVA_RELEASE = '21';
export const EXPECTED_MAJOR_VERSION = 65;

export class FixtureBuildError extends Error {
  constructor(message) {
    super(message);
    this.name = 'FixtureBuildError';
  }
}

function failureDetails(cause) {
  const failure = /** @type {{ stderr?: unknown; stdout?: unknown; message?: unknown }} */ (
    cause ?? {}
  );
  const stderr = typeof failure.stderr === 'string' ? failure.stderr.trim() : '';
  const stdout = typeof failure.stdout === 'string' ? failure.stdout.trim() : '';
  const details = [stderr, stdout].filter(Boolean).join('\n');
  return details === '' ? String(failure.message ?? cause) : details;
}

export function runTool(command, args) {
  try {
    return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (cause) {
    throw new FixtureBuildError(
      `Command "${command} ${args.join(' ')}" failed.\n${failureDetails(cause)}`,
    );
  }
}

export function requirePinnedJdk() {
  const reported = ['javac', 'javap'].map((tool) => ({
    tool,
    version: runTool(tool, ['-version'])
      .trim()
      .replace(new RegExp(`^${tool}\\s+`), ''),
  }));

  for (const { tool, version } of reported) {
    if (version === REQUIRED_JDK_VERSION) {
      continue;
    }
    throw new FixtureBuildError(
      `${tool} ${version} cannot reproduce the committed fixtures. They were compiled by a JDK ` +
        `${REQUIRED_JDK_VERSION} javac and disassembled by its javap: the class files are ` +
        'byte-diffed in CI, and both the bytecode and the javap layout the builders parse can ' +
        `move between releases.\nInstall Temurin ${REQUIRED_JDK_VERSION} and put it on PATH. ` +
        `The class files still target Java ${JAVA_RELEASE} (major version ` +
        `${EXPECTED_MAJOR_VERSION}) through --release, so the bytecode is unchanged. Moving to ` +
        'another JDK means regenerating every fixture with it and committing the result, plus ' +
        'raising REQUIRED_JDK_VERSION in fixtures/jdk.mjs and the java-version of the fixtures ' +
        'job in .github/workflows/web.yml.',
    );
  }

  return `JDK ${reported[0]?.version ?? ''}`;
}

function readMajorVersion(classesDir, className) {
  const verbose = runTool('javap', ['-v', '-p', '-classpath', classesDir, className]);
  const version = /^\s*major version:\s*(\d+)\s*$/m.exec(verbose)?.[1];
  if (version === undefined) {
    throw new FixtureBuildError(`Could not read the major version of class ${className}.`);
  }
  return Number(version);
}

export function requireExpectedMajorVersion(classesDir, className) {
  const majorVersion = readMajorVersion(classesDir, className);
  if (majorVersion !== EXPECTED_MAJOR_VERSION) {
    throw new FixtureBuildError(
      `${className}.class has major version ${majorVersion}, expected ` +
        `${EXPECTED_MAJOR_VERSION} (Java ${JAVA_RELEASE}). Check the javac --release flag.`,
    );
  }
  return majorVersion;
}
