import { useRef, useEffect, useCallback, useState } from 'react';

export enum LedgerConnectStep {
  Disconnected,
  ConnectedAppClosed,
  ConnectedAppOpen,
  HasAddress,
}

export function useLedger() {
  const [step, setStep] = useState(LedgerConnectStep.Disconnected);
  const [usbError, setUsbError] = useState<string | null>(null);

  return {
    step,
    error: usbError,
  };
}
