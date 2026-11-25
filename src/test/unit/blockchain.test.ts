import { expect } from 'chai'
import { createServer } from 'node:http'
import { AddressInfo } from 'node:net'
import { OceanNodeConfig } from '../../@types/OceanNode.js'

import { BlockchainRegistry } from '../../components/BlockchainRegistry/index.js'
import { KeyManager } from '../../components/KeyManager/index.js'
import { Blockchain } from '../../utils/blockchain.js'
import { getConfiguration } from '../../utils/config.js'
import { ENVIRONMENT_VARIABLES } from '../../utils/constants.js'
import {
  DEFAULT_TEST_TIMEOUT,
  OverrideEnvConfig,
  TEST_ENV_CONFIG_FILE,
  buildEnvOverrideConfig,
  setupEnvironment,
  tearDownEnvironment
} from '../utils/utils.js'

import { DEVELOPMENT_CHAIN_ID, KNOWN_CONFIDENTIAL_EVMS } from '../../utils/address.js'
import { isConfidentialEVM } from '../../utils/asset.js'

let envOverrides: OverrideEnvConfig[]
let config: OceanNodeConfig
let blockchain: Blockchain
describe('Should validate blockchain network connections', () => {
  before(async () => {
    // Reserve and close an ephemeral port so this offline fixture cannot accidentally
    // connect to a running Barge chain on the usual development RPC port.
    const offlineServer = createServer()
    await new Promise<void>((resolve, reject) => {
      offlineServer.once('error', reject)
      offlineServer.listen(0, '127.0.0.1', resolve)
    })
    const closedPort = (offlineServer.address() as AddressInfo).port
    await new Promise<void>((resolve, reject) => {
      offlineServer.close((error) => (error ? reject(error) : resolve()))
    })
    envOverrides = buildEnvOverrideConfig(
      [ENVIRONMENT_VARIABLES.RPCS],
      [
        JSON.stringify({
          '8996': {
            rpc: `http://127.0.0.254:${closedPort}`,
            fallbackRPCs: [
              `http://127.0.0.3:${closedPort}`,
              `http://127.0.0.1:${closedPort}`
            ],
            chainId: 8996,
            network: 'development',
            chunkSize: 100
          }
        })
      ]
    )
    envOverrides = await setupEnvironment(TEST_ENV_CONFIG_FILE, envOverrides)
    config = await getConfiguration(true)
    const keyManager = new KeyManager(config)
    const blockchainRegistry = new BlockchainRegistry(keyManager, config)
    // network = rpcs['8996']
    blockchain = blockchainRegistry.getBlockchain(8996)
  })

  it('should get known rpcs', () => {
    expect(blockchain.getKnownRPCs().length).to.be.equal(3)
  })

  it('should get network not ready', async function () {
    this.timeout(DEFAULT_TEST_TIMEOUT * 2)
    const status = await blockchain.isNetworkReady()
    expect(status.ready).to.be.equal(false)
  })

  it('should check if chain is confidential EVM', () => {
    for (const chain of KNOWN_CONFIDENTIAL_EVMS) {
      expect(isConfidentialEVM(chain)).to.be.equal(true)
    }
    expect(isConfidentialEVM(BigInt(DEVELOPMENT_CHAIN_ID))).to.be.equal(false)
  })

  it('reads a fresh pending nonce after an immediate development-chain transaction', async () => {
    let pendingNonce = 1
    const server = createServer((req, res) => {
      let body = ''
      req.on('data', (chunk) => {
        body += chunk.toString()
      })
      req.on('end', () => {
        const requests = JSON.parse(body)
        const respond = (request: { id: number; method: string }) => {
          const results: Record<string, string> = {
            eth_chainId: '0x2324',
            eth_blockNumber: '0x1',
            eth_getTransactionCount: `0x${pendingNonce.toString(16)}`
          }
          return {
            jsonrpc: '2.0',
            id: request.id,
            ...(request.method in results
              ? { result: results[request.method] }
              : { error: { code: -32601, message: 'Method not found' } })
          }
        }
        res.setHeader('content-type', 'application/json')
        res.end(
          JSON.stringify(
            Array.isArray(requests) ? requests.map(respond) : respond(requests)
          )
        )
      })
    })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    const freshChain = new Blockchain(new KeyManager(config), {
      rpc: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
      chainId: 8996,
      network: 'development',
      chunkSize: 100
    })
    try {
      const rpc = await freshChain.getProvider()
      const address = '0x0000000000000000000000000000000000000001'
      expect(await rpc.getTransactionCount(address, 'pending')).to.equal(1)
      pendingNonce = 2
      expect(await rpc.getTransactionCount(address, 'pending')).to.equal(2)
    } finally {
      freshChain.stop()
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      })
    }
  })

  after(async () => {
    await tearDownEnvironment(envOverrides)
  })
})
