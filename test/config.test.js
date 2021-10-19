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

test('getGithubAppConfig decrypts with kms and caches result', async (t) => {
  const { config } = t.context
  process.env.GITHUB_APP_PEM = Buffer.from('ghapppem').toString('base64')
  process.env.GITHUB_APP_ID = Buffer.from('ghappid').toString('base64')
  t.deepEqual(await config.getGithubAppConfig(), { id: 'abc', privateKey: 'abc' })
  t.true(config.kms.decrypt.calledTwice) // PEM + ID
  config.kms.decrypt.resetHistory()

  t.deepEqual(await config.getGithubAppConfig(), { id: 'abc', privateKey: 'abc' })
  t.true(config.kms.decrypt.notCalled)
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
