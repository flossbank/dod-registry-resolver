const test = require('ava')
const sinon = require('sinon')
const Process = require('../lib/process')

test.beforeEach((t) => {
  const db = {
    getNoCompList: sinon.stub().resolves(new Set()),
    getOrgAccessToken: sinon.stub().resolves({ name: 'flossbank', accessToken: 'asdf' }),
    distributeOrgDonation: sinon.stub(),
    updateDonatedAmount: sinon.stub(),
    createOrganizationOssUsageSnapshot: sinon.stub(),
    decrimentManuallyBilledOrgRemainingDonation: sinon.stub(),
    getOrg: sinon.stub().resolves({ name: 'flossbank', accessToken: 'asdf', billingInfo: {} }),
    getPackage: sinon.stub().resolves({ name: 'standard', language: 'javascript', registry: 'npm' })
  }
  const dynamo = {
    lockOrg: sinon.stub().resolves({ success: true }),
    unlockOrg: sinon.stub().resolves({ success: true })
  }
  const resolver = {
    buildLatestSpec: sinon.stub().returns('standard@latest'),
    getSupportedManifestPatterns: sinon.stub().resolves(['package.json']),
    extractDependenciesFromManifests: sinon.stub().returns([{
      language: 'javascript',
      registry: 'npm',
      deps: ['standard', 'js-deep-equals', 'yttrium-server']
    }, {
      language: 'php',
      registry: 'idk',
      deps: ['some-php-dep']
    }, {
      language: 'haskell',
      registry: 'idk',
      deps: []
    }]),
    computePackageWeight: sinon.stub()
      .onFirstCall().resolves(new Map([['standard', 0.5], ['js-deep-equals', 0.2], ['yttrium-server', 0.3]]))
      .onSecondCall().resolves(new Map([['some-php-dep', 1]]))
      .onThirdCall().resolves(new Map())
  }
  const retriever = {
    getAllManifestsForOrg: sinon.stub().returns([{
      language: 'javascript',
      registry: 'npm',
      manifest: JSON.stringify({ dependencies: { standard: '12.0.1' } })
    }, {
      language: 'php',
      registry: 'idk',
      manifest: 'asdf'
    }])
  }
  const log = { info: sinon.stub() }

  t.context.services = {
    db,
    dynamo,
    resolver,
    retriever,
    log
  }

  t.context.recordBody = {
    amount: 1000000,
    timestamp: 1234,
    organizationId: 'test-org-id',
    description: 'testing donation'
  }
  t.context.testRecord = {
    body: JSON.stringify(t.context.recordBody)
  }

  t.context.testRecordManuallyBilledBody = {
    amount: 1000000,
    timestamp: 1234,
    organizationId: 'test-org-id',
    description: undefined
  }
  t.context.testRecordManuallyBilled = {
    body: JSON.stringify(t.context.recordBody)
  }

  t.context.undefinedOrgRecordBody = {
    amount: 1000000,
    timestamp: 1234,
    organizationId: undefined,
    description: 'testing donation'
  }
  t.context.undefinedOrgTestBody = {
    body: JSON.stringify(t.context.undefinedOrgRecordBody)
  }

  t.context.zeroAmountRecordBody = {
    amount: 0,
    timestamp: 1234,
    organizationId: 'test-org-id',
    description: 'testing donation'
  }
  t.context.zeroAmountRecord = {
    body: JSON.stringify(t.context.zeroAmountRecordBody)
  }

  t.context.targetPackageIdRecordBody = {
    amount: 1000000,
    timestamp: 1234,
    organizationId: 'test-org-id',
    targetPackageId: 'aaaaaaaaaaaa',
    description: 'testing donation'
  }
  t.context.targetPackageIdRecord = {
    body: JSON.stringify(t.context.targetPackageIdRecordBody)
  }
})

