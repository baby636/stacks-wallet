import { ipcMain } from 'electron';
import { BehaviorSubject, Subject, timer } from 'rxjs';
import { filter, switchMap } from 'rxjs/operators';
import type Transport from '@ledgerhq/hw-transport';
import TransportNodeHid from '@ledgerhq/hw-transport-node-hid';
import { safeAwait } from '@blockstack/ui';
import StacksApp, { LedgerError, ResponseSign } from '@zondax/ledger-blockstack';

const POLL_LEDGER_INTERVAL = 2_000;
const SAFE_ASSUME_REAL_DEVICE_DISCONNECT_TIME = 1_000;

const ledgerState$ = new Subject<{ name: LedgerEvents }>();

const listeningForDevice$ = new BehaviorSubject(false);

// const actionTakingPlace$ = new BehaviorSubject(false);

let transport: Transport | null = null;
let listeningForAddEvent = false;
let disconnectTimeouts: NodeJS.Timeout | null = null;

type LedgerEvents =
  | 'create-listener'
  | 'remove-listener'
  | 'waiting-transport'
  | 'disconnected'
  | 'has-transport';

let subscription: null | ReturnType<typeof TransportNodeHid.listen> = null;
function createDeviceListener() {
  subscription = TransportNodeHid.listen({
    next: async event => {
      // console.log('next event', event);
      if (event.type === 'add') {
        ledgerState$.next({ name: 'waiting-transport' });
        if (disconnectTimeouts) clearTimeout(disconnectTimeouts);
        subscription && subscription.unsubscribe();
        const [error, ledgerTransport] = await safeAwait(TransportNodeHid.open(event.descriptor));
        ledgerState$.next({ name: 'has-transport' });
        if (ledgerTransport) {
          listeningForAddEvent = false;
          transport = ledgerTransport;
          ledgerTransport.on('disconnect', async () => {
            listeningForAddEvent = true;
            transport = null;
            await ledgerTransport.close();
            const timer = setTimeout(() => {
              ledgerState$.next({ name: 'disconnected' });
            }, SAFE_ASSUME_REAL_DEVICE_DISCONNECT_TIME);
            disconnectTimeouts = timer;
            createDeviceListener();
          });
        }

        if (error) {
          console.log('error in the connection', { error });
        }
      }
    },
    error: e => {
      console.log('err', e);
    },
    complete: () => {
      console.log('complete');
    },
  });
}

export function registerLedgerListeners(webContent: Electron.WebContents) {
  ledgerState$.subscribe(event => webContent.send('ledger-event', event));
}

listeningForDevice$.subscribe(listening => {
  listening ? createDeviceListener() : subscription && subscription.unsubscribe();
});

let pause = false;

const ledgerRequestStxAddress = async () => {
  if (!transport) throw new Error('No device transport');
  const blockstackApp = new StacksApp(transport);
  const resp = await blockstackApp.showAddressAndPubKey(`m/44'/5757'/0'/0/0`);
  return {
    ...resp,
    publicKey: resp.publicKey.toString('hex'),
  };
};
export type LedgerRequestStxAddress = ReturnType<typeof ledgerRequestStxAddress>;
ipcMain.handle('ledger-request-stx-address', ledgerRequestStxAddress);

const ledgerRequestSignTx = async (_: any, unsignedTransaction: string) => {
  if (!transport) throw new Error('No device transport');
  pause = true;
  const blockstackApp = new StacksApp(transport);
  const txBuffer = Buffer.from(unsignedTransaction, 'hex');
  const signatures: ResponseSign = await blockstackApp.sign(`m/44'/5757'/0'/0/0`, txBuffer);
  pause = false;
  return {
    ...signatures,
    postSignHash: signatures.postSignHash.toString('hex'),
    signatureVRS: signatures.signatureVRS.toString('hex'),
    signatureCompact: signatures.signatureCompact.toString('hex'),
    signatureDER: signatures.signatureDER.toString('hex'),
  };
};
export type LedgerRequestSignTx = ReturnType<typeof ledgerRequestSignTx>;
ipcMain.handle('ledger-request-sign-tx', ledgerRequestSignTx);

ipcMain.on('create-ledger-listener', () => listeningForDevice$.next(true));

ipcMain.on('remove-ledger-listener', () => listeningForDevice$.next(false));

const devicePoll$ = timer(0, POLL_LEDGER_INTERVAL).pipe(
  switchMap(() => listeningForDevice$),
  filter(listeningForLedger => listeningForLedger)
);

devicePoll$.subscribe(() => {
  if (transport && !listeningForAddEvent && !pause) {
    // console.log('Polling');
    // There's a bug with the node-hid library where it doesn't
    // fire disconnect event until next time an operation using it is called.
    // Here we poll a request to ensure the event is fired
    void new StacksApp(transport)
      .getVersion()
      .then(resp => {
        // console.log(resp);
        ledgerState$.next({
          name: LedgerError[resp.returnCode] as LedgerEvents,
          returnCode: resp.returnCode,
        } as any);
      })
      .catch(e => {
        console.log('error from get version', e);
      });
  }
});
