import type Transport from '@ledgerhq/hw-transport';
import TransportNodeHid from '@ledgerhq/hw-transport-node-hid';
import { safeAwait } from '@blockstack/ui';
import BlockstackApp, { LedgerError } from '@zondax/ledger-blockstack';
import { Subject } from 'rxjs';
import { IpcMain, ipcMain } from 'electron';

const POLL_LEDGER_INTERVAL = 2_000;
const SAFE_ASSUME_REAL_DEVICE_DISCONNECT_TIME = 1_000;

const ledgerState$ = new Subject<{ name: LedgerEvents }>();

let transport: Transport | null = null;
let listeningForAddEvent = false;
let disconnectTimeouts: NodeJS.Timeout | null = null;

type LedgerEvents = 'waiting-transport' | 'disconnected' | 'has-transport';

function createListener() {
  const subscription = TransportNodeHid.listen({
    next: async event => {
      console.log('next event', event);
      if (event.type === 'add') {
        ledgerState$.next({ name: 'waiting-transport' });
        if (disconnectTimeouts) clearTimeout(disconnectTimeouts);
        subscription.unsubscribe();
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
            createListener();
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
  createListener();
  ledgerState$.subscribe(event => webContent.send('ledger-event', event));
}

ipcMain.handle('ledger-request-stx-address', () => {
  if (!transport) throw new Error('No device transport');
  const blockstackApp = new BlockstackApp(transport);
  return blockstackApp.showAddressAndPubKey(`m/44'/5757'/0'/0/0`);
});

setInterval(() => {
  // console.log('Interval', JSON.stringify({ transport: !!transport, listeningForAddEvent }));
  if (transport && !listeningForAddEvent) {
    // console.log('Polling');
    // There's a bug with the node-hid library where it doesn't
    // fire disconnect event until next time an operation using it is called.
    // Here we poll a request to ensure the event is fired
    void new BlockstackApp(transport)
      .getVersion()
      .then(resp => {
        console.log(resp);
        ledgerState$.next({
          name: LedgerError[resp.returnCode] as LedgerEvents,
          returnCode: resp.returnCode,
        } as any);
      })
      .catch(e => {
        console.log('error from get version', e);
      });
  }
}, POLL_LEDGER_INTERVAL);