test('process | success', async (t) => {
  const { services, testRecord, recordBody } = t.context
  const res = await Process.process({
    record: testRecord,
    ...services
  })
  const expectedDonationAmount = (recordBody.amount * 0.96) - 30

  t.deepEqual(res, { success: true })
  t.true(services.dynamo.lockOrg.calledWith({ organizationId: 'test-org-id' }))
  t.true(services.resolver.getSupportedManifestPatterns.calledOnce)
  t.true(services.retriever.getAllManifestsForOrg.calledOnce)
  t.true(services.resolver.extractDependenciesFromManifests.calledOnce)

  t.true(services.db.getNoCompList.calledWith({ language: 'javascript', registry: 'npm' }))
  t.true(services.db.getNoCompList.calledWith({ language: 'php', registry: 'idk' }))
  t.true(services.resolver.computePackageWeight.calledWith({
    language: 'javascript',
    noCompList: new Set(),
    registry: 'npm',
    topLevelPackages: ['standard', 'js-deep-equals', 'yttrium-server']
  }))
  t.true(services.resolver.computePackageWeight.calledWith({
    language: 'php',
    registry: 'idk',
    noCompList: new Set(),
    topLevelPackages: ['some-php-dep']
  }))

  t.deepEqual(services.db.distributeOrgDonation.firstCall.firstArg, {
    donationAmount: Math.floor(expectedDonationAmount * (3 / 4)), // donation for 3 JavaScript deps out of 4 total deps found
    packageWeightsMap: new Map([['standard', 0.5], ['js-deep-equals', 0.2], ['yttrium-server', 0.3]]),
    language: 'javascript',
    description: 'testing donation',
    registry: 'npm',
    organizationId: 'test-org-id'
  })
  t.deepEqual(services.db.distributeOrgDonation.secondCall.firstArg, {
    donationAmount: Math.floor(expectedDonationAmount * (1 / 4)), // donation for 1 PHP dep out of 4 total deps found
    packageWeightsMap: new Map([['some-php-dep', 1]]),
    language: 'php',
    registry: 'idk',
    description: 'testing donation',
    organizationId: 'test-org-id'
  })
  t.true(services.db.createOrganizationOssUsageSnapshot.calledWith({
    organizationId: 'test-org-id',
    totalDependencies: 4,
    topLevelDependencies: 4
  }))
  t.true(services.db.updateDonatedAmount.calledWith({ organizationId: 'test-org-id', amount: recordBody.amount }))
  t.true(services.dynamo.unlockOrg.calledWith({ organizationId: 'test-org-id' }))
})

test('process | success | manually billed org updates remaining donation amount -> 0', async (t) => {
  const { services, testRecordManuallyBilled, testRecordManuallyBilledBody: recordBody } = t.context
  services.db.getOrg.resolves({ name: 'flossbank', accessToken: 'asdf', remainingDonation: 1000000, billingInfo: { manuallyBilled: true } })
  const res = await Process.process({
    record: testRecordManuallyBilled,
    ...services
  })

  t.deepEqual(res, { success: true })
  t.true(services.db.updateDonatedAmount.calledWith({ organizationId: 'test-org-id', amount: recordBody.amount }))
  t.true(services.db.decrimentManuallyBilledOrgRemainingDonation.calledWith({ organizationId: 'test-org-id', amount: 1000000 }))
  t.true(services.dynamo.unlockOrg.calledWith({ organizationId: 'test-org-id' }))
})

test('process | success | manually billed org updates remaining donation amount -> still remaining donation', async (t) => {
  const { services, testRecordManuallyBilled, testRecordManuallyBilledBody: recordBody } = t.context
  services.db.getOrg.resolves({ name: 'flossbank', accessToken: 'asdf', remainingDonation: 2000000, billingInfo: { manuallyBilled: true } })
  const res = await Process.process({
    record: testRecordManuallyBilled,
    ...services
  })

  t.deepEqual(res, { success: true })
  t.true(services.db.updateDonatedAmount.calledWith({ organizationId: 'test-org-id', amount: recordBody.amount }))
  t.true(services.db.decrimentManuallyBilledOrgRemainingDonation.calledWith({ organizationId: 'test-org-id', amount: 1000000 }))
  t.true(services.dynamo.unlockOrg.calledWith({ organizationId: 'test-org-id' }))
})

test('process | targetPackageId | success', async (t) => {
  const { services, targetPackageIdRecord } = t.context
  const res = await Process.process({
    record: targetPackageIdRecord,
    ...services
  })

  t.deepEqual(res, { success: true })
  t.true(services.dynamo.lockOrg.calledWith({ organizationId: 'test-org-id' }))
  t.true(services.resolver.getSupportedManifestPatterns.notCalled)
  t.true(services.retriever.getAllManifestsForOrg.notCalled)
  t.true(services.resolver.extractDependenciesFromManifests.notCalled)

  t.true(services.resolver.buildLatestSpec.calledWith('standard', { language: 'javascript', registry: 'npm' }))

  t.true(services.db.getNoCompList.calledWith({ language: 'javascript', registry: 'npm' }))
  t.deepEqual(services.resolver.computePackageWeight.lastCall.args, [{
    language: 'javascript',
    noCompList: new Set(),
    registry: 'npm',
    topLevelPackages: ['standard@latest']
  }])
  t.true(services.db.distributeOrgDonation.calledOnce)

  t.true(services.db.createOrganizationOssUsageSnapshot.notCalled)

  t.true(services.db.updateDonatedAmount.calledOnce)
  t.true(services.dynamo.unlockOrg.calledWith({ organizationId: 'test-org-id' }))
})

