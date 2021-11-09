const test = require('ava')
const sinon = require('sinon')
const S3 = require('../lib/s3')

test.beforeEach((t) => {
  t.context.s3 = new S3({
    s3: {
      putObject: sinon.stub().returns({
        promise: sinon.stub().resolves()
      }),
      getObject: sinon.stub().returns({
        promise: sinon.stub()
          .onFirstCall().resolves({
            Body: JSON.stringify([
              'standard@1.2.3',
              'js-deep-equals@1.2.3'
            ])
          })
          .onSecondCall().resolves({
            Body: JSON.stringify([
              'json',
              'json-something'
            ])
          })
      })
    },
    log: {},
    config: {
      getBucketName: sinon.stub().returns('org-donation-state')
    }
  })
})

test('getTopLevelPackages', async (t) => {
  const correlationId = 'asdf'
  const searchPatterns = [
    { language: 'javascript', registry: 'npm' },
    { language: 'ruby', registry: 'rubygems' }
  ]

  const topLevelDeps = await t.context.s3.getTopLevelPackages({ correlationId, searchPatterns })

  t.deepEqual(topLevelDeps, [
    { language: 'javascript', registry: 'npm', deps: ['standard@1.2.3', 'js-deep-equals@1.2.3'] },
    { language: 'ruby', registry: 'rubygems', deps: ['json', 'json-something'] }
  ])

  t.deepEqual(t.context.s3.s3.getObject.firstCall.args, [{
    Bucket: 'org-donation-state',
    Key: 'asdf/javascript_npm_top_level_packages.json'
  }])
  t.deepEqual(t.context.s3.s3.getObject.secondCall.args, [{
    Bucket: 'org-donation-state',
    Key: 'asdf/ruby_rubygems_top_level_packages.json'
  }])
})

test('putPackageWeightMaps', async (t) => {
  await t.context.s3.putPackageWeightMaps({
    correlationId: 'asdf',
    packageWeightMaps: [
      { language: 'javascript', registry: 'npm', weightMap: new Map([['standard', 1], ['js-deep-equals', 2]]) },
      { language: 'ruby', registry: 'rubygems', weightMap: new Map([['json', 1], ['json-something', 2]]) }
    ]
  })
  t.deepEqual(t.context.s3.s3.putObject.firstCall.args, [{
    Body: JSON.stringify([['standard', 1], ['js-deep-equals', 2]]),
    Bucket: 'org-donation-state',
    Key: 'asdf/javascript_npm_package_weight_map.json'
  }])
  t.deepEqual(t.context.s3.s3.putObject.secondCall.args, [{
    Body: JSON.stringify([['json', 1], ['json-something', 2]]),
    Bucket: 'org-donation-state',
    Key: 'asdf/ruby_rubygems_package_weight_map.json'
  }])
})
