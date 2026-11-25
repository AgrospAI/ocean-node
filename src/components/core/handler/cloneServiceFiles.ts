import { Readable } from 'node:stream'
import { AbiCoder, Contract, isAddress, isHexString, keccak256 } from 'ethers'
import { DDOManager, Service } from '@oceanprotocol/ddo-js'
import { Command } from '../../../@types/commands.js'
import { P2PCommandResponse } from '../../../@types/OceanNode.js'
import { EncryptMethod } from '../../../@types/fileObject.js'
import { CommandHandler } from './handler.js'
import { checkNonce } from '../utils/nonceHandler.js'
import { sameAddress } from '../../../utils/evmAddress.js'
import { sanitizeServiceFiles } from '../../../utils/util.js'
import { PROTOCOL_COMMANDS } from '../../../utils/constants.js'
import {
  buildInvalidRequestMessage,
  validateCommandParameters,
  ValidateParams
} from '../../httpRoutes/validateCommands.js'

export interface CloneServiceFilesCommand extends Command {
  probe?: boolean
  documentId: string
  serviceId: string
  chainId: number
  datatokenAddress: string
  sourceFilesHash: string
  consumerAddress: string
  validUntil: number
  nonce: string
  signature: string
}

/** All authority-bearing fields, the exact source version, expiry and target node are signed. */
export function cloneFilesDomain(task: CloneServiceFilesCommand, peerId: string): string {
  return `cloneServiceFiles:${keccak256(
    AbiCoder.defaultAbiCoder().encode(
      ['string', 'uint256', 'string', 'string', 'address', 'bytes32', 'uint256'],
      [
        peerId,
        task.chainId,
        task.documentId,
        task.serviceId,
        task.datatokenAddress,
        task.sourceFilesHash,
        task.validUntil
      ]
    )
  )}`
}

export class CloneServiceFilesHandler extends CommandHandler {
  validate(task: CloneServiceFilesCommand): ValidateParams {
    if (task.probe === true) return validateCommandParameters(task, [])
    const result = validateCommandParameters(task, [
      'documentId',
      'serviceId',
      'chainId',
      'datatokenAddress',
      'sourceFilesHash',
      'consumerAddress',
      'validUntil',
      'nonce',
      'signature'
    ])
    if (!result.valid) return result
    if (
      typeof task.documentId !== 'string' ||
      !/^did:ope?:[a-f0-9]{64}$/i.test(task.documentId) ||
      typeof task.serviceId !== 'string' ||
      !task.serviceId.length ||
      task.serviceId.length > 256 ||
      !Number.isSafeInteger(task.chainId) ||
      task.chainId <= 0 ||
      !isAddress(task.consumerAddress) ||
      !isAddress(task.datatokenAddress) ||
      !isHexString(task.sourceFilesHash, 32) ||
      !Number.isSafeInteger(task.validUntil) ||
      !/^\d{1,15}$/.test(task.nonce)
    )
      return buildInvalidRequestMessage('Invalid clone service files request')
    return result
  }

  getNftContract(address: string, provider: any) {
    return new Contract(
      address,
      [
        'function ownerOf(uint256) view returns(address)',
        'function getTokensList() view returns(address[])',
        'function getMetaData() view returns(string,string,uint8,bool)'
      ],
      provider
    )
  }

  async handle(task: CloneServiceFilesCommand): Promise<P2PCommandResponse> {
    const validation = await this.verifyParamsAndRateLimits(task)
    if (this.shouldDenyTaskHandling(validation)) return validation
    if (task.probe === true)
      return {
        stream: Readable.from(
          JSON.stringify({ supported: true, protocol: 'cloneServiceFiles-v1' })
        ),
        status: { httpStatus: 200 }
      }
    const deny = (httpStatus: number, error: string): P2PCommandResponse => ({
      stream: null,
      status: { httpStatus, error }
    })
    const now = Math.floor(Date.now() / 1000)
    if (task.validUntil <= now || task.validUntil > now + 300)
      return deny(401, 'Clone authorization expired or exceeds five minutes')
    const node = this.getOceanNode()
    const blockchain = node.getBlockchain(task.chainId)
    if (!blockchain) return deny(400, 'Unsupported clone network')
    try {
      const domain = cloneFilesDomain(task, node.getKeyManager().getPeerIdString())
      const auth = await checkNonce(
        node.getConfig(),
        (await node.getDatabase()).nonce,
        task.consumerAddress,
        Number(task.nonce),
        task.signature,
        domain,
        String(task.chainId)
      )
      if (!auth.valid) return deny(401, 'Invalid clone signature or nonce')
      const finder: any = node.getCoreHandlers().getHandler(PROTOCOL_COMMANDS.FIND_DDO)
      const ddo = await finder.findAndFormatDdo(task.documentId)
      if (!ddo) return deny(404, 'Original asset not found')
      const { chainId, nftAddress } = DDOManager.getDDOClass(ddo).getDDOFields()
      if (Number(chainId) !== task.chainId) return deny(400, 'Asset network mismatch')
      const source = DDOManager.getDDOClass(ddo).getService(task.serviceId) as Service & {
        state?: number
      }
      if (!source || source.state !== 0 || !['access', 'compute'].includes(source.type))
        return deny(400, 'Original service is inactive or unavailable')
      const nft = this.getNftContract(nftAddress, await blockchain.getProvider())
      const owner = await nft.ownerOf(1)
      if (!sameAddress(owner, task.consumerAddress))
        return deny(403, 'Only the current NFT owner can clone service files')
      const metadata = await nft.getMetaData()
      if (Number(metadata[2]) !== 0 || !metadata[3])
        return deny(403, 'Original NFT is not active')
      const tokens: string[] = await nft.getTokensList()
      if (
        sameAddress(source.datatokenAddress, task.datatokenAddress) ||
        !tokens.some((t) => sameAddress(t, task.datatokenAddress))
      )
        return deny(403, 'Target datatoken must be a different token on the same NFT')
      const ciphertext = Buffer.from(sanitizeServiceFiles(source.files), 'hex')
      if (keccak256(ciphertext).toLowerCase() !== task.sourceFilesHash.toLowerCase())
        return deny(409, 'Original encrypted files changed; review again')
      const clear = JSON.parse(
        Buffer.from(
          await node.getKeyManager().decrypt(ciphertext, EncryptMethod.ECIES)
        ).toString()
      )
      if (
        !sameAddress(clear.nftAddress, nftAddress) ||
        !sameAddress(clear.datatokenAddress, source.datatokenAddress) ||
        !Array.isArray(clear.files) ||
        !clear.files.length
      )
        return deny(400, 'Original encrypted file binding is invalid')
      const encrypted = await node.getKeyManager().encrypt(
        Buffer.from(
          JSON.stringify({
            ...clear,
            nftAddress,
            datatokenAddress: task.datatokenAddress
          })
        ),
        EncryptMethod.ECIES
      )
      if (!sameAddress(await nft.ownerOf(1), task.consumerAddress))
        return deny(409, 'NFT ownership changed during cloning')
      return {
        stream: Readable.from('0x' + encrypted.toString('hex')),
        status: { httpStatus: 200 }
      }
    } catch {
      // Never log decrypted URLs, storage credentials, or parser errors containing plaintext.
      return deny(500, 'Could not clone service files on this node')
    }
  }
}
