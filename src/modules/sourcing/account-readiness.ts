type AccountConfiguration = {
  secretReferenceConfigured: boolean;
  countryCode: string;
  rateLimitPerMinute: number | null;
  dailyQuota: number | null;
  dailyQuotaUsed: number;
  credentialExpiresAt: Date | null;
};

/** Configuration hints only: never authorizes a call or claims live health. */
export function accountConfigurationWarnings(account: AccountConfiguration, supportedCountries: readonly string[], now: Date): string[] {
  const warnings: string[] = [];
  if (!account.secretReferenceConfigured) warnings.push("Add a secret-manager reference, never the API key itself.");
  if (!supportedCountries.includes(account.countryCode)) warnings.push("Add the account's country to the source's supported countries.");
  if (!Number.isSafeInteger(account.rateLimitPerMinute) || (account.rateLimitPerMinute ?? 0) < 1) warnings.push("Set the provider-approved requests-per-minute limit.");
  if (!Number.isSafeInteger(account.dailyQuota) || (account.dailyQuota ?? 0) < 1) warnings.push("Set a daily request budget before paid API calls.");
  if (!Number.isSafeInteger(account.dailyQuotaUsed) || account.dailyQuotaUsed < 0) warnings.push("Request usage needs reconciliation.");
  else if (account.dailyQuota !== null && account.dailyQuotaUsed >= account.dailyQuota) warnings.push("Recorded daily request budget is exhausted; verify usage before activation.");
  if (account.credentialExpiresAt !== null) {
    const remaining = account.credentialExpiresAt.getTime() - now.getTime();
    if (!Number.isFinite(remaining)) warnings.push("Correct the credential expiry date.");
    else if (remaining <= 0) warnings.push("Credentials have expired; rotate them in the secret manager.");
    else if (remaining <= 7 * 24 * 60 * 60 * 1000) warnings.push("Credentials expire within seven days; arrange renewal.");
  }
  return warnings;
}
