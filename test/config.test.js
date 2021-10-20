const test = require('ava')
const sinon = require('sinon')
const Config = require('../lib/config')

test.beforeEach((t) => {
  t.context.config = new Config({
    kms: {
      decrypt: sinon.stub().returns({
        promise: sinon.stub().resolves({
          Plaintext: Buffer.from('abc')
        })
      })
    },
    dynamo: {
      getConfigValue: sinon.stub()
    }
  })
})

test('getMongoUri decrypts with kms and caches result', async (t) => {
  const { config } = t.context
  process.env.MONGO_URI = Buffer.from('abc').toString('base64')
  t.is(await config.getMongoUri(), 'abc')
  t.true(config.kms.decrypt.calledOnce)
  config.kms.decrypt.resetHistory()

  t.is(await config.getMongoUri(), 'abc')
  t.true(config.kms.decrypt.notCalled)
})

test('getOrgDistributeDonationInputQueueUrl', (t) => {
  process.env.ORG_DISTRIBUTE_DONATION_INPUT_QUEUE_URL = 'abc'
  t.is(t.context.config.getOrgDistributeDonationInputQueueUrl(), 'abc')
})

test('config vals stored in dynamo are retrieved and cached', async (t) => {
  const { config } = t.context
  config.dynamo.getConfigValue.resolves('abc')
  t.is(await config.getCompensationEpsilon(), 'abc')
  t.true(config.dynamo.getConfigValue.calledWith('compensationEpsilon'))
  config.dynamo.getConfigValue.resetHistory()
  t.is(await config.getCompensationEpsilon(), 'abc')
  t.true(config.dynamo.getConfigValue.notCalled)
})
