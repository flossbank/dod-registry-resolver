const test = require('ava')
const sinon = require('sinon')
const { MongoMemoryServer } = require('mongodb-memory-server')
const { ObjectId } = require('mongodb')
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

  const mongo = new MongoMemoryServer()
  const mongoUri = await mongo.getUri()

  config.decrypt = sinon.stub().returns(mongoUri)
  t.context.mongo = new Mongo({ config, log: { info: sinon.stub() } })
  await t.context.mongo.connect()

  const { insertedId: defaultOrgId } = await t.context.mongo.db.collection('organizations').insertOne({
    name: 'azalias',
    installationId: 'abc',
    host: 'GitHub'
  })

  const { insertedId: packageId1 } = await t.context.mongo.db.collection('packages').insertOne({
    name: 'rodadendrins',
    language: 'javascript',
    registry: 'npm'
  })
  t.context.packageId1 = packageId1.toString()
  const { insertedId: packageId2 } = await t.context.mongo.db.collection('packages').insertOne({
    name: 'tulips',
    language: 'javascript',
    registry: 'npm'
  })
  t.context.packageId2 = packageId2.toString()
  const { insertedId: packageId3 } = await t.context.mongo.db.collection('packages').insertOne({
    name: 'roses',
    language: 'javascript',
    registry: 'npm'
  })
  t.context.packageId3 = packageId3.toString()

  t.context.organizationId = defaultOrgId.toString()
  t.context.packageWeightsMap = new Map([['rodadendrins', 0.05], ['tulips', 0.75], ['roses', 0.2]])
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

test('get package', async (t) => {
  const { mongo, packageId2 } = t.context

  const pkg = await mongo.getPackage({ packageId: packageId2 })
  t.deepEqual(pkg, {
    name: 'tulips',
    language: 'javascript',
    registry: 'npm'
  })
})

test('get package | no pkg', async (t) => {
  const { mongo } = t.context

  const pkg = await mongo.getPackage({ packageId: 'aaaaaaaaaaaa' })
  t.is(pkg, null)
})

test('get org', async (t) => {
  const { mongo } = t.context
  const { insertedId: orgId1 } = await mongo.db.collection('organizations').insertOne({
    name: 'flossbank',
    installationId: 'abc',
    host: 'GitHub'
  })

  const res = await mongo.getOrg({ organizationId: orgId1.toString() })
  t.deepEqual(res, { name: 'flossbank', host: 'GitHub', installationId: 'abc' })
})

test('get org | no org', async (t) => {
  const { mongo } = t.context
  const res = await mongo.getOrg({ organizationId: 'aaaaaaaaaaaa' })
  t.is(res, null)
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

test('increment org total amount donated from undefined', async (t) => {
  const { mongo } = t.context

  const { insertedId: orgId1 } = await mongo.db.collection('organizations').insertOne({
    name: 'gatorade',
    installationId: 'abc',
    host: 'GitHub'
  })

  await mongo.updateDonatedAmount({ organizationId: orgId1.toString(), amount: 1000 })

  const updatedOrg = await mongo.db.collection('organizations').findOne({ _id: orgId1 })
  t.deepEqual(updatedOrg.totalDonated, 1000)
})

test('increment org total amount donated from existing value', async (t) => {
  const { mongo } = t.context

  const { insertedId: orgId1 } = await mongo.db.collection('organizations').insertOne({
    name: 'powerade',
    installationId: 'abc',
    host: 'GitHub',
    totalDonated: 1000
  })

  await mongo.updateDonatedAmount({ organizationId: orgId1.toString(), amount: 1000 })

  const updatedOrg = await mongo.db.collection('organizations').findOne({ _id: orgId1 })
  t.deepEqual(updatedOrg.totalDonated, 2000)
})

test('decriment manually billed org remaining donation', async (t) => {
  const { mongo } = t.context

  const { insertedId: orgId1 } = await mongo.db.collection('organizations').insertOne({
    name: 'bloopers',
    installationId: 'abc',
    host: 'GitHub',
    totalDonated: 1000,
    donationAmount: 1000,
    remainingDonation: 1000
  })

  await mongo.decrimentManuallyBilledOrgRemainingDonation({ organizationId: orgId1.toString(), amount: 1000 })

  const updatedOrg = await mongo.db.collection('organizations').findOne({ _id: orgId1 })
  t.deepEqual(updatedOrg.remainingDonation, 0)
})

test('bail on empty package weights map', async (t) => {
  const temporaryMongo = new Mongo({
    config: {
      getMongoUri: async () => 'mongodb+srv://0.0.0.0/test'
    },
    log: {
      info: sinon.stub()
    }
  })

  temporaryMongo.db = {
    collection: sinon.stub().returns({
      updateOne: sinon.stub(),
      initializeUnorderedBulkOp: sinon.stub().returns({
        find: sinon.stub().returns({
          upsert: sinon.stub().returns({
            updateOne: sinon.stub()
          })
        }),
        execute: sinon.stub().returns({ nModified: 2 })
      })
    })
  }

  const donationAmount = 500000 // 5 bucks in mc
  await temporaryMongo.distributeOrgDonation({
    organizationId: t.context.organizationId,
    packageWeightsMap: new Map(),
    registry: 'npm',
    langauge: 'javascript',
    donationAmount
  })
  // Should not call bulk op
  t.false(temporaryMongo.db.collection().initializeUnorderedBulkOp().find().upsert().updateOne.called)
})

test('snapshot', async (t) => {
  const { mongo, organizationId } = t.context

  await mongo.createOrganizationOssUsageSnapshot({
    organizationId,
    totalDependencies: 100,
    topLevelDependencies: 1200
  })

  const updatedOrg = await mongo.db.collection('organizations').findOne({ _id: ObjectId(organizationId) })

  t.deepEqual(updatedOrg.snapshots, [
    { timestamp: Date.now(), totalDependencies: 100, topLevelDependencies: 1200 }
  ])
})

test('distribute org donation | success', async (t) => {
  const { packageWeightsMap, organizationId, mongo } = t.context
  const donationAmount = 1000000 // 10 bucks in millicents
  const language = 'javascript'
  const registry = 'npm'
  const description = 'Invoice 01'
  await mongo.distributeOrgDonation({
    organizationId,
    description,
    packageWeightsMap,
    language,
    registry,
    donationAmount
  })

  // 3 pushes for 3 diff packages in our packageWeightsMap
  const rodadendrinsPkg = await mongo.db.collection('packages').findOne({ _id: ObjectId(t.context.packageId1) })
  const tulipsPkg = await mongo.db.collection('packages').findOne({ _id: ObjectId(t.context.packageId2) })
  const rosesPkg = await mongo.db.collection('packages').findOne({ _id: ObjectId(t.context.packageId3) })

  t.deepEqual(rodadendrinsPkg.donationRevenue, [{
    description,
    organizationId,
    timestamp: 1234,
    amount: packageWeightsMap.get('rodadendrins') * donationAmount,
    id: 'bbbbbbbbbbbb'
  }])
  t.deepEqual(tulipsPkg.donationRevenue, [{
    description,
    organizationId,
    timestamp: 1234,
    amount: packageWeightsMap.get('tulips') * donationAmount,
    id: 'bbbbbbbbbbbb'
  }])
  t.deepEqual(rosesPkg.donationRevenue, [{
    description,
    organizationId,
    timestamp: 1234,
    amount: packageWeightsMap.get('roses') * donationAmount,
    id: 'bbbbbbbbbbbb'
  }])
})
