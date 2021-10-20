const test = require('ava')
const sinon = require('sinon')
const Process = require('../lib/process')

test.beforeEach((t) => {
  const db = {
    getNoCompList: sinon.stub().resolves(new Set())
  }
  const resolver = {
    getSupportedManifestPatterns: sinon.stub().resolves([{ language: 'javascript', registry: 'npm', searchPatterns: ['package.json'] }]),
    computePackageWeight: sinon.stub().resolves()
  }
  const log = { info: sinon.stub() }
  const s3 = {
    getTopLevelPackages: sinon.stub().resolves([{ language: 'javascript', registry: 'npm', deps: ['package-name@1.2.3'] }]),
    putPackageWeightMaps: sinon.stub().resolves()
  }
  const sqs = {
    sendOrgDistributeDonationMessage: sinon.stub().resolves()
  }

  t.context.services = {
    db,
    resolver,
    log,
    sqs,
    s3
  }
})

test('process | success', async (t) => {
  const { services } = t.context
  const res = await Process.process({
    record: {
      body: JSON.stringify({ correlationId: 'asdf' })
    },
    ...services
  })

  t.deepEqual(res, { success: true })

  t.true(services.db.getNoCompList.calledWith({ language: 'javascript', registry: 'npm' }))
  t.true(services.resolver.computePackageWeight.calledWith({
    language: 'javascript',
    noCompList: new Set(),
    registry: 'npm',
    topLevelPackages: ['package-name@1.2.3']
  }))
  t.true(services.s3.putPackageWeightMaps.calledOnce)
  t.true(services.sqs.sendOrgDistributeDonationMessage.calledOnce)
})

test('process | failure, some step fails', async (t) => {
  const { services } = t.context
  const { db } = services
  db.getNoCompList.rejects()
  await t.throwsAsync(Process.process({
    record: t.context.testRecord,
    ...services
  }))
})
