import { BaseError, ContractFunctionRevertedError, UserRejectedRequestError } from 'viem'

/** Human-readable messages for the contracts' custom errors, each saying what to do next. */
const CONTRACT_ERRORS: Record<string, string> = {
  WrongChain: 'This contract only accepts payments on Sepolia. Switch your wallet to Sepolia and try again.',
  InvalidPackCount: 'Choose between 1 and 3 packs.',
  InvalidOrderId: 'The order reference is empty. Start a new order to generate one.',
  PaymentExpired: 'This payment window has expired. Start a new order and confirm within 20 minutes.',
  DuplicatePayment: 'This order reference was already paid from this wallet. Start a new order to buy again.',
  InexactTransfer: 'The token transfer did not settle exactly. Nothing was charged. Try again.',
  ReentrancyGuardReentrantCall: 'The payment was interrupted by a re-entrant call. Nothing was charged. Try again.',
  SafeERC20FailedOperation: 'The IMD token rejected the transfer. Check your balance and approval, then try again.',
  ERC20InsufficientAllowance: 'Approve the exact IMD amount first, then pay.',
  ERC20InsufficientBalance: 'Your wallet does not hold enough IMD for this purchase.',
  ERC20InvalidSpender: 'The approval target is invalid. Reload the page and try again.',
  ERC20InvalidReceiver: 'The transfer target is invalid. Reload the page and try again.',
}

function findRevert(error: unknown): ContractFunctionRevertedError | undefined {
  if (!(error instanceof BaseError)) return undefined
  return error.walk((e) => e instanceof ContractFunctionRevertedError) as ContractFunctionRevertedError | undefined
}

function isUserRejection(error: unknown): boolean {
  if (error instanceof BaseError && error.walk((e) => e instanceof UserRejectedRequestError)) return true
  const code = (error as { code?: unknown } | null)?.code
  if (code === 4001 || code === 'ACTION_REJECTED') return true
  const message = String((error as { message?: unknown } | null)?.message ?? '').toLowerCase()
  return message.includes('user rejected') || message.includes('user denied')
}

/** Translate wallet and contract errors into a plain sentence with a next step. */
export function describeError(error: unknown, fallback = 'Unable to complete the request. Try again.'): string {
  if (!error) return fallback
  if (isUserRejection(error)) return 'Request rejected in your wallet. Nothing was sent.'

  const revert = findRevert(error)
  const name = revert?.data?.errorName ?? revert?.reason
  if (name && CONTRACT_ERRORS[name]) return CONTRACT_ERRORS[name]
  if (name) return `The contract rejected the request (${name}). Check the details and try again.`

  const message = String((error as { shortMessage?: unknown; message?: unknown })?.shortMessage ?? (error as { message?: unknown })?.message ?? '')
  const lower = message.toLowerCase()
  if (lower.includes('insufficient funds')) return 'Your wallet does not hold enough Sepolia ETH to pay for gas. Use a faucet, then try again.'
  if (lower.includes('chain mismatch') || lower.includes('does not match')) return 'Your wallet is on a different network. Switch to Sepolia and try again.'
  if (lower.includes('failed to fetch') || lower.includes('network') || lower.includes('timeout')) {
    return 'Unable to reach the network. Check your connection and try again.'
  }
  if (lower.includes('provider not found') || lower.includes('no injected')) {
    return 'No browser wallet detected. Install a wallet extension, then reload the page.'
  }
  if (error instanceof BaseError) return `${error.shortMessage}. Try again.`
  return fallback
}
