/// <reference types="node" />

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import * as process from 'node:process';

import { jsonResponse, type FakeRoute } from './fake-fetch';

export interface ContractResponse {
  readonly case: string;
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: unknown;
}

function resolveContractDir(): string {
  const candidates = [
    resolve(process.cwd(), '..', 'server', 'src', 'test', 'resources', 'contract'),
    resolve(process.cwd(), 'server', 'src', 'test', 'resources', 'contract'),
  ];
  const found = candidates.find((dir) => existsSync(dir));
  if (found === undefined) {
    throw new Error(
      `The compile service responses recorded by the server are missing (looked in: ${candidates.join(', ')}). ` +
        'They are committed under server/src/test/resources/contract and rewritten by mvnw verify.',
    );
  }
  return found;
}

const CONTRACT_DIR = resolveContractDir();

export function readContractResponses(): readonly ContractResponse[] {
  return readdirSync(CONTRACT_DIR)
    .filter((fileName) => fileName.endsWith('.json'))
    .sort()
    .map(
      (fileName) =>
        JSON.parse(readFileSync(join(CONTRACT_DIR, fileName), 'utf8')) as ContractResponse,
    );
}

export function recordedResponse(name: string): ContractResponse {
  const found = readContractResponses().find((response) => response.case === name);
  if (found === undefined) {
    throw new Error(`the service records no ${name} answer in ${CONTRACT_DIR}`);
  }
  return found;
}

export function contractRoute(response: ContractResponse): FakeRoute {
  return () => jsonResponse(response.status, response.body, response.headers);
}
