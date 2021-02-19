import { useEffect } from 'react';

export function useListenLedger() {
  useEffect(() => {
    console.log('creating listener');
    api.ledger.createListener();
    return () => {
      console.log('removing listener');
      api.ledger.removeListener();
    };
  }, []);
}
