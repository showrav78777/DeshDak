# Private photo exact-version deletion protocol

Implemented 24 November 2026 as an internal storage prerequisite. This is not a
cleanup worker, an execution approval, or a production activation switch.

## Contract

`createPrivatePhotoStore().remove(reference)` now:

1. Validates the existing private-photo reference and purpose-specific limits.
2. Reads metadata for the exact key/version with the expected bucket owner and
   checksum mode. Confirms version, ciphertext checksum/length/type, KMS key and a
   strong non-wildcard ETag. Reported legal holds and unexpired/unknown retention
   metadata block deletion. No governance-retention bypass header is sent.
3. Sends a version-specific, ETag-conditional DELETE. A confirmed response needs
   HTTP 204, the matching version ID and no delete-marker indication.
4. Checks that the same version is absent. Only an exact-version HEAD 404 followed
   by a successful expected-owner/region bucket probe produces a receipt:
   `{ versionId, versionAbsent: true }`.

`confirmRemoval(reference)` performs step 4 without sending DELETE. A future
worker may use it only to reconcile an already-journalled uncertain attempt.
It may establish absence of that version; it cannot prove who removed it or that
other copies were erased. A still-present version, denied access, missing bucket,
wrong region or uncertain response remains an error. Invalid references do not
produce storage requests. A newer version at the same key remains untouched.

## Worker boundary

The worker is still unimplemented and disabled. Before using these primitives it
must persist an immutable attempt, acquire authoritative execution guards, and
recheck current roles/approval/expiry, policy, exact upload binding, holds, cases,
claims and quarantine. The metadata review snapshot alone is insufficient. It
must handle uncertain requests/process crashes and safely finish database
state/audit without treating a timeout as proof of failure or success.

The primitive covers one configured object version only. Legacy encrypted media,
noncurrent versions, replication, backups, provider logs and subject tombstoning
need their separate lifecycle/reconciliation controls. Do not claim complete
erasure from this receipt or enable broad bucket expiration.

## Sources and operational prerequisites

- [AWS DeleteObject](https://docs.aws.amazon.com/AmazonS3/latest/API/API_DeleteObject.html):
  explicit version selection, conditional deletion, response/version/delete-marker
  semantics and governance-retention bypass behavior.
- [AWS HeadObject](https://docs.aws.amazon.com/AmazonS3/latest/API/API_HeadObject.html):
  exact-version metadata, KMS checksum permissions and ambiguous error responses.
- [AWS HeadBucket](https://docs.aws.amazon.com/AmazonS3/latest/API/API_HeadBucket.html):
  expected-owner and region checks and the required bucket permission.

Certify these behaviors against the approved real bucket before activation. The
separate cleanup role needs reviewed version metadata/checksum, bucket-probe,
KMS and exact-version deletion permissions. Bucket probing requires ListBucket,
which also permits listing; review that additional access rather than granting
it to the web role for an unused primitive. This code never lists objects.

## Local verification

The existing private-photo-storage suite uses the actual AWS SDK against a
loopback-only synthetic HTTP server. It checks signatures, owner/version/ETag
parameters, no retention bypass, preservation on metadata/hold/retention failure,
ETag races, unsuccessful/lying acknowledgements, retained versions, lost responses,
bucket/permission uncertainty, read-only reconciliation and preservation of a
newer version at the same key. No AWS account or actual evidence file is used.
