# Payment operations monitor

The scheduler-protected monitor detects stale SSLCommerz payments, overdue risk reviews, unresolved settlement exceptions, and delayed original-method refunds. It sends deduplicated daily in-app alerts to active Admin and Finance users and records a bounded maintenance run plus audit summary.

The monitor is read-only with respect to payments, refunds, orders, wallets, and journals. It never calls the payment provider and never guesses a financial outcome.

Production requires an approved scheduler, secret-manager configuration, thresholds, alert routing, named on-call owners, dashboards, and failure drills. The local defaults are one hour for payment/risk issues, four hours for settlement exceptions, and 24 hours for processing refunds.
