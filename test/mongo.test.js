const test = require('ava')
const sinon = require('sinon')
const { MongoMemoryServer } = require('mongodb-memory-server')
const Mongo = require('../lib/mongo')
const Config = require('../lib/config')
const ULID = require('ulid')

test.before(() => {
  sinon.stub(Date, 'now').returns(1234)
  sinon.stub(ULID, 'ulid').returns('bbbbbbbbbbbb')
})

test.before(async (t) => {
  const config = new Config({
    kms: {}
  })

  const mongo = await MongoMemoryServer.create()
  const mongoUri = mongo.getUri()

  config.decrypt = sinon.stub().returns(mongoUri)
  t.context.mongo = new Mongo({ config, log: { info: sinon.stub() } })
  await t.context.mongo.connect()
})

test.after(async (t) => {
  await t.context.mongo.close()
})

test('close', async (t) => {
  const mongo = new Mongo({})
  await mongo.close() // nothing to close

  mongo.mongoClient = { close: sinon.stub() }
  await mongo.close()

  t.true(mongo.mongoClient.close.calledOnce)
})

test('get no comp list | supported', async (t) => {
  const { mongo } = t.context

  await mongo.db.collection('meta').insertOne({
    language: 'javascript',
    registry: 'npm',
    name: 'noCompList',
    list: ['react']
  })

  const res = await mongo.getNoCompList({ language: 'javascript', registry: 'npm' })
  t.deepEqual(res, new Set(['react']))
})

test('get no comp list | unsupported', async (t) => {
  const { mongo } = t.context

  const res = await mongo.getNoCompList({ language: 'python', registry: 'pypi' })
  t.deepEqual(res, new Set())
})
