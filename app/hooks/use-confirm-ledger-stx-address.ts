import { LedgerError } from '@zondax/ledger-blockstack';
import { useEffect, useState } from 'react';
import { Subject } from 'rxjs';
import { filter } from 'rxjs/operators';
import { useListenLedger } from './use-listen-ledger';

export enum LedgerConnectStep {
  Disconnected,
  ConnectedAppClosed,
  ConnectedAppOpen,
  ActionComplete,
}

const ledgerEvents$ = new Subject<any>();

export function usePrepareLedger() {
  const [step, setStep] = useState<LedgerConnectStep>(LedgerConnectStep.Disconnected);

  useListenLedger();

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
        // console.log('Ledger event', val);
        if (val.name === 'disconnected') {
          setStep(LedgerConnectStep.Disconnected);
        }
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
