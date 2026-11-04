import { accountConfigurationWarnings } from "@/modules/sourcing/account-readiness";
import styles from "./source-integration-readiness.module.css";

type Platform = {
  id: string; displayName: string; supportedCountries: string[];
  accounts: { id: string; displayName: string; countryCode: string; secretReferenceConfigured: boolean;
    rateLimitPerMinute: number | null; dailyQuota: number | null; dailyQuotaUsed: number; credentialExpiresAt: Date | null }[];
};

export function SourceIntegrationReadiness({ platforms }: { platforms: Platform[] }) {
  const now = new Date();
  return <section className={styles.panel} aria-labelledby="supplier-setup-heading">
    <header><p className="eyebrow">START HERE · ADMIN ONLY</p><h2 id="supplier-setup-heading">Connect a supplier, one step at a time</h2>
      <p>Configuration is not a live connection. Keep each source and account inactive until technical and operational approval is complete.</p></header>
    <ol className={styles.steps}>
      <li><b>Choose access</b><p>Confirm official API access or an authorized aggregator. Obtain written coverage for search, variants, stock, orders and tracking separately.</p></li>
      <li><b>Prepare test access</b><p>Request trial credentials, account-specific documentation, provider identifiers, sample responses, charges and quotas. Do not purchase a plan before compatibility testing.</p></li>
      <li><b>Configure below</b><p>Create the source and its countries, then an inactive account. Enter only a secret-manager reference, approved request limits and credential expiry if applicable.</p></li>
      <li><b>Verify before launch</b><p>Engineering must finish the secret lookup, provider mapping, compliance checks, usage controls and sandbox tests. Operations must approve activation.</p></li>
    </ol>
    <aside className={styles.notice}><b>Current implementation: offline foundation only.</b> Read-only OTAPI transport and candidate validation have automated tests. Live search, purchasing and tracking are not connected. The controls below do not unlock them.</aside>
    <details className={styles.setup}>
      <summary>Where do I get API access, and where do I add it?</summary>
      <ol>
        <li>For an aggregator trial, contact <a href="https://otcommerce.com/pinduoduo-api-dropshipping/" target="_blank" rel="noopener noreferrer">OT Commerce</a> and request API-only access covering both 1688 and Pinduoduo. Confirm coverage and costs in writing; purchasing and tracking may require separate arrangements.</li>
        <li>For direct access, apply through the <a href="https://open.1688.com/" target="_blank" rel="noopener noreferrer">1688 Open Platform</a> and <a href="https://open.pinduoduo.com/" target="_blank" rel="noopener noreferrer">Pinduoduo Open Platform</a>. Account eligibility and permissions must be confirmed by each platform.</li>
        <li>Give engineering the documentation export, provider identifiers, permissions and redacted response samples. Do not send the secret key through chat, email, screenshots or these forms.</li>
        <li>Your infrastructure administrator must put credentials in the deployment&apos;s secret manager and configure a reviewed resolver. The supplier resolver is not connected yet. A reference such as <code>secret://duar/sourcing/trial</code> is an example only, not an existing stored credential.</li>
        <li>Below, create or edit the source and inactive account. Select China as the origin country, enter the secret reference, set limits from the provider agreement, then save. Leave expiry empty only if the provider confirms no expiry.</li>
        <li>Engineering verifies mappings, quota enforcement, credential lookup, audit, compliance and trial requests before operations approves activation. Adding a reference alone will not make the API live.</li>
      </ol>
      <p>Request from the provider: search, detail, variants, stock freshness, image search, ordering, cancellation, tracking, billing limits and permission to display/cache product content. Confirm each capability separately.</p>
    </details>
    <div className={styles.accounts}><h3>Account configuration to review</h3><p>These checks use saved settings, not live API health. A complete configuration does not mean activation is approved.</p>
      {!platforms.length && <p>No source records yet. Use “Add future source” below.</p>}
      {platforms.map((platform) => <article key={platform.id}><h4>{platform.displayName}</h4>
        {!platform.accounts.length && <p>Next: create an inactive integration account with its secret reference and limits.</p>}
        {platform.accounts.map((account) => {
          const warnings = accountConfigurationWarnings(account, platform.supportedCountries, now);
          return <div key={account.id} className={styles.account}><b>{account.displayName} · {account.countryCode}</b>
            {warnings.length ? <ul>{warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul> : <p>Required configuration checks passed. Provider compatibility and live readiness are still unverified.</p>}
          </div>;
        })}</article>)}
    </div>
  </section>;
}
