const test = require('ava')
const sinon = require('sinon')
const Sqs = require('../lib/sqs')

test.beforeEach((t) => {
  t.context.sqs = new Sqs({
    sqs: {
      sendMessage: sinon.stub().returns({
        promise: sinon.stub()
      })
    },
    config: {
      getOrgDistributeDonationInputQueueUrl: sinon.stub().returns('url goes here')
    }
  })
})

test('sqs | send org distribute donation message', async (t) => {
  t.context.sqs.sendOrgDistributeDonationMessage({ correlationId: 'asdf' })
  t.deepEqual(t.context.sqs.sqs.sendMessage.lastCall.args, [{
    QueueUrl: t.context.sqs.config.getOrgDistributeDonationInputQueueUrl(),
    MessageBody: JSON.stringify({ correlationId: 'asdf' })
  }])
})
