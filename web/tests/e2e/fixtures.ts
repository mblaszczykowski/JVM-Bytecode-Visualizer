import { join } from 'node:path';

import { test } from '@playwright/test';

/** Absolute path of a file in `tests/e2e/fixtures/`, wherever the run was started from. */
export function fixturePath(fileName: string): string {
  return join(test.info().project.testDir, 'fixtures', fileName);
}
