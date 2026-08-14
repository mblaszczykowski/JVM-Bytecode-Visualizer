import { createContext, useContext, useEffect } from 'react';

export type StatusLiveness = 'polite' | 'off';

export interface AppStatus {
  readonly message: string;
  readonly live: StatusLiveness;
}

export type StatusPublisher = (status: AppStatus | undefined) => void;

const noStatusRegion: StatusPublisher = () => undefined;

export const AppStatusContext = createContext<StatusPublisher>(noStatusRegion);

export function usePublishedStatus(message: string, live: StatusLiveness = 'polite'): void {
  const publish = useContext(AppStatusContext);

  useEffect(() => {
    publish({ message, live });
    return () => {
      publish(undefined);
    };
  }, [publish, message, live]);
}
