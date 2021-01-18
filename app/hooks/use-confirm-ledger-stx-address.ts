import { LedgerError } from '@zondax/ledger-blockstack';
import { useEffect, useState } from 'react';
import { Subject } from 'rxjs';
import { filter } from 'rxjs/operators';

export enum LedgerConnectStep {
  Disconnected,
  ConnectedAppClosed,
  ConnectedAppOpen,
  HasAddress,
}

const ledgerEvents$ = new Subject<any>();

export function useConfirmLedgerStxAddress() {
  const [step, setStep] = useState<LedgerConnectStep>(LedgerConnectStep.Disconnected);

  useEffect(() => {
    const handler = (e: MessageEvent) => {
      ledgerEvents$.next(e.data);
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  useEffect(() => {
    const sub = ledgerEvents$
      .pipe(filter(value => value.type === 'ledger-event'))
      .subscribe(val => {
        if (val.returnCode === LedgerError.AppDoesNotSeemToBeOpen) {
          setStep(LedgerConnectStep.ConnectedAppClosed);
        }
        if (val.returnCode === LedgerError.NoErrors) {
          setStep(LedgerConnectStep.ConnectedAppOpen);
        }
      });
    return () => sub.unsubscribe();
  }, []);

  return { step };
}
