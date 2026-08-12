import { runAndStream, type RunCommand, type RunEvent } from './run-protocol';

interface RunScope {
  postMessage(event: RunEvent): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<RunCommand>) => void): void;
}

const scope = self as unknown as RunScope;

scope.addEventListener('message', ({ data }) => {
  runAndStream(data, (event) => {
    scope.postMessage(event);
  });
});
