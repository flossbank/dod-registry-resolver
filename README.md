# dod-registry-resolver

Registry Resolver picks up message from Queue and fetches each supported language/registry TLP list from org_donation_state/${correlationId}/${language}_${registry}_top_level_packages.json. Each list is parsed into an Array; the no-comp list is fetched from Mongo for the relevant registry/language, and dependency resolution is performed.

The resulting package weight maps (one per lang/reg) are written as JSON files to S3.

```
bucket: org_donation_state/
folder: ${correlationId}/
file: ${language}_${registry}_package_weight_map.json

[ // e.g. javascript_npm_package_weight_map.json
  ["standard", 0.01]
  ["js-deep_equals", 0.99]
]
```

RR then creates a message in the DoD Input Queue containing { correlationId }