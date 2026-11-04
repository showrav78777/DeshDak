# Market-aware recommendations increment

## Delivered

The public homepage now contains a transparent **Picked for your market** product rail. It is backed by an internal, deterministic ranking rule rather than an undisclosed external model.

The ranking considers only approved public catalog information:

- availability and orderability;
- listing completeness;
- published product-Reel availability;
- published review volume; and
- the active shopping market's configured country priority.

It does not read a visitor's private orders, wallet, support conversations, address, payment history, or any other sensitive account data. The display explains this boundary to customers.

## Admin control

`RECOMMENDATIONS` is an internal capability and starts live for a fresh configuration. An Admin can disable it at `/admin/ai`; when disabled, the homepage hides the rail. The capability does not need an external provider or secret.

## Reels commerce improvement

Public Reels keep their TikTok-style vertical experience and now expose both **Add to cart** and **Buy now**. Both use the existing protected cart API, preserve login requirements for transactional actions, update the cart counter, and do not create a separate payment path.

## Explicitly deferred

Personalized machine-learning ranking, vector/image embeddings, cross-session identity stitching, and real vision search remain disabled until the owner selects compliant providers, supplies secret-manager references, completes privacy/consent review, and approves production monitoring and abuse controls.
