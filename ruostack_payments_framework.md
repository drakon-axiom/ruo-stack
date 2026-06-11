# RUOStack — Payments & Wallet Framework (Decisions Needed)

*Third planning doc for the RUOStack white-label fulfillment platform. Scope: the money layers the platform actually touches — the prepaid wallet, the membership subscription, processor selection, and the regulatory questions that gate the whole model. Pairs with `pepify_build_spec.md` (product) and `ruostack_woocommerce_shipstation_plan.md` (fulfillment ops). Captured 2026-06-11.*

> **Not legal advice.** This doc frames the decisions and flags where the existing plan rests on assumptions that current sources contradict. The processor-eligibility and money-transmitter questions below need a payments/fintech attorney to clear *before* you build on a given processor. Treat the recommendations as a starting agenda for that conversation, not a substitute for it.

---

## 0. The two findings that reshape the plan

Both existing docs assume **Stripe** for everything money-related (membership + wallet top-up) and treat the wallet's non-refundable design as a settled detail. Current research complicates both:

1. **Stripe is split-brain on this vertical.** Stripe's own published FAQ says research-purpose peptides *may* be sold with preventive measures ensuring non-research buyers can't purchase. But the entire high-risk-merchant-services industry reports that Stripe (and PayPal, Square) flag and terminate peptide accounts after activity review — *regardless of how clean the compliance copy is* — because the restriction sits at the category level, not the marketing level. The pattern reported is: fast approval, then a freeze once transaction patterns reveal the vertical. **Building the brand-facing retail layer on Stripe is a known time-bomb.** (See §1.)

2. **The good news: RUOStack mostly isn't the one with that problem.** The architecture already keeps RUOStack out of *retail* peptide payments — the customer pays the brand through the brand's own gateway. What RUOStack's Stripe account actually processes is (a) SaaS membership and (b) prepaid-wallet top-ups for fulfillment services. That's a *much* easier risk profile than a peptide storefront — but it's not zero, and it needs to be positioned correctly to Stripe (§1.3).

---

## 1. Processor strategy — the load-bearing decision

### 1.1 What each party processes

| Money flow | Who processes it | Risk classification | Processor question |
|---|---|---|---|
| Customer → Brand (retail peptide sale) | **Brand's own gateway** (never RUOStack) | High-risk peptide e-commerce | The brand's problem — but RUOStack's onboarding should *require* a compliant gateway exists (§1.4) |
| Brand → RUOStack (membership $97–200/mo) | RUOStack's processor | SaaS subscription | Low-risk in isolation |
| Brand → RUOStack (wallet top-up) | RUOStack's processor | Prepaid funds for fulfillment of regulated goods | The gray zone (§1.3) |

The existing plan correctly isolates retail (Layer 1) from fulfillment cost (Layer 2). The unresolved question is whether RUOStack's *own* processor will tolerate Layer 2 once it understands the wallet ultimately funds peptide fulfillment.

### 1.2 Decision: can RUOStack use Stripe for membership + wallet?

**Open — needs a written read from Stripe and/or counsel before committing.** The argument *for*: RUOStack sells fulfillment software and logistics services, not peptides; it never lists, prices, or sells a research chemical to a consumer. The argument *against*: Stripe underwrites on the totality of the business, and "prepaid wallet that pays for peptide shipping under a white-label brand" is exactly the adjacency their risk models hunt for. A frozen RUOStack Stripe account would halt *every* brand's ability to fund wallets simultaneously — a single point of catastrophic failure.

**Recommended posture:**
- **Do not** assume Stripe is safe just because RUOStack isn't the retailer. Get it in writing.
- **Architect for processor-portability from day one** (§3) so a forced migration is a config change, not a rebuild — the same defensive logic the ShipStation adapter uses for the v1/v2 split.
- **Strongly consider a high-risk acquirer** for the wallet/membership layer even if Stripe initially approves, to avoid the "approved then frozen" pattern. High-risk processors underwrite this space deliberately and won't rug-pull on category discovery.

### 1.3 If staying on Stripe: the positioning that has to be true

Stripe's conditional allowance hinges on *preventive measures against non-research use*. For RUOStack's own account, the honest framing is "B2B fulfillment SaaS + service-cost wallet," and the supporting facts that need to actually exist:
- RUOStack's Stripe account never shows peptide SKUs, retail prices, or consumer transactions.
- Statement descriptors and product descriptions read as software/logistics ("RUOStack Membership," "RUOStack Fulfillment Credit"), not peptides.
- The research-use-only posture is enforced downstream (brand onboarding, labeling, COA layer) so the ecosystem is defensible if reviewed.

This is a disclosure-and-accuracy question, not a disguise. Misrepresenting the business to a processor is itself grounds for termination and fund seizure — the goal is accurate positioning, not concealment.

### 1.4 Brand-side requirement (new onboarding gate)

Since RUOStack depends on brands actually collecting retail (so wallets get funded), and since brands *will* get shut down by Stripe/PayPal/Square, add to brand onboarding:
- A check/attestation that the brand has a **peptide-capable payment gateway** on their store (high-risk merchant account, not mainstream PSP).
- Guidance/referral content on obtaining one (this is the single biggest operational pain in the vertical per the sources).
- This protects RUOStack's revenue: a brand that can't collect retail can't fund a wallet.

---

## 2. The prepaid wallet — regulatory classification

This is the second load-bearing question. The wallet holds brand funds before they're spent on fulfillment. Holding customer funds is the classic trigger for **money transmitter licensing (MTL)** — required in nearly every state, plus FinCEN MSB registration federally, when a business "accepts money from one person and makes it available to another."

### 2.1 Why RUOStack is probably *closed-loop* (the favorable case)

