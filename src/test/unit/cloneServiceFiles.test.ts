import { Readable } from 'node:stream'
import { expect } from 'chai'
import sinon from 'sinon'
import { Wallet, getBytes, keccak256, toUtf8Bytes } from 'ethers'
import {
  CloneServiceFilesHandler,
  cloneFilesDomain,
  CloneServiceFilesCommand
} from '../../components/core/handler/cloneServiceFiles.js'

const owner = Wallet.createRandom()
const other = Wallet.createRandom()
const nft = '0x1111111111111111111111111111111111111111'
const oldToken = '0x2222222222222222222222222222222222222222'
const newToken = '0x3333333333333333333333333333333333333333'
const did = 'did:ope:' + 'a'.repeat(64)
const peer = 'this-node-only'

describe('automatic service file cloning', () => {
  let handler: CloneServiceFilesHandler
  let task: CloneServiceFilesCommand
  let decrypt: sinon.SinonStub
  let encrypt: sinon.SinonStub
  let ownerOf: sinon.SinonStub
  let original: any
  beforeEach(async () => {
    const clear = {
      nftAddress: nft,
      datatokenAddress: oldToken,
      files: [
        {
          type: 'url',
          url: 'https://example.com/private',
          headers: { Authorization: 'private-original-secret' }
        }
      ]
    }
    decrypt = sinon.stub().resolves(Buffer.from(JSON.stringify(clear)))
    encrypt = sinon.stub().resolves(Buffer.from('new-ciphertext'))
    ownerOf = sinon.stub().resolves(owner.address)
    original = {
      id: did,
      version: '5.0.0',
      credentialSubject: {
        id: did,
        chainId: 11155420,
        nftAddress: nft,
        metadata: { type: 'dataset' },
        services: [
          {
            id: 'source',
            name: 'source',
            type: 'access',
            state: 0,
            datatokenAddress: oldToken,
            files: '0x1234'
          }
        ]
      }
    }
    let nonce = 0
    const node: any = {
      getRequestMap: () => new Map(),
      getConfig: () => ({ supportedNetworks: {}, rateLimit: 30 }),
      getDatabase: () =>
        Promise.resolve({
          nonce: {
            retrieve: () => Promise.resolve({ nonce }),
            update: (_address: string, value: number) => {
              nonce = value
              return Promise.resolve(true)
            }
          }
        }),
      getBlockchain: () => ({ getProvider: () => Promise.resolve({}) }),
      getKeyManager: () => ({ getPeerIdString: () => peer, decrypt, encrypt }),
      getCoreHandlers: () => ({
        getHandler: () => ({ findAndFormatDdo: () => Promise.resolve(original) })
      })
    }
    handler = new CloneServiceFilesHandler(node)
    sinon.stub(handler, 'getNftContract').returns({
      ownerOf,
      getTokensList: () => Promise.resolve([oldToken, newToken]),
      getMetaData: () => Promise.resolve(['', '', 0, true])
    } as any)
    task = {
      command: 'cloneServiceFiles',
      documentId: did,
      serviceId: 'source',
      chainId: 11155420,
      datatokenAddress: newToken,
      sourceFilesHash: keccak256('0x1234'),
      validUntil: Math.floor(Date.now() / 1000) + 120,
      consumerAddress: owner.address,
      nonce: '1',
      signature: ''
    }
    task.signature = await owner.signMessage(
      getBytes(
        keccak256(toUtf8Bytes(owner.address + task.nonce + cloneFilesDomain(task, peer)))
      )
    )
  })
  afterEach(() => sinon.restore())
  it('rebinds original storage credentials internally and returns only ciphertext', async () => {
    const result = await handler.handle(task)
    expect(result.status.httpStatus).to.equal(200)
    const clear = JSON.parse(encrypt.firstCall.args[0].toString())
    expect(clear.datatokenAddress).to.equal(newToken)
    expect(clear.nftAddress).to.equal(nft)
    expect(clear.files[0].headers.Authorization).to.equal('private-original-secret')
    let body = ''
    for await (const chunk of result.stream as Readable) body += String(chunk)
    expect(body).to.equal('0x' + Buffer.from('new-ciphertext').toString('hex'))
    expect(body).not.to.contain('private-original-secret')
    expect(original.credentialSubject.services[0].datatokenAddress).to.equal(oldToken)
  })
  it('reports capability without requesting a signature or touching secrets', async () => {
    const result = await handler.handle({
      command: 'cloneServiceFiles',
      probe: true
    } as CloneServiceFilesCommand)
    expect(result.status.httpStatus).to.equal(200)
    expect(decrypt.called).to.equal(false)
  })
  it('rejects replays after consuming the signed nonce', async () => {
    expect((await handler.handle(task)).status.httpStatus).to.equal(200)
    expect((await handler.handle(task)).status.httpStatus).to.equal(401)
    expect(decrypt.callCount).to.equal(1)
  })
  it('rejects a target token from another NFT even with a valid signature', async () => {
    task.datatokenAddress = other.address
    task.signature = await owner.signMessage(
      getBytes(
        keccak256(toUtf8Bytes(owner.address + task.nonce + cloneFilesDomain(task, peer)))
      )
    )
    expect((await handler.handle(task)).status.httpStatus).to.equal(403)
    expect(decrypt.called).to.equal(false)
  })
  it('denies a non-owner before decrypting', async () => {
    ownerOf.resolves(other.address)
    expect((await handler.handle(task)).status.httpStatus).to.equal(403)
    expect(decrypt.called).to.equal(false)
  })
  it('binds the signature to the target token and node', async () => {
    expect(cloneFilesDomain(task, 'another-node')).not.to.equal(
      cloneFilesDomain(task, peer)
    )
    task.datatokenAddress = other.address
    expect((await handler.handle(task)).status.httpStatus).to.equal(401)
    expect(decrypt.called).to.equal(false)
  })
  it('rejects expired authorization and changed source ciphertext', async () => {
    task.validUntil = Math.floor(Date.now() / 1000) - 1
    expect((await handler.handle(task)).status.httpStatus).to.equal(401)
    task.validUntil = Math.floor(Date.now() / 1000) + 120
    original.credentialSubject.services[0].files = '0x5678'
    expect((await handler.handle(task)).status.httpStatus).to.equal(409)
    expect(decrypt.called).to.equal(false)
  })
  it('does not accept an existing service token as the target', async () => {
    task.datatokenAddress = oldToken
    task.signature = await owner.signMessage(
      getBytes(
        keccak256(toUtf8Bytes(owner.address + task.nonce + cloneFilesDomain(task, peer)))
      )
    )
    expect((await handler.handle(task)).status.httpStatus).to.equal(403)
    expect(decrypt.called).to.equal(false)
  })
  it('refuses source ciphertext bound to another NFT', async () => {
    decrypt.resolves(
      Buffer.from(
        JSON.stringify({
          nftAddress: other.address,
          datatokenAddress: oldToken,
          files: [{}]
        })
      )
    )
    expect((await handler.handle(task)).status.httpStatus).to.equal(400)
    expect(encrypt.called).to.equal(false)
  })
  it('rechecks ownership after encryption', async () => {
    ownerOf.onSecondCall().resolves(other.address)
    expect((await handler.handle(task)).status.httpStatus).to.equal(409)
  })
  it('does not reveal decrypted input through parser errors', async () => {
    decrypt.resolves(Buffer.from('invalid private-original-secret'))
    const result = await handler.handle(task)
    expect(result.status.httpStatus).to.equal(500)
    expect(JSON.stringify(result)).not.to.contain('private-original-secret')
  })
})