test('process | targetPackageId | redistribute | success', async (t) => {
  const { services, targetPackageIdRecordBody } = t.context

  services.resolver.computePackageWeight.reset()
  services.resolver.computePackageWeight.resolves(new Map([['standard', 1]]))

  const res = await Process.process({
    record: { body: JSON.stringify({ ...targetPackageIdRecordBody, redistributedDonation: true }) },
    ...services
  })
  const expectedDonationAmount = targetPackageIdRecordBody.amount

  t.deepEqual(res, { success: true })
  t.true(services.dynamo.lockOrg.calledWith({ organizationId: 'test-org-id' }))
  t.true(services.resolver.getSupportedManifestPatterns.notCalled)
  t.true(services.retriever.getAllManifestsForOrg.notCalled)
  t.true(services.resolver.extractDependenciesFromManifests.notCalled)

  t.true(services.resolver.buildLatestSpec.calledWith('standard', { language: 'javascript', registry: 'npm' }))

  t.true(services.db.getNoCompList.calledWith({ language: 'javascript', registry: 'npm' }))
  t.deepEqual(services.resolver.computePackageWeight.lastCall.args, [{
    language: 'javascript',
    noCompList: new Set(),
    registry: 'npm',
    topLevelPackages: ['standard@latest']
  }])
  t.deepEqual(services.db.distributeOrgDonation.lastCall.args, [{
    donationAmount: expectedDonationAmount,
    packageWeightsMap: await services.resolver.computePackageWeight(),
    description: targetPackageIdRecordBody.description,
    language: 'javascript',
    registry: 'npm',
    organizationId: targetPackageIdRecordBody.organizationId
  }])

  t.true(services.db.createOrganizationOssUsageSnapshot.notCalled)
  t.true(services.db.updateDonatedAmount.notCalled)
  t.true(services.dynamo.unlockOrg.calledWith({ organizationId: 'test-org-id' }))
})

test('process | targetPackageId | bad pkg id', async (t) => {
  const { services, targetPackageIdRecord } = t.context
  services.db.getPackage.resolves(undefined)

  await t.throwsAsync(() => Process.process({
    record: targetPackageIdRecord,
    ...services
  }), { message: 'targetPackageId not found in db: aaaaaaaaaaaa' })

  services.db.getPackage.resolves({})
  await t.throwsAsync(() => Process.process({
    record: targetPackageIdRecord,
    ...services
  }), { message: 'missing properties on target package: undefined undefined undefined' })

  services.db.getPackage.resolves({ name: 'papa' })
  await t.throwsAsync(() => Process.process({
    record: targetPackageIdRecord,
    ...services
  }), { message: 'missing properties on target package: papa undefined undefined' })

  services.db.getPackage.resolves({ name: 'papa', language: 'johns' })
  await t.throwsAsync(() => Process.process({
    record: targetPackageIdRecord,
    ...services
  }), { message: 'missing properties on target package: papa johns undefined' })

  t.true(services.dynamo.lockOrg.calledWith({ organizationId: 'test-org-id' }))
  t.true(services.resolver.getSupportedManifestPatterns.notCalled)
  t.true(services.retriever.getAllManifestsForOrg.notCalled)
  t.true(services.resolver.extractDependenciesFromManifests.notCalled)
  t.true(services.resolver.buildLatestSpec.notCalled)
  t.true(services.db.getNoCompList.notCalled)
  t.true(services.resolver.computePackageWeight.notCalled)
  t.true(services.db.distributeOrgDonation.notCalled)
  t.true(services.db.createOrganizationOssUsageSnapshot.notCalled)
  t.true(services.db.updateDonatedAmount.notCalled)
  t.true(services.dynamo.unlockOrg.notCalled)
})

test('process | success - amount of 0', async (t) => {
  const { services, zeroAmountRecord } = t.context
  const res = await Process.process({
    record: zeroAmountRecord,
    ...services
  })

  t.deepEqual(res, { success: true })

  t.true(services.db.distributeOrgDonation.notCalled)
  t.true(services.db.createOrganizationOssUsageSnapshot.calledWith({
    organizationId: 'test-org-id',
    totalDependencies: 4,
    topLevelDependencies: 4
  }))
  t.true(services.dynamo.unlockOrg.calledWith({ organizationId: 'test-org-id' }))
})

test('process | failure, undefined org id', async (t) => {
  const { services } = t.context
  await t.throwsAsync(Process.process({
    ...services,
    record: t.context.undefinedOrgTestBody
  }))
})

test('process | failure, org already locked', async (t) => {
  const { services } = t.context
  const { dynamo } = services
  dynamo.lockOrg.rejects()
  await t.throwsAsync(Process.process({
    record: t.context.testRecord,
    ...services
  }))
  t.false(services.db.distributeOrgDonation.calledOnce)
})

test('process | failure, distributeOrgDonation fails', async (t) => {
  const { services } = t.context
  const { db } = services
  db.distributeOrgDonation.rejects()
  await t.throwsAsync(Process.process({
    record: t.context.testRecord,
    ...services
  }))
})