Money transmission analysis turns on **closed-loop vs. open-loop**. Closed-loop stored value — usable only within a single environment, with no outside surrender value — is generally low-risk and, with exceptions, largely unregulated for MTL purposes. RUOStack's wallet looks closed-loop by design:
- Funds can **only** be spent on RUOStack fulfillment services (wholesale + shipping).
- **Non-refundable / non-withdrawable** — no path back to cash, no surrender value.
- **No person-to-person transfer** — one brand can't send wallet value to another.
- **No external redemption** — it's not convertible to currency.

These are precisely the attributes that keep stored value out of the open-loop, BSA-regulated bucket. **The non-refundable design — which reads as a margin/float decision in the existing plan — is also doing real regulatory work** and should be preserved for that reason, not just the cash-flow one.

### 2.2 The wrinkles that need a lawyer's eyes

Closed-loop isn't automatic, and a few existing design choices poke at the edges:
- **Referral credits** ($50 referrer + $50 referee) and **refund-to-wallet credits** introduce value the brand didn't pay cash for. Generally fine for closed-loop, but worth confirming they don't create a "transfer between users" characterization via the referral path.
- **State-by-state variation is the enemy.** States adopting the Model Money Transmission Act still aren't harmonized; some explicitly exclude closed-loop stored value (e.g., Oregon excludes closed-loop but regulates wallet-like open-loop products), others are narrower. The conservative move is a **50-state survey memo** confirming the closed-loop exclusion holds everywhere RUOStack has brands.
- **FinCEN MSB registration** is a separate federal question from state MTL; closed-loop prepaid access under thresholds is typically exempt, but the determination should be documented.
- **Float handling.** Even if unregulated, holding aggregate prepaid balances raises questions about commingling, safeguarding, and what happens to balances on RUOStack insolvency. Decide whether float sits in a segregated account.

### 2.3 Decisions needed

| # | Question | Recommendation |
|---|---|---|
| 2.a | Is the wallet legally closed-loop in every operating state? | **Counsel-confirmed 50-state memo before scaling.** Strong prima facie yes; don't self-certify. |
| 2.b | Preserve non-refundable / non-withdrawable? | **Yes — it's both margin and the closed-loop anchor.** Disclose prominently (§4). |
| 2.c | Segregate float from operating funds? | **Yes** — safeguard balances even if not legally required; protects brands and the brand-trust story. |
| 2.d | FinCEN MSB registration required? | Document the exemption analysis; register if counsel says the closed-loop exemption is shaky. |
| 2.e | Per-day / per-balance caps to stay under thresholds? | Evaluate against the exemption math counsel produces. |

---

## 3. Processor-portability (architecture, mirrors the ShipStation adapter)

Given §1, build a **Payments Adapter** so RUOStack never calls a processor directly — exactly the pattern §5 of the fulfillment plan uses to survive ShipStation's v1/v2 split and eventual v1 deprecation.

- Single internal interface for: subscription create/cancel/update, one-time charge (wallet top-up), webhook ingestion, refund/credit, dispute handling.
- One concrete implementation per processor (Stripe today; a high-risk acquirer behind the same interface).
- All ledger logic (§ existing plan §7) stays processor-agnostic — the adapter only translates.
- **Why:** a forced migration off Stripe becomes a new adapter implementation + reconnect flow, not a rewrite of the wallet, billing, and dunning logic. This is cheap insurance against the most likely failure mode in this vertical.

---

## 4. Disclosures & consumer-protection copy (brand-facing)

The wallet's terms have to be unambiguous both for the closed-loop classification and to avoid disputes:
- **Non-refundable / non-withdrawable** stated at every top-up, not buried in ToS. Explicit acknowledgment checkbox on first deposit.
- **Funds usable only for RUOStack fulfillment services.** No cash value.
- **What happens to a balance** on membership cancellation, account closure, or RUOStack insolvency.
- **Refund-to-wallet** mechanics (refunds credit the wallet, never the card) stated before purchase.
- **Membership billing terms:** the $97→$200 anchor, "no contracts / cancel anytime," renewal date, dunning behavior on failed payment (past-due → retry → Pro-feature suspension, per the existing Stripe webhook plan §9).

---

## 5. Sales tax & nexus (flagged, separate workstream)

Out of deep scope here but must not fall through the cracks — neither existing doc addresses it:
- **Retail sales tax** is the *brand's* obligation (they're the seller of record). RUOStack should confirm this allocation in the brand agreement.
- **RUOStack's own taxability:** is the membership SaaS taxable? Is the fulfillment service / wallet spend taxable, and in which states (economic nexus thresholds)? The wallet top-up itself is generally not a taxable event (it's stored value, taxed on use) — but confirm.
- Recommend a SALT (state-and-local-tax) advisor pass once the operating-state footprint is known.

---

## 6. Open items checklist

- [ ] **1.2** — Written determination: can Stripe carry RUOStack membership + wallet? (Stripe + counsel)
- [ ] **1.2/3** — Select and integrate a high-risk acquirer as primary or fallback; build the Payments Adapter.
- [ ] **1.4** — Add brand-onboarding gate requiring a peptide-capable retail gateway + referral guidance.
- [ ] **2.a** — 50-state closed-loop / MTL survey memo (fintech counsel).
- [ ] **2.d** — FinCEN MSB exemption analysis, documented.
- [ ] **2.c** — Decide float segregation / safeguarding posture.
- [ ] **4** — Finalize wallet + membership disclosure copy and acknowledgment UX.
- [ ] **5** — SALT advisor pass on RUOStack's own tax obligations + brand-agreement tax allocation.

---

*Reflects research current to 2026-06-11. Processor policies and money-transmission rules change frequently and vary by state — re-verify with counsel before relying on any classification here. Not legal advice.*
