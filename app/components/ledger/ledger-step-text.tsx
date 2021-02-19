import React, { FC } from 'react';
import { Text } from '@blockstack/ui';
import { LedgerConnectStep } from '@hooks/use-confirm-ledger-stx-address';

interface LedgerStepTextProps {
  step: LedgerConnectStep;
}
export const LedgerStepText: FC<LedgerStepTextProps> = ({ step, children }) => {
  return (
    <>
      <Text
        color="ink"
        fontWeight={500}
        mr="base-tight"
        display="inline-block"
        width="10px"
        textAlign="center"
      >
        {step + 1}
      </Text>
      {children}
    </>
  );
};
