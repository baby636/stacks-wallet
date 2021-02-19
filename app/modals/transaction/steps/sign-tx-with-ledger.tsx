import React, { FC } from 'react';
import { LedgerConnectInstructions } from '@components/ledger/ledger-connect-instructions';
import { Box } from '@blockstack/ui';
import { ErrorLabel } from '@components/error-label';
import { ErrorText } from '@components/error-text';
import { LedgerConnectStep } from '@hooks/use-confirm-ledger-stx-address';

interface SignTxWithLedgerProps {
  step: LedgerConnectStep;
  ledgerError: null | string;
}

export const SignTxWithLedger: FC<SignTxWithLedgerProps> = props => {
  const { step, ledgerError } = props;

  return (
    <Box mx="extra-loose" mb="extra-loose">
      <LedgerConnectInstructions action="Sign transaction on Ledger" step={step} />
      {ledgerError && (
        <ErrorLabel mt="base-loose">
          <ErrorText>{ledgerError}</ErrorText>
        </ErrorLabel>
      )}
    </Box>
  );
};
