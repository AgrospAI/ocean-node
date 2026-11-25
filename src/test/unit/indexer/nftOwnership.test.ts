/* eslint-disable require-await -- async runner models the ethers RPC interface. */
import { expect } from 'chai'
import { ethers, Interface, Signer } from 'ethers'
import ERC721Template from '@oceanprotocol/contracts/artifacts/contracts/templates/ERC721Template.sol/ERC721Template.json' with { type: 'json' }
import { OceanNode } from '../../../OceanNode.js'
import { MetadataEventProcessor } from '../../../components/Indexer/processors/index.js'
import { OceanNodeConfig } from '../../../@types/OceanNode.js'

void OceanNode

class OwnershipProcessor extends MetadataEventProcessor {
  readNft(signer: Signer) {
    return this.getNFTInfo('0xE44b5A3e03e4eF62e895E5a1ff1a9F3F30498abE', signer, 1)
  }
}

describe('Metadata indexer NFT ownership', () => {
  const owner = '0x7e102FF28971Be04C3EcB5B486eDC94ED2b83C12'
  const registry = '0x8CA7Ee6A9f9455035d4F5F6d6000E83DA505aF25'
  const iface = new Interface(ERC721Template.abi)

  function runner(holder: string, failOwnerRead = false): Signer {
    return {
      call: async (tx: ethers.TransactionRequest) => {
        const call = iface.parseTransaction({ data: String(tx.data) })
        if (call.name === 'ownerOf') {
          expect(call.args[0]).to.equal(1n)
          if (failOwnerRead) throw new Error('Owner RPC unavailable')
        }
        const results: Record<string, unknown[]> = {
          getMetaData: ['', '', 0, true],
          getId: [1],
          tokenURI: ['https://example.org/nft'],
          name: ['Red Wine'],
          symbol: ['RED'],
          ownerOf: [holder]
        }
        return iface.encodeFunctionResult(call.name, results[call.name])
      }
    } as unknown as Signer
  }

  it('indexes the ERC721 owner after an authorized registry metadata update', async () => {
    const processor = new OwnershipProcessor(11155420, {} as OceanNodeConfig)
    const nft = await processor.readNft(runner(owner))
    expect(nft.owner).to.equal(owner)
    expect(nft.owner).not.to.equal(registry)
  })

  it('reads a genuine new owner instead of retaining the original publisher', async () => {
    const next = '0x7774693eBe0352092cF1C81368AfB034E4D042D1'
    const nft = await new OwnershipProcessor(11155420, {} as OceanNodeConfig).readNft(
      runner(next)
    )
    expect(nft.owner).to.equal(next)
  })

  it('fails when ownership cannot be verified instead of substituting the caller', async () => {
    try {
      await new OwnershipProcessor(11155420, {} as OceanNodeConfig).readNft(
        runner(owner, true)
      )
      expect.fail('must reject an unavailable owner read')
    } catch (error) {
      expect(error.message).to.contain('Owner RPC unavailable')
    }
  })
})
