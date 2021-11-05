exports.process = async ({ log, record, db, resolver, sqs, s3 }) => {
  const {
    correlationId
  } = JSON.parse(record.body)

  log.info({ correlationId })

  // a list of { language: string, registry: string, searchPatterns: []string }, but we don't care about searchPatterns
  const searchPatterns = resolver.getSupportedManifestPatterns()
  // a list of { language: string, registry: string, deps: []string }
  const extractedDependencies = await s3.getTopLevelPackages({ correlationId, searchPatterns })

  // now that we have top level packages for each supported registry/language, we map that list into
  // [{ registry, language, weightMap }, ...]; effectively replacing the `deps` with their full dependency tree,
  // weighted.
  const packageWeightMaps = await Promise.all(extractedDependencies.map(async ({ language, registry, deps }) => {
    if (!deps.length) {
      return { language, registry, weightMap: new Map() }
    }
    const noCompList = await db.getNoCompList({ language, registry })
    const weightMap = await resolver.computePackageWeight({ topLevelPackages: deps, language, registry, noCompList })

    return { language, registry, weightMap }
  }))

  // persist the weight maps to s3
  await s3.putPackageWeightMaps({ correlationId, packageWeightMaps })

  // now time to distribute the donation to the packages present in the org's repos.
  await sqs.sendOrgDistributeDonationMessage({ correlationId })

  return { success: true }
}
