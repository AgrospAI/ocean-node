/* eslint-disable require-await -- async test doubles model RPC and storage APIs. */
import { expect } from 'chai'
import type { Readable as ReadableStream } from 'node:stream'
import { DDO } from '@oceanprotocol/ddo-js'
import { validateFilesStructure } from '../../components/core/handler/downloadHandler.js'

// Keep these tests independent of encryption, database and RPC availability.
describe('Download file binding across DDO versions', () => {
  const nftAddress = '0xBB1081DbF3227bbB233Db68f7117114baBb43656'
  const datatokenAddress = '0x00000000000000000000000000000000000000ab'
  const service = { id: 'download', type: 'access', datatokenAddress, timeout: 0 }
  const fields = { chainId: 11155420, nftAddress, services: [service] }
  const files = { nftAddress, datatokenAddress }

  for (const version of ['4.1.0', '5.0.0']) {
    const ddo = (
      version.startsWith('5')
        ? { id: 'did:ope:test', version, credentialSubject: { ...fields, version } }
        : { id: 'did:op:test', version, ...fields }
    ) as DDO

    it(`accepts correctly bound files for DDO ${version}`, () => {
      expect(validateFilesStructure(ddo, service as any, files)).to.equal(true)
    })

    it(`rejects another NFT for DDO ${version}`, () => {
      expect(
        validateFilesStructure(ddo, service as any, {
          ...files,
          nftAddress: '0x0000000000000000000000000000000000000001'
        })
      ).to.equal(false)
    })

    it(`rejects another datatoken for DDO ${version}`, () => {
      expect(
        validateFilesStructure(ddo, service as any, {
          ...files,
          datatokenAddress: '0x0000000000000000000000000000000000000001'
        })
      ).to.equal(false)
    })
  }
})

// Exercise the handler's actual payment-validation call, not just field extraction.
describe('Download handler v5 payment and file binding', () => {
  it('streams a v5 service after validating its NFT, order and encrypted file binding', async () => {
    const { DownloadHandler } =
      await import('../../components/core/handler/downloadHandler.js')
    const { ProviderFees } = await import('../../components/core/utils/feesHandler.js')
    const { Storage } = await import('../../components/storage/index.js')
    const { AbiCoder, Interface } = await import('ethers')
    const { Readable } = await import('node:stream')
    const { default: sinon } = await import('sinon')
    const nft = '0x1111111111111111111111111111111111111111'
    const dt = '0x2222222222222222222222222222222222222222'
    const user = '0x3333333333333333333333333333333333333333'
    const iface = new Interface([
      'event OrderStarted(address indexed consumer, address payer, uint256 amount, uint256 serviceIndex, uint256 timestamp, address indexed publishMarketAddress, uint256 blockNumber)'
    ])
    const now = Math.floor(Date.now() / 1000)
    const event = iface.encodeEventLog(iface.getEvent('OrderStarted'), [
      user,
      user,
      1n,
      1,
      now,
      nft,
      1
    ])
    const abi = AbiCoder.defaultAbiCoder()
    const runner: any = {
      getTransactionReceipt: async () => ({
        logs: [{ ...event, address: dt }],
        blockHash: 'block'
      }),
      getBlock: async () => ({ timestamp: now }),
      call: async ({ to }: { to: string }) =>
        to.toLowerCase() === dt
          ? abi.encode(['address'], [nft])
          : abi.encode(['bool'], [true])
    }
    const service = {
      id: 'download',
      type: 'access',
      state: 0,
      datatokenAddress: dt,
      files: '0x1234',
      timeout: 3600
    }
    const ddo: any = {
      id: 'did:ope:' + 'a'.repeat(64),
      version: '5.0.0',
      credentialSubject: {
        chainId: 11155420,
        nftAddress: nft,
        metadata: { type: 'dataset' },
        services: [{ ...service, id: 'compute', type: 'compute' }, service]
      },
      indexedMetadata: { nft: { state: 0 } }
    }
    const node: any = {
      getConfig: () => ({ supportedNetworks: { 11155420: { chainId: 11155420 } } }),
      getCoreHandlers: () => ({
        getHandler: () => ({ findAndFormatDdo: async () => ddo })
      }),
      getBlockchain: () => ({
        isNetworkReady: async () => ({ ready: true }),
        getProvider: async () => runner,
        getSigner: async () => runner
      }),
      getKeyManager: () => ({
        decrypt: async () =>
          Buffer.from(
            JSON.stringify({
              nftAddress: nft,
              datatokenAddress: dt,
              files: [{ type: 'url', url: 'https://example.com/data.csv' }]
            })
          )
      })
    }
    const handler = new DownloadHandler(node)
    try {
      sinon
        .stub(handler, 'verifyParamsAndRateLimits')
        .resolves({ status: { httpStatus: 200, error: null }, stream: null })
      sinon
        .stub(handler, 'validateTokenOrSignature')
        .resolves({ status: { httpStatus: 200, error: null }, stream: null })
      sinon
        .stub(ProviderFees.prototype, 'verifyProviderFees')
        .resolves({ isValid: true } as any)
      sinon.stub(Storage, 'getStorageClass').returns({
        validate: () => [true, ''],
        fetchSpecificFileMetadata: async () => ({ contentLength: 4, name: 'data.csv' }),
        getReadableStream: async () => ({
          stream: Readable.from(['wine']),
          httpStatus: 200,
          headers: {}
        })
      } as any)
      const result = await handler.handle({
        documentId: ddo.id,
        serviceId: service.id,
        consumerAddress: user,
        fileIndex: 0,
        transferTxId: '0x01'
      } as any)
      expect(result.status.httpStatus).to.equal(200)
      let body = ''
      for await (const chunk of result.stream as ReadableStream) body += chunk
      expect(body).to.equal('wine')
    } finally {
      sinon.restore()
    }
  })
})
