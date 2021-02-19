import React, { FC, useState, useCallback } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { Modal } from '@blockstack/ui';
import { useHistory } from 'react-router-dom';
import { LedgerError } from '@zondax/ledger-blockstack';
import { useHotkeys } from 'react-hotkeys-hook';
import { BigNumber } from 'bignumber.js';
import { StackingClient } from '@stacks/stacking';
import BN from 'bn.js';

import { RootState } from '@store/index';
import routes from '@constants/routes.json';
import {
  selectPublicKey,
  selectEncryptedMnemonic,
  selectSalt,
  decryptSoftwareWallet,
  selectWalletType,
} from '@store/keys';
import { activeStackingTx, selectCoreNodeInfo, selectPoxInfo } from '@store/stacking';
import {
  makeUnsignedContractCall,
  StacksTransaction,
  makeContractCall,
  TransactionSigner,
  createStacksPrivateKey,
} from '@stacks/transactions';
import { broadcastTransaction, BroadcastTransactionArgs } from '@store/transaction';
import { selectActiveNodeApi } from '@store/stacks-node';
import { selectAddressBalance } from '@store/address';
import { safeAwait } from '@utils/safe-await';

import {
  StackingModalHeader,
  StackingModalFooter,
  StackingModalButton,
  modalStyle,
} from './stacking-modal-layout';
import { DecryptWalletForm } from './steps/decrypt-wallet-form';
import { SignTxWithLedger } from './steps/sign-tx-with-ledger';
import { StackingFailed } from './steps/stacking-failed';
import { delay } from '@utils/delay';
import { stacksNetwork } from '../../environment';
import { LedgerConnectStep, usePrepareLedger } from '@hooks/use-confirm-ledger-stx-address';

enum StackingModalStep {
  DecryptWalletAndSend,
  SignWithLedgerAndSend,
  FailedContractCall,
}

type StackingModalComponents = () => Record<'header' | 'body' | 'footer', JSX.Element>;

interface StackingModalProps {
  poxAddress: string;
  numCycles: number;
  amountToStack: BigNumber;
  onClose(): void;
}

const CONTRACT_CALL_FEE = 260;

