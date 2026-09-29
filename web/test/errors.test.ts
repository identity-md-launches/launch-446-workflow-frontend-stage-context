import { describe, expect, it } from 'vitest'
import {
  BaseError,
  ContractFunctionExecutionError,
  ContractFunctionRevertedError,
  UserRejectedRequestError,
  encodeErrorResult,
  parseAbi,
} from 'viem'
import { describeError } from '../src/lib/errors'

const abi = parseAbi([
  'error PaymentExpired()',
  'error DuplicatePayment()',
  'error ERC20InsufficientAllowance(address spender, uint256 allowance, uint256 needed)',
  'function pay(uint8 packs, bytes32 orderId, uint256 deadline) returns (uint256)',
])

function revert(errorName: string, args: unknown[] = []) {
  const data = encodeErrorResult({ abi, errorName: errorName as never, args: args as never })
  const reverted = new ContractFunctionRevertedError({ abi, data, functionName: 'pay' })
  return new ContractFunctionExecutionError(reverted, { abi, functionName: 'pay', args: [] })
}

describe('describeError', () => {
  it('maps custom contract errors to plain instructions', () => {
    expect(describeError(revert('PaymentExpired'))).toMatch(/expired/i)
    expect(describeError(revert('DuplicatePayment'))).toMatch(/already paid/i)
    expect(
      describeError(revert('ERC20InsufficientAllowance', ['0x0000000000000000000000000000000000000001', 0n, 1n])),
    ).toMatch(/Approve the exact IMD amount/)
  })

  it('recognises wallet rejections by viem error and by code', () => {
    expect(describeError(new UserRejectedRequestError(new Error('User rejected the request.')))).toMatch(/rejected/i)
    expect(describeError({ code: 4001, message: 'User rejected' })).toMatch(/rejected/i)
  })

  it('translates gas and network problems', () => {
    expect(describeError(new BaseError('insufficient funds for gas * price + value'))).toMatch(/Sepolia ETH/)
    expect(describeError(new Error('Failed to fetch'))).toMatch(/reach the network/i)
  })

  it('falls back to a safe message', () => {
    expect(describeError(undefined)).toBe('Unable to complete the request. Try again.')
    expect(describeError({ weird: true }, 'custom')).toBe('custom')
  })
})
