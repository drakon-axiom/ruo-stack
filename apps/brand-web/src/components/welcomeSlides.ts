/**
 * Copy for the first-run welcome tour, kept as data and separate from the
 * component so a wording change never touches navigation logic.
 *
 * Slide 1's title carries a `{name}` placeholder rather than being assembled in
 * the component — that keeps every user-visible string in this one file.
 */
export interface WelcomeSlide {
  title: string;
  body: string;
}

export const WELCOME_SLIDES: readonly WelcomeSlide[] = [
  {
    title: 'Welcome to RUOStack, {name}',
    body: 'You sell research peptides under your own brand. We hold the stock, pack each order, and ship it in your packaging. Your customers never see us.',
  },
  {
    title: 'Your wallet pays for fulfillment',
    body: 'You keep a prepaid balance. When an order comes in we charge your wallet for the product plus shipping; whatever your customer paid you above that is your margin. The Profit Calculator prices this out before you commit.',
  },
  {
    title: 'The catalog is your product line',
    body: 'Browse the research peptide catalog, set your own retail price on each product, and push them to your store. Every product carries a COA you can hand to customers.',
  },
  {
    title: 'Orders run themselves',
    body: 'Orders flow in from your connected store. We pack and ship them, and tracking comes back into the app on its own. Anything that needs a decision from you lands under Action Required.',
  },
  {
    title: 'Four things to set up',
    body: "Connect your store, fund your wallet, set your retail prices, and place your first order. We'll keep this list on your Overview page until it's done.",
  },
] as const;

/**
 * Fills the `{name}` placeholder with the user's first name. Falls back to a
 * clean greeting when we have no name — "Welcome to RUOStack, " with a dangling
 * comma is worse than no personalisation at all.
 */
export function slideTitle(slide: WelcomeSlide, firstName: string): string {
  if (!slide.title.includes('{name}')) return slide.title;
  if (!firstName) return slide.title.replace(', {name}', '');
  return slide.title.replace('{name}', firstName);
}
