exports.process = async ({ log, record, db, resolver, dynamo }) => {
  const {
    amount, // amount of donation in millicents
    timestamp, // timestamp for donation ledger of packages
    targetPackageId, // an optional package ID if this donation should target a specific package (skips scraping for manifests)
    redistributedDonation, // a flag to specify that this is not new money coming in; it's money the org already donated getting moved
    organizationId, // the organization ID who is donating
    description // an optional message to be added to the donation ledger with this donation
  } = JSON.parse(record.body)

  // If no org id, throw
  if (!organizationId) throw Error('undefined organization id passed in')

  log.info({ targetPackageId, amount, redistributedDonation, timestamp, organizationId, description })

  // TODO clean all this up to just get the TLP's with correlation id from s3

  // If another lambda has already picked up this transaction, it'll be locked on org id
  // preventing us from double paying packages from an org's donation.
  // This will throw if it's locked
  const lockInfo = await dynamo.lockOrg({ organizationId })
  log.info({ lockInfo })

  // a list of { language: string, registry: string, deps: []string }
  let extractedDependencies

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

  // now time to distribute the donation to the packages present in the org's repos.
  // first we determine how many unique packages were found (or computed via dep graph traversal) across all
  // registries and languages. then we dedicate a portion of the donation to each registry/language based on
  // the number of packages found for that registry/language. finally, we update our DB, upserting any newly
  // found packages, and applying their weight to the donation portion.
  const totalPackages = packageWeightMaps.reduce((total, { weightMap }) => total + weightMap.size, 0)
  log.info('Dependencies across all supported downloaded manifests: %d', totalPackages)

  // all done! unlock and gtfo
  await dynamo.unlockOrg({ organizationId })

  // TODO send event to dod-distribute-donations

  log.info({ organizationId, donationAmount, description })
  return { success: true }
}
