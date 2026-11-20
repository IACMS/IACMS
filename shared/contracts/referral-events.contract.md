# Contracts: Kafka `referral.*`

Topics:

- `TOPICS.REFERRAL_CREATED`
- `TOPICS.REFERRAL_ACCEPTED`
- `TOPICS.REFERRAL_REJECTED`
- `TOPICS.REFERRAL_COMPLETED`

Every payload MUST include BOTH:

- `originatingTenantId` — tenant that originated the referral context  
- `currentTenantId` — tenant presently responsible for actionable work on the referral leg

Department-aware payloads should also include:

- `fromDepartmentId` — department that initiated the referral leg
- `toDepartmentId` — destination department for the referral leg

Plus `referralId`, `caseId`, `status`, and timestamps as appropriate — see fixture.
