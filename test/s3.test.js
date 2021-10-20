const test = require('ava')
const sinon = require('sinon')
const S3 = require('../lib/s3')

test.beforeEach((t) => {
  t.context.s3 = new S3({
    s3: {
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
    log: {}
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
    Bucket: 'org_donation_state',
    Key: 'asdf/javascript_npm_top_level_packages.json'
  }])
  t.deepEqual(t.context.s3.s3.getObject.secondCall.args, [{
    Bucket: 'org_donation_state',
    Key: 'asdf/ruby_rubygems_top_level_packages.json'
  }])
})
