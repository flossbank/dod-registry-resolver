const AWS = require('aws-sdk')
const Pino = require('pino')
const RegistryResolver = require('@flossbank/registry-resolver')
const Process = require('./lib/process')
const Config = require('./lib/config')
const Db = require('./lib/mongo')
const Dynamo = require('./lib/dynamo')
const S3 = require('./lib/s3')
const SQS = require('./lib/sqs')

const kms = new AWS.KMS({ region: 'us-west-2' })
const docs = new AWS.DynamoDB.DocumentClient({ region: 'us-west-2' })
const awsSqs = new AWS.SQS({ region: 'us-west-2' })
const awsS3 = new AWS.S3({ region: 'us-west-2' })

/*
- Fetches each language/registry top level packages json using correlation id from s3
- Fetch no-comp list from mongo and fetch all deps
- Write package weights map to s3
- Send off event to dod-distribute-donations
*/
exports.handler = async (event) => {
  const log = Pino()
  const dynamo = new Dynamo({ log, docs })
  const config = new Config({ log, kms, dynamo })
  const s3 = new S3({ log, config, s3: awsS3 })
  const sqs = new SQS({ sqs: awsSqs, config })

  const db = new Db({ log, config })
  await db.connect()

  const epsilon = await config.getCompensationEpsilon()
  const resolver = new RegistryResolver({ log, epsilon })

  let results
  try {
    results = await Promise.all(
      event.Records.map(record => Process.process({ record, db, dynamo, resolver, log, s3, sqs }))
    )
    if (!results.every(result => result.success)) {
      throw new Error(JSON.stringify(results))
    }
    return results
  } finally {
    await db.close()
  }
}
