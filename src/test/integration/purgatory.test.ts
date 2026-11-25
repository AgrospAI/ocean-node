import { expect, assert } from 'chai'
import { createServer, Server } from 'node:http'
import { AddressInfo } from 'node:net'
import { Purgatory } from '../../components/Indexer/purgatory.js'
import {
  OverrideEnvConfig,
  buildEnvOverrideConfig,
  setupEnvironment,
  tearDownEnvironment
} from '../utils/utils.js'
import { ENVIRONMENT_VARIABLES, getConfiguration } from '../../utils/index.js'
describe('**********         Purgatory test', () => {
  let purgatory: Purgatory
  let previousConfiguration: OverrideEnvConfig[]
  let config: any
  let server: Server

  before(async () => {
    // Exercise real HTTP parsing with deterministic lists and a fresh instance;
    // indexer suites may already have created the global singleton with purgatory disabled.
    server = createServer((req, res) => {
      const lists = {
        '/accounts': [
          { address: '0xAD23fC9D943018C34aC55E8DA29AF700A2Fd0FeB', reason: 'bad actor' }
        ],
        '/assets': [
          {
            did: 'did:op:5b33dd722bd9e5e291685545203dfcfd914b55d12de0c1f31541d323e581041c',
            reason: 'mumbai test dataset'
          }
        ]
      }
      const list = lists[req.url as keyof typeof lists]
      res.writeHead(list ? 200 : 404, { 'content-type': 'application/json' })
      res.end(JSON.stringify(list ?? []))
    })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    // override and save configuration (always before calling getConfig())
    previousConfiguration = await setupEnvironment(
      null,
      buildEnvOverrideConfig(
        [
          ENVIRONMENT_VARIABLES.ASSET_PURGATORY_URL,
          ENVIRONMENT_VARIABLES.ACCOUNT_PURGATORY_URL
        ],
        [`${baseUrl}/assets`, `${baseUrl}/accounts`]
      )
    )
    config = await getConfiguration(true)

    purgatory = new Purgatory(config.accountPurgatoryUrl, config.assetPurgatoryUrl)
  })

  it('instance Purgatory', () => {
    expect(purgatory).to.be.instanceOf(Purgatory)
  })
  it('should retrieve account list', async () => {
    const accountPurgatory = await purgatory.parsePurgatoryAccounts()
    assert(accountPurgatory, 'account purgatory list could not be fetched.')
    let res: any
    for (const acc of accountPurgatory) {
      if (
        acc.address?.toLowerCase() ===
        '0xAD23fC9D943018C34aC55E8DA29AF700A2Fd0FeB'?.toLowerCase()
      ) {
        res = acc
        break
      }
    }
    assert(res, 'could not find this banned account')
    assert(res.reason === 'bad actor')
  })

  it('should check if account is banned', async () => {
    assert(
      (await purgatory.isBannedAccount('0xAD23fC9D943018C34aC55E8DA29AF700A2Fd0FeB')) ===
        true
    )
  })

  it('should retrieve assets list', async () => {
    const assetPurgatory = await purgatory.parsePurgatoryAssets()
    assert(assetPurgatory, 'asset purgatory list could not be fetched.')
    let res: any
    for (const a of assetPurgatory) {
      if (
        a.did ===
        'did:op:5b33dd722bd9e5e291685545203dfcfd914b55d12de0c1f31541d323e581041c'
      ) {
        res = a
        break
      }
    }
    assert(res, 'could not find this banned asset')
    assert(res.reason === 'mumbai test dataset')
  })

  it('should check if asset is banned', async () => {
    assert(
      (await purgatory.isBannedAsset(
        'did:op:5b33dd722bd9e5e291685545203dfcfd914b55d12de0c1f31541d323e581041c'
      )) === true
    )
  })

  after(async () => {
    try {
      await tearDownEnvironment(previousConfiguration)
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      })
    }
  })
})