export const StackingModal: FC<StackingModalProps> = props => {
  const { onClose, numCycles, poxAddress, amountToStack } = props;

  const dispatch = useDispatch();
  const history = useHistory();
  useHotkeys('esc', () => onClose());

  const [password, setPassword] = useState('');
  const [hasSubmitted, setHasSubmitted] = useState(false);

  const [decryptionError, setDecryptionError] = useState<string | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);

  const {
    encryptedMnemonic,
    salt,
    walletType,
    publicKey,
    poxInfo,
    node,
    coreNodeInfo,
    balance,
  } = useSelector((state: RootState) => ({
    salt: selectSalt(state),
    encryptedMnemonic: selectEncryptedMnemonic(state),
    walletType: selectWalletType(state),
    publicKey: selectPublicKey(state),
    poxInfo: selectPoxInfo(state),
    coreNodeInfo: selectCoreNodeInfo(state),
    node: selectActiveNodeApi(state),
    balance: selectAddressBalance(state),
  }));

  const accountBalance = new BigNumber(balance?.balance ?? 0);

  const shouldModifyTxFee = accountBalance.minus(amountToStack).isLessThan(CONTRACT_CALL_FEE);

  const initialStep =
    walletType === 'software'
      ? StackingModalStep.DecryptWalletAndSend
      : StackingModalStep.SignWithLedgerAndSend;

  const [step, setStep] = useState(initialStep);

  const initStackingClient = useCallback(() => {
    const network = stacksNetwork;
    network.coreApiUrl = node.url;
    return new StackingClient(poxAddress, network as any);
  }, [node.url, poxAddress]);

  const createSoftwareWalletTx = useCallback(async (): Promise<StacksTransaction> => {
    if (!password || !encryptedMnemonic || !salt || !poxInfo || !balance) {
      throw new Error('One of `password`, `encryptedMnemonic` or `salt` is missing');
    }
    if (coreNodeInfo === null) throw new Error('Stacking requires coreNodeInfo');

    const stackingClient = initStackingClient();
    const { privateKey } = await decryptSoftwareWallet({
      ciphertextMnemonic: encryptedMnemonic,
      salt,
      password,
    });
    const txOptions = stackingClient.getStackOptions({
      amountMicroStx: new BN(amountToStack.toString()),
      poxAddress,
      cycles: numCycles,
      contract: poxInfo.contract_id,
      burnBlockHeight: coreNodeInfo.burn_block_height,
    });
    const tx = await makeContractCall({ ...txOptions, senderKey: privateKey });
    const modifiedFeeTx = shouldModifyTxFee
      ? stackingClient.modifyLockTxFee({
          tx,
          amountMicroStx: new BN(amountToStack.toString()),
        })
      : tx;

    const signer = new TransactionSigner(modifiedFeeTx);
    signer.signOrigin(createStacksPrivateKey(privateKey));
    return tx;
  }, [
    password,
    encryptedMnemonic,
    salt,
    poxInfo,
    balance,
    coreNodeInfo,
    initStackingClient,
    amountToStack,
    poxAddress,
    numCycles,
    shouldModifyTxFee,
  ]);

  const createLedgerWalletTx = useCallback(
    async (options: { publicKey: Buffer }): Promise<StacksTransaction> => {
      if (coreNodeInfo === null) throw new Error('Stacking requires coreNodeInfo');
      if (!poxInfo || !balance) throw new Error('`poxInfo` is not defined');
      // 1. Form unsigned contract call transaction

      const stackingClient = initStackingClient();
      const txOptions = stackingClient.getStackOptions({
        amountMicroStx: new BN(amountToStack.toString()),
        poxAddress,
        cycles: numCycles,
        contract: poxInfo.contract_id,
        burnBlockHeight: coreNodeInfo.burn_block_height,
      });

      const unsignedTx = await makeUnsignedContractCall({
        ...txOptions,
        publicKey: options.publicKey.toString('hex'),
      });

      const modifiedFeeTx = shouldModifyTxFee
        ? stackingClient.modifyLockTxFee({
            tx: unsignedTx,
            amountMicroStx: new BN(amountToStack.toString()),
          })
        : unsignedTx;
      const resp = await api.ledger.signTransaction(modifiedFeeTx.serialize().toString('hex'));
      if (resp.returnCode !== LedgerError.NoErrors) {
        throw new Error('Ledger responded with errors');
      }
      return unsignedTx.createTxWithSignature(resp.signatureVRS);
    },
    [
      coreNodeInfo,
      poxInfo,
      balance,
      initStackingClient,
      amountToStack,
      poxAddress,
      numCycles,
      shouldModifyTxFee,
    ]
  );

  const broadcastTx = async () => {
    if (balance === null) return;

    const broadcastActions: Omit<BroadcastTransactionArgs, 'transaction'> = {
      amount: amountToStack,
      onBroadcastSuccess: txId => {
        dispatch(activeStackingTx({ txId }));
        history.push(routes.HOME);
      },
      onBroadcastFail: () => setStep(StackingModalStep.FailedContractCall),
    };

    setHasSubmitted(true);
    await delay(100);

    if (walletType === 'software') {
      setIsDecrypting(true);

      const [error, transaction] = await safeAwait(createSoftwareWalletTx());

      if (error) {
        setIsDecrypting(false);
        setDecryptionError(
          String(error) === 'OperationError'
            ? 'Unable to decrypt wallet'
            : 'Something else went wrong'
        );
        return;
      }

      if (transaction) {
        setIsDecrypting(false);
        dispatch(broadcastTransaction({ ...broadcastActions, transaction }));
      }
    }

    if (walletType === 'ledger') {
      if (publicKey === null) {
        return;
      }

      const [error, transaction] = await safeAwait(createLedgerWalletTx({ publicKey }));

      if (error) {
        setHasSubmitted(false);
        setStep(StackingModalStep.FailedContractCall);
        return;
      }

      if (transaction) {
        dispatch(broadcastTransaction({ ...broadcastActions, transaction }));
      }
    }
  };

  const { step: ledgerConnectStep } = usePrepareLedger();

  const txFormStepMap: Record<StackingModalStep, StackingModalComponents> = {
    [StackingModalStep.DecryptWalletAndSend]: () => ({
      header: <StackingModalHeader onSelectClose={onClose}>Confirm and lock</StackingModalHeader>,
      body: (
        <DecryptWalletForm
          onSetPassword={password => setPassword(password)}
          onForgottenPassword={() => {
            onClose();
            history.push(routes.SETTINGS);
          }}
          hasSubmitted={hasSubmitted}
          decryptionError={decryptionError}
        />
      ),
      footer: (
        <StackingModalFooter>
          <StackingModalButton mode="tertiary" onClick={onClose}>
            Close
          </StackingModalButton>
          <StackingModalButton
            isLoading={isDecrypting}
            isDisabled={isDecrypting}
            onClick={() => broadcastTx()}
          >
            Initiate Stacking
          </StackingModalButton>
        </StackingModalFooter>
      ),
    }),
    [StackingModalStep.SignWithLedgerAndSend]: () => ({
      header: (
        <StackingModalHeader onSelectClose={onClose}>Confirm on your Ledger</StackingModalHeader>
      ),
      body: <SignTxWithLedger step={ledgerConnectStep} />,
      footer: (
        <StackingModalFooter>
          <StackingModalButton
            mode="tertiary"
            onClick={() => {
              setHasSubmitted(false);
              onClose();
            }}
          >
            Close
          </StackingModalButton>
          <StackingModalButton
            isDisabled={hasSubmitted || ledgerConnectStep !== LedgerConnectStep.ConnectedAppOpen}
            isLoading={hasSubmitted}
            onClick={() => void broadcastTx()}
          >
            Sign transaction
          </StackingModalButton>
        </StackingModalFooter>
      ),
    }),

    [StackingModalStep.FailedContractCall]: () => ({
      header: <StackingModalHeader onSelectClose={onClose} />,
      body: (
        <StackingFailed walletType={walletType}>Failed to call stacking contract</StackingFailed>
      ),
      footer: (
        <StackingModalFooter>
          <StackingModalButton mode="tertiary" onClick={onClose}>
            Close
          </StackingModalButton>
          <StackingModalButton onClick={() => setStep(initialStep)}>Try again</StackingModalButton>
        </StackingModalFooter>
      ),
    }),
  };

  const { header, body, footer } = txFormStepMap[step]();

  return (
    <Modal isOpen headerComponent={header} footerComponent={footer} {...modalStyle}>
      {body}
    </Modal>
  );
};
