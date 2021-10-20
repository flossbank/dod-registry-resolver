const test = require('ava')
const sinon = require('sinon')
const Dynamo = require('../lib/dynamo')

test.beforeEach((t) => {
  t.context.dynamo = new Dynamo({
    docs: {
      get: sinon.stub().returns({
        promise: sinon.stub().resolves()
      })
    }
  })
})

test('getConfigValue | config attr found', async (t) => {
  const { dynamo } = t.context
  dynamo.docs.get().promise.resolves({ Item: { configKey: 'abc', configValue: 'def' } })
  t.is(await dynamo.getConfigValue('abc'), 'def')
})

test('getConfigValue | config attr not found', async (t) => {
  const { dynamo } = t.context
  dynamo.docs.get().promise.resolves({ })
  t.is(await dynamo.getConfigValue('abc'), undefined)
})
