const test = require('ava')
const sinon = require('sinon')
const Dynamo = require('../lib/dynamo')

test.before(() => {
  sinon.stub(Date, 'now').returns(1234)
})

test.after(() => {
  Date.now.restore()
})

test.beforeEach((t) => {
  t.context.dynamo = new Dynamo({
    docs: {
      get: sinon.stub().returns({
        promise: sinon.stub().resolves()
      }),
      update: sinon.stub().returns({
        promise: sinon.stub().resolves({ Attributes: { a: 1 } })
      }),
      delete: sinon.stub().returns({
        promise: sinon.stub().resolves()
      })
    }
  })
})

test('lockOrg success', async (t) => {
  const info = await t.context.dynamo.lockOrg({ organizationId: 'test-org-id' })
  t.true(t.context.dynamo.docs.update.calledWith({
    TableName: t.context.dynamo.LOCKS_TABLE,
    Key: { lock_key: 'test-org-id' },
    UpdateExpression: 'SET locked_until = :lockTimeout',
    ConditionExpression: 'attribute_not_exists(locked_until) OR locked_until < :now',
    ExpressionAttributeValues: {
      ':lockTimeout': Date.now() + t.context.dynamo.LOCK_TIMEOUT,
      ':now': Date.now()
    },
    ReturnValues: 'ALL_NEW'
  }))
  t.deepEqual(info, { a: 1 })
})

test('lockOrg failure', async (t) => {
  t.context.dynamo.docs.update().promise.throws(new Error('yikes'))
  await t.throwsAsync(t.context.dynamo.lockOrg({ organizationId: 'test-org-id' }), {
    message: 'yikes'
  })
})

test('lockOrg failure | already locked', async (t) => {
  const err = new Error()
  err.code = 'ConditionalCheckFailedException'
  t.context.dynamo.docs.update().promise.throws(err)
  await t.throwsAsync(t.context.dynamo.lockOrg({ organizationId: 'test-org-id' }), {
    message: 'Organization id test-org-id is already locked'
  })
})

test('unlockOrg success', async (t) => {
  const { dynamo } = t.context
  await dynamo.unlockOrg({ organizationId: 'abc' })
  t.true(dynamo.docs.delete.calledWith({
    TableName: dynamo.LOCKS_TABLE,
    Key: { lock_key: 'abc' }
  }))
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
