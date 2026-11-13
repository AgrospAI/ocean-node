import { ddoElasticMappings } from '@oceanprotocol/ddo-js'

export type ElasticsearchSchema = {
  index: string
  body: {
    mappings: {
      properties: {
        [field: string]: {
          type: string
          [options: string]: any
        }
      }
    }
  }
}

export type ElasticsearchSchemas = {
  ddoSchemas: ElasticsearchSchema[]
  nonceSchemas: ElasticsearchSchema
  indexerSchemas: ElasticsearchSchema
  logSchemas: ElasticsearchSchema
  orderSchema: ElasticsearchSchema
  ddoStateSchema: ElasticsearchSchema
  accessListSchema: ElasticsearchSchema
  escrowSchema: ElasticsearchSchema
}

// The marketplace filters the catalogue with un-nested `term` queries on paths such as
// `credentialSubject.services.serviceEndpoint.keyword`. `@oceanprotocol/ddo-js` ships
// `services` as `nested` (v5 under credentialSubject, v4 at the top level), which is
// invisible to root-level queries, and exposes `serviceEndpoint` as a plain `keyword`
// field, which has no `.keyword` sub-field. Rewrite both so fresh indices match what
// the marketplace sends. Existing indices keep their old mapping - `nested` <-> `object`
// cannot be changed with putMapping, so they must be deleted and reindexed.
function patchServicesForMarketplace(
  schemas: ElasticsearchSchema[]
): ElasticsearchSchema[] {
  const patched = structuredClone(schemas)
  for (const schema of patched) {
    const properties = schema.body?.mappings?.properties
    if (!properties) continue

    // v5 stores services under credentialSubject; v4 keeps them at the top level.
    const services =
      properties.credentialSubject?.properties?.services ?? properties.services
    if (!services) continue

    if (services.type === 'nested') {
      services.type = 'object'
    }

    if (services.properties?.serviceEndpoint) {
      services.properties.serviceEndpoint = {
        type: 'text',
        fields: { keyword: { type: 'keyword', ignore_above: 256 } }
      }
    }
  }
  return patched
}

// "op_ddo_short" is a node-side index for deprecated DDOs (state !== 0).
// Not part of the DDO spec, so it stays here rather than in @oceanprotocol/ddo-js.
const ddoShortSchema: ElasticsearchSchema = {
  index: 'op_ddo_short',
  body: {
    mappings: {
      properties: {
        id: { type: 'keyword' },
        version: { type: 'keyword' },
        chainId: { type: 'long' },
        nftAddress: { type: 'keyword' },
        indexedMetadata: {
          type: 'object',
          properties: {
            nft: {
              type: 'object',
              properties: {
                state: { type: 'integer' }
              }
            }
          }
        }
      }
    }
  }
}

export const elasticSchemas: ElasticsearchSchemas = {
  ddoSchemas: [
    ...patchServicesForMarketplace(ddoElasticMappings as ElasticsearchSchema[]),
    ddoShortSchema
  ],
  nonceSchemas: {
    index: 'nonce',
    body: {
      mappings: {
        properties: {
          nonce: { type: 'long' }
        }
      }
    }
  },
  indexerSchemas: {
    index: 'indexer',
    body: {
      mappings: {
        properties: {
          lastIndexedBlock: { type: 'long' }
        }
      }
    }
  },
  logSchemas: {
    index: 'logs',
    body: {
      mappings: {
        properties: {
          timestamp: { type: 'date' },
          level: { type: 'keyword' },
          message: { type: 'text' },
          moduleName: { type: 'keyword' },
          meta: { type: 'object', enabled: false }
        }
      }
    }
  },
  orderSchema: {
    index: 'order',
    body: {
      mappings: {
        properties: {
          type: { type: 'keyword' },
          timestamp: { type: 'date' },
          consumer: { type: 'keyword' },
          payer: { type: 'keyword' },
          datatokenAddress: { type: 'keyword' },
          nftAddress: { type: 'keyword' },
          did: { type: 'keyword' },
          startOrderId: { type: 'keyword' }
        }
      }
    }
  },
  ddoStateSchema: {
    index: 'state',
    body: {
      mappings: {
        properties: {
          chainId: { type: 'long' },
          did: { type: 'keyword' },
          nft: { type: 'keyword' },
          txId: { type: 'keyword' },
          valid: { type: 'boolean' },
          error: { type: 'text' }
        }
      }
    }
  },
  accessListSchema: {
    index: 'access_list',
    body: {
      mappings: {
        properties: {
          chainId: { type: 'integer' },
          contractAddress: { type: 'keyword' },
          name: { type: 'keyword' },
          symbol: { type: 'keyword' },
          transferable: { type: 'boolean' },
          users: {
            type: 'nested',
            properties: {
              wallet: { type: 'keyword' },
              tokenId: { type: 'long' },
              block: { type: 'long' },
              txId: { type: 'keyword' }
            }
          },
          deploymentBlock: { type: 'long' },
          deploymentTxId: { type: 'keyword' }
        }
      }
    }
  },
  escrowSchema: {
    index: 'escrow',
    body: {
      mappings: {
        properties: {
          id: { type: 'keyword' },
          eventType: { type: 'keyword' },
          chainId: { type: 'long' },
          contract: { type: 'keyword' },
          block: { type: 'long' },
          txHash: { type: 'keyword' },
          payer: { type: 'keyword' },
          payee: { type: 'keyword' },
          token: { type: 'keyword' },
          jobId: { type: 'keyword' },
          amount: { type: 'text' },
          expiry: { type: 'text' },
          proof: { type: 'text' },
          maxLockedAmount: { type: 'text' },
          maxLockSeconds: { type: 'text' },
          maxLockCounts: { type: 'text' },
          oldAmount: { type: 'text' },
          newAmount: { type: 'text' },
          newExpiry: { type: 'text' }
        }
      }
    }
  }
}
